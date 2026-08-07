"use client";

/**
 * Context Workspace shell — Reality Execution Space (map + Entity Peek).
 * Chat = Agent work log (not SSOT). ADR-022 · Reality OS 4-layer.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { List, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyWorkspaceTransition,
  clearContextWorkspace,
  commitContextWorkspaceToGlobe,
  domainLabelKo,
  estimateWorkspaceProgressPercent,
  readContextWorkspace,
  readContextWorkspaceExpanded,
  subscribeContextWorkspaceOpen,
  subscribeContextWorkspaceUpdated,
  writeContextWorkspaceExpanded,
  type ContextWorkspaceNode,
  type ContextWorkspaceState,
} from "@/lib/context-workspace";
import { buildWorkspaceCommitPreview } from "@/lib/context-workspace/build-commit-preview";
import { buildWorkspaceConciergeStatus } from "@/lib/context-workspace/build-workspace-concierge-status";
import { buildWorkspaceItineraryLineCoords } from "@/lib/context-workspace/map/build-workspace-itinerary-line";
import { prepareWorkspaceNodeBooking } from "@/lib/context-workspace/prepare-workspace-booking";
import { approveWorkspacePlaceCheckout } from "@/lib/context-workspace/approve-workspace-place-checkout";
import { setWorkspaceNodeActionReadyState } from "@/lib/context-workspace/set-node-action-ready-state";
import { isWorkspacePlaceAwaitingField } from "@/lib/context-workspace/workspace-place-prepare-status";
import {
  buildBriefReplayStops,
  dispatchWorkspaceBriefReplay,
  subscribeWorkspaceBriefReplayStep,
} from "@/lib/context-workspace/context-brief";
import {
  appendWorkspaceChatTurn,
  clearWorkspaceChat,
} from "@/lib/context-workspace/workspace-chat-store";
import { subscribeContextWorkspaceExpand } from "@/lib/context-workspace/workspace-expand-bridge";
import { subscribePreparedRealityOperations } from "@/lib/reality-queue/prepared-operations-store";
import { MEDIA_SPACETIME_UPDATED } from "@/lib/location-ping/media-context-store";
import {
  EVENT_CANDIDATES_UPDATED,
  findLifeEventCandidate,
} from "@/lib/life-read-model";
import { recoverGlobeContextEventFromPin } from "@/lib/globe/recover-globe-context-event";
import { useActiveContextWeather } from "@/hooks/use-active-context-weather";
import { readWorldState } from "@/lib/workstream/world-state";
import { WorkspaceCommitPreviewSheet } from "@/components/context-workspace/workspace-commit-preview-sheet";
import { WorkspaceCloseNameSheet } from "@/components/context-workspace/workspace-close-name-sheet";
import { enterWorkspaceSlotFocus } from "@/lib/context-workspace/enter-workspace-slot-focus";
import {
  applyCompareDecisionSelection,
  buildCompareRelationshipEdges,
  buildDecisionProjectionsForCompare,
  buildEntityTitleMap,
  enterCompareDecisionProjection,
  exitCompareDecisionProjection,
  syncCompareDecisionProjectionFromWorkspace,
  useWorkspaceProjection,
} from "@/lib/context-workspace/projection";
import {
  filterNodesForWorkspaceMapFocus,
  isLiveWorkspacePlaceNode,
  isWorkspacePlaceCandidateNode,
} from "@/lib/context-workspace/workspace-map-focus";
import { resolveWorkspaceFocusNode } from "@/lib/context-workspace/resolve-workspace-focus-node";
import { suggestWorkspaceCapsuleTitle } from "@/lib/context-workspace/suggest-workspace-capsule-title";
import { renameContextEventTitle } from "@/lib/context-workspace/rename-context-event-title";
import {
  projectRealityJumpToWorkspace,
  subscribeRealityJump,
} from "@/lib/globe/reality-jump";
import { WorkspaceMapView } from "@/components/context-workspace/workspace-map-view";
import { WorkspaceMapMediaEmbed } from "@/components/context-workspace/workspace-map-media-embed";
import { WorkspaceObjectCarousel } from "@/components/context-workspace/workspace-object-carousel";
import { WorkspaceGptPlaceListPanel } from "@/components/context-workspace/workspace-gpt-place-list-panel";
import { WorkspaceCursorDock } from "@/components/context-workspace/workspace-cursor-dock";
import type { CalloutSessionValue } from "@/lib/callout/callout-session";
import type { CalloutHandlers, Evidence } from "@/lib/callout/types";
import {
  buildCalloutAlternativesFromWorkspace,
  buildCalloutNeighborsFromWorkspace,
  buildRimvioObjectFromWorkspace,
} from "@/lib/callout/from-workspace";
import { evidenceHighlightLineCoords } from "@/lib/callout/build-observe-evidence";
import {
  clearAllCalloutWindows,
  openCalloutWindow,
} from "@/lib/callout/windows";
import { useCalloutWindows } from "@/lib/callout/windows/use-callout-windows";
import { MobileWorkspace } from "@/components/mobile-workspace/MobileWorkspace";
import { usePreferMobileWorkspace } from "@/lib/mobile-workspace/use-mobile-workspace";
import {
  buildObjectRelationContextFromWorkspace,
  getAllRelationBuckets,
  OBJECT_RELATION_TYPE_LABEL_KO,
  type ObjectRelation,
  type ObjectRelationType,
} from "@/lib/callout/object-relation";
import {
  assertPrepareDoesNotCommit,
  buildReservationDateRangeFromWorkspace,
  buildReservationPriceFromObject,
  createReservationDraft,
  defaultGuestCountFromWorkspace,
  readReservationDraft,
  reservationDraftSummaryKo,
  writeReservationDraft,
} from "@/lib/callout/prepare";
import {
  buildFieldHandoffFromCallout,
  runFieldRealityCommit,
} from "@/lib/callout/commit-boundary";
import { runObjectScopedPrompt } from "@/lib/callout/scoped-prompt";
import {
  assertSimulationDoesNotCommit,
  buildCurrentRealityFromWorkspace,
  buildSimulationAnchorsFromWorkspace,
  buildSimulationProposalFromNode,
  createSimulationDraft,
  markSimulationDraftApplied,
  writeSimulationDraft,
} from "@/lib/callout/simulation";
import type { WorkspaceEvidenceHighlight } from "@/lib/context-workspace/map/sync-workspace-evidence-highlight";
import {
  isWorkspaceContextMediaPinId,
  projectWorkspaceContextMediaPins,
} from "@/lib/context-workspace/project-workspace-context-media-pins";
import { resolveWorkspaceMapCenterFromContext } from "@/lib/context-workspace/stamp-trip-draft-onto-context";
import type { WorkspaceMapPin } from "@/lib/context-workspace/map/workspace-map-provider";
import type { ContextWorkspaceDomain } from "@/lib/context-workspace/types";
import { copy } from "@/lib/copy/human-ko";
import { cn } from "@/lib/utils";
import {
  buildWorkspaceCapabilityViewModel,
  capabilityChromeNeeded,
  openCapabilityLayoutForWorkspace,
  readWorkspaceCapabilityLayout,
  subscribeWorkspaceCapabilityLayout,
} from "@/lib/workspace-capability";
import { WorkspaceCapabilityChrome } from "@/components/context-workspace/workspace-capability-chrome";

export type ContextWorkspaceShellProps = {
  contextEventId: string | null | undefined;
  projectTitleKo?: string | null;
  className?: string;
};

function formatRating(rating: number | null): string {
  if (rating == null || !Number.isFinite(rating)) {
    return "—";
  }
  return rating.toFixed(1);
}

function formatPrice(node: ContextWorkspaceNode): string {
  if (node.amountLabel?.trim()) {
    return node.amountLabel.trim();
  }
  if (node.priceBand != null) {
    return `${"₩".repeat(Math.min(4, Math.max(1, node.priceBand)))}`;
  }
  return "가격 미정";
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function legHintForNode(
  nodes: readonly ContextWorkspaceNode[],
  nodeId: string,
): string | null {
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx <= 0) return null;
  const prev = nodes[idx - 1]!;
  const cur = nodes[idx]!;
  const km = haversineKm(prev, cur);
  if (!Number.isFinite(km) || km <= 0) return null;
  const minutes = Math.max(1, Math.round((km / 4.5) * 60));
  return copy.globe.workspaceMapLegHint(minutes, km);
}

export function ContextWorkspaceShell({
  contextEventId,
  projectTitleKo = null,
  className,
}: ContextWorkspaceShellProps) {
  const [state, setState] = useState<ContextWorkspaceState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [commitPreviewOpen, setCommitPreviewOpen] = useState(false);
  const [closeNameOpen, setCloseNameOpen] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /** Place sheet stays closed until an explicit user open (pin / list / jump). */
  const [peekClosed, setPeekClosed] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** Invalidates in-flight slot focus so async lookup cannot reopen a closed sheet. */
  const peekOpenGenerationRef = useRef(0);
  /** One Focus map layer — null = itinerary overview */
  const [mapFocusKind, setMapFocusKind] = useState<ContextWorkspaceDomain | null>(
    null,
  );
  const workspaceProjection = useWorkspaceProjection(contextEventId);
  const compareDecisionActive = workspaceProjection.mode === "compare_decision";
  const [softRouteDismissed, setSoftRouteDismissed] = useState(false);
  const [softRainDismissed, setSoftRainDismissed] = useState(false);
  const [softQuietDismissed, setSoftQuietDismissed] = useState(false);
  const [prepTick, setPrepTick] = useState(0);
  const [briefReplayGroundIndex, setBriefReplayGroundIndex] = useState<
    number | null
  >(null);
  const [mediaTick, setMediaTick] = useState(0);
  const [evidenceHighlight, setEvidenceHighlight] =
    useState<WorkspaceEvidenceHighlight | null>(null);
  const didAutoMediaFocusRef = useRef(false);
  const { windows: calloutWindows, focusedWindowId } = useCalloutWindows();
  const preferMobileWorkspace = usePreferMobileWorkspace();

  const capabilityLayout = useSyncExternalStore(
    (onStoreChange) => {
      const id = contextEventId?.trim();
      if (!id) return () => {};
      return subscribeWorkspaceCapabilityLayout((eventId) => {
        if (eventId === id) onStoreChange();
      });
    },
    () => {
      const id = contextEventId?.trim();
      return id ? readWorkspaceCapabilityLayout(id) : null;
    },
    () => null,
  );

  useEffect(() => {
    if (!expanded || !state || state.status === "closed") return;
    openCapabilityLayoutForWorkspace({
      state,
      utterance: state.query,
    });
  }, [
    expanded,
    state?.contextEventId,
    state?.query,
    state?.domain,
    state?.realityDraft?.days?.length,
    state?.status,
  ]);

  const refresh = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      setState(null);
      return;
    }
    const next = readContextWorkspace(id);
    setState(next);
    if (!next || next.status === "closed" || next.status === "committed") {
      setExpanded(false);
      writeContextWorkspaceExpanded(id, false);
    }
  }, [contextEventId]);

  useEffect(() => {
    refresh();
    setMapFocusKind(null);
    setFocusedId(null);
    setPeekClosed(true);
    setEvidenceHighlight(null);
    clearAllCalloutWindows();
    peekOpenGenerationRef.current += 1;
    const id = contextEventId?.trim();
    if (id) {
      const draft = readContextWorkspace(id);
      if (
        draft &&
        (draft.status === "editing" || draft.status === "committing") &&
        readContextWorkspaceExpanded(id)
      ) {
        setExpanded(true);
      }
    }
    const unsubUpdate = subscribeContextWorkspaceUpdated((eventId) => {
      if (eventId === contextEventId?.trim()) {
        refresh();
      }
    });
    const unsubOpen = subscribeContextWorkspaceOpen((detail) => {
      if (detail.contextEventId === contextEventId?.trim()) {
        refresh();
      }
    });
    const unsubExpand = subscribeContextWorkspaceExpand((detail) => {
      if (detail.contextEventId === contextEventId?.trim()) {
        refresh();
        setExpanded(true);
        writeContextWorkspaceExpanded(detail.contextEventId, true);
      }
    });
    const unsubPrep = subscribePreparedRealityOperations(() => {
      setPrepTick((n) => n + 1);
    });
    const unsubBriefStep = subscribeWorkspaceBriefReplayStep((detail) => {
      if (detail.contextEventId !== contextEventId?.trim()) return;
      if (detail.done) {
        setBriefReplayGroundIndex(null);
        toast.message(copy.globe.contextBriefReplayDone);
        return;
      }
      setBriefReplayGroundIndex(detail.stepIndex);
      setFocusedId(detail.nodeId);
      // Map focus only — do not force place sheet open during brief replay.
    });
    const unsubJump = subscribeRealityJump((detail) => {
      if (detail.contextEventId !== contextEventId?.trim()) return;
      // Entity Projection: upsert → overview pins → FlyTo → Callout / Peek
      const projected = projectRealityJumpToWorkspace({
        contextEventId: detail.contextEventId,
        placeId: detail.placeId,
        labelKo: detail.title,
        lat: detail.lat,
        lng: detail.lng,
        reelKind: detail.kind,
      });
      const live = readContextWorkspace(detail.contextEventId);
      const nodeId =
        projected?.nodeId ??
        (live
          ? resolveWorkspaceFocusNode(
              live.nodes,
              detail.placeId,
              detail.title,
            )?.id
          : null);
      if (!nodeId) return;
      // Leave lodging/eatery slot so Reality POI is on the map pin set.
      setMapFocusKind(null);
      setExpanded(true);
      setFocusedId(nodeId);
      // Object Peek must open (same as place-list select) — don't close it.
      setPeekClosed(false);
      setListOpen(false);
      openCalloutWindow({ entityId: nodeId });
      refresh();
    });
    return () => {
      unsubUpdate();
      unsubOpen();
      unsubExpand();
      unsubPrep();
      unsubBriefStep();
      unsubJump();
    };
  }, [contextEventId, refresh]);

  const visibleNodes = useMemo(
    () => state?.nodes.filter((n) => n.visible) ?? [],
    [state],
  );
  const mapFocusNodes = useMemo(
    () =>
      filterNodesForWorkspaceMapFocus({
        nodes: visibleNodes,
        focusKind: mapFocusKind,
      }),
    [visibleNodes, mapFocusKind],
  );
  const selectedId =
    focusedId ??
    state?.selectedIds[0] ??
    mapFocusNodes.find((n) => n.selected)?.id ??
    null;
  const venueSelectedId = isWorkspaceContextMediaPinId(selectedId)
    ? null
    : selectedId;
  const carouselNodes = useMemo(() => {
    // GPT place list — live places only (never 「리버뷰」「근처 카페」「포토스팟」 shells).
    const live = visibleNodes.filter((n) => isLiveWorkspacePlaceNode(n));
    if (mapFocusKind) {
      const domainLive = live.filter((n) => n.kind === mapFocusKind);
      if (domainLive.length > 0) return domainLive;
    }
    if (live.length > 0) {
      if (
        venueSelectedId &&
        !live.some((n) => n.id === venueSelectedId)
      ) {
        const orphan = visibleNodes.find(
          (n) =>
            n.id === venueSelectedId && isLiveWorkspacePlaceNode(n),
        );
        return orphan ? [...live, orphan] : live;
      }
      return live;
    }
    const focused = mapFocusNodes.filter((n) =>
      isWorkspacePlaceCandidateNode(n),
    );
    if (!venueSelectedId) return focused;
    if (focused.some((n) => n.id === venueSelectedId)) return focused;
    const orphan =
      visibleNodes.find(
        (n) => n.id === venueSelectedId && isWorkspacePlaceCandidateNode(n),
      ) ?? null;
    return orphan ? [...focused, orphan] : focused;
  }, [mapFocusNodes, visibleNodes, venueSelectedId, mapFocusKind]);

  const decisionProjections = useMemo(() => {
    if (!state || !compareDecisionActive) return null;
    const built = buildDecisionProjectionsForCompare(state);
    return built.length >= 2 ? built : null;
  }, [state, compareDecisionActive, state?.compareIds, state?.nodes]);

  const compareRelationshipEdges = useMemo(() => {
    if (!state || !compareDecisionActive) return null;
    return buildCompareRelationshipEdges(state);
  }, [state, compareDecisionActive, state?.relationshipEdges, state?.compareIds]);

  const compareEntityTitles = useMemo(() => {
    if (!state || !compareDecisionActive) return null;
    return buildEntityTitleMap(state);
  }, [state, compareDecisionActive, state?.nodes]);

  const openCompareDecision = useCallback(
    (ids?: readonly string[]) => {
      const id = contextEventId?.trim();
      if (!id || !state) return;
      const compareIds =
        ids && ids.length >= 2 ? [...ids].slice(0, 5) : [...state.compareIds];
      if (compareIds.length < 2) {
        toast.message("비교할 후보를 2개 이상 골라 주세요");
        return;
      }
      if (ids && ids.length >= 2) {
        applyWorkspaceTransition({
          contextEventId: id,
          op: "compare",
          nodeIds: compareIds,
        });
      }
      const workspace = readContextWorkspace(id) ?? state;
      enterCompareDecisionProjection({
        contextEventId: id,
        workspace: {
          compareIds:
            workspace.compareIds.length >= 2
              ? workspace.compareIds
              : compareIds,
          relationshipEdges: workspace.relationshipEdges,
          selectedIds: workspace.selectedIds,
          nodes: workspace.nodes,
        },
      });
      setListOpen(false);
    },
    [contextEventId, state],
  );

  const onDecisionSelect = useCallback(
    (entityId: string) => {
      const id = contextEventId?.trim();
      if (!id) return;
      const decision =
        decisionProjections?.find((d) => d.entityId === entityId) ?? null;
      const result = applyCompareDecisionSelection({
        contextEventId: id,
        entityId,
        decision,
        exitProjection: true,
      });
      if (!result.ok) {
        toast.message(result.reasonKo);
        return;
      }
      setFocusedId(entityId);
      setPeekClosed(false);
      toast.success(result.replyKo);
    },
    [contextEventId, decisionProjections],
  );

  useEffect(() => {
    const id = contextEventId?.trim();
    if (!id || !state || !compareDecisionActive) return;
    syncCompareDecisionProjectionFromWorkspace({
      contextEventId: id,
      workspace: state,
    });
  }, [
    contextEventId,
    state?.compareIds,
    state?.relationshipEdges,
    state?.selectedIds,
    state?.nodes,
    compareDecisionActive,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => setMediaTick((n) => n + 1);
    window.addEventListener(EVENT_CANDIDATES_UPDATED, bump);
    window.addEventListener(MEDIA_SPACETIME_UPDATED, bump);
    return () => {
      window.removeEventListener(EVENT_CANDIDATES_UPDATED, bump);
      window.removeEventListener(MEDIA_SPACETIME_UPDATED, bump);
    };
  }, []);

  const mapPins = useMemo((): WorkspaceMapPin[] => {
    const ctx = contextEventId?.trim() ?? "";
    const toPin = (n: (typeof mapFocusNodes)[number]): WorkspaceMapPin => ({
      id: n.id,
      title: n.title,
      lat: n.lat,
      lng: n.lng,
      rating: n.rating,
      amountLabel: n.amountLabel,
      selected: n.id === venueSelectedId,
      bookmarked: n.bookmarked,
      kind: n.kind,
      explicitlySelected: n.selected,
      awaitingField: ctx
        ? isWorkspacePlaceAwaitingField({
            contextEventId: ctx,
            placeId: n.placeId || n.id,
            nodeId: n.id,
          })
        : false,
      photoSpot:
        n.tags.includes("photo_spot") ||
        /포토|사진|photo/i.test(`${n.title} ${n.summaryKo}`),
      legHintKo:
        n.id === venueSelectedId ? legHintForNode(mapFocusNodes, n.id) : null,
    });

    const venuePins: WorkspaceMapPin[] = mapFocusNodes.map(toPin);

    // Reality Jump / focus orphan — keep camera target on map even if domain
    // slot filter (lodging…) would hide a POI/airport pin.
    if (
      venueSelectedId &&
      !venuePins.some((p) => p.id === venueSelectedId)
    ) {
      const orphan = visibleNodes.find(
        (n) =>
          n.id === venueSelectedId &&
          isLiveWorkspacePlaceNode(n) &&
          Number.isFinite(n.lat) &&
          Number.isFinite(n.lng),
      );
      if (orphan) venuePins.push(toPin(orphan));
    }

    const event = ctx
      ? findLifeEventCandidate(ctx) ?? recoverGlobeContextEventFromPin(ctx)
      : null;
    // Media pins only on itinerary overview — avoid clutter in candidate focus.
    const mediaPins =
      mapFocusKind == null
        ? projectWorkspaceContextMediaPins({
            event,
            nodes: mapFocusNodes,
          }).map((pin) => ({
            ...pin,
            selected: pin.id === selectedId,
          }))
        : [];

    return [...venuePins, ...mediaPins];
  }, [
    mapFocusNodes,
    visibleNodes,
    selectedId,
    venueSelectedId,
    contextEventId,
    prepTick,
    mediaTick,
    mapFocusKind,
  ]);

  const selectedMediaPin = useMemo(() => {
    if (!isWorkspaceContextMediaPinId(selectedId)) return null;
    return mapPins.find((p) => p.id === selectedId) ?? null;
  }, [mapPins, selectedId]);

  // Open with captures → focus first media once — but never steal lodging/eatery peek.
  useEffect(() => {
    if (!expanded) {
      didAutoMediaFocusRef.current = false;
      return;
    }
    if (didAutoMediaFocusRef.current) return;
    const hasVenueWork = mapFocusNodes.some(
      (n) =>
        n.kind === "lodging" ||
        n.kind === "eatery" ||
        n.kind === "poi" ||
        n.source === "trip_prep_draft",
    );
    if (hasVenueWork || mapFocusKind != null) {
      didAutoMediaFocusRef.current = true;
      return;
    }
    const firstMedia = mapPins.find((p) => isWorkspaceContextMediaPinId(p.id));
    if (!firstMedia) return;
    didAutoMediaFocusRef.current = true;
    setFocusedId(firstMedia.id);
  }, [expanded, contextEventId, mediaTick, mapPins, mapFocusNodes, mapFocusKind]);

  const selectedAwaitingField = useMemo(() => {
    const ctx = contextEventId?.trim() ?? "";
    const node = visibleNodes.find((n) => n.id === venueSelectedId);
    if (!ctx || !node) return false;
    return isWorkspacePlaceAwaitingField({
      contextEventId: ctx,
      placeId: node.placeId || node.id,
      nodeId: node.id,
    });
  }, [visibleNodes, venueSelectedId, contextEventId, prepTick]);

  const onApprovePay = useCallback(
    async (nodeId: string) => {
      const id = contextEventId?.trim();
      if (!id) return;
      const node =
        readContextWorkspace(id)?.nodes.find((n) => n.id === nodeId) ??
        visibleNodes.find((n) => n.id === nodeId);
      if (!node) return;
      toast.message(copy.globe.workspacePayBusy);
      const result = await approveWorkspacePlaceCheckout({
        contextEventId: id,
        placeId: node.placeId || node.id,
        nodeId: node.id,
        titleKo: node.title,
      });
      setPrepTick((n) => n + 1);
      if (!result.ok) {
        toast.message(result.reasonKo);
        return;
      }
      // Field human gate passed → Reality Transaction → Commit Ledger
      const boundary = runFieldRealityCommit({
        request: buildFieldHandoffFromCallout({
          contextId: id,
          objectId: node.id,
          title: node.title,
        }).request,
        userApproved: true,
        source: "field",
      });
      if (boundary.ok) {
        toast.message(boundary.summaryKo, {
          description: `Saga ${boundary.sagaId}`,
        });
      }
      setWorkspaceNodeActionReadyState({
        contextEventId: id,
        nodeId: node.id,
        state: "committed",
      });
      toast.success(result.toastKo);
    },
    [contextEventId, visibleNodes],
  );

  const onConfirmReady = useCallback(
    (nodeId: string) => {
      const id = contextEventId?.trim();
      if (!id) return;
      const next = setWorkspaceNodeActionReadyState({
        contextEventId: id,
        nodeId,
        state: "approved",
      });
      if (!next) {
        toast.message(copy.globe.workspacePayNeedsPlace);
        return;
      }
      setFocusedId(nodeId);
      setPeekClosed(false);
      toast.success(copy.globe.actionReadyStateApproved);
    },
    [contextEventId],
  );

  const onOpenField = useCallback(
    (nodeId?: string) => {
      const id = nodeId?.trim();
      if (id) {
        void onApprovePay(id);
        return;
      }
      toast.message(copy.globe.workspacePayNeedsPlace);
    },
    [onApprovePay],
  );

  const routeLineCoords = useMemo(() => {
    // Candidate focus — no itinerary spaghetti across hotels.
    if (mapFocusKind != null) return [];
    return buildWorkspaceItineraryLineCoords(mapFocusNodes);
  }, [mapFocusNodes, mapFocusKind]);

  const showSoftRouteChip =
    mapFocusKind == null &&
    !softRouteDismissed &&
    mapFocusNodes.length >= 2 &&
    !(state?.lastChangeKo && /동선|가까운\s*순/.test(state.lastChangeKo));

  const lifeEvent = useMemo(() => {
    const id = contextEventId?.trim() ?? "";
    return id ? findLifeEventCandidate(id) : null;
  }, [contextEventId, state?.updatedAtIso]);
  const weather = useActiveContextWeather({
    event: lifeEvent,
    enabled: expanded && Boolean(contextEventId?.trim()),
  });
  const world = useMemo(() => {
    const id = contextEventId?.trim() ?? "";
    return id ? readWorldState(id) : null;
  }, [contextEventId, state?.updatedAtIso]);
  const tripDraftReady = Boolean(
    state?.nodes.some((n) => n.source === "trip_prep_draft"),
  );
  const preferredMapCenter = useMemo(
    () =>
      resolveWorkspaceMapCenterFromContext({
        realityDraftDestinationKo: state?.realityDraft?.destinationKo,
        query: state?.query,
        projectTitleKo,
        eventPlace: lifeEvent?.place,
        eventTitle: lifeEvent?.title,
        metadata: lifeEvent?.metadata ?? null,
      }),
    [
      state?.realityDraft?.destinationKo,
      state?.query,
      projectTitleKo,
      lifeEvent?.place,
      lifeEvent?.title,
      lifeEvent?.metadata,
    ],
  );
  const concierge = useMemo(
    () =>
      buildWorkspaceConciergeStatus({
        anchorTitle:
          visibleNodes.find((n) => n.id === selectedId)?.title ??
          visibleNodes[0]?.title ??
          null,
        tempC: weather.tempC,
        prepLine: weather.prepLine,
        routeStopCount: visibleNodes.length,
        world,
        tripDraftReady,
      }),
    [
      visibleNodes,
      selectedId,
      weather.tempC,
      weather.prepLine,
      world,
      tripDraftReady,
    ],
  );
  const showSoftRainChip =
    !softRainDismissed &&
    concierge.suggestRainRevise &&
    !(state?.lastChangeKo && /비\s*예보|실내\s*위주/.test(state.lastChangeKo));
  const showSoftQuietChip =
    !softQuietDismissed &&
    !showSoftRainChip &&
    concierge.suggestQuietRoute &&
    !(state?.lastChangeKo && /덜\s*붐비/.test(state.lastChangeKo));

  const onPrepareReserve = useCallback(
    (nodeId: string) => {
      const id = contextEventId?.trim();
      if (!id) {
        return;
      }
      let node =
        readContextWorkspace(id)?.nodes.find((n) => n.id === nodeId) ??
        visibleNodes.find((n) => n.id === nodeId);
      if (!node) {
        return;
      }
      // Continuous book flow — Select gate auto-fills on prepare tap.
      if (!node.selected) {
        applyWorkspaceTransition({
          contextEventId: id,
          op: "select",
          nodeIds: [nodeId],
        });
        node =
          readContextWorkspace(id)?.nodes.find((n) => n.id === nodeId) ?? node;
      }
      const result = prepareWorkspaceNodeBooking({
        contextEventId: id,
        node: { ...node, selected: true },
        contextLabelKo: projectTitleKo ?? state?.query ?? null,
      });
      if (!result.ok) {
        toast.message(result.reasonKo);
        setFocusedId(nodeId);
        setPeekClosed(false);
        return;
      }
      setPrepTick((n) => n + 1);
      setFocusedId(nodeId);
      setPeekClosed(false);
      toast.success(result.toastKo);
      // Stay in Workspace — next tap is human Approve · Pay (Article 0).
    },
    [contextEventId, visibleNodes, projectTitleKo, state?.query],
  );

  const onPinToggle = useCallback(
    (id: string) => {
      const node = visibleNodes.find((n) => n.id === id);
      if (!node) {
        return;
      }
      const eventId = contextEventId?.trim() ?? "";
      applyWorkspaceTransition({
        contextEventId: eventId,
        op: "bookmark",
        nodeIds: [id],
        pin: !node.bookmarked,
      });
      if (!node.bookmarked) {
        toast.success(copy.globe.workspacePinToast(node.title));
      }
    },
    [visibleNodes, contextEventId],
  );

  const onRemovePin = useCallback(
    (id: string) => {
      const eventId = contextEventId?.trim() ?? "";
      applyWorkspaceTransition({
        contextEventId: eventId,
        op: "remove",
        nodeIds: [id],
      });
    },
    [contextEventId],
  );

  const commitPreview = useMemo(
    () => (state ? buildWorkspaceCommitPreview(state) : null),
    [state],
  );

  const closeNameSuggested = useMemo(() => {
    const id = contextEventId?.trim() ?? "";
    if (!id) {
      return copy.globe.workspaceOpenTitle;
    }
    return suggestWorkspaceCapsuleTitle({
      contextEventId: id,
      workspace: state,
    });
  }, [contextEventId, state, projectTitleKo]);

  const onCarouselActiveNodeChange = useCallback((nodeId: string) => {
    setFocusedId((prev) => (prev === nodeId ? prev : nodeId));
  }, []);

  /** GPT place list → open place detail sheet (not soft-focus-only). */
  const onPlaceListSelect = useCallback(
    (nodeId: string) => {
      const id = contextEventId?.trim();
      if (!id) return;
      const openGen = ++peekOpenGenerationRef.current;
      setFocusedId(nodeId);
      setPeekClosed(false);
      setEvidenceHighlight(null);
      void (async () => {
        const result = await enterWorkspaceSlotFocus({
          contextEventId: id,
          nodeId,
        });
        if (openGen !== peekOpenGenerationRef.current) return;
        setMapFocusKind(result.mapFocusKind);
        setFocusedId(result.focusId);
        setPeekClosed(false);
      })();
    },
    [contextEventId],
  );

  // GPT place list — open when search candidates land (simple search UX).
  useEffect(() => {
    if (carouselNodes.length > 0) {
      setListOpen(true);
    }
  }, [carouselNodes.length]);

  const onSelect = useCallback(
    (nodeId: string, titleHint?: string | null) => {
      const id = contextEventId?.trim();
      if (!id) {
        return;
      }

      // Soft focus immediately so chip/peek feels responsive.
      const openGen = ++peekOpenGenerationRef.current;
      setFocusedId(nodeId);
      setEvidenceHighlight(null);

      if (isWorkspaceContextMediaPinId(nodeId)) {
        setMapFocusKind(null);
        setPeekClosed(false);
        return;
      }

      const live = readContextWorkspace(id);
      const node = live?.nodes.find((n) => n.id === nodeId);
      const isVenue =
        node &&
        (node.kind === "lodging" ||
          node.kind === "eatery" ||
          node.kind === "poi" ||
          node.kind === "amenity");

      if (isVenue) {
        // Floating Callout Window — stack (max 3); same entity = focus.
        openCalloutWindow({ entityId: nodeId });
        setPeekClosed(true);
      } else {
        setPeekClosed(false);
      }

      void (async () => {
        const result = await enterWorkspaceSlotFocus({
          contextEventId: id,
          nodeId,
          titleHint,
        });
        if (openGen !== peekOpenGenerationRef.current) {
          return;
        }
        setMapFocusKind(result.mapFocusKind);
        setFocusedId(result.focusId);
        if (isVenue) {
          openCalloutWindow({ entityId: result.focusId });
        }
        if (result.replyKo?.trim()) {
          appendWorkspaceChatTurn({
            contextEventId: id,
            role: "assistant",
            text: result.replyKo,
          });
        }
        if (result.mode === "slot_expand" && result.candidateCount > 0) {
          toast.message(result.replyKo ?? copy.globe.workspacePreviewEyebrow);
        }
      })();
    },
    [contextEventId],
  );

  const runCommit = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      return;
    }
    setCommitBusy(true);
    const result = commitContextWorkspaceToGlobe({ contextEventId: id });
    setCommitBusy(false);
    setCommitPreviewOpen(false);
    setCloseNameOpen(false);
    setExpanded(false);
    clearAllCalloutWindows();
    writeContextWorkspaceExpanded(id, false);
    if (result.ok) {
      toast.success(copy.globe.workspaceCommitDoneToast, {
        action: {
          label: copy.globe.contextBriefReplayCta,
          onClick: () => {
            const live = readContextWorkspace(id);
            if (!live) return;
            const stops = buildBriefReplayStops(live);
            if (stops.length === 0) return;
            toast.message(copy.globe.contextBriefReplayToast);
            dispatchWorkspaceBriefReplay({
              contextEventId: id,
              nodeIds: stops.map((s) => s.id),
            });
          },
        },
      });
    }
  }, [contextEventId]);

  const collapseWorkspace = useCallback(() => {
    const id = contextEventId?.trim();
    clearAllCalloutWindows();
    if (!id) {
      return;
    }
    setExpanded(false);
    setCommitPreviewOpen(false);
    setCloseNameOpen(false);
    writeContextWorkspaceExpanded(id, false);
  }, [contextEventId]);

  const onClose = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      return;
    }
    // Name → Confirm = Capsule Commit (Cursor close / save flow).
    setCloseNameOpen(true);
  }, [contextEventId]);

  const onCloseNameConfirm = useCallback(
    (titleKo: string) => {
      const id = contextEventId?.trim();
      if (!id) {
        return;
      }
      renameContextEventTitle(id, titleKo);
      setCommitBusy(true);
      const result = commitContextWorkspaceToGlobe({ contextEventId: id });
      setCommitBusy(false);
      setCloseNameOpen(false);
      setExpanded(false);
      writeContextWorkspaceExpanded(id, false);
      if (result.ok) {
        toast.success(copy.globe.workspaceCommitDoneToast);
      } else {
        toast.success(copy.globe.workspaceAutoSaveOn);
        collapseWorkspace();
      }
    },
    [collapseWorkspace, contextEventId],
  );

  const onDiscard = useCallback(() => {
    const id = contextEventId?.trim();
    if (!id) {
      return;
    }
    applyWorkspaceTransition({ contextEventId: id, op: "close" });
    clearContextWorkspace(id);
    clearWorkspaceChat(id);
    setExpanded(false);
    setCommitPreviewOpen(false);
    setCloseNameOpen(false);
  }, [contextEventId]);

  // Derived values + hooks must run every render (Rules of Hooks).
  // Early return after hooks — otherwise expand→open throws React #310.
  const kindLabel = state ? domainLabelKo(state.domain) : "";
  const title =
    projectTitleKo?.trim() ||
    state?.query.trim() ||
    state?.summaryKo.trim() ||
    copy.globe.workspaceOpenTitle;
  const progress = state ? estimateWorkspaceProgressPercent(state) : 0;
  const eventId = contextEventId?.trim() ?? "";
  const selectedNode =
    mapFocusNodes.find((n) => n.id === venueSelectedId) ??
    visibleNodes.find((n) => n.id === venueSelectedId) ??
    null;
  const showPeek =
    selectedNode != null &&
    !peekClosed &&
    selectedMediaPin == null;

  const capabilityView =
    state && capabilityLayout
      ? buildWorkspaceCapabilityViewModel({
          state,
          layout: capabilityLayout,
        })
      : null;
  const useCapabilityChrome =
    !preferMobileWorkspace &&
    capabilityChromeNeeded(capabilityLayout) &&
    capabilityView != null &&
    capabilityLayout != null;

  const capabilityFocusNodeIds = useMemo(() => {
    if (!useCapabilityChrome || !capabilityView) return null;
    if (capabilityLayout?.items.some((i) => i.id === "day_rail" && i.open)) {
      return new Set(capabilityView.timeline.map((r) => r.nodeId));
    }
    return null;
  }, [useCapabilityChrome, capabilityView, capabilityLayout]);

  const capabilityMapPins = useMemo(() => {
    if (!capabilityFocusNodeIds) return mapPins;
    return mapPins.filter((p) => capabilityFocusNodeIds.has(p.id));
  }, [mapPins, capabilityFocusNodeIds]);

  const mapObjectCallout = useMemo(() => {
    if (!state || !eventId) return null;
    // Prefer focused window entity for handler fallbacks; session lookups are by objectId.
    const focusEntityId =
      (focusedWindowId
        ? calloutWindows.find((w) => w.id === focusedWindowId)?.entityId
        : null) ??
      selectedNode?.id ??
      null;
    const focusNode =
      (focusEntityId
        ? state.nodes.find((n) => n.id === focusEntityId)
        : null) ?? selectedNode;

    const handlers: CalloutHandlers = {
      onSelect: (id) => {
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "select",
          nodeIds: [id],
        });
        openCalloutWindow({ entityId: id });
        toast.success(copy.globe.workspacePreviewSelected);
      },
      onCompare: (id) => {
        const nextIds = state.compareIds.includes(id)
          ? state.compareIds
          : [...state.compareIds, id].slice(0, 5);
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "compare",
          nodeIds: [...nextIds],
        });
        openCalloutWindow({ entityId: id });
        if (nextIds.length >= 2) openCompareDecision(nextIds);
      },
      onBookmark: (id) => {
        onPinToggle(id);
      },
      onChange: (id) => {
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "select",
          nodeIds: [id],
        });
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "find_similar",
          nodeIds: [id],
        });
        openCalloutWindow({ entityId: id });
        toast.success("Change · 비슷한 후보를 다시 모았어요");
      },
      onAddToDay: (id) => {
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "select",
          nodeIds: [id],
        });
        toast.message("일정에 추가", {
          description: "Draft 일정에 반영할 수 있어요 · Commit 아님",
        });
      },
      onNavigate: (id) => {
        const node = state.nodes.find((n) => n.id === id) ?? focusNode;
        if (!node) return;
        const url = `https://www.google.com/maps/dir/?api=1&destination=${node.lat},${node.lng}`;
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        toast.message("길찾기", { description: node.title });
      },
      onFocusRelated: (id: string) => {
        setFocusedId(id);
        openCalloutWindow({ entityId: id });
        setPeekClosed(true);
      },
      onChangeIntent: (id, axes) => {
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "select",
          nodeIds: [id],
        });
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "find_similar",
          nodeIds: [id],
        });
        const axisLabel = axes.map((a) => a.id).join(" · ") || "조건";
        toast.success(`Change Intent · ${axisLabel}`);
      },
      onPreviewSimulation: (id, alternativeObjectId) => {
        assertSimulationDoesNotCommit("preview");
        const alt = state.nodes.find((n) => n.id === alternativeObjectId);
        const cur = state.nodes.find((n) => n.id === id) ?? focusNode;
        if (!alt || !cur) return;
        const draft = createSimulationDraft({
          contextId: eventId,
          scenarioKind:
            cur.kind === "lodging" ? "change_hotel" : "change_object",
          current: buildCurrentRealityFromWorkspace({ state, node: cur }),
          proposal: buildSimulationProposalFromNode({ state, node: alt }),
          anchors: buildSimulationAnchorsFromWorkspace(state),
        });
        writeSimulationDraft(draft);
        setPeekClosed(true);
        const budget = draft.result.impact.budget;
        toast.message("What-if Simulation", {
          description:
            budget !== 0
              ? `가격 ${budget.toLocaleString("ko-KR")}원 · Draft only`
              : "Possible Reality · Draft only",
        });
      },
      onApplySimulation: (id, alternativeObjectId) => {
        assertSimulationDoesNotCommit("apply_draft");
        const alt = state.nodes.find((n) => n.id === alternativeObjectId);
        const cur = state.nodes.find((n) => n.id === id) ?? focusNode;
        if (!alt || !cur) return;

        let draft = createSimulationDraft({
          contextId: eventId,
          scenarioKind:
            cur.kind === "lodging" ? "change_hotel" : "change_object",
          current: buildCurrentRealityFromWorkspace({ state, node: cur }),
          proposal: buildSimulationProposalFromNode({ state, node: alt }),
          anchors: buildSimulationAnchorsFromWorkspace(state),
        });
        draft = markSimulationDraftApplied(draft);
        writeSimulationDraft(draft);

        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "select",
          nodeIds: [alternativeObjectId],
        });
        applyWorkspaceTransition({
          contextEventId: eventId,
          op: "simulate",
          nodeIds: [id, alternativeObjectId],
          simulateScenarioKo: `what-if:${draft.simulationId}`,
        });
        setFocusedId(alternativeObjectId);
        openCalloutWindow({ entityId: alternativeObjectId });
        setPeekClosed(true);
        toast.success("Draft에 적용했어요 · Commit 아님");
      },
      onCreatePrepareDraft: (id) => {
        assertPrepareDoesNotCommit("prepare");
        const node = state.nodes.find((n) => n.id === id) ?? focusNode;
        if (!node) return;
        const object = buildRimvioObjectFromWorkspace({
          contextId: eventId,
          state,
          node,
        });
        const draft = createReservationDraft({
          contextId: eventId,
          object,
          dateRange: buildReservationDateRangeFromWorkspace(state),
          guestCount: defaultGuestCountFromWorkspace(state),
          price: buildReservationPriceFromObject(object),
        });
        writeReservationDraft(draft);
        void onPrepareReserve(node.id);
        toast.message("ReservationDraft", {
          description: `${reservationDraftSummaryKo(draft)} · Commit 아님`,
        });
      },
      onHandoffField: (id) => {
        onOpenField(id);
      },
      onConnect: (_id, targetId) => {
        toast.message(`연결 · ${targetId}`, {
          description: "그래프 연결은 이어갈 수 있어요",
        });
      },
      onAskObject: (id, text) => {
        const node = state.nodes.find((n) => n.id === id) ?? focusNode;
        if (!node) return null;
        const object = buildRimvioObjectFromWorkspace({
          contextId: eventId,
          state,
          node,
        });
        const proposals = buildCalloutAlternativesFromWorkspace(state, id).map(
          (alt) => ({
            objectId: alt.objectId,
            title: alt.title,
            priceWon: alt.priceWon,
            priceLabelKo: alt.priceLabelKo,
            lat: alt.lat,
            lng: alt.lng,
          }),
        );

        const result = runObjectScopedPrompt({
          request: {
            object,
            utterance: text,
            contextId: eventId,
          },
          proposals,
          anchors: buildSimulationAnchorsFromWorkspace(state),
          dateRange: buildReservationDateRangeFromWorkspace(state),
          guestCount: defaultGuestCountFromWorkspace(state),
          price: buildReservationPriceFromObject(object),
        });

        if (!result.ok) {
          toast.message(result.reasonKo, {
            description: result.escapedScope
              ? "Object Scope만 유지합니다"
              : undefined,
          });
          return null;
        }

        appendWorkspaceChatTurn({
          contextEventId: eventId,
          role: "user",
          text: `@${result.scope.title}: ${text}`,
        });
        appendWorkspaceChatTurn({
          contextEventId: eventId,
          role: "assistant",
          text: result.replyKo,
        });

        if (result.simulationDraft) {
          writeSimulationDraft(result.simulationDraft);
        }
        if (result.reservationDraft) {
          writeReservationDraft(result.reservationDraft);
        }

        const hint = result.workspaceHint;
        if (hint.op === "find_similar") {
          applyWorkspaceTransition({
            contextEventId: eventId,
            op: "select",
            nodeIds: [id],
          });
          applyWorkspaceTransition({
            contextEventId: eventId,
            op: "find_similar",
            nodeIds: [id],
          });
        } else if (hint.op === "simulate") {
          applyWorkspaceTransition({
            contextEventId: eventId,
            op: "simulate",
            nodeIds: [id],
            simulateScenarioKo: hint.simulateScenarioKo,
          });
        } else if (hint.op === "compare") {
          applyWorkspaceTransition({
            contextEventId: eventId,
            op: "compare",
            nodeIds: [id],
          });
        } else if (hint.op === "select") {
          applyWorkspaceTransition({
            contextEventId: eventId,
            op: "select",
            nodeIds: [id],
          });
        }

        toast.success(result.replyKo);
        return result;
      },
      onHighlightEvidence: (_id, evidence: Evidence) => {
        const ref = evidence.graphRef;
        if (!ref) return;

        let lineCoords = evidenceHighlightLineCoords(evidence);
        if (
          (!lineCoords || lineCoords.length < 2) &&
          ref.lat != null &&
          ref.lng != null &&
          ref.toNodeId
        ) {
          const other = state.nodes.find((n) => n.id === ref.toNodeId);
          if (other) {
            lineCoords = [
              [ref.lng, ref.lat],
              [other.lng, other.lat],
            ];
          }
        }

        setEvidenceHighlight({
          evidenceId: evidence.id,
          focusNodeId: ref.toNodeId ?? ref.nodeId,
          lineCoords,
          mode: ref.kind,
        });

        if (evidence.type === "review") {
          setFocusedId(ref.nodeId ?? _id);
          setPeekClosed(false);
          toast.message("후기 Evidence", {
            description: evidence.value,
          });
          return;
        }

        if (evidence.type === "distance" && (ref.toNodeId || lineCoords)) {
          setPeekClosed(true);
          toast.message(evidence.title, {
            description: "거리 Edge를 강조했어요",
          });
          return;
        }

        if (ref.kind === "route") {
          setPeekClosed(true);
          toast.message(evidence.title, {
            description: evidence.value,
          });
          return;
        }

        setPeekClosed(true);
      },
      onExploreRelationType: (
        _id,
        relationType: ObjectRelationType,
        relations: readonly ObjectRelation[],
      ) => {
        setPeekClosed(true);
        if (relations.length === 0) {
          setEvidenceHighlight(null);
          toast.message(OBJECT_RELATION_TYPE_LABEL_KO[relationType], {
            description: "연결된 노드가 없어요",
          });
          return;
        }
        setEvidenceHighlight({
          evidenceId: `explore:${relationType}`,
          focusNodeId: relations[0]?.toObjectId ?? null,
          lineCoords: null,
          lineCoordsList: relations.map((r) => r.lineCoords),
          highlightNodeIds: relations.map((r) => r.toObjectId),
          mode: "explore",
        });
        toast.message(OBJECT_RELATION_TYPE_LABEL_KO[relationType], {
          description: `${relations.length}개 노드 · Edge 탐색`,
        });
      },
      onExploreRelation: (_id, relation: ObjectRelation) => {
        setPeekClosed(true);
        setEvidenceHighlight({
          evidenceId: relation.id,
          focusNodeId: relation.toObjectId,
          lineCoords: [...relation.lineCoords],
          highlightNodeIds: [relation.toObjectId],
          mode: "edge",
        });
        toast.message(relation.roleLabelKo, {
          description: relation.title,
        });
      },
    };

    const session: CalloutSessionValue = {
      contextId: eventId,
      getObject: (objectId) => {
        const node = state.nodes.find((n) => n.id === objectId);
        if (!node) return null;
        return buildRimvioObjectFromWorkspace({
          contextId: eventId,
          state,
          node,
        });
      },
      getNeighbors: (objectId) =>
        buildCalloutNeighborsFromWorkspace(state, objectId),
      getAlternatives: (objectId) =>
        buildCalloutAlternativesFromWorkspace(state, objectId),
      getRelationBuckets: (objectId) => {
        const ctx = buildObjectRelationContextFromWorkspace(state, objectId);
        if (!ctx) {
          return {
            nearby: [],
            similar: [],
            connected: [],
            route: [],
          };
        }
        return getAllRelationBuckets(objectId, ctx);
      },
      getSimulationAnchors: () => buildSimulationAnchorsFromWorkspace(state),
      getPrepareDraft: (objectId) =>
        readReservationDraft(eventId, objectId),
      getPrepareDateRange: () =>
        buildReservationDateRangeFromWorkspace(state),
      getPrepareGuestCount: () => defaultGuestCountFromWorkspace(state),
      getPreparePrice: (objectId) => {
        const node = state.nodes.find((n) => n.id === objectId);
        if (!node) {
          return { amountWon: null, labelKo: null };
        }
        return buildReservationPriceFromObject(
          buildRimvioObjectFromWorkspace({
            contextId: eventId,
            state,
            node,
          }),
        );
      },
      handlers,
    };

    return session;
  }, [
    selectedNode,
    state,
    eventId,
    calloutWindows,
    focusedWindowId,
    onPrepareReserve,
    onPinToggle,
    onOpenField,
  ]);

  const floatingCallouts = useMemo(() => {
    if (!mapObjectCallout || calloutWindows.length === 0) return null;
    return calloutWindows.map((w) => {
      const node = state?.nodes.find((n) => n.id === w.entityId);
      return {
        window: w,
        session: mapObjectCallout,
        title: node?.title ?? w.entityId,
        subtitleKo: node?.amountLabel ?? null,
      };
    });
  }, [mapObjectCallout, calloutWindows, state?.nodes]);

  if (!expanded || !state || state.status === "closed") {
    return null;
  }

  const sharedSheets = (
    <>
      {closeNameOpen ? (
        <WorkspaceCloseNameSheet
          suggestedTitleKo={closeNameSuggested}
          busy={commitBusy}
          onConfirm={onCloseNameConfirm}
          onCollapseOnly={(titleKo) => {
            const id = contextEventId?.trim();
            if (id && titleKo.trim()) {
              renameContextEventTitle(id, titleKo.trim());
            }
            collapseWorkspace();
          }}
          onCancel={() => setCloseNameOpen(false)}
        />
      ) : null}

      {commitPreviewOpen && commitPreview ? (
        <WorkspaceCommitPreviewSheet
          preview={commitPreview}
          busy={commitBusy}
          onConfirm={runCommit}
          onCancel={() => setCommitPreviewOpen(false)}
        />
      ) : null}
    </>
  );

  if (useCapabilityChrome && capabilityLayout && capabilityView) {
    return (
      <div
        className={cn(
          "pointer-events-auto fixed inset-0 z-[10150] flex flex-col bg-[#eef1f5]",
          className,
        )}
        role="dialog"
        aria-label={copy.globe.workspaceOpenTitle}
        aria-modal="true"
        data-context-workspace-open
        data-workspace-capability-chrome
      >
        <WorkspaceCapabilityChrome
          contextEventId={eventId}
          layout={capabilityLayout}
          view={capabilityView}
          title={title}
          progress={progress}
          agentStatusKo={
            state.lastChangeKo?.trim() ||
            concierge.opportunityTitleKo ||
            copy.globe.agentActivityWorking("…")
          }
          weatherKo={concierge.topWeatherKo}
          onClose={onClose}
          onCommit={() => setCommitPreviewOpen(true)}
          commitDisabled={
            visibleNodes.length === 0 ||
            (state.selectedIds.length === 0 &&
              !visibleNodes.some((n) => n.selected))
          }
          onSelectNode={(nodeId) => {
            setFocusedId(nodeId);
            setPeekClosed(false);
          }}
          onOpenCompare={() => openCompareDecision()}
          map={
            <div className="relative h-full w-full">
              <WorkspaceMapView
                pins={capabilityMapPins}
                selectedId={selectedId}
                onSelectPin={onSelect}
                decisionProjections={decisionProjections}
                selectedDecisionEntityId={
                  compareDecisionActive
                    ? workspaceProjection.mode === "compare_decision"
                      ? workspaceProjection.selectedEntityId
                      : null
                    : null
                }
                onDecisionSelect={onDecisionSelect}
                compareRelationshipEdges={compareRelationshipEdges}
                compareEntityTitles={compareEntityTitles}
                onPinToggle={onPinToggle}
                onRemovePin={onRemovePin}
                onPrepareReserve={onPrepareReserve}
                onOpenField={onOpenField}
                routeLineCoords={
                  capabilityFocusNodeIds
                    ? buildWorkspaceItineraryLineCoords(
                        mapFocusNodes.filter((n) =>
                          capabilityFocusNodeIds.has(n.id),
                        ),
                      )
                    : routeLineCoords
                }
                contextEventId={eventId}
                preferredCenter={preferredMapCenter}
                floatingCallouts={floatingCallouts}
                evidenceHighlight={evidenceHighlight}
                onCalloutRequestWorkspace={(entityId) => {
                  setFocusedId(entityId);
                  setPeekClosed(false);
                }}
              />
              {listOpen && !compareDecisionActive ? (
                <div className="pointer-events-none absolute inset-y-3 right-3 z-[12] flex justify-end">
                  <WorkspaceGptPlaceListPanel
                    open={listOpen}
                    contextEventId={eventId}
                    nodes={carouselNodes}
                    workspace={state}
                    selectedId={selectedId}
                    searching={carouselNodes.length === 0}
                    onSelect={onPlaceListSelect}
                    onClose={() => setListOpen(false)}
                  />
                </div>
              ) : null}
              {compareDecisionActive ? (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-[7] flex justify-center px-3">
                  <div
                    className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#191f28]/92 px-3 py-1.5 text-white shadow-lg backdrop-blur-md"
                    data-workspace-compare-decision-pill
                  >
                    <span className="text-[11px] font-bold">
                      {copy.globe.workspaceCompareDecisionPill(
                        decisionProjections?.length ??
                          (workspaceProjection.mode === "compare_decision"
                            ? workspaceProjection.candidateEntityIds.length
                            : 0),
                      )}
                    </span>
                    <button
                      type="button"
                      className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-extrabold"
                      onClick={() => exitCompareDecisionProjection(eventId)}
                    >
                      {copy.globe.workspaceCompareDecisionExit}
                    </button>
                  </div>
                </div>
              ) : null}
              {selectedMediaPin?.contextMedia ? (
                <WorkspaceMapMediaEmbed
                  title={selectedMediaPin.title}
                  media={selectedMediaPin.contextMedia}
                  onClose={() => setFocusedId(null)}
                />
              ) : null}
            </div>
          }
          agentDock={
            !showPeek && !commitPreviewOpen ? (
              <WorkspaceCursorDock
                contextEventId={eventId}
                onFocusNode={onSelect}
                onBriefReplay={() => {
                  setListOpen(false);
                  setPeekClosed(true);
                }}
                briefReplayGroundIndex={briefReplayGroundIndex}
                activeDraftNodeId={venueSelectedId}
              />
            ) : null
          }
        />

        {selectedNode && !compareDecisionActive && !commitPreviewOpen ? (
          <WorkspaceObjectCarousel
            open={showPeek}
            contextEventId={eventId}
            nodes={carouselNodes}
            activeNodeId={selectedNode.id}
            workspace={state}
            onActiveNodeChange={onCarouselActiveNodeChange}
            onClose={() => {
              peekOpenGenerationRef.current += 1;
              setPeekClosed(true);
            }}
            onOpenCompare={() => openCompareDecision()}
            onPrepareReserve={(nodeId) => onPrepareReserve(nodeId)}
            onOpenField={(nodeId) => onOpenField(nodeId)}
            onConfirmReady={(nodeId) => onConfirmReady(nodeId)}
            awaitingField={selectedAwaitingField}
          />
        ) : null}

        {sharedSheets}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-auto fixed inset-0 z-[10150] flex flex-col bg-[#eef1f5]",
        className,
      )}
      role="dialog"
      aria-label={copy.globe.workspaceOpenTitle}
      aria-modal="true"
      data-context-workspace-open
    >
      {/* Top chrome — hide while place sheet is open so panel can rise (GPT Maps) */}
      {!showPeek ? (
      <header className="relative z-[6] flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f2f4f6] text-[#191f28]"
          onClick={onClose}
          aria-label={copy.globe.workspaceCollapse}
        >
          <X className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-bold tracking-tight text-[#191f28]">
            {title}
          </p>
          <p className="truncate text-[10px] tabular-nums text-[#8b95a1]">
            {mapFocusNodes.length}곳 · {progress}%
            {mapFocusKind
              ? ` · ${domainLabelKo(mapFocusKind)}`
              : ""}
            {!mapFocusKind && concierge.topWeatherKo
              ? ` · ${concierge.topWeatherKo.replace(/^현재\s*/u, "")}`
              : ""}
            {!mapFocusKind && concierge.congestionKo
              ? ` · ${concierge.congestionKo.replace(/^전체\s*일정\s*/u, "")}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f2f4f6] text-[#191f28]"
          onClick={() => setListOpen((v) => !v)}
          aria-label="목록"
          aria-pressed={listOpen}
        >
          <List className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <button
          type="button"
          className="shrink-0 rounded-full bg-[#3182f6] px-2.5 py-2 text-[10px] font-bold text-white disabled:opacity-40"
          onClick={() => setCommitPreviewOpen(true)}
          disabled={
            visibleNodes.length === 0 ||
            (state.selectedIds.length === 0 &&
              !visibleNodes.some((n) => n.selected))
          }
          data-workspace-commit
        >
          {copy.globe.workspaceCommitCta}
        </button>
      </header>
      ) : null}

      {/* Map owns remaining height — agent floats; no grey footer band. */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
        {preferMobileWorkspace ? (
          <MobileWorkspace
            contextEventId={eventId}
            projectTitleKo={projectTitleKo}
            pins={mapPins}
            preferredCenter={preferredMapCenter}
            routeLineCoords={routeLineCoords}
            onSelectPin={onSelect}
            onPrepareReserve={onPrepareReserve}
          />
        ) : (
          <>
        <WorkspaceMapView
          pins={mapPins}
          selectedId={selectedId}
          onSelectPin={onSelect}
          onPinToggle={onPinToggle}
          onRemovePin={onRemovePin}
          onPrepareReserve={onPrepareReserve}
          onOpenField={onOpenField}
          routeLineCoords={routeLineCoords}
          contextEventId={eventId}
          preferredCenter={preferredMapCenter}
          floatingCallouts={floatingCallouts}
          evidenceHighlight={evidenceHighlight}
          decisionProjections={decisionProjections}
          selectedDecisionEntityId={
            workspaceProjection.mode === "compare_decision"
              ? workspaceProjection.selectedEntityId
              : null
          }
          onDecisionSelect={onDecisionSelect}
          compareRelationshipEdges={compareRelationshipEdges}
          compareEntityTitles={compareEntityTitles}
          onCalloutRequestWorkspace={(entityId) => {
            setFocusedId(entityId);
            setPeekClosed(false);
          }}
        />
        {compareDecisionActive ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[7] flex justify-center px-3">
            <div
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#191f28]/92 px-3 py-1.5 text-white shadow-lg backdrop-blur-md"
              data-workspace-compare-decision-pill
            >
              <span className="text-[11px] font-bold">
                {copy.globe.workspaceCompareDecisionPill(
                  decisionProjections?.length ??
                    (workspaceProjection.mode === "compare_decision"
                      ? workspaceProjection.candidateEntityIds.length
                      : 0),
                )}
              </span>
              <button
                type="button"
                className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-extrabold"
                onClick={() => exitCompareDecisionProjection(eventId)}
              >
                {copy.globe.workspaceCompareDecisionExit}
              </button>
            </div>
          </div>
        ) : null}
        {calloutWindows.length >= 2 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[6] flex justify-center px-3">
            <button
              type="button"
              className="pointer-events-auto rounded-full bg-[#191f28] px-4 py-2 text-[11px] font-bold text-white shadow-lg"
              onClick={() => {
                const ids = calloutWindows.map((w) => w.entityId).slice(0, 5);
                openCompareDecision(ids);
              }}
            >
              비교 · {calloutWindows.length}개 Callout
            </button>
          </div>
        ) : null}
          </>
        )}
        </div>
        {selectedMediaPin?.contextMedia ? (
          <WorkspaceMapMediaEmbed
            title={selectedMediaPin.title}
            media={selectedMediaPin.contextMedia}
            onClose={() => setFocusedId(null)}
          />
        ) : null}

        {!showPeek &&
        (showSoftRainChip || showSoftQuietChip || showSoftRouteChip) ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[2] flex justify-center px-3">
            <div className="pointer-events-auto flex max-w-[min(92vw,360px)] items-center gap-2 rounded-2xl bg-white/96 px-3 py-2 shadow-[0_8px_24px_rgba(25,31,40,0.12)] ring-1 ring-black/[0.04]">
              <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#191f28]">
                {showSoftRainChip
                  ? (concierge.opportunityTitleKo ??
                    copy.globe.workspaceMapSoftRainHint)
                  : showSoftQuietChip
                    ? copy.globe.workspaceMapSoftQuietHint
                    : copy.globe.workspaceMapSoftRouteHint}
              </p>
              <button
                type="button"
                className="shrink-0 rounded-full bg-[#3182f6] px-2.5 py-1 text-[10px] font-extrabold text-white"
                onClick={() => {
                  if (showSoftRainChip) {
                    applyWorkspaceTransition({
                      contextEventId: eventId,
                      op: "simulate",
                      simulateScenarioKo: "비 오면 실내",
                    });
                    setSoftRainDismissed(true);
                    toast.success(copy.globe.workspaceMapSoftRainApply);
                  } else if (showSoftQuietChip) {
                    applyWorkspaceTransition({
                      contextEventId: eventId,
                      op: "simulate",
                      simulateScenarioKo: "덜 붐비는 동선",
                    });
                    setSoftQuietDismissed(true);
                    toast.success(copy.globe.workspaceMapSoftQuietApply);
                  } else {
                    applyWorkspaceTransition({
                      contextEventId: eventId,
                      op: "optimize_route",
                    });
                    setSoftRouteDismissed(true);
                    toast.success(copy.globe.workspaceToolOptimizeRoute);
                  }
                }}
              >
                {copy.globe.workspaceMapSoftQuietApply}
              </button>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8b95a1]"
                aria-label="닫기"
                onClick={() => {
                  setSoftRainDismissed(true);
                  setSoftQuietDismissed(true);
                  setSoftRouteDismissed(true);
                }}
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : null}

        {listOpen && !compareDecisionActive ? (
          <div className="pointer-events-none absolute inset-y-3 right-3 z-[12] flex justify-end">
            <WorkspaceGptPlaceListPanel
              open={listOpen}
              contextEventId={eventId}
              nodes={carouselNodes}
              workspace={state}
              selectedId={selectedId}
              searching={carouselNodes.length === 0}
              onSelect={onPlaceListSelect}
              onClose={() => setListOpen(false)}
            />
          </div>
        ) : null}

      {/* Agent — floating Cursor dock over map (overlay only; no grey footer band). */}
      {!preferMobileWorkspace && !showPeek && !commitPreviewOpen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[4] flex justify-center px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto w-full max-w-[min(380px,92%)] drop-shadow-[0_10px_28px_rgba(25,31,40,0.18)]">
            <WorkspaceCursorDock
              contextEventId={eventId}
              compact
              onFocusNode={onSelect}
              onBriefReplay={() => {
                setListOpen(false);
                setPeekClosed(true);
              }}
              briefReplayGroundIndex={briefReplayGroundIndex}
              activeDraftNodeId={venueSelectedId}
            />
          </div>
        </div>
      ) : null}
      </div>

      {/* Place sheet — desktop / tablet; mobile uses Expandable Sheet */}
      {!preferMobileWorkspace &&
      selectedNode &&
      !compareDecisionActive &&
      !commitPreviewOpen ? (
        <WorkspaceObjectCarousel
          open={showPeek}
          contextEventId={eventId}
          nodes={carouselNodes}
          activeNodeId={selectedNode.id}
          workspace={state}
          onActiveNodeChange={onCarouselActiveNodeChange}
          onClose={() => {
            peekOpenGenerationRef.current += 1;
            setPeekClosed(true);
          }}
          onOpenCompare={() => openCompareDecision()}
          onPrepareReserve={(nodeId) => onPrepareReserve(nodeId)}
          onOpenField={(nodeId) => onOpenField(nodeId)}
          onConfirmReady={(nodeId) => onConfirmReady(nodeId)}
          awaitingField={selectedAwaitingField}
        />
      ) : null}

      {closeNameOpen ? (
        <WorkspaceCloseNameSheet
          suggestedTitleKo={closeNameSuggested}
          busy={commitBusy}
          onConfirm={onCloseNameConfirm}
          onCollapseOnly={(titleKo) => {
            const id = contextEventId?.trim();
            if (id && titleKo.trim()) {
              renameContextEventTitle(id, titleKo.trim());
            }
            collapseWorkspace();
          }}
          onCancel={() => setCloseNameOpen(false)}
        />
      ) : null}

      {commitPreviewOpen && commitPreview ? (
        <WorkspaceCommitPreviewSheet
          preview={commitPreview}
          busy={commitBusy}
          onConfirm={runCommit}
          onCancel={() => setCommitPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
