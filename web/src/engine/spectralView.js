// Pure model for the Color panel's explanatory spectrum plot.
//
// IMPORTANT: spectra.json currently contains peak positions (plus, as of the
// color-panel curve-shape patch, a per-fluorophore emissionFwhmNm), not
// measured curve samples. These normalized Gaussian curves are therefore
// still SCHEMATIC -- useful for showing why nearby emissions can occupy the
// same user-entered detection window, but never a quantitative spillover
// integral, and a single symmetric Gaussian is itself an approximation of
// real (often asymmetric, red-tailed) emission bands. Each curve's width
// comes from its own fluorophore's emissionFwhmNm when the spectra pack has
// one, else from overlapRules.schematicEmissionFwhmNm -- both reviewable
// data, not an invisible renderer constant.

export const SPECTRAL_VIEW_MIN_NM = 300;
export const SPECTRAL_VIEW_MAX_NM = 900;
export const SPECTRAL_VIEW_SAMPLE_STEP_NM = 5;
export const SPECTRAL_VIEW_DEFAULT_FWHM_NM = 50;

const SPECTRAL_VIEW_MIN_FILTER_WIDTH_NM = 1;
const SPECTRAL_VIEW_MAX_FILTER_WIDTH_NM = 300;
// Not named module-level constants: the single-file build (tools/
// build_single_file.py) concatenates every web/src module into one scope and
// rejects two top-level declarations sharing a name, and spectra.js already
// declares its OWN same-valued SPECTRAL_VIEW_MIN_FWHM_NM/MAX_FWHM_NM for its
// schematicEmissionFwhmNm validation -- inline literals here, not a second
// top-level name for the same 5-300 nm bound.
const SPECTRAL_VIEW_FWHM_BOUNDS_NM = [5, 300];

function spectralViewFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Shared by the pack-wide schematicEmissionFwhmNm and every per-curve
// emissionFwhmNm below -- ONE plausibility bound so an out-of-range width
// can't reach the renderer from either path, including an entry that
// bypassed spectra.js's own loader (e.g. a hand-built test entry).
function spectralViewPlausibleFwhm(value) {
  const [minNm, maxNm] = SPECTRAL_VIEW_FWHM_BOUNDS_NM;
  return spectralViewFiniteNumber(value) && value >= minNm && value <= maxNm;
}

function spectralViewFwhm(overlapRules) {
  const value = overlapRules && overlapRules.schematicEmissionFwhmNm;
  return spectralViewPlausibleFwhm(value) ? value : SPECTRAL_VIEW_DEFAULT_FWHM_NM;
}

/** Normalized Gaussian intensity: 1 at peak and 0.5 at ±FWHM/2. */
export function spectralViewIntensityAt(wavelengthNm, peakNm, fwhmNm) {
  if (
    !spectralViewFiniteNumber(wavelengthNm) ||
    !spectralViewFiniteNumber(peakNm) ||
    !spectralViewFiniteNumber(fwhmNm) ||
    fwhmNm <= 0
  ) {
    return 0;
  }
  const offset = (wavelengthNm - peakNm) / fwhmNm;
  return Math.exp(-4 * Math.log(2) * offset * offset);
}

function spectralViewFilterBand(entry) {
  const centerNm = entry && entry.filterCenterNm;
  const bandwidthNm = entry && entry.filterBandwidthNm;
  const valid =
    spectralViewFiniteNumber(centerNm) &&
    spectralViewFiniteNumber(bandwidthNm) &&
    centerNm >= SPECTRAL_VIEW_MIN_NM &&
    centerNm <= SPECTRAL_VIEW_MAX_NM &&
    bandwidthNm >= SPECTRAL_VIEW_MIN_FILTER_WIDTH_NM &&
    bandwidthNm <= SPECTRAL_VIEW_MAX_FILTER_WIDTH_NM;
  if (!valid) return null;
  const rawStartNm = centerNm - bandwidthNm / 2;
  const rawEndNm = centerNm + bandwidthNm / 2;
  const startNm = Math.max(SPECTRAL_VIEW_MIN_NM, rawStartNm);
  const endNm = Math.min(SPECTRAL_VIEW_MAX_NM, rawEndNm);
  if (endNm <= startNm) return null;
  return {
    channelId: typeof entry.channelId === 'string' ? entry.channelId : '',
    token: typeof entry.token === 'string' ? entry.token : '',
    centerNm,
    bandwidthNm,
    startNm,
    endNm,
    clipped: startNm !== rawStartNm || endNm !== rawEndNm,
  };
}

/**
 * Build a deterministic, renderer-ready view model. TOTAL and immutable.
 * `entries` may be free-text resolved entries or structured-channel entries;
 * only state:'known' entries get curves, while every complete user-entered
 * filter gets a band even if its fluorophore is unresolved.
 */
export function buildSpectralViewModel(entries, overlapRules) {
  const source = Array.isArray(entries) ? entries : [];
  // The pack-wide schematic width: the FALLBACK for a fluorophore with no
  // emissionFwhmNm of its own (an older/synthetic spectra pack, or a real
  // entry whose width was implausible and dropped by spectra.js), not the
  // width every curve shares -- see the per-curve fallback just below.
  const fwhmNm = spectralViewFwhm(overlapRules);
  const curves = source
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .filter(({ entry }) => entry && entry.state === 'known' && spectralViewFiniteNumber(entry.emissionPeakNm))
    .map(({ entry, sourceIndex }) => {
      const curveFwhmNm = spectralViewPlausibleFwhm(entry.emissionFwhmNm) ? entry.emissionFwhmNm : fwhmNm;
      const points = [];
      for (
        let wavelengthNm = SPECTRAL_VIEW_MIN_NM;
        wavelengthNm <= SPECTRAL_VIEW_MAX_NM;
        wavelengthNm += SPECTRAL_VIEW_SAMPLE_STEP_NM
      ) {
        points.push({
          wavelengthNm,
          intensity: spectralViewIntensityAt(wavelengthNm, entry.emissionPeakNm, curveFwhmNm),
        });
      }
      return {
        channelId: typeof entry.channelId === 'string' ? entry.channelId : '',
        token:
          typeof entry.token === 'string' && entry.token.trim()
            ? entry.token.trim()
            : typeof entry.canonical === 'string' && entry.canonical.trim()
              ? entry.canonical.trim()
              : 'Unnamed',
        canonical:
          typeof entry.canonical === 'string' && entry.canonical.trim() ? entry.canonical.trim() : null,
        emissionPeakNm: entry.emissionPeakNm,
        excitationPeakNm: spectralViewFiniteNumber(entry.excitationPeakNm) ? entry.excitationPeakNm : null,
        reviewStatus: entry.reviewStatus || null,
        fwhmNm: curveFwhmNm,
        points,
        sourceIndex,
      };
    });

  curves.sort(
    (a, b) =>
      a.emissionPeakNm - b.emissionPeakNm ||
      a.token.localeCompare(b.token) ||
      a.channelId.localeCompare(b.channelId) ||
      a.sourceIndex - b.sourceIndex
  );
  for (const curve of curves) delete curve.sourceIndex;

  const filters = source.map(spectralViewFilterBand).filter(Boolean);
  filters.sort(
    (a, b) =>
      a.centerNm - b.centerNm || a.token.localeCompare(b.token) || a.channelId.localeCompare(b.channelId)
  );

  return {
    domain: { minNm: SPECTRAL_VIEW_MIN_NM, maxNm: SPECTRAL_VIEW_MAX_NM },
    fwhmNm,
    curves,
    filters,
  };
}
