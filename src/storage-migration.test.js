import test from "node:test";
import assert from "node:assert/strict";

import {
  readStorageWithLegacyFallback,
  writeStorageAndRemoveLegacy,
} from "./storage-migration.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("uses legacy state only when the renamed key is absent", () => {
  const legacyOnly = memoryStorage({ legacy: "old-state" });
  assert.deepEqual(
    readStorageWithLegacyFallback(legacyOnly, "current", "legacy"),
    { raw: "old-state", hasLegacy: true },
  );

  const both = memoryStorage({ current: "new-state", legacy: "old-state" });
  assert.deepEqual(readStorageWithLegacyFallback(both, "current", "legacy"), {
    raw: "new-state",
    hasLegacy: true,
  });
});

test("removes legacy state only after the renamed state is written", () => {
  const storage = memoryStorage({ legacy: "old-state" });
  writeStorageAndRemoveLegacy(
    storage,
    "current",
    "legacy",
    "new-state",
    true,
  );
  assert.equal(storage.values.get("current"), "new-state");
  assert.equal(storage.values.has("legacy"), false);

  const failing = memoryStorage({ legacy: "old-state" });
  failing.setItem = () => {
    throw new Error("quota exceeded");
  };
  assert.throws(() =>
    writeStorageAndRemoveLegacy(
      failing,
      "current",
      "legacy",
      "new-state",
      true,
    ),
  );
  assert.equal(failing.values.get("legacy"), "old-state");
});
