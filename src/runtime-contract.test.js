import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./index.js", import.meta.url), "utf8");

test("reacts to DOM changes without periodically repainting the wallpaper", () => {
  assert.doesNotMatch(source, /\bsetInterval\s*\(/);
  assert.match(source, /new MutationObserver\(scheduleDOMSync\)/);
  assert.match(
    source,
    /if \(!wallpaperNode\?\.isConnected\) applyWallpaper\(\)/,
  );
});

test("keeps quick background controls stateful and outside the drag handle", () => {
  assert.match(source, /backgroundEnabled:\s*parsed\.backgroundEnabled\s*!==\s*false/);
  assert.match(source, /state\.backgroundEnabled\s*=\s*!state\.backgroundEnabled/);
  assert.match(source, /handle:\s*`\[\$\{BUTTON_TRIGGER_MARKER\}\]`/);
  assert.match(source, /cancel:\s*`\[\$\{QUICK_ACTIONS_MARKER\}\]`/);
  assert.match(source, /setAttribute\("aria-pressed",\s*String\(pressed\)\)/);
});

test("routes non-random button modes and the settings action to this package settings page", () => {
  assert.match(
    source,
    /settingsSectionRegistration\s*=\s*settingsSections\?\.register\(/,
  );
  assert.match(source, /settingsSectionRegistration\?\.open\(\)/);
  assert.match(
    source,
    /if\s*\(state\.kind\s*!==\s*"alcy"\)\s*\{\s*openCustomBackgroundSettings\(\)/s,
  );
  assert.match(source, /randomMode\s*\?\s*"random"\s*:\s*"image"/);
  assert.match(source, /action:\s*"settings"/);
});

test("uses authored floating-control tooltips instead of native titles", () => {
  assert.match(source, /setAttribute\(TOOLTIP_MARKER,\s*label\)/);
  assert.match(
    source,
    /randomButtonTriggerNode\.setAttribute\(TOOLTIP_MARKER,\s*tooltipLabel\)/,
  );
  assert.doesNotMatch(
    source.slice(source.indexOf("function createQuickActionButton"), source.indexOf("function createRandomButton")),
    /\.title\s*=/,
  );
});

test("keeps transparent backgrounds inside the active theme and frost pipeline", () => {
  assert.match(
    source,
    /const transparent\s*=\s*isTransparentBackgroundActive\(\s*state\.kind,\s*state\.backgroundEnabled/s,
  );
  assert.match(source, /node\.toggleAttribute\(TRANSPARENT_MARKER,\s*transparent\)/);
  assert.match(
    source,
    /runtimeHost\.toggleAttribute\(TRANSPARENT_MARKER,\s*transparent\)/,
  );
  assert.match(source, /if\s*\(!url\s*&&\s*!transparent\)/);
  assert.match(
    source,
    /\[TRANSPARENT_BACKGROUND_KIND,\s*isChinese\s*\?\s*"透明背景"/,
  );
  assert.match(source, /cancelPendingImageJob\(\);\s*state\.backgroundEnabled\s*=\s*true/s);
});

test("uses an accessible custom listbox while retaining the native select state bridge", () => {
  assert.match(source, /nativeSelect\.hidden\s*=\s*true/);
  assert.match(source, /trigger\.setAttribute\("aria-haspopup",\s*"listbox"\)/);
  assert.match(source, /menu\.setAttribute\("role",\s*"listbox"\)/);
  assert.match(source, /optionNode\.setAttribute\("role",\s*"option"\)/);
  assert.match(source, /event\.key\s*===\s*"ArrowDown"/);
  assert.match(source, /event\.key\s*===\s*"Escape"/);
  assert.match(source, /closeOpenSettingsSelect\(\{ restoreFocus: true \}\)/);
});

test("uses a dedicated local image button without exposing stale native file status", () => {
  assert.match(source, /fileInput\.hidden\s*=\s*true/);
  assert.match(source, /fileButton\.setAttribute\("data-slot",\s*"file-button"\)/);
  assert.match(source, /fileInput\.value\s*=\s*"";\s*fileInput\.click\(\)/s);
  assert.match(source, /state\.dataUrl[\s\S]*"更换图片"[\s\S]*"选择图片"/);
});

test("excludes pet renderers and clears artifacts before starting the background runtime", () => {
  const scopeGuardIndex = source.indexOf(
    "if (isCodexPetRendererLocation(window.location.href))",
  );
  const nodeRequirementIndex = source.indexOf(
    'if (!node) throw new Error("Node runtime is required")',
  );

  assert.ok(scopeGuardIndex >= 0, "missing the pet-renderer scope guard");
  assert.ok(
    scopeGuardIndex < nodeRequirementIndex,
    "pet renderers must return before the Node-backed background runtime starts",
  );
  assert.match(source, /cleanupPetRenderer\(\);\s*api\.registerCleanup\(cleanupPetRenderer\)/s);
  assert.match(source, /const CURRENT_BACKGROUND_NODE_MARKERS\s*=\s*\[/);
  assert.match(source, /const CURRENT_BACKGROUND_ROOT_MARKERS\s*=\s*\[/);
});
