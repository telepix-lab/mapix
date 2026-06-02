// Area formatting rule:
// - below the threshold -> integer m² (with thousands separators)
// - at or above the threshold -> km² with two decimals
//
// The prefix (e.g. "Area:") is the consumer's i18n responsibility, so only
// the unit/value pair is returned.
const DEFAULT_SQUARE_METER_THRESHOLD = 10_000;

export interface FormattedArea {
  value: string;
  unit: 'km²' | 'm²';
}

export interface FormatAreaOptions {
  /**
   * Threshold (m²) for switching from m² to km².
   * Defaults to 10,000. Optional so other products/domains can apply a
   * different threshold.
   */
  thresholdSquareMeters?: number;
}

export const formatArea = (
  squareMeters: number,
  options: FormatAreaOptions = {}
): FormattedArea => {
  const threshold =
    options.thresholdSquareMeters ?? DEFAULT_SQUARE_METER_THRESHOLD;

  if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
    return { value: '0', unit: 'm²' };
  }

  if (squareMeters < threshold) {
    return {
      value: Math.round(squareMeters).toLocaleString('en-US'),
      unit: 'm²',
    };
  }

  const km2 = squareMeters / 1_000_000;
  return { value: km2.toFixed(2), unit: 'km²' };
};
