/**
 * Planner Adapter — createActionPlan.
 * 1) LLM Planner (with confidence)
 * 2) Fallback: existing buildActionPlan (never deleted)
 */

import {
  buildActionPlan,
  formatActionPlanPreviewKo,
} from "@/lib/action-planner/build-compare-reserve-plan";
import {
  ACTION_PLAN_STEP_KINDS,
  ACTION_PLAN_VERSION,
  type ActionPlanStepKind,
  type ActionPlanStepV1,
  type ActionPlanV1,
} from "@/lib/action-planner/types";
import type { AgentHistoryTurn, AgentObservation } from "@/lib/agent/types";
import type { SessionGraphV1 } from "@/lib/graph-command/types";
import { isComposeLlmConfigured } from "@/lib/llm/compose-llm-provider";
import { callLlmTextJson } from "@/lib/llm/text-llm-client";
import { RIMVIO_TOOL_IDS, type RimvioToolId } from "@/lib/tool-registry";

const STEP_KIND_SET = new Set<string>(ACTION_PLAN_STEP_KINDS);
const TOOL_ID_SET = new Set<string>(RIMVIO_TOOL_IDS);

/** Below this confidence → use rule buildActionPlan. */
export const LLM_PLAN_CONFIDENCE_FLOOR = 0.55;

/**
 * Conversation Context for Planner — Agent Brain input (not Executor rewrite).
 */
export type AgentPlannerContext = {
  readonly utterance: string;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly sessionGraph?: SessionGraphV1 | null;
  readonly currentPlan?: ActionPlanV1 | null;
  readonly previousObservations?: readonly AgentObservation[] | null;
};

export type CreateActionPlanInput = AgentPlannerContext & {
  /** Required when sessionGraph is null. */
  readonly contextEventId?: string | null;
  readonly replanReason?: string | null;
  /** When false, skip LLM and use buildActionPlan only. */
  readonly useLlm?: boolean;
};

export type CreateActionPlanMeta = {
  readonly plan: ActionPlanV1;
  readonly source: "llm" | "rule";
  readonly confidence: number;
  readonly fallbackReason: string | null;
};

function isStepKind(value: string): value is ActionPlanStepKind {
  return STEP_KIND_SET.has(value);
}

function resolveContextEventId(input: CreateActionPlanInput): string {
  return (
    input.sessionGraph?.contextEventId?.trim() ||
    input.contextEventId?.trim() ||
    ""
  );
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function scorePlanHeuristic(plan: ActionPlanV1): number {
  if (plan.steps.length === 0) {
    return 0;
  }
  if (plan.steps.length > 8) {
    return 0.4;
  }
  const kinds = new Set(plan.steps.map((s) => s.kind));
  let score = 0.6;
  if (kinds.has("resolve_entity") || kinds.has("tool")) {
    score += 0.15;
  }
  if (plan.requiresFieldCommit && kinds.has("wait_commit")) {
    score += 0.1;
  }
  if (plan.steps.every((s) => s.labelKo.trim().length > 0)) {
    score += 0.1;
  }
  return Math.min(1, score);
}

function normalizeLlmPlan(input: {
  readonly raw: unknown;
  readonly utterance: string;
  readonly contextEventId: string;
  readonly fallback: ActionPlanV1 | null;
}): { plan: ActionPlanV1; confidence: number } | null {
  if (!input.raw || typeof input.raw !== "object") {
    return null;
  }
  const body = input.raw as {
    confidence?: unknown;
    planKind?: string;
    requiresFieldCommit?: boolean;
    steps?: Array<{
      id?: string;
      kind?: string;
      labelKo?: string;
      toolId?: string;
      entityLabelKo?: string;
      noteKo?: string;
    }>;
  };
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return null;
  }

  const steps: ActionPlanStepV1[] = [];
  for (const [index, row] of body.steps.entries()) {
    const kind = row.kind?.trim() ?? "";
    if (!isStepKind(kind)) {
      return null;
    }
    const toolId = row.toolId?.trim();
    if (toolId && !TOOL_ID_SET.has(toolId)) {
      return null;
    }
    steps.push({
      id: row.id?.trim() || `step:llm:${index}`,
      kind,
      labelKo: row.labelKo?.trim() || `단계 ${index + 1}`,
      status: "pending",
      toolId: toolId ? (toolId as RimvioToolId) : undefined,
      entityLabelKo: row.entityLabelKo?.trim() || undefined,
      noteKo: row.noteKo?.trim() || null,
      diffPhase:
        kind === "wait_commit" || kind === "graph_command"
          ? "field_gate"
          : "working_set",
    });
  }

  const fallbackKind = input.fallback?.planKind ?? "short_tool";
  const planKind = (body.planKind?.trim() ||
    fallbackKind) as ActionPlanV1["planKind"];
  const planId = `aplan:llm:${input.contextEventId}:${Date.now().toString(36)}`;
  const plan: ActionPlanV1 = {
    version: ACTION_PLAN_VERSION,
    planId,
    contextEventId: input.contextEventId,
    utterance: input.utterance,
    steps,
    createdAtIso: new Date().toISOString(),
    diffBundleId: `${planId}:diff`,
    planKind,
    requiresFieldCommit: Boolean(
      body.requiresFieldCommit ??
        input.fallback?.requiresFieldCommit ??
        steps.some((s) => s.kind === "wait_commit"),
    ),
  };

  const reported = clampConfidence(body.confidence);
  const confidence = reported ?? scorePlanHeuristic(plan);
  return { plan, confidence };
}

function sessionGraphHint(graph: SessionGraphV1 | null | undefined): string {
  if (!graph) {
    return "SessionGraph: none";
  }
  const visible = graph.nodes.filter((n) => n.visible).slice(0, 8);
  return JSON.stringify({
    contextEventId: graph.contextEventId,
    selectionIds: graph.selectionIds,
    visible: visible.map((n) => ({
      id: n.id,
      labelKo: n.labelKo,
      kind: n.kind,
      pinned: n.pinned,
    })),
    anchor: { lat: graph.anchorLat, lng: graph.anchorLng },
  });
}

function formatCurrentPlanHint(plan: ActionPlanV1 | null | undefined): string {
  if (!plan) {
    return "CurrentPlan: none";
  }
  return `CurrentPlan:\n${formatActionPlanPreviewKo(plan)}\n${JSON.stringify({
    planId: plan.planId,
    planKind: plan.planKind,
    requiresFieldCommit: plan.requiresFieldCommit,
    steps: plan.steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      labelKo: s.labelKo,
      toolId: s.toolId,
      entityLabelKo: s.entityLabelKo,
      noteKo: s.noteKo,
    })),
  })}`;
}

function formatPreviousObservationsHint(
  observations: readonly AgentObservation[] | null | undefined,
): string {
  if (!observations?.length) {
    return "PreviousObservations: none";
  }
  const slim = observations.slice(-8).map((o) => ({
    stepId: o.stepId,
    stepKind: o.stepKind,
    success: o.success,
    summaryKo: o.summaryKo,
    errors: o.errors,
    candidateCount: Array.isArray(o.candidates) ? o.candidates.length : null,
  }));
  return `PreviousObservations:\n${JSON.stringify(slim)}`;
}

async function callLlmPlanner(input: {
  readonly utterance: string;
  readonly contextEventId: string;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly sessionGraph?: SessionGraphV1 | null;
  readonly currentPlan?: ActionPlanV1 | null;
  readonly previousObservations?: readonly AgentObservation[] | null;
  readonly rulePlan: ActionPlanV1 | null;
  readonly replanReason?: string | null;
}): Promise<{ plan: ActionPlanV1; confidence: number } | null> {
  if (!isComposeLlmConfigured()) {
    return null;
  }

  const historyBlock =
    input.history
      ?.slice(-8)
      .map((t) => `${t.role}: ${t.content}`)
      .join("\n") ?? "";
  const seedPlan = input.currentPlan ?? input.rulePlan;
  const ruleHint = seedPlan
    ? `Rule/current plan seed:\n${formatActionPlanPreviewKo(seedPlan)}\n${JSON.stringify(
        {
          planKind: seedPlan.planKind,
          requiresFieldCommit: seedPlan.requiresFieldCommit,
          steps: seedPlan.steps.map((s) => ({
            id: s.id,
            kind: s.kind,
            labelKo: s.labelKo,
            toolId: s.toolId,
            entityLabelKo: s.entityLabelKo,
            status: s.status,
          })),
        },
      )}`
    : "No rule plan.";

  const raw = await callLlmTextJson({
    systemPrompt: [
      "You plan travel actions for Rimvio ActionPlanV1.",
      "Return JSON: { confidence:0..1, planKind, requiresFieldCommit, steps:[{id,kind,labelKo,toolId?,entityLabelKo?,noteKo?}] }.",
      "confidence: how sure you are this plan matches the user goal (0-1).",
      `kinds: ${ACTION_PLAN_STEP_KINDS.join("|")}.`,
      `toolIds: ${RIMVIO_TOOL_IDS.join("|")}.`,
      "Typical search→reserve: resolve_entity(hotel.lookup) → tool(ranking.pick) → wait_commit.",
      "trip_prep: destination+nights travel prepare → lodging lookup → rank → reserve_prep → wait_commit.",
      "Use Conversation Context (history, sessionGraph, currentPlan, previousObservations).",
      "If previousObservations show empty lookup, widen entityLabelKo — do not invent Reality Commit.",
      "Prefer the rule/current plan structure when it already fits. Keep steps short (≤6).",
      "booking.prepare is prepare-only — end with wait_commit when reserve is needed.",
    ].join(" "),
    userText: [
      historyBlock ? `History:\n${historyBlock}` : null,
      `Utterance:\n${input.utterance}`,
      input.replanReason?.trim()
        ? `ReplanReason:\n${input.replanReason.trim()}`
        : null,
      sessionGraphHint(input.sessionGraph),
      formatCurrentPlanHint(input.currentPlan),
      formatPreviousObservationsHint(input.previousObservations),
      ruleHint,
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.1,
  });

  if (!raw) {
    return null;
  }
  try {
    return normalizeLlmPlan({
      raw: JSON.parse(raw) as unknown,
      utterance: input.utterance,
      contextEventId: input.contextEventId,
      fallback: seedPlan,
    });
  } catch {
    return null;
  }
}

/**
 * Planner Adapter with metadata (source / confidence / fallback reason).
 */
export async function createActionPlanWithMeta(
  input: CreateActionPlanInput,
): Promise<CreateActionPlanMeta | null> {
  const utterance = input.utterance.trim();
  const contextEventId = resolveContextEventId(input);
  if (!utterance || !contextEventId) {
    return null;
  }

  const enrichedUtterance = input.replanReason?.trim()
    ? `${utterance}\n(replan: ${input.replanReason.trim()})`
    : utterance;

  const rulePlan = buildActionPlan({
    utterance: enrichedUtterance,
    contextEventId,
    graph: input.sessionGraph ?? null,
  });

  if (input.useLlm === false) {
    if (rulePlan) {
      return {
        plan: rulePlan,
        source: "rule",
        confidence: 1,
        fallbackReason: "useLlm=false",
      };
    }
    if (input.currentPlan) {
      return {
        plan: {
          ...input.currentPlan,
          contextEventId,
          utterance,
        },
        source: "rule",
        confidence: 0.5,
        fallbackReason: "useLlm=false_keep_current_plan",
      };
    }
    return null;
  }

  const llm = await callLlmPlanner({
    utterance: enrichedUtterance,
    contextEventId,
    history: input.history,
    sessionGraph: input.sessionGraph,
    currentPlan: input.currentPlan,
    previousObservations: input.previousObservations,
    rulePlan,
    replanReason: input.replanReason,
  });

  if (llm && llm.confidence >= LLM_PLAN_CONFIDENCE_FLOOR) {
    return {
      plan: llm.plan,
      source: "llm",
      confidence: llm.confidence,
      fallbackReason: null,
    };
  }

  // Prefer repairing currentPlan via rule rebuild; keep ActionPlanV1.
  if (!rulePlan && input.currentPlan) {
    return {
      plan: {
        ...input.currentPlan,
        contextEventId,
        utterance,
      },
      source: "rule",
      confidence: llm?.confidence ?? 0.5,
      fallbackReason: "keep_current_plan",
    };
  }

  if (!rulePlan) {
    return null;
  }

  const fallbackReason = !llm
    ? "llm_unavailable_or_invalid"
    : `llm_confidence_low:${llm.confidence.toFixed(2)}`;

  return {
    plan: rulePlan,
    source: "rule",
    confidence: llm?.confidence ?? 1,
    fallbackReason,
  };
}

/**
 * createActionPlan — primary Planner Adapter entry.
 * LLM first; on failure / low confidence → buildActionPlan.
 */
export async function createActionPlan(
  input: CreateActionPlanInput,
): Promise<ActionPlanV1 | null> {
  const meta = await createActionPlanWithMeta(input);
  return meta?.plan ?? null;
}
