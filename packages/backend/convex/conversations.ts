import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { mutation, type QueryCtx, query } from "./_generated/server"

// Resolve the primary (or first available) image key for a vehicle thumbnail
async function getVehicleThumbnailKey(
  ctx: QueryCtx,
  vehicleId: Id<"vehicles"> | undefined
): Promise<string | null> {
  if (!vehicleId) return null
  const primary = await ctx.db
    .query("vehicleImages")
    .withIndex("by_vehicle_primary", (q) => q.eq("vehicleId", vehicleId).eq("isPrimary", true))
    .first()
  const image =
    primary ??
    (await ctx.db
      .query("vehicleImages")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .first())
  return image?.r2Key ?? null
}

// Get conversations for a user (as renter or owner)
export const getByUser = query({
  args: {
    userId: v.string(),
    role: v.union(v.literal("renter"), v.literal("owner")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Verify the authenticated user matches the userId
    if (identity.subject !== args.userId) {
      throw new Error("Unauthorized: Cannot access other users' data")
    }

    const { userId, role } = args

    let conversationsQuery
    if (role === "renter") {
      conversationsQuery = ctx.db
        .query("conversations")
        .withIndex("by_renter_active", (q) => q.eq("renterId", userId).eq("isActive", true))
    } else {
      conversationsQuery = ctx.db
        .query("conversations")
        .withIndex("by_owner_active", (q) => q.eq("ownerId", userId).eq("isActive", true))
    }

    const allConversations = await conversationsQuery.order("desc").collect()

    // Filter out conversations deleted by the current user
    const conversations = allConversations.filter((conversation) => {
      if (role === "renter") {
        return conversation.deletedByRenter !== true
      }
      return conversation.deletedByOwner !== true
    })

    // Get vehicle and user details
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conversation) => {
        const [vehicle, renter, owner, vehicleImageKey] = await Promise.all([
          conversation.vehicleId ? ctx.db.get(conversation.vehicleId) : null,
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", conversation.renterId))
            .first(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", conversation.ownerId))
            .first(),
          getVehicleThumbnailKey(ctx, conversation.vehicleId),
        ])

        // Get team/driver info for motorsports conversations
        const team = conversation.teamId ? await ctx.db.get(conversation.teamId) : null
        const driverProfile = conversation.driverProfileId
          ? await ctx.db.get(conversation.driverProfileId)
          : null
        const coachProfile = conversation.coachProfileId
          ? await ctx.db.get(conversation.coachProfileId)
          : null

        // Get reservation info if linked
        let reservation: {
          _id: string
          status: string
          startDate: string
          endDate: string
          totalAmount: number
        } | null = null
        if (conversation.reservationId) {
          const res = (await ctx.db.get(conversation.reservationId)) as any
          if (res) {
            reservation = {
              _id: String(res._id),
              status: res.status,
              startDate: res.startDate,
              endDate: res.endDate,
              totalAmount: res.totalAmount,
            }
          }
        }

        return {
          ...conversation,
          vehicle,
          vehicleImageKey,
          renter,
          owner,
          team,
          driverProfile,
          coachProfile,
          reservation,
        }
      })
    )

    // Filter out conversations where either party has blocked the other
    const filteredConversations: typeof conversationsWithDetails = []
    for (const conversation of conversationsWithDetails) {
      const otherUserId = role === "renter" ? conversation.ownerId : conversation.renterId

      // Check if either user has blocked the other
      const block1 = await ctx.db
        .query("userBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", userId).eq("blockedUserId", otherUserId)
        )
        .first()

      const block2 = await ctx.db
        .query("userBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", otherUserId).eq("blockedUserId", userId)
        )
        .first()

      // Only include if neither has blocked the other
      if (!(block1 || block2)) {
        filteredConversations.push(conversation)
      }
    }

    return filteredConversations
  },
})

// Get a specific conversation by ID
export const getById = query({
  args: {
    conversationId: v.id("conversations"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Verify the authenticated user matches the userId
    if (identity.subject !== args.userId) {
      throw new Error("Unauthorized: Cannot access other users' data")
    }

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation) {
      throw new Error("Conversation not found")
    }

    // Ensure the user is part of the conversation
    if (conversation.renterId !== args.userId && conversation.ownerId !== args.userId) {
      throw new Error("Not authorized to view this conversation")
    }

    // Check if the user has deleted this conversation
    const isRenter = conversation.renterId === args.userId
    if (
      (isRenter && conversation.deletedByRenter === true) ||
      (!isRenter && conversation.deletedByOwner === true)
    ) {
      throw new Error("Conversation not found")
    }

    const [vehicle, renter, owner, vehicleImageKey] = await Promise.all([
      conversation.vehicleId ? ctx.db.get(conversation.vehicleId) : null,
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", conversation.renterId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", conversation.ownerId))
        .first(),
      getVehicleThumbnailKey(ctx, conversation.vehicleId),
    ])

    const team = conversation.teamId ? await ctx.db.get(conversation.teamId) : null
    const driverProfile = conversation.driverProfileId
      ? await ctx.db.get(conversation.driverProfileId)
      : null
    const coachProfile = conversation.coachProfileId
      ? await ctx.db.get(conversation.coachProfileId)
      : null

    // Get reservation info if linked
    let reservation: {
      _id: string
      status: string
      startDate: string
      endDate: string
      totalAmount: number
    } | null = null
    if (conversation.reservationId) {
      const res = await ctx.db.get(conversation.reservationId)
      if (res) {
        reservation = {
          _id: res._id as string,
          status: res.status,
          startDate: res.startDate,
          endDate: res.endDate,
          totalAmount: res.totalAmount,
        }
      }
    }

    return {
      ...conversation,
      vehicle,
      vehicleImageKey,
      renter,
      owner,
      team,
      driverProfile,
      coachProfile,
      reservation,
    }
  },
})

// Get conversation by vehicle and participants
export const getByVehicleAndParticipants = query({
  args: {
    vehicleId: v.id("vehicles"),
    renterId: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Verify the authenticated user is either the renter or owner
    if (identity.subject !== args.renterId && identity.subject !== args.ownerId) {
      throw new Error("Unauthorized: Cannot access other users' data")
    }

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_participants", (q) =>
        q.eq("renterId", args.renterId).eq("ownerId", args.ownerId)
      )
      .filter((q) => q.eq(q.field("vehicleId"), args.vehicleId))
      .first()

    if (!conversation) {
      return null
    }

    const [vehicle, renter, owner] = await Promise.all([
      conversation.vehicleId ? ctx.db.get(conversation.vehicleId) : null,
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", conversation.renterId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", conversation.ownerId))
        .first(),
    ])

    return {
      ...conversation,
      vehicle,
      renter,
      owner,
    }
  },
})

// Create a new conversation
export const create = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    renterId: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const userId = identity.subject

    // Ensure the authenticated user is either the renter or owner
    if (userId !== args.renterId && userId !== args.ownerId) {
      throw new Error("Not authorized to create this conversation")
    }

    // Check if conversation already exists
    const existingConversation = await ctx.db
      .query("conversations")
      .withIndex("by_participants", (q) =>
        q.eq("renterId", args.renterId).eq("ownerId", args.ownerId)
      )
      .filter((q) => q.eq(q.field("vehicleId"), args.vehicleId))
      .first()

    if (existingConversation) {
      return existingConversation._id
    }

    const now = Date.now()

    // Create the conversation as inactive - it will be activated when the first message is sent
    const conversationId = await ctx.db.insert("conversations", {
      vehicleId: args.vehicleId,
      renterId: args.renterId,
      ownerId: args.ownerId,
      lastMessageAt: now,
      unreadCountRenter: 0,
      unreadCountOwner: 0,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    })

    return conversationId
  },
})

// Mark conversation as read
export const markAsRead = mutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation) {
      throw new Error("Conversation not found")
    }

    // Ensure the user is part of the conversation
    if (conversation.renterId !== args.userId && conversation.ownerId !== args.userId) {
      throw new Error("Not authorized to mark this conversation as read")
    }

    // Update unread count based on user role
    if (conversation.renterId === args.userId) {
      await ctx.db.patch(args.conversationId, {
        updatedAt: Date.now(),
        unreadCountRenter: 0,
      })
    } else {
      await ctx.db.patch(args.conversationId, {
        updatedAt: Date.now(),
        unreadCountOwner: 0,
      })
    }

    // Mark all unread messages as read
    const unreadMessages = await ctx.db
      .query("messages")
      .withIndex("by_unread", (q) =>
        q.eq("conversationId", args.conversationId).eq("isRead", false)
      )
      .filter((q) => q.neq(q.field("senderId"), args.userId))
      .collect()

    for (const message of unreadMessages) {
      await ctx.db.patch(message._id, {
        isRead: true,
        readAt: Date.now(),
      })
    }

    return args.conversationId
  },
})

// Create a motorsports conversation (team or driver messaging)
export const createMotorsportsConversation = mutation({
  args: {
    participantId: v.string(),
    conversationType: v.union(v.literal("team"), v.literal("driver")),
    teamId: v.optional(v.id("teams")),
    driverProfileId: v.optional(v.id("driverProfiles")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const userId = identity.subject
    // Use consistent ordering: lower ID is renterId, higher is ownerId
    const [renterId, ownerId] =
      userId < args.participantId ? [userId, args.participantId] : [args.participantId, userId]

    // Check for existing motorsports conversation between these users
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_participants", (q) => q.eq("renterId", renterId).eq("ownerId", ownerId))
      .filter((q) => q.eq(q.field("conversationType"), args.conversationType))
      .first()

    if (existing) {
      return existing._id
    }

    const now = Date.now()
    return await ctx.db.insert("conversations", {
      renterId,
      ownerId,
      conversationType: args.conversationType,
      teamId: args.teamId,
      driverProfileId: args.driverProfileId,
      lastMessageAt: now,
      unreadCountRenter: 0,
      unreadCountOwner: 0,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const createCoachingConversation = mutation({
  args: {
    coachProfileId: v.id("coachProfiles"),
    message: v.string(),
    eventName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }
    const userId = identity.subject

    const profile = await ctx.db.get(args.coachProfileId)
    if (!profile) {
      throw new Error("Coach profile not found")
    }
    if (profile.userId === userId) {
      throw new Error("Cannot contact your own coach profile")
    }

    const trimmed = args.message.trim()
    if (!trimmed) {
      throw new Error("Message is required")
    }

    // Reuse existing coaching conversation between this renter and this coach profile if any
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_renter", (q) => q.eq("renterId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("ownerId"), profile.userId),
          q.eq(q.field("conversationType"), "coaching"),
          q.eq(q.field("coachProfileId"), args.coachProfileId)
        )
      )
      .first()

    const now = Date.now()
    const fullMessage = args.eventName?.trim()
      ? `[Event: ${args.eventName.trim()}]\n\n${trimmed}`
      : trimmed

    let conversationId: Id<"conversations">
    if (existing) {
      conversationId = existing._id
      await ctx.db.patch(existing._id, {
        lastMessageAt: now,
        lastMessageText: fullMessage,
        lastMessageSenderId: userId,
        unreadCountOwner: (existing.unreadCountOwner ?? 0) + 1,
        isActive: true,
        updatedAt: now,
      })
    } else {
      conversationId = await ctx.db.insert("conversations", {
        renterId: userId,
        ownerId: profile.userId,
        conversationType: "coaching",
        coachProfileId: args.coachProfileId,
        lastMessageAt: now,
        lastMessageText: fullMessage,
        lastMessageSenderId: userId,
        unreadCountRenter: 0,
        unreadCountOwner: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
    }

    await ctx.db.insert("messages", {
      conversationId,
      senderId: userId,
      content: fullMessage,
      messageType: "text",
      isRead: false,
      createdAt: now,
    })

    return conversationId
  },
})

// Archive conversation (soft delete)
export const archive = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation) {
      throw new Error("Conversation not found")
    }

    // Ensure the user is part of the conversation
    if (conversation.renterId !== identity.subject && conversation.ownerId !== identity.subject) {
      throw new Error("Not authorized to archive this conversation")
    }

    await ctx.db.patch(args.conversationId, {
      isActive: false,
      updatedAt: Date.now(),
    })

    return args.conversationId
  },
})

// Delete conversation (soft delete - per user)
// Each user can hide the conversation from their view
// The conversation is only hard deleted when both users delete it
export const deleteConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation) {
      throw new Error("Conversation not found")
    }

    // Ensure the user is part of the conversation
    if (conversation.renterId !== identity.subject && conversation.ownerId !== identity.subject) {
      throw new Error("Not authorized to delete this conversation")
    }

    const userId = identity.subject
    const isRenter = conversation.renterId === userId
    const updateData: {
      updatedAt: number
      deletedByRenter?: boolean
      deletedByOwner?: boolean
    } = {
      updatedAt: Date.now(),
    }

    // Mark as deleted by the current user
    if (isRenter) {
      updateData.deletedByRenter = true
    } else {
      updateData.deletedByOwner = true
    }

    await ctx.db.patch(args.conversationId, updateData)

    // Check if both users have deleted the conversation
    const updatedConversation = await ctx.db.get(args.conversationId)
    if (
      updatedConversation &&
      updatedConversation.deletedByRenter === true &&
      updatedConversation.deletedByOwner === true
    ) {
      // Both users have deleted - perform hard delete
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
        .collect()

      for (const message of messages) {
        await ctx.db.delete(message._id)
      }

      // Delete the conversation
      await ctx.db.delete(args.conversationId)
    }

    return args.conversationId
  },
})

// Host-specific conversation management functions

// Get conversations by vehicle for a host
export const getHostConversationsByVehicle = query({
  args: {
    hostId: v.string(),
    vehicleId: v.id("vehicles"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Verify the authenticated user matches the hostId
    if (identity.subject !== args.hostId) {
      throw new Error("Unauthorized: Cannot access other users' data")
    }

    const { hostId, vehicleId } = args

    // Get conversations for this vehicle where user is the owner
    const allConversations = await ctx.db
      .query("conversations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .filter((q) => q.eq(q.field("ownerId"), hostId))
      .collect()

    // Filter out conversations deleted by the host (owner)
    const conversations = allConversations.filter(
      (conversation) => conversation.deletedByOwner !== true
    )

    // Get detailed information for each conversation
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conversation) => {
        const renter = await ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", conversation.renterId))
          .first()

        return {
          ...conversation,
          renter,
        }
      })
    )

    return conversationsWithDetails.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  },
})

// Get conversation analytics for a host
export const getHostConversationAnalytics = query({
  args: {
    hostId: v.string(),
    timeRange: v.optional(
      v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"), v.literal("1y"))
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Verify the authenticated user matches the hostId
    if (identity.subject !== args.hostId) {
      throw new Error("Unauthorized: Cannot access other users' data")
    }

    const { hostId, timeRange = "30d" } = args

    // Calculate time threshold
    const now = Date.now()
    let timeThreshold = now

    switch (timeRange) {
      case "7d":
        timeThreshold = now - 7 * 24 * 60 * 60 * 1000
        break
      case "30d":
        timeThreshold = now - 30 * 24 * 60 * 60 * 1000
        break
      case "90d":
        timeThreshold = now - 90 * 24 * 60 * 60 * 1000
        break
      case "1y":
        timeThreshold = now - 365 * 24 * 60 * 60 * 1000
        break
    }

    // Get all conversations for this host
    const allConversations = await ctx.db
      .query("conversations")
      .withIndex("by_owner", (q) => q.eq("ownerId", hostId))
      .collect()

    // Filter out conversations deleted by the host (owner)
    const conversations = allConversations.filter((conv) => conv.deletedByOwner !== true)

    // Filter conversations by time range
    const recentConversations = conversations.filter((conv) => conv.createdAt >= timeThreshold)

    // Calculate analytics
    const totalConversations = recentConversations.length
    const activeConversations = recentConversations.filter((conv) => conv.isActive).length
    const archivedConversations = recentConversations.filter((conv) => !conv.isActive).length

    // Calculate response time metrics
    let totalResponseTime = 0
    let responseCount = 0

    for (const conversation of recentConversations) {
      // Get messages in this conversation
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation_created", (q) => q.eq("conversationId", conversation._id))
        .order("asc")
        .collect()

      // Calculate response times
      for (let i = 0; i < messages.length - 1; i++) {
        const currentMessage = messages[i]!
        const nextMessage = messages[i + 1]!

        // If current message is from renter and next is from host
        if (currentMessage.senderId !== hostId && nextMessage.senderId === hostId) {
          const responseTime = nextMessage.createdAt - currentMessage.createdAt
          totalResponseTime += responseTime
          responseCount++
        }
      }
    }

    const averageResponseTime =
      responseCount > 0
        ? Math.round(totalResponseTime / responseCount / (1000 * 60)) // Convert to minutes
        : 0

    return {
      totalConversations,
      activeConversations,
      archivedConversations,
      averageResponseTimeMinutes: averageResponseTime,
      responseCount,
      timeRange,
    }
  },
})

// Link conversation to reservation
export const linkToReservation = mutation({
  args: {
    conversationId: v.id("conversations"),
    reservationId: v.id("reservations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation) {
      throw new Error("Conversation not found")
    }

    // Ensure the user is part of the conversation
    if (conversation.renterId !== identity.subject && conversation.ownerId !== identity.subject) {
      throw new Error("Not authorized to modify this conversation")
    }

    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) {
      throw new Error("Reservation not found")
    }

    // Verify the reservation participants match the conversation
    if (
      reservation.renterId !== conversation.renterId ||
      reservation.ownerId !== conversation.ownerId
    ) {
      throw new Error("Reservation participants do not match conversation participants")
    }

    await ctx.db.patch(args.conversationId, {
      reservationId: args.reservationId,
      updatedAt: Date.now(),
    })

    return args.conversationId
  },
})

// Bulk operations for host conversations
export const bulkHostConversationActions = mutation({
  args: {
    hostId: v.string(),
    conversationIds: v.array(v.id("conversations")),
    action: v.union(
      v.literal("archive"),
      v.literal("unarchive"),
      v.literal("mark_read"),
      v.literal("delete")
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const { hostId, conversationIds, action } = args

    // Verify the authenticated user is the host
    if (identity.subject !== hostId) {
      throw new Error("Not authorized to perform this action")
    }

    const processedConversations: string[] = []

    for (const conversationId of conversationIds) {
      const conversation = await ctx.db.get(conversationId)
      if (!conversation) {
        continue
      }

      // Verify this conversation belongs to the host (either as owner or renter)
      if (conversation.ownerId !== hostId && conversation.renterId !== hostId) {
        throw new Error("Not authorized to perform this action on this conversation")
      }

      switch (action) {
        case "archive":
          await ctx.db.patch(conversationId, {
            isActive: false,
            updatedAt: Date.now(),
          })
          break

        case "unarchive":
          await ctx.db.patch(conversationId, {
            isActive: true,
            updatedAt: Date.now(),
          })
          break

        case "mark_read": {
          // Mark all unread messages as read
          const unreadMessages = await ctx.db
            .query("messages")
            .withIndex("by_unread", (q) =>
              q.eq("conversationId", conversationId).eq("isRead", false)
            )
            .filter((q) => q.neq(q.field("senderId"), hostId))
            .collect()

          for (const message of unreadMessages) {
            await ctx.db.patch(message._id, {
              isRead: true,
              readAt: Date.now(),
            })
          }

          await ctx.db.patch(conversationId, {
            unreadCountOwner: 0,
            updatedAt: Date.now(),
          })
          break
        }

        case "delete": {
          // Soft delete - mark as deleted by the host
          const isRenter = conversation.renterId === hostId
          const updateData: {
            updatedAt: number
            deletedByRenter?: boolean
            deletedByOwner?: boolean
          } = {
            updatedAt: Date.now(),
          }

          if (isRenter) {
            updateData.deletedByRenter = true
          } else {
            updateData.deletedByOwner = true
          }

          await ctx.db.patch(conversationId, updateData)

          // Check if both users have deleted - if so, hard delete
          const updatedConversation = await ctx.db.get(conversationId)
          if (
            updatedConversation &&
            updatedConversation.deletedByRenter === true &&
            updatedConversation.deletedByOwner === true
          ) {
            // Both users have deleted - perform hard delete
            const messages = await ctx.db
              .query("messages")
              .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
              .collect()

            for (const message of messages) {
              await ctx.db.delete(message._id)
            }

            // Delete the conversation
            await ctx.db.delete(conversationId)
          }
          break
        }
      }

      processedConversations.push(conversationId)
    }

    return {
      action,
      processedCount: processedConversations.length,
      conversationIds: processedConversations,
    }
  },
})
