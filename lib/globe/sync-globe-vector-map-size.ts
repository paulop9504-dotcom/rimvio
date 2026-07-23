import type { Map as MapLibreMap } from "maplibre-gl";

/** MapLibre canvas must match container after layout — fixes half-viewport glitches. */
export function syncGlobeVectorMapSize(
  map: MapLibreMap,
  container: HTMLElement,
): void {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width > 0 && height > 0) {
    map.resize();
  }
}

/**
 * Coalesce resize storms (keyboard / chrome / orientation) into one rAF tick.
 * Critical for mobile Workspace map jank.
 */
export function bindGlobeVectorMapResize(
  map: MapLibreMap,
  container: HTMLElement,
): () => void {
  let raf = 0;
  const resize = () => {
    if (raf) {
      return;
    }
    raf = requestAnimationFrame(() => {
      raf = 0;
      syncGlobeVectorMapSize(map, container);
    });
  };

  syncGlobeVectorMapSize(map, container);
  resize();

  const observer =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          resize();
        })
      : null;
  observer?.observe(container);

  map.on("load", resize);

  return () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    observer?.disconnect();
    map.off("load", resize);
  };
}
