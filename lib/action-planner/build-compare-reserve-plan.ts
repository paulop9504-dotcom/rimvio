/**
 * Compound Action Plan builders — compare→reserve · search→reserve · revise→research.
 */

import type { ActionPlanStepV1, ActionPlanV1 } from "@/lib/action-planner/types";
import { ACTION_PLAN_VERSION } from "@/lib/action-planner/types";
import { resolvePlanEntityLabel } from "@/lib/action-planner/resolve-plan-entity";
import { isAmenityLookupQuery } from "@/lib/tool-registry/amenity-lookup-cue";
import type { SessionGraphV1 } from "@/lib/graph-command/types";
import { classifyIntentFamily } from "@/lib/rule-engine/classify-intent-family";
import {
  parseNlIntentChain,
  shouldRunMultiIntentPlanner,
} from "@/lib/action-planner/parse-nl-intent-chain";
import { composeActionPlanFromAtoms } from "@/lib/action-planner/compose-action-plan-from-atoms";
import {
  buildTripPrepActionPlan,
  isTripPrepUtterance,
} from "@/lib/action-planner/build-trip-prep-plan";
import {
  resolveLookupToolId,
  resolveToolIdForIntent,
  type PlannerLookupDomain,
} from "@/lib/rule-engine/resolve-tool-id";
import { routeToolFamily } from "@/lib/rule-engine/route-tool-family";
import { hasEateryDomainCue } from "@/lib/globe/domain-cues/eatery-domain-cues";
import { hasLodgingDomainCue } from "@/lib/globe/domain-cues/lodging-domain-cues";
import { isSameProjectReSearchUtterance } from "@/lib/graph-command/is-same-project-re-search";

function normalize(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

function extractComparePair(
  text: string,
): { left: string; right: string } | null {
  const m =
    text.match(
      /(.+?)\s*(?:이랑|랑|와|과|하고)\s*(.+?)\s*(?:비교|compare)/iu,
    ) ?? null;
  if (!m?.[1]?.trim() || !m?.[2]?.trim()) {
    return null;
  }
  const left = m[1].trim().replace(/(?:을|를|이|가)$/u, "");
  const right = m[2]
    .trim()
    .replace(
      /(?:을|를|이|가)?\s*(?:비교(?:해|해서|하고|한\s*뒤|한\s*다음|해서)?).*$/iu,
      "",
    )
    .replace(/(?:을|를|이|가)$/u, "")
    .trim();
  if (!left || !right || left.length > 40 || right.length > 40) {
    return null;
  }
  return { left, right };
}

function wantsReserve(text: string): boolean {
  return /예약\s*준비|예약해|예매|첫\s*(?:번\s*)?째\s*예약|reserve|booking/iu.test(
    text,
  );
}

function wantsCompare(text: string): boolean {
  return /비교|compare|vs/iu.test(text);
}

function wantsSearch(text: string): boolean {
  return /(?:찾|추천|보여|검색|lookup|search|찾아)/iu.test(text);
}

function wantsRevise(text: string): boolean {
  return (
    /(?:바꾸|늘리|줄이|수정|변경|rev(?:ise)?)/iu.test(text) ||
    /(?:박|일)\s*(?:으로|로)\s*(?:바꾸|해)|인원|명\s*(?:으로|로)/iu.test(text)
  );
}

function wantsReSearch(text: string): boolean {
  return (
    isSameProjectReSearchUtterance(text) ||
    /다시\s*(?:찾|검색|보여)|재검색|다시\s*골라/iu.test(text)
  );
}

function wantsPurchase(text: string): boolean {
  return /결제|구매|purchase|pay/iu.test(text);
}

function wantsMove(text: string): boolean {
  return /맥락으로\s*옮겨|옮겨(?:줘|요|주세요)?|여기로\s*옮겨/iu.test(text);
}

function wantsShare(text: string): boolean {
  return /공유해|공유\s*하자|share|카톡으로|링크로\s*(?:보내|공유)/iu.test(text);
}

function wantsFilter(text: string): boolean {
  return /싸게|싼\s*것만|더\s*싸게|저렴|가격\s*순|만\s*(?:남겨|남기|보여|골라)|필터|걸러|filter|reservable|예약\s*가능|현지인|평점\s*순|가까운\s*순/iu.test(
    text,
  );
}

function wantsNavigate(text: string): boolean {
  return /길\s*찾|내비|navigate|가는\s*길|가는\s*방법|지도로\s*가|길\s*알려|택시로|지하철로|도보로\s*가/iu.test(
    text,
  );
}

function resolveSearchDomain(text: string): PlannerLookupDomain {
  if (hasLodgingDomainCue(text) || /호텔|숙소|모텔|hotel|stay/iu.test(text)) {
    return "lodging";
  }
  if (hasEateryDomainCue(text) || /맛집|식당|카페|restaurant/iu.test(text)) {
    return "eatery";
  }
  if (isAmenityLookupQuery(text)) {
    return "amenity";
  }
  return "lodging";
}

function extractSearchLabel(text: string): string {
  const cleaned = text
    .replace(
      /(?:을|를|이|가)?\s*(?:찾아서|찾아|검색해서|검색해)?\s*(?:예약\s*준비|예약해).*$/iu,
      "",
    )
    .replace(/(?:찾아서|찾아줘|찾아|검색해줘|검색해)/iu, "")
    .trim();
  if (cleaned.length >= 2 && cleaned.length <= 40) {
    return cleaned;
  }
  const domain = resolveSearchDomain(text);
  if (domain === "eatery") {
    return "맛집";
  }
  if (domain === "amenity") {
    return "약국";
  }
  return "숙소";
}

export type ActionPlanKind =
  | "compare_reserve"
  | "search_reserve"
  | "revise_research"
  | "filter_reserve"
  | "search_payment"
  | "filter_navigate"
  | "compare_filter"
  | "move_share"
  | "short_tool"
  | "trip_prep";

/**
 * True when utterance needs a multi-step plan (not a single Graph Command).
 */
export function isCompoundActionUtterance(utterance: string): boolean {
  const text = normalize(utterance);
  if (!text) {
    return false;
  }
  if (isTripPrepUtterance(text)) {
    return true;
  }
  const chain = parseNlIntentChain(text);
  if (shouldRunMultiIntentPlanner(chain)) {
    return true;
  }
  if (wantsCompare(text) && wantsReserve(text)) {
    return Boolean(extractComparePair(text));
  }
  if (wantsSearch(text) && wantsReserve(text) && !wantsCompare(text)) {
    return true;
  }
  if (
    wantsSearch(text) &&
    wantsPurchase(text) &&
    !wantsReserve(text) &&
    !wantsCompare(text)
  ) {
    return true;
  }
  if (wantsRevise(text) && wantsReSearch(text)) {
    return true;
  }
  if (wantsFilter(text) && wantsReserve(text) && !wantsCompare(text) && !wantsSearch(text)) {
    return true;
  }
  if (
    wantsFilter(text) &&
    wantsNavigate(text) &&
    !wantsReserve(text) &&
    !wantsCompare(text)
  ) {
    return true;
  }
  if (wantsCompare(text) && wantsFilter(text) && !wantsReserve(text)) {
    return true;
  }
  if (wantsMove(text) && wantsShare(text)) {
    return true;
  }
  return false;
}

function newPlanShell(input: {
  utterance: string;
  contextEventId: string;
  kind: ActionPlanKind;
  requiresFieldCommit: boolean;
  steps: readonly ActionPlanStepV1[];
}): ActionPlanV1 {
  const planId = `aplan:${input.contextEventId}:${Date.now().toString(36)}`;
  return {
    version: ACTION_PLAN_VERSION,
    planId,
    contextEventId: input.contextEventId.trim(),
    utterance: input.utterance,
    steps: input.steps,
    createdAtIso: new Date().toISOString(),
    diffBundleId: `diff-bundle:${planId}`,
    planKind: input.kind,
    requiresFieldCommit: input.requiresFieldCommit,
  };
}

export function buildCompareReserveActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (!(wantsCompare(text) && wantsReserve(text))) {
    return null;
  }
  const pair = extractComparePair(text);
  if (!pair) {
    return null;
  }

  const intentFamily = classifyIntentFamily(text);
  const toolFamily = routeToolFamily(
    intentFamily === "Unknown" ? "Compare" : intentFamily,
  );
  const rankToolId =
    resolveToolIdForIntent({ intent: "Analyze", toolFamily: "ranking" }) ??
    "ranking.pick";
  const reserveToolId =
    resolveToolIdForIntent({ intent: "Reserve", toolFamily: "booking" }) ??
    "booking.prepare";

  const left = resolvePlanEntityLabel(pair.left);
  const right = resolvePlanEntityLabel(pair.right);

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:resolve:left",
      kind: "resolve_entity",
      labelKo: `${left.labelKo} 찾기`,
      status: "pending",
      entityLabelKo: left.labelKo,
      toolId: left.toolId,
      diffPhase: "working_set",
      noteKo: left.catalogHit
        ? `catalog · ${toolFamily}`
        : `lookup · ${left.toolId}`,
    },
    {
      id: "step:resolve:right",
      kind: "resolve_entity",
      labelKo: `${right.labelKo} 찾기`,
      status: "pending",
      entityLabelKo: right.labelKo,
      toolId: right.toolId,
      diffPhase: "working_set",
      noteKo: right.catalogHit
        ? `catalog · ${toolFamily}`
        : `lookup · ${right.toolId}`,
    },
    {
      id: "step:compare",
      kind: "graph_command",
      labelKo: "비교",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "compare",
        leftRef: { labelKo: left.labelKo },
        rightRef: { labelKo: right.labelKo },
      },
    },
    {
      id: "step:rank",
      kind: "tool",
      labelKo: "선호에 맞게 고르기",
      status: "pending",
      toolId: rankToolId,
      diffPhase: "working_set",
    },
    {
      id: "step:reserve_prep",
      kind: "graph_command",
      labelKo: "예약 준비",
      status: "pending",
      toolId: reserveToolId,
      diffPhase: "field_gate",
      graphCommand: {
        op: "reserve_prep",
        targetRef: { labelKo: left.labelKo },
      },
      noteKo: "고른 후보로 교체",
    },
    {
      id: "step:wait_commit",
      kind: "wait_commit",
      labelKo: "승인 요청",
      status: "pending",
      diffPhase: "field_gate",
      noteKo: "결재함에서 반영하기",
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "compare_reserve",
    requiresFieldCommit: true,
    steps,
  });
}

/** 「숙소 찾아서 예약해」→ lookup → rank → reserve_prep → wait_commit */
export function buildSearchReserveActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (!(wantsSearch(text) && wantsReserve(text)) || wantsCompare(text)) {
    return null;
  }

  const domain = resolveSearchDomain(text);
  const label = extractSearchLabel(text);
  const resolved = resolvePlanEntityLabel(label);
  const toolId =
    resolved.domain === domain
      ? resolved.toolId
      : resolveLookupToolId(domain);
  const rankToolId =
    resolveToolIdForIntent({ intent: "Analyze", toolFamily: "ranking" }) ??
    "ranking.pick";
  const reserveToolId =
    resolveToolIdForIntent({ intent: "Reserve", toolFamily: "booking" }) ??
    "booking.prepare";

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:resolve:search",
      kind: "resolve_entity",
      labelKo: `${resolved.labelKo || label} 찾기`,
      status: "pending",
      entityLabelKo: resolved.labelKo || label,
      toolId,
      diffPhase: "working_set",
      noteKo: `lookup · ${toolId}`,
    },
    {
      id: "step:rank",
      kind: "tool",
      labelKo: "가성비로 고르기",
      status: "pending",
      toolId: rankToolId,
      diffPhase: "working_set",
    },
    {
      id: "step:reserve_prep",
      kind: "graph_command",
      labelKo: "예약 준비",
      status: "pending",
      toolId: reserveToolId,
      diffPhase: "field_gate",
      graphCommand: {
        op: "reserve_prep",
        targetRef: { labelKo: resolved.labelKo || label },
      },
    },
    {
      id: "step:wait_commit",
      kind: "wait_commit",
      labelKo: "승인 요청",
      status: "pending",
      diffPhase: "field_gate",
      noteKo: "결재함에서 반영하기",
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "search_reserve",
    requiresFieldCommit: true,
    steps,
  });
}

/** 「일정 바꾸고 다시 찾아」→ same-project Tool Diff (no Field). */
export function buildReviseResearchActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (!(wantsRevise(text) && wantsReSearch(text))) {
    return null;
  }

  const domain = resolveSearchDomain(text);
  const toolId = resolveLookupToolId(domain);
  const label =
    domain === "eatery" ? "맛집" : domain === "amenity" ? "약국" : "숙소";

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:resolve:research",
      kind: "resolve_entity",
      labelKo: `같은 조건으로 ${label} 다시 찾기`,
      status: "pending",
      entityLabelKo: label,
      toolId,
      diffPhase: "working_set",
      noteKo: "open Diff stay · Tool re-search",
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "revise_research",
    requiresFieldCommit: false,
    steps,
  });
}

/** 「싸게만 남기고 첫 번째 예약」→ filter → reserve_prep → wait_commit */
export function buildFilterReserveActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (
    !(wantsFilter(text) && wantsReserve(text)) ||
    wantsCompare(text) ||
    wantsSearch(text)
  ) {
    return null;
  }

  const reserveToolId =
    resolveToolIdForIntent({ intent: "Reserve", toolFamily: "booking" }) ??
    "booking.prepare";

  const sortBy = /싸게|싼|저렴|가격/iu.test(text)
    ? ("price_asc" as const)
    : /평점/iu.test(text)
      ? ("rating_desc" as const)
      : /가까운|거리/iu.test(text)
        ? ("walk_asc" as const)
        : ("price_asc" as const);

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:filter",
      kind: "graph_command",
      labelKo: "조건으로 남기기",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "filter",
        predicate: {
          sortBy,
          ...( /만\s*(?:남겨|남기|보여)/iu.test(text)
            ? { domain: resolveSearchDomain(text) === "eatery" ? "eatery" : "lodging" }
            : {}),
        },
      },
    },
    {
      id: "step:reserve_prep",
      kind: "graph_command",
      labelKo: "첫 후보 예약 준비",
      status: "pending",
      toolId: reserveToolId,
      diffPhase: "field_gate",
      graphCommand: {
        op: "reserve_prep",
        targetRef: { labelKo: "첫 번째" },
      },
      noteKo: "필터 후 첫 보이는 후보",
    },
    {
      id: "step:wait_commit",
      kind: "wait_commit",
      labelKo: "승인 요청",
      status: "pending",
      diffPhase: "field_gate",
      noteKo: "결재함에서 반영하기",
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "filter_reserve",
    requiresFieldCommit: true,
    steps,
  });
}

/** 「숙소 찾아서 결제해」→ lookup → rank → payment_prep → wait_commit */
export function buildSearchPaymentActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (
    !(wantsSearch(text) && wantsPurchase(text)) ||
    wantsReserve(text) ||
    wantsCompare(text)
  ) {
    return null;
  }

  const domain = resolveSearchDomain(text);
  const label = extractSearchLabel(
    text.replace(/(?:결제|구매|pay).*$/iu, "").trim() || text,
  );
  const resolved = resolvePlanEntityLabel(label);
  const toolId =
    resolved.domain === domain ? resolved.toolId : resolveLookupToolId(domain);
  const rankToolId =
    resolveToolIdForIntent({ intent: "Analyze", toolFamily: "ranking" }) ??
    "ranking.pick";

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:resolve:search",
      kind: "resolve_entity",
      labelKo: `${resolved.labelKo || label} 찾기`,
      status: "pending",
      entityLabelKo: resolved.labelKo || label,
      toolId,
      diffPhase: "working_set",
      noteKo: `lookup · ${toolId}`,
    },
    {
      id: "step:rank",
      kind: "tool",
      labelKo: "가성비로 고르기",
      status: "pending",
      toolId: rankToolId,
      diffPhase: "working_set",
    },
    {
      id: "step:payment_prep",
      kind: "graph_command",
      labelKo: "결제 준비",
      status: "pending",
      diffPhase: "field_gate",
      graphCommand: {
        op: "payment_prep",
        targetRef: { labelKo: resolved.labelKo || label },
      },
    },
    {
      id: "step:wait_commit",
      kind: "wait_commit",
      labelKo: "승인 요청",
      status: "pending",
      diffPhase: "field_gate",
      noteKo: "결재함에서 반영하기",
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "search_payment",
    requiresFieldCommit: true,
    steps,
  });
}

/** 「싸게만 남기고 길 찾아」→ filter → soft navigate (no Field). */
export function buildFilterNavigateActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (
    !(wantsFilter(text) && wantsNavigate(text)) ||
    wantsReserve(text) ||
    wantsCompare(text)
  ) {
    return null;
  }

  const sortBy = /싸게|싼|저렴|가격/iu.test(text)
    ? ("price_asc" as const)
    : /평점/iu.test(text)
      ? ("rating_desc" as const)
      : /가까운|거리/iu.test(text)
        ? ("walk_asc" as const)
        : ("price_asc" as const);

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:filter",
      kind: "graph_command",
      labelKo: "조건으로 남기기",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "filter",
        predicate: { sortBy },
      },
    },
    {
      id: "step:soft_navigate",
      kind: "soft_navigate",
      labelKo: "길 열기",
      status: "pending",
      diffPhase: "working_set",
      noteKo: "첫 보이는 후보로 지도",
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "filter_navigate",
    requiresFieldCommit: false,
    steps,
  });
}

/** 「비교해서 싸게만」→ compare → filter (Globe Diff, no Field). */
export function buildCompareFilterActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (!(wantsCompare(text) && wantsFilter(text)) || wantsReserve(text)) {
    return null;
  }

  const pair = extractComparePair(text);
  const graph = input.graph ?? null;
  const visible = (graph?.nodes ?? []).filter(
    (n) =>
      n.visible &&
      (n.kind === "lodging" || n.kind === "eatery" || n.kind === "poi"),
  );
  const leftLabel = pair?.left ?? visible[0]?.labelKo ?? null;
  const rightLabel = pair?.right ?? visible[1]?.labelKo ?? null;
  if (!leftLabel || !rightLabel) {
    return null;
  }

  const sortBy = /싸게|싼|저렴|가격/iu.test(text)
    ? ("price_asc" as const)
    : /평점/iu.test(text)
      ? ("rating_desc" as const)
      : ("price_asc" as const);

  const left = resolvePlanEntityLabel(leftLabel);
  const right = resolvePlanEntityLabel(rightLabel);

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:resolve:left",
      kind: "resolve_entity",
      labelKo: `${left.labelKo} 찾기`,
      status: "pending",
      entityLabelKo: left.labelKo,
      toolId: left.toolId,
      diffPhase: "working_set",
    },
    {
      id: "step:resolve:right",
      kind: "resolve_entity",
      labelKo: `${right.labelKo} 찾기`,
      status: "pending",
      entityLabelKo: right.labelKo,
      toolId: right.toolId,
      diffPhase: "working_set",
    },
    {
      id: "step:compare",
      kind: "graph_command",
      labelKo: "비교",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "compare",
        leftRef: { labelKo: left.labelKo },
        rightRef: { labelKo: right.labelKo },
      },
    },
    {
      id: "step:filter",
      kind: "graph_command",
      labelKo: "조건으로 남기기",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "filter",
        predicate: { sortBy },
      },
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "compare_filter",
    requiresFieldCommit: false,
    steps,
  });
}

/** 「옮겨서 공유」→ move_context → share_context (soft graph). */
export function buildMoveShareActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const text = normalize(input.utterance);
  if (!(wantsMove(text) && wantsShare(text))) {
    return null;
  }

  const selected =
    input.graph?.selectionIds[0] != null
      ? input.graph.nodes.find((n) => n.id === input.graph!.selectionIds[0])
      : input.graph?.nodes.find((n) => n.visible);
  const labelKo = selected?.labelKo ?? "선택";
  const nodeId = selected?.id ?? null;

  const steps: ActionPlanStepV1[] = [
    {
      id: "step:move",
      kind: "graph_command",
      labelKo: "맥락으로 옮기기",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "move_context",
        targetRef: { labelKo, nodeId },
        toContextEventId: `ctx-folder:여행`,
        folderLabelKo: "여행",
      },
    },
    {
      id: "step:share",
      kind: "graph_command",
      labelKo: "공유 준비",
      status: "pending",
      diffPhase: "working_set",
      graphCommand: {
        op: "share_context",
        targetRef: { labelKo, nodeId },
      },
    },
  ];

  return newPlanShell({
    utterance: text,
    contextEventId: input.contextEventId,
    kind: "move_share",
    requiresFieldCommit: false,
    steps,
  });
}

/** Pick first matching compound builder. */
export function buildActionPlan(input: {
  utterance: string;
  contextEventId: string;
  graph?: SessionGraphV1 | null;
}): ActionPlanV1 | null {
  const chain = parseNlIntentChain(input.utterance);
  if (shouldRunMultiIntentPlanner(chain)) {
    const composed = composeActionPlanFromAtoms({
      utterance: input.utterance,
      contextEventId: input.contextEventId,
      atoms: chain.atoms,
      graph: input.graph,
    });
    if (composed) {
      return composed;
    }
  }
  return (
    buildTripPrepActionPlan(input) ??
    buildCompareReserveActionPlan(input) ??
    buildCompareFilterActionPlan(input) ??
    buildSearchReserveActionPlan(input) ??
    buildSearchPaymentActionPlan(input) ??
    buildFilterReserveActionPlan(input) ??
    buildFilterNavigateActionPlan(input) ??
    buildMoveShareActionPlan(input) ??
    buildReviseResearchActionPlan(input)
  );
}

export function formatActionPlanPreviewKo(plan: ActionPlanV1): string {
  const lines = plan.steps.map((step, index) => `${index + 1}. ${step.labelKo}`);
  return `이렇게 진행할게요\n${lines.join("\n")}`;
}
