// Pure model for the Color panel's explanatory spectrum plot.
//
// IMPORTANT: spectra.json currently contains peak positions, not measured
// curve samples. These normalized Gaussian curves are therefore SCHEMATIC:
// useful for showing why nearby emissions can occupy the same user-entered
// detection window, but never a quantitative spillover integral. The width
// comes from overlapRules.schematicEmissionFwhmNm so the domain judgement is
// reviewable data rather than an invisible renderer constant.

export const SPECTRAL_VIEW_MIN_NM = 300;
export const SPECTRAL_VIEW_MAX_NM = 900;
export const SPECTRAL_VIEW_SAMPLE_STEP_NM = 5;
export const SPECTRAL_VIEW_DEFAULT_FWHM_NM = 50;

const SPECTRAL_VIEW_MIN_FILTER_WIDTH_NM = 1;
const SPECTRAL_VIEW_MAX_FILTER_WIDTH_NM = 300;

function spectralViewFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function spectralViewFwhm(overlapRules) {
  const value = overlapRules && overlapRules.schematicEmissionFwhmNm;
  return spectralViewFiniteNumber(value) && value >= 5 && value <= 300
    ? value
    : SPECTRAL_VIEW_DEFAULT_FWHM_NM;
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
  const fwhmNm = spectralViewFwhm(overlapRules);
  const curves = source
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .filter(({ entry }) => entry && entry.state === 'known' && spectralViewFiniteNumber(entry.emissionPeakNm))
    .map(({ entry, sourceIndex }) => {
      const points = [];
      for (
        let wavelengthNm = SPECTRAL_VIEW_MIN_NM;
        wavelengthNm <= SPECTRAL_VIEW_MAX_NM;
        wavelengthNm += SPECTRAL_VIEW_SAMPLE_STEP_NM
      ) {
        points.push({
          wavelengthNm,
          intensity: spectralViewIntensityAt(wavelengthNm, entry.emissionPeakNm, fwhmNm),
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
        fwhmNm,
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
