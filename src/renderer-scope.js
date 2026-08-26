const PET_OVERLAY_ROUTE = "/avatar-overlay";
const PET_COMPOSITION_SURFACE_PATH = "/avatar-overlay-composition-surface.html";

export function isCodexPetRendererLocation(href) {
  try {
    const url = new URL(String(href ?? ""));
    const initialRoute = url.searchParams.get("initialRoute");
    return (
      initialRoute === PET_OVERLAY_ROUTE ||
      url.pathname.endsWith(PET_COMPOSITION_SURFACE_PATH)
    );
  } catch {
    return false;
  }
}
