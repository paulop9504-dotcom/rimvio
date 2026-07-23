/**
 * Observation Layer — normalize tool/plan results for LLM.
 * Never pass raw ToolInvokeResult into prompts.
 */

import type {
  ActionPlannerRunResult,
  ActionPlanStepV1,
  ActionPlanV1,
} from "@/lib/action-planner/types";
import type {
  AgentObservation,
  AgentObservationCandidate,
  AgentRunObservation,
} from "@/lib/agent/types";
import { readSessionGraph } from "@/lib/graph-command/session-graph-store";
import type { ToolInvokeResult } from "@/lib/tool-registry";

const MAX_CANDIDATES_FOR_LLM = 5;

function candidateCountFromNote(noteKo: string | null | undefined): number | null {
  const note = noteKo?.trim() ?? "";
  if (!note) {
    return null;
  }
  const m = note.match(/(\d+)\s*곳/);
  if (m?.[1]) {
    return Number(m[1]);
  }
  if (/고를 후보가 없어요|후보가 없|찾지 못|0곳/u.test(note)) {
    return 0;
  }
  return null;
}

/** Strip ToolInvokeResult down to LLM-safe candidate cards. */
export function normalizeCandidatesForObservation(
  candidates: ToolInvokeResult["candidates"] | null | undefined,
  limit = MAX_CANDIDATES_FOR_LLM,
): AgentObservationCandidate[] {
  if (!candidates?.length) {
    return [];
  }
  return candidates.slice(0, limit).map((row) => ({
    id: row.id,
    labelKo: row.labelKo,
    rating: row.rating ?? null,
    priceKrw: row.priceKrw ?? null,
    amountLabel: row.amountLabel ?? null,
    walkMinutes: row.walkMinutes ?? null,
  }));
}

function buildSessionState(contextEventId: string): unknown {
  const graph = readSessionGraph(contextEventId);
  if (!graph) {
    return { visibleCount: 0, selectionIds: [], pinnedLabels: [] };
  }
  const visible = graph.nodes.filter((n) => n.visible);
  return {
    visibleCount: visible.length,
    selectionIds: [...graph.selectionIds],
    pinnedLabels: visible.filter((n) => n.pinned).map((n) => n.labelKo).slice(0, 6),
  };
}

function buildDiffState(run: ActionPlannerRunResult): unknown {
  return {
    waitingCommit: run.waitingCommit,
    diffBundleApplied: run.diffBundleApplied,
    diffCommandCount: run.diffCommandCount,
    reservedOpCount: run.reservedOpIds.length,
    pickedLabelKo: run.pickedLabelKo,
  };
}

/**
 * Normalize a single ToolInvokeResult into AgentObservation fields
 * (candidates/selected/summary/errors) — never embed the raw result.
 */
export function normalizeToolInvokeResult(input: {
  readonly planId: string;
  readonly stepId: string;
  readonly stepKind: string;
  readonly tool: ToolInvokeResult;
  readonly sessionState?: unknown;
  readonly diffState?: unknown;
}): AgentObservation {
  const candidates = normalizeCandidatesForObservation(input.tool.candidates);
  const errors: string[] = [];
  if (
    candidates.length === 0 &&
    (input.stepKind === "resolve_entity" ||
      input.tool.toolId.includes("lookup") ||
      input.tool.toolId === "maps.search" ||
      input.tool.toolId === "browse.extract")
  ) {
    errors.push("empty_candidates");
  }
  const selected =
    input.tool.pickedId || input.tool.pickedLabelKo
      ? {
          id: input.tool.pickedId ?? null,
          labelKo: input.tool.pickedLabelKo ?? null,
        }
      : undefined;

  return {
    planId: input.planId,
    stepId: input.stepId,
    stepKind: input.stepKind,
    success: errors.length === 0,
    summaryKo: input.tool.summaryKo,
    ...(candidates.length > 0 ? { candidates } : {}),
    ...(selected ? { selected } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(input.sessionState !== undefined
      ? { sessionState: input.sessionState }
      : {}),
    ...(input.diffState !== undefined ? { diffState: input.diffState } : {}),
  };
}

function stepSuccess(step: ActionPlanStepV1): boolean {
  return step.status === "done";
}

function stepErrors(step: ActionPlanStepV1): string[] {
  const errors: string[] = [];
  if (step.status === "blocked") {
    errors.push("step_blocked");
  }
  if (step.status === "skipped") {
    errors.push("step_skipped");
  }
  const count = candidateCountFromNote(step.noteKo);
  if (
    count === 0 ||
    /0곳|후보가 없|찾지 못|고를 후보가 없어요|reserve prep failed|navigate miss/u.test(
      step.noteKo ?? "",
    )
  ) {
    errors.push("empty_or_failed");
  }
  return errors;
}

/**
 * createObservation — Executor-facing alias.
 * Never pass raw ToolInvokeResult to the LLM; always normalize first.
 */
export function createObservation(input: {
  readonly plan: ActionPlanV1;
  readonly step: ActionPlanStepV1;
  readonly tool?: ToolInvokeResult | null;
  readonly reservedOpIds?: readonly string[];
  readonly pickedLabelKo?: string | null;
  readonly diffBundleApplied?: boolean;
  readonly diffCommandCount?: number;
  readonly includeSession?: boolean;
}): AgentObservation {
  const run: ActionPlannerRunResult = {
    ok: true,
    plan: input.plan,
    assistantReplyKo: "",
    reservedOpIds: [...(input.reservedOpIds ?? [])],
    pickedLabelKo: input.pickedLabelKo ?? null,
    waitingCommit: false,
    diffBundleApplied: input.diffBundleApplied ?? false,
    diffCommandCount: input.diffCommandCount ?? 0,
  };
  return buildStepObservation({
    plan: input.plan,
    step: input.step,
    run,
    tool: input.tool,
    includeSession: input.includeSession !== false,
  });
}

/**
 * Build one normalized Observation from a finished plan step (+ optional tool).
 */
export function buildStepObservation(input: {
  readonly plan: ActionPlanV1;
  readonly step: ActionPlanStepV1;
  readonly run: ActionPlannerRunResult;
  readonly tool?: ToolInvokeResult | null;
  readonly includeSession?: boolean;
}): AgentObservation {
  const sessionState = input.includeSession
    ? buildSessionState(input.plan.contextEventId)
    : undefined;
  const diffState = buildDiffState(input.run);

  if (input.tool) {
    return normalizeToolInvokeResult({
      planId: input.plan.planId,
      stepId: input.step.id,
      stepKind: input.step.kind,
      tool: input.tool,
      sessionState,
      diffState,
    });
  }

  const errors = stepErrors(input.step);
  const count = candidateCountFromNote(input.step.noteKo);
  const selected =
    input.run.pickedLabelKo && input.step.toolId === "ranking.pick"
      ? { labelKo: input.run.pickedLabelKo }
      : undefined;

  return {
    planId: input.plan.planId,
    stepId: input.step.id,
    stepKind: input.step.kind,
    success: stepSuccess(input.step) && errors.length === 0,
    summaryKo: input.step.noteKo?.trim() || input.step.labelKo,
    ...(count === 0 ? { candidates: [] as const } : {}),
    ...(count != null && count > 0
      ? {
          candidates: [
            {
              id: "summary:count",
              labelKo: `${count}곳 후보`,
              rating: null,
            } satisfies AgentObservationCandidate,
          ],
        }
      : {}),
    ...(selected ? { selected } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(sessionState !== undefined ? { sessionState } : {}),
    diffState,
  };
}

/**
 * Build run Observation bundle from executor result.
 * Step Observations are normalized — raw ToolInvokeResult is never attached.
 */
export function buildAgentObservation(input: {
  readonly plan: ActionPlanV1;
  readonly run: ActionPlannerRunResult;
  readonly iteration: number;
}): AgentRunObservation {
  const observations = input.plan.steps.map((step, index) =>
    buildStepObservation({
      plan: input.plan,
      step,
      run: input.run,
      includeSession: index === input.plan.steps.length - 1,
    }),
  );

  const blockedStepIds = input.plan.steps
    .filter((s) => s.status === "blocked")
    .map((s) => s.id);
  const pendingStepIds = input.plan.steps
    .filter((s) => s.status === "pending")
    .map((s) => s.id);
  const emptyLookup = observations.some(
    (obs) =>
      obs.stepKind === "resolve_entity" &&
      (obs.errors?.includes("empty_or_failed") ||
        obs.errors?.includes("empty_candidates") ||
        (Array.isArray(obs.candidates) && obs.candidates.length === 0)),
  );

  return {
    planId: input.plan.planId,
    planKind: input.plan.planKind,
    utterance: input.plan.utterance,
    iteration: input.iteration,
    waitingCommit: input.run.waitingCommit,
    requiresFieldCommit: input.plan.requiresFieldCommit,
    reservedOpCount: input.run.reservedOpIds.length,
    assistantReplyKo: input.run.assistantReplyKo,
    observations,
    blockedStepIds,
    pendingStepIds,
    emptyLookup,
    pickedLabelKo: input.run.pickedLabelKo,
  };
}

/** Compact JSON for LLM — step Observations only (no ToolInvokeResult). */
export function formatObservationForLlm(
  obs: AgentRunObservation | AgentObservation | readonly AgentObservation[],
): string {
  if (Array.isArray(obs)) {
    return JSON.stringify(obs, null, 0);
  }
  if ("observations" in obs) {
    const run = obs as AgentRunObservation;
    return JSON.stringify(
      {
        planId: run.planId,
        planKind: run.planKind,
        iteration: run.iteration,
        waitingCommit: run.waitingCommit,
        emptyLookup: run.emptyLookup,
        blockedStepIds: run.blockedStepIds,
        pendingStepIds: run.pendingStepIds,
        pickedLabelKo: run.pickedLabelKo,
        observations: run.observations,
      },
      null,
      0,
    );
  }
  return JSON.stringify(obs, null, 0);
}
