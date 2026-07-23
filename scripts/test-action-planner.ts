#!/usr/bin/env npx tsx
/**
 * Action Planner + Tool Registry — compare→rank→reserve_prep→wait_commit (no Commit).
 * Wires Intent + Entity Resolver + Tool Router + Context Field utterance + offerId.
 */

import assert from "node:assert/strict";
import {
  buildCompareReserveActionPlan,
  buildTripPrepActionPlan,
  isCompoundActionUtterance,
  isTripPrepUtterance,
  resolvePlanEntityLabel,
  tryRunActionPlanner,
  tryRunContextNlAction,
  readActionPlanUiState,
} from "../lib/action-planner";
import {
  clearSessionGraphs,
  resetGraphCommandStoreForTests,
} from "../lib/graph-command";
import {
  getRimvioTool,
  invokeRimvioTool,
  listRimvioTools,
  listToolsForSkill,
} from "../lib/tool-registry";
import {
  buildRealityControlSnapshot,
  clearPreparedRealityOperations,
  listPreparedRealityOperations,
  readPreparedRealityOperation,
} from "../lib/reality-queue";
import { planContextRun } from "../lib/context-run/plan-context-run";
import type { BoundSituation } from "../lib/context-run/ingress-types";
import {
  resolveToolIdForIntent,
  resolveLookupToolId,
} from "../lib/rule-engine";
import {
  ensureSessionGraph,
  writeSessionGraph,
} from "../lib/graph-command/session-graph-store";
import { makeNodeFromLiveCandidate } from "../lib/action-planner/inject-live-search-candidate";
import { readRealityPipelineSnapshot } from "../lib/reality-pipeline";
import { readContextConditionLastBatch } from "../lib/globe/context-condition-ai/context-condition-last-batch-store";
import { isToolSearchLastBatch } from "../lib/graph-command/stamp-search-tool-results-to-diff";

resetGraphCommandStoreForTests();
clearPreparedRealityOperations();
clearSessionGraphs();

assert.ok(listRimvioTools().length >= 5);
assert.ok(getRimvioTool("ranking.pick"));
assert.ok(listToolsForSkill("travel").some((t) => t.id === "hotel.lookup"));

assert.equal(resolveLookupToolId("lodging"), "hotel.lookup");
assert.equal(resolveToolIdForIntent({ intent: "Reserve" }), "booking.prepare");
assert.equal(resolveToolIdForIntent({ intent: "Analyze" }), "ranking.pick");
assert.equal(resolveToolIdForIntent({ intent: "Compare" }), null);

{
  const apa = resolvePlanEntityLabel("APA 난바");
  assert.equal(apa.domain, "lodging");
  assert.equal(apa.toolId, "hotel.lookup");
  assert.ok(apa.catalogHit);
  assert.match(apa.labelKo, /APA|난바/u);
}

{
  const rank = invokeRimvioTool("ranking.pick", {
    utterance: "현지인 단골 예약 가능",
    candidates: [
      {
        id: "a",
        labelKo: "A호텔",
        rating: 4.1,
        walkMinutes: 10,
        reservable: true,
      },
      {
        id: "b",
        labelKo: "B호텔",
        rating: 4.7,
        walkMinutes: 8,
        reservable: true,
        localFavorite: true,
      },
    ],
  });
  assert.equal(rank.pickedLabelKo, "B호텔");
}

assert.equal(
  isCompoundActionUtterance("A호텔이랑 B호텔 비교해서 예약해"),
  true,
);
assert.equal(isCompoundActionUtterance("A호텔 고정해"), false);
assert.equal(isTripPrepUtterance("제주도 3박4일 여행 준비해줘"), true);
assert.equal(isCompoundActionUtterance("제주도 3박4일 여행 준비해줘"), true);
{
  const trip = buildTripPrepActionPlan({
    utterance: "제주도 3박4일 여행 준비해줘",
    contextEventId: "evt:trip",
    referenceDateIso: "2026-07-24",
  });
  assert.ok(trip);
  assert.equal(trip!.planKind, "trip_prep");
  assert.equal(trip!.tripPrep?.nights, 3);
}

{
  const plan = buildCompareReserveActionPlan({
    utterance: "A호텔이랑 B호텔 비교해서 괜찮은 곳 예약 준비해",
    contextEventId: "evt-plan",
  });
  assert.ok(plan);
  assert.ok(plan!.steps.length >= 6);
  assert.equal(plan!.steps[0]?.kind, "resolve_entity");
  assert.equal(plan!.steps[0]?.toolId, "hotel.lookup");
  assert.equal(plan!.steps.at(-1)?.kind, "wait_commit");
  assert.ok(plan!.steps.some((s) => s.toolId === "ranking.pick"));
  assert.ok(
    plan!.steps.some((s) => s.graphCommand?.op === "reserve_prep"),
  );
  assert.ok(plan!.steps.some((s) => s.toolId === "booking.prepare"));
  assert.ok(plan!.diffBundleId.startsWith("diff-bundle:"));
  assert.equal(plan!.steps[0]?.diffPhase, "working_set");
  assert.equal(
    plan!.steps.find((s) => s.graphCommand?.op === "reserve_prep")?.diffPhase,
    "field_gate",
  );
}

{
  const run = tryRunActionPlanner({
    utterance: "APA난바이랑 APA우메다 비교해서 예약해",
    contextEventId: "evt-osaka",
    anchorLat: 34.67,
    anchorLng: 135.5,
    contextLabelKo: "오사카 여행",
  });
  assert.ok(run);
  assert.equal(run!.waitingCommit, true);
  assert.equal(run!.diffBundleApplied, true);
  assert.ok(
    run!.diffCommandCount >= 3,
    `expected pin+pin+compare bundle, got ${run!.diffCommandCount}`,
  );
  assert.ok(run!.reservedOpIds.length >= 1);
  assert.ok(run!.assistantReplyKo.includes("이렇게 진행할게요"));
  assert.ok(
    run!.plan.steps.every((s) => s.status === "done" || s.status === "skipped"),
  );
  const compareStep = run!.plan.steps.find((s) => s.id === "step:compare");
  assert.ok(compareStep?.status === "done");
  assert.ok(
    compareStep?.noteKo?.includes("Diff"),
    `expected Diff note, got ${compareStep?.noteKo}`,
  );
  const lastBatch = readContextConditionLastBatch("evt-osaka");
  assert.ok(lastBatch);
  assert.ok(isToolSearchLastBatch(lastBatch));
  assert.ok(lastBatch!.batchId.includes(run!.plan.diffBundleId));

  const snap = buildRealityControlSnapshot({
    events: [],
    tradeSessions: [],
    applyHolds: false,
  });
  assert.equal(snap.canCommit, false, "planner must not auto-Commit");
}

{
  const nl = tryRunContextNlAction({
    utterance: "리버뷰 호텔이랑 스테이 인 비교해서 예약 준비해",
    contextEventId: "evt-nl",
    anchorLat: 35.67,
    anchorLng: 139.7,
    contextLabelKo: "도쿄",
  });
  assert.ok(nl);
  assert.equal(nl!.via, "action_plan");
  if (nl!.via === "action_plan") {
    assert.equal(nl!.waitingCommit, true);
  }
  const ui = readActionPlanUiState();
  assert.ok(ui);
  assert.equal(ui!.waitingCommit, true);
  assert.equal(ui!.requestFieldOpen, true);
  const pipeline = readRealityPipelineSnapshot("evt-nl");
  assert.ok(pipeline, "NL success must sync Reality Pipeline");
}

{
  // offerId end-to-end: stamp LiteAPI offer on graph node → reserve_prep → preview.resourceId
  clearPreparedRealityOperations();
  clearSessionGraphs();
  const ctx = "evt-offer";
  const graph = ensureSessionGraph({
    contextEventId: ctx,
    anchorLat: 34.67,
    anchorLng: 135.5,
  });
  const node = makeNodeFromLiveCandidate({
    contextEventId: ctx,
    kind: "lodging",
    candidate: {
      id: "liteapi:hotel-apa-namba",
      labelKo: "APA 난바",
      rating: 4.4,
      walkMinutes: 5,
      reservable: true,
      source: "liteapi",
      liteapiOfferId: "offer-test-123",
      liteapiHotelId: "hotel-apa-namba",
      amountLabel: "18,000엔",
      lat: 34.665,
      lng: 135.502,
    },
  });
  const nodeB = makeNodeFromLiveCandidate({
    contextEventId: ctx,
    kind: "lodging",
    candidate: {
      id: "liteapi:hotel-apa-umeda",
      labelKo: "APA 우메다",
      rating: 4.2,
      walkMinutes: 8,
      reservable: true,
      source: "liteapi",
      liteapiOfferId: "offer-test-456",
      amountLabel: "16,000엔",
      lat: 34.705,
      lng: 135.498,
    },
  });
  writeSessionGraph({
    ...graph,
    nodes: [node, nodeB],
    selectionIds: [node.id, nodeB.id],
    updatedAtIso: new Date().toISOString(),
  });

  const run = tryRunActionPlanner({
    utterance: "APA 난바이랑 APA 우메다 비교해서 예약해",
    contextEventId: ctx,
    anchorLat: 34.67,
    anchorLng: 135.5,
    contextLabelKo: "오사카",
  });
  assert.ok(run);
  assert.ok(run!.reservedOpIds.length >= 1);
  const op =
    readPreparedRealityOperation(run!.reservedOpIds[0]!) ??
    listPreparedRealityOperations()[0];
  assert.ok(op);
  assert.ok(
    op!.preview.resourceId === "offer-test-123" ||
      op!.preview.resourceId === "offer-test-456",
    `expected liteapi offerId on op, got ${op!.preview.resourceId}`,
  );
  assert.equal(op!.engineId, "liteapi_booking");
}

{
  const bound: BoundSituation = {
    graphId: "g1",
    goalKo: "비교 예약",
    ingress: {
      kind: "text",
      text: "A호텔이랑 B호텔 비교해서 예약해",
      surface: "composer",
      layerMode: "personal",
      contextEventId: "evt-bound",
    },
  };
  const plan = planContextRun(bound);
  assert.equal(plan.kind, "graph_command");
}

console.log("test-action-planner: ok");
