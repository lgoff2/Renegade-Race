import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server"
import { checkAdmin } from "./admin"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import {
  clampDnfFraction,
  type DerivedEntry,
  deriveEntries,
  type NormalizedEntry,
  parseResultsCsv,
} from "./reliabilityMetrics"
import { assertYyyyMmDd } from "./seatHelpers"
import { applyVerifiedLinks } from "./teamResultLinks"

const MAX_CSV_CHARS = 500_000
const MAX_ROWS = 500
const HTTP_URL = /^https?:\/\//i

const normalizedEntryValidator = v.object({
  carNumber: v.string(),
  teamNameRaw: v.string(),
  vehicleRaw: v.optional(v.string()),
  className: v.string(),
  posOverall: v.number(),
  posInClass: v.number(),
  laps: v.number(),
  statusRaw: v.string(),
  transponder: v.optional(v.string()),
})

function requiredText(value: string, field: string, max = 200): string {
  const trimmed = value.trim()
  if (!trimmed) throwError(ErrorCode.INVALID_INPUT, `${field} is required`)
  return trimmed.slice(0, max)
}

function assertSourceUrl(url: string): string {
  const trimmed = url.trim()
  if (!HTTP_URL.test(trimmed)) {
    throwError(ErrorCode.INVALID_INPUT, "Source URL must start with http:// or https://")
  }
  return trimmed.slice(0, 500)
}

async function assertSameSeriesEvent(
  ctx: MutationCtx,
  seriesId: Id<"raceSeries">,
  raceEventId: Id<"raceEvents"> | undefined
) {
  if (!raceEventId) return
  const event = await ctx.db.get(raceEventId)
  if (!event) throwError(ErrorCode.NOT_FOUND, "Race event not found")
  if (event.seriesId !== seriesId) {
    throwError(ErrorCode.INVALID_INPUT, "Race event belongs to a different series")
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

function derivedFields(row: DerivedEntry) {
  return {
    carNumber: row.carNumber,
    teamNameRaw: row.teamNameRaw,
    vehicleRaw: row.vehicleRaw,
    class: row.className,
    posOverall: row.posOverall,
    posInClass: row.posInClass,
    laps: row.laps,
    statusRaw: row.statusRaw,
    transponder: row.transponder,
    classStarters: row.classStarters,
    classWinnerLaps: row.classWinnerLaps,
    finishPctile: row.finishPctile,
    lapsPctClassWinner: row.lapsPctClassWinner,
    isStart: row.isStart,
    isDnf: row.isDnf,
    dnfReason: row.dnfReason,
  }
}

function toNormalized(entry: Doc<"sessionEntries">): NormalizedEntry {
  return {
    carNumber: entry.carNumber,
    teamNameRaw: entry.teamNameRaw,
    vehicleRaw: entry.vehicleRaw,
    className: entry.class,
    posOverall: entry.posOverall,
    posInClass: entry.posInClass,
    laps: entry.laps,
    statusRaw: entry.statusRaw,
    transponder: entry.transponder,
  }
}

async function fractionForSeries(ctx: MutationCtx, seriesId: Id<"raceSeries">) {
  const series = await ctx.db.get(seriesId)
  if (!series) throwError(ErrorCode.NOT_FOUND, "Race series not found")
  return clampDnfFraction(series.dnfLapThreshold)
}

async function writeSessionEntries(
  ctx: MutationCtx,
  target: { sessionId: Id<"timingSessions">; seriesId: Id<"raceSeries"> },
  rows: NormalizedEntry[],
  fraction: number
) {
  if (rows.length > MAX_ROWS) {
    throwError(ErrorCode.INVALID_INPUT, `A session can include at most ${MAX_ROWS} cars`)
  }
  const derived = deriveEntries(rows, fraction)
  const existing = await ctx.db
    .query("sessionEntries")
    .withIndex("by_session", (q) => q.eq("sessionId", target.sessionId))
    .collect()
  const used = new Set<string>()

  for (const row of derived) {
    const match = existing.find(
      (entry) =>
        !used.has(entry._id) && entry.carNumber === row.carNumber && entry.class === row.className
    )
    const fields = stripUndefined(derivedFields(row))
    if (match) {
      used.add(match._id)
      await ctx.db.patch(match._id, fields)
      continue
    }
    await ctx.db.insert("sessionEntries", {
      sessionId: target.sessionId,
      seriesId: target.seriesId,
      ...fields,
    })
  }

  for (const entry of existing) {
    if (!used.has(entry._id)) await ctx.db.delete(entry._id)
  }
  await applyVerifiedLinks(ctx, target.seriesId)
}

export async function rederiveSeries(ctx: MutationCtx, seriesId: Id<"raceSeries">) {
  const fraction = await fractionForSeries(ctx, seriesId)
  const sessions = await ctx.db
    .query("timingSessions")
    .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
    .collect()
  for (const session of sessions) {
    const entries = await ctx.db
      .query("sessionEntries")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect()
    const derived = deriveEntries(entries.map(toNormalized), fraction)
    for (let index = 0; index < entries.length; index++) {
      const current = entries[index]
      const next = derived[index]
      if (!(current && next)) continue
      await ctx.db.patch(current._id, stripUndefined(derivedFields(next)))
    }
  }
  await applyVerifiedLinks(ctx, seriesId)
}

const sessionArgs = {
  seriesId: v.id("raceSeries"),
  externalEventId: v.optional(v.string()),
  externalSessionId: v.optional(v.string()),
  eventName: v.string(),
  sessionName: v.string(),
  trackName: v.string(),
  date: v.string(),
  resultStatus: v.union(v.literal("official"), v.literal("provisional")),
  sourceUrl: v.string(),
  importedBy: v.string(),
  raceEventId: v.optional(v.id("raceEvents")),
  entries: v.array(normalizedEntryValidator),
}

type ImportedSessionArgs = {
  source: "speedhive" | "csv"
  seriesId: Id<"raceSeries">
  externalEventId?: string
  externalSessionId?: string
  eventName: string
  sessionName: string
  trackName: string
  date: string
  resultStatus: "official" | "provisional"
  sourceUrl: string
  importedBy: string
  raceEventId?: Id<"raceEvents">
  entries: NormalizedEntry[]
}

async function saveImportedSession(ctx: MutationCtx, args: ImportedSessionArgs) {
  await assertSameSeriesEvent(ctx, args.seriesId, args.raceEventId)
  assertYyyyMmDd(args.date, "Session date")
  const fraction = await fractionForSeries(ctx, args.seriesId)
  const now = Date.now()
  const fields = {
    source: args.source,
    seriesId: args.seriesId,
    externalEventId: args.externalEventId,
    externalSessionId: args.externalSessionId,
    eventName: requiredText(args.eventName, "Event name"),
    sessionName: requiredText(args.sessionName, "Session name"),
    trackName: requiredText(args.trackName, "Track"),
    date: args.date,
    resultStatus: args.resultStatus,
    sourceUrl: assertSourceUrl(args.sourceUrl),
    importedAt: now,
    importedBy: args.importedBy,
    raceEventId: args.raceEventId,
  }

  let sessionId: Id<"timingSessions">
  if (args.source === "speedhive" && args.externalSessionId) {
    const existing = await ctx.db
      .query("timingSessions")
      .withIndex("by_source_external_session", (q) =>
        q.eq("source", "speedhive").eq("externalSessionId", args.externalSessionId)
      )
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, fields)
      sessionId = existing._id
    } else {
      sessionId = await ctx.db.insert("timingSessions", fields)
    }
  } else {
    sessionId = await ctx.db.insert("timingSessions", fields)
  }

  await writeSessionEntries(
    ctx,
    { sessionId, seriesId: args.seriesId },
    args.entries,
    fraction
  )
  const entries = await ctx.db
    .query("sessionEntries")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect()
  return { sessionId, entryCount: entries.length }
}

export const upsertImportedSession = internalMutation({
  args: {
    source: v.union(v.literal("speedhive"), v.literal("csv")),
    ...sessionArgs,
  },
  handler: async (ctx, args) => await saveImportedSession(ctx, args),
})

export const importCsv = mutation({
  args: {
    seriesId: v.id("raceSeries"),
    eventName: v.string(),
    sessionName: v.string(),
    trackName: v.string(),
    date: v.string(),
    resultStatus: v.union(v.literal("official"), v.literal("provisional")),
    sourceUrl: v.string(),
    raceEventId: v.optional(v.id("raceEvents")),
    csvText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await checkAdmin(ctx)
    await rateLimiter.limit(ctx, "updateProfile", { key: identity.subject, throws: true })
    if (args.csvText.length > MAX_CSV_CHARS) {
      throwError(ErrorCode.INVALID_INPUT, "CSV file is too large")
    }
    const entries = parseResultsCsv(args.csvText)
    if (entries.length === 0) {
      throwError(ErrorCode.INVALID_INPUT, "CSV did not include any results")
    }
    return await saveImportedSession(ctx, {
      source: "csv",
      seriesId: args.seriesId,
      eventName: args.eventName,
      sessionName: args.sessionName,
      trackName: args.trackName,
      date: args.date,
      resultStatus: args.resultStatus,
      sourceUrl: args.sourceUrl,
      importedBy: identity.subject,
      raceEventId: args.raceEventId,
      entries,
    })
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    await checkAdmin(ctx)
    const sessions = await ctx.db.query("timingSessions").order("desc").take(200)
    return await Promise.all(
      sessions.map(async (session) => {
        const [series, entries] = await Promise.all([
          ctx.db.get(session.seriesId),
          ctx.db
            .query("sessionEntries")
            .withIndex("by_session", (q) => q.eq("sessionId", session._id))
            .collect(),
        ])
        return {
          ...session,
          seriesName: series?.name ?? "Series",
          entryCount: entries.length,
          starts: entries.filter((entry) => entry.isStart).length,
        }
      })
    )
  },
})

export const remove = mutation({
  args: { sessionId: v.id("timingSessions") },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)
    const session = await ctx.db.get(args.sessionId)
    if (!session) throwError(ErrorCode.NOT_FOUND, "Timing session not found")
    const entries = await ctx.db
      .query("sessionEntries")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()
    for (const entry of entries) await ctx.db.delete(entry._id)
    await ctx.db.delete(args.sessionId)
    return args.sessionId
  },
})

export const setSeriesResultsSettings = mutation({
  args: {
    seriesId: v.id("raceSeries"),
    showPublicResults: v.optional(v.boolean()),
    dnfLapThreshold: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)
    const series = await ctx.db.get(args.seriesId)
    if (!series) throwError(ErrorCode.NOT_FOUND, "Race series not found")
    const patch: {
      updatedAt: number
      showPublicResults?: boolean
      dnfLapThreshold?: number
    } = { updatedAt: Date.now() }
    if (args.showPublicResults !== undefined) {
      patch.showPublicResults = args.showPublicResults
    }
    let thresholdChanged = false
    if (args.dnfLapThreshold !== undefined) {
      if (args.dnfLapThreshold === null) {
        thresholdChanged = series.dnfLapThreshold !== undefined
        patch.dnfLapThreshold = undefined
      } else if (args.dnfLapThreshold <= 0 || args.dnfLapThreshold > 1) {
        throwError(ErrorCode.INVALID_INPUT, "DNF lap threshold must be between 0 and 1")
      } else {
        thresholdChanged = series.dnfLapThreshold !== args.dnfLapThreshold
        patch.dnfLapThreshold = args.dnfLapThreshold
      }
    }
    if (args.dnfLapThreshold === null) {
      const { dnfLapThreshold: _removed, ...rest } = { ...series, ...patch }
      const { _id, _creationTime, ...document } = rest
      await ctx.db.replace(args.seriesId, document)
    } else {
      await ctx.db.patch(args.seriesId, patch)
    }
    if (thresholdChanged) await rederiveSeries(ctx, args.seriesId)
    return args.seriesId
  },
})
