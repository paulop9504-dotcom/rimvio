"use client";

import { FOCUS_SESSION_UPDATED } from "@/lib/action-chat/mention-focus/focus-session-store";
import { EVENT_CANDIDATES_UPDATED } from "@/lib/life-read-model/candidates-updated";
import { KNOWLEDGE_ENTITY_UPDATED } from "@/lib/knowledge/knowledge-entity-db";

export type CoordinationContextSignalOptions = {
  /** Include focus-session changes (default true). */
  includeFocusSession?: boolean;
  /** Debounce rapid calendar/knowledge bursts (default 150ms). */
  debounceMs?: number;
};

/** One subscriber for focus + calendar/knowledge invalidation signals. */
export function subscribeCoordinationContextSignals(
  onChange: () => void,
  options?: CoordinationContextSignalOptions,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const includeFocusSession = options?.includeFocusSession !== false;
  const debounceMs = options?.debounceMs ?? 150;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => {
    if (debounceMs <= 0) {
      onChange();
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };

  window.addEventListener(KNOWLEDGE_ENTITY_UPDATED, emit);
  window.addEventListener(EVENT_CANDIDATES_UPDATED, emit);
  if (includeFocusSession) {
    window.addEventListener(FOCUS_SESSION_UPDATED, emit);
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    window.removeEventListener(KNOWLEDGE_ENTITY_UPDATED, emit);
    window.removeEventListener(EVENT_CANDIDATES_UPDATED, emit);
    if (includeFocusSession) {
      window.removeEventListener(FOCUS_SESSION_UPDATED, emit);
    }
  };
}
