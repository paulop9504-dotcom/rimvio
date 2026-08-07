/**
 * Reality Jump — extract activatable place spans from AI assistant text.
 * Reuses World Geo seed + Entity Resolver (no parallel Ultimate Parser).
 *
 * Text → Entity → Globe coordinate → Camera focus → Action surface
 */

import { resolveEntities } from "@/lib/entity-resolver/resolve-entities";
import type { ResolvedEntity } from "@/lib/entity-resolver/types";
import { listWorldGeoSeed } from "@/lib/reality-graph/world-geo-seed";
import type { WorldGeoNode } from "@/lib/reality-graph/types";
import type { GlobeResourceReelKind } from "@/lib/globe/resource-reel/types";

export type RealityJumpTarget = {
  readonly labelKo: string;
  readonly placeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly kind: GlobeResourceReelKind;
  readonly span: { readonly start: number; readonly end: number };
  /** Product noun — Projection of Reality onto Globe. */
  readonly jumpKind: "reality_jump";
};

export type RealityJumpTextPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "entity"; readonly text: string; readonly target: RealityJumpTarget };

function reelKindForGeoNode(node: WorldGeoNode): GlobeResourceReelKind {
  const blob = [
    node.labels.ko,
    node.labels.en,
    node.labels.local ?? "",
    ...(node.labels.aliases ?? []),
  ].join(" ");
  if (/hotel|숙소|호텔|료칸|hostel/iu.test(blob)) {
    return "lodging";
  }
  if (/restaurant|맛집|식당|카페|ramen|sushi/iu.test(blob)) {
    return "eatery";
  }
  if (/pharmacy|편의점|atm|병원/iu.test(blob)) {
    return "amenity";
  }
  // Airport · USJ · castle · stations → activity Action Graph path.
  return "activity";
}

function nodeDisplayLabel(node: WorldGeoNode): string {
  return node.labels.ko.trim() || node.labels.en.trim() || node.id;
}

function nodeAliasCandidates(node: WorldGeoNode): string[] {
  const raw = [
    node.labels.ko,
    node.labels.en,
    node.labels.local ?? "",
    ...(node.labels.aliases ?? []),
  ];
  return [
    ...new Set(
      raw
        .map((a) => a.trim())
        .filter((a) => a.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
}

function spansOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function targetsFromWorldGeo(text: string): RealityJumpTarget[] {
  const out: RealityJumpTarget[] = [];
  for (const node of listWorldGeoSeed()) {
    if (
      node.kind === "world" ||
      node.kind === "continent" ||
      node.kind === "country" ||
      node.kind === "prefecture" ||
      node.kind === "metropolis" ||
      node.kind === "city" ||
      node.kind === "ward"
    ) {
      // Prefer POI / station — admin regions steal itinerary title spans (오사카…).
      continue;
    }
    if (
      !Number.isFinite(node.centroid.lat) ||
      !Number.isFinite(node.centroid.lng)
    ) {
      continue;
    }
    for (const alias of nodeAliasCandidates(node)) {
      let from = 0;
      while (from < text.length) {
        const idx = text.indexOf(alias, from);
        if (idx < 0) {
          break;
        }
        const span = { start: idx, end: idx + alias.length };
        const clash = out.some((t) => spansOverlap(t.span, span));
        if (!clash) {
          out.push({
            labelKo: nodeDisplayLabel(node),
            placeId: node.id,
            lat: node.centroid.lat,
            lng: node.centroid.lng,
            kind: reelKindForGeoNode(node),
            span,
            jumpKind: "reality_jump",
          });
        }
        from = idx + alias.length;
      }
    }
  }
  return out;
}

function reelKindFromEntity(entity: ResolvedEntity): GlobeResourceReelKind {
  if (entity.kind === "Hotel") return "lodging";
  if (entity.kind === "Restaurant" || entity.kind === "Brand") return "eatery";
  if (entity.kind === "Airport" || entity.kind === "Station") return "activity";
  if (entity.kind === "Museum" || entity.kind === "Location") return "activity";
  return "activity";
}

function targetsFromResolver(text: string): RealityJumpTarget[] {
  const { entities } = resolveEntities(text);
  const out: RealityJumpTarget[] = [];
  for (const entity of entities) {
    if (
      entity.lat == null ||
      entity.lng == null ||
      !Number.isFinite(entity.lat) ||
      !Number.isFinite(entity.lng)
    ) {
      continue;
    }
    const span = entity.span;
    if (!span || span.end <= span.start) {
      continue;
    }
    out.push({
      labelKo: entity.label,
      placeId: entity.geoId ?? entity.id,
      lat: entity.lat,
      lng: entity.lng,
      kind: reelKindFromEntity(entity),
      span: { start: span.start, end: span.end },
      jumpKind: "reality_jump",
    });
  }
  return out;
}

function jumpPriority(target: RealityJumpTarget): number {
  // POI / airport beats district when span length ties (푸동 → PVG).
  // Use end-anchored codes — avoid `:sha` matching `:shanghai`.
  if (/:(?:pvg|sha|kix|nrt|hnd|icn|gmp|usj)$/iu.test(target.placeId)) {
    return 3;
  }
  if (target.kind === "activity" || target.kind === "amenity") return 2;
  if (target.kind === "lodging" || target.kind === "eatery") return 2;
  return 1;
}

/**
 * Extract Reality Jump targets from assistant / itinerary prose.
 * Longer spans win on overlap; POI beats district on ties.
 */
export function extractRealityJumpTargets(
  text: string,
): readonly RealityJumpTarget[] {
  const raw = text ?? "";
  if (!raw.trim()) {
    return [];
  }
  const merged = [...targetsFromWorldGeo(raw), ...targetsFromResolver(raw)];
  merged.sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    if (lenB !== lenA) return lenB - lenA;
    const prio = jumpPriority(b) - jumpPriority(a);
    if (prio !== 0) return prio;
    return a.span.start - b.span.start;
  });
  const picked: RealityJumpTarget[] = [];
  for (const row of merged) {
    if (picked.some((p) => spansOverlap(p.span, row.span))) {
      continue;
    }
    picked.push(row);
  }
  return picked.sort((a, b) => a.span.start - b.span.start);
}

/** Split text into plain + entity parts for Semantic UI render. */
export function splitTextWithRealityJumps(
  text: string,
): readonly RealityJumpTextPart[] {
  const raw = text ?? "";
  const targets = extractRealityJumpTargets(raw);
  if (targets.length === 0) {
    return raw ? [{ type: "text", text: raw }] : [];
  }
  const parts: RealityJumpTextPart[] = [];
  let cursor = 0;
  for (const target of targets) {
    if (target.span.start > cursor) {
      parts.push({
        type: "text",
        text: raw.slice(cursor, target.span.start),
      });
    }
    parts.push({
      type: "entity",
      text: raw.slice(target.span.start, target.span.end),
      target,
    });
    cursor = target.span.end;
  }
  if (cursor < raw.length) {
    parts.push({ type: "text", text: raw.slice(cursor) });
  }
  return parts;
}
