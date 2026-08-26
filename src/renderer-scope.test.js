import test from "node:test";
import assert from "node:assert/strict";
import { isCodexPetRendererLocation } from "./renderer-scope.js";

test("identifies the Codex pet overlay renderer", () => {
  assert.equal(
    isCodexPetRendererLocation(
      "app://-/index.html?initialRoute=%2Favatar-overlay",
    ),
    true,
  );
});

test("identifies every pet composition surface without depending on its surface id", () => {
  for (const surfaceId of ["activity-slot-0", "mascot-badge", "voice-output"]) {
    assert.equal(
      isCodexPetRendererLocation(
        `app://-/avatar-overlay-composition-surface.html?surfaceId=${surfaceId}`,
      ),
      true,
    );
  }
});

test("keeps the main Codex renderer inside the custom-background scope", () => {
  assert.equal(isCodexPetRendererLocation("app://-/index.html"), false);
  assert.equal(isCodexPetRendererLocation("not a url"), false);
});
