export function readStorageWithLegacyFallback(storage, currentKey, legacyKey) {
  const currentRaw = storage.getItem(currentKey);
  const legacyRaw = storage.getItem(legacyKey);
  return {
    raw: currentRaw ?? legacyRaw,
    hasLegacy: legacyRaw !== null,
  };
}

export function writeStorageAndRemoveLegacy(
  storage,
  currentKey,
  legacyKey,
  serializedState,
  hasLegacy,
) {
  storage.setItem(currentKey, serializedState);
  if (hasLegacy) storage.removeItem(legacyKey);
}
