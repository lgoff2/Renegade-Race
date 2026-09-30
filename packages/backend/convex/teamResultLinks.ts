import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { mutation, query } from "./_generated/server"
import { checkAdmin } from "./admin"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import {
  carNumbersMatch,
  type LinkMatchFields,
  linkMatchesEntry,
  suggestionReason,
} from "./reliabilityMetrics"
import { isAdminIdentity, requireIdentity, requireTeamManager } from "./seatHelpers"

function linkFields(link: Doc<"teamResultLinks">): LinkMatchFields {
  return {
    teamId: link.teamId,
    carNumber: link.carNumber,
    nameAliases: link.nameAliases,
    transponders: link.transponders,
    confirmedEntryIds: link.confirmedEntryIds,
    rejectedEntryIds: link.rejectedEntryIds,
  }
}

function priorStatus(
  prior: Doc<"teamResultLinks"> | undefined
): "pending" | "verified" | "rejected" {
  if (!prior || prior.status === "rejected") return "pending"
  return prior.status
}

function cleanList(values: string[] | undefined, maxItems: number, maxLength: number): string[] {
  const cleaned: string[] = []
  for (const value of values ?? []) {
    const trimmed = value.trim().slice(0, maxLength)
    if (!trimmed || cleaned.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      continue
    }
    cleaned.push(trimmed)
    if (cleaned.length >= maxItems) break
  }
  return cleaned
}

export async function applyVerifiedLinks(ctx: MutationCtx, seriesId: Id<"raceSeries">) {
  const links = await ctx.db
    .query("teamResultLinks")
    .withIndex("by_series_car", (q) => q.eq("seriesId", seriesId))
    .collect()
  const verified = links
    .filter((link) => link.status === "verified")
    .sort((a, b) => a.createdAt - b.createdAt)
  const entries = await ctx.db
    .query("sessionEntries")
    .withIndex("by_series_car", (q) => q.eq("seriesId", seriesId))
    .collect()

  const teamNames = new Map<Id<"teams">, string>()
  for (const link of verified) {
    if (teamNames.has(link.teamId)) continue
    const team = await ctx.db.get(link.teamId)
    teamNames.set(link.teamId, team?.name ?? "")
  }

  for (const entry of entries) {
    const match = verified.find((link) =>
      linkMatchesEntry(
        {
          _id: entry._id,
          carNumber: entry.carNumber,
          teamNameRaw: entry.teamNameRaw,
          transponder: entry.transponder,
        },
        linkFields(link),
        teamNames.get(link.teamId) ?? ""
      )
    )
    const nextTeamId = match?.teamId
    if (entry.teamId === nextTeamId) continue
    if (nextTeamId) {
      await ctx.db.patch(entry._id, { teamId: nextTeamId })
      continue
    }
    const { _id, _creationTime, teamId: _teamId, ...rest } = entry
    await ctx.db.replace(_id, rest)
  }
}

async function hasLinkedTeamCar(
  ctx: MutationCtx,
  teamId: Id<"teams">,
  seriesId: Id<"raceSeries">,
  carNumber: string
) {
  const sessions = await ctx.db
    .query("timingSessions")
    .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
    .collect()
  for (const session of sessions) {
    if (!session.raceEventId) continue
    const cars = await ctx.db
      .query("teamCars")
      .withIndex("by_team_event", (q) =>
        q.eq("teamId", teamId).eq("raceEventId", session.raceEventId as Id<"raceEvents">)
      )
      .collect()
    if (cars.some((car) => car.carNumber && carNumbersMatch(car.carNumber, carNumber))) {
      return true
    }
  }
  return false
}

async function requireLinkManager(ctx: QueryCtx, linkId: Id<"teamResultLinks">) {
  const identity = await requireIdentity(ctx)
  const link = await ctx.db.get(linkId)
  if (!link) throwError(ErrorCode.NOT_FOUND, "Result link not found")
  await requireTeamManager(ctx, link.teamId, identity.subject)
  return link
}

export const claim = mutation({
  args: {
    teamId: v.id("teams"),
    seriesId: v.id("raceSeries"),
    carNumbers: v.array(v.string()),
    nameAliases: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await requireTeamManager(ctx, args.teamId, identity.subject)
    await rateLimiter.limit(ctx, "updateProfile", { key: identity.subject, throws: true })

    const series = await ctx.db.get(args.seriesId)
    if (!series) throwError(ErrorCode.NOT_FOUND, "Race series not found")

    const carNumbers = cleanList(args.carNumbers, 8, 16)
    if (carNumbers.length === 0) {
      throwError(ErrorCode.INVALID_INPUT, "Enter at least one car number")
    }
    const nameAliases = cleanList(args.nameAliases, 8, 80)
    const existing = await ctx.db
      .query("teamResultLinks")
      .withIndex("by_team_series", (q) => q.eq("teamId", args.teamId).eq("seriesId", args.seriesId))
      .collect()

    const now = Date.now()
    const linkIds: Id<"teamResultLinks">[] = []
    for (const carNumber of carNumbers) {
      const prior = existing.find((link) => carNumbersMatch(link.carNumber, carNumber))
      const auto = await hasLinkedTeamCar(ctx, args.teamId, args.seriesId, carNumber)
      const status = auto ? "verified" : priorStatus(prior)
      if (prior) {
        await ctx.db.patch(prior._id, {
          carNumber,
          nameAliases,
          status,
          verifiedBy: auto ? identity.subject : prior.verifiedBy,
          updatedAt: now,
        })
        linkIds.push(prior._id)
        continue
      }
      const linkId = await ctx.db.insert("teamResultLinks", {
        teamId: args.teamId,
        seriesId: args.seriesId,
        carNumber,
        nameAliases,
        transponders: [],
        status: auto ? "verified" : "pending",
        verifiedBy: auto ? identity.subject : undefined,
        createdAt: now,
        updatedAt: now,
      })
      linkIds.push(linkId)
    }

    await applyVerifiedLinks(ctx, args.seriesId)
    return linkIds
  },
})

export const confirmSuggestion = mutation({
  args: {
    linkId: v.id("teamResultLinks"),
    entryId: v.id("sessionEntries"),
  },
  handler: async (ctx, args) => {
    const link = await requireLinkManager(ctx, args.linkId)
    const entry = await ctx.db.get(args.entryId)
    if (!entry || entry.seriesId !== link.seriesId) {
      throwError(ErrorCode.NOT_FOUND, "Result entry not found")
    }
    const team = await ctx.db.get(link.teamId)
    const fields = linkFields(link)
    fields.rejectedEntryIds = (fields.rejectedEntryIds ?? []).filter((id) => id !== entry._id)
    const reason = suggestionReason(
      {
        _id: entry._id,
        carNumber: entry.carNumber,
        teamNameRaw: entry.teamNameRaw,
        transponder: entry.transponder,
      },
      fields,
      team?.name ?? ""
    )
    if (!reason) {
      throwError(ErrorCode.INVALID_INPUT, "That result does not match this claim")
    }

    const confirmed = new Set(link.confirmedEntryIds ?? [])
    confirmed.add(entry._id)
    const rejected = (link.rejectedEntryIds ?? []).filter((id) => id !== entry._id)
    const transponders = [...link.transponders]
    if (entry.transponder && !transponders.includes(entry.transponder)) {
      transponders.push(entry.transponder)
    }
    await ctx.db.patch(link._id, {
      confirmedEntryIds: [...confirmed],
      rejectedEntryIds: rejected,
      transponders,
      updatedAt: Date.now(),
    })
    if (link.status === "verified") await applyVerifiedLinks(ctx, link.seriesId)
    return link._id
  },
})

export const rejectSuggestion = mutation({
  args: {
    linkId: v.id("teamResultLinks"),
    entryId: v.id("sessionEntries"),
  },
  handler: async (ctx, args) => {
    const link = await requireLinkManager(ctx, args.linkId)
    const entry = await ctx.db.get(args.entryId)
    if (!entry || entry.seriesId !== link.seriesId) {
      throwError(ErrorCode.NOT_FOUND, "Result entry not found")
    }
    const rejected = new Set(link.rejectedEntryIds ?? [])
    rejected.add(entry._id)
    const confirmed = (link.confirmedEntryIds ?? []).filter((id) => id !== entry._id)
    await ctx.db.patch(link._id, {
      confirmedEntryIds: confirmed,
      rejectedEntryIds: [...rejected],
      updatedAt: Date.now(),
    })
    if (link.status === "verified") await applyVerifiedLinks(ctx, link.seriesId)
    return link._id
  },
})

export const review = mutation({
  args: {
    linkId: v.id("teamResultLinks"),
    decision: v.union(v.literal("verified"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const identity = await checkAdmin(ctx)
    const link = await ctx.db.get(args.linkId)
    if (!link) throwError(ErrorCode.NOT_FOUND, "Result link not found")
    await ctx.db.patch(args.linkId, {
      status: args.decision,
      verifiedBy: args.decision === "verified" ? identity.subject : undefined,
      updatedAt: Date.now(),
    })
    await applyVerifiedLinks(ctx, link.seriesId)
    return args.linkId
  },
})

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    await checkAdmin(ctx)
    const links = await ctx.db
      .query("teamResultLinks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect()
    return await Promise.all(
      links.map(async (link) => {
        const [team, series] = await Promise.all([
          ctx.db.get(link.teamId),
          ctx.db.get(link.seriesId),
        ])
        return {
          ...link,
          teamName: team?.name ?? "Unknown team",
          seriesName: series?.name ?? "Unknown series",
        }
      })
    )
  },
})

export const listForTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    if (!isAdminIdentity(identity)) {
      try {
        await requireTeamManager(ctx, args.teamId, identity.subject)
      } catch {
        return null
      }
    }

    const team = await ctx.db.get(args.teamId)
    if (!team) return null
    const links = await ctx.db
      .query("teamResultLinks")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()

    const suggestions: Array<{
      linkId: Id<"teamResultLinks">
      seriesName: string
      carNumber: string
      status: Doc<"teamResultLinks">["status"]
      matches: Array<{
        entryId: Id<"sessionEntries">
        linkId: Id<"teamResultLinks">
        reason: ReturnType<typeof suggestionReason>
        confirmed: boolean
        linked: boolean
        carNumber: string
        teamNameRaw: string
        className: string
        laps: number
        eventName: string
        date: string
        sourceUrl: string
      }>
    }> = []
    for (const link of links) {
      if (link.status === "rejected") continue
      const series = await ctx.db.get(link.seriesId)
      const entries = await ctx.db
        .query("sessionEntries")
        .withIndex("by_series_car", (q) => q.eq("seriesId", link.seriesId))
        .collect()
      const matches: (typeof suggestions)[number]["matches"] = []
      for (const entry of entries) {
        if (entry.teamId && entry.teamId !== args.teamId) continue
        const reason = suggestionReason(
          {
            _id: entry._id,
            carNumber: entry.carNumber,
            teamNameRaw: entry.teamNameRaw,
            transponder: entry.transponder,
          },
          linkFields(link),
          team.name
        )
        if (!reason) continue
        const session = await ctx.db.get(entry.sessionId)
        matches.push({
          entryId: entry._id,
          linkId: link._id,
          reason,
          confirmed: (link.confirmedEntryIds ?? []).includes(entry._id),
          linked: entry.teamId === args.teamId,
          carNumber: entry.carNumber,
          teamNameRaw: entry.teamNameRaw,
          className: entry.class,
          laps: entry.laps,
          eventName: session?.eventName ?? "Race",
          date: session?.date ?? "",
          sourceUrl: session?.sourceUrl ?? "",
        })
      }
      matches.sort((a, b) => b.date.localeCompare(a.date))
      suggestions.push({
        linkId: link._id,
        seriesName: series?.name ?? "Series",
        carNumber: link.carNumber,
        status: link.status,
        matches: matches.slice(0, 15),
      })
    }

    const seriesIds = [...new Set(links.map((link) => link.seriesId))]
    const seriesNames = await Promise.all(seriesIds.map((seriesId) => ctx.db.get(seriesId)))
    const seriesNameById = new Map(
      seriesIds.map((id, index) => [id, seriesNames[index]?.name ?? "Series"])
    )

    return {
      links: links.map((link) => ({
        ...link,
        seriesName: seriesNameById.get(link.seriesId) ?? "Series",
      })),
      suggestions,
    }
  },
})
