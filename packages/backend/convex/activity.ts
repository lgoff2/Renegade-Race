import { v } from "convex/values"
import type { MutationCtx } from "./_generated/server"
import { internalMutation, query } from "./_generated/server"

const ACTIVITY_TYPES = [
  v.literal("driver_joined_team"),
  v.literal("driver_endorsed"),
  v.literal("team_event_created"),
  v.literal("coach_listing_created"),
  v.literal("vehicle_listed"),
  v.literal("race_result_posted"),
  v.literal("user_verified"),
  v.literal("post_created"),
] as const

const TARGET_TYPES = [
  v.literal("user"),
  v.literal("team"),
  v.literal("vehicle"),
  v.literal("post"),
  v.literal("race_result"),
  v.literal("coach_service"),
  v.literal("team_event"),
] as const

export const logActivityEvent = internalMutation({
  args: {
    actorId: v.string(),
    type: v.union(...ACTIVITY_TYPES),
    targetType: v.optional(v.union(...TARGET_TYPES)),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    visibility: v.union(v.literal("public"), v.literal("followers")),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("activityEvents", {
      actorId: args.actorId,
      type: args.type,
      targetType: args.targetType,
      targetId: args.targetId,
      metadata: args.metadata,
      visibility: args.visibility,
      createdAt: Date.now(),
    }),
})

/**
 * Helper for use inside other mutations — inserts directly so we don't have to
 * cross the internal boundary on every write.
 */
export async function logActivityEventInternal(
  ctx: MutationCtx,
  args: {
    actorId: string
    type:
      | "driver_joined_team"
      | "driver_endorsed"
      | "team_event_created"
      | "coach_listing_created"
      | "vehicle_listed"
      | "race_result_posted"
      | "user_verified"
      | "post_created"
    targetType?:
      | "user"
      | "team"
      | "vehicle"
      | "post"
      | "race_result"
      | "coach_service"
      | "team_event"
    targetId?: string
    metadata?: unknown
    visibility?: "public" | "followers"
  }
) {
  return await ctx.db.insert("activityEvents", {
    actorId: args.actorId,
    type: args.type,
    targetType: args.targetType,
    targetId: args.targetId,
    metadata: args.metadata,
    visibility: args.visibility ?? "public",
    createdAt: Date.now(),
  })
}

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100)
    return await ctx.db
      .query("activityEvents")
      .withIndex("by_created")
      .order("desc")
      .take(limit)
  },
})
