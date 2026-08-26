export const TRANSPARENT_BACKGROUND_KIND = "transparent";

const BACKGROUND_KINDS = new Set([
  "none",
  TRANSPARENT_BACKGROUND_KIND,
  "alcy",
  "url",
  "local",
]);

export function normalizeBackgroundKind(kind) {
  return BACKGROUND_KINDS.has(kind) ? kind : "none";
}

export function hasConfiguredBackgroundKind(kind, resolvedImageUrl) {
  return kind === TRANSPARENT_BACKGROUND_KIND || Boolean(resolvedImageUrl);
}

export function isTransparentBackgroundActive(kind, backgroundEnabled) {
  return kind === TRANSPARENT_BACKGROUND_KIND && backgroundEnabled !== false;
}

export function canStoreBackgroundHistory(kind) {
  const normalized = normalizeBackgroundKind(kind);
  return normalized !== "none" && normalized !== TRANSPARENT_BACKGROUND_KIND;
}
