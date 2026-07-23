/**
 * Open lodging Workspace when trip_prep plan starts (Agent ↔ Workspace bind).
 */

import type { ActionPlanV1 } from "@/lib/action-planner/types";
import { isTripPrepUtterance } from "@/lib/action-planner/build-trip-prep-plan";
import { openLodgingContextWorkspace } from "@/lib/context-workspace/open-map-workspace";
import type { ContextWorkspaceState } from "@/lib/context-workspace/types";

export function openWorkspaceForTripPrep(input: {
  readonly utterance: string;
  readonly contextEventId: string;
  readonly plan?: ActionPlanV1 | null;
}): ContextWorkspaceState | null {
  const utterance = input.utterance.trim();
  const contextEventId = input.contextEventId.trim();
  if (!utterance || !contextEventId) {
    return null;
  }

  const plan = input.plan;
  const isTrip =
    plan?.planKind === "trip_prep" || isTripPrepUtterance(utterance);
  if (!isTrip) {
    return null;
  }

  const slots = plan?.tripPrep;
  const dest = slots?.destinationKo?.trim() || "여행지";
  const stay =
    slots?.nights != null && slots?.days != null
      ? `${slots.nights}박${slots.days}일`
      : slots?.nights != null
        ? `${slots.nights}박`
        : null;
  const query = stay ? `${dest} 숙소 ${stay}` : `${dest} 숙소`;
  const summaryKo = stay
    ? `${dest} · ${stay} 여행 준비 Workspace`
    : `${dest} 여행 준비 Workspace`;

  return openLodgingContextWorkspace({
    contextEventId,
    query,
    summaryKo,
    hits: [],
    source: "trip_prep",
  });
}
