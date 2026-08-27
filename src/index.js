import "./style.css";
import { Draggable } from "@neodrag/vanilla";
import {
  DEFAULT_BUTTON_DOCK,
  DEFAULT_BUTTON_DOCK_OFFSET,
  clampButtonPosition,
  createButtonBounds,
  dockedButtonPosition,
  nearestButtonDock,
  normalizeButtonDock,
  normalizeButtonDockOffset,
} from "./button-dock.js";
import {
  readStorageWithLegacyFallback,
  writeStorageAndRemoveLegacy,
} from "./storage-migration.js";
import {
  TRANSPARENT_BACKGROUND_KIND,
  canStoreBackgroundHistory,
  hasConfiguredBackgroundKind,
  isTransparentBackgroundActive,
  normalizeBackgroundKind as normalizeKind,
} from "./background-mode.js";
import { isCodexPetRendererLocation } from "./renderer-scope.js";

// 把 Codex 的背景替换为可选择的透明画布或壁纸：随机来源（栗次元 t.alcy.cc）通过聊天页
// 可拖动并吸附窗口边缘的「换一张」按钮触发；设置页中的独立「自定义背景」路由
// 可查看当前背景与最近 10 张历史背景、切换背景来源（透明 / 随机 / 远程 URL /
// 本地文件）、控制随机按钮显示。所有状态保存在 localStorage，重启后保留。
//
// 随机原理：https://t.alcy.cc/pc/ 会 302 到一张确定的最终图片
// （https://tc.alcy.cc/tc/<日期>/<hash>.webp），保存「最终图片地址」即可
// 跨重启保持同一张。最终地址由已授权的包级 Node 后端解析，不受页面
// CSP 限制；只有取得并验证最终地址后才会替换当前背景和写入历史。

const RUNTIME_KEY = Symbol.for("codex-tweaks.codex-custom-background.runtime");
const LEGACY_RUNTIME_KEY = Symbol.for("codex-tweaks.codex-random-background.runtime");
const WALLPAPER_MARKER = "data-codex-tweaks-cbgp-wallpaper";
const THEME_MARKER = "data-codex-tweaks-cbgp-theme";
const FROST_MARKER = "data-codex-tweaks-cbgp-frost";
const BACKGROUND_FROST_MARKER = "data-codex-tweaks-cbgp-background-frost";
const TRANSPARENT_MARKER = "data-codex-tweaks-cbgp-transparent";
const BUTTON_MARKER = "data-codex-tweaks-cbgp-random-button";
const BUTTON_TRIGGER_MARKER = "data-codex-tweaks-cbgp-random-trigger";
const QUICK_ACTIONS_MARKER = "data-codex-tweaks-cbgp-quick-actions";
const QUICK_ACTION_MARKER = "data-codex-tweaks-cbgp-quick-action";
const TOOLTIP_MARKER = "data-codex-tweaks-cbgp-tooltip";
const PANEL_MARKER = "data-codex-tweaks-cbgp-settings-panel";
const LEGACY_SETTINGS_EMBED_MARKER = "data-codex-tweaks-cbgp-embed";
const SETTINGS_NAV_LABEL = "自定义背景";
const IMAGE_JOB_MARKER = "data-codex-tweaks-cbgp-loading";
const STORAGE_KEY = "codex-tweaks:codex-custom-background:v1";
const LEGACY_STORAGE_KEY = "codex-tweaks:codex-random-background:v1";
const HISTORY_LIMIT = 10;
const STORED_IMAGE_MAX_EDGE = 2560;
const STORED_IMAGE_QUALITY = 0.82;
const DOM_SYNC_DEBOUNCE_MS = 80;
const MASK_DEFAULTS = Object.freeze({
  light: Object.freeze({ color: "#f6f6f6", opacity: 0.72 }),
  dark: Object.freeze({ color: "#141418", opacity: 0.76 }),
});
const FROST_DEFAULTS = Object.freeze({ enabled: true, strength: 0.6 });
const FROST_MAX_BLUR_PX = 28;
const BACKGROUND_FROST_DEFAULTS = Object.freeze({ enabled: false, strength: 0.5 });
const BACKGROUND_FROST_MAX_BLUR_PX = 32;
const ACTION_TOAST_DURATION_MS = 3600;
const RANDOM_BUTTON_SIZE_PX = 44;
const RANDOM_BUTTON_EDGE_GAP_PX = 18;
const RANDOM_BUTTON_TOP_GAP_PX = 54;
const RANDOM_BUTTON_DRAG_THRESHOLD_PX = 5;
const RANDOM_BUTTON_SNAP_DURATION_MS = 280;
const RANDOM_BUTTON_CLICK_SUPPRESSION_MS = 250;
const LEGACY_SURFACE_MARKERS = [
  "data-codex-tweaks-cbgp-transparent-surface",
  "data-codex-tweaks-cbgp-material-surface",
  "data-codex-tweaks-cbgp-hidden-chrome",
  "data-codex-tweaks-cbgp-composer-surface",
  "data-codex-tweaks-cbgp-suggestion-card",
  "data-codex-tweaks-rbgp-transparent-surface",
  "data-codex-tweaks-rbgp-material-surface",
  "data-codex-tweaks-rbgp-hidden-chrome",
  "data-codex-tweaks-rbgp-composer-surface",
  "data-codex-tweaks-rbgp-suggestion-card",
];
const LEGACY_RANDOM_BACKGROUND_NODE_MARKERS = [
  "data-codex-tweaks-rbgp-wallpaper",
  "data-codex-tweaks-rbgp-random-button",
  "data-codex-tweaks-rbgp-settings-panel",
  "data-codex-tweaks-rbgp-embed",
  "data-codex-tweaks-rbgp-context-menu",
  "data-codex-tweaks-rbgp-action-toast",
];
const LEGACY_RANDOM_BACKGROUND_ROOT_MARKERS = [
  "data-codex-tweaks-rbgp-theme",
  "data-codex-tweaks-rbgp-frost",
  "data-codex-tweaks-rbgp-background-frost",
  "data-codex-tweaks-rbgp-loading",
];
const CURRENT_BACKGROUND_NODE_MARKERS = [
  WALLPAPER_MARKER,
  BUTTON_MARKER,
  PANEL_MARKER,
  "data-codex-tweaks-cbgp-context-menu",
  "data-codex-tweaks-cbgp-action-toast",
];
const CURRENT_BACKGROUND_ROOT_MARKERS = [
  THEME_MARKER,
  FROST_MARKER,
  BACKGROUND_FROST_MARKER,
  TRANSPARENT_MARKER,
  IMAGE_JOB_MARKER,
];

const RANDOM_PROVIDERS = new Map([
  [
    "alcy-pc",
    {
      id: "alcy-pc",
      label: "栗次元（t.alcy.cc）",
      url: "https://t.alcy.cc/pc/",
      jsonUrl: "https://t.alcy.cc/json/?pc=1",
      imageOrigins: ["https://tc.alcy.cc"],
    },
  ],
]);
const DEFAULT_PROVIDER_ID = "alcy-pc";

function isResolvedRandomImageUrl(value, provider = null) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const providers = provider ? [provider] : [...RANDOM_PROVIDERS.values()];
    return providers.some((candidate) =>
      candidate.imageOrigins?.includes(parsed.origin),
    );
  } catch {
    return false;
  }
}

function normalizeMaskColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

function normalizeMaskOpacity(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function maskRGBTriplet(color) {
  const normalized = normalizeMaskColor(color, "#000000");
  return [1, 3, 5]
    .map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
    .join(" ");
}

export function activate({ api, node, ui }) {
  const runtimeHost = document.documentElement;
  runtimeHost[RUNTIME_KEY]?.cleanup?.();
  runtimeHost[LEGACY_RUNTIME_KEY]?.cleanup?.();

  function removeLegacyRandomBackgroundArtifacts() {
    for (const marker of LEGACY_RANDOM_BACKGROUND_NODE_MARKERS) {
      for (const node of document.querySelectorAll(`[${marker}]`)) node.remove();
    }
    for (const marker of LEGACY_RANDOM_BACKGROUND_ROOT_MARKERS) {
      runtimeHost.removeAttribute(marker);
    }
    runtimeHost.style.removeProperty("--ct-rbgp-frost-blur");
  }

  // 1.0.0 早期版本会把设置面板直接嵌入「个性化」。独立设置路由启用后，
  // 主动移除热重载或异常退出可能留下的旧节点，避免同一套设置同时出现在两处。
  function removeLegacySettingsEmbed() {
    for (const node of document.querySelectorAll(`[${LEGACY_SETTINGS_EMBED_MARKER}]`)) {
      node.remove();
    }
  }

  function removeLegacySurfaceMarkers() {
    for (const marker of LEGACY_SURFACE_MARKERS) {
      for (const node of document.querySelectorAll(`[${marker}]`)) {
        node.removeAttribute(marker);
      }
    }
  }

  function removeCurrentBackgroundArtifacts() {
    for (const marker of CURRENT_BACKGROUND_NODE_MARKERS) {
      for (const node of document.querySelectorAll(`[${marker}]`)) node.remove();
    }
    for (const marker of CURRENT_BACKGROUND_ROOT_MARKERS) {
      runtimeHost.removeAttribute(marker);
    }
    runtimeHost.style.removeProperty("--ct-cbgp-frost-blur");
  }

  removeLegacyRandomBackgroundArtifacts();
  removeLegacySettingsEmbed();
  removeLegacySurfaceMarkers();

  // Codex 宠物运行在独立透明 Renderer 及多个 composition surface 中。背景包
  // 只属于主 Codex 窗口；在宠物 Renderer 继续创建全屏壁纸/遮罩，会直接变成
  // 宠物背后的矩形底板。热重载时也主动清理旧版本可能留下的当前标记。
  if (isCodexPetRendererLocation(window.location.href)) {
    const cleanupPetRenderer = () => {
      removeCurrentBackgroundArtifacts();
      if (runtimeHost[RUNTIME_KEY]?.cleanup === cleanupPetRenderer) {
        delete runtimeHost[RUNTIME_KEY];
      }
    };
    cleanupPetRenderer();
    api.registerCleanup(cleanupPetRenderer);
    runtimeHost[RUNTIME_KEY] = { cleanup: cleanupPetRenderer };
    return;
  }

  if (!node) throw new Error("Node runtime is required");
  const network = {
    request(parameters) {
      return node.invoke("network.request", parameters);
    },
  };
  // 设置模块只存在于主窗口；背景与设置也都限制在主窗口。
  const settingsSections = ui.settingsSections;

  let disposed = false;
  let shouldRefreshLegacyRandom = false;
  let shouldRemoveLegacyStorage = false;
  let state = loadState();
  let wallpaperNode = null;
  let randomButtonNode = null;
  let randomButtonTriggerNode = null;
  let backgroundToggleNode = null;
  let backgroundFrostToggleNode = null;
  let settingsActionNode = null;
  let randomButtonDraggable = null;
  let randomButtonDragging = false;
  let randomButtonSnapTimer = null;
  let randomButtonResizeFrame = null;
  let suppressRandomButtonClick = false;
  let suppressRandomButtonClickTimer = null;
  let settingsPaneNode = null;
  let settingsSectionRegistration = null;
  let openSettingsSelect = null;
  let settingsSelectSequence = 0;
  let panelOpen = false;
  let historyContextMenuNode = null;
  let historyContextMenuTriggerNode = null;
  let historyActionPending = false;
  let actionToastNode = null;
  let actionToastTimer = null;
  let confirmDialogNode = null;
  let confirmDialogReturnFocusNode = null;
  let imageJobToken = 0;
  let domObserver = null;
  let domSyncTimer = null;

  /* -------------------------------- 状态 -------------------------------- */

  function loadState() {
    try {
      const stored = readStorageWithLegacyFallback(
        window.localStorage,
        STORAGE_KEY,
        LEGACY_STORAGE_KEY,
      );
      shouldRemoveLegacyStorage = stored.hasLegacy;
      const { raw } = stored;
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      const storedKind = normalizeKind(parsed.kind);
      const resolvedRandomUrl = isResolvedRandomImageUrl(parsed.finalUrl)
        ? parsed.finalUrl.trim()
        : isResolvedRandomImageUrl(parsed.alcyUrl)
          ? parsed.alcyUrl.trim()
          : "";
      const kind = storedKind === "alcy" && !resolvedRandomUrl ? "none" : storedKind;
      if (storedKind === "alcy" && kind === "none") {
        shouldRefreshLegacyRandom = true;
      }
      return {
        showButton: parsed.showButton !== false,
        backgroundEnabled: parsed.backgroundEnabled !== false,
        buttonDock: normalizeButtonDock(parsed.buttonDock),
        buttonDockOffset: normalizeButtonDockOffset(parsed.buttonDockOffset),
        maskLightColor: normalizeMaskColor(
          parsed.maskLightColor,
          MASK_DEFAULTS.light.color,
        ),
        maskLightOpacity: normalizeMaskOpacity(
          parsed.maskLightOpacity,
          MASK_DEFAULTS.light.opacity,
        ),
        maskDarkColor: normalizeMaskColor(
          parsed.maskDarkColor,
          MASK_DEFAULTS.dark.color,
        ),
        maskDarkOpacity: normalizeMaskOpacity(
          parsed.maskDarkOpacity,
          MASK_DEFAULTS.dark.opacity,
        ),
        frostEnabled: parsed.frostEnabled !== false,
        frostStrength: normalizeMaskOpacity(
          parsed.frostStrength,
          FROST_DEFAULTS.strength,
        ),
        backgroundFrostEnabled: parsed.backgroundFrostEnabled === true,
        backgroundFrostStrength: normalizeMaskOpacity(
          parsed.backgroundFrostStrength,
          BACKGROUND_FROST_DEFAULTS.strength,
        ),
        kind,
        providerId: normalizeProviderId(parsed.providerId),
        url: typeof parsed.url === "string" ? parsed.url : "",
        dataUrl: typeof parsed.dataUrl === "string" ? parsed.dataUrl : "",
        finalUrl: kind === "alcy" ? resolvedRandomUrl : "",
        alcyUrl: kind === "alcy" ? resolvedRandomUrl : "",
        updatedAt: Number(parsed.updatedAt) || 0,
        history: Array.isArray(parsed.history)
          ? parsed.history
              .map(normalizeHistoryEntry)
              .filter(Boolean)
              .slice(0, HISTORY_LIMIT)
          : [],
      };
    } catch {
      return defaultState();
    }
  }

  function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const kind = normalizeKind(entry.kind);
    if (!canStoreBackgroundHistory(kind)) return null;
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    const dataUrl = typeof entry.dataUrl === "string" ? entry.dataUrl : "";
    if (kind === "alcy" && !isResolvedRandomImageUrl(url)) return null;
    if (kind === "url" && !/^(https?:|data:image\/)/i.test(url)) return null;
    if (kind === "local" && !/^data:image\//i.test(dataUrl)) return null;
    const normalized = {
      kind,
      id: typeof entry.id === "string" ? entry.id : "",
      url,
      dataUrl,
      updatedAt: Number(entry.updatedAt) || 0,
    };
    normalized.id = historyEntryId(normalized);
    return normalized;
  }

  function defaultState() {
    return {
      showButton: true,
      backgroundEnabled: true,
      buttonDock: DEFAULT_BUTTON_DOCK,
      buttonDockOffset: DEFAULT_BUTTON_DOCK_OFFSET,
      maskLightColor: MASK_DEFAULTS.light.color,
      maskLightOpacity: MASK_DEFAULTS.light.opacity,
      maskDarkColor: MASK_DEFAULTS.dark.color,
      maskDarkOpacity: MASK_DEFAULTS.dark.opacity,
      frostEnabled: FROST_DEFAULTS.enabled,
      frostStrength: FROST_DEFAULTS.strength,
      backgroundFrostEnabled: BACKGROUND_FROST_DEFAULTS.enabled,
      backgroundFrostStrength: BACKGROUND_FROST_DEFAULTS.strength,
      kind: "none",
      providerId: DEFAULT_PROVIDER_ID,
      url: "",
      dataUrl: "",
      finalUrl: "",
      alcyUrl: "",
      updatedAt: 0,
      history: [],
    };
  }

  function normalizeProviderId(id) {
    if (typeof id === "string" && RANDOM_PROVIDERS.has(id)) return id;
    return DEFAULT_PROVIDER_ID;
  }

  function getActiveProvider() {
    return RANDOM_PROVIDERS.get(state.providerId) ?? RANDOM_PROVIDERS.get(DEFAULT_PROVIDER_ID);
  }

  function historyEntryId(entry) {
    if (typeof entry?.id === "string" && entry.id) return entry.id;
    return `${Number(entry?.updatedAt) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function persistState() {
    try {
      writeStorageAndRemoveLegacy(
        window.localStorage,
        STORAGE_KEY,
        LEGACY_STORAGE_KEY,
        JSON.stringify(state),
        shouldRemoveLegacyStorage,
      );
      shouldRemoveLegacyStorage = false;
    } catch {
      // 存储满或受限时保持内存态，包功能继续可用。
    }
  }

  function pushHistory(kind, extra) {
    const entry = normalizeHistoryEntry({
      kind,
      updatedAt: Date.now(),
      ...(extra ?? {}),
    });
    if (!entry) return;
    state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
    state.updatedAt = entry.updatedAt;
  }

  /* ------------------------------ 壁纸层 -------------------------------- */

  function resolveBackgroundUrl() {
    if (state.kind === "url" && state.url.trim()) return state.url.trim();
    if (state.kind === "local" && state.dataUrl) return state.dataUrl;
    if (state.kind === "alcy") {
      if (isResolvedRandomImageUrl(state.finalUrl)) return state.finalUrl;
      if (isResolvedRandomImageUrl(state.alcyUrl)) return state.alcyUrl;
    }
    return null;
  }

  function hasConfiguredBackground() {
    return hasConfiguredBackgroundKind(state.kind, resolveBackgroundUrl());
  }

  function cssEscapeUrl(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function applyMaskVariables(node) {
    node.style.setProperty("--ct-cbgp-mask-light-rgb", maskRGBTriplet(state.maskLightColor));
    node.style.setProperty(
      "--ct-cbgp-mask-light-opacity",
      String(state.maskLightOpacity),
    );
    node.style.setProperty("--ct-cbgp-mask-dark-rgb", maskRGBTriplet(state.maskDarkColor));
    node.style.setProperty(
      "--ct-cbgp-mask-dark-opacity",
      String(state.maskDarkOpacity),
    );
  }

  function applyFrostAppearance() {
    runtimeHost.style.setProperty(
      "--ct-cbgp-frost-blur",
      `${Math.round(state.frostStrength * FROST_MAX_BLUR_PX)}px`,
    );
    runtimeHost.toggleAttribute(FROST_MARKER, state.frostEnabled);
  }

  function applyBackgroundFrostAppearance(node) {
    const blur = state.backgroundFrostEnabled
      ? Math.round(state.backgroundFrostStrength * BACKGROUND_FROST_MAX_BLUR_PX)
      : 0;
    node.style.setProperty("--ct-cbgp-background-frost-blur", `${blur}px`);
    node.style.setProperty(
      "--ct-cbgp-background-frost-overscan",
      `${Math.ceil(blur * 1.5)}px`,
    );
    runtimeHost.toggleAttribute(
      BACKGROUND_FROST_MARKER,
      state.backgroundFrostEnabled,
    );
  }

  function removeFrostAppearance() {
    runtimeHost.removeAttribute(FROST_MARKER);
    runtimeHost.removeAttribute(BACKGROUND_FROST_MARKER);
    runtimeHost.style.removeProperty("--ct-cbgp-frost-blur");
  }

  function applyPreviewBackground(preview, url) {
    if (!url) {
      preview.style.removeProperty("background-image");
      return;
    }
    // 「当前背景」承担原图对照用途；遮罩只作用于页面底层壁纸，避免用户
    // 调节颜色或强度时连参考图也被覆盖，无法判断实际调整幅度。
    preview.style.backgroundImage = `url("${cssEscapeUrl(url)}")`;
  }

  function ensureWallpaperNode() {
    if (wallpaperNode?.isConnected) return wallpaperNode;
    const node = document.createElement("div");
    node.setAttribute(WALLPAPER_MARKER, "");
    node.setAttribute("aria-hidden", "true");
    node.hidden = true;
    document.body.prepend(node);
    wallpaperNode = node;
    return node;
  }

  function applyWallpaper() {
    if (disposed) return;
    const transparent = isTransparentBackgroundActive(
      state.kind,
      state.backgroundEnabled,
    );
    const url = state.backgroundEnabled ? resolveBackgroundUrl() : null;
    const node = ensureWallpaperNode();
    applyMaskVariables(node);
    applyBackgroundFrostAppearance(node);
    node.toggleAttribute(TRANSPARENT_MARKER, transparent);
    runtimeHost.toggleAttribute(TRANSPARENT_MARKER, transparent);
    if (!url && !transparent) {
      node.hidden = true;
      node.style.removeProperty("--ct-cbgp-bg-image");
      runtimeHost.removeAttribute(THEME_MARKER);
      removeFrostAppearance();
      syncRandomButtonControls();
      return;
    }
    if (url) {
      node.style.setProperty("--ct-cbgp-bg-image", `url("${cssEscapeUrl(url)}")`);
    } else {
      node.style.removeProperty("--ct-cbgp-bg-image");
    }
    node.hidden = false;
    runtimeHost.setAttribute(THEME_MARKER, "");
    applyFrostAppearance();
    syncRandomButtonControls();
  }

  function removeWallpaper() {
    runtimeHost.removeAttribute(THEME_MARKER);
    runtimeHost.removeAttribute(TRANSPARENT_MARKER);
    removeFrostAppearance();
    wallpaperNode?.remove();
    wallpaperNode = null;
  }

  /* ---------------------------- 随机与固定来源 ---------------------------- */

  function setLoading(jobId, loading) {
    if (jobId !== imageJobToken || disposed) return;
    document.documentElement.toggleAttribute(IMAGE_JOB_MARKER, loading);
    randomButtonNode?.setAttribute("aria-busy", String(loading));
    randomButtonNode?.toggleAttribute("data-loading", loading);
    if (randomButtonTriggerNode) randomButtonTriggerNode.disabled = loading;
    randomButtonDraggable?.updateOptions({ disabled: loading });
  }

  function cancelPendingImageJob() {
    imageJobToken += 1;
    document.documentElement.removeAttribute(IMAGE_JOB_MARKER);
    randomButtonNode?.setAttribute("aria-busy", "false");
    randomButtonNode?.removeAttribute("data-loading");
    if (randomButtonTriggerNode) randomButtonTriggerNode.disabled = false;
    randomButtonDraggable?.updateOptions({ disabled: false });
  }

  function markFailed(message = "") {
    randomButtonNode?.setAttribute("data-failed", "");
    if (message) showActionToast(message, "error");
  }

  function preloadImage(src, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        image.src = "";
        reject(new Error("timeout"));
      }, timeoutMs);
      image.onload = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(image);
      };
      image.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error("load error"));
      };
      image.referrerPolicy = "no-referrer";
      image.src = src;
    });
  }

  function makeAlcyRequestUrl(provider) {
    // 每次点击都加唯一查询参数，强制浏览器重新请求，避免命中缓存后点击无效。
    return `${provider.url}?ct=${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function resolveFinalAlcyUrl(provider, requestUrl) {
    let redirectError = null;
    try {
      const redirected = await network.request({
        url: requestUrl,
        method: "HEAD",
        responseType: "none",
        timeoutMs: 8000,
      });
      if (
        redirected?.ok &&
        isResolvedRandomImageUrl(redirected.finalUrl, provider)
      ) {
        return redirected.finalUrl;
      }
      redirectError = new Error(`http ${redirected?.status ?? "unknown"}`);
    } catch (error) {
      redirectError = error;
    }

    if (!provider.jsonUrl) throw redirectError ?? new Error("no resolver");
    const response = await network.request({
      url: provider.jsonUrl,
      method: "GET",
      responseType: "json",
      timeoutMs: 8000,
    });
    if (!response?.ok) throw new Error(`http ${response?.status ?? "unknown"}`);
    const payload = response.body;
    const link =
      typeof payload?.data?.link === "string"
        ? payload.data.link
        : typeof payload?.link === "string"
          ? payload.link
          : "";
    if (!isResolvedRandomImageUrl(link, provider)) throw new Error("bad payload");
    return link;
  }

  function completeRandom(jobId, finalUrl) {
    if (disposed || jobId !== imageJobToken) return;
    state.backgroundEnabled = true;
    state.kind = "alcy";
    state.url = "";
    state.dataUrl = "";
    state.finalUrl = finalUrl;
    state.alcyUrl = finalUrl;
    pushHistory("alcy", { url: finalUrl });
    persistState();
    applyWallpaper();
    refreshSettingsPaneIfOpen();
  }

  function applyRandom() {
    const provider = getActiveProvider();
    if (!provider) return;
    const jobId = ++imageJobToken;
    setLoading(jobId, true);
    const requestUrl = makeAlcyRequestUrl(provider);

    resolveFinalAlcyUrl(provider, requestUrl)
      .then((finalUrl) => {
        if (disposed || jobId !== imageJobToken) return;
        return preloadImage(finalUrl).then(() => {
          completeRandom(jobId, finalUrl);
        });
      })
      .catch(() => {
        if (disposed || jobId !== imageJobToken) return;
        const { isChinese } = getLocaleStrings();
        markFailed(
          isChinese
            ? "随机图片获取失败，已保留当前背景，请稍后重试。"
            : "Could not load a random image. The current background was kept; try again later.",
        );
      })
      .finally(() => setLoading(jobId, false));
  }

  function applyFixedUrl(rawUrl) {
    const trimmed = String(rawUrl ?? "").trim();
    if (!/^(https?:|data:)/i.test(trimmed)) return false;
    const jobId = ++imageJobToken;
    setLoading(jobId, true);
    preloadImage(trimmed)
      .then((image) => {
        if (disposed || jobId !== imageJobToken) return;
        state.backgroundEnabled = true;
        state.kind = "url";
        state.url = trimmed;
        state.dataUrl = "";
        state.finalUrl = "";
        state.alcyUrl = "";
        pushHistory("url", { url: trimmed });
        persistState();
        applyWallpaper();
        refreshSettingsPaneIfOpen();
      })
      .catch(() => {
        if (disposed || jobId !== imageJobToken) return;
        markFailed();
      })
      .finally(() => setLoading(jobId, false));
    return true;
  }

  function applyLocalFile(file) {
    if (!file || !/^image\//i.test(file.type)) return;
    const jobId = ++imageJobToken;
    setLoading(jobId, true);
    fileToCompressedDataUrl(file, STORED_IMAGE_MAX_EDGE, STORED_IMAGE_QUALITY)
      .then((dataUrl) => {
        if (disposed || jobId !== imageJobToken) return;
        if (!dataUrl) {
          markFailed();
          return;
        }
        state.backgroundEnabled = true;
        state.kind = "local";
        state.dataUrl = dataUrl;
        state.url = "";
        state.finalUrl = "";
        state.alcyUrl = "";
        pushHistory("local", { dataUrl });
        persistState();
        applyWallpaper();
        refreshSettingsPaneIfOpen();
      })
      .catch(() => {
        if (disposed || jobId !== imageJobToken) return;
        markFailed();
      })
      .finally(() => setLoading(jobId, false));
  }

  function fileToCompressedDataUrl(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const probe = new Image();
        probe.onload = () => {
          try {
            const { width, height } = fitSize(
              probe.naturalWidth,
              probe.naturalHeight,
              maxEdge,
            );
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(probe, 0, 0, width, height);
            const webp = canvas.toDataURL("image/webp", quality);
            const out = webp.startsWith("data:image/webp")
              ? webp
              : canvas.toDataURL("image/jpeg", Math.min(0.9, quality + 0.06));
            resolve(out);
          } catch (error) {
            reject(error);
          }
        };
        probe.onerror = () => reject(new Error("image decode error"));
        probe.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function fitSize(width, height, maxEdge) {
    if (!width || !height) return { width: 1, height: 1 };
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  function clearBackground() {
    cancelPendingImageJob();
    state.backgroundEnabled = true;
    state.kind = "none";
    state.url = "";
    state.dataUrl = "";
    state.finalUrl = "";
    state.alcyUrl = "";
    state.updatedAt = Date.now();
    persistState();
    applyWallpaper();
    refreshSettingsPaneIfOpen();
  }

  function restoreHistoryEntry(entry) {
    if (!entry) return;
    const stored =
      entry.kind === "url" ? entry.url : entry.kind === "local" ? entry.dataUrl : "";
    const target = entry.kind === "alcy" ? entry.url : stored;
    if (!target) return;
    const jobId = ++imageJobToken;
    setLoading(jobId, true);
    preloadImage(target)
      .then((image) => {
        if (disposed || jobId !== imageJobToken) return;
        state.backgroundEnabled = true;
        state.kind = entry.kind;
        state.url = entry.kind === "url" ? entry.url : "";
        state.dataUrl = entry.kind === "local" ? entry.dataUrl : "";
        state.finalUrl = entry.kind === "alcy" ? entry.url : "";
        state.alcyUrl = entry.kind === "alcy" ? entry.url : "";
        state.updatedAt = Date.now();
        persistState();
        applyWallpaper();
        refreshSettingsPaneIfOpen();
      })
      .catch(() => {
        if (disposed || jobId !== imageJobToken) return;
        markFailed();
      })
      .finally(() => setLoading(jobId, false));
  }

  function clearHistory() {
    state.history = [];
    persistState();
    refreshSettingsPaneIfOpen();
  }

  /* ----------------------------- 随机按钮 -------------------------------- */

  function isSettingsPage() {
    return Boolean(document.querySelector("button[data-settings-panel-slug]"));
  }

  function isChatPage() {
    return Boolean(
      document.querySelector(
        'aside.app-shell-left-panel, main[class*="MainContentSurface"]',
      ),
    );
  }

  function createStrokeIcon(paths, strokeWidth = "1.8") {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("width", "18");
    icon.setAttribute("height", "18");
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", strokeWidth);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.append(path);
    }
    return icon;
  }

  function createQuickActionButton({ action, label, paths, strokeWidth, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(QUICK_ACTION_MARKER, "");
    button.setAttribute("data-action", action);
    button.setAttribute("aria-label", label);
    button.setAttribute(TOOLTIP_MARKER, label);
    button.append(createStrokeIcon(paths, strokeWidth));
    const indicator = document.createElement("span");
    indicator.className = "ct-cbgp-quick-action-indicator";
    indicator.setAttribute("aria-hidden", "true");
    button.append(indicator);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function updateQuickAction(button, { pressed, disabled, label, dormant = false }) {
    if (!button) return;
    button.disabled = disabled;
    if (typeof pressed === "boolean") {
      button.setAttribute("aria-pressed", String(pressed));
      button.toggleAttribute("data-on", pressed);
    } else {
      button.removeAttribute("aria-pressed");
      button.removeAttribute("data-on");
    }
    button.setAttribute("aria-label", label);
    button.setAttribute(TOOLTIP_MARKER, label);
    button.toggleAttribute("data-dormant", dormant);
  }

  function syncRandomButtonTrigger({ isChinese }) {
    if (!randomButtonTriggerNode) return;
    const randomMode = state.kind === "alcy";
    const iconMode = randomMode ? "random" : "image";
    const triggerLabel = randomMode
      ? isChinese
        ? "随机换一张背景，可拖动到窗口边缘"
        : "Randomize background; drag to a window edge"
      : isChinese
        ? "打开自定义背景设置，可拖动到窗口边缘"
        : "Open custom background settings; drag to a window edge";
    const tooltipLabel = randomMode
      ? isChinese ? "随机换一张" : "Randomize"
      : isChinese ? "打开背景设置" : "Open background settings";

    randomButtonTriggerNode.setAttribute(
      "data-action",
      randomMode ? "random" : "settings",
    );
    randomButtonTriggerNode.setAttribute("aria-label", triggerLabel);
    randomButtonTriggerNode.setAttribute(TOOLTIP_MARKER, tooltipLabel);
    if (randomButtonTriggerNode.dataset.iconMode === iconMode) return;
    randomButtonTriggerNode.dataset.iconMode = iconMode;
    randomButtonTriggerNode.replaceChildren(createStrokeIcon(randomMode ? [
      "M16 3h5v5",
      "M4 20L21 3",
      "M21 16v5h-5",
      "M15 15l6 6",
      "M4 4l5 5",
    ] : [
      "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
      "m4 15 3.5-3.5a1.5 1.5 0 0 1 2.1 0L13 15l1.4-1.4a1.5 1.5 0 0 1 2.1 0L20 17",
      "M15.5 9h.01",
    ]));
  }

  function syncRandomButtonControls() {
    if (!randomButtonNode) return;
    const { isChinese } = getLocaleStrings();
    const hasBackground = hasConfiguredBackground();
    const transparent = state.kind === TRANSPARENT_BACKGROUND_KIND;
    const backgroundOn = hasBackground && state.backgroundEnabled;
    const backgroundLabel = !hasBackground
      ? isChinese ? "暂无背景图片" : "No background image"
      : transparent
        ? backgroundOn
          ? isChinese ? "关闭透明背景" : "Turn off transparent background"
          : isChinese ? "开启透明背景" : "Turn on transparent background"
      : backgroundOn
        ? isChinese ? "关闭背景图片" : "Turn off background image"
        : isChinese ? "开启背景图片" : "Turn on background image";
    const frostLabel = !hasBackground
      ? isChinese ? "暂无背景图片可模糊" : "No background image to blur"
      : transparent
        ? state.backgroundFrostEnabled
          ? isChinese ? "关闭透明背景磨砂" : "Turn off transparent background frost"
          : isChinese ? "开启透明背景磨砂" : "Turn on transparent background frost"
      : state.backgroundFrostEnabled
        ? isChinese ? "关闭背景图片模糊" : "Turn off background blur"
        : isChinese ? "开启背景图片模糊" : "Turn on background blur";

    randomButtonNode.setAttribute("data-dock", normalizeButtonDock(state.buttonDock));
    randomButtonNode.setAttribute(
      "aria-label",
      isChinese ? "背景图片快捷操作" : "Background image quick actions",
    );
    randomButtonNode.querySelector(`[${QUICK_ACTIONS_MARKER}]`)?.setAttribute(
      "aria-label",
      isChinese ? "背景图片开关" : "Background image toggles",
    );
    syncRandomButtonTrigger({ isChinese });
    updateQuickAction(backgroundToggleNode, {
      pressed: backgroundOn,
      disabled: !hasBackground,
      label: backgroundLabel,
    });
    updateQuickAction(backgroundFrostToggleNode, {
      pressed: hasBackground && state.backgroundFrostEnabled,
      disabled: !hasBackground,
      dormant: hasBackground && !state.backgroundEnabled,
      label: frostLabel,
    });
    updateQuickAction(settingsActionNode, {
      pressed: null,
      disabled: !settingsSectionRegistration,
      label: isChinese ? "打开自定义背景设置" : "Open custom background settings",
    });
  }

  function syncRandomButtonPlacement({ x, y } = {}) {
    if (!randomButtonNode?.isConnected) return;
    const rect = randomButtonNode.getBoundingClientRect();
    const buttonX = Number.isFinite(x) ? x : rect.left;
    const buttonY = Number.isFinite(y) ? y : rect.top;
    const quickActions = randomButtonNode.querySelector(`[${QUICK_ACTIONS_MARKER}]`);
    const quickActionsHeight = quickActions?.scrollHeight ?? 0;
    randomButtonNode.setAttribute(
      "data-tooltip-side",
      buttonX + RANDOM_BUTTON_SIZE_PX / 2 > window.innerWidth / 2 ? "left" : "right",
    );
    // 默认按视觉顺序向上展开；只有顶部空间确实放不下时才向下避让，防止
    // 用户把按钮拖到标题栏附近后出现不可点击的屏外选项。
    randomButtonNode.toggleAttribute(
      "data-expand-down",
      buttonY < quickActionsHeight + RANDOM_BUTTON_EDGE_GAP_PX + 8,
    );
  }

  function setRandomButtonExpanded(expanded) {
    if (!randomButtonNode) return;
    const allowed = expanded && !randomButtonDragging &&
      !randomButtonNode.hasAttribute("data-expand-suppressed");
    randomButtonNode.toggleAttribute("data-expanded", allowed);
    randomButtonTriggerNode?.setAttribute("aria-expanded", String(allowed));
  }

  function toggleBackgroundEnabled() {
    if (!hasConfiguredBackground()) return;
    state.backgroundEnabled = !state.backgroundEnabled;
    persistState();
    applyWallpaper();
    refreshSettingsPaneIfOpen();
  }

  function toggleBackgroundFrost() {
    if (!hasConfiguredBackground()) return;
    state.backgroundFrostEnabled = !state.backgroundFrostEnabled;
    persistState();
    applyWallpaper();
    refreshSettingsPaneIfOpen();
  }

  function openCustomBackgroundSettings() {
    setRandomButtonExpanded(false);
    settingsSectionRegistration?.open();
  }

  function createRandomButton() {
    const root = document.createElement("div");
    root.setAttribute(BUTTON_MARKER, "");
    root.setAttribute("role", "group");
    root.setAttribute("aria-busy", "false");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.setAttribute(BUTTON_TRIGGER_MARKER, "");
    trigger.setAttribute("aria-controls", "ct-cbgp-quick-actions");
    trigger.setAttribute("aria-expanded", "false");

    const quickActions = document.createElement("div");
    quickActions.id = "ct-cbgp-quick-actions";
    quickActions.setAttribute(QUICK_ACTIONS_MARKER, "");
    quickActions.setAttribute("role", "toolbar");
    quickActions.setAttribute("aria-label", "背景图片开关");

    backgroundToggleNode = createQuickActionButton({
      action: "background",
      label: "开关背景图片",
      paths: [
        "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
        "m4 15 3.5-3.5a1.5 1.5 0 0 1 2.1 0L13 15l1.4-1.4a1.5 1.5 0 0 1 2.1 0L20 17",
        "M15.5 9h.01",
      ],
      onClick: toggleBackgroundEnabled,
    });
    backgroundFrostToggleNode = createQuickActionButton({
      action: "blur",
      label: "开关背景图片模糊",
      strokeWidth: "2.4",
      paths: [
        "M7 7h.01", "M12 6h.01", "M17 7h.01",
        "M6 12h.01", "M12 12h.01", "M18 12h.01",
        "M7 17h.01", "M12 18h.01", "M17 17h.01",
      ],
      onClick: toggleBackgroundFrost,
    });
    settingsActionNode = createQuickActionButton({
      action: "settings",
      label: "打开自定义背景设置",
      paths: [
        "M4 7h7", "M15 7h5", "M13 5v4",
        "M4 12h3", "M11 12h9", "M9 10v4",
        "M4 17h9", "M17 17h3", "M15 15v4",
      ],
      onClick: openCustomBackgroundSettings,
    });
    quickActions.append(
      backgroundToggleNode,
      backgroundFrostToggleNode,
      settingsActionNode,
    );
    root.append(trigger, quickActions);
    randomButtonTriggerNode = trigger;
    return root;
  }

  function ensureRandomButton() {
    if (randomButtonNode?.isConnected) return;
    randomButtonNode = createRandomButton();
    randomButtonTriggerNode?.addEventListener("click", handleRandomButtonClick);
    randomButtonNode.addEventListener("pointerenter", () => {
      syncRandomButtonPlacement();
      setRandomButtonExpanded(true);
    });
    randomButtonNode.addEventListener("pointerleave", () => {
      randomButtonNode?.removeAttribute("data-expand-suppressed");
      setRandomButtonExpanded(false);
    });
    randomButtonNode.addEventListener("focusin", () => {
      setRandomButtonExpanded(true);
    });
    randomButtonNode.addEventListener("focusout", (event) => {
      if (!randomButtonNode?.contains(event.relatedTarget)) {
        setRandomButtonExpanded(false);
      }
    });
    randomButtonNode.addEventListener("animationend", () => {
      randomButtonNode?.removeAttribute("data-failed");
    });
    document.body.append(randomButtonNode);
    syncRandomButtonControls();
    setupRandomButtonDragging();
  }

  function handleRandomButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (suppressRandomButtonClick) {
      suppressRandomButtonClick = false;
      if (suppressRandomButtonClickTimer !== null) {
        window.clearTimeout(suppressRandomButtonClickTimer);
        suppressRandomButtonClickTimer = null;
      }
      return;
    }
    if (state.kind !== "alcy") {
      openCustomBackgroundSettings();
      return;
    }
    applyRandom();
  }

  function randomButtonBounds() {
    return createButtonBounds({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      buttonWidth: randomButtonNode?.offsetWidth || RANDOM_BUTTON_SIZE_PX,
      buttonHeight: randomButtonNode?.offsetHeight || RANDOM_BUTTON_SIZE_PX,
      edgeGap: RANDOM_BUTTON_EDGE_GAP_PX,
      topGap: RANDOM_BUTTON_TOP_GAP_PX,
    });
  }

  function clearRandomButtonSnap() {
    if (randomButtonSnapTimer !== null) {
      window.clearTimeout(randomButtonSnapTimer);
      randomButtonSnapTimer = null;
    }
    randomButtonNode?.removeAttribute("data-snapping");
  }

  function setRandomButtonPosition(position, { animate = false } = {}) {
    if (!randomButtonNode?.isConnected) return;
    const clamped = clampButtonPosition(position, randomButtonBounds());

    clearRandomButtonSnap();
    if (animate) {
      randomButtonNode.setAttribute("data-snapping", "");
      // 先提交拖拽结束时的位置，再让新的 CSS 变量触发吸附过渡。
      void randomButtonNode.offsetWidth;
    }
    randomButtonNode.style.setProperty("--ct-cbgp-button-x", `${clamped.x}px`);
    randomButtonNode.style.setProperty("--ct-cbgp-button-y", `${clamped.y}px`);
    randomButtonDraggable?.updateOptions({ position: clamped });
    syncRandomButtonPlacement(clamped);

    if (animate) {
      randomButtonSnapTimer = window.setTimeout(() => {
        randomButtonSnapTimer = null;
        randomButtonNode?.removeAttribute("data-snapping");
      }, RANDOM_BUTTON_SNAP_DURATION_MS);
    }
  }

  function applyRandomButtonDockPosition({ animate = false } = {}) {
    if (!randomButtonNode?.isConnected || randomButtonDragging) return;
    const bounds = randomButtonBounds();
    setRandomButtonPosition(
      dockedButtonPosition(state.buttonDock, state.buttonDockOffset, bounds),
      { animate },
    );
  }

  function handleRandomButtonDragStart({ event }) {
    if (!randomButtonNode?.isConnected) return;
    clearRandomButtonSnap();
    randomButtonDragging = true;
    setRandomButtonExpanded(false);
    randomButtonNode.setAttribute("data-expand-suppressed", "");
    randomButtonNode.setAttribute("data-dragging", "");
    event.preventDefault();
  }

  function handleRandomButtonDragMove({ event }) {
    if (!randomButtonDragging || !randomButtonNode) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function suppressNextRandomButtonClick() {
    suppressRandomButtonClick = true;
    if (suppressRandomButtonClickTimer !== null) {
      window.clearTimeout(suppressRandomButtonClickTimer);
    }
    suppressRandomButtonClickTimer = window.setTimeout(() => {
      suppressRandomButtonClick = false;
      suppressRandomButtonClickTimer = null;
    }, RANDOM_BUTTON_CLICK_SUPPRESSION_MS);
  }

  function handleRandomButtonDragEnd({ offsetX, offsetY, event }) {
    if (!randomButtonDragging) return;
    randomButtonDragging = false;
    randomButtonNode?.removeAttribute("data-dragging");
    event.preventDefault();
    event.stopPropagation();
    suppressNextRandomButtonClick();
    const snapped = nearestButtonDock(
      { x: offsetX, y: offsetY },
      randomButtonBounds(),
    );
    state.buttonDock = snapped.dock;
    state.buttonDockOffset = snapped.offset;
    persistState();
    syncRandomButtonControls();
    setRandomButtonPosition(snapped.position, { animate: true });
  }

  function renderRandomButtonDragPosition({ offsetX, offsetY, rootNode }) {
    rootNode.style.setProperty("--ct-cbgp-button-x", `${offsetX}px`);
    rootNode.style.setProperty("--ct-cbgp-button-y", `${offsetY}px`);
  }

  function setupRandomButtonDragging() {
    if (!randomButtonNode?.isConnected) return;
    randomButtonDraggable?.destroy();
    const bounds = randomButtonBounds();
    const position = dockedButtonPosition(
      state.buttonDock,
      state.buttonDockOffset,
      bounds,
    );
    randomButtonDraggable = new Draggable(randomButtonNode, {
      bounds: {
        top: RANDOM_BUTTON_TOP_GAP_PX,
        right: RANDOM_BUTTON_EDGE_GAP_PX,
        bottom: RANDOM_BUTTON_EDGE_GAP_PX,
        left: RANDOM_BUTTON_EDGE_GAP_PX,
      },
      position,
      handle: `[${BUTTON_TRIGGER_MARKER}]`,
      cancel: `[${QUICK_ACTIONS_MARKER}]`,
      threshold: { delay: 0, distance: RANDOM_BUTTON_DRAG_THRESHOLD_PX },
      transform: renderRandomButtonDragPosition,
      defaultClass: "ct-cbgp-neodrag",
      defaultClassDragging: "ct-cbgp-neodrag-dragging",
      defaultClassDragged: "ct-cbgp-neodrag-dragged",
      onDragStart: handleRandomButtonDragStart,
      onDrag: handleRandomButtonDragMove,
      onDragEnd: handleRandomButtonDragEnd,
    });
  }

  function handleRandomButtonViewportChange() {
    if (randomButtonResizeFrame !== null) return;
    randomButtonResizeFrame = window.requestAnimationFrame(() => {
      randomButtonResizeFrame = null;
      applyRandomButtonDockPosition();
    });
  }

  function moveRandomButton() {
    if (!randomButtonNode?.isConnected) return;
    const visible = !disposed && state.showButton && !isSettingsPage() && isChatPage();
    randomButtonNode.hidden = !visible;
    if (visible && !randomButtonDragging && randomButtonSnapTimer === null) {
      applyRandomButtonDockPosition();
    }
  }

  function removeRandomButton() {
    clearRandomButtonSnap();
    randomButtonDraggable?.destroy();
    randomButtonDraggable = null;
    if (suppressRandomButtonClickTimer !== null) {
      window.clearTimeout(suppressRandomButtonClickTimer);
      suppressRandomButtonClickTimer = null;
    }
    suppressRandomButtonClick = false;
    randomButtonDragging = false;
    randomButtonNode?.remove();
    randomButtonNode = null;
    randomButtonTriggerNode = null;
    backgroundToggleNode = null;
    backgroundFrostToggleNode = null;
    settingsActionNode = null;
  }


  /* --------------------- 设置页：宿主注册的独立路由 --------------------- */

  function getLocaleStrings() {
    const locale = document.documentElement.lang || navigator.language || "zh-CN";
    return { locale, isChinese: locale.toLowerCase().startsWith("zh") };
  }

  function createSection(title) {
    const section = document.createElement("section");
    section.className = "ct-cbgp-section";
    const heading = document.createElement("h2");
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  function toolButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ct-cbgp-tool-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function switchButton({ checked, slot, ariaLabel, onToggle }) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ct-cbgp-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", ariaLabel);
    toggle.setAttribute("data-slot", slot);
    const knob = document.createElement("span");
    knob.className = "ct-cbgp-toggle-knob";
    toggle.append(knob);

    let current = Boolean(checked);
    const render = () => {
      toggle.setAttribute("aria-checked", String(current));
      toggle.toggleAttribute("data-on", current);
    };
    render();
    toggle.addEventListener("click", () => {
      current = !current;
      render();
      onToggle(current);
    });
    return toggle;
  }

  function closeOpenSettingsSelect({ restoreFocus = false } = {}) {
    openSettingsSelect?.close({ restoreFocus });
  }

  function createSelectControl({ slot, value, options, ariaLabel, onChange }) {
    const normalizedOptions = options.map(([optionValue, optionLabel]) => ({
      value: optionValue,
      label: optionLabel,
    }));
    let selectedIndex = Math.max(
      0,
      normalizedOptions.findIndex((option) => option.value === value),
    );
    const controlId = `ct-cbgp-select-${settingsSelectSequence += 1}`;

    const root = document.createElement("div");
    root.className = "ct-cbgp-select-control";

    // 保留原生 select 作为状态与自动化兼容层；用户看到并操作的是下方的
    // 自绘 listbox，避免 Chromium 无法定制的系统下拉浮层破坏设置页材质。
    const nativeSelect = document.createElement("select");
    nativeSelect.hidden = true;
    nativeSelect.setAttribute("data-slot", slot);
    nativeSelect.setAttribute("aria-hidden", "true");
    nativeSelect.tabIndex = -1;
    for (const option of normalizedOptions) {
      nativeSelect.append(new Option(option.label, option.value));
    }
    nativeSelect.value = normalizedOptions[selectedIndex]?.value ?? "";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ct-cbgp-select-trigger";
    trigger.setAttribute("aria-label", ariaLabel);
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${controlId}-listbox`);
    trigger.setAttribute("data-slot", `${slot}-trigger`);

    const triggerLabel = document.createElement("span");
    triggerLabel.className = "ct-cbgp-select-value";
    triggerLabel.textContent = normalizedOptions[selectedIndex]?.label ?? "";
    const chevron = createStrokeIcon(["m8 10 4 4 4-4"], "1.9");
    chevron.classList.add("ct-cbgp-select-chevron");
    trigger.append(triggerLabel, chevron);

    const menu = document.createElement("div");
    menu.id = `${controlId}-listbox`;
    menu.className = "ct-cbgp-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", ariaLabel);
    menu.setAttribute("aria-hidden", "true");
    menu.setAttribute("data-slot", `${slot}-listbox`);

    const optionNodes = normalizedOptions.map((option, index) => {
      const optionNode = document.createElement("button");
      optionNode.type = "button";
      optionNode.className = "ct-cbgp-select-option";
      optionNode.setAttribute("role", "option");
      optionNode.setAttribute("aria-selected", String(index === selectedIndex));
      optionNode.tabIndex = -1;
      optionNode.dataset.value = option.value;
      const label = document.createElement("span");
      label.textContent = option.label;
      const check = createStrokeIcon(["m6.5 12.5 3.25 3.25L17.5 8"], "2");
      check.classList.add("ct-cbgp-select-check");
      optionNode.append(label, check);
      menu.append(optionNode);
      return optionNode;
    });

    let open = false;
    const focusOption = (index) => {
      const normalizedIndex = Math.min(
        optionNodes.length - 1,
        Math.max(0, index),
      );
      optionNodes[normalizedIndex]?.focus();
    };
    const close = ({ restoreFocus = false } = {}) => {
      if (!open && openSettingsSelect?.root !== root) return;
      open = false;
      root.removeAttribute("data-open");
      trigger.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-hidden", "true");
      if (openSettingsSelect?.root === root) openSettingsSelect = null;
      if (restoreFocus && trigger.isConnected) trigger.focus();
    };
    const openMenu = (focusIndex = selectedIndex) => {
      if (open) {
        focusOption(focusIndex);
        return;
      }
      closeOpenSettingsSelect();
      open = true;
      root.setAttribute("data-open", "");
      trigger.setAttribute("aria-expanded", "true");
      menu.setAttribute("aria-hidden", "false");
      openSettingsSelect = { root, close };
      window.requestAnimationFrame(() => {
        if (open && root.isConnected) focusOption(focusIndex);
      });
    };
    const selectOption = (index) => {
      const option = normalizedOptions[index];
      if (!option) return;
      close();
      nativeSelect.value = option.value;
      nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    };

    trigger.addEventListener("click", () => {
      if (open) close({ restoreFocus: true });
      else openMenu(selectedIndex);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu(event.key === "ArrowDown" ? selectedIndex : optionNodes.length - 1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        openMenu(event.key === "Home" ? 0 : optionNodes.length - 1);
      }
    });
    optionNodes.forEach((optionNode, index) => {
      optionNode.addEventListener("click", () => selectOption(index));
      optionNode.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowDown") nextIndex = (index + 1) % optionNodes.length;
        else if (event.key === "ArrowUp") nextIndex = (index - 1 + optionNodes.length) % optionNodes.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = optionNodes.length - 1;
        else if (event.key === "Escape") {
          event.preventDefault();
          close({ restoreFocus: true });
          return;
        } else if (event.key === "Tab") {
          close();
          return;
        }
        if (nextIndex !== null) {
          event.preventDefault();
          focusOption(nextIndex);
        }
      });
    });
    nativeSelect.addEventListener("change", () => {
      const nextIndex = normalizedOptions.findIndex(
        (option) => option.value === nativeSelect.value,
      );
      if (nextIndex >= 0) {
        selectedIndex = nextIndex;
        triggerLabel.textContent = normalizedOptions[nextIndex].label;
        optionNodes.forEach((optionNode, index) => {
          optionNode.setAttribute("aria-selected", String(index === nextIndex));
        });
      }
      onChange(nativeSelect.value);
    });
    root.append(nativeSelect, trigger, menu);
    return root;
  }

  function createMaskControlRow(theme, isChinese, preview, backgroundUrl) {
    const isLight = theme === "light";
    const colorKey = isLight ? "maskLightColor" : "maskDarkColor";
    const opacityKey = isLight ? "maskLightOpacity" : "maskDarkOpacity";
    const themeLabel = isLight
      ? (isChinese ? "浅色模式" : "Light mode")
      : (isChinese ? "深色模式" : "Dark mode");

    const row = document.createElement("div");
    row.className = "ct-cbgp-row ct-cbgp-mask-row";
    const label = document.createElement("span");
    label.className = "ct-cbgp-field-label";
    label.textContent = themeLabel;

    const controls = document.createElement("div");
    controls.className = "ct-cbgp-mask-controls";
    const color = document.createElement("input");
    color.type = "color";
    color.className = "ct-cbgp-color-input";
    color.value = state[colorKey];
    color.setAttribute("data-slot", `mask-${theme}-color`);
    color.setAttribute(
      "aria-label",
      isChinese ? `${themeLabel}遮罩颜色` : `${themeLabel} mask color`,
    );
    const colorValue = document.createElement("span");
    colorValue.className = "ct-cbgp-color-value";
    colorValue.textContent = state[colorKey].toUpperCase();

    const range = document.createElement("input");
    range.type = "range";
    range.className = "ct-cbgp-range";
    range.min = "0";
    range.max = "100";
    range.step = "1";
    range.value = String(Math.round(state[opacityKey] * 100));
    range.setAttribute("data-slot", `mask-${theme}-opacity`);
    range.setAttribute(
      "aria-label",
      isChinese ? `${themeLabel}遮罩强度` : `${themeLabel} mask strength`,
    );
    const value = document.createElement("output");
    value.className = "ct-cbgp-range-value";
    value.textContent = `${range.value}%`;

    const applyMaskSetting = () => {
      persistState();
      applyWallpaper();
      applyPreviewBackground(preview, backgroundUrl);
    };
    color.addEventListener("input", () => {
      state[colorKey] = normalizeMaskColor(color.value, state[colorKey]);
      colorValue.textContent = state[colorKey].toUpperCase();
      applyMaskSetting();
    });
    range.addEventListener("input", () => {
      state[opacityKey] = normalizeMaskOpacity(Number(range.value) / 100, state[opacityKey]);
      value.textContent = `${Math.round(state[opacityKey] * 100)}%`;
      applyMaskSetting();
    });

    controls.append(color, colorValue, range, value);
    row.append(label, controls);
    return row;
  }

  function createFrostControlRows({
    slotPrefix,
    enabled,
    strength,
    toggleLabel,
    strengthLabel,
    onEnabledChange,
    onStrengthChange,
  }) {
    const range = document.createElement("input");
    range.type = "range";
    range.className = "ct-cbgp-range";
    range.min = "0";
    range.max = "100";
    range.step = "1";
    range.value = String(Math.round(strength * 100));
    range.disabled = !enabled;
    range.setAttribute("data-slot", `${slotPrefix}-strength`);
    range.setAttribute("aria-label", strengthLabel);
    const rangeValue = document.createElement("output");
    rangeValue.className = "ct-cbgp-range-value";
    rangeValue.textContent = `${range.value}%`;

    const toggleRow = document.createElement("div");
    toggleRow.className = "ct-cbgp-row ct-cbgp-toggle-row";
    const toggleText = document.createElement("span");
    toggleText.className = "ct-cbgp-field-label";
    toggleText.textContent = toggleLabel;
    const toggle = switchButton({
      checked: enabled,
      slot: `${slotPrefix}-enabled-toggle`,
      ariaLabel: toggleLabel,
      onToggle: (nextEnabled) => {
        range.disabled = !nextEnabled;
        onEnabledChange(nextEnabled);
      },
    });
    toggleRow.append(toggleText, toggle);

    const strengthRow = document.createElement("div");
    strengthRow.className = "ct-cbgp-row ct-cbgp-frost-row";
    const strengthText = document.createElement("span");
    strengthText.className = "ct-cbgp-field-label";
    strengthText.textContent = strengthLabel;
    const controls = document.createElement("div");
    controls.className = "ct-cbgp-frost-controls";
    range.addEventListener("input", () => {
      const nextStrength = normalizeMaskOpacity(Number(range.value) / 100, strength);
      rangeValue.textContent = `${Math.round(nextStrength * 100)}%`;
      onStrengthChange(nextStrength);
    });
    controls.append(range, rangeValue);
    strengthRow.append(strengthText, controls);
    return [toggleRow, strengthRow];
  }

  function formatTime(ts, locale) {
    if (!(Number.isFinite(ts) && ts > 0)) return "";
    const date = new Date(ts);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function kindLabel(kind, isChinese) {
    switch (kind) {
      case TRANSPARENT_BACKGROUND_KIND:
        return isChinese ? "透明背景" : "Transparent";
      case "alcy":
        return isChinese ? "随机" : "Random";
      case "url":
        return isChinese ? "固定 · 链接" : "Fixed · URL";
      case "local":
        return isChinese ? "固定 · 本地" : "Fixed · Local";
      default:
        return isChinese ? "无背景" : "None";
    }
  }

  function createHistoryCard(entry, formatTimeFn, isChinese) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "ct-cbgp-history-card";
    const thumb = document.createElement("span");
    thumb.className = "ct-cbgp-history-thumb";
    const url = entry.kind === "local" ? entry.dataUrl : entry.url;
    thumb.style.backgroundImage = `url("${cssEscapeUrl(url)}")`;
    const label = document.createElement("span");
    label.className = "ct-cbgp-history-label";
    label.textContent = formatTimeFn(entry.updatedAt);
    if (!label.textContent) label.textContent = kindLabel(entry.kind, isChinese);
    card.append(thumb, label);
    card.title = label.textContent;
    card.dataset.entryId = entry.id ?? "";
    card.setAttribute("aria-haspopup", "menu");
    card.addEventListener("click", () => restoreHistoryEntry(entry));
    card.addEventListener("contextmenu", (event) => openHistoryContextMenu(event, entry));
    card.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        openHistoryContextMenu(event, entry);
      }
    });
    return card;
  }

  function renderSettingsPane(container) {
    if (disposed) return;
    closeOpenSettingsSelect();
    container.replaceChildren();
    const { locale, isChinese } = getLocaleStrings();
    const formatTimeFn = (ts) => formatTime(ts, locale);

    const header = document.createElement("header");
    header.className = "ct-cbgp-pane-header";
    const title = document.createElement("h1");
    title.textContent = SETTINGS_NAV_LABEL;
    header.append(title);
    const subline = document.createElement("div");
    subline.className = "ct-cbgp-subline";
    subline.textContent = isChinese
      ? "来自 Codex Tweaks 功能包"
      : "Powered by Codex Tweaks";
    header.append(subline);
    container.append(header);

    const currentSection = createSection(isChinese ? "当前背景" : "Current background");
    const preview = document.createElement("div");
    preview.className = "ct-cbgp-preview";
    preview.setAttribute("data-slot", "preview");
    const url = resolveBackgroundUrl();
    if (state.kind === TRANSPARENT_BACKGROUND_KIND) {
      preview.classList.add("ct-cbgp-transparent");
      preview.setAttribute("role", "img");
      preview.setAttribute(
        "aria-label",
        isChinese ? "透明背景预览" : "Transparent background preview",
      );
      preview.setAttribute(
        "data-empty-label",
        isChinese ? "透明背景" : "Transparent background",
      );
    } else if (url) {
      applyPreviewBackground(preview, url);
    } else {
      preview.classList.add("ct-cbgp-empty");
      preview.setAttribute("data-empty-label", isChinese ? "无背景" : "No background");
    }
    currentSection.append(preview);

    const currentInfo = document.createElement("div");
    currentInfo.className = "ct-cbgp-current-info";
    const kindSpan = document.createElement("span");
    kindSpan.className = "ct-cbgp-chip";
    kindSpan.textContent = kindLabel(state.kind, isChinese);
    currentInfo.append(kindSpan);
    const atSpan = document.createElement("span");
    atSpan.className = "ct-cbgp-time";
    atSpan.textContent = formatTimeFn(state.updatedAt);
    if (atSpan.textContent) currentInfo.append(atSpan);
    currentSection.append(currentInfo);

    const currentActions = document.createElement("div");
    currentActions.className = "ct-cbgp-actions";
    currentActions.append(
      toolButton(isChinese ? "随机换一张" : "Randomize", () => applyRandom()),
      toolButton(isChinese ? "移除背景" : "Remove", () => clearBackground()),
    );
    currentSection.append(currentActions);
    container.append(currentSection);

    const maskSection = createSection(isChinese ? "背景遮罩" : "Background mask");
    maskSection.append(
      createMaskControlRow("light", isChinese, preview, url),
      createMaskControlRow("dark", isChinese, preview, url),
    );

    maskSection.append(
      ...createFrostControlRows({
        slotPrefix: "control-frost",
        enabled: state.frostEnabled,
        strength: state.frostStrength,
        toggleLabel: isChinese ? "界面控件磨砂" : "Frost interface controls",
        strengthLabel: isChinese ? "控件磨砂强度" : "Control frost strength",
        onEnabledChange: (enabled) => {
          state.frostEnabled = enabled;
          persistState();
          applyWallpaper();
        },
        onStrengthChange: (strength) => {
          state.frostStrength = strength;
          persistState();
          applyWallpaper();
        },
      }),
      ...createFrostControlRows({
        slotPrefix: "background-frost",
        enabled: state.backgroundFrostEnabled,
        strength: state.backgroundFrostStrength,
        toggleLabel: state.kind === TRANSPARENT_BACKGROUND_KIND
          ? isChinese ? "透明背景磨砂" : "Frost transparent background"
          : isChinese ? "背景遮罩磨砂" : "Frost background mask",
        strengthLabel: state.kind === TRANSPARENT_BACKGROUND_KIND
          ? isChinese ? "透明磨砂强度" : "Transparency frost strength"
          : isChinese ? "背景磨砂强度" : "Background frost strength",
        onEnabledChange: (enabled) => {
          state.backgroundFrostEnabled = enabled;
          persistState();
          applyWallpaper();
        },
        onStrengthChange: (strength) => {
          state.backgroundFrostStrength = strength;
          persistState();
          applyWallpaper();
        },
      }),
    );

    const maskNote = document.createElement("p");
    maskNote.className = "ct-cbgp-note";
    maskNote.textContent = state.kind === TRANSPARENT_BACKGROUND_KIND
      ? isChinese
        ? "遮罩颜色与强度用于给透明窗口增加底色；控件磨砂处理界面承载面，透明背景磨砂处理窗口底层。三种效果可以组合并立即应用。"
        : "Mask color and strength tint the transparent window. Control frost affects interface surfaces, while transparent background frost affects the window backdrop. All three combine and apply immediately."
      : isChinese
        ? "遮罩强度控制颜色覆盖；控件磨砂只处理界面承载面，背景磨砂只模糊壁纸。两套设置互不影响，修改会立即应用。"
        : "Mask strength controls the color overlay. Control frost affects interface surfaces only; background frost blurs the wallpaper only. The two settings are independent and apply immediately.";
    maskSection.append(maskNote);
    const maskActions = document.createElement("div");
    maskActions.className = "ct-cbgp-actions";
    maskActions.append(
      toolButton(isChinese ? "恢复背景效果默认值" : "Restore appearance defaults", () => {
        state.maskLightColor = MASK_DEFAULTS.light.color;
        state.maskLightOpacity = MASK_DEFAULTS.light.opacity;
        state.maskDarkColor = MASK_DEFAULTS.dark.color;
        state.maskDarkOpacity = MASK_DEFAULTS.dark.opacity;
        state.frostEnabled = FROST_DEFAULTS.enabled;
        state.frostStrength = FROST_DEFAULTS.strength;
        state.backgroundFrostEnabled = BACKGROUND_FROST_DEFAULTS.enabled;
        state.backgroundFrostStrength = BACKGROUND_FROST_DEFAULTS.strength;
        persistState();
        applyWallpaper();
        refreshSettingsPaneIfOpen();
      }),
    );
    maskSection.append(maskActions);
    container.append(maskSection);

    const sourceSection = createSection(isChinese ? "背景来源" : "Background source");
    const selectRow = document.createElement("div");
    selectRow.className = "ct-cbgp-row";
    const selectTitle = document.createElement("span");
    selectTitle.className = "ct-cbgp-field-label";
    selectTitle.textContent = isChinese ? "来源类型" : "Source type";
    const kindOptions = [
      ["none", isChinese ? "无背景" : "No background"],
      [TRANSPARENT_BACKGROUND_KIND, isChinese ? "透明背景" : "Transparent background"],
      ["alcy", isChinese ? "随机图片" : "Random image"],
      ["url", isChinese ? "固定图片：在线链接" : "Fixed: image URL"],
      ["local", isChinese ? "固定图片：本地文件" : "Fixed: local file"],
    ];
    const kindSelect = createSelectControl({
      slot: "kind-select",
      value: state.kind,
      options: kindOptions,
      ariaLabel: isChinese ? "背景来源类型" : "Background source type",
      onChange: handleKindSelectChange,
    });
    selectRow.append(selectTitle, kindSelect);
    sourceSection.append(selectRow);

    const transparentNote = document.createElement("p");
    transparentNote.className = "ct-cbgp-note";
    transparentNote.setAttribute("data-slot", "transparent-note");
    transparentNote.hidden = state.kind !== TRANSPARENT_BACKGROUND_KIND;
    transparentNote.textContent = isChinese
      ? "透明背景会透出窗口后方内容，并保留颜色遮罩、界面控件磨砂和透明背景磨砂设置。"
      : "Transparent background reveals content behind the window while preserving the color mask, interface control frost, and transparent background frost settings.";
    sourceSection.append(transparentNote);

    const providerRow = document.createElement("div");
    providerRow.className = "ct-cbgp-row";
    providerRow.hidden = state.kind !== "alcy";
    const providerTitle = document.createElement("span");
    providerTitle.className = "ct-cbgp-field-label";
    providerTitle.textContent = isChinese ? "随机提供方" : "Random provider";
    const providerSelect = createSelectControl({
      slot: "provider-select",
      value: state.providerId,
      options: [...RANDOM_PROVIDERS.values()].map((provider) => [
        provider.id,
        provider.label,
      ]),
      ariaLabel: isChinese ? "随机图片提供方" : "Random image provider",
      onChange: (value) => {
        state.providerId = normalizeProviderId(value);
        persistState();
        applyWallpaper();
        refreshSettingsPaneIfOpen();
      },
    });
    providerRow.append(providerTitle, providerSelect);
    sourceSection.append(providerRow);

    const providerNote = document.createElement("p");
    providerNote.className = "ct-cbgp-note";
    providerNote.setAttribute("data-slot", "alcy-note");
    providerNote.hidden = state.kind !== "alcy";
    providerNote.textContent = isChinese
      ? "点击「随机换一张」会通过 Codex Tweaks 的网络能力解析并保存最终图片地址，重启后保持同一张；如果最终地址无法确认，本次不会替换当前背景。"
      : "Each randomize resolves and saves the final image URL through the package Node backend, so it stays fixed after restart. If the final URL cannot be confirmed, the current background is kept.";
    sourceSection.append(providerNote);

    const urlRow = document.createElement("div");
    urlRow.className = "ct-cbgp-row";
    urlRow.hidden = state.kind !== "url";
    const urlTitle = document.createElement("span");
    urlTitle.className = "ct-cbgp-field-label";
    urlTitle.textContent = isChinese ? "图片链接" : "Image URL";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "ct-cbgp-input";
    urlInput.setAttribute("data-slot", "url-input");
    urlInput.placeholder = "https://example.com/wallpaper.jpg";
    urlInput.value = state.kind === "url" ? state.url : "";
    const urlApply = toolButton(isChinese ? "应用" : "Apply", () => {
      if (!applyFixedUrl(urlInput.value)) urlInput.focus();
    });
    const urlMeta = document.createElement("div");
    urlMeta.className = "ct-cbgp-inline";
    urlMeta.append(urlInput, urlApply);
    urlRow.append(urlTitle, urlMeta);
    sourceSection.append(urlRow);

    const localRow = document.createElement("div");
    localRow.className = "ct-cbgp-row";
    localRow.hidden = state.kind !== "local";
    const localTitle = document.createElement("span");
    localTitle.className = "ct-cbgp-field-label";
    localTitle.textContent = isChinese ? "本地图片" : "Local image";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.hidden = true;
    fileInput.accept = "image/*";
    fileInput.setAttribute("data-slot", "file-input");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) applyLocalFile(file);
    });
    const fileButton = toolButton(
      state.dataUrl
        ? isChinese ? "更换图片" : "Change image"
        : isChinese ? "选择图片" : "Choose image",
      () => {
        fileInput.value = "";
        fileInput.click();
      },
    );
    fileButton.setAttribute("data-slot", "file-button");
    localRow.append(localTitle, fileInput, fileButton);
    sourceSection.append(localRow);
    container.append(sourceSection);

    const historySection = createSection(
      isChinese ? `历史背景（最近 ${HISTORY_LIMIT} 张）` : `History (last ${HISTORY_LIMIT})`,
    );
    const historyGrid = document.createElement("div");
    historyGrid.className = "ct-cbgp-history-grid";
    historyGrid.setAttribute("data-slot", "history-grid");
    if (state.history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ct-cbgp-note";
      empty.textContent = isChinese ? "暂无历史背景。" : "No history yet.";
      historyGrid.append(empty);
    } else {
      for (const entry of state.history) {
        historyGrid.append(createHistoryCard(entry, formatTimeFn, isChinese));
      }
    }
    historySection.append(historyGrid);
    if (state.history.length > 0) {
      const historyActions = document.createElement("div");
      historyActions.className = "ct-cbgp-actions";
      historyActions.append(
        toolButton(isChinese ? "清空历史" : "Clear history", () => {
          openConfirmDialog({
            title: isChinese ? "清空历史" : "Clear history",
            message: isChinese
              ? `确定要清空全部 ${state.history.length} 张历史背景吗？此操作无法撤销。`
              : `Remove all ${state.history.length} history images? This cannot be undone.`,
            confirmLabel: isChinese ? "清空" : "Clear",
            cancelLabel: isChinese ? "取消" : "Cancel",
            onConfirm: clearHistory,
          });
        }),
      );
      historySection.append(historyActions);
    }
    container.append(historySection);

    const visibilitySection = createSection(isChinese ? "主界面显示" : "Main interface");
    const toggleRow = document.createElement("div");
    toggleRow.className = "ct-cbgp-row ct-cbgp-toggle-row";
    const toggleLabel = document.createElement("span");
    toggleLabel.className = "ct-cbgp-field-label";
    toggleLabel.textContent = isChinese ? "显示背景快捷按钮" : "Show background shortcut button";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ct-cbgp-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(state.showButton));
    toggle.setAttribute("data-slot", "show-button-toggle");
    toggle.toggleAttribute("data-on", state.showButton);
    const toggleKnob = document.createElement("span");
    toggleKnob.className = "ct-cbgp-toggle-knob";
    toggle.append(toggleKnob);
    toggle.addEventListener("click", () => {
      state.showButton = !state.showButton;
      persistState();
      toggle.setAttribute("aria-checked", String(state.showButton));
      toggle.toggleAttribute("data-on", state.showButton);
      moveRandomButton();
    });
    toggleRow.append(toggleLabel, toggle);
    visibilitySection.append(toggleRow);
    container.append(visibilitySection);
  }

  function createSettingsPane() {
    const pane = document.createElement("div");
    pane.setAttribute(PANEL_MARKER, "");
    renderSettingsPane(pane);
    return pane;
  }

  function detachSettingsPane(pane) {
    closeOpenSettingsSelect();
    pane?.remove();
    if (settingsPaneNode === pane) {
      settingsPaneNode = null;
      panelOpen = false;
      closeHistoryContextMenu();
      closeConfirmDialog();
      moveRandomButton();
    }
  }

  function mountSettingsPane(container) {
    if (disposed || !(container instanceof Element)) {
      throw new Error("自定义背景设置页面无法挂载");
    }
    if (settingsPaneNode) detachSettingsPane(settingsPaneNode);
    const pane = createSettingsPane();
    settingsPaneNode = pane;
    panelOpen = true;
    container.append(pane);
    moveRandomButton();
    return () => detachSettingsPane(pane);
  }

  function historyEntryImageSource(entry) {
    return entry?.kind === "local" ? entry.dataUrl : entry?.url;
  }

  function inferredImageMime(source) {
    const pathname = (() => {
      try {
        return new URL(source).pathname.toLowerCase();
      } catch {
        return String(source ?? "").toLowerCase();
      }
    })();
    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
    if (pathname.endsWith(".gif")) return "image/gif";
    if (pathname.endsWith(".avif")) return "image/avif";
    if (pathname.endsWith(".webp")) return "image/webp";
    return "";
  }

  function normalizeImageMime(contentType, source) {
    const mime = String(contentType ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    return mime.startsWith("image/") ? mime : inferredImageMime(source);
  }

  function base64ToBlob(value, mime) {
    if (typeof value !== "string" || !value) throw new Error("empty image body");
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }

  function dataUrlToBlob(value) {
    const comma = value.indexOf(",");
    if (comma < 0) throw new Error("invalid data URL");
    const metadata = value.slice(5, comma);
    const mime = normalizeImageMime(metadata.split(";", 1)[0], value);
    if (!mime) throw new Error("unsupported image type");
    const payload = value.slice(comma + 1);
    if (metadata.toLowerCase().split(";").includes("base64")) {
      return base64ToBlob(payload, mime);
    }
    return new Blob([new TextEncoder().encode(decodeURIComponent(payload))], {
      type: mime,
    });
  }

  async function loadHistoryImageBlob(entry) {
    const source = historyEntryImageSource(entry);
    if (!source) throw new Error("missing image source");
    if (/^data:image\//i.test(source)) return dataUrlToBlob(source);

    if (entry.kind === "alcy" && isResolvedRandomImageUrl(source)) {
      const response = await network.request({
        url: source,
        method: "GET",
        responseType: "base64",
        timeoutMs: 15000,
      });
      if (!response?.ok) throw new Error(`http ${response?.status ?? "unknown"}`);
      const mime = normalizeImageMime(response.contentType, response.finalUrl || source);
      if (!mime) throw new Error("unsupported image type");
      return base64ToBlob(response.body, mime);
    }

    const response = await window.fetch(source, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`http ${response.status}`);
    const blob = await response.blob();
    const mime = normalizeImageMime(blob.type, response.url || source);
    if (!mime) throw new Error("unsupported image type");
    return blob.type === mime ? blob : new Blob([blob], { type: mime });
  }

  async function imageBlobToPNG(blob) {
    if (blob.type === "image/png") return blob;
    let drawable = null;
    let disposeDrawable = () => {};
    if (typeof window.createImageBitmap === "function") {
      try {
        drawable = await window.createImageBitmap(blob);
        disposeDrawable = () => drawable?.close?.();
      } catch {
        drawable = null;
      }
    }
    if (!drawable) {
      const objectUrl = URL.createObjectURL(blob);
      drawable = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("image decode error"));
        image.src = objectUrl;
      }).catch((error) => {
        URL.revokeObjectURL(objectUrl);
        throw error;
      });
      disposeDrawable = () => URL.revokeObjectURL(objectUrl);
    }
    try {
      const width = drawable.width || drawable.naturalWidth;
      const height = drawable.height || drawable.naturalHeight;
      if (!(width > 0 && height > 0)) throw new Error("image has no dimensions");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas unavailable");
      context.drawImage(drawable, 0, 0, width, height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("PNG conversion failed")),
          "image/png",
        );
      });
    } finally {
      disposeDrawable();
    }
  }

  async function copyHistoryImage(entry) {
    if (
      typeof window.ClipboardItem !== "function" ||
      typeof navigator.clipboard?.write !== "function"
    ) {
      const error = new Error("image clipboard unavailable");
      error.code = "clipboard_unavailable";
      throw error;
    }
    const png = loadHistoryImageBlob(entry).then(imageBlobToPNG);
    await navigator.clipboard.write([
      new window.ClipboardItem({ "image/png": png }),
    ]);
  }

  function imageFileExtension(blob, source) {
    const extensions = {
      "image/avif": "avif",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    return extensions[blob.type] ?? extensions[inferredImageMime(source)] ?? "img";
  }

  function historyImageFileName(entry, blob) {
    const date = new Date(entry.updatedAt || Date.now());
    const stamp = Number.isFinite(date.getTime())
      ? date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
      : "image";
    const extension = imageFileExtension(blob, historyEntryImageSource(entry));
    return `codex-background-${stamp}.${extension}`;
  }

  async function saveHistoryImage(entry) {
    const blob = await loadHistoryImageBlob(entry);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = historyImageFileName(entry, blob);
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  function clearActionToast() {
    if (actionToastTimer !== null) window.clearTimeout(actionToastTimer);
    actionToastTimer = null;
    actionToastNode?.remove();
    actionToastNode = null;
  }

  function showActionToast(message, tone = "info") {
    if (disposed) return;
    clearActionToast();
    const toast = document.createElement("div");
    toast.className = "ct-cbgp-action-toast";
    toast.setAttribute("data-codex-tweaks-cbgp-action-toast", "");
    toast.setAttribute("data-tone", tone);
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
    toast.textContent = message;
    document.body.append(toast);
    actionToastNode = toast;
    actionToastTimer = window.setTimeout(clearActionToast, ACTION_TOAST_DURATION_MS);
  }

  /* ----------------------------- 确认对话框 ----------------------------- */

  function openConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, returnFocusNode }) {
    if (disposed) return;
    closeConfirmDialog();
    confirmDialogReturnFocusNode =
      returnFocusNode ?? (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const backdrop = document.createElement("div");
    backdrop.className = "ct-cbgp-confirm-backdrop";
    backdrop.setAttribute("data-codex-tweaks-cbgp-confirm-dialog", "");
    const dialog = document.createElement("div");
    dialog.className = "ct-cbgp-confirm-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "ct-cbgp-confirm-title");
    const titleEl = document.createElement("h3");
    titleEl.className = "ct-cbgp-confirm-title";
    titleEl.setAttribute("id", "ct-cbgp-confirm-title");
    titleEl.textContent = title;
    const messageEl = document.createElement("p");
    messageEl.className = "ct-cbgp-confirm-message";
    messageEl.textContent = message;
    const actions = document.createElement("div");
    actions.className = "ct-cbgp-confirm-actions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ct-cbgp-confirm-button";
    cancelButton.textContent = cancelLabel;
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className =
      "ct-cbgp-confirm-button ct-cbgp-confirm-button-primary";
    confirmButton.textContent = confirmLabel;
    actions.append(cancelButton, confirmButton);
    dialog.append(titleEl, messageEl, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    confirmDialogNode = backdrop;
    cancelButton.addEventListener("click", () => closeConfirmDialog(true));
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) closeConfirmDialog(true);
    });
    confirmButton.addEventListener("click", () => {
      closeConfirmDialog();
      onConfirm();
    });
    window.requestAnimationFrame(() => cancelButton.focus());
  }

  function closeConfirmDialog(restoreFocus = false) {
    const returnNode = confirmDialogReturnFocusNode;
    confirmDialogNode?.remove();
    confirmDialogNode = null;
    confirmDialogReturnFocusNode = null;
    if (restoreFocus && returnNode?.isConnected) {
      window.requestAnimationFrame(() => returnNode.focus());
    }
  }

  function historyActionErrorMessage(action, error, isChinese) {
    if (error?.code === "response_too_large") {
      return isChinese
        ? "图片超过 10 MiB，无法通过宿主读取。"
        : "The image is larger than the 10 MiB host limit.";
    }
    if (action === "copy") {
      return isChinese
        ? "无法复制图片，请检查图片来源或系统剪贴板权限后重试。"
        : "Could not copy the image. Check its source or clipboard permission and try again.";
    }
    return isChinese
      ? "无法保存图片，请检查图片来源后重试。"
      : "Could not save the image. Check its source and try again.";
  }

  function openHistoryContextMenu(event, entry) {
    event.preventDefault();
    event.stopPropagation();
    if (historyActionPending || confirmDialogNode) return;
    closeHistoryContextMenu();
    const { isChinese } = getLocaleStrings();
    const menu = document.createElement("div");
    menu.className = "ct-cbgp-context-menu";
    menu.setAttribute("data-codex-tweaks-cbgp-context-menu", "");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", isChinese ? "历史背景操作" : "History image actions");

    const createMenuItem = (label) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ct-cbgp-context-item";
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      return item;
    };
    const runImageAction = async ({ action, item, pendingLabel, successLabel, run }) => {
      if (historyActionPending) return;
      historyActionPending = true;
      const originalLabel = item.textContent;
      for (const button of menu.querySelectorAll("button")) button.disabled = true;
      item.textContent = pendingLabel;
      item.setAttribute("aria-busy", "true");
      showActionToast(pendingLabel);
      try {
        await run();
        closeHistoryContextMenu(true);
        showActionToast(successLabel, "success");
      } catch (error) {
        showActionToast(historyActionErrorMessage(action, error, isChinese), "error");
      } finally {
        historyActionPending = false;
        item.textContent = originalLabel;
        item.removeAttribute("aria-busy");
        for (const button of menu.querySelectorAll("button")) button.disabled = false;
        if (menu.isConnected) item.focus();
      }
    };

    const copyItem = createMenuItem(isChinese ? "复制图片" : "Copy image");
    copyItem.addEventListener("click", () => runImageAction({
      action: "copy",
      item: copyItem,
      pendingLabel: isChinese ? "正在复制图片…" : "Copying image…",
      successLabel: isChinese ? "图片已复制。" : "Image copied.",
      run: () => copyHistoryImage(entry),
    }));
    const saveItem = createMenuItem(isChinese ? "保存图片" : "Save image");
    saveItem.addEventListener("click", () => runImageAction({
      action: "save",
      item: saveItem,
      pendingLabel: isChinese ? "正在准备图片…" : "Preparing image…",
      successLabel: isChinese ? "已开始保存图片。" : "Image download started.",
      run: () => saveHistoryImage(entry),
    }));

    const separator = document.createElement("div");
    separator.className = "ct-cbgp-context-separator";
    separator.setAttribute("role", "separator");
    const deleteItem = createMenuItem(
      isChinese ? "从历史中删除" : "Remove from history",
    );
    deleteItem.classList.add("ct-cbgp-context-item-destructive");
    deleteItem.addEventListener("click", () => {
      const returnNode = historyContextMenuTriggerNode;
      closeHistoryContextMenu();
      openConfirmDialog({
        title: isChinese ? "删除历史背景" : "Remove from history",
        message: isChinese
          ? "确定要将这张背景从历史中删除吗？删除后无法恢复。"
          : "Remove this background from history? This cannot be undone.",
        confirmLabel: isChinese ? "删除" : "Delete",
        cancelLabel: isChinese ? "取消" : "Cancel",
        returnFocusNode: returnNode,
        onConfirm: () => deleteHistoryEntry(entry.id),
      });
    });
    menu.append(copyItem, saveItem, separator, deleteItem);
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    const trigger = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;
    const triggerRect = trigger?.getBoundingClientRect();
    const eventHasPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
      (event.clientX !== 0 || event.clientY !== 0);
    const anchorX = eventHasPoint ? event.clientX : (triggerRect?.left ?? 8) + 12;
    const anchorY = eventHasPoint ? event.clientY : (triggerRect?.bottom ?? 8) + 4;
    const margin = 8;
    const left = Math.min(Math.max(margin, anchorX), window.innerWidth - rect.width - margin);
    const top = Math.min(Math.max(margin, anchorY), window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    historyContextMenuNode = menu;
    historyContextMenuTriggerNode = trigger;
    window.requestAnimationFrame(() => {
      if (menu.isConnected) copyItem.focus();
    });
  }

  function closeHistoryContextMenu(restoreFocus = false) {
    const trigger = historyContextMenuTriggerNode;
    historyContextMenuNode?.remove();
    historyContextMenuNode = null;
    historyContextMenuTriggerNode = null;
    if (restoreFocus && trigger?.isConnected) {
      window.requestAnimationFrame(() => trigger.focus());
    }
  }

  function deleteHistoryEntry(id) {
    const before = state.history.length;
    state.history = state.history.filter((entry) => entry.id !== id);
    if (state.history.length !== before) {
      persistState();
      refreshSettingsPaneIfOpen();
    }
  }

  function handleKindSelectChange(value) {
    if (value === "none") clearBackground();
    else if (value === "alcy") applyRandom();
    else if (
      value === TRANSPARENT_BACKGROUND_KIND || value === "url" || value === "local"
    ) {
      cancelPendingImageJob();
      state.backgroundEnabled = true;
      state.kind = value;
      if (value === TRANSPARENT_BACKGROUND_KIND) state.updatedAt = Date.now();
      persistState();
      applyWallpaper();
      refreshSettingsPaneIfOpen();
    }
  }

  function refreshSettingsPaneIfOpen() {
    if (!panelOpen || !settingsPaneNode?.isConnected) return;
    renderSettingsPane(settingsPaneNode);
  }

  function handleDocumentClick(event) {
    if (openSettingsSelect && !openSettingsSelect.root.contains(event.target)) {
      closeOpenSettingsSelect();
    }
    if (
      historyContextMenuNode &&
      !event.target?.closest?.('[data-codex-tweaks-cbgp-context-menu]')
    ) {
      closeHistoryContextMenu();
    }
  }

  function handleKeyDown(event) {
    if (confirmDialogNode) {
      const buttons = [...confirmDialogNode.querySelectorAll("button")];
      if (event.key === "Escape") {
        event.preventDefault();
        closeConfirmDialog(true);
      } else if (event.key === "Tab" && buttons.length) {
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (!buttons.length) {
        return;
      }
      return;
    }
    if (openSettingsSelect && event.key === "Escape") {
      event.preventDefault();
      closeOpenSettingsSelect({ restoreFocus: true });
      return;
    }
    if (!historyContextMenuNode) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeHistoryContextMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeHistoryContextMenu();
      return;
    }
    const items = [...historyContextMenuNode.querySelectorAll(
      '.ct-cbgp-context-item:not(:disabled)',
    )];
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement));
    let nextIndex = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  }

  /* -------------------------------- 生命周期 ----------------------------- */

  function syncDOM() {
    if (disposed) return;
    removeLegacySettingsEmbed();
    if (!wallpaperNode?.isConnected) applyWallpaper();
    ensureRandomButton();
    moveRandomButton();
  }

  function scheduleDOMSync() {
    if (disposed) return;
    if (domSyncTimer !== null) window.clearTimeout(domSyncTimer);
    domSyncTimer = window.setTimeout(() => {
      domSyncTimer = null;
      syncDOM();
    }, DOM_SYNC_DEBOUNCE_MS);
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    domObserver?.disconnect();
    domObserver = null;
    if (domSyncTimer !== null) {
      window.clearTimeout(domSyncTimer);
      domSyncTimer = null;
    }
    if (randomButtonResizeFrame !== null) {
      window.cancelAnimationFrame(randomButtonResizeFrame);
      randomButtonResizeFrame = null;
    }
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("resize", handleRandomButtonViewportChange);
    window.visualViewport?.removeEventListener(
      "resize",
      handleRandomButtonViewportChange,
    );
    closeHistoryContextMenu();
    closeConfirmDialog();
    clearActionToast();
    if (settingsPaneNode) detachSettingsPane(settingsPaneNode);
    closeOpenSettingsSelect();
    settingsSectionRegistration = null;
    removeRandomButton();
    removeWallpaper();
    document.documentElement.removeAttribute(IMAGE_JOB_MARKER);
    if (runtimeHost[RUNTIME_KEY]?.cleanup === cleanup) {
      delete runtimeHost[RUNTIME_KEY];
    }
  }

  api.registerCleanup(cleanup);
  settingsSectionRegistration = settingsSections?.register({
    id: "custom-background",
    mount: mountSettingsPane,
  }) ?? null;
  domObserver = new MutationObserver(scheduleDOMSync);
  domObserver.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleKeyDown);
  window.addEventListener("resize", handleRandomButtonViewportChange);
  window.visualViewport?.addEventListener(
    "resize",
    handleRandomButtonViewportChange,
  );
  runtimeHost[RUNTIME_KEY] = { cleanup };
  // 同步写回规范化结果：清理旧版本留下的“随机”占位历史，并保留所有
  // 仍指向确定图片地址的有效条目。
  persistState();
  syncDOM();
  if (shouldRefreshLegacyRandom) {
    shouldRefreshLegacyRandom = false;
    applyRandom();
  }
}
