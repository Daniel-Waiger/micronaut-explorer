// Faithful port of src/microscopy_naming_assistant/validation.py — field
// validation and path-length warnings. Leaf module: import nothing.

// Windows' classic MAX_PATH limit. Exceeding it makes a path unusable (or
// silently unreliable) on plain Win32 APIs; we WARN rather than truncate,
// because truncating a name is exactly the kind of silent identity loss this
// tool exists to prevent.
export const MAX_PATH_LENGTH = 260;

// The Planner's own baseline validateFields profile: empty allow-lists mean
// "unrestricted" (see validateFields below), so this only enforces the
// FORMAT patterns (sample/magnification/notes), not a specific lab's
// marker/exptype vocabulary. Deliberately NOT Classic's profiles/
// facsi_default.json -- that file lives in the Python package and is
// authored per-lab for Classic's own renaming workflow; porting it into the
// Planner would be inventing a content-authoring surface nobody asked the
// Planner to have. Exported (not a ui/steps/naming.js local, where it
// previously lived only) so engine/conformance.js's whole-study check uses
// the IDENTICAL profile naming.js's own per-keystroke validation does --
// one definition, not two that could quietly diverge.
export const DEFAULT_PROFILE = {
  allowedExperimentTypes: [],
  allowedMarkers: [],
  // Any three-letter acronym + two digits (00-99): 100 IDs per acronym,
  // covering whatever lab/project shorthand the sample actually uses --
  // '^E\d{2}$' (the old pattern) accepted ONLY the single letter E, which
  // rejected every other lab's acronym outright and even flagged the
  // NAMING_CONFIG default sentinel 'UNKNOWN' as an invalid sample. See
  // docs/plans/planner-web -- zen-planner, Phase 0.
  samplePattern: '^[A-Za-z]{3}\\d{2}$',
  magnificationPattern: '^X\\d{2,3}$',
  notesPattern: '^[A-Za-z0-9_-]+$',
  unknownMarkerPolicy: 'warn',
};

/** Build a {field, message, severity} validation issue. */
export function validationIssue(field, message, severity = 'error') {
  return { field, message, severity };
}

/**
 * Anchor `pattern` to match the WHOLE string, mirroring Python's
 * `re.fullmatch`. JS's `RegExp.test` only requires a SUBSTRING match, so an
 * unanchored profile pattern like '[A-Za-z0-9_-]+' would silently ACCEPT
 * 'bad note' in JS (it matches the substring 'bad') while Python's
 * `re.fullmatch` correctly rejects it. Every profile pattern check MUST go
 * through this, never a raw `new RegExp(pattern)`.
 */
export function compileFullMatch(pattern) {
  return new RegExp('^(?:' + pattern + ')$', 'u');
}

export function splitMarkers(markersValue) {
  const parts = String(markersValue).split(/[-,;|/]+/);
  return parts.map((p) => p.trim().toUpperCase()).filter((p) => p.length > 0);
}

/**
 * Warn (never truncate) when a FILENAME alone is already long enough to risk
 * exceeding Windows' combined-path MAX_PATH limit (260 characters).
 *
 * V2-NEW-04: this function's contract used to claim it must be "checked
 * against the FULL path (directory + filename)", and its message said
 * "Full path:". Neither was true: this app has no target-directory field
 * anywhere (nothing to prepend -- `grep -rn "targetDir\|outputDir\|directory"
 * web/src` turns up nothing but this file's own former comment), and all
 * three real callers (ui/steps/naming.js, ui/steps/design.js,
 * engine/conformance.js) have only ever passed a bare planned FILENAME.
 * Rather than invent a directory-template feature nobody asked for just to
 * make the old contract true, the contract is fixed in the smaller
 * direction: this checks the filename itself against MAX_PATH_LENGTH as a
 * conservative proxy. A filename already at or over 260 characters
 * guarantees the full path will exceed it wherever it lands; one under 260
 * still leaves headroom that the (unmodeled) directory eats into, so this
 * cannot promise the full path is safe -- only that the filename itself
 * is not obviously already doomed. Severity stays "warning", not "error":
 * the path may still work (long-path opt-in, WSL, a non-Windows
 * filesystem, a shallow enough folder), so this must never silently block
 * or mutate a plan -- it only surfaces the risk for the user to judge.
 */
export function validateTargetPath(pathString) {
  const pathStr = String(pathString);
  if (pathStr.length <= MAX_PATH_LENGTH) {
    return [];
  }
  return [
    validationIssue(
      'target_path',
      `This filename would be ${pathStr.length} characters long, which is longer than Windows ` +
        `allows for a full file path (${MAX_PATH_LENGTH}). Shorten one of the naming fields, or move ` +
        `the files to a folder closer to your drive's root. Filename: '${pathStr}'`,
      'warning'
    ),
  ];
}

export function validateFields(fields, profile) {
  const issues = [];

  // Sanitization-loss issues (a group/factor level or naming field that
  // loses a real letter/digit -- or all of them -- when turned into a
  // filename token) are NOT folded in here: they are computed straight from
  // the pre-sanitization value by naming.js's sanitizationLossIssues(raw,
  // config), which validateFields has no access to (only the already
  // *finalized* fields are passed in here, and the original value cannot be
  // recovered from its sanitized token). engine/plan.js's planFilenames
  // calls sanitizationLossIssues itself and attaches the result to each
  // planned row as `issues`; ui/steps/design.js renders those, and
  // engine/conformance.js folds them into the study report alongside this
  // function's own issues. See docs/plans/app-review-remediation-task-graph.json
  // task E1 and docs/plans/app-review-2026-09-11.md finding V4-N1.

  const exptype = String(fields.exptype ?? '').toUpperCase();
  if (
    exptype &&
    profile.allowedExperimentTypes &&
    profile.allowedExperimentTypes.length > 0 &&
    !profile.allowedExperimentTypes.some((x) => String(x).toUpperCase() === exptype)
  ) {
    issues.push(
      validationIssue(
        'exptype',
        `'${exptype}' isn't one of the experiment types set up for this study. Pick one of the ` +
          `allowed types, or add it to the list if it's meant to be a new one.`,
        'error'
      )
    );
  }

  // Each of these three messages leads with what the value should look like
  // in plain terms (safe to state directly: DEFAULT_PROFILE below is the
  // ONLY profile this app ever constructs, so "sample" always means this
  // exact XYZ## shape in practice) and keeps the regex afterward only as a
  // technical reference, not as the primary explanation -- a researcher
  // hitting this error needs "use ABC01, not UNKNOWN", not a pattern to
  // decode themselves.
  //
  // 'UNKNOWN' (NAMING_CONFIG's own default sentinel, ui/steps/naming.js) is
  // deliberately NOT validated here: only a value the user actually typed
  // is checked, so the placeholder default is never flagged as an error
  // before the user has entered anything.
  const sample = String(fields.sample ?? '');
  if (sample && sample !== 'UNKNOWN' && !compileFullMatch(profile.samplePattern).test(sample)) {
    issues.push(
      validationIssue(
        'sample',
        `'${sample}' isn't a valid sample ID -- it should be a three-letter code followed by two ` +
          `digits, like ABC01 or XYZ12. (Expected pattern: ${profile.samplePattern})`,
        'error'
      )
    );
  }

  const magnification = String(fields.magnification ?? '');
  if (magnification && !compileFullMatch(profile.magnificationPattern).test(magnification)) {
    issues.push(
      validationIssue(
        'magnification',
        `'${magnification}' isn't a valid magnification -- it should be the letter X followed by ` +
          `2-3 digits, like X40 or X100. (Expected pattern: ${profile.magnificationPattern})`,
        'error'
      )
    );
  }

  const notes = String(fields.notes ?? '');
  if (notes && !compileFullMatch(profile.notesPattern).test(notes)) {
    issues.push(
      validationIssue(
        'notes',
        `'${notes}' has characters this tool can't safely put in a filename -- stick to letters, ` +
          `numbers, underscores (_) and hyphens (-), with no spaces. (Expected pattern: ${profile.notesPattern})`,
        'error'
      )
    );
  }

  if (profile.allowedMarkers && profile.allowedMarkers.length > 0) {
    const allowedMarkers = new Set(profile.allowedMarkers.map((m) => String(m).toUpperCase()));
    const markers = splitMarkers(String(fields.markers ?? ''));
    const unknownMarkers = markers.filter((m) => !allowedMarkers.has(m));
    if (unknownMarkers.length > 0 && profile.unknownMarkerPolicy !== 'allow') {
      const severity = profile.unknownMarkerPolicy === 'warn' ? 'warning' : 'error';
      issues.push(
        validationIssue(
          'markers',
          "These markers aren't on the approved list for this study -- check for a typo, or add " +
            'them if they\'re meant to be new: ' +
            unknownMarkers.slice().sort().join(', '),
          severity
        )
      );
    }
  }

  return issues;
}
