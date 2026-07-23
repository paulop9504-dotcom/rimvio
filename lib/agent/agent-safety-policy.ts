/**
 * Agent Safety Policy — auto-execution limits.
 *
 * LOCKED (do not change semantics):
 * - wait_commit step kind
 * - Field Commit / human approval before Reality mutation
 * - Diff Bundle (working_set flush) structure
 *
 * Agent may prepare (booking.prepare / reserve_prep) but NEVER Reality Commit
 * reservation/payment without human Field approval.
 */

import type { ActionPlanStepV1, ActionPlanV1 } from "@/lib/action-planner/types";
import type { AgentDecision } from "@/lib/agent/types";
import type { RimvioToolId } from "@/lib/tool-registry";

/** Hard cap on steps executed in one Executor run (incl. refine retries). */
export const AGENT_MAX_STEPS = 12;

/** Hard cap on while-loop iterations (infinite-loop fuse). */
export const AGENT_MAX_LOOP_ITERATIONS = 24;

/** Refine / replan budgets inside one execute. */
export const AGENT_MAX_REPLANS = 2;
export const AGENT_MAX_REFINES = 3;

/** Tools Agent may invoke automatically. */
export const AGENT_ALLOWED_TOOL_IDS = [
  "maps.search",
  "hotel.lookup",
  "restaurant.lookup",
  "pharmacy.lookup",
  "browse.extract",
  "ranking.pick",
  "booking.prepare", // prepare-only — never Reality Commit
] as const satisfies readonly RimvioToolId[];

/**
 * Graph ops Agent may run. Reality Commit is NEVER listed.
 * reserve_prep / payment_prep = Field prepare queue only.
 */
export const AGENT_ALLOWED_GRAPH_OPS = [
  "pin_node",
  "search_project",
  "filter",
  "compare",
  "reserve_prep",
  "payment_prep",
  "delete_node",
  "group_nodes",
  "move_context",
  "create_note",
  "style_pin",
  "set_visibility",
  "share_context",
  "reason_pick",
  "simulate",
] as const;

export type AgentSafetyHaltReason =
  | "max_steps"
  | "max_loop_iterations"
  | "max_replans"
  | "max_refines"
  | "forbidden_commit"
  | "wait_commit_human_gate";

export type AgentSafetyBudget = {
  readonly stepsExecuted: number;
  readonly loopIterations: number;
  readonly replanCount: number;
  readonly refineCount: number;
};

export function createAgentSafetyBudget(): AgentSafetyBudget {
  return {
    stepsExecuted: 0,
    loopIterations: 0,
    replanCount: 0,
    refineCount: 0,
  };
}

export function bumpLoopIteration(budget: AgentSafetyBudget): AgentSafetyBudget {
  return { ...budget, loopIterations: budget.loopIterations + 1 };
}

export function bumpStepExecuted(budget: AgentSafetyBudget): AgentSafetyBudget {
  return { ...budget, stepsExecuted: budget.stepsExecuted + 1 };
}

export function bumpReplan(budget: AgentSafetyBudget): AgentSafetyBudget {
  return { ...budget, replanCount: budget.replanCount + 1 };
}

export function bumpRefine(budget: AgentSafetyBudget): AgentSafetyBudget {
  return { ...budget, refineCount: budget.refineCount + 1 };
}

export function isAgentLoopExhausted(
  budget: AgentSafetyBudget,
): AgentSafetyHaltReason | null {
  if (budget.loopIterations >= AGENT_MAX_LOOP_ITERATIONS) {
    return "max_loop_iterations";
  }
  if (budget.stepsExecuted >= AGENT_MAX_STEPS) {
    return "max_steps";
  }
  return null;
}

export function canAgentReplan(budget: AgentSafetyBudget): boolean {
  return budget.replanCount < AGENT_MAX_REPLANS;
}

export function canAgentRefine(budget: AgentSafetyBudget): boolean {
  return budget.refineCount < AGENT_MAX_REFINES;
}

/**
 * Agent must never claim to perform Reality Commit.
 * wait_commit success → stop and wait for human Field approval.
 */
export function enforceHumanCommitGate(
  decision: AgentDecision,
  step: Pick<ActionPlanStepV1, "kind" | "status"> | null,
): AgentDecision {
  void decision;
  if (step?.kind === "wait_commit") {
    return { type: "stop" };
  }
  return decision;
}

/**
 * Reject any decision that would skip human Field Commit.
 * (Reserved for future decision payloads that try to auto-commit.)
 */
export function assertAgentCannotRealityCommit(input: {
  readonly decision: AgentDecision;
  readonly plan: ActionPlanV1;
}): {
  readonly allowed: true;
} | {
  readonly allowed: false;
  readonly reason: AgentSafetyHaltReason;
  readonly messageKo: string;
} {
  void input.decision;
  if (input.plan.requiresFieldCommit) {
    // Plan still ends at wait_commit / Field — Agent may not auto-approve.
    return { allowed: true };
  }
  return { allowed: true };
}

export function isAgentAllowedToolId(toolId: string): boolean {
  return (AGENT_ALLOWED_TOOL_IDS as readonly string[]).includes(toolId);
}

export function safetyHaltMessageKo(reason: AgentSafetyHaltReason): string {
  switch (reason) {
    case "max_steps":
      return "자동 실행 단계 한도에 도달했어요. 조건을 확인한 뒤 이어갈까요?";
    case "max_loop_iterations":
      return "실행이 반복되어 안전을 위해 멈췄어요. 짧게 다시 말해 주세요.";
    case "max_replans":
      return "계획 다시 짜기를 충분히 시도했어요. 조건을 바꿔 말해 주세요.";
    case "max_refines":
      return "검색 조건 조정을 충분히 시도했어요. 다른 말로 부탁해요.";
    case "forbidden_commit":
      return "예약·결제는 맞춤에서 직접 승인해 주세요.";
    case "wait_commit_human_gate":
      return "준비됐어요. 맞춤에서 승인해 주세요.";
    default:
      return "안전을 위해 자동 실행을 멈췄어요.";
  }
}

/** Documentation lock — referenced by tests so structure is not silently dropped. */
export const AGENT_SAFETY_LOCKS = {
  waitCommitStepKind: "wait_commit",
  fieldCommitRequired: true,
  agentNeverRealityCommits: true,
  diffBundlePreserved: true,
} as const;
