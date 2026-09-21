/**
 * Gap analysis and target mode.
 *
 * The scoring engine answers "what did I score". This module answers the two
 * questions a cadet actually has next: what do I have to fix, and what is the
 * cheapest way to get where I want to be.
 *
 * Two ideas shape the output:
 *
 *   1. Mandatory work comes before optional work. A component below its
 *      minimum fails the assessment no matter what the composite says, so
 *      clearing every floor is not one option among several. It is the first
 *      thing, and it is reported separately from the ranked choices.
 *
 *   2. Ranking across components is honest about units. One rep and one second
 *      are not comparable, so each path carries its own unit and the ranking
 *      says what it sorted on rather than pretending to a single currency.
 *
 * Det 250 cadets test on hand release push-ups, sit-ups and the 2 mile run
 * only, so nothing here ever suggests switching events.
 */

import {
  COMPONENTS, COMPONENT_LABELS, STATUS, formatTime, MEASURES, EVENT_KINDS, TABLES,
  EVENT_PHRASES
} from './engine.js?v=15f69bf33c';

const TRAINABLE_SOON = Object.freeze(['muscular_strength', 'core_endurance', 'cardiorespiratory']);

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sumPoints(values) {
  return values.reduce((acc, v) => acc + Math.round(v * 10), 0) / 10;
}

// --- per component improvement ladders -------------------------------------

/**
 * Every row a member could still climb to on their own chart.
 *
 * Ordered cheapest first: rung 0 is the smallest improvement that gains
 * anything, the last rung is the chart maximum. Each rung says what the member
 * must reach, how much further that is from where they are now, and what the
 * component would then score. A member below the chart floor starts from zero
 * points, so their first rung is the floor.
 */
function ladderFor(data, result, component) {
  const scored = result.components[component];
  const { event } = scored;
  const currentPoints = scored.points;

  if (event === 'whtr') {
    if (!scored.measured) return [];
    const { ratio, heightInches } = scored.measured;
    const index = scored.chartRowIndex;
    const rungs = [];
    for (let i = index - 1; i >= 0; i -= 1) {
      const row = data.whtr[i];
      const targetRatio = row.ratio ?? row.max_ratio;
      // Largest waist whose truncated ratio still lands on this row.
      const maxWaist = heightInches
        ? Math.floor((targetRatio + 0.0099) * heightInches * 2) / 2
        : null;
      rungs.push({
        points: row.points,
        gain: roundTo(row.points - currentPoints, 1),
        reach: { ratio: targetRatio, waistInches: maxWaist },
        distance: { ratio: roundTo(ratio - targetRatio, 2) },
        unit: '0.01 of ratio',
        steps: Math.round((ratio - targetRatio) * 100),
        label: maxWaist != null
          ? `a waist of ${maxWaist.toFixed(1)} inches scores ${row.points.toFixed(1)}`
          : `a ratio of ${targetRatio.toFixed(2)} scores ${row.points.toFixed(1)}`
      });
    }
    return rungs;
  }

  if (event === 'run_2mile') {
    if (!scored.measured) return [];
    const rows = data.run_2mile[result.sex][result.ageBand];
    const seconds = scored.measured.seconds;
    const start = scored.chartRowIndex === -1 ? rows.length - 1 : scored.chartRowIndex - 1;
    const rungs = [];
    for (let i = start; i >= 0; i -= 1) {
      const row = rows[i];
      const cut = seconds - row.max_seconds;
      if (cut <= 0) continue;
      rungs.push({
        points: row.points,
        gain: roundTo(row.points - currentPoints, 1),
        reach: { seconds: row.max_seconds, time: row.max_time },
        distance: { seconds: cut },
        direction: 'faster',
        unit: 'second',
        steps: cut,
        label: `${row.max_time} or faster scores ${row.points.toFixed(1)}`
      });
    }
    return rungs;
  }

  // Everything else is a "more is better" chart: reps, HAMR shuttles, plank
  // seconds. One loop covers all three; only the column and the wording differ.
  const kind = EVENT_KINDS[event];
  const measure = MEASURES[kind];
  if (!measure) return [];

  const value = scored.measured?.[measure.key];
  if (value == null) return [];

  const rows = kind === 'reps'
    ? data.rep_events[event][result.sex][result.ageBand]
    : data[TABLES[event].path][result.sex][result.ageBand];

  const start = scored.chartRowIndex === -1 ? rows.length - 1 : scored.chartRowIndex - 1;
  const rungs = [];
  for (let i = start; i >= 0; i -= 1) {
    const row = rows[i];
    const target = row[measure.field];
    const more = target - value;
    if (more <= 0) continue;
    rungs.push({
      points: row.points,
      gain: roundTo(row.points - currentPoints, 1),
      reach: measure.key === 'seconds'
        ? { seconds: target, time: formatTime(target) }
        : { [measure.key]: target },
      distance: { [measure.key]: more },
      direction: measure.key === 'seconds' ? 'longer' : null,
      unit: measure.key === 'seconds' ? 'second' : measure.noun,
      steps: more,
      label: `${measure.show(target)} scores ${row.points.toFixed(1)}`
    });
  }
  return rungs;
}

/** The cheapest rung that reaches at least `points`, or null if unreachable. */
function rungForPoints(ladder, points, currentPoints) {
  if (currentPoints >= points) return null;
  let best = null;
  for (const rung of ladder) {
    if (rung.points >= points && (best === null || rung.steps < best.steps)) {
      best = rung;
    }
  }
  return best;
}

// --- gap analysis ----------------------------------------------------------

/**
 * What stands between this member and a passing assessment.
 *
 * Returns mandatory work first (component floors, which are not optional),
 * then the projected composite once that work is done, then ranked ways to
 * close whatever composite gap remains.
 */
export function analyzeGap(data, result) {
  const passingComposite = data.composite.passing_composite;

  /*
   * Everything below counts in raw component points, but the composite may be
   * scored over fewer than 100 of them: a member on the 2 kilometer walk has
   * cardiorespiratory exempt, so 50 points of chart are worth 100 of composite.
   *
   * Rather than scale every rung, the passing mark is converted into the same
   * raw points the ladders are already in, and the numbers that get shown to a
   * cadet are converted back. With nothing exempt the scale is 1 and this is
   * the arithmetic it has always been.
   */
  const scale = result.compositeOutOf > 0
    ? data.composite.max / result.compositeOutOf : 1;
  const assessed = COMPONENTS.filter(
    (c) => result.components[c].status !== STATUS.EXEMPT);
  const requiredPoints = roundTo(passingComposite / scale, 1);

  const ladders = {};
  for (const component of assessed) {
    ladders[component] = ladderFor(data, result, component);
  }

  // --- mandatory: every component below its minimum must be cleared --------
  const mandatory = [];
  const projectedPoints = {};

  for (const component of assessed) {
    const scored = result.components[component];
    projectedPoints[component] = scored.points;

    const minimum = scored.minimumPoints;
    if (minimum == null) continue;

    const failing = scored.status !== STATUS.SCORED || !scored.meetsMinimum;
    if (!failing) continue;

    if (scored.status === STATUS.DNS || scored.status === STATUS.DNF) {
      mandatory.push({
        component,
        componentLabel: COMPONENT_LABELS[component],
        event: scored.event,
        eventLabel: scored.eventLabel,
        reason: scored.status,
        requirement: null,
        message:
          `${scored.eventLabel} was recorded as ${scored.status.toUpperCase()}. ` +
          'The component must be assessed; there is no score to improve on.'
      });
      continue;
    }

    const rung = rungForPoints(ladders[component], minimum, scored.points);
    if (!rung) continue;
    projectedPoints[component] = rung.points;
    mandatory.push({
      component,
      componentLabel: COMPONENT_LABELS[component],
      event: scored.event,
      eventLabel: scored.eventLabel,
      reason: 'below_minimum',
      requirement: rung,
      message:
        `${scored.eventLabel} must reach ${rung.label.replace(/ scores .*/, '')} to clear the ` +
        `${minimum.toFixed(1)} point minimum. Below it the assessment fails whatever the composite.`
    });
  }

  const projectedPointsTotal = sumPoints(assessed.map((c) => projectedPoints[c]));
  const projectedComposite = roundTo(projectedPointsTotal * scale, 1);

  // Two views of the same shortfall: `remainingGapPoints` is what the ladders
  // are measured in, `remainingGap` is what a cadet is told.
  const remainingGapPoints = roundTo(Math.max(0, requiredPoints - projectedPointsTotal), 1);
  const remainingGap = roundTo(remainingGapPoints * scale, 1);

  // --- ranked ways to close the remaining composite gap -------------------
  const paths = [];
  for (const component of assessed) {
    const scored = result.components[component];
    if (scored.status === STATUS.DNS || scored.status === STATUS.DNF) continue;

    const ladder = ladderFor(data, result, component);
    const floorPoints = projectedPoints[component];
    const rungs = ladder.filter((r) => r.points > floorPoints);
    if (rungs.length === 0) continue;

    const nextStep = rungs[0];  // rungs are cheapest first
    const headroom = roundTo(scored.maxPoints - floorPoints, 1);
    const closesGap = remainingGapPoints > 0
      ? rungForPoints(ladder, roundTo(floorPoints + remainingGapPoints, 1), floorPoints)
      : null;

    paths.push({
      component,
      componentLabel: COMPONENT_LABELS[component],
      event: scored.event,
      eventLabel: scored.eventLabel,
      unit: nextStep.unit,
      currentPoints: scored.points,
      floorPoints,
      maxPoints: scored.maxPoints,
      headroom,
      canCloseGapAlone: remainingGapPoints > 0 ? closesGap !== null : null,
      nextStep,
      closesGap,
      pointsPerUnit: roundTo(nextStep.gain / nextStep.steps, 4),
      trainableSoon: TRAINABLE_SOON.includes(component),
      ladder: rungs
    });
  }

  // Ranking note: reps, seconds and hundredths of a ratio are not a common
  // currency, so this sort is a presentation heuristic, not a claim that six
  // reps and six seconds cost the same. Paths that can close the gap on their
  // own come first, ordered by how many units of their own measure it takes,
  // and the UI shows the unit beside every number so a cadet judges for
  // themselves. Body composition sorts after the trainable components even
  // when its step count is lower, because a waist measurement is not something
  // a cadet changes between now and a retest the way reps and pace are.
  paths.sort((a, b) => {
    if (a.closesGap && !b.closesGap) return -1;
    if (b.closesGap && !a.closesGap) return 1;
    if (a.trainableSoon !== b.trainableSoon) return a.trainableSoon ? -1 : 1;
    if (a.closesGap && b.closesGap) return a.closesGap.steps - b.closesGap.steps;
    return b.headroom - a.headroom;
  });

  const wouldPass = remainingGapPoints === 0
    && mandatory.every((m) => m.requirement !== null);

  return Object.freeze({
    passing: result.pass,
    passingComposite,
    composite: result.composite,
    projectedComposite,
    remainingGap,
    remainingGapPoints,
    compositeScale: scale,
    mandatory: Object.freeze(mandatory),
    paths: Object.freeze(paths),
    cheapest: paths.find((p) => p.closesGap) ?? null,
    achievable: wouldPass || paths.some((p) => p.closesGap),
    rankedBy:
      'Paths that can close the gap alone first, trainable components before body ' +
      'composition, then by steps in each component’s own unit. Reps, seconds and ' +
      'ratio hundredths are not interchangeable; show the unit with every number.',
    summary: summarize(result, mandatory, remainingGap, paths, projectedComposite, scale)
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeDistance(rung) {
  if (rung.distance.reps != null) return plural(rung.distance.reps, 'more rep');
  if (rung.distance.shuttles != null) return plural(rung.distance.shuttles, 'more shuttle');
  if (rung.distance.seconds != null) {
    // A run wants seconds cut off; a plank wants seconds added on. The rung
    // carries which, because the number alone does not say.
    return `${plural(rung.distance.seconds, 'second')} ${rung.direction}`;
  }
  return `${plural(Math.round(rung.distance.ratio * 100), 'hundredth')} off the ratio`;
}

function summarize(result, mandatory, remainingGap, paths, projectedComposite, scale) {
  if (result.pass) {
    return `Passing at ${result.composite.toFixed(1)}. Every component meets its minimum.`;
  }

  const parts = [];
  if (mandatory.length > 0) {
    // Leading with "below the minimum on X" keeps the sentence correct whether
    // X is singular or plural, which "Push-ups is below" would not be.
    const names = mandatory.map((m) => EVENT_PHRASES[m.event] ?? m.eventLabel).join(' and ');
    parts.push(
      `Below the component minimum on ${names}. That has to be fixed first: a failed ` +
      'component fails the assessment whatever the composite says.');
  }

  if (remainingGap === 0) {
    if (mandatory.length > 0) {
      parts.push(`Clearing that alone reaches ${projectedComposite.toFixed(1)}, which passes.`);
    }
    return parts.join(' ');
  }

  const cheapest = paths.find((p) => p.closesGap);
  parts.push(mandatory.length > 0
    ? `After that the composite is still ${remainingGap.toFixed(1)} short.`
    : `Every component meets its minimum, but the composite is ${remainingGap.toFixed(1)} ` +
      `short of ${result.passingComposite.toFixed(1)}.`);
  if (cheapest) {
    // The gain is in chart points; the gap a cadet was just quoted is in
    // composite points. They are the same number unless a component is exempt,
    // and telling someone a 15 point gap closes with 7.5 points is no help.
    const gain = roundTo(cheapest.closesGap.gain * scale, 1);
    parts.push(
      `The cheapest single route is ${EVENT_PHRASES[cheapest.event]}: ` +
      `${describeDistance(cheapest.closesGap)} is worth ${gain.toFixed(1)} points.`);
  } else {
    parts.push('No single component can close it; improvement has to come from more than one.');
  }
  return parts.join(' ');
}

// --- target mode -----------------------------------------------------------

/**
 * Ways to reach a target composite.
 *
 * Returns the single-component route for each component that can get there on
 * its own, plus a spread route that shares the work out, plus the route using
 * the fewest components. Every plan also satisfies the component minimums,
 * because a plan that reaches 90 with a failed component is not a plan.
 */
export function planForTarget(data, result, target) {
  if (typeof target !== 'number' || Number.isNaN(target)) {
    throw new RangeError(`target composite must be a number, got ${JSON.stringify(target)}`);
  }
  const max = data.composite.max;
  if (target < 0 || target > max) {
    throw new RangeError(`target composite must be between 0 and ${max}, got ${target}`);
  }

  const gap = analyzeGap(data, result);
  const ladders = {};
  const floorPoints = {};
  for (const component of COMPONENTS) {
    ladders[component] = ladderFor(data, result, component);
    const mandatoryFix = gap.mandatory.find((m) => m.component === component);
    floorPoints[component] = mandatoryFix?.requirement?.points
      ?? result.components[component].points;
  }

  const base = sumPoints(COMPONENTS.map((c) => floorPoints[c]));
  const needed = roundTo(Math.max(0, target - base), 1);

  const blocked = gap.mandatory.filter((m) => m.requirement === null);
  if (blocked.length > 0) {
    return Object.freeze({
      target,
      reachable: false,
      needed,
      mandatory: gap.mandatory,
      plans: Object.freeze([]),
      note: `${blocked.map((b) => b.eventLabel).join(' and ')} must be assessed before a ` +
        'target can be planned.'
    });
  }

  const plans = [];

  if (needed === 0) {
    plans.push(Object.freeze({
      kind: 'already_there',
      total: base,
      steps: Object.freeze([]),
      label: `Clearing the component minimums alone reaches ${base.toFixed(1)}.`
    }));
  }

  // One component does all the work.
  for (const component of COMPONENTS) {
    if (needed === 0) break;
    const rung = rungForPoints(ladders[component], roundTo(floorPoints[component] + needed, 1),
      floorPoints[component]);
    if (!rung) continue;
    plans.push(Object.freeze({
      kind: 'single_component',
      component,
      componentLabel: COMPONENT_LABELS[component],
      eventLabel: result.components[component].eventLabel,
      total: roundTo(base - floorPoints[component] + rung.points, 1),
      steps: Object.freeze([Object.freeze({
        component,
        eventLabel: result.components[component].eventLabel,
        rung,
        distance: describeDistance(rung)
      })]),
      label: `${result.components[component].eventLabel}: ${describeDistance(rung)} reaches ` +
        `${roundTo(base - floorPoints[component] + rung.points, 1).toFixed(1)}.`
    }));
  }

  // Share the work out across the components that can still improve. Try the
  // trainable components on their own first: reps and pace are what a cadet
  // can move before a retest, so a plan that reaches the target without
  // touching body composition is the more useful one.
  if (needed > 0) {
    const spread = spreadPlan(result, ladders, floorPoints, needed, TRAINABLE_SOON)
      ?? spreadPlan(result, ladders, floorPoints, needed, COMPONENTS);
    if (spread) plans.push(spread);
  }

  return Object.freeze({
    target,
    reachable: plans.length > 0,
    needed,
    base,
    mandatory: gap.mandatory,
    plans: Object.freeze(plans),
    note: plans.length === 0
      ? `${target.toFixed(1)} is out of reach from this assessment even at chart maximums.`
      : null
  });
}

/**
 * Share the work out instead of loading it on one component.
 *
 * Takes one rung at a time, round robin across `usable`, until the target is
 * met. Round robin rather than "best value first" on purpose: a point bought
 * with one rep and a point bought with nineteen seconds are not comparable, so
 * any greedy rule that ranks them is inventing a rate of exchange. Taking
 * turns spreads the work without pretending to.
 *
 * Returns null if `usable` cannot reach the target, so the caller can retry
 * with a wider set.
 */
function spreadPlan(result, ladders, floorPoints, needed, usable) {
  const state = {};
  for (const component of COMPONENTS) {
    state[component] = { points: floorPoints[component], taken: null };
  }

  let gained = 0;
  let guard = 0;
  while (gained < needed && guard < 500) {
    let movedThisRound = false;
    for (const component of usable) {
      if (gained >= needed) break;
      guard += 1;
      const current = state[component].points;
      // The cheapest rung above whatever this component is already committed to.
      const rung = ladders[component].find((r) => r.points > current);
      if (!rung) continue;
      state[component] = { points: rung.points, taken: rung };
      gained = roundTo(gained + (rung.points - current), 1);
      movedThisRound = true;
    }
    if (!movedThisRound) break;
  }

  if (gained < needed) return null;

  const steps = COMPONENTS
    .filter((c) => state[c].taken !== null)
    .map((c) => Object.freeze({
      component: c,
      eventLabel: result.components[c].eventLabel,
      rung: state[c].taken,
      distance: describeDistance(state[c].taken)
    }));

  if (steps.length <= 1) return null; // identical to a single component plan

  const total = sumPoints(COMPONENTS.map((c) => state[c].points));
  return Object.freeze({
    kind: 'spread',
    total,
    steps: Object.freeze(steps),
    label: `Spread across ${steps.length} components: ` +
      steps.map((s) => `${s.eventLabel.toLowerCase()} ${s.distance}`).join(', ') +
      ` reaches ${total.toFixed(1)}.`
  });
}

/** Convenience: bind both analyses to a data set. */
export function createAnalyzer(data) {
  return Object.freeze({
    analyzeGap: (result) => analyzeGap(data, result),
    planForTarget: (result, target) => planForTarget(data, result, target),
    ladderFor: (result, component) => ladderFor(data, result, component)
  });
}

export { formatTime };
