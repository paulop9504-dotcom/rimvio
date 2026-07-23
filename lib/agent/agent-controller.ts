/**
 * Agent Controller — Observation loop over Action Planner Executor.
 *
 * User → createActionPlan → ActionPlanV1 → executeActionPlanAsync → Observation → Decision
 * Decisions: continue | refine | replan | ask_user | stop
 *
 * Does not replace Tool Gateway or Reality Commit gates.
 */

import { refinePlanStep } from "@/lib/action-planner/refine-plan-step";
import { executeActionPlanAsync } from "@/lib/action-planner/run-action-plan";
import type { ActionPlanV1 } from "@/lib/action-planner/types";
import {
  isCompoundActionUtterance,
} from "@/lib/action-planner/build-compare-reserve-plan";
import { isTripPrepUtterance } from "@/lib/action-planner/build-trip-prep-plan";
import { decideNextAction } from "@/lib/agent/decision";
import { buildAgentObservation } from "@/lib/agent/observation";
import { createActionPlanWithMeta } from "@/lib/agent/create-action-plan";
import { openWorkspaceForTripPrep } from "@/lib/agent/open-workspace-for-trip-prep";
import type {
  AgentControllerInput,
  AgentControllerMiss,
  AgentControllerResult,
  AgentDecision,
  AgentObservation,
} from "@/lib/agent/types";
import {
  ensureSessionGraph,
  readSessionGraph,
} from "@/lib/graph-command/session-graph-store";

const DEFAULT_MAX_ITERATIONS = 3;

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
        ? { ...step, status: "pending" as const, noteKo: "이전 단계 재실행으로 대기" }
        : step,
    ),
  };
}

function applyRefine(
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
 * Run Agent Controller over compound (or LLM-planned) travel actions.
 */
export async function runAgentController(
  input: AgentControllerInput,
): Promise<AgentControllerResult | AgentControllerMiss> {
  const utterance = input.utterance.trim();
  const contextEventId = input.contextEventId.trim();
  if (!utterance || !contextEventId) {
    return { ok: false, reason: "not_applicable" };
  }

  const useLlm = input.useLlm !== false;
  const maxIterations = Math.max(
    1,
    Math.min(input.maxIterations ?? DEFAULT_MAX_ITERATIONS, 5),
  );

  ensureSessionGraph({
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
  });

  let planned = await createActionPlanWithMeta({
    utterance,
    history: input.history,
    sessionGraph: readSessionGraph(contextEventId),
    contextEventId,
    useLlm,
    currentPlan: input.currentPlan,
    previousObservations: input.previousObservations,
  });

  // Rule planner only fires on compound / trip_prep; allow LLM-only plans too.
  if (!planned) {
    if (
      !isCompoundActionUtterance(utterance) &&
      !isTripPrepUtterance(utterance)
    ) {
      return { ok: false, reason: "not_applicable" };
    }
    return { ok: false, reason: "no_plan" };
  }

  let plan = planned.plan;
  let plannerSource: AgentControllerResult["plannerSource"] = planned.source;
  openWorkspaceForTripPrep({
    utterance,
    contextEventId,
    plan,
  });
  const decisions: AgentDecision[] = [];
  let observationTrail: AgentObservation[] = [
    ...(input.previousObservations ?? []),
  ];
  let lastObservation = buildAgentObservation({
    plan,
    run: {
      ok: true,
      plan,
      assistantReplyKo: "",
      reservedOpIds: [],
      pickedLabelKo: null,
      waitingCommit: false,
      diffBundleApplied: false,
      diffCommandCount: 0,
    },
    iteration: 0,
  });
  const execBase = {
    utterance,
    contextEventId,
    anchorLat: input.anchorLat,
    anchorLng: input.anchorLng,
    contextLabelKo: input.contextLabelKo,
    enableStepObserve: true as const,
    observeUseLlm: useLlm,
    history: input.history,
  };

  let lastRun = await executeActionPlanAsync(plan, {
    ...execBase,
    previousObservations: observationTrail,
  });
  plan = lastRun.plan;
  lastObservation = buildAgentObservation({
    plan,
    run: lastRun,
    iteration: 1,
  });
  observationTrail = [
    ...observationTrail,
    ...lastObservation.observations,
  ].slice(-24);

  // Per-step observe already ran inside Executor.
  if (lastRun.agentHalt === "ask_user") {
    return {
      ok: true,
      plan,
      run: lastRun,
      observations: lastObservation.observations,
      observation: lastObservation,
      decision: { type: "ask_user", message: lastRun.assistantReplyKo },
      decisions: [{ type: "ask_user", message: lastRun.assistantReplyKo }],
      assistantReplyKo: lastRun.assistantReplyKo,
      via: "agent_controller",
      plannerSource,
    };
  }

  if (lastRun.agentHalt === "stop" || lastRun.waitingCommit) {
    return {
      ok: true,
      plan,
      run: lastRun,
      observations: lastObservation.observations,
      observation: lastObservation,
      decision: { type: "stop" },
      decisions: [{ type: "stop" }],
      assistantReplyKo: lastRun.assistantReplyKo,
      via: "agent_controller",
      plannerSource,
    };
  }

  // Optional outer pass for leftover pending (rules only — no second LLM).
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const decision = await decideNextAction({
      observation: lastObservation,
      history: input.history,
      useLlm: false,
    });
    decisions.push(decision);

    if (decision.type === "stop" || decision.type === "ask_user") {
      return {
        ok: true,
        plan,
        run: lastRun,
        observations: lastObservation.observations,
        observation: lastObservation,
        decision:
          decision.type === "ask_user"
            ? decision
            : { type: "stop" },
        decisions,
        assistantReplyKo:
          decision.type === "ask_user"
            ? decision.message
            : lastRun.assistantReplyKo,
        via: "agent_controller",
        plannerSource,
      };
    }

    if (decision.type === "continue") {
      if (lastObservation.pendingStepIds.length === 0) {
        break;
      }
      lastRun = await executeActionPlanAsync(plan, {
        ...execBase,
        previousObservations: observationTrail,
      });
      plan = lastRun.plan;
      lastObservation = buildAgentObservation({
        plan,
        run: lastRun,
        iteration: iteration + 1,
      });
      observationTrail = [
        ...observationTrail,
        ...lastObservation.observations,
      ].slice(-24);
      continue;
    }

    if (decision.type === "refine") {
      const nextPlan = applyRefine(plan, decision);
      if (!nextPlan) {
        break;
      }
      plan = nextPlan;
      plannerSource = "refine";
      lastRun = await executeActionPlanAsync(plan, {
        ...execBase,
        previousObservations: observationTrail,
      });
      plan = lastRun.plan;
      lastObservation = buildAgentObservation({
        plan,
        run: lastRun,
        iteration: iteration + 1,
      });
      observationTrail = [
        ...observationTrail,
        ...lastObservation.observations,
      ].slice(-24);
      continue;
    }

    if (decision.type === "replan") {
      const replanned = await createActionPlanWithMeta({
        utterance,
        history: input.history,
        sessionGraph: readSessionGraph(contextEventId),
        contextEventId,
        useLlm,
        replanReason: decision.reason,
        currentPlan: plan,
        previousObservations: observationTrail,
      });
      if (!replanned) {
        return {
          ok: true,
          plan,
          run: lastRun,
          observations: lastObservation.observations,
          observation: lastObservation,
          decision: {
            type: "ask_user",
            message: "다시 계획을 못 세웠어요. 조건을 짧게 말해 주세요.",
          },
          decisions: [
            ...decisions,
            {
              type: "ask_user",
              message: "다시 계획을 못 세웠어요. 조건을 짧게 말해 주세요.",
            },
          ],
          assistantReplyKo: "다시 계획을 못 세웠어요. 조건을 짧게 말해 주세요.",
          via: "agent_controller",
          plannerSource,
        };
      }
      plan = replanned.plan;
      plannerSource = "replan";
      lastRun = await executeActionPlanAsync(plan, {
        ...execBase,
        previousObservations: observationTrail,
      });
      plan = lastRun.plan;
      lastObservation = buildAgentObservation({
        plan,
        run: lastRun,
        iteration: iteration + 1,
      });
      observationTrail = [
        ...observationTrail,
        ...lastObservation.observations,
      ].slice(-24);
    }
  }

  return {
    ok: true,
    plan,
    run: lastRun,
    observations: lastObservation.observations,
    observation: lastObservation,
    decision: { type: "stop" },
    decisions: [...decisions, { type: "stop" }],
    assistantReplyKo: lastRun.assistantReplyKo,
    via: "agent_controller",
    plannerSource,
  };
}
