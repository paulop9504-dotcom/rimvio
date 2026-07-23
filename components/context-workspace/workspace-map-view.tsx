"use client";

/**
 * Context Workspace 2D map — MapLibre (sharp) by default.
 * Mobile: incremental markers, no animated fitBounds unless geometry changes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  initAppleMapKitWithToken,
} from "@/lib/context-workspace/map/load-apple-mapkit";
import {
  isAppleMapKitWorkspaceEnabled,
  isMapLibreWorkspaceEnabled,
  type WorkspaceMapPin,
} from "@/lib/context-workspace/map/workspace-map-provider";
import { applyTossWorkspaceMapCanvas } from "@/lib/context-workspace/map/apply-toss-workspace-map-canvas";
import {
  buildTossWorkspaceMarkerEl,
  syncTossWorkspaceMarkerEl,
} from "@/lib/context-workspace/map/build-toss-workspace-marker-el";
import { TOSS_WORKSPACE_MAP_CANVAS } from "@/lib/context-workspace/map/toss-workspace-map-canvas-theme";
import { GLOBE_VECTOR_MAP_STYLE_URL } from "@/lib/globe/globe-vector-map-view";
import { GLOBE_TOSS_THEME } from "@/lib/globe/globe-toss-theme";
import {
  bindGlobeVectorMapResize,
  syncGlobeVectorMapSize,
} from "@/lib/globe/sync-globe-vector-map-size";
import { cn } from "@/lib/utils";

export type WorkspaceMapViewProps = {
  pins: readonly WorkspaceMapPin[];
  selectedId?: string | null;
  onSelectPin?: (id: string) => void;
  onPinToggle?: (id: string) => void;
  onRemovePin?: (id: string) => void;
  onBackgroundActivate?: () => void;
  className?: string;
  compact?: boolean;
  /** Skip WebGL — chat teaser / low-power path. */
  preferPlaceholder?: boolean;
};

type MapLibreModule = typeof import("maplibre-gl");
type MarkerEntry = {
  marker: import("maplibre-gl").Marker;
  el: HTMLDivElement;
  lat: number;
  lng: number;
};

let maplibreModulePromise: Promise<MapLibreModule> | null = null;

function loadMapLibre(): Promise<MapLibreModule> {
  if (!maplibreModulePromise) {
    maplibreModulePromise = import("maplibre-gl");
    void import("maplibre-gl/dist/maplibre-gl.css");
  }
  return maplibreModulePromise;
}

function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 768px)").matches
  );
}

function formatRating(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) {
    return "—";
  }
  return rating.toFixed(1);
}

function pinBounds(pins: readonly WorkspaceMapPin[]) {
  const visible = pins.filter(
    (n) => Number.isFinite(n.lat) && Number.isFinite(n.lng),
  );
  if (visible.length === 0) {
    return null;
  }
  let minLat = visible[0]!.lat;
  let maxLat = visible[0]!.lat;
  let minLng = visible[0]!.lng;
  let maxLng = visible[0]!.lng;
  for (const n of visible) {
    minLat = Math.min(minLat, n.lat);
    maxLat = Math.max(maxLat, n.lat);
    minLng = Math.min(minLng, n.lng);
    maxLng = Math.max(maxLng, n.lng);
  }
  const padLat = Math.max((maxLat - minLat) * 0.18, 0.012);
  const padLng = Math.max((maxLng - minLng) * 0.18, 0.012);
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
    centerLat: (minLat + maxLat) / 2,
    centerLng: (minLng + maxLng) / 2,
  };
}

function pinsGeometryKey(pins: readonly WorkspaceMapPin[]): string {
  return pins
    .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
    .map((n) => `${n.id}:${n.lat.toFixed(5)}:${n.lng.toFixed(5)}`)
    .join("|");
}

function PlaceholderPinMap({
  pins,
  selectedId,
  onSelectPin,
  onPinToggle,
  onRemovePin,
  onBackgroundActivate,
  compact,
}: WorkspaceMapViewProps) {
  const visible = useMemo(
    () => pins.filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng)),
    [pins],
  );
  const bounds = useMemo(() => pinBounds(visible), [visible]);

  if (!bounds || visible.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-[12px]"
        style={{
          background: TOSS_WORKSPACE_MAP_CANVAS.background,
          color: GLOBE_TOSS_THEME.inkMuted,
        }}
      >
        지도를 펼쳐 보세요
      </div>
    );
  }

  const spanLat = bounds.maxLat - bounds.minLat || 1;
  const spanLng = bounds.maxLng - bounds.minLng || 1;
  const Shell = onBackgroundActivate ? "button" : "div";

  return (
    <Shell
      type={onBackgroundActivate ? "button" : undefined}
      className={cn(
        "relative h-full w-full overflow-hidden",
        onBackgroundActivate && "cursor-pointer text-left",
      )}
      style={{ background: TOSS_WORKSPACE_MAP_CANVAS.background }}
      onClick={onBackgroundActivate}
    >
      {visible.map((node, index) => {
        const x = ((node.lng - bounds.minLng) / spanLng) * 100;
        const y = (1 - (node.lat - bounds.minLat) / spanLat) * 100;
        const active = node.id === selectedId || node.selected;
        const pinned = Boolean(node.bookmarked);
        const showActions = !compact && (active || pinned);
        return (
          <div
            key={node.id}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            {showActions ? (
              <div className="flex items-center gap-1 rounded-full bg-white/95 p-0.5 shadow-[0_1px_4px_rgba(25,31,40,0.1)]">
                {onPinToggle ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{
                      background: pinned ? "#191f28" : GLOBE_TOSS_THEME.blue,
                    }}
                    title={pinned ? "고정 해제" : "고정"}
                    aria-label={pinned ? "고정 해제" : "고정"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPinToggle(node.id);
                    }}
                  >
                    {pinned ? "✓" : "📌"}
                  </button>
                ) : null}
                {onRemovePin ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[12px] font-bold text-[#f04452]"
                    title="빼기"
                    aria-label="빼기"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemovePin(node.id);
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[11px] font-bold shadow-[0_1px_3px_rgba(25,31,40,0.1)]"
              style={{
                background: active
                  ? GLOBE_TOSS_THEME.blue
                  : pinned
                    ? "#191f28"
                    : "#fff",
                color: active || pinned ? "#fff" : GLOBE_TOSS_THEME.ink,
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectPin?.(node.id);
              }}
              aria-label={node.title}
            >
              {compact
                ? node.amountLabel?.trim() || `★${formatRating(node.rating)}`
                : active || pinned
                  ? node.title.trim().slice(0, 10)
                  : index + 1}
            </button>
          </div>
        );
      })}
    </Shell>
  );
}

function MapLibreWorkspaceMap({
  pins,
  selectedId,
  onSelectPin,
  onPinToggle,
  onRemovePin,
  onBackgroundActivate,
  compact,
  className,
}: WorkspaceMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersByIdRef = useRef<Map<string, MarkerEntry>>(new Map());
  const lastGeometryKeyRef = useRef<string>("");
  const onSelectRef = useRef(onSelectPin);
  const onPinToggleRef = useRef(onPinToggle);
  const onRemovePinRef = useRef(onRemovePin);
  const onBgRef = useRef(onBackgroundActivate);
  onSelectRef.current = onSelectPin;
  onPinToggleRef.current = onPinToggle;
  onRemovePinRef.current = onRemovePin;
  onBgRef.current = onBackgroundActivate;
  const [ready, setReady] = useState(false);
  const bounds = useMemo(() => pinBounds(pins), [pins]);
  const mobile = useMemo(() => isCoarsePointerDevice(), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    let unbindResize: (() => void) | null = null;

    void (async () => {
      const maplibregl = await loadMapLibre();
      if (cancelled || !containerRef.current) {
        return;
      }
      const center = bounds
        ? ([bounds.centerLng, bounds.centerLat] as [number, number])
        : ([126.5312, 33.4996] as [number, number]);
      const created = new maplibregl.Map({
        container: containerRef.current,
        style: GLOBE_VECTOR_MAP_STYLE_URL,
        center,
        zoom: compact ? 12.2 : 13.6,
        attributionControl: false,
        maxZoom: mobile ? 17.5 : 19,
        minZoom: 10,
        fadeDuration: 0,
        pitch: 0,
        bearing: 0,
        antialias: false,
        renderWorldCopies: false,
        trackResize: false,
        refreshExpiredTiles: false,
        maxTileCacheSize: mobile ? 48 : 80,
        pixelRatio: mobile
          ? Math.min(window.devicePixelRatio || 1, 1.75)
          : undefined,
      });
      map = created;
      mapRef.current = created;
      unbindResize = bindGlobeVectorMapResize(created, containerRef.current);
      created.on("load", () => {
        if (cancelled || !mapRef.current) {
          return;
        }
        const live = mapRef.current;
        applyTossWorkspaceMapCanvas(live);
        syncGlobeVectorMapSize(live, containerRef.current!);
        if (bounds) {
          live.fitBounds(
            [
              [bounds.minLng, bounds.minLat],
              [bounds.maxLng, bounds.maxLat],
            ],
            {
              padding: compact ? 36 : 72,
              maxZoom: compact ? 14 : 15.5,
              duration: 0,
            },
          );
          lastGeometryKeyRef.current = pinsGeometryKey(pins);
        }
        setReady(true);
      });
      created.on("click", (event) => {
        if (
          (event.originalEvent.target as HTMLElement | null)?.closest?.(
            ".maplibregl-marker",
          )
        ) {
          return;
        }
        onBgRef.current?.();
      });
    })();

    return () => {
      cancelled = true;
      unbindResize?.();
      for (const entry of markersByIdRef.current.values()) {
        entry.marker.remove();
      }
      markersByIdRef.current.clear();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Mount once per compact mode — pins update in separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, mobile]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const maplibregl = await loadMapLibre();
      if (cancelled || mapRef.current !== map) {
        return;
      }

      const visible = pins.filter(
        (n) => Number.isFinite(n.lat) && Number.isFinite(n.lng),
      );
      const nextIds = new Set(visible.map((p) => p.id));
      const actions = {
        onSelect: (id: string) => onSelectRef.current?.(id),
        onPinToggle: onPinToggleRef.current
          ? (id: string) => onPinToggleRef.current?.(id)
          : undefined,
        onRemove: onRemovePinRef.current
          ? (id: string) => onRemovePinRef.current?.(id)
          : undefined,
      };

      for (const [id, entry] of markersByIdRef.current) {
        if (!nextIds.has(id)) {
          entry.marker.remove();
          markersByIdRef.current.delete(id);
        }
      }

      for (const [index, pin] of visible.entries()) {
        const selected = pin.id === selectedId || Boolean(pin.selected);
        const existing = markersByIdRef.current.get(pin.id);
        if (existing) {
          if (existing.lat !== pin.lat || existing.lng !== pin.lng) {
            existing.marker.setLngLat([pin.lng, pin.lat]);
            existing.lat = pin.lat;
            existing.lng = pin.lng;
          }
          syncTossWorkspaceMarkerEl(existing.el, {
            pin,
            index,
            selected,
            compact,
            actions,
          });
          continue;
        }
        const el = buildTossWorkspaceMarkerEl({
          pin,
          index,
          selected,
          compact,
          actions,
        });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map);
        markersByIdRef.current.set(pin.id, {
          marker,
          el,
          lat: pin.lat,
          lng: pin.lng,
        });
      }

      const geometryKey = pinsGeometryKey(visible);
      if (geometryKey && geometryKey !== lastGeometryKeyRef.current) {
        const nextBounds = pinBounds(visible);
        if (nextBounds && visible.length > 0) {
          map.fitBounds(
            [
              [nextBounds.minLng, nextBounds.minLat],
              [nextBounds.maxLng, nextBounds.maxLat],
            ],
            {
              padding: compact ? 36 : 72,
              maxZoom: compact ? 14.2 : 15.8,
              duration: 0,
            },
          );
          lastGeometryKeyRef.current = geometryKey;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, pins, selectedId, compact]);

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={{ background: TOSS_WORKSPACE_MAP_CANVAS.background }}
      data-workspace-maplibre
      data-workspace-map-style="toss"
      data-workspace-map-perf={mobile ? "mobile" : "desktop"}
    >
      <div ref={containerRef} className="h-full w-full" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0">
          <PlaceholderPinMap
            pins={pins}
            selectedId={selectedId}
            compact={compact}
          />
        </div>
      ) : null}
    </div>
  );
}

type MapKitMapHandle = {
  destroy: () => void;
  showItems: (items: unknown[]) => void;
  removeItems?: (items: unknown[]) => void;
};

function AppleMapKitWorkspaceMap(props: WorkspaceMapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapKitMapHandle | null>(null);
  const annotationsRef = useRef<unknown[]>([]);
  const lastPinIdsRef = useRef<string>("");
  const [mapkitLive, setMapkitLive] = useState(false);
  const onSelectPinRef = useRef(props.onSelectPin);
  onSelectPinRef.current = props.onSelectPin;

  useEffect(() => {
    if (props.compact || props.preferPlaceholder) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const ok = await initAppleMapKitWithToken();
      if (cancelled || !ok || !window.mapkit || !hostRef.current) {
        return;
      }
      try {
        const map = new window.mapkit.Map(hostRef.current, {
          isZoomEnabled: true,
          isScrollEnabled: true,
        }) as MapKitMapHandle;
        mapRef.current = map;
        setMapkitLive(true);
      } catch {
        setMapkitLive(false);
      }
    })();
    return () => {
      cancelled = true;
      try {
        mapRef.current?.destroy();
      } catch {
        // ignore
      }
      mapRef.current = null;
      setMapkitLive(false);
    };
  }, [props.compact, props.preferPlaceholder]);

  useEffect(() => {
    if (!mapkitLive || !window.mapkit || !mapRef.current) {
      return;
    }
    const mapkit = window.mapkit;
    const map = mapRef.current;
    const pins = props.pins.filter(
      (n) => Number.isFinite(n.lat) && Number.isFinite(n.lng),
    );
    const pinIdsKey = pins.map((p) => p.id).join("|");
    const geometryChanged = pinIdsKey !== lastPinIdsRef.current;

    if (geometryChanged) {
      if (annotationsRef.current.length && map.removeItems) {
        try {
          map.removeItems(annotationsRef.current);
        } catch {
          // ignore
        }
      }
      const annotations = pins.map((pin) => {
        const coord = new mapkit.Coordinate(pin.lat, pin.lng);
        const marker = new mapkit.MarkerAnnotation(coord, {
          title: pin.title,
          color:
            pin.id === props.selectedId
              ? GLOBE_TOSS_THEME.blue
              : GLOBE_TOSS_THEME.ink,
        }) as {
          addEventListener?: (type: string, fn: () => void) => void;
        };
        marker.addEventListener?.("select", () => {
          onSelectPinRef.current?.(pin.id);
        });
        return marker;
      });
      annotationsRef.current = annotations;
      map.showItems(annotations);
      lastPinIdsRef.current = pinIdsKey;
    }
  }, [mapkitLive, props.pins, props.selectedId]);

  if (props.compact || props.preferPlaceholder || !mapkitLive) {
    return (
      <div className={cn("h-full w-full", props.className)}>
        <div
          ref={hostRef}
          className="invisible absolute inset-0"
          data-workspace-mapkit-host
        />
        <PlaceholderPinMap {...props} />
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full", props.className)}>
      <div ref={hostRef} className="h-full w-full" data-workspace-mapkit-live />
    </div>
  );
}

export function WorkspaceMapView(props: WorkspaceMapViewProps) {
  if (props.preferPlaceholder || props.compact) {
    return (
      <div className={cn("h-full w-full", props.className)}>
        <PlaceholderPinMap {...props} />
      </div>
    );
  }
  if (isAppleMapKitWorkspaceEnabled()) {
    return <AppleMapKitWorkspaceMap {...props} />;
  }
  if (isMapLibreWorkspaceEnabled()) {
    return <MapLibreWorkspaceMap {...props} />;
  }
  return (
    <div className={cn("h-full w-full", props.className)}>
      <PlaceholderPinMap {...props} />
    </div>
  );
}
