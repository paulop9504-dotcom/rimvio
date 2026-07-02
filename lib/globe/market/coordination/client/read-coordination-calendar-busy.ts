"use client";

import { buildCoordinationCalendarBusy } from "@/lib/globe/market/coordination/coordination-calendar-busy";
import type { CalendarBusyInterval } from "@/lib/globe/market/coordination/agent-negotiation-slot-chips";
import { listEventCalendarRows } from "@/lib/events/project-event-calendar";
import { syncGoogleCalendarToEventStore } from "@/lib/google-calendar/client-sync";
import { getRecentKnowledgeEntities } from "@/lib/knowledge/knowledge-entity-db";
import { FIXED_CALENDAR_CONTAINER_ID } from "@/lib/knowledge/knowledge-entity-types";
import type { KnowledgeEntity } from "@/lib/knowledge/knowledge-entity-types";

export function buildCoordinationCalendarBusyFromEntities(
  entities: readonly KnowledgeEntity[],
  now = new Date(),
): CalendarBusyInterval[] {
  return buildCoordinationCalendarBusy({
    knowledgeEntities: entities,
    eventCalendarRows: listEventCalendarRows(),
    now,
  });
}

export async function fetchCoordinationCalendarBusyIntervals(
  now = new Date(),
  options?: { refreshGoogle?: boolean; knowledgeEntities?: readonly KnowledgeEntity[] },
): Promise<CalendarBusyInterval[]> {
  if (options?.refreshGoogle) {
    try {
      await syncGoogleCalendarToEventStore();
    } catch {
      // Not connected or sync failed — still use local Event SSOT + knowledge.
    }
  }

  const entities =
    options?.knowledgeEntities ??
    (await getRecentKnowledgeEntities({
      containerId: FIXED_CALENDAR_CONTAINER_ID,
      limit: 40,
    }));
  return buildCoordinationCalendarBusyFromEntities(entities, now);
}
