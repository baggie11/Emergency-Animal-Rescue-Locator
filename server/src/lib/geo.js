/**
 * Haversine helpers.
 *
 * The MVP stores lat/lng as plain REAL columns and computes distance in SQL, so
 * it runs on SQLite with zero extensions. See README "Moving to PostGIS" for the
 * drop-in replacement that indexes a real geometry column.
 */

export const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * SQL expression pair for inline distance calculation. Bound params must be
 * interpolated in the same order: [lat, lng, lat, lng].
 */
export const SQL_DISTANCE_KM = `
  2 * ${EARTH_RADIUS_KM} * asin(
    min(1, sqrt(
      power(sin((? - lat) * 0.017453292519943295 / 2), 2) +
      cos(lat * 0.017453292519943295) *
      cos(? * 0.017453292519943295) *
      power(sin((? - lng) * 0.017453292519943295 / 2), 2)
    ))
  )
`;

export const DISTANCE_SQL_PARAMS = (lat, lng) => [lat, lat, lng];

export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
