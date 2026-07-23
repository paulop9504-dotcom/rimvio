/**
 * STEP6 — refine/retry a single plan step when intent drifts or lookup is empty.
 * Does not replan the whole chain.
 */

import type { ActionPlanStepV1, ActionPlanV1 } from "@/lib/action-planner/types";
import type { RimvioToolId } from "@/lib/tool-registry";
import { getRimvioTool } from "@/lib/tool-registry";

function patchStep(
  steps: readonly ActionPlanStepV1[],
  stepId: string,
  patch: Partial<ActionPlanStepV1>,
): ActionPlanStepV1[] {
  return steps.map((step) =>
    step.id === stepId ? { ...step, ...patch } : step,
  );
}

export type RefinePlanStepInput = {
  readonly plan: ActionPlanV1;
  readonly stepId: string;
  readonly reasonKo?: string | null;
  readonly nextToolId?: RimvioToolId | null;
  /** Broaden / rewrite search entity (hotel.search empty → change query). */
  readonly entityLabelKo?: string | null;
};

/**
 * Reset one step to pending (optionally swap ToolId / search label).
 * Later done steps are left as-is — caller may invalidate trailing steps.
 */
export function refinePlanStep(input: RefinePlanStepInput): ActionPlanV1 | null {
  const stepId = input.stepId.trim();
  if (!stepId) {
    return null;
  }
  const target = input.plan.steps.find((step) => step.id === stepId);
  if (!target) {
    return null;
  }

  const nextToolId = input.nextToolId ?? target.toolId;
  const nextEntity =
    input.entityLabelKo?.trim() || target.entityLabelKo || undefined;
  const toolLabel = nextToolId
    ? (getRimvioTool(nextToolId)?.labelKo ?? null)
    : null;
  const labelKo = nextEntity
    ? `${nextEntity} 찾기`
    : (toolLabel ?? target.labelKo);

  return {
    ...input.plan,
    steps: patchStep(input.plan.steps, stepId, {
      status: "pending",
      toolId: nextToolId,
      labelKo,
      entityLabelKo: nextEntity,
      noteKo: input.reasonKo?.trim() || "검색 조건을 바꿔 다시 찾을게요",
    }),
  };
}

/** True when a step failed / blocked / empty lookup and should be refined. */
export function shouldRefinePlanStep(
  step: ActionPlanStepV1 | null | undefined,
): boolean {
  if (!step) {
    return false;
  }
  if (step.status === "blocked") {
    return true;
  }
  if (
    step.status === "done" &&
    /0곳|후보가 없|찾지 못|고를 후보가 없어요/u.test(step.noteKo ?? "")
  ) {
    return true;
  }
  return false;
}

/**
 * Suggest search-condition changes when lookup returns empty.
 * Used by Agent decision → refinePlanStep (not full replan).
 */
export function suggestEmptyLookupRefine(input: {
  readonly utterance: string;
  readonly currentEntityLabelKo?: string | null;
  readonly currentToolId?: RimvioToolId | string | null;
  readonly attempt?: number;
}): {
  readonly entityLabelKo: string;
  readonly nextToolId?: RimvioToolId | null;
  readonly reasonKo: string;
} {
  const utterance = input.utterance.trim();
  const current = input.currentEntityLabelKo?.trim() || "호텔";
  const attempt = Math.max(0, input.attempt ?? 0);
  const place =
    utterance.match(
      /(오사카|도쿄|교토|후쿠오카|삿포로|나고야|오키나와|부산|서울|제주|osaka|tokyo|kyoto)/iu,
    )?.[1] ?? null;

  if (attempt === 0) {
    const widened =
      place && !current.includes(place) ? `${place} ${current}` : `${current} 추천`;
    return {
      entityLabelKo: widened.trim(),
      reasonKo: `결과 없음 · 검색어를 「${widened.trim()}」로 넓혀 다시 찾습니다`,
    };
  }

  if (attempt === 1) {
    const toolId = input.currentToolId;
    if (toolId === "hotel.lookup") {
      return {
        entityLabelKo: place ? `${place} 숙소` : "숙소",
        nextToolId: "maps.search",
        reasonKo: "결과 없음 · 지도 검색으로 조건을 바꿉니다",
      };
    }
    if (toolId === "restaurant.lookup") {
      return {
        entityLabelKo: place ? `${place} 맛집` : "맛집",
        nextToolId: "maps.search",
        reasonKo: "결과 없음 · 지도 검색으로 조건을 바꿉니다",
      };
    }
    return {
      entityLabelKo: place ? `${place} 가볼만한 곳` : "가볼만한 곳",
      reasonKo: "결과 없음 · 더 넓은 키워드로 다시 찾습니다",
    };
  }

  return {
    entityLabelKo: place ? `${place} 인기 장소` : "인기 장소",
    nextToolId: "maps.search",
    reasonKo: "결과 없음 · 마지막 조건으로 넓혀 다시 찾습니다",
  };
}
