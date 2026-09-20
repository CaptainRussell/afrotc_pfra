/**
 * UI for the Det 250 PFRA calculator.
 *
 * This file reads the form, hands raw values to the scoring engine, and renders
 * what comes back. It contains no scoring rules of its own: every number on
 * screen comes from src/engine.js and src/analysis.js, which are tested against
 * the published charts. If you find yourself about to write a threshold here,
 * it belongs in the engine instead.
 *
 * Scoring is live. A component scores the moment it has a usable number, so a
 * cadet sees points appear as they type rather than after pressing a button.
 * The one thing held back is the verdict: Excellent, Satisfactory and
 * Unsatisfactory only appear once all four components are in, because telling
 * someone they failed while they are still typing their first number is both
 * wrong and unkind.
 */

import {
  createScorer, COMPONENTS, COMPONENT_LABELS, EVENT_LABELS, EVENT_PHRASES,
  DET250_EVENTS, formatTime
} from './src/engine.js';
import { createAnalyzer } from './src/analysis.js';

const $ = (id) => document.getElementById(id);

let scorer = null;
let analyzer = null;
let lastResult = null;
let sex = null;
let ageBand = null;

/** Per component: a measurement, a declared non-completion, or nothing yet. */
const statuses = { muscular_strength: null, core_endurance: null, cardiorespiratory: null };

/**
 * Which event each component is being scored on.
 *
 * Det 250 only ever administers the three defaults. The alternates are here so
 * cadre can check a chart, and picking one raises a warning saying so.
 */
const events = {
  muscular_strength: 'hand_release_pushup',
  core_endurance: 'situp',
  cardiorespiratory: 'run_2mile'
};

/** Which input each event uses, and which control to show for it. */
const CONTROLS = {
  hand_release_pushup: { show: [], field: 'hrpu', kind: 'reps' },
  pushup: { show: [], field: 'hrpu', kind: 'reps' },
  situp: { show: ['core-reps'], hide: ['core-hold'], field: 'situp', kind: 'reps' },
  cross_leg_reverse_crunch: {
    show: ['core-reps'], hide: ['core-hold'], field: 'situp', kind: 'reps' },
  forearm_plank: {
    show: ['core-hold'], hide: ['core-reps'], field: ['plank-min', 'plank-sec'], kind: 'hold' },
  run_2mile: {
    show: ['cardio-time'], hide: ['cardio-shuttles'], field: ['run-min', 'run-sec'], kind: 'time' },
  hamr_20m: {
    show: ['cardio-shuttles'], hide: ['cardio-time'], field: 'hamr', kind: 'shuttles' }
};

const MAX_POINTS = {
  muscular_strength: 15, core_endurance: 15, cardiorespiratory: 50, body_composition: 20
};

// --- boot ------------------------------------------------------------------

/**
 * Where the scoring tables come from.
 *
 * Served over HTTP they are a separate file. In the single-file offline build
 * they are already on the page as window.__PFRA_INLINE__, because file:// URLs
 * block fetch. Keeping that fork in one function is what lets build_standalone.py
 * bundle this exact file rather than a rewritten copy of it.
 */
async function loadResources() {
  if (window.__PFRA_INLINE__) return window.__PFRA_INLINE__;
  const data = await fetch('./pfra-scoring-data.json').then((r) => r.json());
  return { data };
}

async function boot() {
  const { data } = await loadResources();
  scorer = createScorer(data);
  analyzer = createAnalyzer(data);

  for (const id of ['hrpu', 'situp', 'run-min', 'run-sec', 'plank-min', 'plank-sec',
    'hamr', 'height', 'waist']) {
    $(id).addEventListener('input', onAnyInput);
  }

  fillBandOptions();
  for (const button of document.querySelectorAll('.segment[data-sex]')) {
    button.addEventListener('click', () => selectSex(button.dataset.sex));
  }
  for (const button of document.querySelectorAll('.segment[data-band]')) {
    button.addEventListener('click', () => selectAgeGroup(button.dataset.band));
  }
  $('age-band').addEventListener('change', () => {
    ageBand = $('age-band').value || null;
    update();
  });
  for (const button of document.querySelectorAll('.step')) {
    button.addEventListener('click', () => nudge(button.dataset.target,
      Number(button.dataset.step)));
  }
  for (const slider of document.querySelectorAll('.slider')) {
    slider.addEventListener('input', () => onSliderInput(slider.dataset.component));
    // Tracked by pointer rather than by focus, so that arrowing along the track
    // with a keyboard still re-seats the handle from the fields it writes.
    slider.addEventListener('pointerdown', () => { dragging = slider.dataset.component; });
  }
  for (const event of ['pointerup', 'pointercancel']) {
    window.addEventListener(event, () => {
      if (dragging === null) return;
      dragging = null;
      update();
    });
  }
  for (const button of document.querySelectorAll('.not-done')) {
    button.addEventListener('click', () => cycleStatus(button.dataset.statusFor));
  }

  // Typing two digits into minutes should land you in seconds without a tap.
  advanceOnFull('run-min', 'run-sec', 2);
  advanceOnFull('plank-min', 'plank-sec', 1);

  $('plan-button').addEventListener('click', onPlan);
  $('tally-button').addEventListener('click', () => {
    $('scoreboard').scrollIntoView({ behavior: motion(), block: 'start' });
  });
  for (const button of document.querySelectorAll('.swap')) {
    button.addEventListener('click', () => {
      const component = button.dataset.swap;
      if ($(`event-${component}`).hidden) openPicker(component);
      else closePicker(component);
    });
  }
  for (const select of document.querySelectorAll('.event-picker select')) {
    select.addEventListener('change', () => selectEvent(select.dataset.component,
      select.value));
  }

  $('clear-scores').addEventListener('click', clearScores);
  setupPrinting();

  setupDocuments();
  showEventDocs();

  update();
}

const motion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function advanceOnFull(fromId, toId, digits) {
  $(fromId).addEventListener('input', () => {
    if ($(fromId).value.length >= digits) $(toId).focus();
  });
}

// --- input handling --------------------------------------------------------

/** Every band except under 25, straight from the data file. */
function fillBandOptions() {
  const select = $('age-band');
  for (const band of scorer.data.age_bands) {
    if (band === 'under25') continue;
    const option = document.createElement('option');
    option.value = band;
    option.textContent = scorer.data.age_band_ranges[band];
    select.append(option);
  }
}

/**
 * Nearly every cadet is under 25, so that is one tap. Everyone else picks their
 * band from the dropdown, and until they do there is no band at all: the engine
 * refuses to assume one, and so does this.
 */
function selectAgeGroup(choice) {
  const picker = $('band-picker');
  for (const button of document.querySelectorAll('.segment[data-band]')) {
    const on = button.dataset.band === choice;
    button.classList.toggle('on', on);
    button.setAttribute('aria-checked', String(on));
  }

  if (choice === 'under25') {
    ageBand = 'under25';
    picker.hidden = true;
    $('age-band').value = '';
  } else {
    picker.hidden = false;
    ageBand = $('age-band').value || null;
    $('age-band').focus();
  }
  update();
}

function openPicker(component) {
  $(`event-${component}`).hidden = false;
  document.querySelector(`.swap[data-swap="${component}"]`)
    .setAttribute('aria-expanded', 'true');
  $(`event-select-${component}`).focus();
}

function closePicker(component) {
  $(`event-${component}`).hidden = true;
  const button = document.querySelector(`.swap[data-swap="${component}"]`);
  button.setAttribute('aria-expanded', 'false');
  // Focus would otherwise be left on a control that is no longer on screen.
  if ($(`event-select-${component}`).contains(document.activeElement)
      || document.activeElement === $(`event-select-${component}`)) {
    button.focus();
  }
}

/**
 * Switch a component to a different authorised event.
 *
 * Swapping clears the old measurement rather than carrying it across: 40 sit-ups
 * and 40 seconds of plank are not the same reading, and reusing the number would
 * quietly produce a wrong score.
 */
function selectEvent(component, event) {
  events[component] = event;
  const control = CONTROLS[event];

  // The picker has done its job, so fold it away rather than leaving it open
  // over the inputs the cadre member now needs.
  closePicker(component);

  for (const id of control.hide ?? []) $(id).hidden = true;
  for (const id of control.show ?? []) $(id).hidden = false;

  statuses[component] = null;
  setStatus(fieldOf(component), null);
  for (const id of [control.field].flat()) $(id).value = '';

  $(`heading-${component}`).textContent = EVENT_LABELS[event];
  showAltNotes();
  showEventDocs();
  update();
}

/**
 * Flag an alternate exercise on the component it was chosen for.
 *
 * The warning sits with the exercise rather than in one banner elsewhere, so
 * there is no doubt which component it is about when only one was changed.
 */
function showAltNotes() {
  for (const component of ['muscular_strength', 'core_endurance', 'cardiorespiratory']) {
    const note = $(`alt-${component}`);
    const event = events[component];

    if (DET250_EVENTS.includes(event)) {
      note.hidden = true;
      continue;
    }
    // "cadets are not tested on X" keeps the verb agreeing with the cadets, so
    // the sentence stays correct whether X is singular or plural.
    note.textContent =
      `AFROTC cadets are not tested on ${EVENT_PHRASES[event]}. NOTACC CY26-092 ` +
      'sets the assessment as hand-release push-ups, sit-ups and the 2 mile run ' +
      'beginning with Academic Year 2026-2027. Cadre/Staff reference only.';
    note.hidden = false;
  }
}

/**
 * Reference sheets that only matter for one exercise.
 *
 * The HAMR tally sheet is how an administrator records shuttles, so it appears
 * with the component the moment HAMR is chosen and goes away again otherwise.
 */
function showEventDocs() {
  const doc = $('doc-hamr');
  const wanted = events.cardiorespiratory === 'hamr_20m';
  if (!wanted && !doc.hidden) {
    // Collapse the viewer too, or it would reopen already expanded later.
    const toggle = doc.querySelector('.view-toggle');
    if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
  }
  doc.hidden = !wanted;
}

const fieldOf = (component) => ({
  muscular_strength: 'hrpu', core_endurance: 'situp', cardiorespiratory: 'run'
}[component]);

function selectSex(value) {
  sex = value;
  for (const button of document.querySelectorAll('.segment[data-sex]')) {
    const on = button.dataset.sex === value;
    button.classList.toggle('on', on);
    button.setAttribute('aria-checked', String(on));
  }
  update();
}

function nudge(id, delta) {
  const input = $(id);
  const current = input.value.trim() === '' ? 0 : Number(input.value);
  const next = Math.max(0, Math.round(current) + delta);
  input.value = String(next);
  // A nudge is a measurement, so it clears any DNS or DNF on that component.
  const key = id === 'hrpu' ? 'hrpu' : 'situp';
  if (statuses[componentOf(key)]) setStatus(key, null);
  update();
}

const componentOf = (field) => ({
  hrpu: 'muscular_strength', situp: 'core_endurance', run: 'cardiorespiratory'
}[field]);

/** Cycle nothing -> did not start -> did not finish -> nothing. */
function cycleStatus(field) {
  const order = [null, 'dns', 'dnf'];
  const next = order[(order.indexOf(statuses[componentOf(field)]) + 1) % order.length];
  setStatus(field, next);
  update();
}

function setStatus(field, value) {
  const component = componentOf(field);
  statuses[component] = value;

  const note = $(`status-${field}`);
  const button = document.querySelector(`.not-done[data-status-for="${field}"]`);
  const inputs = field === 'run' ? ['run-min', 'run-sec'] : [field];

  if (value) {
    note.textContent = value === 'dns'
      ? 'Recorded as did not start. Scores 0 and fails the component.'
      : 'Recorded as did not finish. Scores 0 and fails the component.';
    note.hidden = false;
    button.textContent = value === 'dns' ? 'Did not start' : 'Did not finish';
    button.classList.add('on');
    for (const id of inputs) {
      $(id).value = '';
      $(id).disabled = true;
    }
  } else {
    note.hidden = true;
    button.textContent = 'Did not start or finish';
    button.classList.remove('on');
    for (const id of inputs) $(id).disabled = false;
  }
}

function onAnyInput() {
  update();
}

/**
 * Empty the measurements, ready for the next cadet.
 *
 * Age band and sex are left alone on purpose: a cadre member scoring a flight
 * is usually working through people of the same band, and retyping it twelve
 * times is the friction this button exists to remove. Exercises go back to the
 * three Det 250 events, so a cadre session cannot leak an alternate chart into
 * the next cadet's score.
 */
function clearScores() {
  for (const id of ['hrpu', 'situp', 'run-min', 'run-sec', 'plank-min', 'plank-sec',
    'hamr', 'height', 'waist']) {
    $(id).value = '';
  }

  for (const [component, fallback] of [
    ['muscular_strength', 'hand_release_pushup'],
    ['core_endurance', 'situp'],
    ['cardiorespiratory', 'run_2mile']
  ]) {
    setStatus(fieldOf(component), null);
    if (events[component] !== fallback) {
      $(`event-select-${component}`).value = fallback;
      selectEvent(component, fallback);
    }
    closePicker(component);
  }

  lastResult = null;
  $('results').hidden = true;
  $('results').classList.remove('revealed');
  $('target-plans').replaceChildren();
  $('target-error').hidden = true;

  update();
  $('assessment').scrollIntoView({ behavior: motion(), block: 'start' });
}

// --- reading the form ------------------------------------------------------

function wholeNumber(id) {
  const raw = $(id).value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined; // undefined = present but unusable
}

function decimal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Build whatever the engine can score right now.
 *
 * Returns the input plus the set of components that are actually ready, so the
 * renderer knows which chips to fill and whether the assessment is complete.
 * Missing components are scored as DNS purely so the engine has something to
 * chew on; the ready set is what decides whether a verdict is shown.
 */
function readForm() {
  const ready = new Set();

  if (!ageBand || !sex) {
    return { input: null, ready };
  }

  const input = { ageBand, sex };

  // Each of the three timed or counted components reads whichever control its
  // currently selected event uses.
  for (const component of ['muscular_strength', 'core_endurance', 'cardiorespiratory']) {
    const event = events[component];
    const control = CONTROLS[event];

    if (statuses[component]) {
      input[component] = { event, status: statuses[component] };
      ready.add(component);
      continue;
    }

    if (control.kind === 'hold' || control.kind === 'time') {
      const [minId, secId] = control.field;
      const minutes = wholeNumber(minId);
      const seconds = wholeNumber(secId);
      const usable = minutes !== null && minutes !== undefined
        && seconds !== null && seconds !== undefined && seconds <= 59;
      if (usable) {
        input[component] = { event, seconds: minutes * 60 + seconds };
        ready.add(component);
      } else {
        input[component] = { event, status: 'dns' };
      }
      continue;
    }

    const count = wholeNumber(control.field);
    if (count === null || count === undefined) {
      input[component] = { event, status: 'dns' };
    } else {
      input[component] = { event, [control.kind === 'shuttles' ? 'shuttles' : 'reps']: count };
      ready.add(component);
    }
  }

  const heightValue = decimal('height');
  const waist = decimal('waist');
  const height = heightValue === null || heightValue === undefined ? null : heightValue;

  if (height && waist) {
    input.body_composition = { event: 'whtr', waistInches: waist, heightInches: height };
    ready.add('body_composition');
  } else {
    // Not measured yet. Stand it in as DNS rather than as a plausible ratio:
    // a placeholder that scored points would put 20 unearned points into the
    // running total, which is the exact inflation this tool exists to prevent.
    input.body_composition = { event: 'whtr', status: 'dns' };
  }

  return { input, ready };
}

// --- the live update -------------------------------------------------------

/**
 * Glow whichever part of the form comes next, one at a time.
 *
 * A cadet opening this on a phone sees an empty form with four events and no
 * indication of where to start. Exactly one cue is on screen at any moment, in
 * the order the assessment is administered, so the form reads as a queue that
 * empties rather than a wall to be surveyed. A section stops glowing the
 * instant it holds a usable value, which is why `ready` drives it: that is the
 * same set the scoring engine is given, so the cue can never disagree with the
 * chips about what has been filled in.
 */
const CUE_ORDER = ['muscular_strength', 'core_endurance', 'cardiorespiratory',
  'body_composition'];

function showCue(ready) {
  let target = null;

  if (!ageBand) {
    // Tapping "25 or older" answers the age question but does not settle the
    // band, so the cue moves to the dropdown that still has to be answered.
    target = $('band-picker').hidden ? $('field-age') : $('band-picker');
  } else if (!sex) {
    target = $('field-sex');
  } else {
    const next = CUE_ORDER.find((component) => !ready.has(component));
    if (next) target = document.querySelector(`.event[data-component="${next}"]`);
  }

  for (const node of document.querySelectorAll('.cue')) {
    if (node !== target) node.classList.remove('cue');
  }
  if (target) target.classList.add('cue');
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function update() {
  showHeightInFeet();
  renderRanges(ageBand);   // reads the height, so it must run after it changes
  renderSliders(ageBand); // same bounds, same reason to run here
  renderHeightSlider();   // fixed bounds, so it needs no band at all

  const { input, ready } = readForm();
  showCue(ready);

  if (!input) {
    for (const component of COMPONENTS) resetChip(component);
    lastResult = null;
    $('results').hidden = true;
    showTally(null, ready);
    return;
  }

  let result;
  try {
    result = scorer.score(input);
  } catch (error) {
    // readForm only builds an input it believes is scoreable, so a throw here
    // is a bug rather than a half-typed field. Say so rather than going quiet.
    console.error('PFRA: scoring failed for', input, error);
    showTally(null, ready);
    return;
  }

  lastResult = result;
  const complete = ready.size === COMPONENTS.length;

  for (const component of COMPONENTS) {
    if (ready.has(component)) fillChip(component, result.components[component]);
    else resetChip(component);
  }

  showTally(result, ready);

  if (!complete) {
    $('results').hidden = true;
    return;
  }

  renderScoreboard(result);
  renderFailures(result);
  renderWarnings(result);
  renderComponents(result);
  renderReferences(result);

  if ($('results').hidden) {
    $('results').hidden = false;
    $('results').classList.add('revealed');
  }
}

/**
 * Echo the height back in feet and inches.
 *
 * The 4446 records height in inches, so that is what gets typed. Cadets think
 * in feet and inches, so the conversion sits underneath. It shows the value
 * after the half-inch rounding the DAFMAN requires (para 3.15.2.3), which is
 * also the number the ratio is worked out from.
 */
function showHeightInFeet() {
  const hint = $('height-hint');
  const raw = $('height').value.trim();
  const inches = raw === '' ? NaN : Number(raw);

  if (!Number.isFinite(inches) || inches <= 0) {
    hint.textContent = 'Nearest ½ inch, as the 4446 records it.';
    return;
  }

  const rounded = Math.round(inches * 2) / 2;
  const feet = Math.floor(rounded / 12);
  const rest = rounded - feet * 12;
  const whole = Math.floor(rest);
  const half = rest - whole >= 0.5 ? '½' : '';
  const shown = `${feet}′ ${whole}${half}″`;

  hint.textContent = rounded === inches
    ? `${shown}, recorded to the nearest ½ inch.`
    : `Recorded as ${rounded} inches, which is ${shown}.`;
}

/* --- the sliders ---------------------------------------------------------
 *
 * A second way to enter the same measurement, for a cadet who wants to feel
 * what a few more reps is worth rather than type four numbers to find out. It
 * is not a second source of truth: dragging writes into the number fields, and
 * everything after that reads those, exactly as it does when a cadet types.
 *
 * Both ends come off the chart, so the left of every track is the worst score
 * and the right is full marks. For a run and for a waist the raw number falls
 * as the handle moves right; `descending` mirrors the element's own value on
 * the way in and out, so the DOM keeps an ordinary ascending range.
 */
const SLIDER_MEASURES = {
  // `worst` is where the left end sits: one step short of the minimum, so the
  // far left of every track is a fail and everything else on it scores. A
  // track that ran down to nothing would spend half its length in territory
  // that all scores the same zero, which is length a cadet cannot use.
  //
  // Anything below the left end can still be typed. The handle pins to the end
  // in that case, and the chip beside it shows what the number really scored.
  reps: { descending: false, step: 1, worst: (r) => r.floor.value - 1, format: (v) => `${v}` },
  shuttles: {
    descending: false, step: 1, worst: (r) => r.floor.value - 1, format: (v) => `${v}`
  },
  hold: {
    descending: false, step: 1, worst: (r) => r.floor.value - 1, format: formatTime
  },
  time: {
    descending: true,
    step: 1,
    // Slower is worse, so one step short of the minimum is one second past it.
    worst: (range) => range.floor.value + 1,
    format: formatTime
  },
  ratio: {
    descending: true,
    step: 0.5,
    worst: (range) => range.floor.waistInches,
    format: (v) => `${v.toFixed(1)} in`
  }
};

/** Bounds are kept because an input event carries only the element's value. */
const sliderBounds = {};

/** Which slider a finger is currently on, if any. */
let dragging = null;

const sliderKind = (component) =>
  component === 'body_composition' ? 'ratio' : CONTROLS[events[component]].kind;

/** Undo the mirroring: what the handle's position actually measures. */
const toRaw = (bounds, position) =>
  bounds.descending ? bounds.min + bounds.max - position : position;

/** And back again: where on the track a measurement sits. */
const toPosition = (bounds, raw) =>
  bounds.descending ? bounds.min + bounds.max - raw : raw;

function renderSliders(band) {
  for (const component of COMPONENTS) {
    const row = $(`slider-${component}`);
    const input = $(`slide-${component}`);
    const kind = sliderKind(component);
    const spec = SLIDER_MEASURES[kind];
    const event = events[component] ?? 'whtr';
    const range = (sex && band)
      ? scorer.rangeFor({ component, event, sex, band, heightInches: decimal('height') || null })
      : null;

    // No chart yet, or — for the waist — no height, so there is no way to turn
    // a ratio into the inches a slider would have to move through. A declared
    // DNS or DNF hides it too: there is no measurement left to adjust.
    const bestValue = kind === 'ratio' ? range?.best.waistInches : range?.best.value;
    const worstValue = range ? spec.worst(range) : null;
    if (bestValue == null || worstValue == null || statuses[component]) {
      row.hidden = true;
      continue;
    }

    const bounds = {
      descending: spec.descending,
      min: Math.min(bestValue, worstValue),
      max: Math.max(bestValue, worstValue)
    };
    sliderBounds[component] = bounds;

    row.hidden = false;
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    input.step = String(spec.step);
    input.setAttribute('aria-label',
      kind === 'ratio' ? 'Waist in inches' : `${EVENT_LABELS[event]} slider`);

    $(`slider-low-${component}`).textContent = spec.format(worstValue);
    $(`slider-high-${component}`).textContent = spec.format(bestValue);

    // Shade the failing tip of the track. It is one step wide by construction,
    // which on a run is one second of a six minute range and would render as
    // nothing, so it is floored at a width that can actually be seen: this is
    // an affordance marking the failing end, not a plot of anything. Body
    // composition has no minimum (AFMAN 36-2905 para 3.7.1) and gets no tip.
    const span = bounds.max - bounds.min;
    const threshold = range.floor.isFloor ? range.floor.value : null;
    const cut = (threshold == null || span === 0)
      ? 0
      : Math.max(3, (toPosition(bounds, threshold) - bounds.min) / span * 100);
    input.style.setProperty('--below-minimum', `${Math.min(100, cut)}%`);

    // Leave the handle alone while a finger is on it. The value it just wrote
    // is what update() has read back, so re-seating it would be a no-op in the
    // ordinary case and a fight with the pointer in the awkward ones.
    if (dragging === component) continue;

    // Nothing entered yet parks the handle at the left of the track, which is
    // the worst end for every component whichever way its numbers run.
    const current = currentMeasurement(component);
    const position = current == null ? bounds.min : toPosition(bounds, current);
    input.value = String(Math.max(bounds.min, Math.min(bounds.max, position)));
    input.setAttribute('aria-valuetext',
      current == null ? 'not entered' : spec.format(current));
  }
}

/**
 * Height gets a slider too, but it is not a score.
 *
 * Its range is the chart's own. The waist-to-height grid runs 58.0 to 78.0
 * inches in half inches, which is the useful travel; the field stays wider,
 * because the ratio is arithmetic rather than a lookup and a height off the
 * printed grid still scores. A height outside the range pins the handle to the
 * end, the same as a rep count past full marks does.
 *
 * Nothing here depends on age, sex or the event, so unlike the component
 * sliders this one is usable from the moment the page loads.
 */
const HEIGHT_SLIDER = Object.freeze({ min: 58, max: 78 });

function renderHeightSlider() {
  if (dragging === 'height') return;
  const input = $('slide-height');
  const current = decimal('height') ?? null;
  // Empty parks at the left, as every other slider does, so five tracks that
  // have not been set read the same way rather than one looking half answered.
  const value = current == null
    ? HEIGHT_SLIDER.min
    : Math.max(HEIGHT_SLIDER.min, Math.min(HEIGHT_SLIDER.max, current));
  input.value = String(value);
  input.setAttribute('aria-valuetext',
    current == null ? 'not entered' : `${current} inches`);
}

/** The measurement now in the form, in the unit its chart is read in. */
function currentMeasurement(component) {
  if (component === 'body_composition') return decimal('waist') ?? null;
  const control = CONTROLS[events[component]];
  if (control.kind === 'hold' || control.kind === 'time') {
    const [minId, secId] = control.field;
    const minutes = wholeNumber(minId);
    const seconds = wholeNumber(secId);
    if (minutes == null || seconds == null) return null;
    return minutes * 60 + seconds;
  }
  return wholeNumber(control.field) ?? null;
}

/** Write a dragged value into the fields the rest of the app reads. */
function onSliderInput(component) {
  if (component === 'height') {
    const raw = Number($('slide-height').value);
    $('height').value = raw.toFixed(1);
    $('slide-height').setAttribute('aria-valuetext', `${raw} inches`);
    update();
    return;
  }

  const bounds = sliderBounds[component];
  if (!bounds) return;
  const raw = toRaw(bounds, Number($(`slide-${component}`).value));

  if (component === 'body_composition') {
    $('waist').value = raw.toFixed(1);
  } else {
    const control = CONTROLS[events[component]];
    if (control.kind === 'hold' || control.kind === 'time') {
      const [minId, secId] = control.field;
      $(minId).value = String(Math.floor(raw / 60));
      $(secId).value = String(raw % 60).padStart(2, '0');
    } else {
      $(control.field).value = String(raw);
    }
  }

  $(`slide-${component}`).setAttribute('aria-valuetext',
    SLIDER_MEASURES[sliderKind(component)].format(raw));
  update();
}

/**
 * The chart bounds for each component, shown whether or not anything is typed.
 *
 * Both numbers come from the engine, which reads them off the chart for this
 * sex and band. Until a sex and age are set there is no chart to read, so the
 * strip says so rather than showing a default that might be the wrong one.
 */
function renderRanges(band) {
  for (const component of COMPONENTS) {
    const host = $(`range-${component}`);
    host.replaceChildren();

    const event = events[component] ?? 'whtr';
    const heightInches = decimal('height') || null;
    const range = (sex && band)
      ? scorer.rangeFor({ component, event, sex, band, heightInches })
      : null;

    if (!range) {
      host.append(el('p', 'range-empty', 'Set your age and sex to see the chart range.'));
      continue;
    }

    if (range.floor.isFloor) {
      host.append(rangeItem('Minimum', range.floor.label,
        `${range.minimumPoints.toFixed(1)} pts`, false));
      host.append(rangeItem('Full marks', range.best.label,
        `${range.maxPoints.toFixed(1)} pts`, false));
      continue;
    }

    // Waist to height. Lead with the waist in inches, which is the number a
    // cadet can do something about, and keep the ratio underneath because that
    // is what the scoring chart is actually read on.
    host.append(rangeItem('Scores zero',
      range.floor.waistLabel ?? range.floor.label,
      range.floor.waistLabel ? `ratio ${range.floor.label}` : 'no minimum', true));
    host.append(rangeItem('Full marks',
      range.best.waistLabel ?? range.best.label,
      range.best.waistLabel
        ? `ratio ${range.best.label} · ${range.maxPoints.toFixed(1)} pts`
        : `${range.maxPoints.toFixed(1)} pts`, false));
  }
}

function rangeItem(caption, value, points, muted) {
  const box = el('div', `range-item${muted ? ' muted' : ''}`);
  box.append(el('span', 'range-caption', caption));
  box.append(el('span', 'range-value', value));
  box.append(el('span', 'range-points', points));
  return box;
}

/**
 * Draw one points bar.
 *
 * The bar is scaled to that component's own maximum, so 39 of 50 on the run and
 * 11 of 15 on push-ups read as comparable effort rather than comparable points.
 * Where a component has a minimum, a tick marks it, since clearing that line
 * matters more than the width of the bar.
 */
function setMeter(id, points, maxPoints, state, threshold) {
  const meter = $(id);
  const fill = meter.querySelector('.meter-fill');
  const mark = meter.querySelector('.meter-mark');

  const percent = maxPoints > 0
    ? Math.max(0, Math.min(100, (points / maxPoints) * 100))
    : 0;
  fill.style.width = `${percent}%`;
  meter.className = `meter${id === 'meter-composite' ? ' meter-composite' : ''} ${state}`;
  meter.setAttribute('aria-valuenow', points.toFixed(1));
  meter.setAttribute('aria-valuetext', `${points.toFixed(1)} of ${maxPoints} points`);

  if (threshold == null || maxPoints <= 0) {
    mark.hidden = true;
    return;
  }
  mark.style.left = `${(threshold / maxPoints) * 100}%`;
  mark.hidden = false;
}

function resetChip(component) {
  const chip = $(`chip-${component}`);
  chip.textContent = `– / ${MAX_POINTS[component]}`;
  chip.className = 'chip';
  $(`row-${component}`).hidden = true;
  setMeter(`meter-${component}`, 0, MAX_POINTS[component], 'is-empty', null);
}

function fillChip(component, scored) {
  const chip = $(`chip-${component}`);
  chip.textContent = `${scored.points.toFixed(1)} / ${scored.maxPoints.toFixed(0)}`;
  const failing = scored.status !== 'scored' || !scored.meetsMinimum;
  chip.className = `chip filled${failing ? ' chip-fail' : ''}`;

  setMeter(`meter-${component}`, scored.points, scored.maxPoints,
    failing ? 'is-fail' : 'is-pass', scored.minimumPoints);

  const row = $(`row-${component}`);
  if (scored.chartRowLabel) {
    row.textContent = scored.chartRowLabel;
    row.hidden = false;
  } else {
    row.textContent = scored.status === 'below_minimum'
      ? 'Below the chart minimum: scores 0 and fails this component.'
      : '';
    row.hidden = !row.textContent;
  }
}

/** The running total pinned to the bottom of the screen. */
function showTally(result, ready) {
  const tally = $('tally');
  const score = $('tally-score');
  const text = $('tally-text');

  if (!result) {
    tally.hidden = ready.size === 0;
    score.textContent = '—';
    text.textContent = 'Add your age and sex to start scoring';
    tally.className = 'tally';
    return;
  }

  tally.hidden = false;
  // Only count what the cadet has actually entered. Components still blank are
  // standing in as DNS, and their zeros are not a score anyone has earned yet.
  const tenths = [...ready].reduce(
    (acc, c) => acc + Math.round(result.components[c].points * 10), 0);
  animateTo(score, tenths / 10);

  const remaining = COMPONENTS.length - ready.size;
  if (remaining > 0) {
    const missing = COMPONENTS.filter((c) => !ready.has(c))
      .map((c) => COMPONENT_LABELS[c].toLowerCase());
    text.textContent = `so far · still need ${missing.join(', ')}`;
    tally.className = 'tally';
  } else {
    text.textContent = `${result.rating} · tap for the breakdown`;
    tally.className = `tally ${result.pass ? 'is-pass' : 'is-fail'}`;
  }
}

/**
 * Roll the number rather than snapping it, unless motion is unwelcome.
 *
 * The roll is decoration. A timer backstops it so the true value always lands,
 * because requestAnimationFrame stops firing while a tab is in the background
 * and a half-finished count would leave a wrong score on screen.
 */
const DURATION = 260;

function animateTo(node, value) {
  const from = Number(node.dataset.value ?? value);
  node.dataset.value = String(value);

  const settle = () => {
    if (node.dataset.value === String(value)) node.textContent = value.toFixed(1);
  };

  if (motion() === 'auto' || from === value) {
    settle();
    return;
  }

  clearTimeout(Number(node.dataset.guard));
  node.dataset.guard = String(setTimeout(settle, DURATION + 60));

  const started = performance.now();
  const tick = (now) => {
    if (node.dataset.value !== String(value)) return; // superseded by a newer value
    const progress = Math.min(1, (now - started) / DURATION);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = (from + (value - from) * eased).toFixed(1);
    if (progress < 1) requestAnimationFrame(tick);
    else settle();
  };
  requestAnimationFrame(tick);
}

// --- rendering the breakdown ----------------------------------------------

function renderScoreboard(result) {
  const board = $('scoreboard');
  board.classList.toggle('is-pass', result.pass);
  board.classList.toggle('is-fail', !result.pass);
  $('composite').textContent = result.compositeText;
  // AFMAN 36-2905 para 3.6.1 names the three categories. Unsatisfactory is the
  // failing one, so the badge carries the pass or fail colour without printing
  // the words "pass" or "fail".
  $('verdict').textContent = result.rating;
  $('band').textContent =
    `${result.sex === 'M' ? 'Male' : 'Female'}, ${result.ageBandLabel} · ` +
    `${result.passingComposite.toFixed(1)} needed to pass`;

  setMeter('meter-composite', result.composite, 100,
    result.pass ? 'is-pass' : 'is-fail', result.passingComposite);
  $('meter-legend').textContent =
    `${result.composite.toFixed(1)} of 100 · the mark is ` +
    `${result.passingComposite.toFixed(1)}`;

  // One line of targeting, which is the point of building this over the public
  // calculators. Only shown on a fail: a passing cadet does not need advice.
  const line = $('gap-line');
  if (result.pass) {
    line.hidden = true;
  } else {
    line.textContent = analyzer.analyzeGap(result).summary;
    line.hidden = false;
  }
}

function renderFailures(result) {
  const card = $('failures');
  const list = $('failure-list');
  list.replaceChildren();
  if (result.pass) {
    card.hidden = true;
    return;
  }
  for (const failure of result.failures) list.append(el('li', null, failure.message));
  card.hidden = false;
}

function renderWarnings(result) {
  const card = $('warnings-card');
  const list = $('warning-list');
  list.replaceChildren();
  if (result.warnings.length === 0) {
    card.hidden = true;
    return;
  }
  for (const warning of result.warnings) list.append(el('li', null, warning));
  card.hidden = false;
}

function renderComponents(result) {
  const host = $('components');
  host.replaceChildren();

  for (const key of COMPONENTS) {
    const component = result.components[key];
    const failed = component.status !== 'scored' && component.status !== 'exempt';
    const short = component.status === 'scored' && !component.meetsMinimum;

    const row = el('div', `component${failed || short ? ' failed' : ''}`);

    const head = el('div', 'component-head');
    const names = el('div');
    names.append(el('div', 'component-name', component.componentLabel));
    names.append(el('div', 'component-event', component.eventLabel));
    head.append(names);

    const points = el('div', 'component-points');
    points.append(document.createTextNode(component.points.toFixed(1)));
    points.append(el('span', 'of', ` / ${component.maxPoints.toFixed(0)}`));
    head.append(points);
    row.append(head);

    if (failed) {
      row.append(el('span', 'flag', component.status === 'below_minimum'
        ? 'below minimum' : component.status.toUpperCase()));
    } else if (short) {
      row.append(el('span', 'flag', 'below minimum'));
    }

    if (component.chartRowLabel) {
      row.append(el('div', 'chart-row', `Chart row: ${component.chartRowLabel}`));
    }
    // The next threshold is already on screen as the component's range, so this
    // panel sticks to the audit trail: what was measured, and what it scored.
    row.append(el('div', 'component-why', component.explanation));
    host.append(row);
  }
}

function describeReach(rung) {
  if (rung.reach.reps != null) return `${rung.reach.reps} reps`;
  if (rung.reach.time != null) return `${rung.reach.time} or faster`;
  if (rung.reach.waistInches != null) {
    return `a ${rung.reach.waistInches.toFixed(1)} inch waist`;
  }
  return `a ratio of ${rung.reach.ratio.toFixed(2)}`;
}

function describeEffort(rung) {
  if (rung.distance.reps != null) {
    return `${rung.distance.reps} more rep${rung.distance.reps === 1 ? '' : 's'}`;
  }
  if (rung.distance.seconds != null) {
    return `${rung.distance.seconds} second${rung.distance.seconds === 1 ? '' : 's'} faster`;
  }
  const hundredths = Math.round(rung.distance.ratio * 100);
  return `${hundredths} hundredth${hundredths === 1 ? '' : 's'} off the ratio`;
}

function onPlan() {
  if (!lastResult) return;
  const errorNode = $('target-error');
  errorNode.hidden = true;

  const target = Number($('target').value);
  if (!Number.isFinite(target) || target < 0 || target > 100) {
    errorNode.textContent = 'Pick a target composite between 0 and 100.';
    errorNode.hidden = false;
    return;
  }

  const host = $('target-plans');
  host.replaceChildren();

  let plan;
  try {
    plan = analyzer.planForTarget(lastResult, target);
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    return;
  }

  if (!plan.reachable) {
    host.append(el('p', 'card-intro',
      plan.note ?? `${target.toFixed(1)} is out of reach from this assessment.`));
    return;
  }

  for (const entry of plan.plans) {
    const box = el('div', 'plan');
    box.append(el('div', 'plan-kind', {
      already_there: 'Already there',
      single_component: 'One component does it',
      spread: 'Shared across components'
    }[entry.kind] ?? entry.kind));

    if (entry.steps.length === 0) {
      box.append(el('p', null, entry.label));
    } else {
      const list = el('ul');
      for (const step of entry.steps) {
        list.append(el('li', null,
          `${step.eventLabel}: ${describeEffort(step.rung)} ` +
          `— reach ${describeReach(step.rung)} for ${step.rung.points.toFixed(1)} points`));
      }
      box.append(list);
      box.append(el('p', 'plan-total', `Reaches ${entry.total.toFixed(1)}.`));
    }
    host.append(box);
  }
}

function renderReferences(result) {
  const host = $('reference-list');
  host.replaceChildren();

  for (const reference of result.references) {
    const box = el('div', 'reference');
    const sourceName = {
      'pfra-charts': 'PFRA Scoring charts',
      'notacc-cy26-092': 'NOTACC CY26-092'
    }[reference.source] ?? 'AFMAN 36-2905';
    box.append(el('span', 'reference-id', `${sourceName} · ${reference.paragraph}`));
    box.append(el('span', 'reference-text', reference.text));
    host.append(box);
  }

  const pub = el('div', 'reference');
  pub.append(el('span', 'reference-id', result.publication.title));
  const link = document.createElement('a');
  link.href = result.publication.url;
  link.textContent = 'Read it on e-Publishing';
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  pub.append(link);
  host.append(pub);
}

/**
 * Open the folded panels while printing, then put them back.
 *
 * CSS cannot open a <details>, and a printed record with its working folded
 * away would be useless to a scorer checking a lookup.
 */
function setupPrinting() {
  let reopened = [];

  const expand = () => {
    reopened = [...document.querySelectorAll('details.foldable')].filter((d) => !d.open);
    for (const panel of reopened) panel.open = true;
  };
  const restore = () => {
    for (const panel of reopened) panel.open = false;
    reopened = [];
  };

  window.addEventListener('beforeprint', expand);
  window.addEventListener('afterprint', restore);

  // Safari and some older engines only fire the media query, not the events.
  const query = window.matchMedia('print');
  query.addEventListener?.('change', (event) => (event.matches ? expand() : restore()));
}

// --- reference documents ---------------------------------------------------

/**
 * Wire up the document list.
 *
 * A PDF only gets an inline viewer if a browser can actually render it. The
 * scoring charts can. The two AF forms are XFA (Adobe LiveCycle) documents,
 * which no browser renders — they show only their own "requires Adobe Reader"
 * placeholder — so they are download-only until a flattened copy exists.
 *
 * If one does, `data-flat` points at it and this picks it up: the download
 * switches to the flattened file and the View button appears. Nothing here
 * needs changing when that happens; just drop the file into references/.
 */
async function setupDocuments() {
  for (const doc of document.querySelectorAll('.document')) {
    const link = doc.querySelector('.doc-link');
    const flat = doc.querySelector('.doc-flat');
    const toggle = doc.querySelector('.view-toggle');
    const viewer = doc.querySelector('.viewer');
    const note = doc.querySelector('.document-note');

    // A row with no View button is download-only by design: see the comment on
    // the manual in index.html. Nothing below applies to it.
    if (!toggle) continue;

    // The scoring charts have no flattened twin; they render as published.
    if (!flat) {
      toggle.hidden = false;
      toggle.addEventListener('click', () => toggleViewer(toggle, viewer, link.href));
      continue;
    }

    if (await exists(flat.getAttribute('href'))) {
      flat.hidden = false;
      toggle.hidden = false;
      note.textContent += ' Fillable opens in Adobe Reader; the flat copy reads ' +
        'in any browser but cannot be filled in.';
      toggle.addEventListener('click', () => toggleViewer(toggle, viewer, flat.href));
    } else {
      note.textContent += ' Opens in Adobe Reader, not in a browser.';
    }
  }
}

/** A HEAD request is enough, and a data: URI in the offline build always passes. */
async function exists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

function toggleViewer(toggle, viewer, src) {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  if (open) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'View';
    viewer.hidden = true;
    viewer.replaceChildren();
    return;
  }

  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = 'Reference document';
  frame.loading = 'lazy';
  viewer.replaceChildren(frame);
  viewer.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = 'Hide';
}

boot().catch((error) => {
  document.body.prepend(Object.assign(document.createElement('p'), {
    className: 'error',
    style: 'padding:16px',
    textContent: `The calculator could not load its scoring tables: ${error.message}`
  }));
});
