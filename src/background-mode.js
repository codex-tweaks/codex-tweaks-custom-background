export const TRANSPARENT_BACKGROUND_KIND = "transparent";
export const DEFAULT_IMAGE_LAYOUT = "cover";

const BACKGROUND_KINDS = new Set([
  "none",
  TRANSPARENT_BACKGROUND_KIND,
  "alcy",
  "url",
  "local",
]);

const IMAGE_LAYOUTS = new Set([
  DEFAULT_IMAGE_LAYOUT,
  "contain",
  "tile",
  "tile-fit",
]);

export function normalizeBackgroundKind(kind) {
  return BACKGROUND_KINDS.has(kind) ? kind : "none";
}

export function normalizeImageLayout(layout) {
  return IMAGE_LAYOUTS.has(layout) ? layout : DEFAULT_IMAGE_LAYOUT;
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
