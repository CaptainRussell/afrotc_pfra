/**
 * PFRA scoring engine.
 *
 * Pure scoring logic for the Det 250 PFRA calculator. No DOM, no fetch, no
 * globals: the caller supplies the scoring tables and raw inputs, and gets back
 * a structured result it can render or test.
 *
 * Two invariants shape this file, both from PFRA-Calculator-CONTEXT.md:
 *
 *   1. Show the work. Every component result carries the chart row it scored
 *      against, so a scorer can check the lookup by eye.
 *   2. A zero is never just a zero. DNS, DNF and below-minimum results carry a
 *      status that fails the component. There is no code path that produces
 *      0 points with a passing status, so a caller cannot sum its way past a
 *      failure the way the Mock 1 results sheet did.
 *
 * Scoring tables come from pfra-scoring-data.json, verified cell for cell
 * against the published charts by tests/verify_charts.py.
 */

import { PUBLICATION, CHARTS, NOTACC, resolveReferences } from './references.js?v=fbcb64b26f';

/* --- altitude time correction (DAFMAN 36-2905 Attachment 3) ---------------
 *
 * Thin air costs time, so above 5,250 feet the manual gives it back: seconds
 * off a run, shuttles onto a HAMR, and a later maximum for the walk. Below that
 * there is no correction at all, which is why this returns null rather than a
 * zero group. "No correction applies" and "a correction of zero" are different
 * things to say on screen.
 *
 * Det 250 assesses at Ames, about 955 feet, so this never fires for a cadet.
 * It is here because cadre read these tables for members testing elsewhere.
 */
export function altitudeGroupFor(data, feet) {
  const table = data.altitude_correction;
  if (!table || feet == null || !Number.isFinite(feet)) return null;
  if (feet < table.lowest_feet) return null;
  for (const group of table.groups) {
    if (feet >= group.min_feet && (group.max_feet == null || feet <= group.max_feet)) {
      return group;
    }
  }
  return null;
}

/**
 * The group an assessment was run at, however it was given.
 *
 * `altitudeGroup` names one of the four blocks outright, which is what the page
 * asks for: a cadre member reads a group off the table rather than looking up
 * a field elevation. `altitudeFeet` still works, because an elevation is the
 * other way someone might have the number, and because it is what the tests
 * drive the boundaries with.
 *
 * The printed ranges overlap at their ends -- Table A3.2 puts 5500 in both
 * Group 1 and Group 2 -- so picking the group is the unambiguous form and this
 * takes it in preference.
 */
export function resolveAltitude(data, { altitudeGroup, altitudeFeet }) {
  const table = data.altitude_correction;
  if (!table) return null;
  if (altitudeGroup) {
    const found = table.groups.find((g) => g.id === altitudeGroup);
    if (!found) {
      throw new RangeError(
        `unknown altitude group ${JSON.stringify(altitudeGroup)}; expected one of ` +
        table.groups.map((g) => g.id).join(', '));
    }
    return found;
  }
  return altitudeGroupFor(data, altitudeFeet ?? null);
}

/**
 * Where a cumulative shuttle count sits on the HAMR tally sheet.
 *
 * The chart scores a raw count, but nobody records one: an administrator marks
 * a grid of levels, and the beep track announces levels. "43 shuttles" and
 * "level 6, shuttle 2" are the same performance said in the two different
 * languages the test is actually run in, so the tool says both.
 */
export function hamrLevelFor(data, shuttles) {
  const table = data.hamr_levels;
  if (!table || !Number.isInteger(shuttles) || shuttles < 1) return null;
  for (const row of table.levels) {
    if (shuttles >= row.first_shuttle && shuttles <= row.last_shuttle) {
      return Object.freeze({
        level: row.level,
        shuttleInLevel: shuttles - row.first_shuttle + 1,
        label: `level ${row.level}, shuttle ${shuttles - row.first_shuttle + 1}`
      });
    }
  }
  return null;   // past the end of the printed sheet
}

/**
 * Seconds to take off a 2 mile run, from Table A3.1.
 *
 * The table is indexed by the time actually run, not by the corrected one, so
 * the lookup takes the first row the recorded time reaches. A time slower than
 * the last row takes the last row: the table stops at 25:00 and a correction
 * has to come from somewhere.
 */
function runAltitudeSeconds(data, group, seconds) {
  if (!group) return 0;
  const rows = data.altitude_correction.run_2mile.rows;
  for (const row of rows) {
    if (seconds <= row.max_seconds) return row.seconds[group.id];
  }
  return rows[rows.length - 1].seconds[group.id];
}

/** Component result states. Only 'scored' and 'exempt' can pass a component. */
export const STATUS = Object.freeze({
  SCORED: 'scored',
  BELOW_MINIMUM: 'below_minimum',
  DNS: 'dns',
  DNF: 'dnf',
  EXEMPT: 'exempt'
});

const PASSING_STATUSES = Object.freeze([STATUS.SCORED, STATUS.EXEMPT]);

/**
 * Assessment order, which is also display order.
 *
 * Body composition is first because the waist measurement is taken before any
 * exercise; the three events then run in the order they are administered.
 * Scoring does not depend on this, since the composite is a sum, but every list the
 * page builds does, so there is one order and this is it.
 */
export const COMPONENTS = Object.freeze([
  'body_composition',
  'muscular_strength',
  'core_endurance',
  'cardiorespiratory'
]);

export const COMPONENT_LABELS = Object.freeze({
  muscular_strength: 'Muscular Strength',
  core_endurance: 'Core Endurance',
  cardiorespiratory: 'Cardiorespiratory',
  body_composition: 'Body Composition'
});

export const EVENT_LABELS = Object.freeze({
  hand_release_pushup: 'Hand Release Push-Ups',
  pushup: 'Push-Ups',
  situp: 'Sit-Ups',
  cross_leg_reverse_crunch: 'Cross-Leg Reverse Crunches',
  forearm_plank: 'Forearm Plank',
  run_2mile: '2 Mile Run',
  hamr_20m: '20 Meter HAMR',
  walk_2km: '2 Kilometer Walk',
  whtr: 'Waist to Height Ratio'
});

/**
 * How to name each event mid-sentence.
 *
 * EVENT_LABELS are headings, so they are capitalised and some are plural. These
 * are the forms that read correctly inside a sentence: "not tested on push-ups",
 * "not tested on the forearm plank". HAMR keeps its capitals because it is an
 * acronym, which is why these are written out rather than lowercased on the fly.
 */
export const EVENT_PHRASES = Object.freeze({
  hand_release_pushup: 'hand release push-ups',
  pushup: 'push-ups',
  situp: 'sit-ups',
  cross_leg_reverse_crunch: 'cross-leg reverse crunches',
  forearm_plank: 'the forearm plank',
  run_2mile: 'the 2 mile run',
  hamr_20m: 'the 20 meter HAMR',
  walk_2km: 'the 2 kilometer walk',
  whtr: 'waist to height ratio'
});

/** Det 250 administers these three. Everything else is cadre reference only. */
export const DET250_EVENTS = Object.freeze(['hand_release_pushup', 'situp', 'run_2mile']);

/** Which lookup each event uses. Adding an alternate event means adding a row. */
export const EVENT_KINDS = Object.freeze({
  hand_release_pushup: 'reps',
  pushup: 'reps',
  situp: 'reps',
  cross_leg_reverse_crunch: 'reps',
  forearm_plank: 'hold',       // a time, but longer is better
  run_2mile: 'time',           // a time, and faster is better
  hamr_20m: 'shuttles',
  walk_2km: 'walk',        // a time, but pass or fail
  whtr: 'ratio'
});

/** Where each non-repetition event's table lives, and what its rows measure. */
export const TABLES = Object.freeze({
  forearm_plank: { path: 'forearm_plank', field: 'min_seconds' },
  run_2mile: { path: 'run_2mile', field: 'max_seconds' },
  hamr_20m: { path: 'hamr_20m', field: 'min_shuttles' }
});

const FAILURE = Object.freeze({
  COMPOSITE_BELOW_MINIMUM: 'composite_below_minimum',
  WALK_STANDARD_NOT_MET: 'walk_standard_not_met',
  COMPONENT_BELOW_MINIMUM: 'component_below_minimum',
  COMPONENT_NOT_COMPLETED: 'component_not_completed'
});

// --- small numeric helpers -------------------------------------------------

/** Points are always multiples of 0.5; sum in tenths so floats cannot drift. */
function sumPoints(values) {
  const tenths = values.reduce((acc, v) => acc + Math.round(v * 10), 0);
  return tenths / 10;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Integer hundredths, truncated toward zero, guarded against float noise. */
function truncateToHundredths(value) {
  return Math.floor(value * 100 + 1e-9) / 100;
}

export function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseTime(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`run time in seconds must be a non-negative integer, got ${value}`);
    }
    return value;
  }
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(String(value).trim());
  if (!match) {
    throw new RangeError(`run time must look like "14:19" or be whole seconds, got "${value}"`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

// --- age bands -------------------------------------------------------------

const BAND_BOUNDS = Object.freeze([
  ['under25', 0, 24],
  ['25-29', 25, 29],
  ['30-34', 30, 34],
  ['35-39', 35, 39],
  ['40-44', 40, 44],
  ['45-49', 45, 49],
  ['50-54', 50, 54],
  ['55-59', 55, 59],
  ['60plus', 60, Infinity]
]);

export function ageBandFor(age) {
  if (!Number.isInteger(age) || age < 0) {
    throw new RangeError(`age must be a non-negative whole number, got ${age}`);
  }
  const found = BAND_BOUNDS.find(([, low, high]) => age >= low && age <= high);
  return found[0];
}

// --- input normalisation ---------------------------------------------------

function normalizeSex(sex) {
  const value = String(sex ?? '').trim().toUpperCase();
  if (value !== 'M' && value !== 'F') {
    throw new RangeError(`sex must be "M" or "F", got ${JSON.stringify(sex)}`);
  }
  return value;
}

/**
 * Resolve the age band. Never defaults: an assessment with no age stated is a
 * data problem, not an under-25 assessment.
 */
function normalizeBand(data, input) {
  if (input.ageBand != null) {
    if (!data.age_bands.includes(input.ageBand)) {
      throw new RangeError(`unknown age band ${JSON.stringify(input.ageBand)}`);
    }
    return input.ageBand;
  }
  if (input.age == null) {
    throw new RangeError('age or ageBand is required; the engine will not assume an age band');
  }
  return ageBandFor(input.age);
}

/** A component entry may declare a non-completion instead of a measurement. */
function declaredStatus(entry) {
  const raw = entry?.status;
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (value === STATUS.DNS || value === STATUS.DNF || value === STATUS.EXEMPT) {
    return value;
  }
  throw new RangeError(`status must be "dns", "dnf" or "exempt", got ${JSON.stringify(raw)}`);
}

// --- chart lookups ---------------------------------------------------------

/**
 * Every "more is better" chart works the same way: rows are ordered highest
 * points first, and a member takes the highest row whose threshold they meet.
 * Reps, HAMR shuttles and plank seconds all read this way; only the column name
 * and the units differ, which is what MEASURES describes.
 */
export const MEASURES = Object.freeze({
  reps: {
    field: 'min_reps',
    threshold: (v) => `${v} rep`,
    key: 'reps',
    noun: 'rep',
    show: (v) => `${v} reps`,
    atLeast: (v) => `${v}+ reps`
  },
  shuttles: {
    field: 'min_shuttles',
    threshold: (v) => `${v} shuttle`,
    key: 'shuttles',
    noun: 'shuttle',
    show: (v) => `${v} shuttles`,
    atLeast: (v) => `${v}+ shuttles`
  },
  hold: {
    field: 'min_seconds',
    threshold: (v) => formatTime(v),
    key: 'seconds',
    noun: 'second',
    show: (v) => formatTime(v),
    atLeast: (v) => `${formatTime(v)} or longer`
  }
});

function lookupAtLeast(rows, value, field) {
  for (let i = 0; i < rows.length; i += 1) {
    if (value >= rows[i][field]) return { row: rows[i], index: i };
  }
  return { row: null, index: -1 };
}

/**
 * Run tables are ordered fastest first. Award the highest point value whose
 * max_seconds is greater than or equal to the member's time, so 13:26 earns
 * 49.5 rather than the 50.0 that requires 13:25 or faster.
 */
function lookupTime(rows, seconds) {
  for (let i = 0; i < rows.length; i += 1) {
    if (seconds <= rows[i].max_seconds) return { row: rows[i], index: i };
  }
  return { row: null, index: -1 };
}

/** Ratio rows come in three shapes: a capped top row, exact middles, a floored bottom row. */
function rowMatchesRatio(row, hundredths) {
  if (row.max_ratio != null) return hundredths <= Math.round(row.max_ratio * 100);
  if (row.min_ratio != null) return hundredths >= Math.round(row.min_ratio * 100);
  return hundredths === Math.round(row.ratio * 100);
}

function lookupRatio(rows, ratio) {
  const hundredths = Math.round(ratio * 100);
  for (let i = 0; i < rows.length; i += 1) {
    if (rowMatchesRatio(rows[i], hundredths)) return { row: rows[i], index: i };
  }
  return { row: null, index: -1 };
}

function ratioOf(row) {
  return row.ratio ?? row.max_ratio ?? row.min_ratio;
}

// --- next threshold --------------------------------------------------------

/**
 * What it takes to reach the next half point on this component. For a member
 * scoring zero this points at the floor row, which is the number that matters
 * most to them.
 */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ascendingThreshold(rows, index, value, measure) {
  const target = index === -1 ? rows[rows.length - 1] : rows[index - 1];
  if (!target) return null;
  const current = index === -1 ? 0 : rows[index].points;
  const more = target[measure.field] - value;
  const label = measure.key === 'seconds'
    ? `${plural(more, 'second')} longer reaches ${target.points.toFixed(1)} points`
    : `${plural(more, `more ${measure.noun}`)} reaches ${target.points.toFixed(1)} points`;
  return {
    points: target.points,
    gain: roundTo(target.points - current, 1),
    needs: { [measure.key]: more },
    label
  };
}

function timeThreshold(rows, index, seconds) {
  const target = index === -1 ? rows[rows.length - 1] : rows[index - 1];
  if (!target) return null;
  const current = index === -1 ? 0 : rows[index].points;
  const cut = seconds - target.max_seconds;
  return {
    points: target.points,
    gain: roundTo(target.points - current, 1),
    needs: { seconds: cut },
    label: `${plural(cut, 'second')} faster reaches ${target.points.toFixed(1)} points`
  };
}

function ratioThreshold(rows, index, ratio, heightInches) {
  const target = index === -1 ? null : rows[index - 1];
  if (!target) return null;
  const targetRatio = ratioOf(target);
  const needs = { ratio: roundTo(ratio - targetRatio, 2) };
  let label = `a ratio of ${targetRatio.toFixed(2)} reaches ${target.points.toFixed(1)} points`;
  if (heightInches) {
    // The next band starts at the target ratio, so the largest qualifying waist
    // is the one whose truncated ratio still lands on that row.
    const maxWaist = Math.floor((targetRatio + 0.0099) * heightInches * 2) / 2;
    needs.waistInches = roundTo(maxWaist, 1);
    label = `a waist of ${maxWaist.toFixed(1)} inches at this height reaches ` +
      `${target.points.toFixed(1)} points`;
  }
  return { points: target.points, gain: roundTo(target.points - rows[index].points, 1), needs, label };
}

// --- component scoring -----------------------------------------------------

function baseResult(component, event, extra) {
  return {
    component,
    componentLabel: COMPONENT_LABELS[component],
    event,
    eventLabel: EVENT_LABELS[event] ?? event,
    ...extra
  };
}

/**
 * A component nobody was assessed on.
 *
 * Exempt is not a bad score, it is an absent one: it contributes no points and
 * fails nothing, and score() leaves it out of both sides of the composite so
 * the remaining components are scored over what was actually done.
 *
 * Cadets are not authorised exemptions on any PFRA component -- AFROTCI 36-2011
 * V3 requires the most recent PFRA "with no exemptions" before contracting,
 * field training and commissioning -- which is why the control that produces
 * this is cadre-only. The engine still accepts it from anywhere, because the
 * rule about who may claim one is not the engine's to enforce.
 */
function exemptResult(component, event, maxPoints, minimumPoints, references) {
  return baseResult(component, event, {
    status: STATUS.EXEMPT,
    points: 0,
    maxPoints,
    minimumPoints,
    meetsMinimum: true,
    measured: null,
    chartRow: null,
    chartRowIndex: -1,
    chartRowLabel: null,
    nextThreshold: null,
    explanation:
      `${COMPONENT_LABELS[component]} recorded as exempt. It scores no points, ` +
      'fails nothing, and the composite is scored over the components that were assessed.',
    references,
    warnings: []
  });
}

function notCompletedResult(component, event, status, maxPoints, minimumPoints, references) {
  const word = status === STATUS.DNS ? 'did not start' : 'did not finish';
  return baseResult(component, event, {
    status,
    points: 0,
    maxPoints,
    minimumPoints,
    meetsMinimum: false,
    measured: null,
    chartRow: null,
    chartRowIndex: -1,
    chartRowLabel: null,
    nextThreshold: null,
    explanation:
      `Recorded as ${status.toUpperCase()} (${word}). The component scores 0 points and ` +
      'fails regardless of the composite.',
    references
  });
}

function scoreAscendingComponent(data, { component, event, kind, sex, band, value, status, altitude }) {
  const maxPoints = data.composite.components[component];
  const minimumPoints = data.component_minimums[component];
  const references = ['dafman.3.7.4', 'charts.minimum-asterisk'];
  const measure = MEASURES[kind];

  if (status === STATUS.EXEMPT) {
    return exemptResult(component, event, maxPoints, minimumPoints, references);
  }
  if (status) {
    return notCompletedResult(component, event, status, maxPoints, minimumPoints,
      [...references, 'dafman.3.15.13']);
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${event} ${measure.key} must be a non-negative whole number, got ${value}`);
  }

  const rows = kind === 'reps'
    ? data.rep_events[event]?.[sex]?.[band]
    : data[TABLES[event].path]?.[sex]?.[band];
  if (!rows) throw new RangeError(`no ${event} table for ${sex}/${band}`);

  // Only the HAMR takes an altitude correction, and it takes it as shuttles
  // added on (Table A3.4). Reps and a plank hold get none: thin air is not why
  // a push-up is hard.
  const addShuttles = (altitude && event === 'hamr_20m')
    ? data.altitude_correction.hamr_20m.shuttles[altitude.id] : 0;
  const effective = value + addShuttles;
  const altitudeNote = addShuttles ? Object.freeze({
    group: altitude.id,
    groupLabel: altitude.label,
    rangeLabel: altitude.range_label,
    // 'measurement' means the member's own number was adjusted; 'standard'
    // means the bar moved instead. The page says those two differently.
    kind: 'measurement',
    fromLabel: `${value} shuttles`,
    toLabel: `${effective} shuttles`,
    detail: `Table A3.4 adds ${addShuttles}`,
    addedShuttles: addShuttles,
    recorded: value,
    effective
  }) : null;

  const { row, index } = lookupAtLeast(rows, effective, measure.field);
  const floor = rows[rows.length - 1];
  const who = sex === 'M' ? 'male' : 'female';
  const measured = measure.key === 'seconds'
    ? { seconds: value, time: formatTime(value) }
    : { [measure.key]: value };

  // The HAMR is scored on a raw count but recorded as a level and a shuttle
  // within it, so the result carries both.
  if (event === 'hamr_20m') {
    measured.hamrLevel = hamrLevelFor(data, value);
  }

  if (!row) {
    return baseResult(component, event, {
      status: STATUS.BELOW_MINIMUM,
      points: 0,
      maxPoints,
      minimumPoints,
      meetsMinimum: false,
      measured,
      chartRow: null,
      chartRowIndex: -1,
      chartRowLabel: null,
      nextThreshold: ascendingThreshold(rows, -1, effective, measure),
      altitude: altitudeNote,
      explanation:
        `${measure.show(effective)} is below the ${measure.threshold(floor[measure.field])} ` +
        `minimum for a ${who} in the ${data.age_band_ranges[band]} band. Below the ` +
        'minimum the component scores 0 and fails.',
      references
    });
  }

  return baseResult(component, event, {
    status: STATUS.SCORED,
    points: row.points,
    maxPoints,
    minimumPoints,
    meetsMinimum: row.points >= minimumPoints,
    measured,
    chartRow: row,
    chartRowIndex: index,
    chartRowLabel: `${measure.atLeast(row[measure.field])} → ${row.points.toFixed(1)} points`,
    nextThreshold: ascendingThreshold(rows, index, effective, measure),
    altitude: altitudeNote,
    explanation:
      `${measure.show(effective)} meets the ${measure.threshold(row[measure.field])} row on the ` +
      `${EVENT_LABELS[event]} chart (${who}, ${data.age_band_ranges[band]}), ` +
      `worth ${row.points.toFixed(1)} points.`,
    references
  });
}

function scoreRunComponent(data, { component, event, sex, band, seconds, status, altitude }) {
  const maxPoints = data.composite.components[component];
  const minimumPoints = data.component_minimums[component];
  const references = ['dafman.3.7.4', 'dafman.3.15.12.1', 'charts.minimum-asterisk'];

  if (status === STATUS.EXEMPT) {
    return exemptResult(component, event, maxPoints, minimumPoints, references);
  }
  if (status) {
    return notCompletedResult(component, event, status, maxPoints, minimumPoints,
      [...references, 'dafman.3.15.13']);
  }

  const rows = data[event]?.[sex]?.[band];
  if (!rows) throw new RangeError(`no ${event} table for ${sex}/${band}`);

  // The correction comes off the recorded time, and the chart is then read on
  // what is left. `measured` keeps the time the member actually ran, because
  // that is what goes on the 4446.
  const takeOff = runAltitudeSeconds(data, altitude, seconds);
  const effective = Math.max(0, seconds - takeOff);
  const altitudeNote = altitude ? Object.freeze({
    group: altitude.id,
    groupLabel: altitude.label,
    rangeLabel: altitude.range_label,
    kind: 'measurement',
    fromLabel: formatTime(seconds),
    toLabel: formatTime(effective),
    detail: `Table A3.1 allows ${formatTime(takeOff)}`,
    correctionSeconds: takeOff,
    recordedSeconds: seconds,
    effectiveSeconds: effective
  }) : null;

  const { row, index } = lookupTime(rows, effective);
  const floor = rows[rows.length - 1];
  const measured = { seconds, time: formatTime(seconds) };

  if (!row) {
    return baseResult(component, event, {
      status: STATUS.BELOW_MINIMUM,
      points: 0,
      maxPoints,
      minimumPoints,
      meetsMinimum: false,
      measured,
      chartRow: null,
      chartRowIndex: -1,
      chartRowLabel: null,
      nextThreshold: timeThreshold(rows, -1, effective),
      altitude: altitudeNote,
      explanation:
        `${formatTime(effective)} is slower than the ${floor.max_time} minimum for a ` +
        `${sex === 'M' ? 'male' : 'female'} in the ${data.age_band_ranges[band]} band. ` +
        'Slower than the minimum the component scores 0 and fails.',
      references
    });
  }

  return baseResult(component, event, {
    status: STATUS.SCORED,
    points: row.points,
    maxPoints,
    minimumPoints,
    meetsMinimum: row.points >= minimumPoints,
    measured,
    chartRow: row,
    chartRowIndex: index,
    chartRowLabel: `${row.max_time} or faster → ${row.points.toFixed(1)} points`,
    nextThreshold: timeThreshold(rows, index, effective),
    altitude: altitudeNote,
    explanation:
      `${formatTime(effective)} falls in the ${row.max_time} row on the 2 mile run chart ` +
      `(${sex === 'M' ? 'male' : 'female'}, ${data.age_band_ranges[band]}), worth ${row.points.toFixed(1)} points.`,
    references
  });
}

/**
 * The 2 kilometer walk: pass or fail, and worth no points at all.
 *
 * Para 3.7.3 is explicit: "No points are awarded for successful completion,
 * nor can this assessment apply to the Excellent PFRA score." A member on the
 * walk is component exempt for cardiorespiratory (para 3.6.2), so the component
 * contributes nothing and fails nothing; what it does carry is a maximum time,
 * and missing that fails the assessment.
 *
 * The walk is banded differently from every other chart in the publication
 * (under 30, then by decade), which is why `walk_age_groups` maps a PFRA band
 * onto a walk group rather than the two being assumed to line up.
 */
function scoreWalkComponent(data, { component, event, sex, band, seconds, status, altitude }) {
  const maxPoints = data.composite.components[component];
  const minimumPoints = data.component_minimums[component];
  const references = ['dafman.3.7.3', 'dafman.3.6.2', 'dafman.3.10.1', 'charts.walk'];

  if (status === STATUS.EXEMPT) {
    return exemptResult(component, event, maxPoints, minimumPoints, references);
  }
  if (status) {
    return notCompletedResult(component, event, status, maxPoints, minimumPoints, references);
  }

  const group = data.walk_age_groups[band];
  const sea = data.walk_2km?.[sex]?.[group];
  if (!sea) throw new RangeError(`no 2 kilometer walk standard for ${sex}/${band}`);

  // Tables A3.2 and A3.3 give a later maximum outright rather than a number of
  // seconds to allow, so at altitude the standard is replaced, not adjusted.
  const higher = altitude
    ? data.altitude_correction.walk_2km.max[sex][group][altitude.id] : null;
  const row = higher ?? sea;

  const passed = seconds <= row.max_seconds;
  const groupLabel = data.walk_age_group_labels[group];
  // The walk is the odd one: the member's time is untouched and the standard
  // moves instead, so this reads as a changed bar rather than a changed score.
  const altitudeNote = higher ? Object.freeze({
    group: altitude.id,
    groupLabel: altitude.label,
    rangeLabel: altitude.range_label,
    kind: 'standard',
    fromLabel: sea.max_time,
    toLabel: higher.max_time,
    detail: `Table ${sex === 'M' ? 'A3.2' : 'A3.3'} raises the maximum`,
    seaLevelTime: sea.max_time,
    maxTime: higher.max_time
  }) : null;

  return baseResult(component, event, {
    // Exempt either way: the walk never scores points, and the pass or fail is
    // carried separately so score() can fail the assessment without pretending
    // the component was worth something.
    status: STATUS.EXEMPT,
    points: 0,
    maxPoints,
    minimumPoints,
    meetsMinimum: true,
    measured: { seconds, time: formatTime(seconds) },
    chartRow: row,
    chartRowIndex: -1,
    chartRowLabel: `${row.max_time} maximum → pass or fail, no points`,
    nextThreshold: null,
    walk: Object.freeze({
      passed,
      seconds,
      maxSeconds: row.max_seconds,
      maxTime: row.max_time,
      groupLabel,
      marginSeconds: row.max_seconds - seconds
    }),
    altitude: altitudeNote,
    explanation: passed
      ? `${formatTime(seconds)} meets the ${row.max_time} standard for a ` +
        `${sex === 'M' ? 'male' : 'female'} aged ${groupLabel}. The walk is pass or fail: ` +
        'it earns no points and the cardiorespiratory component is exempt.'
      : `${formatTime(seconds)} is slower than the ${row.max_time} standard for a ` +
        `${sex === 'M' ? 'male' : 'female'} aged ${groupLabel}, so the assessment fails.`,
    references,
    warnings: []
  });
}

/**
 * Waist to height ratio. Measurements follow DAFMAN 36-2905: height to the
 * nearest half inch, waist rounded down to the nearest half inch, and the
 * resulting ratio truncated rather than rounded to two decimals.
 */
function scoreWhtrComponent(data, { component, event, waistInches, heightInches, ratio, points, status }) {
  const maxPoints = data.composite.components[component];
  const minimumPoints = data.component_minimums[component];
  const references = ['dafman.3.15.4.2', 'dafman.3.15.4.5', 'dafman.3.7.1', 'charts.whtr'];
  const warnings = [];

  if (status) {
    if (status === STATUS.EXEMPT) {
      return baseResult(component, event, {
        status: STATUS.EXEMPT,
        points: 0,
        maxPoints,
        minimumPoints,
        meetsMinimum: true,
        measured: null,
        chartRow: null,
        chartRowIndex: -1,
        chartRowLabel: null,
        nextThreshold: null,
        explanation: 'Body composition recorded as exempt; it contributes no points and does not fail the assessment.',
        references,
        warnings
      });
    }
    return notCompletedResult(component, event, status, maxPoints, minimumPoints, references);
  }

  let measured;
  let effectiveRatio;

  if (waistInches != null && heightInches != null) {
    if (!(waistInches > 0) || !(heightInches > 0)) {
      throw new RangeError('waistInches and heightInches must both be positive');
    }
    const waist = Math.floor(waistInches * 2) / 2;      // para 3.15.4.5, rounded down
    const height = Math.round(heightInches * 2) / 2;     // para 3.15.2.3, nearest half
    effectiveRatio = truncateToHundredths(waist / height); // para 3.15.4.2, truncated
    measured = {
      waistInches: waist,
      heightInches: height,
      waistAsEntered: waistInches,
      heightAsEntered: heightInches,
      ratio: effectiveRatio,
      exactRatio: roundTo(waist / height, 4)
    };
  } else if (ratio != null) {
    effectiveRatio = truncateToHundredths(ratio);
    measured = { ratio: effectiveRatio, exactRatio: roundTo(ratio, 4) };
  } else if (points != null) {
    // Escape hatch for historic records that stored points without measurements.
    // Flagged, because a points-only record is the exact gap the Mock 1 audit hit.
    const known = data.whtr.find((r) => r.points === points);
    if (!known) throw new RangeError(`${points} is not a waist to height ratio point value`);
    return baseResult(component, event, {
      status: STATUS.SCORED,
      points,
      maxPoints,
      minimumPoints,
      meetsMinimum: true,
      measured: null,
      chartRow: known,
      chartRowIndex: data.whtr.indexOf(known),
      chartRowLabel: `${points.toFixed(1)} points (entered directly)`,
      nextThreshold: null,
      explanation: `${points.toFixed(1)} points entered directly without height and waist measurements.`,
      references,
      warnings: ['Points entered without measurements; this lookup cannot be verified.']
    });
  } else {
    throw new RangeError('body composition needs waistInches and heightInches, a ratio, or points');
  }

  const { row, index } = lookupRatio(data.whtr, effectiveRatio);
  if (!row) throw new RangeError(`no waist to height ratio row matches ${effectiveRatio}`);

  if (effectiveRatio >= 0.55) {
    warnings.push(
      'A waist to height ratio of 0.55 or higher requires a secondary body fat assessment ' +
      'if the member does not meet PFRA standards (DAFMAN 36-2905 para 3.15.4.7).'
    );
    references.push('dafman.3.15.4.7');
  }

  const label = row.note ?? row.ratio.toFixed(2);
  return baseResult(component, event, {
    status: STATUS.SCORED,
    points: row.points,
    maxPoints,
    minimumPoints,
    meetsMinimum: true, // para 3.7.1: body composition carries no minimum
    measured,
    chartRow: row,
    chartRowIndex: index,
    chartRowLabel: `${label} → ${row.points.toFixed(1)} points`,
    nextThreshold: ratioThreshold(data.whtr, index, effectiveRatio, measured.heightInches),
    explanation:
      (measured.waistInches != null
        ? `${measured.waistInches} inch waist ÷ ${measured.heightInches} inch height = ` +
          `${measured.exactRatio}, truncated to ${effectiveRatio.toFixed(2)}. `
        : `Ratio ${effectiveRatio.toFixed(2)}. `) +
      `That is the ${label} row, worth ${row.points.toFixed(1)} points. ` +
      'Body composition has no minimum, so 0 points here does not by itself fail the assessment.',
    references,
    warnings
  });
}

/* --- body fat assessment (DAFMAN 36-2905 Attachment 8, 9 and 10) ----------
 *
 * The BFA is the second look at body composition, and the only one that can
 * turn a failed waist to height ratio into a pass. Para 3.15.4.7 calls for one
 * when a member's ratio is 0.55 or higher and they are not meeting PFRA
 * standards, taken on an InBody bio-impedance scale where there is one and by
 * the tape method of Attachment 8 where there is not, by an administrator of
 * the same sex. Para 3.7.2 makes it pass or fail: a member who meets the
 * standard has body composition scored as an exempt component, and one who
 * does not receives an unsatisfactory PFRA outright.
 *
 * The consequence of that exemption is arithmetic rather than cosmetic. An
 * exempt body composition takes its 20 points out of the divisor, so the
 * composite is earned over 80 rather than 100, and a member whose other three
 * components total between 60.0 and 62.4 points passes on the BFA having
 * failed on the ratio.
 *
 * Tape measurements follow Attachment 8: the neck rounds up to the quarter
 * inch and every other site rounds down, which is the conservative direction
 * in both cases. The circumference value is the abdomen less the neck for men
 * and the waist plus the buttocks less the neck for women. That value and the
 * member's height index the tables at Attachment 9 and Attachment 10.
 */

/** Round up to the nearest quarter inch. Attachment 8, neck. */
function quarterUp(value) {
  return Math.ceil(roundTo(value, 4) * 4) / 4;
}

/** Round down to the nearest quarter inch. Attachment 8, every other site. */
function quarterDown(value) {
  return Math.floor(roundTo(value, 4) * 4) / 4;
}

/**
 * The circumference value a tape measurement produces, with each site rounded
 * the way Attachment 8 requires.
 */
export function circumferenceValueFor(sex, { neckInches, abdomenInches, waistInches, buttocksInches }) {
  const normalized = normalizeSex(sex);
  if (!(neckInches > 0)) throw new RangeError('a body fat assessment needs a neck measurement');
  const neck = quarterUp(neckInches);

  if (normalized === 'M') {
    if (!(abdomenInches > 0)) {
      throw new RangeError('a male body fat assessment needs an abdomen measurement');
    }
    const abdomen = quarterDown(abdomenInches);
    return {
      sex: normalized,
      sites: { neckInches: neck, abdomenInches: abdomen },
      value: roundTo(abdomen - neck, 2),
      arithmetic: `${abdomen} inch abdomen minus ${neck} inch neck`
    };
  }

  if (!(waistInches > 0) || !(buttocksInches > 0)) {
    throw new RangeError('a female body fat assessment needs waist and buttocks measurements');
  }
  const waist = quarterDown(waistInches);
  const buttocks = quarterDown(buttocksInches);
  return {
    sex: normalized,
    sites: { neckInches: neck, waistInches: waist, buttocksInches: buttocks },
    value: roundTo(waist + buttocks - neck, 2),
    arithmetic: `${waist} inch waist plus ${buttocks} inch buttocks minus ${neck} inch neck`
  };
}

/** Where a value sits on one of the packed axes, and whether it ran off an end. */
function axisIndex(axis, value) {
  const raw = Math.round((value - axis.start) / axis.step);
  const index = Math.min(Math.max(raw, 0), axis.count - 1);
  return {
    index,
    used: roundTo(axis.start + axis.step * index, 2),
    below: raw < 0,
    above: raw > axis.count - 1
  };
}

/** The last value on a packed axis. */
function axisEnd(axis) {
  return roundTo(axis.start + axis.step * (axis.count - 1), 2);
}

/**
 * Read one cell out of a packed column.
 *
 * A column is its value at the first circumference plus one step entry per
 * point gained, so the percentage is the base plus the number of entries at or
 * below this index. The entries are sorted, so that is a binary search.
 */
function packedCell(column, circIndex) {
  const steps = column.steps;
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid] <= circIndex) lo = mid + 1;
    else hi = mid;
  }
  return column.base + lo;
}

/**
 * Body fat percent for a circumference value and a height, off Attachment 9
 * for men or Attachment 10 for women.
 */
export function bodyFatPercent(data, { sex, heightInches, circumferenceValue }) {
  const normalized = normalizeSex(sex);
  const table = data.body_fat && data.body_fat.tables
    ? data.body_fat.tables[normalized === 'M' ? 'male' : 'female']
    : null;
  if (!table) throw new TypeError('the scoring data has no body fat tables');
  if (!(heightInches > 0)) throw new RangeError('a body fat lookup needs a height');
  if (circumferenceValue == null) {
    throw new RangeError('a body fat lookup needs a circumference value');
  }

  const height = axisIndex(table.heights, Math.round(heightInches * 2) / 2);
  const circ = axisIndex(table.circumferences, circumferenceValue);
  const warnings = [];

  if (height.below || height.above) {
    warnings.push(
      `The ${normalized === 'M' ? 'male' : 'female'} table is printed for heights ` +
      `${table.heights.start} to ${axisEnd(table.heights)} inches, so ` +
      `${roundTo(heightInches, 2)} inches is off the chart. This reads the ` +
      `${height.used} inch column instead, which the manual does not authorise. ` +
      'Work the lookup by hand.');
  }
  if (circ.below || circ.above) {
    warnings.push(
      `The table is printed for circumference values ${table.circumferences.start} ` +
      `to ${axisEnd(table.circumferences)}, so ${circumferenceValue} is off the ` +
      `chart. This reads the ${circ.used} row instead. Check the measurements.`);
  }

  const percent = packedCell(table.columns[height.index], circ.index);
  const defects = data.body_fat.defects || [];
  const defect = defects.find((d) =>
    (d.sex === 'male') === (normalized === 'M')
    && d.height === height.used
    && d.circumference === circ.used) || null;
  if (defect) {
    warnings.push(
      `The chart prints ${defect.printed} in this cell, which cannot be right. ` +
      `${defect.note} This uses ${defect.used}.`);
  }

  return {
    percent,
    heightInches: height.used,
    circumferenceValue: circ.used,
    offChart: height.below || height.above || circ.below || circ.above,
    defect,
    warnings
  };
}

/**
 * A whole body fat assessment: measurements in, pass or fail out.
 *
 * `percent` may be supplied directly, which is the InBody path, or the tape
 * sites may be supplied and the percentage looked up.
 */
export function bodyFatAssessment(data, input) {
  const sex = normalizeSex(input.sex);
  const standard = data.body_fat && data.body_fat.standards
    ? data.body_fat.standards[sex]
    : null;
  if (standard == null) throw new TypeError('the scoring data has no body fat standards');

  let percent;
  let measured;
  let lookup = null;
  const warnings = [];

  if (input.percent != null) {
    // A bio-impedance scale reports the percentage itself, with no tape at all.
    if (!(input.percent >= 0)) throw new RangeError('body fat percent must not be negative');
    percent = input.percent;
    measured = { method: 'bioimpedance', percent };
  } else {
    const circumference = circumferenceValueFor(sex, input);
    lookup = bodyFatPercent(data, {
      sex,
      heightInches: input.heightInches,
      circumferenceValue: circumference.value
    });
    percent = lookup.percent;
    measured = {
      method: 'tape',
      sites: circumference.sites,
      arithmetic: circumference.arithmetic,
      heightInches: lookup.heightInches,
      circumferenceValue: lookup.circumferenceValue
    };
    warnings.push(...lookup.warnings);
  }

  const pass = percent <= standard;
  return Object.freeze({
    sex,
    percent,
    standard,
    pass,
    measured: Object.freeze(measured),
    lookup: lookup ? Object.freeze(lookup) : null,
    explanation: pass
      ? `${percent} percent body fat meets the ${standard} percent standard, so the BFA ` +
        'passes. Under DAFMAN 36-2905 para 3.7.2 body composition is then scored as an ' +
        'exempt component, and the composite is earned over the remaining 80 points.'
      : `${percent} percent body fat exceeds the ${standard} percent standard, so the BFA ` +
        'fails. Under DAFMAN 36-2905 para 3.7.2 that is an unsatisfactory PFRA.',
    references: Object.freeze(resolveReferences(
      ['dafman.3.15.4.7', 'dafman.3.7.2', 'dafman.table.3.2', 'dafman.attachment.8'])),
    warnings: Object.freeze(warnings)
  });
}

// --- component ranges ------------------------------------------------------

/**
 * The two numbers that bound a component: what the minimum takes, and what full
 * marks takes.
 *
 * Both come straight off the chart for this sex and age band, so the UI can
 * show them without knowing any thresholds of its own. Body composition has no
 * minimum (DAFMAN 36-2905 para 3.7.1), so it reports the row that scores zero
 * instead, with `isFloor` false to mark the difference.
 */
/**
 * The recorded waist that sits on a ratio boundary, for one height.
 *
 * Searched rather than solved, because two roundings sit between a waist and
 * its ratio: the waist rounds down to the half inch (para 3.15.4.5) and the
 * ratio truncates to two decimals (para 3.15.4.2). Stepping through the half
 * inches a member can actually be recorded at gets the boundary exactly right
 * where a closed form would be off by one in the corners.
 */
function waistBoundary(heightInches, hundredths, direction) {
  let answer = null;
  for (let halves = 24; halves <= 180; halves += 1) {   // 12.0 to 90.0 inches
    const waist = halves / 2;
    const ratio = Math.floor((waist / heightInches) * 100 + 1e-9);
    if (direction === 'atMost') {
      if (ratio <= hundredths) answer = waist;          // keep the largest
    } else if (ratio >= hundredths) {
      return waist;                                     // take the smallest
    }
  }
  return answer;
}

function rangeFor(data, { component, event, sex, band, heightInches, altitudeFeet, altitudeGroup }) {
  const maxPoints = data.composite.components[component];
  const minimumPoints = data.component_minimums[component];
  const kind = EVENT_KINDS[event];

  if (kind === 'ratio') {
    const rows = data.whtr;
    const best = rows[0];
    const worst = rows[rows.length - 1];

    // A cadet can act on inches, not on a ratio, so give both when the height
    // is known. Height itself is recorded to the nearest half inch.
    const height = heightInches ? Math.round(heightInches * 2) / 2 : null;
    const bestWaist = height
      ? waistBoundary(height, Math.round(best.max_ratio * 100), 'atMost') : null;
    const worstWaist = height
      ? waistBoundary(height, Math.round(worst.min_ratio * 100), 'atLeast') : null;

    return Object.freeze({
      component,
      event,
      unit: 'ratio',
      heightInches: height,
      best: {
        points: best.points,
        label: best.note ?? best.ratio.toFixed(2),
        waistInches: bestWaist,
        waistLabel: bestWaist == null ? null : `${bestWaist.toFixed(1)} inches or less`
      },
      floor: {
        points: worst.points,
        label: worst.note ?? worst.ratio.toFixed(2),
        waistInches: worstWaist,
        waistLabel: worstWaist == null ? null : `${worstWaist.toFixed(1)} inches or more`,
        isFloor: false // scoring zero here does not fail the assessment
      },
      maxPoints,
      minimumPoints
    });
  }

  // The walk has one number rather than a range: a maximum time to beat. There
  // is no "full marks" end, because there are no marks.
  if (kind === 'walk') {
    const group = data.walk_age_groups[band];
    const sea = data.walk_2km?.[sex]?.[group];
    if (!sea) return null;
    // At altitude the standard itself moves, so the strip has to move with it
    // or it will quote 16:16 next to a row that just said the maximum is 16:31.
    const altitude = resolveAltitude(data, { altitudeGroup, altitudeFeet });
    const row = altitude
      ? data.altitude_correction.walk_2km.max[sex][group][altitude.id] : sea;
    return Object.freeze({
      component,
      event,
      unit: 'time',
      passFail: true,
      altitudeGroupLabel: altitude ? `${altitude.label}, ${altitude.range_label}` : null,
      standard: {
        seconds: row.max_seconds,
        label: `${row.max_time} or faster`,
        groupLabel: data.walk_age_group_labels[group]
      },
      best: null,
      floor: null,
      maxPoints,
      minimumPoints
    });
  }

  if (kind === 'time') {
    const rows = data[event]?.[sex]?.[band];
    if (!rows) return null;
    const fastest = rows[0];
    const slowest = rows[rows.length - 1];
    return Object.freeze({
      component,
      event,
      unit: 'time',
      // `value` is the same bound as `label`, in the unit the UI collects: the
      // slider needs a number, and inventing one from the label would be a
      // second place that knows how a chart is read.
      best: {
        points: fastest.points,
        label: `${fastest.max_time} or faster`,
        value: fastest.max_seconds
      },
      floor: { points: slowest.points, label: slowest.max_time, isFloor: true,
        value: slowest.max_seconds },
      maxPoints,
      minimumPoints
    });
  }

  // reps, shuttles and plank seconds all read the same way off their charts.
  const measure = MEASURES[kind];
  const rows = kind === 'reps'
    ? data.rep_events[event]?.[sex]?.[band]
    : data[TABLES[event].path]?.[sex]?.[band];
  if (!rows) return null;

  const top = rows[0];
  const bottom = rows[rows.length - 1];
  return Object.freeze({
    component,
    event,
    unit: measure.key === 'seconds' ? 'time' : measure.key,
    best: {
      points: top.points,
      label: measure.atLeast(top[measure.field]),
      value: top[measure.field]
    },
    floor: {
      points: bottom.points,
      label: measure.show(bottom[measure.field]),
      isFloor: true,
      value: bottom[measure.field]
    },
    maxPoints,
    minimumPoints
  });
}

/**
 * The whole scoring table for one event, as rows a page can print.
 *
 * The same numbers the score came from, so a cadet can check the lookup rather
 * than take it on trust. Each row carries the band it covers rather than just
 * its own threshold: the chart lists "52", "50", "48" and means 52-and-up,
 * 50-to-51, 48-to-49, and a cadet reading it should not have to work that out.
 *
 * Row order is the publication's: best first. `index` matches the
 * `chartRowIndex` a scored component reports, which is how the page knows which
 * row to mark.
 */
export function chartFor(data, { event, sex, band, heightInches }) {
  const kind = EVENT_KINDS[event];
  const minimumPoints = data.component_minimums[componentOfEvent(data, event)];

  if (kind === 'ratio') {
    const height = heightInches ? Math.round(heightInches * 2) / 2 : null;
    return Object.freeze({
      event, kind, unit: 'ratio',
      columns: Object.freeze(height ? ['Ratio', 'Waist', 'Points'] : ['Ratio', 'Points']),
      rows: Object.freeze(data.whtr.map((row, index) => {
        // Both ends of the band this row covers, in the inches a cadet can act
        // on. Searched rather than solved, for the reason waistBoundary gives.
        let waist = null;
        if (height) {
          const hi = row.max_ratio != null ? null
            : waistBoundary(height, Math.round((row.min_ratio ?? row.ratio) * 100), 'atLeast');
          const lo = row.min_ratio != null ? null
            : waistBoundary(height, Math.round((row.max_ratio ?? row.ratio) * 100), 'atMost');
          waist = row.max_ratio != null ? `${lo?.toFixed(1)} in or less`
            : row.min_ratio != null ? `${hi?.toFixed(1)} in or more`
              : (hi != null && lo != null && hi !== lo)
                ? `${hi.toFixed(1)}–${lo.toFixed(1)} in`
                : `${(hi ?? lo)?.toFixed(1)} in`;
        }
        return Object.freeze({
          index,
          label: row.note ?? row.ratio.toFixed(2),
          detail: waist,
          points: row.points,
          isMinimum: false
        });
      }))
    });
  }

  if (kind === 'walk') {
    const row = data.walk_2km?.[sex]?.[data.walk_age_groups[band]];
    if (!row) return null;
    return Object.freeze({
      event, kind, unit: 'time',
      columns: Object.freeze(['Maximum time', 'Result']),
      rows: Object.freeze([Object.freeze({
        index: 0, label: `${row.max_time} or faster`, detail: null,
        points: null, resultLabel: 'Pass', isMinimum: true
      }), Object.freeze({
        index: 1, label: `slower than ${row.max_time}`, detail: null,
        points: null, resultLabel: 'Fail', isMinimum: false
      })])
    });
  }

  if (kind === 'time') {
    const rows = data[event]?.[sex]?.[band];
    if (!rows) return null;
    return Object.freeze({
      event, kind, unit: 'time',
      columns: Object.freeze(['Time', 'Points']),
      rows: Object.freeze(rows.map((row, index) => Object.freeze({
        index,
        // Each row is a ceiling: anything faster than the row above it and no
        // slower than this one.
        label: index === 0
          ? `${row.max_time} or faster`
          : `${formatTime(rows[index - 1].max_seconds + 1)}–${row.max_time}`,
        detail: null,
        points: row.points,
        isMinimum: row.points === minimumPoints
      })))
    });
  }

  const measure = MEASURES[kind];
  const rows = kind === 'reps'
    ? data.rep_events[event]?.[sex]?.[band]
    : data[TABLES[event].path]?.[sex]?.[band];
  if (!rows) return null;

  const field = measure.field;
  // A plank is a time and reps are a count, so the two ends of a band have to
  // be formatted the same way or a row reads "3:35-219".
  const bare = kind === 'hold' ? formatTime : (v) => String(v);
  const suffix = kind === 'hold' ? '' : ` ${measure.noun}s`;

  return Object.freeze({
    event, kind, unit: measure.key,
    columns: Object.freeze([
      kind === 'hold' ? 'Hold' : measure.key === 'reps' ? 'Reps' : 'Shuttles', 'Points']),
    rows: Object.freeze(rows.map((row, index) => {
      const low = row[field];
      const high = index === 0 ? null : rows[index - 1][field] - 1;
      return Object.freeze({
        index,
        label: index === 0 ? measure.atLeast(low)
          : low === high ? `${bare(low)}${suffix}`
            : `${bare(low)}–${bare(high)}${suffix}`,
        detail: null,
        points: row.points,
        isMinimum: row.points === minimumPoints
      });
    }))
  });
}

/** Which component an event belongs to, from the data file's own map. */
function componentOfEvent(data, event) {
  for (const [component, events] of Object.entries(data.events)) {
    if (events.includes(event)) return component;
  }
  return 'body_composition';
}

/**
 * Whether a score would earn the AFROTC Fitness Award.
 *
 * AFROTCI 36-2011 Volume 3, 24 June 2026, Table 15.1:
 *   Fitness Award              95 or above on the PFRA, once per term.
 *   Fitness Award Silver Star  100 on the PFRA, first time at the detachment.
 *
 * This reports eligibility on the numbers only. Whether a given assessment is
 * the member's official PFRA for the term, and whether they have already had the
 * award this term or the device at this detachment, are detachment records --
 * so the page says "if this is your official PFRA" rather than announcing a
 * ribbon.
 *
 * The award is a cadet award, which the caller decides; this stays a pure
 * function of the result so it can be tested without a page around it.
 */
export function fitnessAward(data, result) {
  const threshold = 95;
  const perfect = data.composite.max;
  const blockers = [];

  if (!result.pass) blockers.push('the assessment has to pass');
  if (result.exemptComponents.length > 0) {
    blockers.push('no component may be exempt');
  }
  // "Must test on the standard 3 components": an alternate event is authorised
  // by the DAFMAN but is not what the AFROTC assessment is.
  const alternates = COMPONENTS
    .filter((c) => c !== 'body_composition')
    .filter((c) => !DET250_EVENTS.includes(result.components[c].event));
  if (alternates.length > 0) {
    blockers.push('all three events have to be the AFROTC ones');
  }

  const meets = result.composite >= threshold;
  const eligible = meets && blockers.length === 0;

  return Object.freeze({
    threshold,
    meetsThreshold: meets,
    eligible,
    // A perfect score earns the device as well, the first time at a detachment.
    tier: !eligible ? null : result.composite >= perfect ? 'silver_star' : 'ribbon',
    blockers: Object.freeze(blockers),
    reference: 'afrotci.15.1'
  });
}

// --- public API ------------------------------------------------------------

/**
 * Build a scorer bound to a set of scoring tables.
 *
 * @param {object} data parsed pfra-scoring-data.json
 */
export function createScorer(data) {
  if (!data || !data.composite || !data.rep_events) {
    throw new TypeError('createScorer needs the parsed pfra-scoring-data.json');
  }

  function eventsFor(component) {
    return data.events[component] ?? [];
  }

  function scoreComponent(component, entry, sex, band, altitude) {
    const allowed = eventsFor(component);
    const event = entry?.event ?? allowed[0];
    if (!allowed.includes(event)) {
      throw new RangeError(
        `${event} is not a ${COMPONENT_LABELS[component]} event; expected one of ${allowed.join(', ')}`);
    }
    const kind = EVENT_KINDS[event];
    const status = declaredStatus(entry);

    if (kind === 'reps' || kind === 'shuttles' || kind === 'hold') {
      const value = status ? null : kind === 'hold'
        ? parseTime(entry?.time ?? entry?.seconds)
        : entry?.[MEASURES[kind].key];
      return scoreAscendingComponent(data,
        { component, event, kind, sex, band, value, status, altitude });
    }
    if (kind === 'time') {
      const seconds = status ? null : parseTime(entry?.time ?? entry?.seconds);
      return scoreRunComponent(data,
        { component, event, sex, band, seconds, status, altitude });
    }
    if (kind === 'walk') {
      const seconds = status ? null : parseTime(entry?.time ?? entry?.seconds);
      return scoreWalkComponent(data,
        { component, event, sex, band, seconds, status, altitude });
    }
    if (kind === 'ratio') {
      return scoreWhtrComponent(data, { component, event, ...entry, status });
    }
    throw new RangeError(`no lookup implemented for event ${event}`);
  }

  /**
   * Score a full assessment.
   *
   * @param {object} input age or ageBand, sex, and one entry per component.
   * @returns {object} frozen result with per-component detail, composite and pass state.
   */
  function score(input) {
    const sex = normalizeSex(input.sex);
    const band = normalizeBand(data, input);

    // One lookup for the whole assessment: the test altitude is a property of
    // where it was administered, not of any one event.
    const altitude = resolveAltitude(data, input);

    const components = {};
    for (const component of COMPONENTS) {
      components[component] =
        Object.freeze(scoreComponent(component, input[component], sex, band, altitude));
    }

    /*
     * The composite is scored over the components that were actually assessed.
     *
     * With nothing exempt that is all four, the divisor is 100, and this is the
     * plain sum it has always been. Exempt a component and its points leave the
     * total on both sides.
     *
     * The manual does not print this arithmetic, but it forces it. Para 3.7.3
     * says a member who passes the 2 kilometer walk "will have a composite
     * score calculated based on the assessed components", and para 3.10.2 says
     * such a member is eligible for Satisfactory, which is 75 to 89.9. Exempting
     * cardiorespiratory leaves 50 points on the board, so 75 is unreachable
     * unless the remaining components are scaled. Scaling is the only reading
     * on which the two paragraphs can both be true.
     */
    const assessed = COMPONENTS.filter((c) => components[c].status !== STATUS.EXEMPT);
    const earned = sumPoints(assessed.map((c) => components[c].points));
    const available = sumPoints(assessed.map((c) => data.composite.components[c]));
    const composite = available === 0 ? 0
      : available === data.composite.max ? earned
        : roundTo(earned / available * 100, 1);
    const exempted = COMPONENTS.filter((c) => components[c].status === STATUS.EXEMPT);

    const failures = [];

    // The walk carries a standard even though it carries no points.
    for (const component of COMPONENTS) {
      const walk = components[component].walk;
      if (walk && !walk.passed) {
        failures.push({
          code: FAILURE.WALK_STANDARD_NOT_MET,
          component,
          message:
            `2 kilometer walk: ${formatTime(walk.seconds)} is slower than the ` +
            `${walk.maxTime} maximum, so the assessment fails.`
        });
      }
    }

    for (const component of COMPONENTS) {
      const result = components[component];
      if (!PASSING_STATUSES.includes(result.status)) {
        failures.push({
          code: result.status === STATUS.BELOW_MINIMUM
            ? FAILURE.COMPONENT_BELOW_MINIMUM
            : FAILURE.COMPONENT_NOT_COMPLETED,
          component,
          message: `${COMPONENT_LABELS[component]} (${result.eventLabel}): ${result.explanation}`
        });
      } else if (!result.meetsMinimum) {
        failures.push({
          code: FAILURE.COMPONENT_BELOW_MINIMUM,
          component,
          message:
            `${COMPONENT_LABELS[component]} scored ${result.points.toFixed(1)} points, below the ` +
            `${result.minimumPoints.toFixed(1)} point minimum.`
        });
      }
    }

    const passingComposite = data.composite.passing_composite;
    const compositeMeetsMinimum = composite >= passingComposite;
    if (!compositeMeetsMinimum) {
      failures.push({
        code: FAILURE.COMPOSITE_BELOW_MINIMUM,
        component: null,
        message:
          `Composite ${composite.toFixed(1)} is below the ${passingComposite.toFixed(1)} ` +
          `required to pass, short by ${roundTo(passingComposite - composite, 1).toFixed(1)} points.`
      });
    }

    const pass = failures.length === 0;

    /*
     * Excellent is off the board once anything is exempt.
     *
     * Para 3.6.1 defines the three categories "when assessing all components",
     * so an assessment with a component exempt is outside the sentence that
     * creates Excellent in the first place. Para 3.10.1 then gives the
     * Excellent category to members "without any component exemptions", and
     * para 3.10.2 gives Satisfactory on the same terms but adds a Note putting
     * walk members in it. Read together: exempt a component and the best
     * available rating is Satisfactory, whatever the arithmetic says.
     *
     * The walk was already handled here, by its own para 3.7.3 sentence. It is
     * not a separate rule -- a walk member is component exempt under para
     * 3.6.2, so scoreWalkComponent returns STATUS.EXEMPT and the general test
     * below already covers it. The cap stays on the rating rather than on the
     * number, because the number is still the composite that gets recorded.
     */
    const rating = !pass ? 'Unsatisfactory'
      : (composite >= 90 && exempted.length === 0) ? 'Excellent' : 'Satisfactory';

    // A composite that would have been Excellent but for an exemption is the
    // one result a member is most likely to read wrong, so say outright that
    // it happened rather than leaving "Satisfactory" beside a 92.
    const excellentWithheld = pass && composite >= 90 && exempted.length > 0;

    const warnings = COMPONENTS.flatMap((c) => components[c].warnings ?? []);
    const citationIds = [...new Set([
      'notacc.events',
      'notacc.hrpu',
      'notacc.whtr',
      'dafman.3.6.1',
      'dafman.3.7.1',
      // Only when something is exempt: these are the paragraphs that scale the
      // composite and cap the rating, and on an ordinary assessment neither
      // does anything worth a citation.
      ...(exempted.length > 0 ? ['dafman.3.10.1', 'dafman.3.10.2'] : []),
      ...COMPONENTS.flatMap((c) => components[c].references ?? [])
    ])];

    return Object.freeze({
      sex,
      ageBand: band,
      ageBandLabel: data.age_band_ranges[band],
      age: input.age ?? null,
      components: Object.freeze(components),
      altitudeFeet: input.altitudeFeet ?? null,
      altitudeGroup: altitude,
      altitudeLabel: altitude ? `${altitude.label} (${altitude.range_label})` : null,
      composite,
      compositeText: composite.toFixed(1),
      // Both halves of the fraction, so the UI can print the arithmetic rather
      // than assert the result of it. With nothing exempt these are the plain
      // sum and 100, and the division is the identity.
      compositeEarned: earned,
      compositeOutOf: available,
      exemptComponents: Object.freeze(exempted),
      excellentWithheld,
      passingComposite,
      compositeMeetsMinimum,
      pass,
      rating,
      failures: Object.freeze(failures),
      warnings: Object.freeze(warnings),
      references: Object.freeze(resolveReferences(citationIds)),
      publication: PUBLICATION,
      charts: CHARTS,
      notacc: NOTACC
    });
  }

  return Object.freeze({
    score,
    ageBandFor,
    eventsFor,
    /** Chart bounds for one component, for a given sex and age band. */
    rangeFor: (query) => rangeFor(data, query),
    hamrLevel: (shuttles) => hamrLevelFor(data, shuttles),
    fitnessAward: (result) => fitnessAward(data, result),
    chartFor: (query) => chartFor(data, query),
    /** Circumference value from tape measurements, per Attachment 8. */
    circumferenceValue: (sex, sites) => circumferenceValueFor(sex, sites),
    /** Body fat percent off Attachment 9 or Attachment 10. */
    bodyFatPercent: (query) => bodyFatPercent(data, query),
    /** A whole body fat assessment, measurements in and pass or fail out. */
    bodyFatAssessment: (query) => bodyFatAssessment(data, query),
    data
  });
}
