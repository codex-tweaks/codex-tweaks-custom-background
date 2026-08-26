import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSPARENT_BACKGROUND_KIND,
  canStoreBackgroundHistory,
  hasConfiguredBackgroundKind,
  isTransparentBackgroundActive,
  normalizeBackgroundKind,
} from "./background-mode.js";

test("normalizes transparent as a first-class background source", () => {
  assert.equal(
    normalizeBackgroundKind(TRANSPARENT_BACKGROUND_KIND),
    TRANSPARENT_BACKGROUND_KIND,
  );
  assert.equal(normalizeBackgroundKind("unsupported"), "none");
});

test("keeps transparent configured while allowing the background effect to be paused", () => {
  assert.equal(hasConfiguredBackgroundKind(TRANSPARENT_BACKGROUND_KIND, null), true);
  assert.equal(isTransparentBackgroundActive(TRANSPARENT_BACKGROUND_KIND, true), true);
  assert.equal(isTransparentBackgroundActive(TRANSPARENT_BACKGROUND_KIND, false), false);
});

test("keeps transparent sources out of image history", () => {
  assert.equal(canStoreBackgroundHistory(TRANSPARENT_BACKGROUND_KIND), false);
  assert.equal(canStoreBackgroundHistory("none"), false);
  assert.equal(canStoreBackgroundHistory("alcy"), true);
  assert.equal(canStoreBackgroundHistory("url"), true);
  assert.equal(canStoreBackgroundHistory("local"), true);
});
