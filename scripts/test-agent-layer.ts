/**
 * Agent Layer — observation + decision + controller wiring (no live LLM required).
 */
import assert from "node:assert/strict";
import {
  buildAgentObservation,
  createActionPlan,
  createActionPlanWithMeta,
  decideFromObservationRules,
  decideFromStepObservationRules,
  planAction,
  runAgentController,
} from "../lib/agent";
import type {
  ActionPlanV1,
  ActionPlannerRunResult,
} from "../lib/action-planner/types";
import { ACTION_PLAN_VERSION } from "../lib/action-planner/types";
import { refinePlanStep } from "../lib/action-planner/refine-plan-step";

function samplePlan(overrides?: Partial<ActionPlanV1>): ActionPlanV1 {
  return {
    version: ACTION_PLAN_VERSION,
    planId: "aplan:test",
    contextEventId: "evt:test",
    utterance: "오사카 호텔 찾고 예약 준비",
    createdAtIso: new Date().toISOString(),
    diffBundleId: "aplan:test:diff",
    planKind: "search_reserve",
    requiresFieldCommit: true,
    steps: [
      {
        id: "step:resolve:search",
        kind: "resolve_entity",
        labelKo: "호텔 찾기",
        status: "done",
        toolId: "hotel.lookup",
        entityLabelKo: "호텔",
        noteKo: "숙소 0곳",
        diffPhase: "working_set",
      },
      {
        id: "step:rank",
        kind: "tool",
        labelKo: "고르기",
        status: "pending",
        toolId: "ranking.pick",
        diffPhase: "working_set",
      },
      {
        id: "step:wait",
        kind: "wait_commit",
        labelKo: "승인 대기",
        status: "pending",
        diffPhase: "field_gate",
      },
    ],
    ...overrides,
  };
}

function sampleRun(plan: ActionPlanV1): ActionPlannerRunResult {
  return {
    ok: true,
    plan,
    assistantReplyKo: "preview",
    reservedOpIds: [],
    pickedLabelKo: null,
    waitingCommit: false,
    diffBundleApplied: false,
    diffCommandCount: 0,
  };
}

async function main() {
  {
    const plan = samplePlan();
    const obs = buildAgentObservation({
      plan,
      run: sampleRun(plan),
      iteration: 1,
    });
    assert.equal(obs.emptyLookup, true);
    assert.ok(obs.observations.length >= 1);
    const step0 = obs.observations[0]!;
    assert.equal(step0.planId, plan.planId);
    assert.equal(step0.stepId, "step:resolve:search");
    assert.equal(step0.stepKind, "resolve_entity");
    assert.equal(step0.success, false);
    assert.ok(Array.isArray(step0.candidates));
    assert.equal(step0.candidates!.length, 0);
    assert.ok(step0.diffState);
    const decision = decideFromStepObservationRules(step0, {
      utterance: "오사카 호텔 찾아줘",
      plan,
      refineAttempt: 0,
    });
    assert.equal(decision.type, "refine");
    if (decision.type === "refine") {
      assert.ok(decision.changes?.entityLabelKo);
      assert.match(decision.changes!.entityLabelKo!, /오사카|호텔/);
      const refined = refinePlanStep({
        plan,
        stepId: decision.stepId,
        entityLabelKo: decision.changes!.entityLabelKo,
        nextToolId: decision.changes?.nextToolId,
        reasonKo: decision.changes?.reasonKo,
      });
      assert.ok(refined);
      assert.equal(refined!.steps[0]!.status, "pending");
      assert.equal(
        refined!.steps[0]!.entityLabelKo,
        decision.changes!.entityLabelKo,
      );
    }
    console.log("ok: empty lookup -> refinePlanStep (search widen)");
  }

  {
    const plan = samplePlan({
      steps: [
        {
          id: "step:a",
          kind: "graph_command",
          labelKo: "reserve",
          status: "blocked",
          noteKo: "reserve prep failed",
          diffPhase: "field_gate",
        },
      ],
    });
    const obs = buildAgentObservation({
      plan,
      run: sampleRun(plan),
      iteration: 1,
    });
    assert.equal(obs.observations[0]!.success, false);
    assert.ok(obs.observations[0]!.errors?.includes("step_blocked"));
    const decision = decideFromObservationRules(obs);
    assert.equal(decision.type, "refine");
    if (decision.type === "refine") {
      assert.equal(decision.stepId, "step:a");
    }
    console.log("ok: blocked -> refine");
  }

  {
    const plan = samplePlan();
    const run: ActionPlannerRunResult = {
      ...sampleRun(plan),
      waitingCommit: true,
      reservedOpIds: ["op:1"],
    };
    const obs = buildAgentObservation({ plan, run, iteration: 1 });
    assert.equal(decideFromObservationRules(obs).type, "stop");
    console.log("ok: waitingCommit -> stop");
  }

  {
    const { normalizeToolInvokeResult } = await import("../lib/agent/observation");
    const normalized = normalizeToolInvokeResult({
      planId: "aplan:x",
      stepId: "step:1",
      stepKind: "resolve_entity",
      tool: {
        ok: true,
        toolId: "hotel.lookup",
        summaryKo: "숙소 2곳",
        candidates: [
          {
            id: "h1",
            labelKo: "호텔A",
            rating: 4.5,
            walkMinutes: 5,
            priceBand: 2,
            reservable: true,
            localFavorite: false,
            liteapiOfferId: "secret-offer-should-not-leak-as-raw",
            priceKrw: 120000,
          },
          {
            id: "h2",
            labelKo: "호텔B",
            rating: 4.2,
            walkMinutes: 8,
            priceBand: 1,
            reservable: true,
            localFavorite: false,
          },
        ],
      },
    });
    assert.equal(normalized.success, true);
    assert.equal(normalized.candidates!.length, 2);
    const card = normalized.candidates![0] as { id: string; labelKo: string };
    assert.equal(card.id, "h1");
    assert.equal(card.labelKo, "호텔A");
    assert.equal(
      JSON.stringify(normalized).includes("secret-offer"),
      false,
    );
    console.log("ok: ToolInvokeResult normalized (no raw offer leak)");
  }

  {
    const plan = samplePlan({
      steps: [
        {
          id: "step:1",
          kind: "resolve_entity",
          labelKo: "찾기",
          status: "done",
          toolId: "hotel.lookup",
          entityLabelKo: "호텔",
          noteKo: "숙소 3곳",
        },
        {
          id: "step:2",
          kind: "tool",
          labelKo: "고르기",
          status: "done",
          toolId: "ranking.pick",
        },
      ],
    });
    const refined = refinePlanStep({
      plan,
      stepId: "step:1",
      reasonKo: "다시",
    });
    assert.ok(refined);
    assert.equal(refined!.steps[0]!.status, "pending");
    console.log("ok: refinePlanStep resets target");
  }

  {
    const planned = await planAction({
      utterance: "오사카 호텔 찾고 예약 준비해줘",
      contextEventId: "evt:agent-plan",
      useLlm: false,
    });
    assert.ok(planned);
    assert.equal(planned!.source, "rule");
    assert.ok(planned!.plan.steps.length >= 2);
    console.log("ok: planAction rule fallback");
  }

  {
    const plan = await createActionPlan({
      utterance: "오사카 호텔 찾고 예약 준비해줘",
      history: [{ role: "user", content: "오사카 여행" }],
      sessionGraph: null,
      contextEventId: "evt:create-plan",
      useLlm: false,
    });
    assert.ok(plan);
    assert.ok(plan!.steps.length >= 2);
    assert.equal(plan!.contextEventId, "evt:create-plan");

    const meta = await createActionPlanWithMeta({
      utterance: "오사카 호텔 찾고 예약 준비해줘",
      history: null,
      sessionGraph: null,
      contextEventId: "evt:create-plan-meta",
      useLlm: false,
    });
    assert.ok(meta);
    assert.equal(meta!.source, "rule");
    assert.equal(meta!.fallbackReason, "useLlm=false");
    console.log("ok: createActionPlan adapter (rule fallback)");
  }

  {
    const result = await runAgentController({
      utterance: "오사카 호텔 찾고 첫 번째 예약 준비",
      contextEventId: "evt:agent-ctrl",
      useLlm: false,
      maxIterations: 2,
    });
    if (result.ok) {
      assert.equal(result.via, "agent_controller");
      assert.ok(result.observations.length >= 1);
      assert.ok(result.observation.observations.length >= 1);
      console.log("ok: runAgentController executed", result.decision.type);
    } else {
      console.log("ok: runAgentController miss", result.reason);
    }
  }

  {
    const {
      isTripPrepUtterance,
      buildTripPrepActionPlan,
      buildActionPlan,
      isCompoundActionUtterance,
    } = await import("../lib/action-planner");
    const {
      openWorkspaceForTripPrep,
    } = await import("../lib/agent/open-workspace-for-trip-prep");
    const { readContextWorkspace } = await import(
      "../lib/context-workspace/workspace-store"
    );

    const utterance = "제주도 3박4일 여행 준비해줘";
    assert.equal(isTripPrepUtterance(utterance), true);
    assert.equal(isCompoundActionUtterance(utterance), true);

    const tripPlan = buildTripPrepActionPlan({
      utterance,
      contextEventId: "evt:trip-prep",
      referenceDateIso: "2026-07-24",
    });
    assert.ok(tripPlan);
    assert.equal(tripPlan!.planKind, "trip_prep");
    assert.equal(tripPlan!.requiresFieldCommit, true);
    assert.equal(tripPlan!.tripPrep?.destinationKo, "제주");
    assert.equal(tripPlan!.tripPrep?.nights, 3);
    assert.equal(tripPlan!.tripPrep?.days, 4);
    assert.equal(tripPlan!.tripPrep?.checkInIso, "2026-07-24");
    assert.equal(tripPlan!.tripPrep?.checkOutIso, "2026-07-27");
    assert.ok(tripPlan!.steps.some((s) => s.kind === "wait_commit"));
    assert.ok(tripPlan!.steps.some((s) => s.toolId === "hotel.lookup"));

    const viaBuild = buildActionPlan({
      utterance,
      contextEventId: "evt:trip-prep-build",
    });
    assert.ok(viaBuild);
    assert.equal(viaBuild!.planKind, "trip_prep");

    const ws = openWorkspaceForTripPrep({
      utterance,
      contextEventId: "evt:trip-prep-ws",
      plan: tripPlan,
    });
    assert.ok(ws);
    assert.equal(ws!.domain, "lodging");
    assert.match(ws!.query, /제주/);
    const stored = readContextWorkspace("evt:trip-prep-ws");
    assert.ok(stored);
    assert.equal(stored!.status, "editing");

    const agentTrip = await runAgentController({
      utterance,
      contextEventId: "evt:trip-prep-agent",
      useLlm: false,
      maxIterations: 2,
    });
    assert.equal(agentTrip.ok, true);
    if (agentTrip.ok) {
      assert.equal(agentTrip.plan.planKind, "trip_prep");
      assert.equal(agentTrip.via, "agent_controller");
    }
    console.log("ok: trip_prep ingress + planKind + Workspace open");
  }

  {
    const seedPlan = samplePlan({
      steps: [
        {
          id: "step:resolve:search",
          kind: "resolve_entity",
          labelKo: "호텔 찾기",
          status: "blocked",
          toolId: "hotel.lookup",
          entityLabelKo: "호텔",
          noteKo: "숙소 0곳",
          diffPhase: "working_set",
        },
        {
          id: "step:rank",
          kind: "tool",
          labelKo: "고르기",
          status: "pending",
          toolId: "ranking.pick",
          diffPhase: "working_set",
        },
        {
          id: "step:wait",
          kind: "wait_commit",
          labelKo: "승인 대기",
          status: "pending",
          diffPhase: "field_gate",
        },
      ],
    });
    const prevObs = buildAgentObservation({
      plan: seedPlan,
      run: sampleRun(seedPlan),
      iteration: 1,
    }).observations;
    const meta = await createActionPlanWithMeta({
      utterance: "난바 근처로 다시 찾아줘",
      history: [
        { role: "user", content: "오사카 호텔 찾아서 예약 준비해줘" },
        { role: "assistant", content: "후보가 부족해요. 지역을 좁혀 볼까요?" },
      ],
      sessionGraph: null,
      contextEventId: "evt:conv-ctx",
      currentPlan: seedPlan,
      previousObservations: prevObs,
      useLlm: false,
    });
    assert.ok(meta);
    assert.equal(meta!.source, "rule");
    assert.ok(meta!.plan.steps.length >= 2);
    assert.equal(meta!.plan.contextEventId, "evt:conv-ctx");
    console.log(
      "ok: Planner Conversation Context (utterance+history+currentPlan+previousObservations)",
    );
  }

  {
    const {
      AGENT_SAFETY_LOCKS,
      AGENT_MAX_STEPS,
      AGENT_MAX_LOOP_ITERATIONS,
      createAgentSafetyBudget,
      bumpLoopIteration,
      bumpStepExecuted,
      isAgentLoopExhausted,
      enforceHumanCommitGate,
    } = await import("../lib/agent/agent-safety-policy");
    assert.equal(AGENT_SAFETY_LOCKS.waitCommitStepKind, "wait_commit");
    assert.equal(AGENT_SAFETY_LOCKS.agentNeverRealityCommits, true);
    assert.equal(AGENT_SAFETY_LOCKS.fieldCommitRequired, true);
    assert.equal(AGENT_SAFETY_LOCKS.diffBundlePreserved, true);
    assert.ok(AGENT_MAX_STEPS >= 8);
    assert.ok(AGENT_MAX_LOOP_ITERATIONS >= AGENT_MAX_STEPS);

    let budget = createAgentSafetyBudget();
    for (let i = 0; i < AGENT_MAX_LOOP_ITERATIONS; i += 1) {
      budget = bumpLoopIteration(budget);
    }
    assert.equal(isAgentLoopExhausted(budget), "max_loop_iterations");

    budget = createAgentSafetyBudget();
    for (let i = 0; i < AGENT_MAX_STEPS; i += 1) {
      budget = bumpStepExecuted(bumpLoopIteration(budget));
    }
    assert.equal(isAgentLoopExhausted(budget), "max_steps");

    const gated = enforceHumanCommitGate(
      { type: "continue" },
      { kind: "wait_commit", status: "done" },
    );
    assert.equal(gated.type, "stop");
    console.log("ok: agent safety policy (maxSteps / loop / wait_commit gate)");
  }

  console.log("agent layer tests passed");
}

void main();
