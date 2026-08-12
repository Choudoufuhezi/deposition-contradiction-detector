/** Broad geographic containers that may include many distinct sub-locations. */
export const BROAD_LOCATION_PATTERN =
  /\b(?:area|general area|part of town|vicinity|neighbou?rhood|nearby|region|complex|campus|lobby|common area)\b/i;

/** Concrete sub-locations whose denial does not necessarily deny the containing area. */
export const SPECIFIC_LOCATION_PATTERN =
  /\b(?:warehouse|building|office|room|suite|house|store|address|facility|property)\b/i;

/** Returns true when the two texts operate at specific versus containing-area scope. */
export function hasLocationScopeDifference(text1, text2) {
  return (
    (SPECIFIC_LOCATION_PATTERN.test(text1) && BROAD_LOCATION_PATTERN.test(text2)) ||
    (BROAD_LOCATION_PATTERN.test(text1) && SPECIFIC_LOCATION_PATTERN.test(text2))
  );
}
