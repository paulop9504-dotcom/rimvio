/**
 * trip_prep — 「제주도 3박4일 여행 준비해줘」
 * Lodging search→rank→reserve_prep→wait_commit spine (no itinerary OS yet).
 */

import type { ActionPlanStepV1, ActionPlanV1 } from "@/lib/action-planner/types";
import { ACTION_PLAN_VERSION } from "@/lib/action-planner/types";
import {
  extractTravelDestination,
} from "@/lib/experience-run/extract-travel-destination";
import {
  parseDurationDaysFromText,
  parseTravelDateRangeFromText,
} from "@/lib/experience-run/travel-context-slots";
import { resolveToolIdForIntent } from "@/lib/rule-engine/resolve-tool-id";

const NIGHTS_DAYS = /(\d{1,2})\s*박\s*(\d{1,2})\s*일/iu;
const NIGHTS_ONLY = /(\d{1,2})\s*박(?!\s*\d)/iu;

const PREP_CUE =
  /여행\s*준비|준비해(?:줘|요|주세요)?|trip\s*prep|여행\s*계획|일정\s*(?:짜|세워|만들)|여행\s*짜/iu;

const TRIP_CUE = /여행|출장|trip|abroad|놀러/iu;

function normalize(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDaysIso(startIsoDate: string, days: number): string {
  const d = new Date(`${startIsoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export type TripPrepSlots = {
  readonly destinationKo: string | null;
  readonly nights: number | null;
  readonly days: number | null;
  readonly checkInIso: string | null;
  readonly checkOutIso: string | null;
};

/**
 * True for trip-prep ingress (even without 찾+예약 compound pair).
 */
export function isTripPrepUtterance(utterance: string): boolean {
  const text = normalize(utterance);
  if (!text) {
    return false;
  }
  // Leave search+reserve / compare+reserve to existing builders.
  if (
    /(?:찾|검색|lookup|search)/iu.test(text) &&
    /예약\s*준비|예약해|reserve|booking/iu.test(text)
  ) {
    return false;
  }
  if (/비교|compare/iu.test(text) && /예약|reserve/iu.test(text)) {
    return false;
  }

  const hasPrep = PREP_CUE.test(text);
  const hasTrip = TRIP_CUE.test(text);
  const hasDest = Boolean(extractTravelDestination(text));
  const hasDuration =
    parseDurationDaysFromText(text) != null ||
    NIGHTS_DAYS.test(text) ||
    NIGHTS_ONLY.test(text);

  if (hasPrep && (hasDest || hasDuration || hasTrip)) {
    return true;
  }
  if (hasTrip && hasDest && hasDuration && /준비|계획|짜/iu.test(text)) {
    return true;
  }
  return false;
}

export function parseTripPrepSlots(
  utterance: string,
  referenceDateIso?: string | null,
): TripPrepSlots {
  const text = normalize(utterance);
  const refDate =
    referenceDateIso?.slice(0, 10) ||
    new Date().toISOString().slice(0, 10);

  const destinationKo = extractTravelDestination(text);
  const nightsDays = text.match(NIGHTS_DAYS);
  let nights: number | null = null;
  let days: number | null = null;

  if (nightsDays?.[1] && nightsDays[2]) {
    nights = Number.parseInt(nightsDays[1], 10);
    days = Number.parseInt(nightsDays[2], 10);
  } else {
    const nightsOnly = text.match(NIGHTS_ONLY);
    if (nightsOnly?.[1]) {
      nights = Number.parseInt(nightsOnly[1], 10);
      days = nights + 1;
    } else {
      days = parseDurationDaysFromText(text);
      nights = days != null && days > 0 ? days - 1 : null;
    }
  }

  if (nights != null && (nights < 1 || nights > 60)) {
    nights = null;
  }
  if (days != null && (days < 1 || days > 60)) {
    days = null;
  }

  const range = parseTravelDateRangeFromText(text, refDate);
  let checkInIso = range?.startIso?.slice(0, 10) ?? null;
  let checkOutIso = range?.endIso?.slice(0, 10) ?? null;

  if (!checkInIso && nights != null) {
    checkInIso = refDate;
    checkOutIso = addDaysIso(refDate, nights);
  }

  return {
    destinationKo,
    nights,
    days,
    checkInIso,
    checkOutIso,
  };
}

/**
 * Build trip_prep ActionPlan — lodging spine + Field wait_commit.
 */
export function buildTripPrepActionPlan(input: {
  utterance: string;
  contextEventId: string;
  referenceDateIso?: string | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (!isTripPrepUtterance(text)) {
    return null;
  }

  const slots = parseTripPrepSlots(text, input.referenceDateIso);
  const dest = slots.destinationKo?.trim() || "여행지";
  const stayLabel =
    slots.nights != null && slots.days != null
      ? `${slots.nights}박${slots.days}일`
      : slots.nights != null
        ? `${slots.nights}박`
        : null;
  const entityLabelKo = stayLabel ? `${dest} 숙소 ${stayLabel}` : `${dest} 숙소`;

  const rankToolId =
    resolveToolIdForIntent({ intent: "Analyze", toolFamily: "ranking" }) ??
    "ranking.pick";
  const reserveToolId =
    resolveToolIdForIntent({ intent: "Reserve", toolFamily: "booking" }) ??
    "booking.prepare";

  const stayNote = [
    stayLabel,
    slots.checkInIso && slots.checkOutIso
      ? `${slots.checkInIso}~${slots.checkOutIso}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:resolve:trip-lodging",
      kind: "resolve_entity",
      labelKo: `${dest} 숙소 찾기`,
      status: "pending",
      entityLabelKo,
      toolId: "hotel.lookup",
      diffPhase: "working_set",
      noteKo: stayNote || `trip_prep · ${dest}`,
    },
    {
      id: "step:rank:trip",
      kind: "tool",
      labelKo: "가성비로 고르기",
      status: "pending",
      toolId: rankToolId,
      diffPhase: "working_set",
    },
    {
      id: "step:reserve_prep:trip",
      kind: "graph_command",
      labelKo: "숙소 예약 준비",
      status: "pending",
      toolId: reserveToolId,
      diffPhase: "field_gate",
      graphCommand: {
        op: "reserve_prep",
        targetRef: { labelKo: entityLabelKo },
      },
    },
    {
      id: "step:wait_commit:trip",
      kind: "wait_commit",
      labelKo: "승인 요청",
      status: "pending",
      diffPhase: "field_gate",
      noteKo: "결재함에서 반영하기",
    },
  ];

  const planId = `aplan:${input.contextEventId.trim()}:${Date.now().toString(36)}`;
  return {
    version: ACTION_PLAN_VERSION,
    planId,
    contextEventId: input.contextEventId.trim(),
    utterance: text,
    steps,
    createdAtIso: new Date().toISOString(),
    diffBundleId: `diff-bundle:${planId}`,
    planKind: "trip_prep",
    requiresFieldCommit: true,
    tripPrep: slots,
  };
}
