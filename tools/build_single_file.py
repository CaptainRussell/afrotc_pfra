#!/usr/bin/env python3
"""
Build the tool into one HTML file that opens from a thumb drive.

Why a build step at all: the served site is four ES modules, a stylesheet, a
360 kB scoring table and a handful of images, all fetched relative to the page.
Open index.html with file:// and none of it loads -- modules are blocked by the
origin rules, and the fetch for the scoring data fails. A cadet with the folder
on a phone gets a blank page. This inlines the lot into a single document that
needs no server and no network.

It is a bundler, not a second copy of the app: everything it emits is read off
the real sources, so the single file cannot drift from the site. The one seam
the app keeps for it is window.__PFRA_INLINE__, which loadResources() prefers
over fetching the JSON.

Two builds, because the reference documents are 57 MB and the calculator is 1:

  pfra-calculator.html          the calculator, offline. The Reference
                                Documents section links to the published site,
                                so those rows need a connection.
  pfra-calculator-offline.html  every PDF and the HAMR audio embedded too.
                                Nothing about it needs a network.

Usage: python tools/build_single_file.py [--out DIR]
"""

import argparse
import base64
import io
import mimetypes
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Where a linked document lives when it is not embedded. The published site is
# the only address for these that a cadet can be given.
SITE = 'https://captainrussell.github.io/afrotc_pfra/'

# Concatenation order is dependency order; app.js is the entry and comes last.
MODULES = ['src/references.js', 'src/engine.js', 'src/analysis.js', 'src/verbiage.js']
ENTRY = 'app.js'


def read(rel):
    return io.open(ROOT / rel, encoding='utf-8').read()


def data_uri(rel):
    """A file as a data: URI, with the media type its extension implies."""
    path = ROOT / rel
    kind = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    if path.suffix == '.m4a':
        kind = 'audio/mp4'
    payload = base64.b64encode(path.read_bytes()).decode('ascii')
    return f'data:{kind};base64,{payload}'


# --- the module graph ------------------------------------------------------

EXPORT_CONST = re.compile(r'^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_FUNC = re.compile(r'^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_LIST = re.compile(r'^export\s*\{([^}]*)\}\s*;?\s*$', re.M)
IMPORT_STMT = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?\s*$", re.M | re.S)


def module_name(rel):
    return '__mod_' + re.sub(r'\W', '_', Path(rel).stem)


def resolve(spec, importer):
    """'./engine.js?v=abc' seen from src/analysis.js -> 'src/engine.js'."""
    clean = spec.split('?')[0]
    return str((Path(importer).parent / clean).as_posix()).replace('./', '')


def rewrite(rel, source, entry=False):
    """
    Turn one ES module into a statement that can share a single script.

    Each module keeps its own scope -- it is wrapped in a function that returns
    its exports -- so two modules may both have a private `roundTo` without one
    quietly winning. Flat concatenation would have made that a silent bug, and
    the whole point of the single file is that it behaves exactly like the site.
    """
    names = set(EXPORT_CONST.findall(source)) | set(EXPORT_FUNC.findall(source))
    for group in EXPORT_LIST.findall(source):
        # `export { formatTime };` re-exports a binding this module imported.
        names |= {part.strip().split(' as ')[-1].strip() for part in group.split(',') if part.strip()}

    body = EXPORT_LIST.sub('', source)
    body = re.sub(r'^export\s+', '', body, flags=re.M)

    def as_destructure(match):
        bindings = ' '.join(match.group(1).split())
        return f'const {{ {bindings} }} = {module_name(resolve(match.group(2), rel))};'

    body = IMPORT_STMT.sub(as_destructure, body)

    if entry:
        return body
    returned = ', '.join(sorted(names))
    return (f'/* --- {rel} --- */\n'
            f'const {module_name(rel)} = (() => {{\n{body}\n'
            f'return Object.freeze({{ {returned} }});\n}})();\n')


def bundle_script():
    parts = [rewrite(rel, read(rel)) for rel in MODULES]
    parts.append(f'/* --- {ENTRY} --- */\n' + rewrite(ENTRY, read(ENTRY), entry=True))
    # The cache-busting query survives into one string literal: the JSON fetch
    # in loadResources(), which the inline data means is never reached. It is
    # dead either way, but a version stamp inside a build that has no versioned
    # files to fetch is just something for a reader to wonder about.
    return re.sub(r'\?v=[0-9a-f]{10}', '', '\n'.join(parts))


# --- the page --------------------------------------------------------------

BANNER = """
<!-- =======================================================================
     Single-file build of the AFROTC PFRA Calculator, Det 250.

     Generated by tools/build_single_file.py from the sources in the repo at
     https://github.com/CaptainRussell/afrotc_pfra -- do not edit this file by
     hand, edit those and build again. Everything the calculator needs is
     inside this document: no server, no network, no folder of assets.

     {docs}
     ======================================================================= -->
"""

DOC_NOTE_EMBEDDED = 'The reference documents are embedded too, so nothing here needs a connection.'
DOC_NOTE_LINKED = ('The reference documents are NOT embedded: those rows open\n'
                   '     ' + SITE + 'references/ and need a connection.')


def build(embed_documents):
    html = read('index.html')
    css = read('styles.css')

    # Images first: the stylesheet carries two of them and the <head> a third.
    for asset in ['assets/det250-patch.png', 'assets/afrotc-shield.png']:
        css = css.replace(f'url("{asset}")', f'url("{data_uri(asset)}")')
    html = html.replace('href="assets/afrotc-shield-icon.png"',
                        f'href="{data_uri("assets/afrotc-shield-icon.png")}"')

    # The cache-busting query is a property of being served; inline it is noise.
    html = re.sub(r'\?v=[0-9a-f]{10}', '', html)

    # Reference documents: embedded, or pointed at the site they came from.
    def redirect(match):
        rel = match.group(1)
        return f'href="{data_uri(rel) if embed_documents else SITE + rel}"'

    html = re.sub(r'href="(references/[^"]+)"', redirect, html)

    # str.replace, not re.sub: these replacements are source code full of \d
    # and \s, and re.sub reads a backslash in its replacement as a template
    # escape and rejects the ones it does not recognise.
    link = '<link rel="stylesheet" href="styles.css">'
    assert html.count(link) == 1, 'stylesheet link not found'
    html = html.replace(link, f'<style>\n{css}\n</style>')

    script = f'<script type="module">\n{bundle_script()}\n</script>'
    tag = '<script type="module" src="app.js"></script>'
    assert html.count(tag) == 1, 'entry script tag not found'
    html = html.replace(tag, script)

    # The scoring table, on the seam loadResources() already prefers.
    inline = ('<script>\nwindow.__PFRA_INLINE__ = { data: '
              + read('pfra-scoring-data.json').strip() + ' };\n</script>')
    html = html.replace(script, inline + '\n' + script)

    banner = BANNER.format(docs=DOC_NOTE_EMBEDDED if embed_documents else DOC_NOTE_LINKED)
    return html.replace('<!DOCTYPE html>', '<!DOCTYPE html>' + banner, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='dist', help='output directory (default: dist)')
    args = parser.parse_args()

    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)

    for name, embed in [('pfra-calculator.html', False),
                        ('pfra-calculator-offline.html', True)]:
        page = build(embed)
        # Every path must have been rewritten. A leftover relative URL is a
        # file that silently 404s once the page is somewhere else, which is
        # exactly the failure this build exists to remove.
        leftovers = sorted(set(re.findall(r'(?:src|href)="((?:\./)?(?:assets|src|references)/[^"]*)"', page)
                               + re.findall(r'(?:src|href)="(styles\.css|app\.js)"', page)))
        if leftovers:
            sys.exit(f'{name}: unrewritten paths: {leftovers}')

        target = out / name
        target.write_text(page, encoding='utf-8', newline='\n')
        print(f'{target.relative_to(ROOT)}  {target.stat().st_size / 1_048_576:.2f} MB')


if __name__ == '__main__':
    main()
