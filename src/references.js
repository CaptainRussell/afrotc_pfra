/**
 * Governing references for every scoring rule the engine applies.
 *
 * The engine attaches citation ids to its results; the UI resolves them here so
 * a cadet can see the authority next to the number. Paragraph text is quoted
 * from DAFMAN 36-2905, 24 March 2026, and from the Final USAF PFRA Scoring
 * charts effective 1 March 2026.
 *
 * Keep this file in step with the DAFMAN. When a paragraph is renumbered, the
 * citation changes here and nowhere else.
 */

export const PUBLICATION = Object.freeze({
  id: 'dafman36-2905',
  title: 'DAFMAN 36-2905, Air Force Physical Fitness Readiness Program',
  date: '24 March 2026',
  effective: '1 March 2026',
  url: 'https://static.e-publishing.af.mil/production/1/af_a1/publication/afman36-2905/dafman36-2905.pdf'
});

export const CHARTS = Object.freeze({
  id: 'pfra-charts',
  title: 'Final USAF Physical Fitness Readiness Assessment Scoring',
  effective: '1 March 2026',
  // AFPC reissues these; the revision in references/ is the one the tables were
  // verified against. Update both together.
  currentAsOf: '17 March 2026'
});

export const NOTACC = Object.freeze({
  id: 'notacc-cy26-092',
  title: 'NOTACC CY26-092, AY2026-2027 Fitness Guidance',
  released: '6 August 2026',
  releasableToCadets: true,
  owner: 'HQ AFROTC/DO'
});

export const INSTRUCTION = Object.freeze({
  id: 'afrotci36-2011v3',
  title: 'AFROTCI 36-2011 Volume 3, Cadet Operations',
  date: '24 June 2026',
  note: 'No releasability restrictions.'
});

export const SUPPLEMENT = Object.freeze({
  id: 'dafman36-2905-afrotcsup',
  title: 'DAFMAN 36-2905_AFROTCSUP, AFROTC Supplement',
  date: '28 April 2023',
  // Written against the 2022 DAFMAN, and awaiting rewrite: NOTACC CY26-092
  // states HQ AFROTC will revise it for the new assessment. Treat it as stale
  // by default. Anything it says that NOTACC CY26-092, AFROTCI 36-2011 V3 or
  // the 2026 DAFMAN also covers is superseded; what survives is AFROTC
  // administration none of those three address. See docs/REGULATION-NOTES.md.
  pendingRevision: true,
  supersededOn: 'events, body composition method, and assessment administration'
});

// Quoted text keeps the publication's own wording, including PFA where the
// publication says PFA. The tool's own prose says PFRA; misquoting a
// regulation to match house style would be the worse error.
export const REFERENCES = Object.freeze({
  // Kept because nothing newer says it as plainly, but it sits behind
  // NOTACC CY26-092 and AFROTCI 36-2011 V3, which is where the page cites from.
  'afrotcsup.3.1.3': {
    source: SUPPLEMENT.id,
    paragraph: '3.1.3 (2023, awaiting revision)',
    text: 'Alternate components or fitness exemptions are not authorized for ' +
      'cadet PFAs. If a cadet is medically unable to accomplish a component, ' +
      'they cannot test.'
  },
  'afrotcsup.5.5.7': {
    source: SUPPLEMENT.id,
    paragraph: '5.5.7 (2023, awaiting revision)',
    text: 'Detachments that conduct the PFA/QFR 5,250 feet or more above MSL will ' +
      'manually adjust the cadet’s run times IAW DAFMAN 36-2905, Attachment 3. ' +
      'Altitude corrections do not apply to fitness tests given at Field Training.'
  },
  'afrotci.15.1': {
    source: INSTRUCTION.id,
    paragraph: 'Table 15.1, Detachment-Level Cadet Awards',
    text: 'Fitness Award: cadets who score a 95 or above in the Physical Fitness ' +
      'Assessment; may be received only once per term. Fitness Award Silver Star ' +
      'Device: cadets who score a 100 on the Physical Fitness Assessment for the ' +
      'first time at the detachment.'
  },
  'notacc.events': {
    source: NOTACC.id,
    paragraph: 'Commander’s Intent',
    text: 'AFROTC will implement a revised Physical Fitness Assessment (PFA) ' +
      'consisting exclusively of hand-release push-ups, sit-ups, and the 2-mile run.'
  },
  'notacc.hrpu': {
    source: NOTACC.id,
    paragraph: 'Concept of Operations',
    text: 'Hand-release push-ups have been selected as the muscular endurance ' +
      'component to eliminate subjective judging of elbow-bend depth and provide ' +
      'an easily verifiable, binary standard of execution.'
  },
  'notacc.whtr': {
    source: NOTACC.id,
    paragraph: 'Concept of Operations',
    text: 'Body composition assessments conducted as part of the Physical Fitness ' +
      'Assessment will utilize the Waist-to-Height Ratio (WHtR). Cadets are ' +
      'authorized to conduct WHtR measurements.'
  },
  'dafman.3.6.1': {
    source: PUBLICATION.id,
    paragraph: '3.6.1',
    text: 'The categories of PFRA scores when assessing all components are: ' +
      'Excellent (≥ 90), Satisfactory (75 - 89.9) and Unsatisfactory ' +
      '(≤ 74.9 and/or any component minimum not met).'
  },
  'dafman.3.7.1': {
    source: PUBLICATION.id,
    paragraph: '3.7.1',
    text: 'Members achieve a composite score from 0 to 100 based on the following ' +
      'maximum component scores with component minimums: 50 points for ' +
      'Cardiorespiratory, 20 points for Body Composition (does not have a minimum ' +
      'requirement), 15 points for Muscular Strength, and 15 points for Core Endurance.'
  },
  'dafman.3.7.4': {
    source: PUBLICATION.id,
    paragraph: '3.7.4',
    text: 'Completing the minimum exercise repetition/duration in all fitness ' +
      'assessment component modalities does not generate enough points to earn a ' +
      'composite score of 75 or greater. Repetition/durations below the required ' +
      'minimum receive a component score of zero.'
  },
  'dafman.3.15.2.3': {
    source: PUBLICATION.id,
    paragraph: '3.15.2.3',
    text: "Member's height measurement will be recorded to the nearest ½ inch."
  },
  'dafman.3.15.4.2': {
    source: PUBLICATION.id,
    paragraph: '3.15.4.2',
    text: 'WHtR is an age agnostic assessment and is calculated by dividing Waist ' +
      'Circumference Measurement (WCM) by height. WHtR results are truncated (not ' +
      'rounded) to the first two decimal points.'
  },
  'dafman.3.15.4.5': {
    source: PUBLICATION.id,
    paragraph: '3.15.4.5',
    text: 'The WCM is taken at the midpoint between the member’s lowest rib and ' +
      'the top of their hip bone (iliac crest). The measurement will be taken three ' +
      'times and will be rounded down to the nearest 1/2 inch.'
  },
  'dafman.3.15.4.7': {
    source: PUBLICATION.id,
    paragraph: '3.15.4.7',
    text: 'A secondary BFA must be accomplished for members identified with a WHtR ' +
      '≥ .55 and not meeting PFRA standards using an InBody Bio-Impedance (BIA) ' +
      'scale. If an InBody is not available, the BFA will be conducted using the ' +
      '2-3 site tape method as described in Attachment 8. Note: Same sex is ' +
      'required when administering this assessment.'
  },
  'dafman.3.7.2': {
    source: PUBLICATION.id,
    paragraph: '3.7.2',
    text: 'BFA is a pass/fail assessment. If the member meets standards, the body ' +
      'composition assessment will be scored as an exempt component. If the member ' +
      'does not meet BFA standards, the member will receive an unsatisfactory score ' +
      'on the PFRA.'
  },
  'dafman.table.3.2': {
    source: PUBLICATION.id,
    paragraph: 'Table 3.2',
    text: 'Body Fat Assessment (BFA) Standards. Male Standard ≤ 26%. ' +
      'Female Standard ≤ 36%.'
  },
  'dafman.attachment.8': {
    source: PUBLICATION.id,
    paragraph: 'Attachment 8',
    text: 'Body Fat Assessment (BFA) Instructions. Round the neck measurement up to ' +
      'the nearest quarter inch. Round the abdomen, waist and buttock measurements ' +
      'down to the nearest quarter inch. Men subtract the neck from the abdomen; ' +
      'women add the waist and buttocks then subtract the neck. Compare the ' +
      'circumference value to the height in Attachment 9 (male) or Attachment 10 ' +
      '(female).'
  },
  'dafman.3.15.11': {
    source: PUBLICATION.id,
    paragraph: '3.15.11',
    text: 'Muscular Strength is measured with a one-minute timed push-up or ' +
      'two-minute hand release push-ups.'
  },
  'dafman.3.15.12': {
    source: PUBLICATION.id,
    paragraph: '3.15.12',
    text: 'Core Endurance is measured with a one-minute timed sit-up, two-minute ' +
      'cross leg reverse crunch or timed forearm plank.'
  },
  'dafman.3.15.12.1': {
    source: PUBLICATION.id,
    paragraph: '3.15.12.1',
    text: 'Cardiorespiratory fitness is measured with 2.0 mile run or 20-meter HAMR ' +
      'on a certified track or course.'
  },
  'dafman.3.15.13': {
    source: PUBLICATION.id,
    paragraph: '3.15.13',
    text: 'Members have one opportunity to complete each of the PFRA components per ' +
      'fitness assessment. If a member refuses to complete their PFRA due to failing ' +
      'to meet the minimum in one or more components, their incomplete PFRA will be ' +
      'recorded as a “Did Not Finish” PFRA.'
  },
  'dafman.3.7.3': {
    source: PUBLICATION.id,
    paragraph: '3.7.3',
    text: 'The 2-kilometer walk is a pass or fail assessment for members that are ' +
      'medically prohibited from assessing the 2.0mi run or 20m HAMR. No points are ' +
      'awarded for successful completion, nor can this assessment apply to the ' +
      'Excellent PFRA score. If a member passes the assessment, the member will have ' +
      'a composite score calculated based on the assessed components in the same way ' +
      'the score will be calculated if the member were exempt from the ' +
      'cardiorespiratory component in accordance with paragraph 3.6.2.'
  },
  'dafman.3.6.2': {
    source: PUBLICATION.id,
    paragraph: '3.6.2',
    text: 'Members assessed on the 2-kilometer walk are considered component exempt ' +
      'and will fall under frequency standards in accordance with paragraph 3.10.'
  },
  'dafman.3.10.1': {
    source: PUBLICATION.id,
    paragraph: '3.10.1',
    text: 'Excellent (≥ 90) (Ready). All members scoring Excellent without any ' +
      'component exemptions will be due again in 6 months. (ARC test once every 12 ' +
      'months.) Note: Members who meet the 2 kilometer walk standard in Table 3.1, ' +
      'are not eligible for this category.'
  },
  'dafman.3.10.2': {
    source: PUBLICATION.id,
    paragraph: '3.10.2',
    text: 'Satisfactory (75-89.9) (Ready). All members scoring Satisfactory without ' +
      'any component exemptions will be due again in 6 months (ARC test once every 12 ' +
      'months) Note: Members who meet the 2 kilometer walk standard in Table 3.1, are ' +
      'eligible for this category.'
  },
  'charts.walk': {
    source: CHARTS.id,
    paragraph: 'Table 3.1, 2.0 Kilometer Walk',
    text: 'Maximum walk times by sex and age group. The same five rows appear in ' +
      'DAFMAN 36-2905 Table 3.1 and on the scoring charts.'
  },
  'charts.minimum-asterisk': {
    source: CHARTS.id,
    paragraph: 'component minimum rows',
    text: 'On each scoring chart the component minimum is the asterisked floor row: ' +
      '2.5 points for muscular strength and core endurance, 35.0 points for the ' +
      'cardiorespiratory component. Waist to height ratio carries no asterisked floor.'
  },
  'charts.whtr': {
    source: CHARTS.id,
    paragraph: 'WHtR scoring standards',
    text: 'The waist to height ratio table is identical for every age band and both ' +
      'sexes. 0.49 or lower scores 20.0 points; 0.60 or higher scores 0 points.'
  }
});

/** Resolve citation ids to full reference records, skipping unknown ids. */
export function resolveReferences(ids) {
  return ids.map((id) => ({ id, ...REFERENCES[id] })).filter((r) => r.paragraph);
}
