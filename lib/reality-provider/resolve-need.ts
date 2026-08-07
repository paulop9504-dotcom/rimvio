/**
 * Intent / NL → Need (what to absorb into Workspace).
 */

import type { RealityNeed, RealityNeedId } from "@/lib/reality-provider/types";

function regionFromText(text: string): string | null {
  if (/오사카|osaka/iu.test(text)) return "오사카";
  if (/도쿄|tokyo/iu.test(text)) return "도쿄";
  if (/교토|kyoto/iu.test(text)) return "교토";
  if (/고베|kobe/iu.test(text)) return "고베";
  if (/나고야|nagoya/iu.test(text)) return "나고야";
  if (/후쿠오카|fukuoka/iu.test(text)) return "후쿠오카";
  if (/센다이|sendai/iu.test(text)) return "센다이";
  if (/삿포로|sapporo/iu.test(text)) return "삿포로";
  if (/요코하마|yokohama/iu.test(text)) return "요코하마";
  if (/일본|japan/iu.test(text)) return "일본";
  if (
    /대전|daejeon|서울|seoul|부산|busan|인천|incheon|대구|daegu|광주|gwangju|울산|ulsan|세종|세종시/iu.test(
      text,
    )
  ) {
    // City name → keep concrete label (acquire refuses missing urban metro caches)
    if (/대전|daejeon/iu.test(text)) return "대전";
    if (/서울|seoul/iu.test(text)) return "서울";
    if (/부산|busan/iu.test(text)) return "부산";
    if (/인천|incheon/iu.test(text)) return "인천";
    if (/대구|daegu/iu.test(text)) return "대구";
    if (/광주|gwangju/iu.test(text)) return "광주";
    if (/울산|ulsan/iu.test(text)) return "울산";
    if (/세종/iu.test(text)) return "세종";
  }
  if (/한국|korea|전국\s*노선|한반도/iu.test(text)) return "한국";
  // Overseas metros — recognize region so we fail-soft (never steal Osaka / essay).
  if (/홍콩|hong\s*kong|\bhk\b|港鐵|\bmtr\b/iu.test(text)) return "홍콩";
  if (/상하이|shanghai|上海/iu.test(text)) return "상하이";
  if (/베이징|beijing|北京/iu.test(text)) return "베이징";
  if (/선전|shenzhen|深圳/iu.test(text)) return "선전";
  if (/타이베이|taipei|台北|臺北/iu.test(text)) return "타이베이";
  if (/싱가포르|singapore|sg\s*mrt|\bmrt\b/iu.test(text) && /싱가포르|singapore/iu.test(text)) {
    return "싱가포르";
  }
  if (/방콕|bangkok|BTS|MRT/iu.test(text) && /방콕|bangkok/iu.test(text)) {
    return "방콕";
  }
  if (/뉴욕|new\s*york|\bnyc\b/iu.test(text)) return "뉴욕";
  if (/런던|london/iu.test(text)) return "런던";
  if (/파리|paris/iu.test(text)) return "파리";
  if (/베를린|berlin/iu.test(text)) return "베를린";
  return null;
}

function visibilityFromText(text: string): "show" | "hide" {
  if (/숨겨|꺼|지워|끄|숨김|없애|가려/iu.test(text)) return "hide";
  return "show";
}

/**
 * Returns null when utterance is not an external-world absorb intent
 * (e.g. lodging search stays on ADR-050 Discovery path).
 */
export function resolveRealityNeedFromUtterance(
  text: string,
): RealityNeed | null {
  const utterance = text.trim().replace(/\s+/gu, " ");
  if (!utterance) return null;

  // Do not steal lodging / hotel search
  if (/호텔|숙소|맛집|레스토랑|찾아\s*줘|예약/iu.test(utterance) && !/노선|지하철|메트로|신칸센|JR|철도|KTX/iu.test(utterance)) {
    return null;
  }

  let needId: RealityNeedId | null = null;
  let operatorHint: string | null = null;
  const regionKo = regionFromText(utterance);
  const visibility = visibilityFromText(utterance);

  if (/신칸센|新幹線|shinkansen/iu.test(utterance)) {
    needId = "shinkansen_network";
  } else if (
    /전국\s*노선|한국\s*철도|한국\s*노선|코레일|KTX|SRT|경부고속|호남고속/iu.test(
      utterance,
    )
  ) {
    needId = "rail_network";
    operatorHint = "korail";
  } else if (
    /일본\s*지하철|전국\s*지하철|도쿄\s*메트로|도쿄\s*지하철|japan\s*subway|japan\s*metro/iu.test(
      utterance,
    )
  ) {
    needId = "metro_network";
  } else if (
    /지하철|메트로|전철|미도스지|다니마치|요쓰바시|주오선|센니치|사카이스지|나가호리|이마자토|난코|metro|subway|노선도|노선망|地铁|メトロ|港鐵|\bmtr\b|\bmrt\b/iu.test(
      utterance,
    )
  ) {
    needId = "metro_network";
  } else if (
    /\bJR\b|ＪＲ|재래선|순환선|한큐|한신|긴테쓰|난카이|게이한|철도\s*노선|기차\s*노선/iu.test(
      utterance,
    ) ||
    /(?:오사카|osaka).{0,8}JR|JR.{0,8}(?:오사카|osaka|노선)/iu.test(utterance)
  ) {
    needId = "rail_network";
    if (/\bJR\b|ＪＲ/iu.test(utterance)) operatorHint = "jr";
    else if (/한큐/iu.test(utterance)) operatorHint = "hankyu";
    else if (/한신/iu.test(utterance)) operatorHint = "hanshin";
    else if (/긴테쓰|近鉄/iu.test(utterance)) operatorHint = "kintetsu";
    else if (/난카이/iu.test(utterance)) operatorHint = "nankai";
  } else if (/불꽃|축제|페스티벌|행사|concert|festival/iu.test(utterance)) {
    needId = "event_set";
  } else if (
    /ATM|현금인출|편의점/iu.test(utterance) &&
    /위치|보여|찾아/iu.test(utterance)
  ) {
    needId = "amenity_set";
  } else if (
    /벚꽃|명소|poi\s*set|관광\s*스팟/iu.test(utterance) &&
    /보여|찾아|깔/iu.test(utterance)
  ) {
    needId = "poi_set";
  }

  if (!needId) return null;

  // Network absorb needs a map verb / line cue — avoid stealing chat mentions
  if (
    needId === "rail_network" ||
    needId === "metro_network" ||
    needId === "shinkansen_network"
  ) {
    const shortSolo =
      /^(?:지하철|메트로|subway|metro|노선|노선도|JR|ＪＲ|신칸센|철도|地铁|港鐵|mtr|mrt)$/iu.test(
        utterance,
      );
    const mapish =
      /표시|보여|켜|그려|띄워|올려|숨겨|꺼|지워|끄|숨김|없애|가려|깔|노선|선|線|找|찾아|搜|线|\bline\b|map|전부|전체|해줘|해바|해봐|해죠|깔아줘|깔아놔|보여줘|켜줘|띄워줘|올려줘|찾아줘/iu.test(
        utterance,
      );
    if (!shortSolo && !mapish) return null;
  }

  return {
    needId,
    regionKo:
      needId === "rail_network" && operatorHint === "korail"
        ? regionKo ?? "한국"
        : regionKo,
    operatorHint,
    utterance,
    visibility,
  };
}
