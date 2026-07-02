"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Car, ImageIcon, MapPin, Navigation, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MarketCompletionTraceSheet } from "@/components/market/market-completion-trace-sheet";
import { AgentProgressList } from "@/components/ui/agent-progress-list";
import { MarketTradeCancelReservationPanel } from "@/components/market/market-trade-cancel-reservation-panel";
import { MarketListingMediaRowThumb } from "@/components/market/market-listing-media-thumb";
import { useCopy } from "@/hooks/use-copy";
import { useCoordinationCalendarBusy } from "@/hooks/use-coordination-calendar-busy";
import { useLiveLocationSnapshot } from "@/hooks/use-live-location-snapshot";
import {
  acceptMarketTradeScheduleRemote,
  departMarketTradeRemote,
  pickMarketTradeDayRemote,
  proposeMarketTradeScheduleRemote,
} from "@/lib/globe/market/client/fetch-market-trades-client";
import { confirmMarketHandshakeCompleteRemote } from "@/lib/globe/market/client/sync-market-intent-remote";
import { commitMarketCompletionTrace } from "@/lib/globe/market/commit-market-completion-trace";
import { dismissMarketCompletionTrace } from "@/lib/globe/market/market-completion-pinned-store";
import type { MarketCompletionTraceDraft } from "@/lib/globe/market/market-handshake-types";
import {
  buildMarketTradeMeetAtIsoFromParts,
  formatMarketTradeDateLabelKo,
  isMeetTimeAllowedForTrade,
  suggestMarketTradeProposeTimeValue,
} from "@/lib/globe/market/market-trade-schedule";
import { formatMarketTradeMeetAtLabel } from "@/lib/globe/market/resolve-market-trade-progress";
import type { MarketTradeSessionView } from "@/lib/globe/market/market-trade-types";
import {
  buildKakaoMapRouteHref,
  buildKakaoMapRouteWebHref,
} from "@/lib/resolvers/deep-links";
import { openHrefWithFallback } from "@/lib/actions/open-with-fallback";
import { rimvioCompactPrimaryCtaClass, RIMVIO_RADIUS, RIMVIO_TYPE, rimvioSurfaceCardClass } from "@/lib/design/rimvio-ontology";
import { tradeProgressStepsToAgentTasks } from "@/lib/globe/market/trade-progress-steps-to-agent-tasks";
import {
  agentNegotiationRoomPath,
  applyCoordinationCalendarBusyToRoom,
  approveAgentNegotiationRoom,
  getAgentNegotiationRoom,
  loadAgentNegotiationRoomRemote,
  submitAgentNegotiationSlotAnswer,
  subscribeAgentNegotiationRooms,
} from "@/lib/globe/market/coordination/agent-negotiation-store";
import { viewerHasApprovedCoordination } from "@/lib/globe/market/coordination/detect-agent-coordination-attention";
import type { AgentNegotiationRoomRecord } from "@/lib/globe/market/coordination/agent-negotiation-types";
import { cn } from "@/lib/utils";

const MARKET_FIELD_PANEL = cn(RIMVIO_RADIUS.md, "bg-muted px-3 py-3");
const MARKET_FIELD_LINK_CTA =
  "w-full rounded-xl bg-card py-2.5 text-[13px] font-semibold text-primary shadow-sm ring-1 ring-primary/20";
const MARKET_FIELD_CHIP =
  "rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-50";

export type MarketTradeProgressCardProps = {
  session: MarketTradeSessionView;
  onUpdated?: (session: MarketTradeSessionView) => void;
  className?: string;
};

export function MarketTradeProgressCard({
  session,
  onUpdated,
  className,
}: MarketTradeProgressCardProps) {
  const copy = useCopy();
  const globe = copy.globe;
  const field = globe.field;
  const router = useRouter();
  const liveLocation = useLiveLocationSnapshot();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [departBusy, setDepartBusy] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [proposePlace, setProposePlace] = useState(session.meetPlaceDisplay ?? "");
  const [proposeTimeValue, setProposeTimeValue] = useState("");
  const [completionTrace, setCompletionTrace] = useState<MarketCompletionTraceDraft | null>(null);
  const [completionSheetOpen, setCompletionSheetOpen] = useState(false);
  const [completionPinBusy, setCompletionPinBusy] = useState(false);
  const [coordinationRoom, setCoordinationRoom] = useState<AgentNegotiationRoomRecord | null>(
    () => getAgentNegotiationRoom(session.handshakeId),
  );
  const [coordinationBusy, setCoordinationBusy] = useState(false);
  const [slotChipBusy, setSlotChipBusy] = useState<string | null>(null);
  const coordinationBusyIntervals = useCoordinationCalendarBusy();

  const isSeeking = session.viewerRole === "seeking";
  const badgeTone = isSeeking ? "bg-violet-600 text-white" : "bg-primary text-white";

  useEffect(() => {
    const syncRoom = () => {
      const room = getAgentNegotiationRoom(session.handshakeId);
      if (room) {
        setCoordinationRoom(
          applyCoordinationCalendarBusyToRoom(room, coordinationBusyIntervals),
        );
      }
    };
    syncRoom();
    const unsub = subscribeAgentNegotiationRooms(syncRoom);
    void loadAgentNegotiationRoomRemote(session.handshakeId).then((room) => {
      if (room) {
        setCoordinationRoom(
          applyCoordinationCalendarBusyToRoom(room, coordinationBusyIntervals),
        );
      }
    });
    return unsub;
  }, [session.handshakeId, coordinationBusyIntervals]);

  useEffect(() => {
    const dateKey = session.preferredMeetDateKey?.trim();
    if (!dateKey || !session.showProposeSchedule) {
      return;
    }
    setProposeTimeValue(suggestMarketTradeProposeTimeValue(dateKey));
  }, [session.handshakeId, session.preferredMeetDateKey, session.showProposeSchedule]);

  const onNavigate = () => {
    if (session.meetLat != null && session.meetLng != null) {
      const href = buildKakaoMapRouteHref({
        lat: session.meetLat,
        lng: session.meetLng,
        placeLabel: session.meetPlaceDisplay,
      });
      const webHref = buildKakaoMapRouteWebHref({
        lat: session.meetLat,
        lng: session.meetLng,
        placeLabel: session.meetPlaceDisplay,
      });
      void openHrefWithFallback(href, webHref);
      return;
    }
    if (session.meetPlaceDisplay) {
      const webHref = buildKakaoMapRouteWebHref({
        lat: 0,
        lng: 0,
        placeLabel: session.meetPlaceDisplay,
      });
      window.open(webHref, "_blank", "noopener,noreferrer");
    }
  };

  const onPickDay = async (dateKey: string) => {
    if (busyKey) {
      return;
    }
    setBusyKey(dateKey);
    try {
      const updated = await pickMarketTradeDayRemote({
        handshakeId: session.handshakeId,
        dateKey,
      });
      if (updated) {
        toast.success(globe.marketTradePickDaySuccess);
        onUpdated?.(updated);
      }
    } catch {
      toast.error(globe.marketTradePickDayFail);
    } finally {
      setBusyKey(null);
    }
  };

  const onProposeSchedule = async () => {
    const dateKey = session.preferredMeetDateKey?.trim();
    if (!dateKey || !proposeTimeValue || busyKey) {
      return;
    }
    const meetAtIso = buildMarketTradeMeetAtIsoFromParts(dateKey, proposeTimeValue);
    if (
      !meetAtIso ||
      !isMeetTimeAllowedForTrade({
        meetAtIso,
        dateKey,
      })
    ) {
      toast.error(globe.marketTradeProposeTimeInvalid);
      return;
    }
    setBusyKey(meetAtIso);
    try {
      const updated = await proposeMarketTradeScheduleRemote({
        handshakeId: session.handshakeId,
        meetAtIso,
        meetPlaceLabel: proposePlace.trim() || session.meetPlaceDisplay || undefined,
      });
      if (updated) {
        toast.success(globe.marketTradeProposeSuccess);
        onUpdated?.(updated);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : globe.marketTradeProposeFail,
      );
    } finally {
      setBusyKey(null);
    }
  };

  const onAcceptSchedule = async () => {
    if (busyKey) {
      return;
    }
    setBusyKey("accept");
    try {
      const updated = await acceptMarketTradeScheduleRemote({
        handshakeId: session.handshakeId,
      });
      if (updated) {
        toast.success(globe.marketTradeAcceptSuccess);
        onUpdated?.(updated);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : globe.marketTradeAcceptFail,
      );
    } finally {
      setBusyKey(null);
    }
  };

  const onDepart = async () => {
    if (departBusy || !session.canDepart) {
      return;
    }
    const lat = liveLocation?.lat;
    const lng = liveLocation?.lng;
    if (lat == null || lng == null) {
      toast.error(globe.marketTradeLocationNeeded);
      return;
    }
    setDepartBusy(true);
    try {
      const updated = await departMarketTradeRemote({
        handshakeId: session.handshakeId,
        lat,
        lng,
      });
      if (updated) {
        toast.success(globe.marketTradeDepartSuccess);
        onUpdated?.(updated);
      }
    } catch {
      toast.error(globe.marketTradeDepartFail);
    } finally {
      setDepartBusy(false);
    }
  };

  const onConfirmHandshakeComplete = useCallback(async () => {
    if (completeBusy) {
      return;
    }
    setCompleteBusy(true);
    try {
      const result = await confirmMarketHandshakeCompleteRemote({
        handshakeId: session.handshakeId,
      });
      if (result.awaitingOtherParty) {
        toast.success(globe.marketHandshakeCompleteAwaitingToast);
      } else {
        toast.success(globe.marketHandshakeCompleteConfirmedToast);
      }
      if (result.completed && result.trace) {
        setCompletionTrace(result.trace);
        setCompletionSheetOpen(true);
      }
      if (result.completed) {
        onUpdated?.({
          ...session,
          phase: "completed",
          tradeStatus: "completed",
          canConfirmHandshakeComplete: false,
          awaitingHandshakeOtherParty: false,
        });
      } else {
        onUpdated?.({
          ...session,
          canConfirmHandshakeComplete: false,
          awaitingHandshakeOtherParty: true,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : globe.marketHandshakeCompleteFail;
      toast.error(message);
    } finally {
      setCompleteBusy(false);
    }
  }, [
    completeBusy,
    globe.marketHandshakeCompleteAwaitingToast,
    globe.marketHandshakeCompleteConfirmedToast,
    globe.marketHandshakeCompleteFail,
    onUpdated,
    session,
  ]);

  const onPinCompletionTrace = async () => {
    if (!completionTrace || completionPinBusy) {
      return;
    }
    setCompletionPinBusy(true);
    try {
      commitMarketCompletionTrace({
        trace: completionTrace,
        threadId: session.threadId,
      });
      setCompletionSheetOpen(false);
      toast.success(globe.marketCompletionTracePinnedToast);
    } finally {
      setCompletionPinBusy(false);
    }
  };

  const onDismissCompletionTrace = () => {
    if (completionTrace) {
      dismissMarketCompletionTrace(completionTrace.handshakeId);
    }
    setCompletionSheetOpen(false);
  };

  const showProgress =
    session.tradeStatus === "confirmed" ||
    session.tradeStatus === "en_route" ||
    session.tradeStatus === "meeting" ||
    session.activeStepId !== "confirmed";

  const schedulingActive =
    session.tradeStatus === "scheduling" ||
    session.tradeStatus === "buyer_picked_day" ||
    session.tradeStatus === "seller_proposed";

  const coordinationUi = globe.coordination;
  const showCoordinationSection =
    Boolean(coordinationRoom) &&
    session.tradeStatus !== "completed" &&
    session.tradeStatus !== "cancelled" &&
    session.tradeStatus !== "expired" &&
    coordinationRoom?.state !== "APPROVED";
  const coordinationProposalReady =
    coordinationRoom?.state === "AGREED" && Boolean(coordinationRoom.proposal);
  const coordinationViewerApproved = coordinationRoom
    ? viewerHasApprovedCoordination(coordinationRoom)
    : false;
  const coordinationNeedsViewerSlot =
    (coordinationRoom?.state === "WAITING_USER_INPUT" ||
      coordinationRoom?.state === "PAUSED") &&
    coordinationRoom.pendingQuestion?.ownerRole === session.viewerRole;

  const onCoordinationSlotChip = useCallback(
    (value: string) => {
      const question = coordinationRoom?.pendingQuestion;
      if (!question || slotChipBusy) {
        return;
      }
      setSlotChipBusy(value);
      void submitAgentNegotiationSlotAnswer({
        handshakeId: session.handshakeId,
        slotKey: question.slotKey,
        valueKo: value,
      })
        .then((next) => {
          if (next) {
            setCoordinationRoom(next);
          }
        })
        .finally(() => {
          setSlotChipBusy(null);
        });
    },
    [coordinationRoom?.pendingQuestion, session.handshakeId, slotChipBusy],
  );

  const onOpenCoordinationRoom = () => {
    router.push(agentNegotiationRoomPath(session.handshakeId));
  };

  const onApproveCoordination = async () => {
    if (coordinationBusy || !coordinationProposalReady || coordinationViewerApproved) {
      return;
    }
    setCoordinationBusy(true);
    try {
      const next = await approveAgentNegotiationRoom(session.handshakeId);
      if (next) {
        setCoordinationRoom(next);
        if (next.state === "APPROVED") {
          toast.success(coordinationUi.approveSuccessToast);
        } else {
          toast.success(coordinationUi.approveWaitingPeerToast);
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : coordinationUi.approveCta,
      );
    } finally {
      setCoordinationBusy(false);
    }
  };

  const statusHeadlineKo =
    coordinationProposalReady && !coordinationViewerApproved
      ? field.coordinationProposalHeadline
      : session.statusHeadlineKo;

  return (
    <>
      <article
        className={cn(rimvioSurfaceCardClass("px-4 py-3.5"), className)}
        data-market-trade-card={session.handshakeId}
      >
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", badgeTone)}>
            {session.roleBadgeKo}
          </span>
          <div className="text-right">
            <p className={cn(RIMVIO_TYPE.caption, "font-semibold text-foreground")}>{statusHeadlineKo}</p>
            {session.statusSublineKo ? (
              <p className={cn("mt-0.5", RIMVIO_TYPE.caption)}>{session.statusSublineKo}</p>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2.5">
          <div className={cn("relative size-[52px] shrink-0 overflow-hidden", RIMVIO_RADIUS.md, "bg-muted")}>
            {session.photoUrl ? (
              <MarketListingMediaRowThumb
                photoUrl={session.photoUrl}
                videoUrl={session.videoUrl}
              />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground/60">
                <ImageIcon className="size-6" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(RIMVIO_TYPE.body, "truncate font-bold")}>{session.productTitle}</p>
            <p className={cn("mt-0.5", RIMVIO_TYPE.body, "font-semibold")}>{session.priceLine}</p>
          </div>
        </div>

        {showCoordinationSection ? (
          <div className={cn("mt-3 space-y-2", MARKET_FIELD_PANEL)} data-market-trade-coordination>
            {coordinationProposalReady && coordinationRoom?.proposal ? (
              <>
                <p className="text-[13px] font-semibold text-foreground">
                  {field.coordinationProposalHeadline}
                </p>
                <div className="space-y-1 text-[13px] text-muted-foreground">
                  <p>
                    {coordinationUi.summaryPrice}: {coordinationRoom.proposal.priceKo}
                  </p>
                  <p>
                    {coordinationUi.summaryTime}: {coordinationRoom.proposal.meetTimeKo}
                  </p>
                  {coordinationRoom.proposal.meetPlaceKo ? (
                    <p>
                      {coordinationUi.summaryPlace}: {coordinationRoom.proposal.meetPlaceKo}
                    </p>
                  ) : null}
                </div>
                {coordinationViewerApproved ? (
                  <p className="text-[12px] font-medium text-muted-foreground">
                    {coordinationUi.waitingPeerApproval}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={coordinationBusy}
                    onClick={() => void onApproveCoordination()}
                    className={cn(rimvioCompactPrimaryCtaClass(), "w-full disabled:opacity-50")}
                    data-market-trade-coordination-approve
                  >
                    {coordinationBusy ? "…" : coordinationUi.approveCta}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenCoordinationRoom}
                  className={MARKET_FIELD_LINK_CTA}
                >
                  {field.coordinationViewRoomCta}
                </button>
              </>
            ) : coordinationNeedsViewerSlot ? (
              <>
                <p className="text-[13px] font-semibold text-foreground">
                  {coordinationRoom?.pendingQuestion?.questionKo ?? coordinationUi.stateWaitingYou}
                </p>
                <p className="text-[12px] text-muted-foreground">{field.coordinationInlineSlotHint}</p>
                {coordinationRoom?.pendingQuestion?.chips?.length ? (
                  <div
                    className="flex flex-wrap gap-2 pt-1"
                    data-market-trade-coordination-slot
                  >
                    {coordinationRoom.pendingQuestion.chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        disabled={slotChipBusy !== null}
                        onClick={() => onCoordinationSlotChip(chip)}
                        className={MARKET_FIELD_CHIP}
                      >
                        {slotChipBusy === chip ? "…" : chip}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={onOpenCoordinationRoom}
                  className={MARKET_FIELD_LINK_CTA}
                >
                  {field.coordinationViewRoomCta}
                </button>
              </>
            ) : coordinationRoom?.state === "NEGOTIATING" ? (
              <>
                <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                  <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
                  {field.coordinationProgressHeadline}
                </p>
                <button
                  type="button"
                  onClick={onOpenCoordinationRoom}
                  className={MARKET_FIELD_LINK_CTA}
                >
                  {field.coordinationViewRoomCta}
                </button>
              </>
            ) : coordinationRoom?.state === "STUCK" || coordinationRoom?.state === "PAUSED" ? (
              <>
                <p className="text-[13px] text-muted-foreground">{coordinationUi.stuckBody}</p>
                <button
                  type="button"
                  onClick={onOpenCoordinationRoom}
                  className={MARKET_FIELD_LINK_CTA}
                >
                  {field.coordinationViewRoomCta}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {session.showPickDay ? (
          <div className={cn("mt-3 space-y-2", MARKET_FIELD_PANEL)}>
            <p className="text-[13px] font-medium text-foreground">{globe.marketTradePickDayTitle}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {session.scheduleCandidates.map((dateKey) => (
                <button
                  key={dateKey}
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void onPickDay(dateKey)}
                  className="rounded-full bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  {busyKey === dateKey ? "…" : formatMarketTradeDateLabelKo(dateKey)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {session.showProposeSchedule ? (
          <div className={cn("mt-3 space-y-3", MARKET_FIELD_PANEL)}>
            <p className="text-[13px] font-medium text-foreground">
              {globe.marketTradeProposeScheduleTitle}
            </p>
            {session.preferredMeetDateKey ? (
              <p className="text-[12px] font-semibold text-primary">
                {formatMarketTradeDateLabelKo(session.preferredMeetDateKey)}
              </p>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                {globe.marketTradeProposeTimeLabel}
              </span>
              <input
                type="time"
                step={60}
                value={proposeTimeValue}
                onChange={(event) => setProposeTimeValue(event.target.value)}
                className={cn(
                  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-[14px] outline-none focus:border-primary",
                )}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                {globe.marketTradeProposePlaceLabel}
              </span>
              <input
                type="text"
                value={proposePlace}
                onChange={(event) => setProposePlace(event.target.value)}
                placeholder={globe.marketTradeProposePlacePlaceholder}
                className={cn(
                  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-[14px] outline-none focus:border-primary",
                )}
              />
            </label>
            <button
              type="button"
              disabled={!proposeTimeValue || busyKey !== null}
              onClick={() => void onProposeSchedule()}
              className={cn(rimvioCompactPrimaryCtaClass(), "w-full disabled:opacity-50")}
            >
              {busyKey ? "…" : globe.marketTradeProposeSend}
            </button>
          </div>
        ) : null}

        {session.showAcceptProposal ? (
          <div className={cn("mt-3 space-y-3", MARKET_FIELD_PANEL)}>
            {session.meetAtLabelKo ? (
              <p className={cn("flex items-center gap-2", RIMVIO_TYPE.body, "font-semibold")}>
                <Calendar className="size-4 text-primary" aria-hidden />
                {session.meetAtLabelKo}
              </p>
            ) : null}
            {session.meetPlaceDisplay ? (
              <p className={cn("flex items-center gap-2", RIMVIO_TYPE.body)}>
                <MapPin className="size-4 text-primary" aria-hidden />
                {session.meetPlaceDisplay}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => void onAcceptSchedule()}
              className={cn(rimvioCompactPrimaryCtaClass(), "w-full disabled:opacity-50")}
            >
              {busyKey ? "…" : globe.marketTradeAcceptSchedule}
            </button>
          </div>
        ) : null}

        {!schedulingActive && session.meetAtLabelKo ? (
          <p className={cn("mt-3 flex items-center gap-2", RIMVIO_TYPE.body)}>
            <Calendar className="size-4 shrink-0 text-primary" aria-hidden />
            {session.meetAtLabelKo}
          </p>
        ) : null}

        {!schedulingActive && session.meetPlaceDisplay ? (
          <p className={cn("mt-1.5 flex items-center gap-2", RIMVIO_TYPE.body)}>
            <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
            {session.meetPlaceDisplay}
          </p>
        ) : null}

        {session.hostGuestEtaLabelKo ? (
          <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-primary">
            <Car className="size-3.5 shrink-0" aria-hidden />
            {session.hostGuestEtaLabelKo}
          </p>
        ) : null}

        {showProgress && !schedulingActive ? (
          <AgentProgressList
            className="mt-4"
            variant="light"
            layout="horizontal"
            tasks={tradeProgressStepsToAgentTasks(session.progressSteps)}
          />
        ) : null}

        {(session.showNavigate || session.showDepart || session.isEnRoute) && (
          <div className="mt-4 space-y-2">
            <div className="flex gap-2">
              {session.showNavigate ? (
                <button
                  type="button"
                  onClick={onNavigate}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-muted py-2.5 text-[14px] font-semibold text-foreground",
                  )}
                >
                  <Navigation className="size-4" aria-hidden />
                  {globe.marketTradeNavigate}
                </button>
              ) : null}
              {session.showDepart ? (
                <button
                  type="button"
                  disabled={!session.canDepart || departBusy}
                  onClick={() => void onDepart()}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-semibold disabled:opacity-50",
                    session.canDepart
                      ? "bg-emerald-500 text-white"
                      : "cursor-not-allowed bg-muted text-muted-foreground/60",
                  )}
                >
                  <Car className="size-4" aria-hidden />
                  {departBusy ? "…" : globe.marketTradeDepart}
                </button>
              ) : null}
              {session.isEnRoute && session.viewerRole === "seeking" ? (
                <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 py-2.5 text-[14px] font-semibold text-emerald-600">
                  <Car className="size-4" aria-hidden />
                  {globe.marketTradeEnRoute}
                </span>
              ) : null}
              {session.isEnRoute && session.viewerRole === "listing" ? (
                <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary/10 py-2.5 text-[14px] font-semibold text-primary">
                  <Car className="size-4" aria-hidden />
                  {globe.marketTradeGuestEnRouteListing}
                </span>
              ) : null}
            </div>
            {session.departOpensHintKo ? (
              <p className={cn("text-[12px] leading-relaxed", RIMVIO_TYPE.caption)}>
                {session.departOpensHintKo}
              </p>
            ) : null}
          </div>
        )}

        <MarketTradeCancelReservationPanel
          session={session}
          onUpdated={onUpdated}
          onCancelled={() => {
            onUpdated?.({
              ...session,
              tradeStatus: "cancelled",
              showCancelReservation: false,
            });
          }}
        />

        {session.canConfirmHandshakeComplete || session.awaitingHandshakeOtherParty ? (
          <div className="mt-4 border-t border-black/[0.06] pt-3">
            {session.awaitingHandshakeOtherParty ? (
              <p className={cn("text-center", RIMVIO_TYPE.caption)}>
                {globe.marketHandshakeAwaitingOtherParty}
              </p>
            ) : (
              <button
                type="button"
                disabled={completeBusy || !session.canConfirmHandshakeComplete}
                onClick={() => void onConfirmHandshakeComplete()}
                className={cn(rimvioCompactPrimaryCtaClass(), "w-full disabled:opacity-50")}
              >
                {session.handshakeCompleteCtaKo}
              </button>
            )}
          </div>
        ) : null}
      </article>

      <MarketCompletionTraceSheet
        trace={completionTrace}
        open={completionSheetOpen}
        busy={completionPinBusy}
        onOpenChange={(open) => {
          if (!open) {
            onDismissCompletionTrace();
            return;
          }
          setCompletionSheetOpen(true);
        }}
        onConfirm={() => void onPinCompletionTrace()}
      />
    </>
  );
}
