"use client";

import { hasActiveCalendarStudyFocus } from "@/lib/globe/market/coordination/read-user-focus-defer";
import { getRecentKnowledgeEntities } from "@/lib/knowledge/knowledge-entity-db";
import { FIXED_CALENDAR_CONTAINER_ID } from "@/lib/knowledge/knowledge-entity-types";
import type { KnowledgeEntity } from "@/lib/knowledge/knowledge-entity-types";

/** Must match `FOCUS_SESSION_STORAGE_KEY` in action-chat focus-session-store. */
const FOCUS_SESSION_STORAGE_KEY = "rimvio.focus-session.v1";

function isFocusSessionRunning(now = Date.now()): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const raw = window.sessionStorage.getItem(FOCUS_SESSION_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const session = JSON.parse(raw) as { status?: string; endsAt?: string };
    if (!session?.status || session.status !== "running") {
      return false;
    }
    const endsAtMs = new Date(session.endsAt ?? "").getTime();
    return Number.isFinite(endsAtMs) && endsAtMs > now;
  } catch {
    return false;
  }
}

let cachedStudyFocusActive = false;

export function readUserFocusDeferringNegotiationSync(): boolean {
  return isFocusSessionRunning() || cachedStudyFocusActive;
}

export function resolveUserFocusDeferringNegotiation(
  entities: readonly KnowledgeEntity[],
  now = new Date(),
): boolean {
  if (isFocusSessionRunning(now.getTime())) {
    cachedStudyFocusActive = true;
    return true;
  }
  cachedStudyFocusActive = hasActiveCalendarStudyFocus(entities, now);
  return cachedStudyFocusActive;
}

export async function refreshUserFocusDeferringNegotiation(
  now = new Date(),
): Promise<boolean> {
  if (isFocusSessionRunning(now.getTime())) {
    cachedStudyFocusActive = true;
    return true;
  }
  const entities = await getRecentKnowledgeEntities({
    containerId: FIXED_CALENDAR_CONTAINER_ID,
    limit: 40,
  });
  return resolveUserFocusDeferringNegotiation(entities, now);
}
