"use client";

import { AGENT_NEGOTIATION_FOCUS_DEFER_MESSAGE_KO } from "@/lib/globe/market/coordination/agent-coordination-focus-copy";
import type { CalendarBusyIntervalWire } from "@/lib/globe/market/coordination/coordination-calendar-busy";
import {
  buildCoordinationCalendarBusy,
  serializeCalendarBusyIntervals,
} from "@/lib/globe/market/coordination/coordination-calendar-busy";
import { resolveUserFocusDeferringNegotiation } from "@/lib/globe/market/coordination/client/read-user-focus-defer-client";
import { listEventCalendarRows } from "@/lib/events/project-event-calendar";
import { syncGoogleCalendarToEventStore } from "@/lib/google-calendar/client-sync";
import { getRecentKnowledgeEntities } from "@/lib/knowledge/knowledge-entity-db";
import { FIXED_CALENDAR_CONTAINER_ID } from "@/lib/knowledge/knowledge-entity-types";
import type { KnowledgeEntity } from "@/lib/knowledge/knowledge-entity-types";

export type CoordinationPatchContext = {
  calendarBusyIntervals: CalendarBusyIntervalWire[];
  focusActive: boolean;
  focusDeferMessageKo: string;
};

/** Single knowledge fetch → busy intervals + focus defer in one read pipeline. */
export async function readCoordinationPatchContext(options?: {
  refreshGoogle?: boolean;
  now?: Date;
}): Promise<CoordinationPatchContext> {
  const now = options?.now ?? new Date();
  if (options?.refreshGoogle) {
    try {
      await syncGoogleCalendarToEventStore();
    } catch {
      // Not connected or sync failed — still use local Event SSOT + knowledge.
    }
  }

  const entities = await getRecentKnowledgeEntities({
    containerId: FIXED_CALENDAR_CONTAINER_ID,
    limit: 40,
  });
  return buildCoordinationPatchContextFromEntities(entities, now);
}

export function buildCoordinationPatchContextFromEntities(
  entities: readonly KnowledgeEntity[],
  now = new Date(),
): CoordinationPatchContext {
  const busyIntervals = buildCoordinationCalendarBusy({
    knowledgeEntities: entities,
    eventCalendarRows: listEventCalendarRows(),
    now,
  });
  return {
    calendarBusyIntervals: serializeCalendarBusyIntervals(busyIntervals),
    focusActive: resolveUserFocusDeferringNegotiation(entities, now),
    focusDeferMessageKo: AGENT_NEGOTIATION_FOCUS_DEFER_MESSAGE_KO,
  };
}
