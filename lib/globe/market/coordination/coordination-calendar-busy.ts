import type { CalendarEventChip } from "@/lib/calendar/calendar-view-types";
import { projectKnowledgeCalendarChips } from "@/lib/calendar/project-knowledge-calendar-chips";
import type { EventCalendarRow } from "@/lib/events/project-event-calendar";
import { projectEventCalendarChips } from "@/lib/events/project-event-calendar";
import type { KnowledgeEntity } from "@/lib/knowledge/knowledge-entity-types";
import { buildMeetTimeQuestion } from "@/lib/globe/market/coordination/agent-negotiation-room-engine";
import type { AgentNegotiationRoomRecord } from "@/lib/globe/market/coordination/agent-negotiation-types";
import {
  extractCalendarBusyIntervalsFromOverlayRows,
  type CalendarBusyInterval,
} from "@/lib/globe/market/coordination/agent-negotiation-slot-chips";

/** Wire format for PATCH start/tick — small ISO snapshot. */
export type CalendarBusyIntervalWire = {
  start: string;
  end: string;
};

export function serializeCalendarBusyIntervals(
  intervals: readonly CalendarBusyInterval[],
): CalendarBusyIntervalWire[] {
  return intervals.map((interval) => ({
    start: new Date(interval.startMs).toISOString(),
    end: new Date(interval.endMs).toISOString(),
  }));
}

export function parseCalendarBusyIntervalWire(
  value: unknown,
): CalendarBusyInterval[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const intervals: CalendarBusyInterval[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const start = (row as { start?: unknown }).start;
    const end = (row as { end?: unknown }).end;
    if (typeof start !== "string" || typeof end !== "string") {
      continue;
    }
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }
    intervals.push({ startMs, endMs });
  }
  return intervals.sort((left, right) => left.startMs - right.startMs);
}

function busyIntervalsFromCalendarChips(
  chips: readonly CalendarEventChip[],
): CalendarBusyInterval[] {
  return extractCalendarBusyIntervalsFromOverlayRows(
    chips.map((chip) => ({
      id: chip.id,
      event: chip,
      overlayActions: [],
    })),
  );
}

/** Unified overlay — Event SSOT (Google Calendar sync) + knowledge calendar container. */
export function buildCoordinationCalendarBusy(input: {
  knowledgeEntities: readonly KnowledgeEntity[];
  eventCalendarRows?: readonly EventCalendarRow[];
  now?: Date;
}): CalendarBusyInterval[] {
  const now = input.now ?? new Date();
  const eventChips = projectEventCalendarChips(input.eventCalendarRows ?? [], now);
  const knowledgeChips = projectKnowledgeCalendarChips(input.knowledgeEntities, now);
  return busyIntervalsFromCalendarChips([...eventChips, ...knowledgeChips]);
}

export function buildCalendarBusyFromKnowledgeEntities(
  entities: readonly KnowledgeEntity[],
  now = new Date(),
): CalendarBusyInterval[] {
  return buildCoordinationCalendarBusy({ knowledgeEntities: entities, now });
}

export function mergeCalendarBusyIntoRoom(
  room: AgentNegotiationRoomRecord,
  calendarBusyIntervals: readonly CalendarBusyInterval[] | undefined,
): AgentNegotiationRoomRecord {
  if (!calendarBusyIntervals?.length) {
    return room;
  }
  const next: AgentNegotiationRoomRecord = {
    ...room,
    calendarBusyIntervals,
  };
  return refreshCoordinationRoomMeetSlotChips(next);
}

export function refreshCoordinationRoomMeetSlotChips(
  room: AgentNegotiationRoomRecord,
): AgentNegotiationRoomRecord {
  const question = room.pendingQuestion;
  if (!question || question.slotKey !== "meet_time_label") {
    return room;
  }
  const refreshed = buildMeetTimeQuestion(question.ownerRole, {
    availabilityPreset: room.availabilityPreset,
    calendarBusyIntervals: room.calendarBusyIntervals,
    priceMinKrw: room.priceMinKrw,
    priceMaxKrw: room.priceMaxKrw,
  });
  return {
    ...room,
    pendingQuestion: {
      ...question,
      chips: refreshed.chips,
    },
  };
}
