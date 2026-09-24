import { v } from "convex/values"
import { internal } from "./_generated/api"
import { mutation, query } from "./_generated/server"
import { checkAdmin } from "./admin"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"
import {
  isAdminIdentity,
  requireAdminOrTeamManager,
  requireIdentity,
  requireTeamManager,
} from "./seatHelpers"

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    organizer: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const { identity, team } = await requireAdminOrTeamManager(ctx, args.teamId)

    await rateLimiter.limit(ctx, "updateProfile", {
      key: identity.subject,
      throws: true,
    })

    const name = sanitizeShortText(args.name)
    if (!name) {
      throwError(ErrorCode.INVALID_INPUT, "Series name is required")
    }

    const now = Date.now()
    const seriesId = await ctx.db.insert("raceSeries", {
      name,
      description: args.description ? sanitizeMessage(args.description) : undefined,
      organizer: args.organizer ? sanitizeShortText(args.organizer) : undefined,
      website: args.website ? sanitizeShortText(args.website) : undefined,
      logoUrl: args.logoUrl,
      isActive: true,
      createdByUserId: identity.subject,
      createdByTeamId: team?._id,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "race_series",
      entityId: seriesId,
      action: "create",
      userId: identity.subject,
      newState: { name, createdByTeamId: team?._id },
    })

    return seriesId
  },
})

export const update = mutation({
  args: {
    seriesId: v.id("raceSeries"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    organizer: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const series = await ctx.db.get(args.seriesId)
    if (!series) {
      throwError(ErrorCode.NOT_FOUND, "Race series not found")
    }

    const admin = isAdminIdentity(identity)
    if (!admin) {
      if (series.createdByTeamId) {
        await requireTeamManager(ctx, series.createdByTeamId, identity.subject)
      } else if (series.createdByUserId !== identity.subject) {
        throwError(ErrorCode.FORBIDDEN, "Not authorized to update this series")
      }
    }

    await rateLimiter.limit(ctx, "updateProfile", {
      key: identity.subject,
      throws: true,
    })

    const { seriesId, ...updates } = args
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.name !== undefined) {
      const name = sanitizeShortText(updates.name)
      if (!name) {
        throwError(ErrorCode.INVALID_INPUT, "Series name is required")
      }
      patch.name = name
    }
    if (updates.description !== undefined) {
      patch.description = updates.description ? sanitizeMessage(updates.description) : undefined
    }
    if (updates.organizer !== undefined) {
      patch.organizer = updates.organizer ? sanitizeShortText(updates.organizer) : undefined
    }
    if (updates.website !== undefined) {
      patch.website = updates.website ? sanitizeShortText(updates.website) : undefined
    }
    if (updates.logoUrl !== undefined) {
      patch.logoUrl = updates.logoUrl
    }
    if (updates.isActive !== undefined) {
      patch.isActive = updates.isActive
    }

    await ctx.db.patch(seriesId, patch)

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "race_series",
      entityId: seriesId,
      action: "update",
      userId: identity.subject,
      previousState: { name: series.name, isActive: series.isActive },
      newState: patch,
    })

    return seriesId
  },
})

export const getById = query({
  args: { seriesId: v.id("raceSeries") },
  handler: async (ctx, args) => await ctx.db.get(args.seriesId),
})

export const list = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("raceSeries")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect(),
})

export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("raceSeries")
      .withIndex("by_created_by_team", (q) => q.eq("createdByTeamId", args.teamId))
      .order("desc")
      .collect(),
})

export const listForAdmin = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)
    if (args.includeInactive) {
      return await ctx.db.query("raceSeries").order("desc").collect()
    }
    return await ctx.db
      .query("raceSeries")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect()
  },
})

export const getByIdForAdmin = query({
  args: { seriesId: v.id("raceSeries") },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)
    return await ctx.db.get(args.seriesId)
  },
})
