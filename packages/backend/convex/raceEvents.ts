import { v } from "convex/values"
import { internal } from "./_generated/api"
import { mutation, query } from "./_generated/server"
import { checkAdmin } from "./admin"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"
import {
  assertEventDateRange,
  isAdminIdentity,
  requireAdminOrTeamManager,
  requireIdentity,
  requireTeamManager,
} from "./seatHelpers"

export const create = mutation({
  args: {
    seriesId: v.id("raceSeries"),
    name: v.string(),
    description: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    trackId: v.optional(v.id("tracks")),
    trackName: v.optional(v.string()),
    trackLocation: v.optional(v.string()),
    eventUrl: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const { identity, team } = await requireAdminOrTeamManager(ctx, args.teamId)

    await rateLimiter.limit(ctx, "updateProfile", {
      key: identity.subject,
      throws: true,
    })

    const series = await ctx.db.get(args.seriesId)
    if (!series) {
      throwError(ErrorCode.NOT_FOUND, "Race series not found")
    }
    if (!series.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Cannot add events to an inactive series")
    }

    const name = sanitizeShortText(args.name)
    if (!name) {
      throwError(ErrorCode.INVALID_INPUT, "Event name is required")
    }
    assertEventDateRange(args.startDate, args.endDate)

    if (args.trackId) {
      const track = await ctx.db.get(args.trackId)
      if (!track) {
        throwError(ErrorCode.NOT_FOUND, "Track not found")
      }
    }

    const now = Date.now()
    const eventId = await ctx.db.insert("raceEvents", {
      seriesId: args.seriesId,
      name,
      description: args.description ? sanitizeMessage(args.description) : undefined,
      startDate: args.startDate,
      endDate: args.endDate,
      trackId: args.trackId,
      trackName: args.trackName ? sanitizeShortText(args.trackName) : undefined,
      trackLocation: args.trackLocation ? sanitizeShortText(args.trackLocation) : undefined,
      eventUrl: args.eventUrl ? sanitizeShortText(args.eventUrl) : undefined,
      isActive: true,
      createdByUserId: identity.subject,
      createdByTeamId: team?._id,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "race_event",
      entityId: eventId,
      action: "create",
      userId: identity.subject,
      newState: { name, seriesId: args.seriesId, startDate: args.startDate, endDate: args.endDate },
    })

    return eventId
  },
})

function optionalSanitized(value: string, sanitize: (s: string) => string) {
  return value ? sanitize(value) : undefined
}

function buildEventUpdatePatch(
  event: { startDate: string; endDate: string },
  args: {
    name?: string
    description?: string
    startDate?: string
    endDate?: string
    trackId?: any
    trackName?: string
    trackLocation?: string
    eventUrl?: string
    isActive?: boolean
  }
) {
  const startDate = args.startDate ?? event.startDate
  const endDate = args.endDate ?? event.endDate
  assertEventDateRange(startDate, endDate)

  const patch: Record<string, unknown> = {
    updatedAt: Date.now(),
    startDate,
    endDate,
  }
  if (args.name !== undefined) {
    const name = sanitizeShortText(args.name)
    if (!name) {
      throwError(ErrorCode.INVALID_INPUT, "Event name is required")
    }
    patch.name = name
  }
  if (args.description !== undefined) {
    patch.description = optionalSanitized(args.description, sanitizeMessage)
  }
  if (args.trackId !== undefined) {
    patch.trackId = args.trackId
  }
  if (args.trackName !== undefined) {
    patch.trackName = optionalSanitized(args.trackName, sanitizeShortText)
  }
  if (args.trackLocation !== undefined) {
    patch.trackLocation = optionalSanitized(args.trackLocation, sanitizeShortText)
  }
  if (args.eventUrl !== undefined) {
    patch.eventUrl = optionalSanitized(args.eventUrl, sanitizeShortText)
  }
  if (args.isActive !== undefined) {
    patch.isActive = args.isActive
  }
  return patch
}

export const update = mutation({
  args: {
    eventId: v.id("raceEvents"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    trackId: v.optional(v.id("tracks")),
    trackName: v.optional(v.string()),
    trackLocation: v.optional(v.string()),
    eventUrl: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const event = await ctx.db.get(args.eventId)
    if (!event) {
      throwError(ErrorCode.NOT_FOUND, "Race event not found")
    }

    const admin = isAdminIdentity(identity)
    if (!admin) {
      if (event.createdByTeamId) {
        await requireTeamManager(ctx, event.createdByTeamId, identity.subject)
      } else if (event.createdByUserId !== identity.subject) {
        throwError(ErrorCode.FORBIDDEN, "Not authorized to update this event")
      }
    }

    await rateLimiter.limit(ctx, "updateProfile", {
      key: identity.subject,
      throws: true,
    })

    if (args.trackId) {
      const track = await ctx.db.get(args.trackId)
      if (!track) {
        throwError(ErrorCode.NOT_FOUND, "Track not found")
      }
    }

    const patch = buildEventUpdatePatch(event, args)
    await ctx.db.patch(args.eventId, patch)

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "race_event",
      entityId: args.eventId,
      action: "update",
      userId: identity.subject,
      previousState: { name: event.name, isActive: event.isActive },
      newState: patch,
    })

    return args.eventId
  },
})

async function enrichEvent(ctx: any, event: any) {
  const [series, track] = await Promise.all([
    ctx.db.get(event.seriesId),
    event.trackId ? ctx.db.get(event.trackId) : null,
  ])
  return { ...event, series, track }
}

export const getById = query({
  args: { eventId: v.id("raceEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId)
    if (!event) return null
    return await enrichEvent(ctx, event)
  },
})

export const listBySeries = query({
  args: {
    seriesId: v.id("raceSeries"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const events = args.includeInactive
      ? await ctx.db
          .query("raceEvents")
          .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
          .collect()
      : await ctx.db
          .query("raceEvents")
          .withIndex("by_series_active", (q) =>
            q.eq("seriesId", args.seriesId).eq("isActive", true)
          )
          .collect()
    events.sort((a, b) => a.startDate.localeCompare(b.startDate))
    return await Promise.all(events.map((event) => enrichEvent(ctx, event)))
  },
})

export const listUpcoming = query({
  args: {
    fromDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fromDate = args.fromDate ?? new Date().toISOString().slice(0, 10)
    const events = await ctx.db
      .query("raceEvents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect()
    const upcoming = events
      .filter((event) => event.endDate >= fromDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
    return await Promise.all(upcoming.map((event) => enrichEvent(ctx, event)))
  },
})

export const listForAdmin = query({
  args: {
    seriesId: v.optional(v.id("raceSeries")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)
    const limit = args.limit ?? 100
    const seriesId = args.seriesId
    const events = seriesId
      ? await ctx.db
          .query("raceEvents")
          .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
          .order("desc")
          .take(limit)
      : await ctx.db.query("raceEvents").order("desc").take(limit)
    return await Promise.all(events.map((event) => enrichEvent(ctx, event)))
  },
})
