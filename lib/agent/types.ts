/**
 * Agent Layer types — sits above Action Planner Executor + Tool Gateway.
 * Does not replace ActionPlanV1 / invokeRimvioTool.
 */

import type {
  ActionPlannerRunResult,
  ActionPlanV1,
} from "@/lib/action-planner/types";
import type { RimvioToolId } from "@/lib/tool-registry";

export type AgentHistoryTurn = {
  readonly role: "user" | "assistant";
  readonly content: string;
};

export type AgentDecision =
  | { readonly type: "continue" }
  | { readonly type: "replan"; readonly reason: string }
  | {
      readonly type: "refine";
      readonly stepId: string;
      readonly changes?: {
        readonly nextToolId?: RimvioToolId | null;
        readonly reasonKo?: string | null;
        /** Search condition rewrite for empty hotel.search etc. */
        readonly entityLabelKo?: string | null;
      };
    }
  | { readonly type: "ask_user"; readonly message: string }
  | { readonly type: "stop" };

/**
 * Normalized step Observation for LLM — never raw ToolInvokeResult.
 */
export type AgentObservation = {
  readonly planId: string;
  readonly stepId: string;
  readonly stepKind: string;
  readonly success: boolean;
  readonly summaryKo?: string;
  readonly candidates?: readonly unknown[];
  readonly selected?: unknown;
  readonly errors?: readonly string[];
  readonly sessionState?: unknown;
  readonly diffState?: unknown;
};

/** Slim candidate card — safe for LLM prompts. */
export type AgentObservationCandidate = {
  readonly id: string;
  readonly labelKo: string;
  readonly rating?: number | null;
  readonly priceKrw?: number | null;
  readonly amountLabel?: string | null;
  readonly walkMinutes?: number | null;
};

/**
 * Run-level bundle — Controller Decision input (aggregates step Observations).
 */
export type AgentRunObservation = {
  readonly planId: string;
  readonly planKind: ActionPlanV1["planKind"];
  readonly utterance: string;
  readonly iteration: number;
  readonly waitingCommit: boolean;
  readonly requiresFieldCommit: boolean;
  readonly reservedOpCount: number;
  readonly assistantReplyKo: string;
  readonly observations: readonly AgentObservation[];
  readonly blockedStepIds: readonly string[];
  readonly pendingStepIds: readonly string[];
  readonly emptyLookup: boolean;
  readonly pickedLabelKo: string | null;
};

export type AgentControllerInput = {
  readonly utterance: string;
  readonly contextEventId: string;
  readonly anchorLat?: number | null;
  readonly anchorLng?: number | null;
  readonly contextLabelKo?: string | null;
  readonly history?: readonly AgentHistoryTurn[] | null;
  /** Resume / replan seed. */
  readonly currentPlan?: ActionPlanV1 | null;
  readonly previousObservations?: readonly AgentObservation[] | null;
  readonly maxIterations?: number;
  readonly useLlm?: boolean;
};

export type AgentControllerResult = {
  readonly ok: true;
  readonly plan: ActionPlanV1;
  readonly run: ActionPlannerRunResult;
  /** Latest step Observations (normalized). */
  readonly observations: readonly AgentObservation[];
  /** Run bundle used for the last decision. */
  readonly observation: AgentRunObservation;
  readonly decision: AgentDecision;
  readonly decisions: readonly AgentDecision[];
  readonly assistantReplyKo: string;
  readonly via: "agent_controller";
  readonly plannerSource: "llm" | "rule" | "refine" | "replan";
};

export type AgentControllerMiss = {
  readonly ok: false;
  readonly reason: "no_plan" | "not_applicable";
};
