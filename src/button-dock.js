export const DEFAULT_BUTTON_DOCK = "right";
export const DEFAULT_BUTTON_DOCK_OFFSET = 0.9;

const BUTTON_DOCKS = new Set(["left", "right", "top", "bottom"]);
const DOCK_PRIORITY = ["right", "left", "bottom", "top"];

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolate(minimum, maximum, offset) {
  return minimum + (maximum - minimum) * offset;
}

function normalizedOffset(value, minimum, maximum) {
  if (maximum <= minimum) return 0;
  return clamp((value - minimum) / (maximum - minimum), 0, 1);
}

export function normalizeButtonDock(value, fallback = DEFAULT_BUTTON_DOCK) {
  return BUTTON_DOCKS.has(value) ? value : fallback;
}

export function normalizeButtonDockOffset(
  value,
  fallback = DEFAULT_BUTTON_DOCK_OFFSET,
) {
  return clamp(finiteNumber(value, fallback), 0, 1);
}

export function createButtonBounds({
  viewportWidth,
  viewportHeight,
  buttonWidth,
  buttonHeight,
  edgeGap = 18,
  topGap = 54,
}) {
  const safeViewportWidth = Math.max(0, finiteNumber(viewportWidth, 0));
  const safeViewportHeight = Math.max(0, finiteNumber(viewportHeight, 0));
  const safeButtonWidth = Math.max(0, finiteNumber(buttonWidth, 0));
  const safeButtonHeight = Math.max(0, finiteNumber(buttonHeight, 0));
  const safeEdgeGap = Math.max(0, finiteNumber(edgeGap, 0));
  const safeTopGap = Math.max(safeEdgeGap, finiteNumber(topGap, safeEdgeGap));
  const minX = Math.min(safeEdgeGap, Math.max(0, safeViewportWidth - safeButtonWidth));
  const minY = Math.min(safeTopGap, Math.max(0, safeViewportHeight - safeButtonHeight));

  return {
    minX,
    maxX: Math.max(minX, safeViewportWidth - safeButtonWidth - safeEdgeGap),
    minY,
    maxY: Math.max(minY, safeViewportHeight - safeButtonHeight - safeEdgeGap),
  };
}

export function clampButtonPosition(position, bounds) {
  return {
    x: clamp(finiteNumber(position?.x, bounds.minX), bounds.minX, bounds.maxX),
    y: clamp(finiteNumber(position?.y, bounds.minY), bounds.minY, bounds.maxY),
  };
}

export function dockedButtonPosition(dock, offset, bounds) {
  const normalizedDock = normalizeButtonDock(dock);
  const normalizedDockOffset = normalizeButtonDockOffset(offset);

  if (normalizedDock === "left" || normalizedDock === "right") {
    return {
      x: normalizedDock === "left" ? bounds.minX : bounds.maxX,
      y: interpolate(bounds.minY, bounds.maxY, normalizedDockOffset),
    };
  }

  return {
    x: interpolate(bounds.minX, bounds.maxX, normalizedDockOffset),
    y: normalizedDock === "top" ? bounds.minY : bounds.maxY,
  };
}

export function nearestButtonDock(position, bounds) {
  const clampedPosition = clampButtonPosition(position, bounds);
  const distances = {
    left: Math.abs(clampedPosition.x - bounds.minX),
    right: Math.abs(bounds.maxX - clampedPosition.x),
    top: Math.abs(clampedPosition.y - bounds.minY),
    bottom: Math.abs(bounds.maxY - clampedPosition.y),
  };
  const dock = DOCK_PRIORITY.reduce((nearest, candidate) =>
    distances[candidate] < distances[nearest] ? candidate : nearest,
  );
  const offset = dock === "left" || dock === "right"
    ? normalizedOffset(clampedPosition.y, bounds.minY, bounds.maxY)
    : normalizedOffset(clampedPosition.x, bounds.minX, bounds.maxX);

  return {
    dock,
    offset,
    position: dockedButtonPosition(dock, offset, bounds),
  };
}
