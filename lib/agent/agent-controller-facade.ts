/**
 * AgentController facade for Executor — observe / replan / refine only.
 * No Action Planner Executor imports (avoids cycles).
 */

import { refinePlanStep } from "@/lib/action-planner/refine-plan-step";
import type { ActionPlanV1 } from "@/lib/action-planner/types";
import {
  createActionPlan,
  createActionPlanWithMeta,
} from "@/lib/agent/create-action-plan";
import { decideFromStepObservation } from "@/lib/agent/decision";
import type {
  AgentDecision,
  AgentHistoryTurn,
  AgentObservation,
} from "@/lib/agent/types";
import { readSessionGraph } from "@/lib/graph-command/session-graph-store";

export type AgentObserveContext = {
  readonly utterance?: string | null;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly useLlm?: boolean;
  readonly plan?: ActionPlanV1 | null;
  readonly previousObservations?: readonly AgentObservation[] | null;
  /** How many refine attempts already done in this execute loop. */
  readonly refineAttempt?: number;
};

function invalidateStepsAfter(
  plan: ActionPlanV1,
  stepId: string,
): ActionPlanV1 {
  const idx = plan.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) {
    return plan;
  }
  return {
    ...plan,
    steps: plan.steps.map((step, i) =>
      i > idx && step.status === "done"
        ? {
            ...step,
            status: "pending" as const,
            noteKo: "이전 단계 재실행으로 대기",
          }
        : step,
    ),
  };
}

async function observe(
  observation: AgentObservation,
  context: AgentObserveContext = {},
): Promise<AgentDecision> {
  return decideFromStepObservation({
    observation,
    history: context.history,
    useLlm: context.useLlm === true,
    plan: context.plan ?? null,
    utterance: context.utterance,
    refineAttempt: context.refineAttempt,
  });
}

async function replan(input: {
  readonly utterance: string;
  readonly contextEventId: string;
  readonly reason: string;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly useLlm?: boolean;
  readonly currentPlan?: ActionPlanV1 | null;
  readonly previousObservations?: readonly AgentObservation[] | null;
}): Promise<ActionPlanV1 | null> {
  return createActionPlan({
    utterance: input.utterance,
    history: input.history,
    sessionGraph: readSessionGraph(input.contextEventId),
    contextEventId: input.contextEventId,
    useLlm: input.useLlm !== false,
    replanReason: input.reason,
    currentPlan: input.currentPlan,
    previousObservations: input.previousObservations,
  });
}

/**
 * Apply Agent refine decision via refinePlanStep (search condition / tool swap).
 */
function refine(
  plan: ActionPlanV1,
  decision: Extract<AgentDecision, { type: "refine" }>,
): ActionPlanV1 | null {
  const refined = refinePlanStep({
    plan,
    stepId: decision.stepId,
    reasonKo: decision.changes?.reasonKo,
    nextToolId: decision.changes?.nextToolId,
    entityLabelKo: decision.changes?.entityLabelKo,
  });
  if (!refined) {
    return null;
  }
  return invalidateStepsAfter(refined, decision.stepId);
}

/**
 * AgentController surface used by run-action-plan Executor.
 * LLM judgment lives here / in decision.ts — not inside the Executor loop body.
 */
export const agentController = {
  observe,
  replan,
  refine,
  createActionPlanWithMeta,
} as const;
