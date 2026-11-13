import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getCurrentUser, getCurrentUserOrThrow } from "./users"

export const followUser = mutation({
  args: { followedUserId: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx)
    if (me.externalId === args.followedUserId) {
      throw new Error("Cannot follow yourself")
    }
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_user", (q) =>
        q.eq("followerId", me.externalId).eq("followedUserId", args.followedUserId)
      )
      .first()
    if (existing) return existing._id
    return await ctx.db.insert("follows", {
      followerId: me.externalId,
      followedUserId: args.followedUserId,
      createdAt: Date.now(),
    })
  },
})

export const unfollowUser = mutation({
  args: { followedUserId: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx)
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_user", (q) =>
        q.eq("followerId", me.externalId).eq("followedUserId", args.followedUserId)
      )
      .first()
    if (existing) await ctx.db.delete(existing._id)
  },
})

export const followTeam = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx)
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_team", (q) =>
        q.eq("followerId", me.externalId).eq("followedTeamId", args.teamId)
      )
      .first()
    if (existing) return existing._id
    return await ctx.db.insert("follows", {
      followerId: me.externalId,
      followedTeamId: args.teamId,
      createdAt: Date.now(),
    })
  },
})

export const unfollowTeam = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx)
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_team", (q) =>
        q.eq("followerId", me.externalId).eq("followedTeamId", args.teamId)
      )
      .first()
    if (existing) await ctx.db.delete(existing._id)
  },
})

export const isFollowingUser = query({
  args: { followedUserId: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx)
    if (!me) return false
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_user", (q) =>
        q.eq("followerId", me.externalId).eq("followedUserId", args.followedUserId)
      )
      .first()
    return !!existing
  },
})

export const isFollowingTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx)
    if (!me) return false
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_team", (q) =>
        q.eq("followerId", me.externalId).eq("followedTeamId", args.teamId)
      )
      .first()
    return !!existing
  },
})

export const getFollowerCounts = query({
  args: {
    userId: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    if (!(args.userId || args.teamId)) {
      return { followers: 0, following: 0 }
    }
    let followers = 0
    let following = 0
    if (args.userId) {
      const followersList = await ctx.db
        .query("follows")
        .withIndex("by_followed_user", (q) => q.eq("followedUserId", args.userId))
        .collect()
      followers = followersList.length
      const followingList = await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", args.userId as string))
        .collect()
      following = followingList.length
    } else if (args.teamId) {
      const followersList = await ctx.db
        .query("follows")
        .withIndex("by_followed_team", (q) => q.eq("followedTeamId", args.teamId))
        .collect()
      followers = followersList.length
    }
    return { followers, following }
  },
})

export const listFollowers = query({
  args: {
    userId: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200)
    let followsList: { followerId: string }[] = []
    if (args.userId) {
      followsList = await ctx.db
        .query("follows")
        .withIndex("by_followed_user", (q) => q.eq("followedUserId", args.userId))
        .take(limit)
    } else if (args.teamId) {
      followsList = await ctx.db
        .query("follows")
        .withIndex("by_followed_team", (q) => q.eq("followedTeamId", args.teamId))
        .take(limit)
    }
    return await Promise.all(
      followsList.map(async (f) => {
        const u = await ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", f.followerId))
          .first()
        return u
          ? { userId: u.externalId, name: u.name, profileImage: u.profileImage }
          : null
      })
    ).then((res) => res.filter((u) => u !== null))
  },
})
