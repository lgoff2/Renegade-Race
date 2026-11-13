import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, type QueryCtx, query } from "./_generated/server"
import { logActivityEventInternal } from "./activity"
import { getCurrentUser, getCurrentUserOrThrow } from "./users"

const REACTION_TYPES = [
  v.literal("like"),
  v.literal("fire"),
  v.literal("checkered"),
  v.literal("clap"),
  v.literal("respect"),
] as const

const FEED_PAGE_SIZE = 50
const ONLINE_WINDOW_MS = 5 * 60 * 1000

// ============================================================
// Mutations
// ============================================================

export const createPost = mutation({
  args: {
    content: v.string(),
    teamId: v.optional(v.id("teams")),
    trackId: v.optional(v.id("tracks")),
    vehicleId: v.optional(v.id("vehicles")),
    mediaR2Keys: v.optional(v.array(v.string())),
    mediaType: v.optional(v.union(v.literal("image"), v.literal("video"), v.literal("mixed"))),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx)
    const trimmed = args.content.trim()
    if (trimmed.length === 0) {
      throw new Error("Post content cannot be empty")
    }
    if (trimmed.length > 5_000) {
      throw new Error("Post content too long (max 5000 chars)")
    }

    // If posting on behalf of a team, verify ownership/membership.
    if (args.teamId) {
      const team = await ctx.db.get(args.teamId)
      if (!team) throw new Error("Team not found")
      const isOwner = team.ownerId === user.externalId
      const membership = await ctx.db
        .query("teamMembers")
        .withIndex("by_team_user", (q) =>
          q.eq("teamId", args.teamId as Id<"teams">).eq("userId", user.externalId)
        )
        .first()
      if (!(isOwner || membership)) {
        throw new Error("Not authorized to post on behalf of this team")
      }
    }

    const now = Date.now()
    const postId = await ctx.db.insert("posts", {
      authorId: user.externalId,
      teamId: args.teamId,
      content: trimmed,
      trackId: args.trackId,
      vehicleId: args.vehicleId,
      mediaR2Keys: args.mediaR2Keys,
      mediaType: args.mediaType,
      reactionCount: 0,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    await logActivityEventInternal(ctx, {
      actorId: user.externalId,
      type: "post_created",
      targetType: "post",
      targetId: postId,
      visibility: "public",
    })

    return postId
  },
})

export const deletePost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx)
    const post = await ctx.db.get(args.postId)
    if (!post) throw new Error("Post not found")
    if (post.authorId !== user.externalId) {
      throw new Error("Not authorized to delete this post")
    }
    await ctx.db.patch(args.postId, {
      isDeleted: true,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

export const toggleReaction = mutation({
  args: {
    postId: v.id("posts"),
    type: v.union(...REACTION_TYPES),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx)
    const post = await ctx.db.get(args.postId)
    if (!post || post.isDeleted) throw new Error("Post not found")

    const existing = await ctx.db
      .query("postReactions")
      .withIndex("by_post_user", (q) => q.eq("postId", args.postId).eq("userId", user.externalId))
      .first()

    if (existing) {
      if (existing.type === args.type) {
        await ctx.db.delete(existing._id)
        await ctx.db.patch(args.postId, {
          reactionCount: Math.max(0, (post.reactionCount ?? 0) - 1),
        })
        return { reacted: false }
      }
      await ctx.db.patch(existing._id, { type: args.type })
      return { reacted: true }
    }

    await ctx.db.insert("postReactions", {
      postId: args.postId,
      userId: user.externalId,
      type: args.type,
      createdAt: Date.now(),
    })
    await ctx.db.patch(args.postId, {
      reactionCount: (post.reactionCount ?? 0) + 1,
    })
    return { reacted: true }
  },
})

export const addComment = mutation({
  args: {
    postId: v.id("posts"),
    content: v.string(),
    parentCommentId: v.optional(v.id("postComments")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx)
    const trimmed = args.content.trim()
    if (trimmed.length === 0) throw new Error("Comment cannot be empty")
    if (trimmed.length > 2_000) throw new Error("Comment too long (max 2000 chars)")

    const post = await ctx.db.get(args.postId)
    if (!post || post.isDeleted) throw new Error("Post not found")

    const commentId = await ctx.db.insert("postComments", {
      postId: args.postId,
      authorId: user.externalId,
      content: trimmed,
      parentCommentId: args.parentCommentId,
      createdAt: Date.now(),
    })
    await ctx.db.patch(args.postId, {
      commentCount: (post.commentCount ?? 0) + 1,
    })
    return commentId
  },
})

export const deleteComment = mutation({
  args: { commentId: v.id("postComments") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx)
    const comment = await ctx.db.get(args.commentId)
    if (!comment) throw new Error("Comment not found")
    if (comment.authorId !== user.externalId) {
      throw new Error("Not authorized to delete this comment")
    }
    await ctx.db.patch(args.commentId, { isDeleted: true })
  },
})

// ============================================================
// Queries
// ============================================================

export const getPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId)
    if (!post || post.isDeleted) return null
    return await enrichPost(ctx, post)
  },
})

export const listFeed = query({
  args: {
    scope: v.union(v.literal("for_you"), v.literal("following"), v.literal("global")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? FEED_PAGE_SIZE, 100)
    const me = await getCurrentUser(ctx)

    let posts: Doc<"posts">[]
    if (args.scope === "following" && me) {
      const followedIds = await getFollowedUserIds(ctx, me.externalId)
      followedIds.add(me.externalId)
      const all = await ctx.db
        .query("posts")
        .withIndex("by_created")
        .order("desc")
        .take(limit * 4)
      posts = all.filter((p) => !p.isDeleted && followedIds.has(p.authorId)).slice(0, limit)
    } else {
      posts = await ctx.db
        .query("posts")
        .withIndex("by_created")
        .order("desc")
        .filter((q) => q.neq(q.field("isDeleted"), true))
        .take(limit)
    }

    const enrichedPosts = await Promise.all(posts.map((p) => enrichPost(ctx, p)))

    if (args.scope === "global") {
      return enrichedPosts
    }

    // Mix in recent activity events for variety on for_you / following.
    const activitiesRaw = await ctx.db
      .query("activityEvents")
      .withIndex("by_visibility_created", (q) => q.eq("visibility", "public"))
      .order("desc")
      .take(20)
    const activities = await Promise.all(
      activitiesRaw
        .filter((a) => a.type !== "post_created")
        .slice(0, 10)
        .map(async (a) => ({
          _kind: "activity" as const,
          _id: a._id,
          createdAt: a.createdAt,
          type: a.type,
          targetType: a.targetType,
          targetId: a.targetId,
          metadata: a.metadata,
          actor: await loadActor(ctx, a.actorId),
        }))
    )

    return [...enrichedPosts, ...activities]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  },
})

export const listOnlineNow = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 8, 50)
    const cutoff = Date.now() - ONLINE_WINDOW_MS
    const records = await ctx.db.query("presence").collect()
    const recent = records.filter((r) => r.updatedAt >= cutoff)
    const seen = new Set<string>()
    const result: {
      userId: string
      name: string
      profileImage?: string
      profileImageR2Key?: string
    }[] = []
    for (const r of recent) {
      if (seen.has(r.userId)) continue
      seen.add(r.userId)
      const user = await ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", r.userId))
        .first()
      if (!user) continue
      result.push({
        userId: user.externalId,
        name: user.name,
        profileImage: user.profileImage,
        profileImageR2Key: user.profileImageR2Key,
      })
      if (result.length >= limit) break
    }
    return result
  },
})

export const listComments = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("postComments")
      .withIndex("by_post_created", (q) => q.eq("postId", args.postId))
      .order("asc")
      .collect()
    const visible = comments.filter((c) => !c.isDeleted)
    return await Promise.all(
      visible.map(async (c) => ({
        ...c,
        author: await loadActor(ctx, c.authorId),
      }))
    )
  },
})

// ============================================================
// Helpers
// ============================================================

async function enrichPost(ctx: QueryCtx, post: Doc<"posts">) {
  const me = await getCurrentUser(ctx)
  const author = await loadActor(ctx, post.authorId)
  let userReaction: string | null = null
  if (me) {
    const r = await ctx.db
      .query("postReactions")
      .withIndex("by_post_user", (q) => q.eq("postId", post._id).eq("userId", me.externalId))
      .first()
    if (r) userReaction = r.type
  }
  return {
    _kind: "post" as const,
    ...post,
    author,
    userReaction,
  }
}

async function loadActor(ctx: QueryCtx, externalId: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .first()
  if (!user) return null
  return {
    userId: user.externalId,
    name: user.name,
    profileImage: user.profileImage,
    profileImageR2Key: user.profileImageR2Key,
  }
}

async function getFollowedUserIds(ctx: QueryCtx, followerId: string): Promise<Set<string>> {
  const follows = await ctx.db
    .query("follows")
    .withIndex("by_follower", (q) => q.eq("followerId", followerId))
    .collect()
  const ids = new Set<string>()
  for (const f of follows) {
    if (f.followedUserId) ids.add(f.followedUserId)
  }
  return ids
}
