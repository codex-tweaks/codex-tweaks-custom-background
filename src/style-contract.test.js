import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("./style.css", import.meta.url), "utf8");

test("keeps the wallpaper canvas transparent while the Codex window is inactive", () => {
  const inactiveCanvasRule = css.match(
    /:root\.electron-opaque\[data-codex-tweaks-cbgp-theme\],\s*:root\.electron-opaque\[data-codex-tweaks-cbgp-theme\] body\s*\{[^}]*\}/,
  )?.[0];

  assert.ok(inactiveCanvasRule, "missing the inactive-window canvas override");
  assert.match(
    inactiveCanvasRule,
    /background-color:\s*transparent\s*!important/,
  );
});

test("renders transparent sources without an image and can frost the window backdrop", () => {
  assert.match(
    css,
    /\[data-codex-tweaks-cbgp-wallpaper\]\[data-codex-tweaks-cbgp-transparent\]::before\s*\{[^}]*background-image:\s*none[^}]*filter:\s*none/s,
  );
  assert.match(
    css,
    /:root\[data-codex-tweaks-cbgp-background-frost\][^{]*\[data-codex-tweaks-cbgp-wallpaper\]\[data-codex-tweaks-cbgp-transparent\]\s*\{[^}]*backdrop-filter:[^}]*blur\(var\(--ct-cbgp-background-frost-blur/s,
  );
  assert.match(
    css,
    /\.ct-cbgp-preview\.ct-cbgp-transparent\s*\{[^}]*background-image:\s*conic-gradient/s,
  );
  assert.match(css, /content:\s*attr\(data-empty-label\)/);
});

test("leaves the home composer layout shell transparent for its rounded inner material", () => {
  const guardedHomeComposerSelector =
    '[data-composer-surface-variant]:not([data-composer-utility-bar-variant="home"])';
  const matches = css.match(
    /\[data-composer-surface-variant\]:not\(\[data-composer-utility-bar-variant="home"\]\)/g,
  );

  assert.equal(
    matches?.length,
    2,
    `expected both frost and surface-color rules to use ${guardedHomeComposerSelector}`,
  );
});

test("removes the app-shell top fade only from the home composer", () => {
  assert.match(
    css,
    /:root\[data-codex-tweaks-cbgp-theme\]:has\(\[data-composer-placement="home"\]\)\s+\[data-app-shell-main-content-top-fade\]\s*\{[^}]*background-image:\s*none\s*!important/,
  );
});

test("removes the thread composer surface fade that becomes a translucent band", () => {
  assert.match(
    css,
    /:root\[data-codex-tweaks-cbgp-theme\]\s+\[data-app-action-timeline-scroll\]\s+\[aria-hidden="true"\]\[class~="bg-gradient-to-t"\]\[class~="from-surface"\]\[class~="via-surface"\]\s*\{[^}]*background-image:\s*none\s*!important/,
  );
});

test("keeps the draggable button geometry unscaled", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rootRule = css.match(
    /\[data-codex-tweaks-cbgp-random-button\]\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(rootRule, "missing the draggable root rule");
  assert.match(rootRule, /width:\s*44px/);
  assert.match(rootRule, /height:\s*44px/);
  assert.doesNotMatch(rootRule, /\b(?:scale|transform)\s*:/);

  const scaledTriggerRules = rules
    .filter(([, selector, body]) =>
      selector.includes("[data-codex-tweaks-cbgp-random-trigger]") &&
      /\bscale\s*:/.test(body),
    );

  assert.ok(scaledTriggerRules.length >= 3);
  for (const [, selector] of scaledTriggerRules) {
    assert.match(
      selector,
      /\[data-codex-tweaks-cbgp-random-trigger\][^,{]*>\s*svg/,
      `random-button scale must stay on its trigger icon: ${selector.trim()}`,
    );
  }
});

test("reveals quick actions with compositor-friendly CSS motion", () => {
  const quickActionsRule = css.match(
    /\[data-codex-tweaks-cbgp-quick-actions\]\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(quickActionsRule, "missing quick-actions material rule");
  assert.match(quickActionsRule, /opacity:\s*0/);
  assert.match(quickActionsRule, /flex-direction:\s*column/);
  assert.match(quickActionsRule, /bottom:\s*calc\(100%\s*\+\s*8px\)/);
  assert.match(quickActionsRule, /transform:\s*translate3d\(-50%,\s*10px,\s*0\)\s*scale\(0\.84\)/);
  assert.doesNotMatch(quickActionsRule, /transition:[^;}]*\b(?:width|height|left|top)\b/s);
  assert.match(
    css,
    /:not\(\[data-dragging\]\):not\(\[data-expand-suppressed\]\)[^{]*\[data-codex-tweaks-cbgp-quick-actions\]\s*\{[^}]*opacity:\s*1[^}]*transition-duration:\s*260ms/s,
  );
  assert.match(css, /\[data-expand-down\][^{]*\[data-codex-tweaks-cbgp-quick-actions\]/s);
  assert.match(css, /content:\s*attr\(data-codex-tweaks-cbgp-tooltip\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\[data-codex-tweaks-cbgp-quick-actions\]/);
});

test("renders the settings dropdown as a translucent animated material", () => {
  const menuRule = css.match(/\.ct-cbgp-select-menu\s*\{([^}]*)\}/)?.[1];
  assert.ok(menuRule, "missing the custom select menu material");
  assert.match(menuRule, /backdrop-filter:\s*blur\(24px\)\s*saturate\(1\.24\)/);
  assert.match(menuRule, /border-radius:\s*12px/);
  assert.match(menuRule, /opacity:\s*0/);
  assert.match(menuRule, /transform:\s*translate3d\(0,\s*-5px,\s*0\)\s*scale\(0\.98\)/);
  assert.doesNotMatch(menuRule, /transition:[^;}]*\b(?:width|height|left|top)\b/s);
  assert.match(css, /\.ct-cbgp-select-control\[data-open\]\s+\.ct-cbgp-select-menu\s*\{[^}]*opacity:\s*1/s);
  assert.match(css, /\.ct-cbgp-select-option\[aria-selected="true"\]/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ct-cbgp-select-menu/);
});
