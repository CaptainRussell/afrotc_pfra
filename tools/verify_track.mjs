/**
 * Check src/track.js against the drawings it replaced.
 *
 * The track panel computes eight layouts from one formula. Six of those eight
 * arrived as hand-made HTML drawings, which are kept in references/track-
 * layouts/ for exactly this: they are the only independent check that the
 * formula is right, and the two combinations nobody drew (2 mile and 3 mile on
 * a 300 m track) are only trustworthy because the six that were drawn come out
 * to the metre.
 *
 * Reads the numbers straight out of those files rather than out of a table
 * copied from them, so a corrected drawing fails this run instead of quietly
 * disagreeing with the tool.
 *
 * Run: node tools/verify_track.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { trackPlan, pointOnTrack, TRACK_DISTANCES, TRACK_LENGTHS } =
  await import(pathToFileURL(join(ROOT, 'src', 'track.js')).href);

const DRAWINGS = join(ROOT, 'references', 'track-layouts');

/** "2km-300m-track.html" -> the distance id and track length it draws. */
function nameToCombo(file) {
  const track = Number(/-(\d+)m-track\.html$/.exec(file)?.[1]);
  const distance = file.startsWith('1.5-mile') ? 'mile1_5'
    : file.startsWith('2km') ? 'km2'
      : file.startsWith('2-mile') ? 'mile2'
        : file.startsWith('3-mile') ? 'mile3' : null;
  return distance && track ? { distanceId: distance, trackLength: track } : null;
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const has = (haystack, needle) => haystack.includes(needle);

let failures = 0;
const fail = (where, what) => { failures += 1; console.log(`  FAIL ${where}: ${what}`); };

for (const file of readdirSync(DRAWINGS).filter((f) => f.endsWith('.html')).sort()) {
  const combo = nameToCombo(file);
  if (!combo) { fail(file, 'cannot tell which layout this draws from its name'); continue; }

  const drawn = text(readFileSync(join(DRAWINGS, file), 'utf8'));
  const plan = trackPlan(combo);
  console.log(file);

  // The lap count and remainder, as the drawing prints them in the middle.
  const laps = plan.exact
    ? `${plan.laps} laps exactly`
    : `${plan.laps} laps + ${plan.remainderLabel} m`;
  if (!has(drawn, laps)) fail(file, `drawing does not say "${laps}"`);

  // Which crossing finishes it.
  const crossing = plan.exact
    ? `Finish = ${plan.crossings}th crossing after the start`
    : `Finish = ${plan.crossings}th crossing of own line`;
  if (!has(drawn, crossing)) fail(file, `drawing does not say "${crossing}"`);

  // The wheel distances, which are the numbers someone actually walks out.
  // The drawings write thousands without a separator in a couple of places,
  // so both spellings count as a match.
  const label = (span) => [span.label, span.label.replace(/,/g, '')];
  const needs = [label(plan.lap), label(plan.groupB.fromA)];
  if (plan.start) needs.push(label(plan.start.wheel), label(plan.groupB.startFromA));
  for (const forms of needs) {
    if (!forms.some((form) => has(drawn, form))) fail(file, `no "${forms[0]}" in the drawing`);
  }

  // And the direction the wheel is pushed, which is the half that is easy to
  // get backwards and impossible to spot in a number.
  if (plan.start && !has(drawn, plan.start.direction)) {
    fail(file, `drawing does not describe the start as "${plan.start.direction}"`);
  }
}

// The oval has to be a real oval: closed, the right length, and symmetric
// about the half lap, or a mark drawn on it lands somewhere it is not.
console.log('\ngeometry');
for (const length of TRACK_LENGTHS) {
  const start = pointOnTrack(length, 0);
  const end = pointOnTrack(length, length);
  const half = pointOnTrack(length, length / 2);
  if (Math.hypot(start.x - end.x, start.y - end.y) > 1e-9) fail(`${length} m`, 'path does not close');
  if (Math.hypot(start.x + half.x, start.y + half.y) > 1e-9) {
    fail(`${length} m`, 'half a lap is not opposite the finish');
  }

  let measured = 0;
  let previous = pointOnTrack(length, 0);
  for (let m = 0.01; m <= length + 1e-9; m += 0.01) {
    const here = pointOnTrack(length, m);
    measured += Math.hypot(here.x - previous.x, here.y - previous.y);
    previous = here;
  }
  if (Math.abs(measured - length) > 0.05) {
    fail(`${length} m`, `walking the drawn lane measures ${measured.toFixed(2)} m`);
  }
  console.log(`  ${length} m: closes, half lap opposite, lane measures ${measured.toFixed(2)} m`);
}

// Nothing checks these two, so say so rather than let the run imply it did.
console.log('\nnot covered by a drawing (derived from the same formula):');
for (const distance of TRACK_DISTANCES) {
  for (const length of TRACK_LENGTHS) {
    const drawn = readdirSync(DRAWINGS).some((f) => {
      const combo = nameToCombo(f);
      return combo && combo.distanceId === distance.id && combo.trackLength === length;
    });
    if (drawn) continue;
    const plan = trackPlan({ distanceId: distance.id, trackLength: length });
    console.log(`  ${distance.label} on ${length} m: ${plan.laps} laps + ${plan.remainderLabel} m, ` +
      `start ${plan.start.wheel.label} ${plan.start.direction}`);
  }
}

console.log(failures === 0
  ? '\nAll drawn layouts match src/track.js.'
  : `\n${failures} mismatch(es).`);
process.exit(failures === 0 ? 0 : 1);
