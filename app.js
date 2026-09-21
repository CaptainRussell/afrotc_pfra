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
} from './src/engine.js?v=bcb70072b5';
import { createAnalyzer } from './src/analysis.js?v=bcb70072b5';
import { VERBIAGE, VERBIAGE_SOURCE, verbiageFor } from './src/verbiage.js?v=bcb70072b5';

const $ = (id) => document.getElementById(id);

let scorer = null;
let analyzer = null;
let lastResult = null;
let sex = null;
let ageBand = null;

/**
 * Who is being assessed.
 *
 * The charts do not change; what changes is what the member is allowed to do.
 * Cadets test on the three AFROTC events and are not authorised exemptions on
 * any component (AFROTCI 36-2011 V3: the most recent PFRA "with no exemptions"
 * is required before contracting, field training and commissioning). Cadre and
 * staff may be on a profile, may be assessed on an alternate event, and may
 * have a component exempted.
 *
 * Altitude is not gated by this. Attachment 3 is a property of where the
 * assessment was run, not of who ran it.
 */
let role = null;

/** Per component: a measurement, a declared non-completion, or nothing yet. */
const statuses = {
  body_composition: null, muscular_strength: null, core_endurance: null,
  cardiorespiratory: null
};

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
    show: ['cardio-shuttles'], hide: ['cardio-time'], field: 'hamr', kind: 'shuttles' },
  // The same mm:ss control the run uses. What differs is what the number means:
  // a walk time is measured against a maximum, not looked up for points.
  walk_2km: {
    show: ['cardio-time'], hide: ['cardio-shuttles'],
    field: ['run-min', 'run-sec'], kind: 'walk' }
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
  const data = await fetch('./pfra-scoring-data.json?v=bcb70072b5').then((r) => r.json());
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
  fillAltitudeOptions();
  showRoleControls();
  for (const button of document.querySelectorAll('.segment[data-role]')) {
    button.addEventListener('click', () => selectRole(button.dataset.role));
  }
  wireBfa();
  for (const button of document.querySelectorAll('.exempt-toggle')) {
    button.addEventListener('click', () => {
      const component = button.dataset.exempt;
      setExempt(component, statuses[component] !== 'exempt');
      update();
    });
  }
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
  // [data-component] only: the BFA tracks are .slider for the look of them but
  // they measure a member rather than score one, so wireBfa drives those.
  for (const slider of document.querySelectorAll('.slider[data-component]')) {
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
  $('altitude-toggle').addEventListener('click', () => {
    const panel = $('altitude-panel');
    if (panel.hidden) {
      panel.hidden = false;
      $('altitude-toggle').setAttribute('aria-expanded', 'true');
      $('altitude-group').focus();
    } else {
      closeAltitudePanel();
    }
  });
  $('altitude-group').addEventListener('change', () => {
    update();
    closeAltitudePanel();
  });

  for (const button of document.querySelectorAll('.chart-toggle')) {
    button.addEventListener('click', () => {
      const component = button.dataset.chart;
      if (chartOpen.has(component)) chartOpen.delete(component);
      else chartOpen.add(component);
      renderCharts(ageBand);
    });
  }
  for (const button of document.querySelectorAll('.verbiage-open')) {
    button.addEventListener('click', () => openVerbiage(button.dataset.verbiage));
  }
  // Clicking the backdrop is the other way people expect to dismiss a modal.
  $('verbiage').addEventListener('click', (e) => {
    if (e.target === $('verbiage')) $('verbiage').close();
  });
  for (const button of document.querySelectorAll('.not-done')) {
    button.addEventListener('click', () => toggleNotFinished(button.dataset.statusFor));
  }

  // Typing two digits into minutes should land you in seconds without a tap.
  advanceOnFull('run-min', 'run-sec', 2);
  advanceOnFull('plank-min', 'plank-sec', 1);

  $('plan-button').addEventListener('click', onPlan);
  $('tally-button').addEventListener('click', () => {
    $('scoreboard').scrollIntoView({ behavior: motion(), block: 'start' });
  });
  // Scoped to [data-swap], not to .swap: the Altitude control borrows the same
  // class for its looks and would otherwise be wired up as an event picker for
  // a component named "undefined".
  for (const button of document.querySelectorAll('.swap[data-swap]')) {
    button.addEventListener('click', () => {
      const component = button.dataset.swap;
      if ($(`event-${component}`).hidden) openPicker(component);
      else closePicker(component);
    });
  }
  // Scoped to [data-component] for the same reason the swap buttons are scoped
  // to [data-swap]: the Altitude panel reuses .event-picker for its looks, and
  // its change event would otherwise be handled as an event swap for a
  // component named "undefined".
  for (const select of document.querySelectorAll('.event-picker select[data-component]')) {
    select.addEventListener('change', () => selectEvent(select.dataset.component,
      select.value));
  }

  $('reset-all').addEventListener('click', resetAll);
  setupPrinting();

  setupDocuments();
  showEventDocs();
  showNotFinished();

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

/**
 * The four altitude blocks, straight from the data file.
 *
 * Built rather than written into the markup so that the list a cadre member
 * picks from and the table the engine reads cannot drift apart.
 */
function fillAltitudeOptions() {
  const select = $('altitude-group');
  for (const group of scorer.data.altitude_correction.groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = `${group.label} · ${group.range_label}`;
    select.append(option);
  }
}

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

/** Mirrors closePicker: choosing is the end of the errand, so it folds away. */
function closeAltitudePanel() {
  const panel = $('altitude-panel');
  const toggle = $('altitude-toggle');
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  // Focus would otherwise sit on a control that is no longer on screen.
  if (panel.contains(document.activeElement)) toggle.focus();
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
  const field = fieldOf(component);
  if (field) setStatus(field, null);
  for (const id of [control.field].flat()) $(id).value = '';

  $(`heading-${component}`).textContent = EVENT_LABELS[event];
  showEventDocs();
  showNotFinished();
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
    // the sentence stays correct whether X is singular or plural. For cadre the
    // alternate is simply an authorised event, so the warning becomes a note.
    note.textContent = role !== 'cadre'
      ? `AFROTC cadets are not tested on ${EVENT_PHRASES[event]}. NOTACC CY26-092 ` +
        'sets the cadet assessment as hand-release push-ups, sit-ups and the 2 mile ' +
        'run, exclusively, from Academic Year 2026-2027. Cadre/Staff reference only.'
      : `Scored on ${EVENT_PHRASES[event]}, authorised by DAFMAN 36-2905 for ` +
        'active duty members. (For cadre/staff selection)';
    note.hidden = false;
  }
}

/**
 * Reference sheets that only matter for one exercise.
 *
 * The HAMR tally sheet is how an administrator records shuttles, so it appears
 * with the component the moment HAMR is chosen and goes away again otherwise.
 */
/**
 * Did-not-finish is offered only where finishing is a thing you can fail to do.
 *
 * A member can leave a 2 mile run or a 2 kilometre walk part-way through. There
 * is no equivalent for push-ups, sit-ups or a waist measurement: stopping early
 * is simply a lower count, which is what the verbiage says gets recorded.
 */
function showNotFinished() {
  const event = events.cardiorespiratory;
  const wanted = event === 'run_2mile' || event === 'walk_2km';
  const button = $('dnf-run');
  // Switching to the HAMR while a DNF is set would strand it out of reach.
  if (!wanted && statuses.cardiorespiratory === 'dnf') setStatus('run', null);
  button.hidden = !wanted;
}

function showEventDocs() {
  const wanted = events.cardiorespiratory === 'hamr_20m';
  // The tally sheet and the pacing audio both belong to the HAMR and nothing
  // else, so they appear and disappear together.
  for (const id of ['doc-hamr', 'doc-hamr-audio']) {
    const doc = $(id);
    if (!wanted && !doc.hidden) {
      // Collapse the viewer too, or it would reopen already expanded later.
      const toggle = doc.querySelector('.view-toggle');
      if (toggle && toggle.getAttribute('aria-expanded') === 'true') toggle.click();
    }
    doc.hidden = !wanted;
  }
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
/**
 * Did not finish, on or off.
 *
 * It used to cycle through "did not start" as well. That is not a result anyone
 * records: a member who never started an event has no score to enter, and one
 * who stopped part-way through push-ups simply has fewer push-ups -- which is
 * what the verbiage says is recorded. The engine can still represent DNS, so
 * a score arriving from elsewhere does not break, but nothing here produces it.
 */
function toggleNotFinished(field) {
  setStatus(field, statuses[componentOf(field)] === 'dnf' ? null : 'dnf');
  update();
}

function setStatus(field, value) {
  const component = componentOf(field);
  statuses[component] = value;

  // Not every component has a Did Not Finish control any more -- only the run
  // and the walk do -- so clearing a status on one that does not is a no-op
  // rather than a crash. selectEvent clears the status on every swap, which is
  // how this first showed up.
  const note = $(`status-${field}`);
  const button = document.querySelector(`.not-done[data-status-for="${field}"]`);
  if (!button || !note) return;

  const inputs = field === 'run' ? ['run-min', 'run-sec'] : [field];

  if (value) {
    note.textContent =
      'Recorded as did not finish. Scores 0 and fails the component.';
    note.hidden = false;
    button.classList.add('on');
    for (const id of inputs) {
      $(id).value = '';
      $(id).disabled = true;
    }
  } else {
    note.hidden = true;
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
/**
 * Put the page back to how it loads.
 *
 * Not a reload: nothing here is persisted, so a reload would only cost a flash
 * and a round trip to prove it. This restores each piece of state instead.
 *
 * "Back to default" is the kind of claim that quietly stops being true as soon
 * as somebody adds a control and forgets this function exists, so it was
 * checked by snapshotting twenty-odd pieces of page state on a fresh load,
 * dirtying every one of them, resetting, and diffing. That found exactly one
 * leak, which is fixed in update(): the Altitude button kept its label.
 * Re-run that check when adding a control here.
 */
function resetAll() {
  // Who and what: the three answers that gate everything else.
  role = null;
  sex = null;
  ageBand = null;
  for (const button of document.querySelectorAll('.segment[data-role], ' +
    '.segment[data-sex], .segment[data-band]')) {
    button.classList.remove('on');
    button.setAttribute('aria-checked', 'false');
  }
  $('band-picker').hidden = true;
  $('age-band').value = '';
  $('role-hint').textContent = ROLE_PROMPT;

  // Statuses before fields: clearing an exemption re-enables the inputs it
  // disabled, and doing it the other way round leaves them disabled.
  for (const component of COMPONENTS) {
    if (statuses[component] === 'exempt') setExempt(component, false);
    const field = fieldOf(component);
    if (field) setStatus(field, null);
    statuses[component] = null;
  }

  for (const [component, fallback] of [
    ['muscular_strength', 'hand_release_pushup'],
    ['core_endurance', 'situp'],
    ['cardiorespiratory', 'run_2mile']
  ]) {
    if (events[component] !== fallback) {
      $(`event-select-${component}`).value = fallback;
      selectEvent(component, fallback);
    }
    closePicker(component);
  }

  for (const id of ['hrpu', 'situp', 'run-min', 'run-sec', 'plank-min', 'plank-sec',
    'hamr', 'height', 'waist']) {
    $(id).value = '';
    $(id).disabled = false;
  }

  resetBfa();
  $('altitude-group').value = '';
  closeAltitudePanel();

  for (const component of COMPONENTS) chartOpen.delete(component);
  $('verbiage').close();
  for (const details of document.querySelectorAll('.pretest, .foldable')) {
    details.open = false;
  }

  lastResult = null;
  $('results').hidden = true;
  $('results').classList.remove('revealed');
  $('target-plans').replaceChildren();
  $('target-error').hidden = true;

  showRoleControls();
  update();
  window.scrollTo({ top: 0, behavior: motion() });
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

  // Role gates scoring the way age and sex do. It changes no number, but it
  // decides what the page may offer, and a cue that points at a question the
  // form will happily skip past is not a guide.
  if (!role || !ageBand || !sex) {
    return { input: null, ready };
  }

  const input = { ageBand, sex };

  // One altitude for the whole assessment: it is a property of where the test
  // was administered, not of any one event.
  const group = $('altitude-group').value;
  if (group) input.altitudeGroup = group;

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

    if (control.kind === 'hold' || control.kind === 'time' || control.kind === 'walk') {
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

  if (statuses.body_composition) {
    input.body_composition = { event: 'whtr', status: statuses.body_composition };
    ready.add('body_composition');
  } else if (height && waist) {
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

/**
 * What to glow for a component that still needs a number.
 *
 * The slider, not the whole block. Dragging is the quickest way to put a score
 * in, and a ring around an entire card does not say which of the three controls
 * inside it to reach for.
 *
 * Body composition has two sliders and they are not interchangeable: the waist
 * one cannot be bounded until a height is known, because the inches that earn
 * full marks depend on it. So height leads, and the waist follows once height
 * is in.
 *
 * Falls back to the whole block when there is no slider to point at: a
 * component marked exempt or did-not-finish has its slider hidden, and a ring
 * around nothing would be worse than a ring around the card.
 */
function cueTargetFor(component) {
  const row = component === 'body_composition'
    ? (decimal('height') == null ? $('slider-height') : $('slider-body_composition'))
    : $(`slider-${component}`);
  return row && !row.hidden
    ? row
    : document.querySelector(`.event[data-component="${component}"]`);
}

function showCue(ready) {
  let target = null;

  if (!role) {
    // Who is being assessed comes first: it decides what the rest of the form
    // is allowed to offer.
    target = $('field-role');
  } else if (!ageBand) {
    // Tapping "25 or older" answers the age question but does not settle the
    // band, so the cue moves to the dropdown that still has to be answered.
    target = $('band-picker').hidden ? $('field-age') : $('band-picker');
  } else if (!sex) {
    target = $('field-sex');
  } else {
    // The cue follows COMPONENTS, which is the order the assessment is
    // administered in. One list, so the glow cannot drift out of step with
    // the order the sections are actually in.
    const next = COMPONENTS.find((component) => !ready.has(component));
    if (next) target = cueTargetFor(next);
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

  // These three describe the form rather than the score, so they run whether or
  // not there is one. Leaving them below the early return meant the Altitude
  // button kept reading "Altitude - Group 3" after a Reset had cleared the
  // group, because clearing the role made the assessment unscoreable and this
  // function returned before reaching them.
  showAltitudeGroup();
  showHamrLevel();
  // The alternate-exercise warning is worded differently for a cadet and for
  // cadre, so it depends on the role as much as on the event. It used to be
  // refreshed only when the event changed, which left a cadre member reading
  // "AFROTC cadets are not tested on push-ups" after switching across.
  showAltNotes();

  if (!input) {
    for (const component of COMPONENTS) resetChip(component);
    lastResult = null;
    renderCharts(ageBand);
    showAltitudeApplied(null);
    showRatio(null);
    showBfa(null, false);
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

  // After the score, not before: the chart marks the row this result landed on,
  // and reading lastResult first would mark the previous one.
  renderCharts(ageBand);

  const complete = ready.size === COMPONENTS.length;

  for (const component of COMPONENTS) {
    if (ready.has(component)) fillChip(component, result.components[component]);
    else resetChip(component);
  }

  showTally(result, ready);
  showAltitudeApplied(lastResult);
  showRatio(lastResult);
  showBfa(lastResult, complete);

  if (!complete) {
    $('results').hidden = true;
    $('award-line').hidden = true;
    return;
  }

  renderScoreboard(result);
  renderFailures(result);
  renderWarnings(result);
  renderReferences(result);
  showAward(result);

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

/**
 * Show an applied altitude correction as the conversion it is.
 *
 * It used to be tacked onto the end of the chart-row line, in the same small
 * monospace as everything else, which is where a number that silently changed
 * the score is least likely to be read. It gets its own strip: the two values
 * and an arrow between them, because "14:49 became 14:47" is the whole fact and
 * a sentence is a slower way to say it.
 *
 * For the run and the HAMR the member's number moves. For the walk it does not
 * -- the standard moves instead -- so the strip says which.
 */
function showAltitudeApplied(result) {
  const strip = $('altitude-applied');
  const scored = result?.components?.cardiorespiratory;
  const altitude = scored?.altitude ?? null;

  if (!altitude) {
    strip.hidden = true;
    return;
  }

  $('altitude-applied-tag').textContent =
    `${altitude.groupLabel} · ${altitude.rangeLabel}`;
  $('altitude-from').textContent = altitude.fromLabel;
  $('altitude-to').textContent = altitude.toLabel;
  $('altitude-applied-detail').textContent = altitude.kind === 'standard'
    ? `${altitude.detail}, so the time you walked is scored against the later one.`
    : `${altitude.detail}, and the chart is read on the corrected figure.`;
  strip.classList.toggle('is-standard', altitude.kind === 'standard');
  strip.hidden = false;
}

/* --- the scoring chart, in line --------------------------------------------
 *
 * The same table the score came from, on the same screen as the score, so a
 * cadet can check the lookup instead of taking it on trust. It is folded away
 * by default: it is a validation reference, not something to read every time.
 *
 * The row the cadet actually landed on is marked. That is the whole point --
 * a 26 row table proves nothing on its own, and finding your own row in it is
 * exactly the error-prone step the tool exists to remove. `chartRowIndex`
 * comes from the engine, so the highlight cannot disagree with the score.
 */
const chartOpen = new Set();

function renderCharts(band) {
  for (const component of COMPONENTS) {
    const host = $(`chart-body-${component}`);
    const toggle = document.querySelector(`.chart-toggle[data-chart="${component}"]`);
    const event = events[component] ?? 'whtr';

    // Without a sex and a band there is no chart to show: the tables differ by
    // both, and showing the wrong one would be worse than showing none.
    if (!sex || !band) {
      toggle.disabled = true;
      toggle.textContent = 'Scoring Chart';
      host.replaceChildren();
      host.hidden = true;
      chartOpen.delete(component);
      toggle.setAttribute('aria-expanded', 'false');
      continue;
    }
    toggle.disabled = false;

    if (!chartOpen.has(component)) {
      host.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Scoring Chart';
      continue;
    }

    const chart = scorer.chartFor({
      component, event, sex, band,
      heightInches: component === 'body_composition' ? (decimal('height') || null) : null
    });
    if (!chart) {
      host.hidden = true;
      continue;
    }

    const scored = lastResult?.components?.[component] ?? null;
    const currentIndex = scored && scored.status !== 'exempt'
      ? scored.chartRowIndex : -1;

    host.replaceChildren(buildChartTable(chart, currentIndex, component));
    host.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = 'Hide Chart';

    // Bring the marked row into view inside the scrolling table, so a cadet
    // does not have to hunt for the thing that was highlighted for them.
    const marked = host.querySelector('.chart-current');
    if (marked) marked.scrollIntoView({ block: 'nearest' });
  }
}

function buildChartTable(chart, currentIndex, component) {
  const table = el('table', 'chart-table');
  const caption = el('caption', null,
    `${EVENT_LABELS[chart.event]} · ${sex === 'M' ? 'Male' : 'Female'}, ` +
    `${scorer.data.age_band_ranges[ageBand]}`);
  table.append(caption);

  const head = el('thead');
  const headRow = el('tr');
  for (const column of chart.columns) headRow.append(el('th', null, column));
  head.append(headRow);
  table.append(head);

  const body = el('tbody');
  for (const row of chart.rows) {
    const tr = el('tr', row.index === currentIndex ? 'chart-current' : null);
    if (row.index === currentIndex) tr.setAttribute('aria-current', 'true');
    if (row.isMinimum) tr.classList.add('chart-minimum');

    tr.append(el('th', 'chart-measure', row.label));
    if (row.detail != null) tr.append(el('td', 'chart-detail', row.detail));
    tr.append(el('td', 'chart-points',
      row.resultLabel ?? `${row.points.toFixed(1)}`));
    body.append(tr);
  }
  table.append(body);
  return table;
}

/**
 * Say the waist to height ratio out loud.
 *
 * It is the number the chart is actually read on, and it was living in the
 * small monospace lookup line at the bottom of the card, which is the least
 * likely place for a cadet to find the one figure their body composition score
 * turns on.
 *
 * The working is shown with it because two roundings sit between what gets
 * typed and what gets graded, and the second one is the subtlest rule in the
 * tool: the ratio is *truncated* to two decimals, not rounded (para 3.15.4.2).
 * Showing the undivided figure alongside the truncated one is enough to make
 * that visible; saying what rounding would have given as well was noise on
 * every reading where it made no difference.
 */
function showRatio(result) {
  const readout = $('ratio-readout');
  const scored = result?.components?.body_composition ?? null;
  const measured = scored?.measured ?? null;

  if (!measured || measured.ratio == null || scored.status === 'exempt') {
    readout.hidden = true;
    return;
  }

  $('ratio-value').textContent = measured.ratio.toFixed(2);

  if (measured.waistInches == null || measured.exactRatio == null) {
    $('ratio-working').textContent = 'Graded on this ratio.';
    readout.hidden = false;
    return;
  }

  $('ratio-working').textContent =
    `${measured.waistInches.toFixed(1)} in waist ÷ ` +
    `${measured.heightInches.toFixed(1)} in height = ` +
    `${measured.exactRatio.toFixed(4)}, truncated to two decimals.`;
  readout.hidden = false;
}

/**
 * Whether this score would earn the AFROTC Fitness Award.
 *
 * A cadet award, so it is shown only in cadet mode. It is written as a
 * condition rather than an announcement -- "if this is your official PFRA for
 * the term" -- because the tool cannot know whether a given assessment is the
 * official one, nor whether the cadet has already had the award this term or
 * the device at this detachment. Those are detachment records.
 */
function showAward(result) {
  const line = $('award-line');
  if (role !== 'cadet' || !result) {
    line.hidden = true;
    return;
  }

  const award = scorer.fitnessAward(result);
  if (!award.meetsThreshold) {
    line.hidden = true;
    return;
  }

  if (!award.eligible) {
    // Worth saying: the number is there but something else rules it out, and
    // silence would read as the tool not knowing about the award.
    line.textContent =
      `${result.compositeText} is at or above ${award.threshold}, but it would not ` +
      `earn the Fitness Award: ${award.blockers.join(', and ')} ` +
      '(AFROTCI 36-2011 V3, Table 15.1).';
    line.className = 'award-line award-blocked';
    line.hidden = false;
    return;
  }

  line.textContent = award.tier === 'silver_star'
    ? `A perfect ${result.compositeText}. If this is your official PFRA for the term ` +
      'it earns the Fitness Award, and the Silver Star device the first time you ' +
      'score 100 at the detachment (AFROTCI 36-2011 V3, Table 15.1).'
    : `${result.compositeText} is ${award.threshold} or above. If this is your ` +
      'official PFRA for the term it earns the Fitness Award, which may be received ' +
      'once per term (AFROTCI 36-2011 V3, Table 15.1).';
  line.className = `award-line award-earned${award.tier === 'silver_star' ? ' award-star' : ''}`;
  line.hidden = false;
}

/**
 * Say the shuttle count the way the tally sheet says it.
 *
 * The chart scores a raw cumulative count. Nobody works in those: an
 * administrator marks a grid of levels and the recording announces them. Both
 * numbers describe the same run, so both are on screen.
 */
function showHamrLevel() {
  const note = $('hamr-level');
  if (events.cardiorespiratory !== 'hamr_20m') {
    note.hidden = true;
    return;
  }
  const count = wholeNumber('hamr');
  const place = count == null ? null : scorer.hamrLevel(count);
  if (!place) {
    note.textContent = count == null
      ? 'Recorded as a cumulative shuttle count. The tally sheet shows the level.'
      : `${count} shuttles is past the end of the printed tally sheet.`;
  } else {
    note.textContent =
      `Shuttle ${count} is level ${place.level}, shuttle ${place.shuttleInLevel} ` +
      'on the tally sheet.';
  }
  note.hidden = false;
}

/**
 * Say which altitude group the typed elevation falls in.
 *
 * "No correction applies" and "a correction of zero" are different things, so
 * below 5,250 feet this says so rather than showing a group with nothing in it.
 */
function showAltitudeGroup() {
  const note = $('altitude-note');
  const toggle = $('altitude-toggle');
  const chosen = $('altitude-group').value;
  const group = chosen
    ? scorer.data.altitude_correction.groups.find((g) => g.id === chosen) : null;

  if (!group) {
    note.textContent =
      'DAFMAN 36-2905 Attachment 3. No correction applies below 5,250 feet, ' +
      'and none applies at Field Training whatever the elevation (2023 AFROTC ' +
      'Supplement para 5.5.7, awaiting revision). Det 250 assesses at Ames, ' +
      'about 955 feet.';
    note.classList.remove('altitude-on');
    toggle.textContent = 'Altitude';
    toggle.classList.remove('on');
    return;
  }

  note.textContent = `${group.label}, ${group.range_label}. Attachment 3 applies ` +
    'to the cardiorespiratory component.';
  note.classList.add('altitude-on');
  // The button says so too, because the panel folds away and a correction left
  // switched on is the kind of thing that quietly changes every later score.
  toggle.textContent = `Altitude · ${group.label}`;
  toggle.classList.add('on');
}

/* --- who is being assessed ------------------------------------------------ */

/** Shown until the question is answered. Kept beside index.html's copy. */
const ROLE_PROMPT =
  'Start here. This decides which components you are assessed on and what the ' +
  'rest of the form offers.';

function selectRole(value) {
  role = value;
  for (const button of document.querySelectorAll('.segment[data-role]')) {
    const on = button.dataset.role === value;
    button.classList.toggle('on', on);
    button.setAttribute('aria-checked', String(on));
  }

  // An exemption claimed as cadre must not survive a switch back to cadet: it
  // would sit there scoring nothing and failing nothing, for a member who is
  // not authorised one.
  if (role === 'cadet') {
    for (const component of COMPONENTS) {
      if (statuses[component] === 'exempt') setExempt(component, false);
    }
  }

  $('role-hint').textContent = role === 'cadet'
    ? 'Four components, in this order: waist to height, hand-release push-ups, ' +
      'sit-ups and the 2 mile run. NOTACC CY26-092 sets all four exclusively, and ' +
      'AFROTCI 36-2011 V3 requires a most recent PFRA with no exemptions.'
    : role === 'cadre'
      ? 'Alternate events and component exemptions are available for active ' +
        'duty members.'
      : ROLE_PROMPT;

  showRoleControls();
  update();
}

/** Exempt is cadre-only; everything else stays where it is. */
function showRoleControls() {
  for (const button of document.querySelectorAll('.exempt-toggle')) {
    button.hidden = role !== 'cadre';
  }
}

/**
 * Mark a component exempt, or take the exemption off again.
 *
 * Exempt is not a score of zero: it leaves the component out of both sides of
 * the composite, so the rest is scored over what was actually assessed. The
 * measurement fields are cleared and disabled, the way a DNF does, because
 * there is no number left to keep.
 */
function setExempt(component, on) {
  // A DNF and an exemption are different claims about the same component, so
  // one clears the other rather than both being held at once.
  const field = fieldOf(component);
  if (on && field && statuses[component] === 'dnf') setStatus(field, null);

  statuses[component] = on ? 'exempt' : null;

  const button = document.querySelector(`.exempt-toggle[data-exempt="${component}"]`);
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', String(on));

  const note = $(`exempt-note-${component}`);
  note.textContent = on
    ? 'Exempt. Scores no points, fails nothing, and the composite is worked out ' +
      'over the components that were assessed.'
    : '';
  note.hidden = !on;

  for (const id of fieldsOf(component)) {
    if (on) $(id).value = '';
    $(id).disabled = on;
  }
}

/** Every input a component collects, whichever event it is set to. */
function fieldsOf(component) {
  if (component === 'body_composition') return ['height', 'waist'];
  const control = CONTROLS[events[component]];
  return Array.isArray(control.field) ? control.field : [control.field];
}

/* --- the secondary body fat assessment ------------------------------------
 *
 * DAFMAN 36-2905 para 3.15.4.7 calls for a BFA when a member's waist to height
 * ratio is 0.55 or higher and they are not meeting PFRA standards. Para 3.7.2
 * makes it pass or fail, and a pass has body composition scored as an exempt
 * component, which takes its 20 points out of the divisor. That is a score
 * change and not a footnote: a member whose other three components total
 * between 60.0 and 62.4 points fails on the ratio and passes on the BFA.
 *
 * The panel stays out of sight until the ratio reaches 0.55, which is the
 * only point at which any of this applies, and then says which of the two
 * states the member is in: already failing, so a BFA is required, or not yet
 * finished, so one may be.
 *
 * Applying the pass sets the component's status the way the Exempt button
 * does, but it leaves the height and waist fields alone, because the ratio
 * that triggered the BFA is still worth reading. The ratio is kept here for
 * the same reason: once the component is exempt the engine stops returning
 * one, and the panel would otherwise close the moment it was used. Editing
 * either measurement drops the applied state, so the kept ratio can never go
 * stale behind a changed waist.
 */

/** The ratio at which para 3.15.4.7 starts to apply. */
const BFA_RATIO = 0.55;

/**
 * What the BFA panel is holding, independent of the fields it came from.
 *
 * Tape is the default. Para 3.15.4.7 prefers the InBody where one is
 * available, but a detachment assessment is far more often run with a tape in
 * hand than beside a scale, so the method that is actually used is the one
 * that costs no tap.
 */
const bfa = { method: 'tape', applied: false, ratio: null };

/** The measurements the chosen method needs, or null if they are not all in. */
function bfaMeasurements(sexCode) {
  if (bfa.method === 'scale') {
    const percent = decimal('bfa-percent');
    return percent === null || percent === undefined || percent < 0
      ? null
      : { sex: sexCode, percent };
  }

  const neckInches = decimal('bfa-neck');
  if (!neckInches) return null;
  if (sexCode === 'M') {
    const abdomenInches = decimal('bfa-abdomen');
    return abdomenInches ? { sex: sexCode, neckInches, abdomenInches } : null;
  }
  const waistInches = decimal('bfa-waist');
  const buttocksInches = decimal('bfa-buttocks');
  return waistInches && buttocksInches
    ? { sex: sexCode, neckInches, waistInches, buttocksInches }
    : null;
}

/**
 * Show the BFA panel, and work the assessment if there is one to work.
 *
 * @param {object|null} result the current score, or null if unscoreable.
 * @param {boolean} complete whether all four components have been entered.
 */
function showBfa(result, complete) {
  const panel = $('bfa');
  const scored = result && result.components
    ? result.components.body_composition
    : null;

  // Keep the ratio that the engine last worked out. Once the BFA has exempted
  // the component the engine returns no ratio at all, and the panel has to go
  // on showing the number that put the member in front of it.
  if (scored && scored.measured && scored.measured.ratio != null) {
    bfa.ratio = scored.measured.ratio;
  } else if (!bfa.applied) {
    bfa.ratio = null;
  }

  if (bfa.ratio == null || bfa.ratio < BFA_RATIO) {
    if (bfa.applied) clearBfaExemption();
    panel.hidden = true;
    $('bfa-body').hidden = true;
    return;
  }

  panel.hidden = false;
  $('bfa-body').hidden = false;

  const failing = complete && result.pass === false;
  $('bfa-trigger').textContent = failing
    ? `A ratio of ${bfa.ratio.toFixed(2)} with an unsatisfactory composite requires a ` +
      'secondary body fat assessment (DAFMAN 36-2905 para 3.15.4.7). Passing it has ' +
      'body composition scored as exempt; failing it is an unsatisfactory PFRA.'
    : `A ratio of ${bfa.ratio.toFixed(2)} is at or above 0.55. If this assessment ` +
      'does not meet PFRA standards, a secondary body fat assessment is required ' +
      '(DAFMAN 36-2905 para 3.15.4.7).';

  showBfaFields(sex);
  renderBfaSliders();
  workBfa(sex);
}

/** Which measurement fields this member's BFA needs. */
function showBfaFields(sexCode) {
  const tape = bfa.method === 'tape';
  $('bfa-fields-scale').hidden = tape;
  $('bfa-fields-tape').hidden = !tape;
  $('bfa-field-abdomen').hidden = sexCode !== 'M';
  $('bfa-field-waist').hidden = sexCode === 'M';
  $('bfa-field-buttocks').hidden = sexCode === 'M';

  for (const button of document.querySelectorAll('.bfa-method')) {
    const on = button.dataset.bfaMethod === bfa.method;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }

  // Tape is the default, so its hint carries the line about the InBody that
  // the scale hint used to be the only place to read: a member who never taps
  // across still learns which method para 3.15.4.7 asks for first.
  $('bfa-method-hint').textContent = tape
    ? (sexCode === 'M'
      ? 'Attachment 8, two sites. The circumference value is the abdomen less the neck. '
      : 'Attachment 8, three sites. The circumference value is the waist plus the ' +
        'buttocks, less the neck. ') +
      'Use an InBody scale instead where one is available (para 3.15.4.7).'
    : 'Para 3.15.4.7 takes the BFA on an InBody bio-impedance scale where one is ' +
      'available and by tape where one is not. Either way a same sex administrator ' +
      'is required.';
}

/* The BFA tracks.
 *
 * Same affordance as the event sliders and the same look, but none of this is
 * a score: a tape measurement is read off a member, not off a chart, so there
 * are no chart bounds to take ends from and nothing about them depends on sex,
 * age band or the event. The bounds below are therefore declared, chosen to
 * cover the range a measurement actually lands in rather than the range the
 * field will accept. The fields stay wider on purpose, exactly as the height
 * field is wider than the height track: anything outside these ends can still
 * be typed, and the handle pins to the end when it is.
 *
 * Every track runs low to high, because every one of these measures inches or
 * percent directly. There is no mirroring to undo and no failing tip to shade:
 * a neck is not better for being bigger, and the pass or fail comes out of the
 * lookup below rather than off any one of these.
 */
const BFA_SLIDERS = Object.freeze({
  'bfa-percent': { step: 0.1, format: (v) => `${v.toFixed(1)} percent` },
  'bfa-neck': { step: 0.25, format: (v) => `${trimQuarter(v)} inches` },
  'bfa-abdomen': { step: 0.25, format: (v) => `${trimQuarter(v)} inches` },
  'bfa-waist': { step: 0.25, format: (v) => `${trimQuarter(v)} inches` },
  'bfa-buttocks': { step: 0.25, format: (v) => `${trimQuarter(v)} inches` }
});

/**
 * A quarter inch written the way a tape is read: 14.25, 14.5, 15, not 15.00.
 *
 * The step lands every value on a quarter already, so this is rounding off
 * float noise rather than the measurement.
 */
const trimQuarter = (v) => String(Math.round(v * 100) / 100);

/**
 * Seat each handle where its field already is.
 *
 * The ends live in the markup rather than here, because unlike every other
 * track on the page they are fixed: nothing the member selects can move them.
 * That leaves this reading min and max back off the element it is setting.
 */
function renderBfaSliders() {
  for (const [id, spec] of Object.entries(BFA_SLIDERS)) {
    const input = $(`slide-${id}`);
    if (dragging === `bfa:${id}`) continue;
    const min = Number(input.min);
    const max = Number(input.max);
    const current = decimal(id) ?? null;
    // Empty parks at the left, the same as every other track on the page.
    input.value = String(current == null ? min : Math.max(min, Math.min(max, current)));
    input.setAttribute('aria-valuetext',
      current == null ? 'not entered' : spec.format(current));
  }
}

/**
 * Write a dragged measurement into the field the assessment reads.
 *
 * Setting `.value` fires no input event, so the exemption that the field's own
 * listener would have dropped has to be dropped here: a BFA applied against
 * the old measurement must not survive a new one.
 */
function onBfaSliderInput(id) {
  const spec = BFA_SLIDERS[id];
  if (!spec) return;
  const raw = Number($(`slide-${id}`).value);
  $(id).value = id === 'bfa-percent' ? raw.toFixed(1) : trimQuarter(raw);
  $(`slide-${id}`).setAttribute('aria-valuetext', spec.format(raw));
  clearBfaExemption();
  update();
}

/** Run the assessment and say what it means for the score. */
function workBfa(sexCode) {
  const box = $('bfa-result');
  const note = $('bfa-note');
  const apply = $('bfa-apply');
  const measurements = bfaMeasurements(sexCode);

  if (!measurements) {
    if (bfa.applied) clearBfaExemption();
    box.hidden = true;
    note.hidden = true;
    apply.hidden = true;
    return;
  }

  let assessment;
  try {
    assessment = scorer.bodyFatAssessment({
      ...measurements,
      heightInches: decimal('height')
    });
  } catch (error) {
    // The fields are checked above, so a throw here is a measurement the
    // lookup cannot use rather than a half-typed one. Say which.
    box.hidden = false;
    $('bfa-verdict').textContent = 'Cannot work this one out yet.';
    $('bfa-verdict').className = 'bfa-verdict';
    $('bfa-working').textContent = error.message;
    note.hidden = true;
    apply.hidden = true;
    return;
  }

  box.hidden = false;
  $('bfa-verdict').textContent = assessment.pass
    ? `${assessment.percent}% body fat, within the ${assessment.standard}% standard.`
    : `${assessment.percent}% body fat, over the ${assessment.standard}% standard.`;
  $('bfa-verdict').className = `bfa-verdict ${assessment.pass ? 'pass' : 'fail'}`;
  $('bfa-working').textContent = assessment.measured.method === 'tape'
    ? `${assessment.measured.arithmetic} = ${assessment.measured.circumferenceValue}, ` +
      `read against ${assessment.measured.heightInches} inches.`
    : 'Taken from the scale, so there is no tape arithmetic to show.';

  const notes = [...assessment.warnings];
  if (role === 'cadet') {
    notes.push(
      'AFROTC has not yet said whether the secondary BFA reaches cadets. The 2023 ' +
      'supplement authorises no cadet exemptions at all and still measures body ' +
      'composition by BMI, and the revision that would settle it against the ' +
      'current DAFMAN and NOTACC has not been published. Check with HQ before ' +
      'recording this.');
  }
  note.textContent = notes.join(' ');
  note.hidden = notes.length === 0;

  if (!assessment.pass) {
    if (bfa.applied) clearBfaExemption();
    apply.hidden = true;
    return;
  }

  apply.hidden = false;
  apply.textContent = bfa.applied
    ? 'Body composition is exempt on this BFA. Undo'
    : 'Apply this pass (exempts body composition)';
  apply.classList.toggle('on', bfa.applied);
}

/** Hand the pass to the scorer as an exemption, the way para 3.7.2 reads. */
function applyBfaExemption() {
  bfa.applied = true;
  statuses.body_composition = 'exempt';
  bfaExemptionNote(true);
}

function clearBfaExemption() {
  bfa.applied = false;
  if (statuses.body_composition === 'exempt') statuses.body_composition = null;
  bfaExemptionNote(false);
}

/**
 * Body composition can be exempted by the Exempt button or by a passed BFA,
 * and the two mean different things, so the note says which one did it and
 * only ever clears its own words.
 */
function bfaExemptionNote(on) {
  const note = $('exempt-note-body_composition');
  if (!on) {
    if (note.dataset.from === 'bfa') {
      note.textContent = '';
      note.hidden = true;
      delete note.dataset.from;
    }
    return;
  }
  note.dataset.from = 'bfa';
  note.textContent =
    'Exempt because the secondary body fat assessment passed (DAFMAN 36-2905 para ' +
    '3.7.2). It scores no points, fails nothing, and the composite is worked out ' +
    'over the three components that were assessed.';
  note.hidden = false;
}

function wireBfa() {
  for (const button of document.querySelectorAll('.bfa-method')) {
    button.addEventListener('click', () => {
      bfa.method = button.dataset.bfaMethod;
      clearBfaExemption();
      update();
    });
  }
  for (const id of ['bfa-percent', 'bfa-neck', 'bfa-abdomen', 'bfa-waist', 'bfa-buttocks']) {
    $(id).addEventListener('input', () => {
      clearBfaExemption();
      update();
    });
  }
  // The BFA tracks are held in `dragging` the same way the event tracks are,
  // under a name no component can take, so that a handle is left alone while a
  // finger is on it and the window's pointerup still runs a final update.
  for (const id of Object.keys(BFA_SLIDERS)) {
    const slider = $(`slide-${id}`);
    slider.addEventListener('input', () => onBfaSliderInput(id));
    slider.addEventListener('pointerdown', () => { dragging = `bfa:${id}`; });
  }
  // Re-measuring the member invalidates a BFA that was applied against the old
  // ratio, so the two measurement fields drop it rather than carrying it over.
  // These listeners are added after the general one, so by the time they run
  // the score has already been worked out from the stale exemption. Scoring
  // again is cheap, and the alternative is a composite that belongs to a waist
  // the member no longer has.
  for (const id of ['height', 'waist']) {
    $(id).addEventListener('input', () => {
      if (!bfa.applied) return;
      clearBfaExemption();
      update();
    });
  }
  $('bfa-apply').addEventListener('click', () => {
    if (bfa.applied) clearBfaExemption();
    else applyBfaExemption();
    update();
  });
}

/** Put the BFA panel back to its starting state. */
function resetBfa() {
  bfa.method = 'tape';
  bfa.applied = false;
  bfa.ratio = null;
  bfaExemptionNote(false);
  for (const id of ['bfa-percent', 'bfa-neck', 'bfa-abdomen', 'bfa-waist', 'bfa-buttocks']) {
    $(id).value = '';
  }
  // The panel is hidden below, and showBfa would put these right before it was
  // seen again, but a hidden panel that disagrees with `bfa.method` is a state
  // waiting to be read wrong. Put the markup back with the object.
  showBfaFields(sex);
  renderBfaSliders();
  $('bfa').hidden = true;
  $('bfa-body').hidden = true;
  $('bfa-result').hidden = true;
  $('bfa-note').hidden = true;
  $('bfa-apply').hidden = true;
}

/* --- the verbiage dialog -------------------------------------------------
 *
 * Attachment 2 of DAFMAN 36-2905 is the script an assessment administrator reads
 * out before each event. It is quoted rather than summarised, because the point
 * of it is that the same words reach every member.
 *
 * The publication sets the spoken text in italics and the administrator's own
 * directions in roman type, and that distinction is the whole reason a cadre
 * member opens this: it tells them what to say out loud and what is an
 * instruction to them. src/verbiage.js keeps the two in separate fields and
 * this renders them differently, so the difference survives.
 */
function openVerbiage(component) {
  const event = component === 'body_composition' ? 'whtr' : events[component];
  const section = verbiageFor(event);
  if (!section) return;

  const dialog = $('verbiage');
  const body = $('verbiage-body');
  body.replaceChildren();

  $('verbiage-title').textContent = `${section.ref}. ${section.title}`;

  const direction = $('verbiage-direction');
  direction.textContent = section.direction ?? '';
  direction.hidden = !section.direction;

  // A2.1 is read once at the start of the assessment rather than before an
  // event. Body composition is the first thing measured, so it carries it.
  if (component === 'body_composition') {
    const general = el('div', 'verbiage-general');
    general.append(el('p', 'verbiage-general-head',
      'Read once, before the assessment begins'));
    appendParts(general, VERBIAGE.general);
    body.append(general);
  }

  appendParts(body, section);

  $('verbiage-source').textContent =
    `${VERBIAGE_SOURCE.publication}, ${VERBIAGE_SOURCE.date}, ` +
    `${VERBIAGE_SOURCE.attachment}, pages ${VERBIAGE_SOURCE.pages}. ` +
    'Quoted in full; spoken text in bold.';

  dialog.showModal();
}

function appendParts(host, section) {
  for (const part of section.parts) {
    const wrap = el('div', 'verbiage-part');
    const ref = el('p', 'verbiage-ref', part.ref);
    wrap.append(ref);
    // The roman-type lead is an instruction to the administrator, not something
    // to say, so it never gets the spoken styling.
    if (part.lead) wrap.append(el('p', 'verbiage-lead', part.lead));
    wrap.append(el('p', 'verbiage-spoken', part.spoken));
    host.append(wrap);
  }
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
  reps: {
    descending: false,
    step: 1,
    worst: (r) => r.floor.value - 1,
    best: (r) => r.best.value,
    failingBelow: (r) => (r.floor.isFloor ? r.floor.value : null),
    format: (v) => `${v}`
  },
  shuttles: {
    descending: false,
    step: 1,
    worst: (r) => r.floor.value - 1,
    best: (r) => r.best.value,
    failingBelow: (r) => (r.floor.isFloor ? r.floor.value : null),
    format: (v) => `${v}`
  },
  hold: {
    descending: false,
    step: 1,
    worst: (r) => r.floor.value - 1,
    best: (r) => r.best.value,
    failingBelow: (r) => (r.floor.isFloor ? r.floor.value : null),
    format: formatTime
  },
  time: {
    descending: true,
    step: 1,
    // Slower is worse, so one step short of the minimum is one second past it.
    worst: (range) => range.floor.value + 1,
    best: (range) => range.best.value,
    failingBelow: (range) => (range.floor.isFloor ? range.floor.value : null),
    format: formatTime
  },
  walk: {
    // The walk is pass or fail, so it has no full marks end to run to. The
    // track still needs a right hand end, and WALK_FASTEST is that anchor: it
    // is comfortably inside every standard on Table 3.1, so the whole of the
    // track bar its left tip is a pass, which is the only thing the walk has
    // to say. The left tip is one second past this member's own maximum, so
    // dragging all the way left fails exactly as it does on every other track.
    descending: true,
    step: 1,
    worst: (range) => range.standard.seconds + 1,
    best: () => WALK_FASTEST,
    failingBelow: (range) => range.standard.seconds,
    format: formatTime
  },
  ratio: {
    descending: true,
    step: 0.5,
    worst: (range) => range.floor.waistInches,
    best: (range) => range.best.waistInches,
    // Body composition has no minimum (DAFMAN 36-2905 para 3.7.1), so no part
    // of its track fails on its own.
    failingBelow: () => null,
    format: (v) => `${v.toFixed(1)} in`
  }
};

/** The fast end of the walk track, in seconds. */
const WALK_FASTEST = 14 * 60;

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

    if (!spec) {
      row.hidden = true;
      continue;
    }

    const range = (sex && band)
      ? scorer.rangeFor({ component, event, sex, band,
        heightInches: decimal('height') || null,
        altitudeGroup: $('altitude-group').value || null })
      : null;

    // No chart yet, or, for the waist, no height, so there is no way to turn
    // a ratio into the inches a slider would have to move through. A declared
    // DNS or DNF hides it too: there is no measurement left to adjust.
    const bestValue = range ? spec.best(range) : null;
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
    // an affordance marking the failing end, not a plot of anything. Which
    // components have such a tip is the spec's business: body composition has
    // no minimum to fail against, and the walk fails anything slower than its
    // own maximum.
    const span = bounds.max - bounds.min;
    const threshold = spec.failingBelow(range);
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
  if (control.kind === 'hold' || control.kind === 'time' || control.kind === 'walk') {
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
    if (control.kind === 'hold' || control.kind === 'time' || control.kind === 'walk') {
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
      ? scorer.rangeFor({ component, event, sex, band, heightInches,
        altitudeGroup: $('altitude-group').value || null })
      : null;

    if (!range) {
      host.append(el('p', 'range-empty', 'Set your age and sex to see the chart range.'));
      continue;
    }

    // Pass or fail: one number, and it is a ceiling rather than a floor.
    if (range.passFail) {
      host.append(rangeItem('Maximum time', range.standard.label,
        range.altitudeGroupLabel
          ? `aged ${range.standard.groupLabel} · ${range.altitudeGroupLabel}`
          : `aged ${range.standard.groupLabel}`, false));
      host.append(rangeItem('Worth', 'No points',
        'pass or fail · para 3.7.3', true));
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

  // The 2 kilometer walk has no points to show, so a "0.0 / 50" chip beside it
  // would read as a catastrophe rather than as a pass. It says what it is.
  if (scored.walk) {
    chip.textContent = scored.walk.passed ? 'Pass' : 'Fail';
    chip.className = `chip filled${scored.walk.passed ? '' : ' chip-fail'}`;
    // A full bar for a pass, an empty one for a fail: the meter is a reading of
    // the component, and the component is a yes or a no.
    setMeter(`meter-${component}`, scored.walk.passed ? scored.maxPoints : 0,
      scored.maxPoints, scored.walk.passed ? 'is-pass' : 'is-fail', null);
    // Nothing to add underneath: the chip says Pass or Fail, the range strip
    // says what the maximum is and that it is worth no points, and the altitude
    // strip says when that maximum moved.
    $(`row-${component}`).hidden = true;
    return;
  }

  chip.textContent = `${scored.points.toFixed(1)} / ${scored.maxPoints.toFixed(0)}`;
  const failing = scored.status !== 'scored' || !scored.meetsMinimum;
  chip.className = `chip filled${failing ? ' chip-fail' : ''}`;

  setMeter(`meter-${component}`, scored.points, scored.maxPoints,
    failing ? 'is-fail' : 'is-pass', scored.minimumPoints);

  /*
   * This line used to restate the chart row, "40+ reps -> 9.0 points". Every
   * part of that is now on screen in larger type: the reps in the field, the
   * points in the chip, the thresholds in the range strip, and the row itself
   * highlighted in the in-line chart. So it only speaks when it has something
   * of its own to say, which is the one case with no other words attached.
   *
   * Below the chart minimum the chip and the meter both turn red, and that is
   * all. A red number is not an explanation, and the failures card that would
   * explain it does not appear until every component is in.
   */
  const row = $(`row-${component}`);
  const failsMinimum = scored.status === 'below_minimum';
  row.textContent = failsMinimum
    ? 'Below the chart minimum: scores 0 and fails this component.'
    : '';
  row.hidden = !failsMinimum;
}

/** The running total pinned to the bottom of the screen. */
function showTally(result, ready) {
  const tally = $('tally');
  const score = $('tally-score');
  const text = $('tally-text');

  if (!result) {
    tally.hidden = ready.size === 0;
    score.textContent = '–';
    text.textContent = !role
      ? 'Choose cadet or cadre to start'
      : 'Add your age and sex to start scoring';
    tally.className = 'tally';
    return;
  }

  tally.hidden = false;
  const remaining = COMPONENTS.length - ready.size;

  if (remaining > 0) {
    // Only count what the cadet has actually entered. Components still blank
    // are standing in as DNS, and their zeros are not a score anyone has
    // earned yet. There is no composite to show either, because a composite
    // is worked out over the components that were assessed and some of them
    // have not been.
    const tenths = [...ready].reduce(
      (acc, c) => acc + Math.round(result.components[c].points * 10), 0);
    animateTo(score, tenths / 10);
    const missing = COMPONENTS.filter((c) => !ready.has(c))
      .map((c) => COMPONENT_LABELS[c].toLowerCase());
    text.textContent = `so far · still need ${missing.join(', ')}`;
    tally.className = 'tally';
    return;
  }

  // Once everything is in, show the composite rather than the points earned.
  // The two are the same number until something is exempt, and then they are
  // not: a member whose body composition is exempt on a passed BFA earns 61.5
  // points and composites 76.9, and a footer reading "61.5 - Satisfactory"
  // beside a scoreboard reading 76.9 invites exactly the wrong conclusion.
  animateTo(score, result.composite);
  text.textContent = `${result.rating} · tap for the breakdown`;
  tally.className = `tally ${result.pass ? 'is-pass' : 'is-fail'}`;
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
  // DAFMAN 36-2905 para 3.6.1 names the three categories. Unsatisfactory is the
  // failing one, so the badge carries the pass or fail colour without printing
  // the words "pass" or "fail".
  $('verdict').textContent = result.rating;
  $('band').textContent =
    `${result.sex === 'M' ? 'Male' : 'Female'}, ${result.ageBandLabel} · ` +
    `${result.passingComposite.toFixed(1)} needed to pass`;

  setMeter('meter-composite', result.composite, 100,
    result.pass ? 'is-pass' : 'is-fail', result.passingComposite);
  // With a component exempt the composite is scored over what was actually
  // assessed, so saying "of 100" would hide the thing most worth knowing: that
  // the number came from fewer components than usual.
  const exempt = result.exemptComponents ?? [];
  const scale = exempt.length === 0
    ? 'of 100'
    : `scored over ${result.compositeOutOf.toFixed(0)} assessed points, ` +
      `${exempt.map((c) => COMPONENT_LABELS[c].toLowerCase()).join(' and ')} exempt`;
  $('meter-legend').textContent =
    `${result.composite.toFixed(1)} ${scale} · the mark is ` +
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
          `to reach ${describeReach(step.rung)} for ${step.rung.points.toFixed(1)} points`));
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
      'notacc-cy26-092': 'NOTACC CY26-092',
      'afrotci36-2011v3': 'AFROTCI 36-2011 V3',
      'dafman36-2905-afrotcsup': 'DAFMAN 36-2905 AFROTC Sup'
    }[reference.source] ?? 'DAFMAN 36-2905';
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
 * which no browser renders: they show only their own "requires Adobe Reader"
 * placeholder, so they are download-only until a flattened copy exists.
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
