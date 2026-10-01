/**
 * Where to put the marks on a track, for an assessment run at a distance the
 * track was not painted for.
 *
 * A 400 m track has one painted finish line and painted starts for the events
 * it was built for. A PFRA is not one of those events: 2 miles is 3,218.7 m,
 * which is eight laps and 18.7 m over, so the start has to be wheeled. This
 * works out where, for each distance the detachment assesses and for each
 * track size anyone round here runs on, indoor or out.
 *
 * Two groups, because that is how a detachment tests: everyone cannot start on
 * one line. Group A keeps the painted finish line and Group B takes a line
 * half a lap around, so the two sets never occupy the same piece of track at
 * the same moment and each group counts its own crossings.
 *
 * The arithmetic is deliberately plain -- laps, a remainder, and a wheel
 * distance -- because a person with a measuring wheel has to be able to check
 * it standing on the infield. Everything here is derived rather than stored,
 * so a distance or a track size that is not on the list today needs numbers
 * rather than a new drawing.
 *
 * The shapes come from the drawings this replaced: a 400 m track as 84 m
 * straights and 116 m curves, a 300 m track as 50 m straights and 100 m
 * curves, and a 200 m indoor track as 46 m straights and 54 m curves. Real tracks vary by a metre or two in the straights, which moves
 * where a mark falls in the drawing but not how far it is wheeled, and the
 * note under the diagram says so.
 */

const FEET_PER_METRE = 3.280839895;

/**
 * Metres from a reading taken in feet.
 *
 * A measuring wheel counts in feet, so a lap that was walked out rather than
 * read off a plan arrives in feet. Everything here works in metres, and the
 * conversion belongs beside the constant rather than in the page.
 */
export const metresFromFeet = (feet) => feet / FEET_PER_METRE;

/**
 * The track sizes, as lengths of straight and curve in metres.
 *
 * Only `length` reaches the wheel distances; the straight and curve set the
 * proportions of the drawing and nothing else. That is why a real track being
 * a metre out in the straights does not matter here, and why a size can be
 * added with two numbers that sum correctly rather than with a new drawing.
 *
 * The 200 is an indoor track. Its turns are tight against its straights, the
 * way an indoor oval is built to fit inside a field house, which draws as a
 * longer, narrower ring than the outdoor sizes.
 */
export const TRACK_SHAPES = Object.freeze({
  200: Object.freeze({ length: 200, straight: 46, curve: 54 }),
  300: Object.freeze({ length: 300, straight: 50, curve: 100 }),
  400: Object.freeze({ length: 400, straight: 84, curve: 116 })
});

export const TRACK_LENGTHS = Object.freeze([200, 300, 400]);

/** Smallest and largest lap a drawing stays sensible at, in metres. */
export const TRACK_LENGTH_RANGE = Object.freeze({ min: 50, max: 1000 });

/**
 * The straight and curve to draw a lap of any length with.
 *
 * The three sizes above are drawn to the figures the hand-made layouts used.
 * Anything else is a track somebody measured themselves, and nobody has its
 * proportions, so they are derived: two fifths of the half lap in straight,
 * which sits in the middle of what the three printed sizes do (46, 33 and 42
 * per cent).
 *
 * Nothing a runner is told depends on that guess. The laps, the remainder,
 * the wheel distances, the group B offset and the pace all come from the
 * perimeter alone; the straight and the curve only decide where the marks sit
 * in the picture, which is what the note under the figure already warns about
 * for the printed sizes too.
 */
export function shapeFor(length) {
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new RangeError(`a lap length must be a positive number, got ${JSON.stringify(length)}`);
  }
  const printed = TRACK_SHAPES[length];
  if (printed) return printed;
  const half = length / 2;
  const straight = half * 0.4;
  return Object.freeze({ length, straight, curve: half - straight });
}

/**
 * The distances a detachment marks a track for.
 *
 * 2 miles is the PFRA run and 2 km the walk, which are the two this is offered
 * beside. The other two are here because the same track gets marked for them
 * in the same session: 1.5 miles is the older run still used for practice, and
 * 3 miles is what a PT session builds to.
 */
export const TRACK_DISTANCES = Object.freeze([
  Object.freeze({ id: 'mile1_5', label: '1.5 mile', metres: 1609.344 * 1.5 }),
  Object.freeze({ id: 'km2', label: '2 km', metres: 2000 }),
  Object.freeze({ id: 'mile2', label: '2 mile', metres: 1609.344 * 2 }),
  Object.freeze({ id: 'mile3', label: '3 mile', metres: 1609.344 * 3 })
]);

export const distanceById = (id) => TRACK_DISTANCES.find((d) => d.id === id) ?? null;

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Metres, and the feet a measuring wheel actually reads.
 *
 * A whole number of metres is printed as one: half a lap of a 400 is 200 m,
 * not 200.0 m, because that is a length the track was built to. A distance
 * that came out of a rounding keeps its decimal even when it lands on zero --
 * 1.5 miles leaves 14.016 m over, and printing that as "14 m" would claim an
 * exactness the number does not have. The drawings this replaced make the
 * same distinction, and matching them means cadre holding a printed copy and
 * cadre holding a phone read the same figures.
 */
function span(metres) {
  const whole = Number.isInteger(metres);
  const feet = round1(metres * FEET_PER_METRE);
  const shownMetres = whole ? metres : round1(metres).toFixed(1);
  const shownFeet = whole && Number.isInteger(feet) ? feet : feet.toFixed(1);
  return Object.freeze({
    metres: round1(metres),
    feet,
    label: `${Number(shownMetres).toLocaleString(undefined,
      { minimumFractionDigits: whole ? 0 : 1, maximumFractionDigits: 1 })} m / ` +
      `${Number(shownFeet).toLocaleString(undefined,
        { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ft`
  });
}

/**
 * The marks for one distance on one track.
 *
 * The remainder is what is left after the whole laps, and it is where the
 * start goes: r metres *behind* the finish line, so the runner crosses that
 * line r metres in and then runs whole laps. Wheeling backwards past the half
 * lap is a long walk with a wheel and lands the mark on the far side of the
 * track anyway, so once the remainder passes half a lap the same point is
 * given as a shorter wheel forwards -- one lap less the remainder. It is the
 * same spot on the ground either way.
 */
export function trackPlan({ distanceId, trackLength }) {
  const distance = distanceById(distanceId);
  if (!distance) throw new RangeError(`unknown track distance ${JSON.stringify(distanceId)}`);
  const shape = shapeFor(trackLength);

  const laps = Math.floor(distance.metres / shape.length);
  const remainder = distance.metres - laps * shape.length;
  const exact = round1(remainder) === 0;

  // Where the start sits, measured along the running direction from the
  // finish line, as the wheel is actually pushed: backwards is negative.
  // Both readings name the same spot -- they differ by a whole lap -- but
  // which one is used has to be the one on the instruction, or the "from the
  // painted line" distance below comes out on the wrong side of it.
  const forwards = !exact && remainder > shape.length / 2;
  const startOffset = exact ? 0 : (forwards ? shape.length - remainder : -remainder);
  const wheel = exact ? null : span(Math.abs(startOffset));

  // Half a lap: on every size that is one curve plus one straight, which puts
  // Group B's line at the far end of the opposite straight.
  const groupBOffset = shape.length / 2;

  return Object.freeze({
    distance,
    shape,
    laps,
    remainder: round1(remainder),
    // Printed with its decimal for the same reason the wheel distances are:
    // 1.5 miles leaves 14.016 m over, and "14 m" would claim an exactness the
    // number does not have.
    remainderLabel: Number.isInteger(remainder)
      ? String(remainder)
      : round1(remainder).toFixed(1),
    exact,
    // Every crossing of a group's own line counts, including the one the
    // runner makes on the way past it at the start of the first lap.
    crossings: exact ? laps : laps + 1,
    lap: span(shape.length),
    total: span(distance.metres),
    start: exact ? null : Object.freeze({
      direction: forwards ? 'forward' : 'back',
      wheel,
      offset: startOffset
    }),
    groupB: Object.freeze({
      offset: groupBOffset,
      fromA: span(groupBOffset),
      // The other way to find B's start without first marking B's finish:
      // one wheel from the line that is already painted. Wrapped into a
      // single lap, because a wheel reading is a distance and not an offset.
      startFromA: exact
        ? null
        : span(((groupBOffset + startOffset) % shape.length + shape.length) % shape.length)
    })
  });
}

/**
 * A point on the lane 1 line, measured along the running direction from the
 * finish line.
 *
 * The finish line sits at the end of the bottom straight and running is
 * counterclockwise, so the path from there is: the right curve, the top
 * straight travelling left, the left curve, then the bottom straight back to
 * where it started. Distances wrap, and a negative distance runs backwards,
 * which is what a start wheeled behind the line needs.
 *
 * Returns the point in metres on a centred grid, with the outward normal, so
 * a caller can draw a mark across the track rather than a dot beside it.
 */
export function pointOnTrack(trackLength, metres) {
  const shape = shapeFor(trackLength);

  const radius = shape.curve / Math.PI;
  const half = shape.straight / 2;
  let along = metres % shape.length;
  if (along < 0) along += shape.length;

  // Leg 1: the right curve, from the bottom right corner up to the top right.
  if (along <= shape.curve) {
    // Angle runs from straight down to straight up, through the right side.
    const theta = Math.PI * (along / shape.curve);
    const nx = Math.sin(theta);
    const ny = Math.cos(theta);
    return Object.freeze({ x: half + radius * nx, y: radius * ny, nx, ny });
  }
  along -= shape.curve;

  // Leg 2: the top straight, travelling right to left.
  if (along <= shape.straight) {
    return Object.freeze({ x: half - along, y: -radius, nx: 0, ny: -1 });
  }
  along -= shape.straight;

  // Leg 3: the left curve, from the top left corner down to the bottom left.
  if (along <= shape.curve) {
    const theta = Math.PI * (along / shape.curve);
    const nx = -Math.sin(theta);
    const ny = -Math.cos(theta);
    return Object.freeze({ x: -half + radius * nx, y: radius * ny, nx, ny });
  }
  along -= shape.curve;

  // Leg 4: the bottom straight, travelling left to right, back to the finish.
  return Object.freeze({ x: -half + along, y: radius, nx: 0, ny: 1 });
}

/** The oval's own size in metres, for fitting it to a viewBox. */
export function trackExtent(trackLength) {
  const shape = shapeFor(trackLength);
  const radius = shape.curve / Math.PI;
  return Object.freeze({
    radius,
    halfStraight: shape.straight / 2,
    width: shape.straight + 2 * radius,
    height: 2 * radius
  });
}

/**
 * A lap split, to a tenth.
 *
 * Tenths because that is what a watch shows and what a split is called off
 * one. Rounded before it is split into minutes and seconds, so 119.97 reads
 * 2:00.0 rather than 1:60.0.
 */
function clock(seconds) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/**
 * How fast each lap has to be to finish a distance in a given time.
 *
 * Even pace, which is what a pace plan is for: the distance divided into the
 * time, then multiplied back up by a lap.
 *
 * The laps are not the whole story on a track that the distance does not
 * divide. A 2 mile on a 400 is eight laps and 18.7 m over, and that 18.7 m is
 * run first: the start is wheeled off the finish line precisely so the runner
 * covers it before the first crossing. Eight laps at the right pace is still
 * short of the time if the opening piece was run at a different one, so it
 * gets its own split rather than being left for the runner to absorb.
 */
export function lapPace({ distanceId, trackLength, seconds }) {
  if (!(seconds > 0)) {
    throw new RangeError('a lap pace needs a target time greater than zero');
  }
  const plan = trackPlan({ distanceId, trackLength });
  const perMetre = seconds / plan.distance.metres;
  const lapSeconds = plan.shape.length * perMetre;

  // Taken from the distance rather than from plan.remainder, which is rounded
  // for printing: the splits have to add back up to the time asked for.
  const openingMetres = plan.distance.metres - plan.laps * plan.shape.length;

  return Object.freeze({
    plan,
    totalSeconds: seconds,
    // Whole seconds for the time that was asked for, which is typed as
    // minutes and seconds; the tenth belongs on the splits that were worked
    // out, not on the figure the member set.
    totalLabel: Number.isInteger(seconds)
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : clock(seconds),
    perMetre,
    laps: plan.laps,
    lap: Object.freeze({ seconds: lapSeconds, label: clock(lapSeconds) }),
    opening: plan.exact ? null : Object.freeze({
      metres: round1(openingMetres),
      metresLabel: plan.remainderLabel,
      seconds: openingMetres * perMetre,
      label: clock(openingMetres * perMetre)
    })
  });
}
