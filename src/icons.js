/**
 * A pictogram for each event, shown beside its name.
 *
 * Bold strokes with round ends and a solid head, the way sport pictograms are
 * drawn, because at the 32 pixels these are shown at a thin stick figure turns
 * to a smudge. Every exercise is drawn side on, where its posture is what
 * tells it apart: a straight body on locked arms is a push-up, a body folded
 * at the hip is a sit-up, a forward lean in mid stride is a run. The floor
 * exercises stand on a floor line so a push-up cannot be read as a lean.
 *
 * Body composition is a person with a band at the waist and a height arrow
 * beside them, because a tape measure on its own says "measuring", not "waist
 * to height". The band, and the arrow under the HAMR runner, are the accent:
 * the one thing in each picture that is not a body.
 *
 * Markup only, on a 32 by 32 grid, so the page owns colour and size.
 */

const head = (x, y) => `<circle cx="${x}" cy="${y}" r="3" class="icon-head"/>`;
const floor = '<path d="M2 29.5 H30" class="icon-floor"/>';

const PUSHUP = floor + head(6, 13.5) + '<path d="M9 16.5 L29 26.5 M9.5 16.5 L9.5 28"/>';

const SHAPES = Object.freeze({
  waist_to_height:
    head(11, 5) +
    '<path d="M11 9 V19 M11 19 L8 29 M11 19 L14 29 M11 11 L6 19 M11 11 L16 19"/>' +
    '<path d="M6.5 15.5 Q11 18.5 15.5 15.5" class="icon-accent"/>' +
    '<path d="M25 3 V29 M25 3 L23 6 M25 3 L27 6 M25 29 L23 26 M25 29 L27 26" ' +
    'class="icon-thin"/>',
  hand_release_pushup: PUSHUP,
  pushup: PUSHUP,
  situp:
    floor + head(9, 9) +
    '<path d="M11 12.5 L16 26 L23 18 L28 28 M12 15 L16.5 17.5"/>',
  cross_leg_reverse_crunch:
    floor + head(4.5, 25.5) +
    '<path d="M8 27 L18 26.5 L12 17.5 L19 12 M9 28 L15 28.5"/>',
  forearm_plank:
    floor + head(5, 18.5) +
    '<path d="M8 21.5 L29 26.5 M8 21.5 L8 27.5 L13 27.5"/>',
  run_2mile:
    head(19.5, 5) +
    '<path d="M18 9 L14.5 18 M14.5 18 L20 21.5 L21 28.5 M14.5 18 L10.5 23.5 L5 22 ' +
    'M17 11.5 L21.5 14.5 L25 11.5 M17 11.5 L12.5 14 L10 17.5"/>',
  hamr_20m:
    head(19.5, 4) +
    '<path d="M18 8 L14.5 16 M14.5 16 L19.5 19 L20.5 24 M14.5 16 L10.5 20.5 L6 19.5 ' +
    'M17 10.5 L21 13 L24 10.5 M17 10.5 L13 12.5 L11 15.5"/>' +
    '<path d="M4 29 H28 M7 26.5 L4 29 L7 31.5 M25 26.5 L28 29 L25 31.5" ' +
    'class="icon-accent icon-thin"/>',
  walk_2km:
    head(15, 5) +
    '<path d="M15 9 L15.5 18.5 M15.5 18.5 L20.5 28.5 M15.5 18.5 L13 23.5 L10 28.5 ' +
    'M15 11.5 L19.5 17 M15 11.5 L11 16.5"/>'
});

/** The pictogram for an event, or for 'waist_to_height', as SVG markup. */
export function eventIcon(key) {
  const shape = SHAPES[key];
  return shape
    ? `<svg viewBox="0 0 32 32" class="event-icon-svg" focusable="false">${shape}</svg>`
    : '';
}
