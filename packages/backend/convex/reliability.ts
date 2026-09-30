import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { query } from "./_generated/server"
import { checkAdmin } from "./admin"
import {
  clampDnfFraction,
  MIN_PUBLIC_STARTS,
  summarizeStarts,
  topPercentLabel,
} from "./reliabilityMetrics"

type RecentResult = {
  entryId: Id<"sessionEntries">
  eventName: string
  sessionName: string
  date: string
  posInClass: number
  classStarters: number
  laps: number
  classWinnerLaps: number
  isDnf: boolean
  dnfReason?: "status" | "laps"
  source: "speedhive" | "csv"
  sourceUrl: string
}

export type TeamReliabilityGroup = {
  seriesId: Id<"raceSeries">
  seriesName: string
  className: string
  showPublicResults: boolean
  dnfLapFraction: number
  starts: number
  dnfs: number
  avgFinishPctile: number
  avgLapsPct: number
  typicalFinishLabel: string
  last5: {
    starts: number
    dnfs: number
    avgFinishPctile: number
    avgLapsPct: number
    typicalFinishLabel: string
  }
  recent: RecentResult[]
}

export const getForTeam = query({
  args: {
    teamId: v.id("teams"),
    audience: v.optional(v.union(v.literal("public"), v.literal("admin"))),
  },
  handler: async (ctx, args): Promise<TeamReliabilityGroup[]> => {
    const audience = args.audience ?? "public"
    if (audience === "admin") await checkAdmin(ctx)

    const entries = await ctx.db
      .query("sessionEntries")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()
    const starts = entries.filter((entry) => entry.isStart)
    if (starts.length === 0) return []

    const sessionCache = new Map<Id<"timingSessions">, Doc<"timingSessions"> | null>()
    const seriesCache = new Map<Id<"raceSeries">, Doc<"raceSeries"> | null>()
    const loadSession = async (sessionId: Id<"timingSessions">) => {
      if (!sessionCache.has(sessionId)) sessionCache.set(sessionId, await ctx.db.get(sessionId))
      return sessionCache.get(sessionId) ?? null
    }
    const loadSeries = async (seriesId: Id<"raceSeries">) => {
      if (!seriesCache.has(seriesId)) seriesCache.set(seriesId, await ctx.db.get(seriesId))
      return seriesCache.get(seriesId) ?? null
    }

    const grouped = new Map<string, Doc<"sessionEntries">[]>()
    for (const entry of starts) {
      const key = `${entry.seriesId}:${entry.class}`
      const list = grouped.get(key) ?? []
      list.push(entry)
      grouped.set(key, list)
    }

    const groups: TeamReliabilityGroup[] = []
    for (const classEntries of grouped.values()) {
      const sample = classEntries[0]
      if (!sample) continue
      const series = await loadSeries(sample.seriesId)
      const showPublicResults = series?.showPublicResults !== false
      if (
        audience === "public" &&
        (!showPublicResults || classEntries.length < MIN_PUBLIC_STARTS)
      ) {
        continue
      }

      const dated: Array<{
        entry: Doc<"sessionEntries">
        session: Doc<"timingSessions"> | null
        date: string
      }> = []
      for (const entry of classEntries) {
        const session = await loadSession(entry.sessionId)
        dated.push({ entry, session, date: session?.date ?? "" })
      }
      dated.sort(
        (a, b) => b.date.localeCompare(a.date) || b.entry._creationTime - a.entry._creationTime
      )

      const summary = summarizeStarts(
        dated.map((row) => ({
          date: row.date,
          finishPctile: row.entry.finishPctile,
          lapsPctClassWinner: row.entry.lapsPctClassWinner,
          isDnf: row.entry.isDnf,
        }))
      )
      const recent: RecentResult[] = dated.slice(0, 5).flatMap((row) => {
        if (!row.session) return []
        return [
          {
            entryId: row.entry._id,
            eventName: row.session.eventName,
            sessionName: row.session.sessionName,
            date: row.session.date,
            posInClass: row.entry.posInClass,
            classStarters: row.entry.classStarters,
            laps: row.entry.laps,
            classWinnerLaps: row.entry.classWinnerLaps,
            isDnf: row.entry.isDnf,
            dnfReason: row.entry.dnfReason,
            source: row.session.source,
            sourceUrl: row.session.sourceUrl,
          },
        ]
      })

      groups.push({
        seriesId: sample.seriesId,
        seriesName: series?.name ?? "Series",
        className: sample.class,
        showPublicResults,
        dnfLapFraction: clampDnfFraction(series?.dnfLapThreshold),
        starts: summary.allTime.starts,
        dnfs: summary.allTime.dnfs,
        avgFinishPctile: summary.allTime.avgFinishPctile,
        avgLapsPct: summary.allTime.avgLapsPct,
        typicalFinishLabel: topPercentLabel(summary.allTime.avgFinishPctile),
        last5: {
          ...summary.last5,
          typicalFinishLabel: topPercentLabel(summary.last5.avgFinishPctile),
        },
        recent,
      })
    }

    groups.sort(
      (a, b) => a.seriesName.localeCompare(b.seriesName) || a.className.localeCompare(b.className)
    )
    return groups
  },
})
