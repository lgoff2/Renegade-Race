import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { action } from "./_generated/server"
import { checkAdmin } from "./admin"
import { ErrorCode, throwError } from "./errors"
import {
  classificationToEntries,
  flattenSpeedhiveSessions,
  isRaceSessionType,
  type ListedRaceSession,
  normalizeResultStatus,
  type SpeedhiveGroupNode,
  type SpeedhiveSessionNode,
  selectRaceSessions,
  speedhiveSessionUrl,
} from "./reliabilityMetrics"

const SPEEDHIVE_BASE = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults"
const NUMERIC_ID = /^\d+$/

type SpeedhiveEvent = {
  id: number
  name: string
  startDate?: string
  location?: { name?: string }
  organization?: { name?: string }
  sessions?: {
    sessions?: SpeedhiveSessionNode[]
    groups?: SpeedhiveGroupNode[]
  }
}

export type SpeedhiveEventPreview = {
  eventId: string
  eventName: string
  trackName: string
  date: string
  organizationName?: string
  sessions: ListedRaceSession[]
}

function numericId(value: string, label: string): string {
  const trimmed = value.trim()
  if (!NUMERIC_ID.test(trimmed)) {
    throwError(ErrorCode.INVALID_INPUT, `${label} must be a numeric Speedhive id`)
  }
  return trimmed
}

async function speedhiveJson<T>(path: string): Promise<T> {
  const response = await fetch(`${SPEEDHIVE_BASE}${path}`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) {
    throwError(ErrorCode.INVALID_INPUT, `Speedhive request failed (${response.status})`)
  }
  return (await response.json()) as T
}

function sessionDate(session: { startTime?: string }, event: SpeedhiveEvent): string {
  const raw = session.startTime || event.startDate || ""
  return raw.slice(0, 10)
}

export const listEventSessions = action({
  args: { eventId: v.string() },
  handler: async (ctx, args): Promise<SpeedhiveEventPreview> => {
    await checkAdmin(ctx)
    const eventId = numericId(args.eventId, "Event id")
    const event = await speedhiveJson<SpeedhiveEvent>(`/events/${eventId}?sessions=true`)
    return {
      eventId: String(event.id ?? eventId),
      eventName: event.name,
      trackName: event.location?.name ?? "",
      date: event.startDate ?? "",
      organizationName: event.organization?.name,
      sessions: selectRaceSessions(event.sessions ?? {}),
    }
  },
})

export const importSession = action({
  args: {
    eventId: v.string(),
    sessionId: v.string(),
    seriesId: v.id("raceSeries"),
    raceEventId: v.optional(v.id("raceEvents")),
  },
  handler: async (ctx, args): Promise<{ sessionId: Id<"timingSessions">; entryCount: number }> => {
    const identity = await checkAdmin(ctx)
    const eventId = numericId(args.eventId, "Event id")
    const sessionId = numericId(args.sessionId, "Session id")
    const event = await speedhiveJson<SpeedhiveEvent>(`/events/${eventId}?sessions=true`)
    const raw = flattenSpeedhiveSessions(event.sessions ?? {}).find(
      (session) => String(session.id) === sessionId
    )
    if (!(raw && isRaceSessionType(raw.type))) {
      throwError(ErrorCode.INVALID_INPUT, "That session is not a race on this event")
    }
    if (raw.eventId && String(raw.eventId) !== eventId) {
      throwError(ErrorCode.INVALID_INPUT, "Session does not belong to this event")
    }

    const classification = await speedhiveJson<Parameters<typeof classificationToEntries>[0]>(
      `/sessions/${sessionId}/classification`
    )
    const entries = classificationToEntries(classification)
    if (entries.length === 0) {
      throwError(ErrorCode.INVALID_INPUT, "Speedhive returned no classification rows")
    }

    const date = sessionDate(raw, event)
    return await ctx.runMutation(internal.timingResults.upsertImportedSession, {
      source: "speedhive",
      seriesId: args.seriesId,
      externalEventId: eventId,
      externalSessionId: sessionId,
      eventName: event.name || "Speedhive event",
      sessionName: raw.name?.trim() || "Race",
      trackName: event.location?.name || "Unknown track",
      date,
      resultStatus: normalizeResultStatus(raw.resultStatus),
      sourceUrl: speedhiveSessionUrl(sessionId),
      importedBy: identity.subject,
      raceEventId: args.raceEventId,
      entries: entries.map((entry) => ({
        carNumber: entry.carNumber,
        teamNameRaw: entry.teamNameRaw,
        ...(entry.vehicleRaw ? { vehicleRaw: entry.vehicleRaw } : {}),
        className: entry.className,
        posOverall: entry.posOverall,
        posInClass: entry.posInClass,
        laps: entry.laps,
        statusRaw: entry.statusRaw,
        ...(entry.transponder ? { transponder: entry.transponder } : {}),
      })),
    })
  },
})
