import test from "node:test";
import assert from "node:assert/strict";

import {
  clampButtonPosition,
  createButtonBounds,
  dockedButtonPosition,
  nearestButtonDock,
  normalizeButtonDock,
  normalizeButtonDockOffset,
} from "./button-dock.js";

const bounds = createButtonBounds({
  viewportWidth: 1200,
  viewportHeight: 800,
  buttonWidth: 44,
  buttonHeight: 44,
  edgeGap: 18,
  topGap: 54,
});

test("normalizes persisted dock values", () => {
  assert.equal(normalizeButtonDock("left"), "left");
  assert.equal(normalizeButtonDock("unknown"), "right");
  assert.equal(normalizeButtonDockOffset(-1), 0);
  assert.equal(normalizeButtonDockOffset(1.5), 1);
  assert.equal(normalizeButtonDockOffset("invalid"), 0.9);
});

test("places a docked button at a viewport edge", () => {
  assert.deepEqual(dockedButtonPosition("right", 0.5, bounds), {
    x: 1138,
    y: 396,
  });
  assert.deepEqual(dockedButtonPosition("top", 0, bounds), {
    x: 18,
    y: 54,
  });
});

test("snaps to the nearest edge and keeps the along-edge position", () => {
  const result = nearestButtonDock({ x: 260, y: 730 }, bounds);

  assert.equal(result.dock, "bottom");
  assert.equal(result.position.y, bounds.maxY);
  assert.equal(result.position.x, 260);
  assert.equal(result.offset, (260 - bounds.minX) / (bounds.maxX - bounds.minX));
});

test("clamps positions and survives a viewport smaller than the button", () => {
  assert.deepEqual(clampButtonPosition({ x: -50, y: 900 }, bounds), {
    x: bounds.minX,
    y: bounds.maxY,
  });

  const tinyBounds = createButtonBounds({
    viewportWidth: 24,
    viewportHeight: 24,
    buttonWidth: 44,
    buttonHeight: 44,
  });
  assert.deepEqual(tinyBounds, { minX: 0, maxX: 0, minY: 0, maxY: 0 });
  assert.deepEqual(dockedButtonPosition("right", 0.9, tinyBounds), { x: 0, y: 0 });
});
