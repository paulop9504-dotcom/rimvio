/**
 * Planner Layer — thin wrappers over createActionPlan adapter.
 * buildActionPlan remains the rule fallback (not deleted).
 */

import {
  createActionPlanWithMeta,
  type CreateActionPlanMeta,
} from "@/lib/agent/create-action-plan";
import type { ActionPlanV1 } from "@/lib/action-planner/types";
import type {
  AgentHistoryTurn,
  AgentObservation,
} from "@/lib/agent/types";
import { readSessionGraph } from "@/lib/graph-command/session-graph-store";

export type PlanActionResult = {
  readonly plan: CreateActionPlanMeta["plan"];
  readonly source: CreateActionPlanMeta["source"];
  readonly confidence: number;
  readonly fallbackReason: string | null;
};

/**
 * @deprecated Prefer createActionPlan / createActionPlanWithMeta.
 * Kept for Agent Controller compatibility.
 */
export async function planAction(input: {
  readonly utterance: string;
  readonly contextEventId: string;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly currentPlan?: ActionPlanV1 | null;
  readonly previousObservations?: readonly AgentObservation[] | null;
  readonly useLlm?: boolean;
  readonly replanReason?: string | null;
}): Promise<PlanActionResult | null> {
  const contextEventId = input.contextEventId.trim();
  const utterance = input.utterance.trim();
  if (!contextEventId || !utterance) {
    return null;
  }

  const meta = await createActionPlanWithMeta({
    utterance,
    history: input.history,
    sessionGraph: readSessionGraph(contextEventId),
    contextEventId,
    useLlm: input.useLlm,
    replanReason: input.replanReason,
    currentPlan: input.currentPlan,
    previousObservations: input.previousObservations,
  });
  if (!meta) {
    return null;
  }
  return {
    plan: meta.plan,
    source: meta.source,
    confidence: meta.confidence,
    fallbackReason: meta.fallbackReason,
  };
}

export {
  createActionPlan,
  createActionPlanWithMeta,
  LLM_PLAN_CONFIDENCE_FLOOR,
  type AgentPlannerContext,
  type CreateActionPlanInput,
  type CreateActionPlanMeta,
} from "@/lib/agent/create-action-plan";
