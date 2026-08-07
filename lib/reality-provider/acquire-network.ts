/**
 * Acquire network Needs via `cached_overlay` Provider adapters.
 * Existing GeoJSON catalogs are adapters — not separate Runtimes.
 */

import {
  OSAKA_JR_LINE_CATALOG,
  OSAKA_JR_STATIONS,
} from "@/lib/geo/osaka-jr";
import {
  OSAKA_METRO_LINE_CATALOG,
  resolveOsakaMetroLineIdFromText,
} from "@/lib/geo/osaka-metro/line-catalog";
import { OSAKA_METRO_STATIONS } from "@/lib/geo/osaka-metro/station-catalog";
import {
  JAPAN_METRO_LINE_CATALOG,
  resolveJapanMetroLineIdFromText,
} from "@/lib/geo/japan-metro/line-catalog";
import {
  JAPAN_SHINKANSEN_LINE_CATALOG,
  resolveJapanShinkansenLineIdFromText,
} from "@/lib/geo/japan-shinkansen/line-catalog";
import {
  KOREA_RAIL_LINE_CATALOG,
  resolveKoreaRailLineIdFromText,
} from "@/lib/geo/korea-rail/line-catalog";
import type { RealityNeed, RealityProviderId } from "@/lib/reality-provider/types";
import type { RealityRailNetworkBundle } from "@/lib/reality-provider/normalize-types";

export type AcquireNetworkResult =
  | {
      readonly ok: true;
      readonly providerId: RealityProviderId;
      readonly bundle: RealityRailNetworkBundle;
    }
  | {
      readonly ok: false;
      readonly providerId: RealityProviderId;
      readonly reasonKo: string;
    };

function osakaJrBundle(): RealityRailNetworkBundle {
  return {
    providerId: "cached_overlay",
    regionKo: "오사카",
    family: "osaka_jr",
    labelKo: "오사카 JR",
    lines: OSAKA_JR_LINE_CATALOG.map((e) => ({
      id: e.id,
      kind: "line" as const,
      titleKo: e.labelKo,
      shortLabelKo: e.shortLabelKo,
      color: e.color,
      operatorHint: "jr",
    })),
    stations: OSAKA_JR_STATIONS.map((s) => ({
      id: s.id,
      kind: "station" as const,
      titleKo: s.nameKo,
      lat: s.lat,
      lng: s.lng,
      lineIds: [...s.lineIds],
      hub: Boolean(s.hub),
    })),
  };
}

function osakaMetroBundle(utterance: string): RealityRailNetworkBundle {
  const lineId = resolveOsakaMetroLineIdFromText(utterance);
  const lines = lineId
    ? OSAKA_METRO_LINE_CATALOG.filter((e) => e.id === lineId)
    : OSAKA_METRO_LINE_CATALOG;
  const lineIds = new Set(lines.map((e) => e.id));
  return {
    providerId: "cached_overlay",
    regionKo: "오사카",
    family: "osaka_metro",
    labelKo: lineId
      ? (OSAKA_METRO_LINE_CATALOG.find((e) => e.id === lineId)?.labelKo ??
        "오사카 메트로")
      : "오사카 메트로",
    lines: lines.map((e) => ({
      id: e.id,
      kind: "line" as const,
      titleKo: e.labelKo,
      shortLabelKo: e.shortLabelKo,
      color: e.color,
      operatorHint: "metro",
    })),
    stations: OSAKA_METRO_STATIONS.filter(
      (s) => s.hub && s.lineIds.some((id) => lineIds.has(id)),
    ).map((s) => ({
      id: s.id,
      kind: "station" as const,
      titleKo: s.nameKo,
      lat: s.lat,
      lng: s.lng,
      lineIds: [...s.lineIds],
      hub: true,
    })),
  };
}

function japanMetroBundle(
  regionKo: string | null,
  utterance: string,
): RealityRailNetworkBundle {
  const lineId = resolveJapanMetroLineIdFromText(utterance);
  const city =
    regionKo === "도쿄" ? "도쿄" : regionKo === "일본" ? null : regionKo;
  let lines = city
    ? JAPAN_METRO_LINE_CATALOG.filter((e) => e.cityKo === city)
    : JAPAN_METRO_LINE_CATALOG;
  if (lineId) lines = JAPAN_METRO_LINE_CATALOG.filter((e) => e.id === lineId);
  return {
    providerId: "cached_overlay",
    regionKo: regionKo ?? "일본",
    family: "japan_metro",
    labelKo: lineId
      ? (JAPAN_METRO_LINE_CATALOG.find((e) => e.id === lineId)?.labelKo ??
        "일본 지하철")
      : city
        ? `${city} 지하철`
        : "일본 지하철",
    lines: lines.map((e) => ({
      id: e.id,
      kind: "line" as const,
      titleKo: e.labelKo,
      shortLabelKo: e.labelKo.replace(/선$/u, ""),
      color: e.color,
      operatorHint: "metro",
    })),
    stations: [],
  };
}

function shinkansenBundle(utterance: string): RealityRailNetworkBundle {
  const lineId = resolveJapanShinkansenLineIdFromText(utterance);
  const lines = lineId
    ? JAPAN_SHINKANSEN_LINE_CATALOG.filter((e) => e.id === lineId)
    : JAPAN_SHINKANSEN_LINE_CATALOG;
  return {
    providerId: "cached_overlay",
    regionKo: "일본",
    family: "shinkansen",
    labelKo: lineId
      ? (JAPAN_SHINKANSEN_LINE_CATALOG.find((e) => e.id === lineId)?.labelKo ??
        "신칸센")
      : "신칸센",
    lines: lines.map((e) => ({
      id: e.id,
      kind: "line" as const,
      titleKo: e.labelKo,
      shortLabelKo: e.shortLabelKo,
      color: e.color,
      operatorHint: "shinkansen",
    })),
    stations: [],
  };
}

function koreaRailBundle(utterance: string): RealityRailNetworkBundle {
  const lineId = resolveKoreaRailLineIdFromText(utterance);
  const lines = lineId
    ? KOREA_RAIL_LINE_CATALOG.filter((e) => e.id === lineId)
    : KOREA_RAIL_LINE_CATALOG;
  return {
    providerId: "cached_overlay",
    regionKo: "한국",
    family: "korea_rail",
    labelKo: lineId
      ? (KOREA_RAIL_LINE_CATALOG.find((e) => e.id === lineId)?.labelKo ??
        "한국 철도")
      : "한국 철도",
    lines: lines.map((e) => ({
      id: e.id,
      kind: "line" as const,
      titleKo: e.labelKo,
      shortLabelKo: e.labelKo.replace(/^KTX\s*/u, "").replace(/\s*선$/u, ""),
      color: e.color,
      operatorHint: "korail",
    })),
    stations: [],
  };
}

function acquireCached(need: RealityNeed): AcquireNetworkResult {
  if (need.needId === "shinkansen_network") {
    return {
      ok: true,
      providerId: "cached_overlay",
      bundle: shinkansenBundle(need.utterance),
    };
  }
  if (need.needId === "metro_network") {
    const japan =
      need.regionKo === "일본" ||
      need.regionKo === "도쿄" ||
      /일본\s*지하철|도쿄\s*메트로|japan\s*metro/iu.test(need.utterance);
    if (japan) {
      return {
        ok: true,
        providerId: "cached_overlay",
        bundle: japanMetroBundle(need.regionKo ?? "일본", need.utterance),
      };
    }
    // Korean + overseas urban metros — no city cache wired yet.
    // Never fall back to Osaka map or LLM essay.
    const uncachedUrban =
      need.regionKo === "한국" ||
      need.regionKo === "대전" ||
      need.regionKo === "서울" ||
      need.regionKo === "부산" ||
      need.regionKo === "인천" ||
      need.regionKo === "대구" ||
      need.regionKo === "광주" ||
      need.regionKo === "울산" ||
      need.regionKo === "세종" ||
      need.regionKo === "홍콩" ||
      need.regionKo === "상하이" ||
      need.regionKo === "베이징" ||
      need.regionKo === "선전" ||
      need.regionKo === "타이베이" ||
      need.regionKo === "싱가포르" ||
      need.regionKo === "방콕" ||
      need.regionKo === "뉴욕" ||
      need.regionKo === "런던" ||
      need.regionKo === "파리" ||
      need.regionKo === "베를린" ||
      /대전|서울|부산|인천|대구|광주|울산|세종|한국|홍콩|hong\s*kong|\bmtr\b|상하이|shanghai|上海|베이징|beijing|선전|타이베이|싱가포르|방콕|뉴욕|런던|파리|베를린|地铁/iu.test(
        need.utterance,
      );
    if (uncachedUrban) {
      const label = need.regionKo?.trim() || "이 도시";
      return {
        ok: false,
        providerId: "cached_overlay",
        reasonKo: `${label} 도시철 캐시는 아직 없어요 · 지금은 오사카·일본 메트로만 지도에 깔아요`,
      };
    }
    return {
      ok: true,
      providerId: "cached_overlay",
      bundle: osakaMetroBundle(need.utterance),
    };
  }
  if (need.needId === "rail_network") {
    const korea =
      need.regionKo === "한국" ||
      need.operatorHint === "korail" ||
      /전국\s*노선|한국|KTX|SRT/iu.test(need.utterance);
    if (korea) {
      return {
        ok: true,
        providerId: "cached_overlay",
        bundle: koreaRailBundle(need.utterance),
      };
    }
    return {
      ok: true,
      providerId: "cached_overlay",
      bundle: osakaJrBundle(),
    };
  }
  return {
    ok: false,
    providerId: "cached_overlay",
    reasonKo: `Need ${need.needId} 캐시 어댑터 없음`,
  };
}

/**
 * Acquire network Reality for a Need + Provider candidate.
 */
export function acquireNetwork(input: {
  readonly need: RealityNeed;
  readonly providerId: RealityProviderId;
}): AcquireNetworkResult {
  const { need, providerId } = input;

  if (providerId === "gtfs" || providerId === "osm") {
    return {
      ok: false,
      providerId,
      reasonKo: `${providerId} 미연결 · 캐시 오버레이로 전환`,
    };
  }

  if (providerId === "cached_overlay") {
    return acquireCached(need);
  }

  return {
    ok: false,
    providerId,
    reasonKo: `Provider ${providerId} 미지원 (network)`,
  };
}

/** @deprecated use acquireNetwork */
export const acquireRailNetwork = acquireNetwork;
export type AcquireRailResult = AcquireNetworkResult;
