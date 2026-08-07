/**
 * Reality Jump / Entity Projection — AI place mention → Workspace focus.
 * Run: npx tsx scripts/test-reality-jump.ts
 */

import assert from "node:assert/strict";
import {
  clearContextWorkspace,
  openMapContextWorkspace,
  readContextWorkspace,
} from "../lib/context-workspace";
import {
  extractRealityJumpTargets,
  projectRealityJumpToWorkspace,
  splitTextWithRealityJumps,
} from "../lib/globe/reality-jump";

const itinerary = `오사카 4박 5일 추천 일정

DAY 1 ✈️ 간사이 국제공항 → 난바 체크인 → 도톤보리
DAY 3 🌎 유니버설 스튜디오 재팬 종일
DAY 5 🍜 쿠로몬 시장 → 간사이 공항 출발`;

const targets = extractRealityJumpTargets(itinerary);
assert.ok(targets.length >= 2, `expected ≥2 jumps, got ${targets.length}`);

const kix = targets.find(
  (t) =>
    t.placeId === "geo:jp:kix" ||
    /간사이/u.test(t.labelKo),
);
assert.ok(kix, "KIX must resolve");
assert.ok(Number.isFinite(kix!.lat) && Number.isFinite(kix!.lng));
assert.equal(kix!.jumpKind, "reality_jump");

const usj = targets.find(
  (t) =>
    t.placeId === "geo:jp:osaka:usj" ||
    /유니버설/u.test(t.labelKo),
);
assert.ok(usj, "USJ must resolve");

const parts = splitTextWithRealityJumps("✈️ 간사이 국제공항 → 난바");
assert.ok(parts.some((p) => p.type === "entity"));
assert.ok(parts.some((p) => p.type === "text"));

const entityPart = parts.find((p) => p.type === "entity");
assert.ok(entityPart && entityPart.type === "entity");
assert.equal(entityPart.target.jumpKind, "reality_jump");

const essay =
  "오사카에는 북쪽 우메다(梅田)와 남쪽 난바(難波)가 있어요. 오사카역, 도톤보리, 신사이바시, 텐노지.";
const essayTargets = extractRealityJumpTargets(essay);
const need = ["우메다", "난바", "신사이바시", "텐노지"] as const;
for (const label of need) {
  assert.ok(
    essayTargets.some(
      (t) =>
        t.labelKo.includes(label.replace(/지역$/u, "")) ||
        essay.slice(t.span.start, t.span.end).includes(label) ||
        (label === "우메다" && /우메다|오사카역/u.test(t.labelKo)),
    ),
    `essay must linkify ${label}`,
  );
}

const ctx = `test-reality-jump-${Date.now()}`;
clearContextWorkspace(ctx);
openMapContextWorkspace({
  contextEventId: ctx,
  domain: "poi",
  query: "오사카",
  candidates: [],
  summaryKo: "Entity Projection smoke",
});

const umeda = essayTargets.find((t) => /우메다/u.test(t.labelKo));
assert.ok(umeda, "우메다 target");
const projected = projectRealityJumpToWorkspace({
  contextEventId: ctx,
  placeId: umeda!.placeId,
  labelKo: umeda!.labelKo,
  lat: umeda!.lat,
  lng: umeda!.lng,
  reelKind: umeda!.kind,
});
assert.ok(projected?.nodeId, "project must upsert Workspace node");

const state = readContextWorkspace(ctx);
assert.ok(state);
assert.ok(
  state!.nodes.some((n) => n.id === projected!.nodeId),
  "node must exist after projection",
);
assert.ok(
  state!.selectedIds.includes(projected!.nodeId) ||
    state!.nodes.find((n) => n.id === projected!.nodeId)?.selected,
  "projected node should be selected for FlyTo",
);

const again = projectRealityJumpToWorkspace({
  contextEventId: ctx,
  placeId: umeda!.placeId,
  labelKo: umeda!.labelKo,
  lat: umeda!.lat,
  lng: umeda!.lng,
  reelKind: umeda!.kind,
});
assert.equal(again?.nodeId, projected!.nodeId, "idempotent upsert");

clearContextWorkspace(ctx);

{
  const shanghai =
    "상하이에는 크게 두 공항이 있습니다. 푸동 국제공항(PVG)과 홍차오 국제공항(SHA)이에요. 푸동은 동쪽에, 홍차오는 서쪽에 있어요.";
  const shTargets = extractRealityJumpTargets(shanghai);
  const pvg = shTargets.find(
    (t) =>
      t.placeId === "geo:cn:shanghai:pvg" || /푸동/u.test(t.labelKo),
  );
  const sha = shTargets.find(
    (t) =>
      t.placeId === "geo:cn:shanghai:sha" || /홍차오/u.test(t.labelKo),
  );
  assert.ok(pvg, "Shanghai PVG must Reality-Jump");
  assert.ok(sha, "Shanghai SHA must Reality-Jump");
  assert.ok(
    pvg!.placeId.includes("pvg") || /공항/u.test(pvg!.labelKo),
    "푸동 should resolve to airport POI not district",
  );
}

console.log("OK — reality-jump + entity projection", {
  count: targets.length,
  essayCount: essayTargets.length,
  labels: essayTargets.map((t) => t.labelKo),
  projectedNodeId: projected!.nodeId,
});
