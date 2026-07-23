/**
 * Agent Decision — rules first; optional LLM override.
 * Consumes AgentRunObservation (normalized step Observations).
 */

import { formatObservationForLlm } from "@/lib/agent/observation";
import type {
  AgentDecision,
  AgentHistoryTurn,
  AgentObservation,
  AgentRunObservation,
} from "@/lib/agent/types";
import type { ActionPlanV1 } from "@/lib/action-planner/types";
import { suggestEmptyLookupRefine } from "@/lib/action-planner/refine-plan-step";
import { callLlmTextJson } from "@/lib/llm/text-llm-client";
import { isComposeLlmConfigured } from "@/lib/llm/compose-llm-provider";
import { RIMVIO_TOOL_IDS, type RimvioToolId } from "@/lib/tool-registry";

const TOOL_ID_SET = new Set<string>(RIMVIO_TOOL_IDS);

function parseDecisionJson(raw: string | null): AgentDecision | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      reason?: string;
      stepId?: string;
      message?: string;
      changes?: {
        nextToolId?: string;
        reasonKo?: string;
        entityLabelKo?: string;
      };
    };
    if (parsed.type === "continue") {
      return { type: "continue" };
    }
    if (parsed.type === "stop") {
      return { type: "stop" };
    }
    if (parsed.type === "replan" && parsed.reason?.trim()) {
      return { type: "replan", reason: parsed.reason.trim() };
    }
    if (parsed.type === "ask_user" && parsed.message?.trim()) {
      return { type: "ask_user", message: parsed.message.trim() };
    }
    if (parsed.type === "refine" && parsed.stepId?.trim()) {
      const nextToolId = parsed.changes?.nextToolId?.trim();
      const entityLabelKo = parsed.changes?.entityLabelKo?.trim();
      return {
        type: "refine",
        stepId: parsed.stepId.trim(),
        changes: {
          nextToolId:
            nextToolId && TOOL_ID_SET.has(nextToolId)
              ? (nextToolId as RimvioToolId)
              : null,
          reasonKo: parsed.changes?.reasonKo?.trim() || null,
          entityLabelKo: entityLabelKo || null,
        },
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Deterministic policy — Observation → Decision.
 * Prefer refine for single blocked step; replan when lookup empty.
 */
export function decideFromObservationRules(
  obs: AgentRunObservation,
): AgentDecision {
  if (obs.waitingCommit && obs.reservedOpCount > 0) {
    return { type: "stop" };
  }

  if (obs.emptyLookup && obs.iteration < 2) {
    return {
      type: "replan",
      reason: "lookup returned no candidates — broaden or change domain",
    };
  }

  if (obs.blockedStepIds.length === 1) {
    return {
      type: "refine",
      stepId: obs.blockedStepIds[0]!,
      changes: {
        reasonKo: "막힌 단계만 다시 시도합니다",
      },
    };
  }

  if (obs.blockedStepIds.length > 1 && obs.iteration < 2) {
    return {
      type: "replan",
      reason: "multiple steps blocked — rebuild plan",
    };
  }

  if (obs.pendingStepIds.length > 0) {
    return { type: "continue" };
  }

  if (obs.requiresFieldCommit && !obs.waitingCommit && obs.iteration < 2) {
    return {
      type: "ask_user",
      message: "예약 준비를 이어갈까요? 후보를 확인한 뒤 맞춤에서 승인해 주세요.",
    };
  }

  return { type: "stop" };
}

/**
 * Per-step Observation → Decision (Executor calls via agentController.observe).
 * Empty hotel.search → refinePlanStep (search condition change), not step-done+stop.
 */
export function decideFromStepObservationRules(
  obs: AgentObservation,
  context?: {
    readonly utterance?: string | null;
    readonly plan?: ActionPlanV1 | null;
    readonly refineAttempt?: number;
  },
): AgentDecision {
  const errors = obs.errors ?? [];
  if (obs.stepKind === "wait_commit" && obs.success) {
    return { type: "stop" };
  }
  if (
    errors.includes("empty_candidates") ||
    errors.includes("empty_or_failed")
  ) {
    if (obs.stepKind === "resolve_entity") {
      const step = context?.plan?.steps.find((s) => s.id === obs.stepId);
      const suggested = suggestEmptyLookupRefine({
        utterance: context?.utterance?.trim() || "",
        currentEntityLabelKo: step?.entityLabelKo,
        currentToolId: step?.toolId,
        attempt: context?.refineAttempt ?? 0,
      });
      return {
        type: "refine",
        stepId: obs.stepId,
        changes: {
          entityLabelKo: suggested.entityLabelKo,
          nextToolId: suggested.nextToolId,
          reasonKo: suggested.reasonKo,
        },
      };
    }
    return {
      type: "refine",
      stepId: obs.stepId,
      changes: { reasonKo: obs.summaryKo ?? "단계 실패 — 재시도" },
    };
  }
  if (errors.includes("step_blocked")) {
    if (obs.stepKind === "resolve_entity") {
      const step = context?.plan?.steps.find((s) => s.id === obs.stepId);
      const suggested = suggestEmptyLookupRefine({
        utterance: context?.utterance?.trim() || "",
        currentEntityLabelKo: step?.entityLabelKo,
        currentToolId: step?.toolId,
        attempt: context?.refineAttempt ?? 0,
      });
      return {
        type: "refine",
        stepId: obs.stepId,
        changes: {
          entityLabelKo: suggested.entityLabelKo,
          nextToolId: suggested.nextToolId,
          reasonKo: suggested.reasonKo,
        },
      };
    }
    return {
      type: "refine",
      stepId: obs.stepId,
      changes: { reasonKo: "막힌 단계만 다시 시도합니다" },
    };
  }
  if (obs.success) {
    return { type: "continue" };
  }
  return {
    type: "refine",
    stepId: obs.stepId,
    changes: { reasonKo: obs.summaryKo ?? "단계 재시도" },
  };
}

async function decideFromStepObservationLlm(input: {
  readonly observation: AgentObservation;
  readonly history?: readonly AgentHistoryTurn[] | null;
}): Promise<AgentDecision | null> {
  if (!isComposeLlmConfigured()) {
    return null;
  }
  const historyBlock =
    input.history
      ?.slice(-6)
      .map((t) => `${t.role}: ${t.content}`)
      .join("\n") ?? "";
  const raw = await callLlmTextJson({
    systemPrompt: [
      "You are a travel agent step controller.",
      "Given one normalized Observation, return JSON decision:",
      '{ "type":"continue"|"stop"|"replan"|"refine"|"ask_user", ... }',
      "On empty hotel/lookup results prefer refine with entityLabelKo (widen search), not replan.",
      "replan needs reason; refine needs stepId (+ optional entityLabelKo/nextToolId); ask_user needs message.",
      "Prefer continue when success=true.",
    ].join(" "),
    userText: [
      historyBlock ? `History:\n${historyBlock}` : null,
      `Observation:\n${formatObservationForLlm(input.observation)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.1,
  });
  return parseDecisionJson(raw);
}

export async function decideFromStepObservation(input: {
  readonly observation: AgentObservation;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly useLlm?: boolean;
  readonly plan?: ActionPlanV1 | null;
  readonly utterance?: string | null;
  readonly refineAttempt?: number;
}): Promise<AgentDecision> {
  const rules = decideFromStepObservationRules(input.observation, {
    utterance: input.utterance,
    plan: input.plan,
    refineAttempt: input.refineAttempt,
  });
  if (!input.useLlm) {
    return rules;
  }
  const llm = await decideFromStepObservationLlm(input);
  if (!llm) {
    return rules;
  }
  // Prefer refine+search rewrite over replan when lookup empty.
  if (
    (input.observation.errors?.includes("empty_candidates") ||
      input.observation.errors?.includes("empty_or_failed")) &&
    input.observation.stepKind === "resolve_entity" &&
    llm.type === "replan"
  ) {
    return rules;
  }
  return llm;
}

async function decideFromObservationLlm(input: {
  readonly observation: AgentRunObservation;
  readonly history?: readonly AgentHistoryTurn[] | null;
}): Promise<AgentDecision | null> {
  if (!isComposeLlmConfigured()) {
    return null;
  }
  const historyBlock =
    input.history
      ?.slice(-6)
      .map((t) => `${t.role}: ${t.content}`)
      .join("\n") ?? "";

  const raw = await callLlmTextJson({
    systemPrompt: [
      "You are a travel agent controller over an ActionPlan executor.",
      "You receive normalized Observations (not raw tool payloads).",
      "Each observation has: planId, stepId, stepKind, success, summaryKo, candidates, selected, errors, sessionState, diffState.",
      "Return JSON only with one of:",
      '{ "type":"continue" }',
      '{ "type":"stop" }',
      '{ "type":"replan", "reason":"..." }',
      '{ "type":"refine", "stepId":"...", "changes":{ "nextToolId"?: string, "reasonKo"?: string } }',
      '{ "type":"ask_user", "message":"..." }',
      "Prefer stop when waitingCommit or goal done.",
      "Prefer refine for one blocked step; replan when lookup empty / errors include empty_candidates.",
      "Do not invent tool ids outside the observation.",
    ].join(" "),
    userText: [
      historyBlock ? `History:\n${historyBlock}` : null,
      `Observation:\n${formatObservationForLlm(input.observation)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.1,
  });

  return parseDecisionJson(raw);
}

export async function decideNextAction(input: {
  readonly observation: AgentRunObservation;
  readonly history?: readonly AgentHistoryTurn[] | null;
  readonly useLlm?: boolean;
}): Promise<AgentDecision> {
  const rules = decideFromObservationRules(input.observation);
  if (!input.useLlm) {
    return rules;
  }
  const llm = await decideFromObservationLlm(input);
  if (!llm) {
    return rules;
  }
  if (
    input.observation.waitingCommit &&
    input.observation.reservedOpCount > 0 &&
    llm.type !== "stop" &&
    llm.type !== "ask_user"
  ) {
    return { type: "stop" };
  }
  return llm;
}
