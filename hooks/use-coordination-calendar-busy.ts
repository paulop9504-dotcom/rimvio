"use client";

import { useSyncExternalStore } from "react";
import {
  getCoordinationCalendarBusySnapshot,
  subscribeCoordinationCalendarBusy,
  syncAgentCoordinationFocusState,
} from "@/lib/globe/market/coordination/agent-negotiation-store";
import { subscribeCoordinationContextSignals } from "@/lib/globe/market/coordination/client/subscribe-coordination-context-signals";
import type { CalendarBusyInterval } from "@/lib/globe/market/coordination/agent-negotiation-slot-chips";

let refreshStarted = false;

function ensureCoordinationContextRefresh(): void {
  if (refreshStarted || typeof window === "undefined") {
    return;
  }
  refreshStarted = true;
  void syncAgentCoordinationFocusState();
  subscribeCoordinationContextSignals(() => {
    void syncAgentCoordinationFocusState();
  });
}

/** Field UI — reads calendar busy from the coordination store snapshot. */
export function useCoordinationCalendarBusy(): CalendarBusyInterval[] {
  ensureCoordinationContextRefresh();
  return useSyncExternalStore(
    subscribeCoordinationCalendarBusy,
    getCoordinationCalendarBusySnapshot,
    () => [],
  );
}
