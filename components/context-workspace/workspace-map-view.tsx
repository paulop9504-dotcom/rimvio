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
import { hydrateWorkspaceMediaAutoplayHost } from "@/lib/context-workspace/map/mount-workspace-media-autoplay";
import {
  WORKSPACE_ITINERARY_LAYER_ID,
  WORKSPACE_ITINERARY_SOURCE_ID,
} from "@/lib/context-workspace/map/build-workspace-itinerary-line";
import {
  dispatchWorkspaceBriefReplayStep,
  runWorkspaceBriefReplay,
  subscribeWorkspaceBriefReplay,
} from "@/lib/context-workspace/context-brief";
import { TOSS_WORKSPACE_MAP_CANVAS } from "@/lib/context-workspace/map/toss-workspace-map-canvas-theme";
import {
  buildWorkspaceRasterStyle,
  shouldPreferWorkspaceRasterBasemap,
} from "@/lib/context-workspace/map/workspace-map-style";
import { GLOBE_VECTOR_MAP_STYLE_URL } from "@/lib/globe/globe-vector-map-view";
import { GLOBE_TOSS_THEME } from "@/lib/globe/globe-toss-theme";
import {
  bindGlobeVectorMapResize,
  syncGlobeVectorMapSize,
} from "@/lib/globe/sync-globe-vector-map-size";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy/human-ko";
import { WorkspaceMapCapabilityBloom } from "@/components/context-workspace/workspace-map-capability-bloom";
import { WorkspaceMapCalloutLayer } from "@/components/context-workspace/workspace-map-callout-layer";
import { WorkspaceMapCompareOverlay } from "@/components/context-workspace/workspace-map-compare-overlay";
import type { CalloutSessionValue } from "@/lib/callout/callout-session";
import type { CalloutWindow } from "@/lib/callout/windows";
import type {
  CapabilityLiveSignal,
  WorkspaceCapabilityBloomHandlers,
  WorkspaceCapabilityCallout,
} from "@/lib/context-workspace/capability-callout";
import type { DecisionProjection } from "@/lib/context-workspace/projection/types";
import type { CompareRelationshipEdge } from "@/lib/context-workspace/projection/build-compare-relationship-edges";
import type { WorkspaceEvidenceHighlight } from "@/lib/context-workspace/map/sync-workspace-evidence-highlight";
import { syncWorkspaceEvidenceHighlight } from "@/lib/context-workspace/map/sync-workspace-evidence-highlight";
import { syncOsakaMetroLines } from "@/lib/context-workspace/map/sync-osaka-metro-lines";
import { syncJapanMetroLines } from "@/lib/context-workspace/map/sync-japan-metro-lines";
import { syncOsakaJrLines } from "@/lib/context-workspace/map/sync-osaka-jr-lines";
import { syncJapanShinkansenLines } from "@/lib/context-workspace/map/sync-japan-shinkansen-lines";
import { syncKoreaRailLines } from "@/lib/context-workspace/map/sync-korea-rail-lines";
import {
  useHydrateNetworkAbsorbFromWorkspace,
  useJapanMetroAbsorbLineIds,
  useJapanShinkansenAbsorbLineIds,
  useKoreaRailAbsorbLineIds,
  useOsakaJrAbsorbLineIds,
  useOsakaMetroAbsorbLineIds,
} from "@/lib/reality-provider/use-network-absorb-projection";

export type WorkspaceMapCapabilityBloomModel = {
  readonly callouts: readonly WorkspaceCapabilityCallout[];
  readonly liveSignals: readonly CapabilityLiveSignal[];
  readonly hubLabelKo: string;
  readonly handlers?: WorkspaceCapabilityBloomHandlers;
};

/** Object Callout Control Surface — preferred over capability bloom. */
export type WorkspaceMapObjectCalloutModel = {
  readonly objectId: string;
  readonly session: CalloutSessionValue;
};

/** Multi-window Floating Callout layer item (Interaction Model). */
export type WorkspaceMapFloatingCalloutModel = {
  readonly window: CalloutWindow;
  readonly session: CalloutSessionValue;
  readonly title: string;
  readonly subtitleKo?: string | null;
};

export type WorkspaceMapViewProps = {
  pins: readonly WorkspaceMapPin[];
  selectedId?: string | null;
  onSelectPin?: (id: string) => void;
  onPinToggle?: (id: string) => void;
  onRemovePin?: (id: string) => void;
  /** Soft prepare on lodging marker — never charges. */
  onPrepareReserve?: (id: string) => void;
  /** Prepared lodging → in-Workspace approve · pay. */
  onOpenField?: (id: string) => void;
  /** Mobile: long-press Object Action Menu. */
  onPinLongPress?: (id: string) => void;
  /** Mobile: double-tap → Object Workspace sheet. */
  onOpenWorkspace?: (id: string) => void;
  onBackgroundActivate?: () => void;
  /** Primary itinerary LineString as [lng, lat][]. */
  routeLineCoords?: readonly [number, number][];
  className?: string;
  compact?: boolean;
  /** Skip WebGL — chat teaser only. Do not use for mobile RealityMap. */
  preferPlaceholder?: boolean;
  /** Scope Brief Replay subscription. */
  contextEventId?: string | null;
  /** Destination-aware fallback when pins empty (avoid Jeju default). */
  preferredCenter?: { readonly lat: number; readonly lng: number } | null;
  /** Capability bloom for the selected object — rendered on the map. */
  capabilityBloom?: WorkspaceMapCapabilityBloomModel | null;
  /**
   * @deprecated Prefer floatingCallouts multi-window layer.
   * Single Object Callout — kept for fallback.
   */
  objectCallout?: WorkspaceMapObjectCalloutModel | null;
  /** Floating Callout Windows (multi) — Interaction Layer. */
  floatingCallouts?: readonly WorkspaceMapFloatingCalloutModel[] | null;
  /** Observe Evidence highlight (edge / node) on the map. */
  evidenceHighlight?: WorkspaceEvidenceHighlight | null;
  /** Expand Callout to Workspace focus affordance */
  onCalloutRequestWorkspace?: (entityId: string) => void;
  /** Compare Decision — floating judgment callouts (no sheet). */
  decisionProjections?: readonly DecisionProjection[] | null;
  selectedDecisionEntityId?: string | null;
  onDecisionSelect?: (entityId: string) => void;
  compareRelationshipEdges?: readonly CompareRelationshipEdge[] | null;
  compareEntityTitles?: Readonly<Record<string, string>> | null;
};

function itineraryGeoJson(coords: readonly [number, number][]): {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
        properties: Record<string, unknown>;
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
  }>;
} {
  if (coords.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: coords.map(([lng, lat]) => [lng, lat] as [number, number]),
        },
      },
    ],
  };
}

function syncWorkspaceItineraryLine(
  map: import("maplibre-gl").Map,
  coords: readonly [number, number][],
): void {
  const data = itineraryGeoJson(coords);
  const existing = map.getSource(WORKSPACE_ITINERARY_SOURCE_ID) as
    | import("maplibre-gl").GeoJSONSource
    | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  if (coords.length < 2) {
    return;
  }
  map.addSource(WORKSPACE_ITINERARY_SOURCE_ID, {
    type: "geojson",
    data,
  });
  if (!map.getLayer(WORKSPACE_ITINERARY_LAYER_ID)) {
    map.addLayer({
      id: WORKSPACE_ITINERARY_LAYER_ID,
      type: "line",
      source: WORKSPACE_ITINERARY_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": GLOBE_TOSS_THEME.blue,
        "line-width": 3.5,
        "line-opacity": 0.78,
      },
    });
  }
}

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

/** Itinerary / lodging pins only — ignore context media for camera. */
function venueCameraPins(
  pins: readonly WorkspaceMapPin[],
): readonly WorkspaceMapPin[] {
  return pins.filter(
    (p) =>
      !p.contextMedia &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng),
  );
}

/** Osaka Namba — safer trip fallback than Jeju when destination unknown. */
const WORKSPACE_MAP_FALLBACK_CENTER: [number, number] = [135.5023, 34.6937];

/** ~120km — lodging wrongly geocoded to Seoul must not steal Osaka camera. */
const PREFERRED_CAMERA_MAX_KM = 120;

function haversineKm(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function venuePinsNearPreferred(
  pins: readonly WorkspaceMapPin[],
  preferred: { readonly lat: number; readonly lng: number } | null,
  maxKm = PREFERRED_CAMERA_MAX_KM,
): boolean {
  if (!preferred) return true;
  const venues = venueCameraPins(pins);
  if (venues.length === 0) return false;
  let near = 0;
  for (const p of venues) {
    if (haversineKm({ lat: p.lat, lng: p.lng }, preferred) <= maxKm) {
      near += 1;
    }
  }
  return near > 0 && near >= Math.ceil(venues.length / 2);
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
  onPrepareReserve,
  onOpenField,
  onPinLongPress,
  onOpenWorkspace,
  onBackgroundActivate,
  compact,
  preferredCenter = null,
}: WorkspaceMapViewProps) {
  const visible = useMemo(
    () => pins.filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng)),
    [pins],
  );
  const bounds = useMemo(() => pinBounds(visible), [visible]);

  if (!bounds || visible.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center"
        style={{
          background: TOSS_WORKSPACE_MAP_CANVAS.background,
          color: GLOBE_TOSS_THEME.inkMuted,
        }}
        data-workspace-map-empty
      >
        <p className="text-[13px] font-semibold text-[#191f28]/90">
          {preferredCenter
            ? copy.globe.workspaceMapLoadingTitle
            : copy.globe.workspacePreviewEmptyMap}
        </p>
        <p className="text-[11px] font-medium text-[#8b95a1]">
          {preferredCenter
            ? copy.globe.workspaceMapLoadingBody
            : copy.globe.workspaceMapLoadingHint}
        </p>
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
        const showPrepare =
          !compact &&
          active &&
          node.kind === "lodging" &&
          !node.awaitingField &&
          Boolean(onPrepareReserve);
        const showAwaitingField =
          !compact &&
          active &&
          node.kind === "lodging" &&
          Boolean(node.awaitingField) &&
          Boolean(onOpenField);
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
            {showPrepare ? (
              <button
                type="button"
                className="rounded-full bg-[#191f28] px-2.5 py-1 text-[10px] font-extrabold text-white shadow-[0_1px_3px_rgba(25,31,40,0.14)]"
                title={copy.globe.workspacePrepareReserveHint}
                onClick={(event) => {
                  event.stopPropagation();
                  onPrepareReserve?.(node.id);
                }}
              >
                {copy.globe.workspacePrepareReserveCta}
              </button>
            ) : null}
            {showAwaitingField ? (
              <button
                type="button"
                className="rounded-full bg-[#3182f6] px-2.5 py-1 text-[10px] font-extrabold text-white shadow-[0_1px_3px_rgba(49,130,246,0.35)]"
                title={copy.globe.workspacePrepareAwaitingFieldHint}
                data-marker-awaiting-field
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenField?.(node.id);
                }}
              >
                {copy.globe.workspacePrepareAwaitingFieldCta}
              </button>
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
              onDoubleClick={(event) => {
                event.stopPropagation();
                onOpenWorkspace?.(node.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onPinLongPress?.(node.id);
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
  onPrepareReserve,
  onOpenField,
  onPinLongPress,
  onOpenWorkspace,
  onBackgroundActivate,
  routeLineCoords,
  compact,
  className,
  contextEventId,
  preferredCenter = null,
  capabilityBloom = null,
  objectCallout = null,
  floatingCallouts = null,
  evidenceHighlight = null,
  onCalloutRequestWorkspace,
  decisionProjections = null,
  selectedDecisionEntityId = null,
  onDecisionSelect,
  compareRelationshipEdges = null,
  compareEntityTitles = null,
}: WorkspaceMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersByIdRef = useRef<Map<string, MarkerEntry>>(new Map());
  const lastGeometryKeyRef = useRef<string>("");

  useHydrateNetworkAbsorbFromWorkspace(contextEventId);
  const osakaMetroLineIds = useOsakaMetroAbsorbLineIds();
  const japanMetroLineIds = useJapanMetroAbsorbLineIds();
  const osakaJrLineIds = useOsakaJrAbsorbLineIds();
  const shinkansenLineIds = useJapanShinkansenAbsorbLineIds();
  const koreaRailLineIds = useKoreaRailAbsorbLineIds();
  const pinsRef = useRef(pins);
  const replayCancelRef = useRef(false);
  const mediaTourCancelRef = useRef(false);
  const onSelectRef = useRef(onSelectPin);
  const onPinToggleRef = useRef(onPinToggle);
  const onRemovePinRef = useRef(onRemovePin);
  const onPrepareRef = useRef(onPrepareReserve);
  const onPinLongPressRef = useRef(onPinLongPress);
  const onOpenWorkspaceRef = useRef(onOpenWorkspace);
  const [bloomAnchor, setBloomAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [anchorsByEntityId, setAnchorsByEntityId] = useState<
    Readonly<Record<string, { x: number; y: number }>>
  >({});
  const onOpenFieldRef = useRef(onOpenField);
  const onBgRef = useRef(onBackgroundActivate);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);
  useEffect(() => {
    onSelectRef.current = onSelectPin;
    onPinToggleRef.current = onPinToggle;
    onRemovePinRef.current = onRemovePin;
    onPrepareRef.current = onPrepareReserve;
    onOpenFieldRef.current = onOpenField;
    onPinLongPressRef.current = onPinLongPress;
    onOpenWorkspaceRef.current = onOpenWorkspace;
    onBgRef.current = onBackgroundActivate;
  }, [
    onSelectPin,
    onPinToggle,
    onRemovePin,
    onPrepareReserve,
    onOpenField,
    onPinLongPress,
    onOpenWorkspace,
    onBackgroundActivate,
  ]);
  const [ready, setReady] = useState(false);
  const bounds = useMemo(
    () => pinBounds(venueCameraPins(pins)),
    [pins],
  );
  const fallbackCenter = useMemo((): [number, number] => {
    if (
      preferredCenter &&
      Number.isFinite(preferredCenter.lat) &&
      Number.isFinite(preferredCenter.lng)
    ) {
      return [preferredCenter.lng, preferredCenter.lat];
    }
    return WORKSPACE_MAP_FALLBACK_CENTER;
  }, [preferredCenter]);
  const mobile = useMemo(() => isCoarsePointerDevice(), []);
  const routeKey = useMemo(
    () =>
      (routeLineCoords ?? [])
        .map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
        .join("|"),
    [routeLineCoords],
  );

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
      const liveBounds = pinBounds(venueCameraPins(pinsRef.current));
      const preferred =
        preferredCenter &&
        Number.isFinite(preferredCenter.lat) &&
        Number.isFinite(preferredCenter.lng)
          ? preferredCenter
          : null;
      const usePinCamera =
        Boolean(liveBounds) &&
        venuePinsNearPreferred(pinsRef.current, preferred);
      const center = usePinCamera && liveBounds
        ? ([liveBounds.centerLng, liveBounds.centerLat] as [number, number])
        : fallbackCenter;
      const preferRaster = mobile || shouldPreferWorkspaceRasterBasemap();
      const style = preferRaster
        ? buildWorkspaceRasterStyle()
        : GLOBE_VECTOR_MAP_STYLE_URL;
      const created = new maplibregl.Map({
        container: containerRef.current,
        style: style as import("maplibre-gl").StyleSpecification | string,
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
        trackResize: mobile,
        refreshExpiredTiles: false,
        maxTileCacheSize: mobile ? 48 : 80,
        pixelRatio: mobile
          ? Math.min(window.devicePixelRatio || 1, 1.75)
          : undefined,
      });
      map = created;
      mapRef.current = created;
      unbindResize = bindGlobeVectorMapResize(created, containerRef.current);
      let usedRasterFallback = preferRaster;
      const ensureRasterFallback = () => {
        if (cancelled || usedRasterFallback || !mapRef.current) return;
        usedRasterFallback = true;
        try {
          mapRef.current.setStyle(
            buildWorkspaceRasterStyle() as import("maplibre-gl").StyleSpecification,
          );
        } catch {
          /* ignore */
        }
      };
      created.on("error", () => {
        ensureRasterFallback();
      });
      created.on("load", () => {
        if (cancelled || !mapRef.current) {
          return;
        }
        const live = mapRef.current;
        if (!usedRasterFallback) {
          applyTossWorkspaceMapCanvas(live);
        }
        syncGlobeVectorMapSize(live, containerRef.current!);
        requestAnimationFrame(() => {
          if (cancelled || !mapRef.current || !containerRef.current) return;
          syncGlobeVectorMapSize(mapRef.current, containerRef.current);
        });
        const loadBounds = pinBounds(venueCameraPins(pinsRef.current));
        const preferredOnLoad =
          preferredCenter &&
          Number.isFinite(preferredCenter.lat) &&
          Number.isFinite(preferredCenter.lng)
            ? preferredCenter
            : null;
        if (
          loadBounds &&
          venuePinsNearPreferred(pinsRef.current, preferredOnLoad)
        ) {
          live.fitBounds(
            [
              [loadBounds.minLng, loadBounds.minLat],
              [loadBounds.maxLng, loadBounds.maxLat],
            ],
            {
              padding: compact ? 36 : 72,
              maxZoom: compact ? 14 : 15.5,
              duration: 0,
            },
          );
          lastGeometryKeyRef.current = pinsGeometryKey(
            venueCameraPins(pinsRef.current),
          );
        } else {
          live.jumpTo({ center: fallbackCenter, zoom: compact ? 12.2 : 13.6 });
        }
        try {
          syncWorkspaceItineraryLine(live, routeLineCoords ?? []);
        } catch {
          /* ignore */
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
  }, [compact, mobile, fallbackCenter]);

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
        onPrepareReserve: onPrepareRef.current
          ? (id: string) => onPrepareRef.current?.(id)
          : undefined,
        onOpenField: onOpenFieldRef.current
          ? (id: string) => onOpenFieldRef.current?.(id)
          : undefined,
        onLongPress: onPinLongPressRef.current
          ? (id: string) => onPinLongPressRef.current?.(id)
          : undefined,
        onOpenWorkspace: onOpenWorkspaceRef.current
          ? (id: string) => onOpenWorkspaceRef.current?.(id)
          : undefined,
      };

      for (const [id, entry] of markersByIdRef.current) {
        if (!nextIds.has(id)) {
          entry.marker.remove();
          markersByIdRef.current.delete(id);
        }
      }

      for (const [index, pin] of visible.entries()) {
        const exploreHit = Boolean(
          evidenceHighlight?.highlightNodeIds?.includes(pin.id),
        );
        const selected =
          pin.id === selectedId || Boolean(pin.selected) || exploreHit;
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
          if (pin.contextMedia) {
            const host = existing.el.querySelector<HTMLElement>(
              "[data-workspace-media-host]",
            );
            if (host) {
              void hydrateWorkspaceMediaAutoplayHost(host, pin.contextMedia);
            }
          }
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
        if (pin.contextMedia) {
          const host = el.querySelector<HTMLElement>(
            "[data-workspace-media-host]",
          );
          if (host) {
            void hydrateWorkspaceMediaAutoplayHost(host, pin.contextMedia);
          }
        }
      }

      const geometryKey = pinsGeometryKey(venueCameraPins(visible));
      if (geometryKey && geometryKey !== lastGeometryKeyRef.current) {
        const nextBounds = pinBounds(venueCameraPins(visible));
        const preferred =
          preferredCenter &&
          Number.isFinite(preferredCenter.lat) &&
          Number.isFinite(preferredCenter.lng)
            ? preferredCenter
            : null;
        if (
          nextBounds &&
          visible.length > 0 &&
          venuePinsNearPreferred(visible, preferred)
        ) {
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
        } else if (preferred) {
          map.jumpTo({
            center: [preferred.lng, preferred.lat],
            zoom: compact ? 12.2 : 13.6,
          });
          lastGeometryKeyRef.current = geometryKey;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, pins, selectedId, compact, preferredCenter, evidenceHighlight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }
    try {
      syncWorkspaceItineraryLine(map, routeLineCoords ?? []);
    } catch {
      /* style not ready */
    }
  }, [ready, routeKey, routeLineCoords]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      syncOsakaMetroLines(map, osakaMetroLineIds);
    } catch {
      /* style not ready */
    }
  }, [ready, osakaMetroLineIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      syncJapanMetroLines(map, japanMetroLineIds);
    } catch {
      /* style not ready */
    }
  }, [ready, japanMetroLineIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      syncOsakaJrLines(map, osakaJrLineIds);
    } catch {
      /* style not ready */
    }
  }, [ready, osakaJrLineIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      syncJapanShinkansenLines(map, shinkansenLineIds);
    } catch {
      /* style not ready */
    }
  }, [ready, shinkansenLineIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      syncKoreaRailLines(map, koreaRailLineIds);
    } catch {
      /* style not ready */
    }
  }, [ready, koreaRailLineIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      syncWorkspaceEvidenceHighlight(map, evidenceHighlight ?? null);
      if (
        evidenceHighlight &&
        (!evidenceHighlight.lineCoords ||
          evidenceHighlight.lineCoords.length < 2) &&
        evidenceHighlight.focusNodeId
      ) {
        const pin = pinsRef.current.find(
          (p) => p.id === evidenceHighlight.focusNodeId,
        );
        if (pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
          map.easeTo({
            center: [pin.lng, pin.lat],
            zoom: Math.max(map.getZoom(), 15),
            duration: 620,
            essential: true,
          });
        }
      }
    } catch {
      /* style not ready */
    }
  }, [ready, evidenceHighlight]);

  useEffect(() => {
    const ctx = contextEventId?.trim() ?? "";
    if (!ctx || !ready) return;

    return subscribeWorkspaceBriefReplay((detail) => {
      if (detail.contextEventId !== ctx) return;
      const map = mapRef.current;
      if (!map) return;

      replayCancelRef.current = false;
      const stopUser = () => {
        replayCancelRef.current = true;
      };
      map.on("dragstart", stopUser);
      map.on("zoomstart", stopUser);
      map.on("rotatestart", stopUser);

      const byId = new Map(
        pinsRef.current.map((p) => [p.id, p] as const),
      );
      const stops = detail.nodeIds
        .map((id) => {
          const pin = byId.get(id);
          if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
            return null;
          }
          return { id: pin.id, lat: pin.lat, lng: pin.lng };
        })
        .filter((s): s is { id: string; lat: number; lng: number } => s != null);

      void runWorkspaceBriefReplay({
        stops,
        stepMs: 1300,
        shouldCancel: () => replayCancelRef.current,
        onStep: (stepIndex, stop) => {
          onSelectRef.current?.(stop.id);
          dispatchWorkspaceBriefReplayStep({
            contextEventId: ctx,
            stepIndex,
            total: stops.length,
            nodeId: stop.id,
            done: false,
          });
        },
        flyTo: (stop) =>
          new Promise<void>((resolve) => {
            map.easeTo({
              center: [stop.lng, stop.lat],
              zoom: Math.max(map.getZoom(), 14.5),
              duration: 1100,
              essential: true,
            });
            map.once("moveend", () => resolve());
            window.setTimeout(() => resolve(), 1200);
          }),
        onDone: () => {
          map.off("dragstart", stopUser);
          map.off("zoomstart", stopUser);
          map.off("rotatestart", stopUser);
          dispatchWorkspaceBriefReplayStep({
            contextEventId: ctx,
            stepIndex: Math.max(0, stops.length - 1),
            total: stops.length,
            nodeId: stops[stops.length - 1]?.id ?? null,
            done: true,
          });
        },
      });
    });
  }, [contextEventId, ready]);

  // Click / draft chip / Reality Jump → camera follows the Entity pin.
  useEffect(() => {
    if (!ready || !selectedId) return;
    const map = mapRef.current;
    if (!map) return;
    const pin = pinsRef.current.find((p) => p.id === selectedId);
    if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
      return;
    }
    const center = map.getCenter();
    const distKm = haversineKm(
      { lat: center.lat, lng: center.lng },
      { lat: pin.lat, lng: pin.lng },
    );
    if (distKm < 0.12 && map.getZoom() >= 14.2) {
      return;
    }
    map.easeTo({
      center: [pin.lng, pin.lat],
      zoom: Math.max(map.getZoom(), compact ? 14.2 : 14.8),
      duration: 620,
      essential: true,
    });
    // pins: re-fly when Reality Jump upserts a pin after selectedId is already set
  }, [ready, selectedId, compact, pins]);

  // Project selected pin → screen for legacy single Object Callout / Capability bloom.
  useEffect(() => {
    const map = mapRef.current;
    const hasSurface = Boolean(objectCallout || capabilityBloom);
    if (!ready || !map || !selectedId || !hasSurface) {
      setBloomAnchor(null);
      return;
    }
    const pin = pinsRef.current.find((p) => p.id === selectedId);
    if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
      setBloomAnchor(null);
      return;
    }

    const update = () => {
      const pt = map.project([pin.lng, pin.lat]);
      setBloomAnchor({ x: pt.x, y: pt.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    map.on("rotate", update);
    map.on("pitch", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
      map.off("rotate", update);
      map.off("pitch", update);
    };
  }, [ready, selectedId, capabilityBloom, objectCallout, pins]);

  // Multi-window + Compare Decision: project entity pins → screen anchors.
  const floatingEntityIds = useMemo(
    () =>
      (floatingCallouts ?? [])
        .filter((c) => c.window.anchored)
        .map((c) => c.window.entityId)
        .join("|"),
    [floatingCallouts],
  );
  const decisionEntityIds = useMemo(
    () =>
      (decisionProjections ?? [])
        .map((d) => d.entityId)
        .filter(Boolean)
        .join("|"),
    [decisionProjections],
  );

  useEffect(() => {
    const map = mapRef.current;
    const floatList = floatingCallouts ?? [];
    const decisionList = decisionProjections ?? [];
    if (!ready || !map || (floatList.length === 0 && decisionList.length === 0)) {
      setAnchorsByEntityId({});
      return;
    }

    const update = () => {
      const next: Record<string, { x: number; y: number }> = {};
      const ids = new Set<string>();
      for (const item of floatList) {
        if (item.window.anchored) ids.add(item.window.entityId);
      }
      for (const d of decisionList) ids.add(d.entityId);
      for (const id of ids) {
        const pin = pinsRef.current.find((p) => p.id === id);
        if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
          continue;
        }
        const pt = map.project([pin.lng, pin.lat]);
        next[id] = { x: pt.x, y: pt.y };
      }
      setAnchorsByEntityId(next);
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    map.on("rotate", update);
    map.on("pitch", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
      map.off("rotate", update);
      map.off("pitch", update);
    };
  }, [
    ready,
    floatingCallouts,
    floatingEntityIds,
    decisionProjections,
    decisionEntityIds,
    pins,
  ]);

  // One-shot ease to media pins — no multi-step select tour (avoids UI thrash).
  const mediaTourSignature = useMemo(
    () =>
      pins
        .filter((p) => p.contextMedia)
        .map((p) => `${p.id}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
        .join("|"),
    [pins],
  );

  useEffect(() => {
    if (!ready || compact || !mediaTourSignature) return;
    const map = mapRef.current;
    if (!map) return;

    const mediaPins = pinsRef.current.filter(
      (p) =>
        p.contextMedia &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng),
    );
    if (mediaPins.length === 0) return;

    mediaTourCancelRef.current = false;
    const pin = mediaPins[0]!;
    const timer = window.setTimeout(() => {
      if (mediaTourCancelRef.current || !mapRef.current) return;
      map.easeTo({
        center: [pin.lng, pin.lat],
        zoom: Math.max(map.getZoom(), 14.8),
        duration: 700,
        essential: true,
      });
      window.setTimeout(() => {
        const entry = markersByIdRef.current.get(pin.id);
        const host = entry?.el.querySelector<HTMLElement>(
          "[data-workspace-media-host]",
        );
        if (host && pin.contextMedia) {
          void hydrateWorkspaceMediaAutoplayHost(host, pin.contextMedia);
        }
      }, 750);
    }, 400);

    return () => {
      mediaTourCancelRef.current = true;
      window.clearTimeout(timer);
    };
  }, [ready, compact, mediaTourSignature]);

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={{ background: TOSS_WORKSPACE_MAP_CANVAS.background }}
      data-workspace-maplibre
      data-workspace-map-style={mobile ? "raster-voyager" : "auto"}
      data-workspace-map-perf={mobile ? "mobile" : "desktop"}
    >
      <div ref={containerRef} className="h-full w-full" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0">
          <PlaceholderPinMap
            pins={pins}
            selectedId={selectedId}
            compact={compact}
            preferredCenter={preferredCenter}
          />
        </div>
      ) : null}
      {floatingCallouts && floatingCallouts.length > 0 ? (
        <WorkspaceMapCalloutLayer
          items={floatingCallouts.map((c) => ({
            window: c.window,
            session: c.session,
            title: c.title,
            subtitleKo: c.subtitleKo,
            anchor: anchorsByEntityId[c.window.entityId] ?? null,
          }))}
          onRequestWorkspace={onCalloutRequestWorkspace}
        />
      ) : objectCallout ? (
        <WorkspaceMapCalloutLayer
          items={[
            {
              window: {
                id: `legacy_${objectCallout.objectId}`,
                entityId: objectCallout.objectId,
                mode: "floating" as const,
                position: {
                  x: (bloomAnchor?.x ?? 0) - 160,
                  y: (bloomAnchor?.y ?? 0) - 432,
                },
                size: { width: 320, height: 420 },
                scale: 1,
                zIndex: 5,
                locked: false,
                anchored: true,
                createdAtIso: "",
                updatedAtIso: "",
              },
              session: objectCallout.session,
              title: objectCallout.objectId,
              subtitleKo: null,
              anchor: bloomAnchor,
            },
          ]}
          onRequestWorkspace={onCalloutRequestWorkspace}
        />
      ) : capabilityBloom ? (
        <WorkspaceMapCapabilityBloom
          open={Boolean(selectedId && bloomAnchor)}
          anchor={bloomAnchor}
          callouts={capabilityBloom.callouts}
          liveSignals={capabilityBloom.liveSignals}
          hubLabelKo={capabilityBloom.hubLabelKo}
          handlers={capabilityBloom.handlers}
        />
      ) : null}
      {decisionProjections && decisionProjections.length > 0 ? (
        <WorkspaceMapCompareOverlay
          decisions={decisionProjections}
          anchors={anchorsByEntityId}
          selectedEntityId={selectedDecisionEntityId}
          onSelect={onDecisionSelect}
          relationshipEdges={compareRelationshipEdges}
          entityTitles={compareEntityTitles}
        />
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
  useEffect(() => {
    onSelectPinRef.current = props.onSelectPin;
  }, [props.onSelectPin]);

  useEffect(() => {
    if (props.preferPlaceholder) {
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
  }, [props.preferPlaceholder]);

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

  if (props.preferPlaceholder || !mapkitLive) {
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
  // Placeholder = chat teaser / deliberately no WebGL — NOT mobile density.
  // Mobile RealityMap passes `compact` for denser camera framing but still needs MapLibre
  // (otherwise iOS PWA shows pins on grey with no pan/tiles).
  if (props.preferPlaceholder) {
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
