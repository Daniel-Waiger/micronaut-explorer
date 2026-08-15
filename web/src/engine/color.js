// Wavelength -> display-color mapping for the Color panel step: turns a
// fluorophore's emission peak (nm) into a light, screen-friendly swatch --
// e.g. DAPI's ~460 nm emission renders as a light sky blue, GFP's ~510 nm as
// a light green, Texas Red's ~615 nm as orange-red -- matching the
// conventional imaging/flow-cytometry idiom of coloring a channel by its
// emission color, not a spectrophotometer trace.
//
// Deliberately NOT a physically accurate CIE wavelength-to-RGB conversion:
// those render quite dark/desaturated near the violet and red edges of the
// visible range, which reads poorly as a small UI swatch and doesn't match
// how imaging software actually colors channels. Instead this is a
// piecewise-linear hue curve fit to the same rough spectral order, held at a
// fixed light/saturated HSL so every swatch stays legible on both this app's
// light and dark themes. Qualitative by design -- same posture as
// spectra.js's peak-proximity check, not a claim of colorimetric accuracy.
//
// Pure module: no DOM.

// [nm, hueDegrees], hue expressed as a continuous (non-wrapped) value so
// linear interpolation never has to special-case crossing 0/360 -- the final
// hueForWavelength() reduces mod 360 exactly once, at the end. Past the
// visible red edge (~650 nm) the curve keeps descending past 0 into
// negative/magenta territory, matching how deep-red/near-IR channels are
// conventionally rendered (a warm magenta/maroon, not a repeat of pure red).
const HUE_BREAKPOINTS = [
  [360, 280], // near-UV (Hoechst/DAPI excitation range) -- violet
  [440, 240], // blue
  [480, 200], // cyan-blue
  [510, 150], // green
  [550, 95], // yellow-green
  [580, 50], // orange-yellow
  [610, 20], // orange-red
  [650, -5], // red
  [700, -30], // deep red / near-IR, tipping toward magenta
  [900, -60], // far-IR (extrapolated) -- magenta
];

const DEFAULT_SATURATION_PCT = 72;
const DEFAULT_LIGHTNESS_PCT = 68;

function hueForWavelength(nm) {
  const minNm = HUE_BREAKPOINTS[0][0];
  const maxNm = HUE_BREAKPOINTS[HUE_BREAKPOINTS.length - 1][0];
  const clamped = Math.max(minNm, Math.min(maxNm, nm));

  for (let i = 0; i < HUE_BREAKPOINTS.length - 1; i++) {
    const [nmA, hueA] = HUE_BREAKPOINTS[i];
    const [nmB, hueB] = HUE_BREAKPOINTS[i + 1];
    if (clamped >= nmA && clamped <= nmB) {
      const frac = nmB === nmA ? 0 : (clamped - nmA) / (nmB - nmA);
      const hue = hueA + frac * (hueB - hueA);
      return ((hue % 360) + 360) % 360;
    }
  }
  // Unreachable given the clamp above, but keeps this TOTAL rather than
  // relying on the loop always finding a bracketing pair.
  return 0;
}

// Standard HSL -> RGB hex conversion (CSS Color 4's formula); no library
// needed for three channels.
function hslToHex(hueDeg, saturationPct, lightnessPct) {
  const s = saturationPct / 100;
  const l = lightnessPct / 100;
  const k = (n) => (n + hueDeg / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * The default display color for a fluorophore with the given emission peak
 * (nm), as a `#rrggbb` hex string. Returns `null` for a non-finite/missing
 * peak -- callers (ui/steps/panel.js) fall back to a neutral placeholder
 * swatch in that case, same never-silent posture as spectra.js's five
 * states: "no color computed" is a distinct, visible case, not a guess.
 */
export function wavelengthToColor(emissionPeakNm, { saturationPct = DEFAULT_SATURATION_PCT, lightnessPct = DEFAULT_LIGHTNESS_PCT } = {}) {
  if (typeof emissionPeakNm !== 'number' || !Number.isFinite(emissionPeakNm)) return null;
  return hslToHex(hueForWavelength(emissionPeakNm), saturationPct, lightnessPct);
}
