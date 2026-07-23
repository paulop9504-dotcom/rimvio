/**
 * Action Planner types — compound NL → ordered Plan (Cursor-like).
 * Soft graph steps apply as one Diff bundle; Field gate stays separate.
 * Never auto-Commits Reality.
 */

import type { GraphCommand } from "@/lib/graph-command/types";
import type { RimvioToolId } from "@/lib/tool-registry";

export const ACTION_PLAN_VERSION = 1 as const;

export const ACTION_PLAN_STEP_KINDS = [
  "resolve_entity",
  "graph_command",
  "tool",
  "soft_navigate",
  "wait_commit",
] as const;

export type ActionPlanStepKind = (typeof ACTION_PLAN_STEP_KINDS)[number];

export type ActionPlanStepStatus =
  | "pending"
  | "done"
  | "blocked"
  | "skipped";

/**
 * working_set — soft Graph IR (pins · compare); flush as one Diff apply.
 * field_gate — Reserve prepare / wait_commit; Field Commit only.
 */
export type ActionPlanDiffPhase = "working_set" | "field_gate";

export type ActionPlanStepV1 = {
  readonly id: string;
  readonly kind: ActionPlanStepKind;
  readonly labelKo: string;
  readonly status: ActionPlanStepStatus;
  readonly graphCommand?: GraphCommand;
  readonly toolId?: RimvioToolId;
  readonly entityLabelKo?: string;
  readonly noteKo?: string | null;
  /** Which Diff surface this step belongs to (Cursor multi-edit). */
  readonly diffPhase?: ActionPlanDiffPhase;
};

export type ActionPlanV1 = {
  readonly version: typeof ACTION_PLAN_VERSION;
  readonly planId: string;
  readonly contextEventId: string;
  readonly utterance: string;
  readonly steps: readonly ActionPlanStepV1[];
  readonly createdAtIso: string;
  /** Shared id for one working-set Diff (pins + compare). */
  readonly diffBundleId: string;
  /** Which compound builder produced this plan. */
  readonly planKind:
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
  /** Reserve/Purchase prepare → Field; revise-research stays Globe Diff only. */
  readonly requiresFieldCommit: boolean;
  /** Present when planKind === trip_prep (stay slots for lodging tools). */
  readonly tripPrep?: {
    readonly destinationKo: string | null;
    readonly nights: number | null;
    readonly days: number | null;
    readonly checkInIso: string | null;
    readonly checkOutIso: string | null;
  } | null;
};

export type ActionPlannerRunResult = {
  readonly ok: true;
  readonly plan: ActionPlanV1;
  readonly assistantReplyKo: string;
  readonly reservedOpIds: readonly string[];
  readonly pickedLabelKo: string | null;
  readonly waitingCommit: boolean;
  /** Soft graph ops applied in one `applyGraphCommands` call. */
  readonly diffBundleApplied: boolean;
  readonly diffCommandCount: number;
  /** Set when AgentController halted mid-plan. */
  readonly agentHalt?: "ask_user" | "stop" | null;
};
