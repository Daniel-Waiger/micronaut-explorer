// .ics (iCalendar, RFC 5545) export -- zen-planner Phase 1's timing
// interview (web/kb/questions.json, phase 'timing'; core/assay.js's
// `timing` root) turned into a schedule any calendar app can import with no
// login and no server, the same `<a download>` mechanism
// core/persist.js's downloadTextFile already uses for the .micronaut.json
// export. This is the `file://`/offline path; a future Google Calendar
// sync (deferred to a later phase) is the online-only alternative built
// from the SAME buildIcsSchedule() events.
//
// Pure functions: no DOM, no Date.now() read implicitly -- every caller
// supplies `startDate`/`now` explicitly, so output is deterministic and
// testable. TOTAL: never throws; a missing/zero ETA answer OMITS that
// stage's block entirely rather than rendering a zero-length event that
// would misrepresent "not answered yet" as "answered as instant."

const CRLF = '\r\n';

function pad2(n) {
  return String(n).padStart(2, '0');
}

// A local-time "floating" iCalendar date-time (no trailing Z, no VTIMEZONE)
// -- the simplest form every mainstream calendar app (Google, Outlook,
// Apple, including HUJImail's Google Workspace) accepts as "this time, in
// whichever zone the viewer is in." Correct semantics for a bench schedule:
// nobody is coordinating this across time zones.
function icsLocalDateTime(date) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

// DTSTAMP alone is a true UTC instant (RFC 5545 3.8.7.2: "MUST be specified
// in UTC time"), unlike DTSTART/DTEND above which are deliberately floating
// -- the two use different date formatting on purpose, not by oversight.
function icsUtcDateTime(date) {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T` +
    `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

// RFC 5545 3.3.11: a literal backslash/semicolon/comma/newline inside a
// TEXT value must be escaped, or it corrupts property parsing for whatever
// follows it in the same VEVENT.
function icsEscapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsEvent(event, now) {
  const end = new Date(event.start.getTime() + event.minutes * 60000);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsUtcDateTime(now)}`,
    `DTSTART:${icsLocalDateTime(event.start)}`,
    `DTEND:${icsLocalDateTime(end)}`,
    `SUMMARY:${icsEscapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscapeText(event.description)}`);
  lines.push('END:VEVENT');
  return lines.join(CRLF);
}

/**
 * Build the sequential bench schedule for ONE assay from its timing answers
 * and its planned sample count, back to back starting at `startDate`.
 *
 * `timing` is the assay's `timing` object (core/assay.js's emptyAssay
 * shape: etaFixationMinutes/etaMountingMinutes/etaAcquisitionMinutes/
 * etaAnalysisMinutes, each a number of minutes or null). A stage whose ETA
 * was never answered (null/not-a-number/<= 0) is OMITTED from the result,
 * never rendered as a zero-minute event -- "not answered yet" and "takes no
 * time" are different facts and must not collapse into the same output.
 *
 * Mounting and acquisition are PER-SAMPLE ETAs (the question bank's own
 * wording), but they do NOT scale by the same count. Mounting is a physical-
 * slide operation: it happens once per physical SAMPLE, so it is multiplied
 * by `sampleCount`. Acquisition is a repeat MEASUREMENT of that same mounted
 * sample -- a technical replicate, by definition, re-acquires without
 * re-mounting (web/kb/questions.json's technicalReplicates question) -- so it
 * is multiplied by `acquisitionRunCount`, which defaults to `sampleCount` when
 * the caller doesn't distinguish the two (every existing caller/test). Each
 * total becomes one combined block -- a calendar app gains nothing from 40
 * separate 10-minute mounting events where "about 6.5 hours of mounting" says
 * the same thing more usefully. Both counts are independently clamped to at
 * least 1 so a design with zero planned conditions (an unanswered/broken
 * design, per engine/plan.js) still produces one worked block instead of a
 * schedule that silently vanishes.
 *
 * Pure, deterministic: returns `{uid, summary, description, start, minutes}`
 * objects, not iCalendar text -- renderIcs (below) is the one place that
 * text format is produced, so a future second consumer (the deferred Google
 * Calendar sync) can build its own events from the exact same list.
 */
export function buildIcsSchedule({
  assayLabel,
  timing,
  sampleCount,
  acquisitionRunCount = sampleCount,
  startDate,
}) {
  const t = timing && typeof timing === 'object' ? timing : {};
  const clampCount = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 1);
  const count = clampCount(sampleCount);
  const runCount = clampCount(acquisitionRunCount);
  const label = typeof assayLabel === 'string' && assayLabel.trim() ? assayLabel.trim() : 'This assay';
  const start = startDate instanceof Date && !Number.isNaN(startDate.getTime()) ? startDate : new Date();

  const scaledMinutes = (minutesPerUnit, units) =>
    typeof minutesPerUnit === 'number' && Number.isFinite(minutesPerUnit) && minutesPerUnit > 0
      ? minutesPerUnit * units
      : null;

  const stagesInOrder = [
    {
      key: 'fixation',
      minutes: typeof t.etaFixationMinutes === 'number' ? t.etaFixationMinutes : null,
      summary: `${label}: Fixation & staining`,
      description: 'Bench prep -- fixation and staining, before mounting.',
    },
    {
      key: 'mounting',
      minutes: scaledMinutes(t.etaMountingMinutes, count),
      summary: `${label}: Mounting (${count} sample${count === 1 ? '' : 's'})`,
      description: `Mounting, ${t.etaMountingMinutes} min/sample × ${count} sample(s).`,
    },
    {
      key: 'acquisition',
      minutes: scaledMinutes(t.etaAcquisitionMinutes, runCount),
      summary: `${label}: Microscope acquisition (${runCount} run${runCount === 1 ? '' : 's'})`,
      description: `Acquisition, ${t.etaAcquisitionMinutes} min/run × ${runCount} run(s).`,
    },
    {
      key: 'analysis',
      minutes: typeof t.etaAnalysisMinutes === 'number' ? t.etaAnalysisMinutes : null,
      summary: `${label}: Image analysis`,
      description: 'Image analysis / processing.',
    },
  ];

  let cursor = start.getTime();
  const events = [];
  for (const stage of stagesInOrder) {
    if (typeof stage.minutes !== 'number' || !Number.isFinite(stage.minutes) || stage.minutes <= 0) continue;
    const eventStart = new Date(cursor);
    events.push({
      uid: `micronaut-${stage.key}-${cursor}@planner`,
      summary: stage.summary,
      description: stage.description,
      start: eventStart,
      minutes: stage.minutes,
    });
    cursor += stage.minutes * 60000;
  }
  return events;
}

/**
 * Render `events` (buildIcsSchedule's output) as a complete .ics file body.
 * TOTAL: an empty event list still yields a valid, importable (empty)
 * calendar -- never a thrown error, and never a blank string a downstream
 * download button could mistake for a failure.
 */
export function renderIcs(events, { now } = {}) {
  const list = Array.isArray(events) ? events : [];
  const stamp = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Micronaut Planner//Schedule Export//EN',
      'CALSCALE:GREGORIAN',
      ...list.map((event) => icsEvent(event, stamp)),
      'END:VCALENDAR',
    ].join(CRLF) + CRLF
  );
}
