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
  samplePattern: '^E\\d{2}$',
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
 * Warn (never truncate) when a full target path would exceed Windows'
 * MAX_PATH limit (260 characters).
 *
 * This must be checked against the FULL path (directory + filename), not
 * just the filename, since it is the combined length that Win32 rejects.
 * Severity is "warning", not "error": the path may still work (long-path
 * opt-in, WSL, a non-Windows filesystem), so this must never silently block
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
        `allows (${MAX_PATH_LENGTH}). Shorten one of the naming fields, or move the files to a ` +
        `folder closer to your drive's root. Full path: '${pathStr}'`,
      'warning'
    ),
  ];
}

export function validateFields(fields, profile) {
  const issues = [];

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
  // exact E## shape in practice) and keeps the regex afterward only as a
  // technical reference, not as the primary explanation -- a researcher
  // hitting this error needs "use E01, not UNKNOWN", not a pattern to
  // decode themselves.
  const sample = String(fields.sample ?? '');
  if (sample && !compileFullMatch(profile.samplePattern).test(sample)) {
    issues.push(
      validationIssue(
        'sample',
        `'${sample}' isn't a valid sample ID -- it should be the letter E followed by two digits, ` +
          `like E01 or E12. (Expected pattern: ${profile.samplePattern})`,
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
