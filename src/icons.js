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
 * Body composition is a person with their arms up, the way a member stands to
 * be taped, with a band at the waist and a height arrow beside them: a tape
 * measure on its own says "measuring", not "waist to height". The band, and
 * the arrow under the HAMR runner, are the accent: the one thing in each
 * picture that is not a body.
 *
 * Markup only, on a 32 by 32 grid, so the page owns colour and size.
 */

const head = (x, y) => `<circle cx="${x}" cy="${y}" r="3" class="icon-head"/>`;
const floor = '<path d="M2 29.5 H30" class="icon-floor"/>';

const PUSHUP = floor + head(6, 13.5) + '<path d="M9 16.5 L29 26.5 M9.5 16.5 L9.5 28"/>';

const SHAPES = Object.freeze({
  waist_to_height:
    head(11, 6.5) +
    '<path d="M11 10.5 V20 M11 20 L8.5 29.5 M11 20 L13.5 29.5 M11 11.5 L4.5 4 ' +
    'M11 11.5 L17.5 4"/>' +
    '<path d="M6.5 16.5 Q11 19.5 15.5 16.5" class="icon-accent"/>' +
    '<path d="M26 3 V29.5 M26 3 L24 6 M26 3 L28 6 M26 29.5 L24 26.5 M26 29.5 L28 26.5" ' +
    'class="icon-thin"/>',
  hand_release_pushup: PUSHUP,
  pushup: PUSHUP,
  situp:
    floor + head(9, 9) +
    '<path d="M11 12.5 L16 26 L23 18 L28 28 M12 15 L16.5 17.5"/>',
  cross_leg_reverse_crunch:
    floor + head(4.5, 25.5) +
    '<path d="M8 27 L18 26.5 L12 17.5 L19 12 M9 28 L15 28.5"/>',
  // The forearms point forward, under the head, as they lie in a plank.
  forearm_plank:
    floor + head(6.5, 18.5) +
    '<path d="M9.5 21.5 L29.5 26.5 M9.5 21.5 L9.5 27.5 L3.5 27.5"/>',
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
  // Upright where the runner leans, a straight front leg and a bent back
  // knee, and the arms swung opposite: a stride, not a stance.
  walk_2km:
    head(16.5, 4.5) +
    '<path d="M16 8.5 L15 18.5 M15 18.5 L19.5 28.5 M15 18.5 L12.5 23.5 L9 28 ' +
    'M15.7 11 L20.5 17.5 M15.7 11 L10.5 16.5"/>'
});

/** The pictogram for an event, or for 'waist_to_height', as SVG markup. */
export function eventIcon(key) {
  const shape = SHAPES[key];
  return shape
    ? `<svg viewBox="0 0 32 32" class="event-icon-svg" focusable="false">${shape}</svg>`
    : '';
}
