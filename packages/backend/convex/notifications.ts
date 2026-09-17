import { v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server"

// Create notification (internal - called from other mutations via scheduler)
export const createNotification = internalMutation({
  args: {
    userId: v.string(),
    type: v.union(
      v.literal("reservation_approved"),
      v.literal("reservation_declined"),
      v.literal("reservation_cancelled"),
      v.literal("reservation_completed"),
      v.literal("new_message"),
      v.literal("payment_success"),
      v.literal("payment_failed"),
      v.literal("dispute_update"),
      v.literal("review_received"),
      v.literal("system"),
      v.literal("team_application"),
      v.literal("connection_request"),
      v.literal("application_status_change"),
      v.literal("endorsement_received"),
      v.literal("team_event"),
      v.literal("profile_view"),
      v.literal("damage_invoice"),
      v.literal("coaching_request_pending"),
      v.literal("coaching_approved"),
      v.literal("coaching_declined"),
      v.literal("coaching_cancelled"),
      v.literal("coaching_completed"),
      v.literal("seat_request_pending"),
      v.literal("seat_approved"),
      v.literal("seat_declined"),
      v.literal("seat_cancelled"),
      v.literal("seat_waitlisted"),
      v.literal("seat_spot_available"),
      v.literal("seat_completed")
    ),
    title: v.string(),
    message: v.string(),
    link: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Get user's notification preferences
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.userId))
      .first()

    // Check if user has preferences set
    if (user?.notificationPreferences) {
      const prefs = user.notificationPreferences

      // Map notification type to preference key
      let shouldNotify = true

      if (
        args.type === "reservation_approved" ||
        args.type === "reservation_declined" ||
        args.type === "reservation_cancelled" ||
        args.type === "reservation_completed" ||
        args.type === "seat_request_pending" ||
        args.type === "seat_approved" ||
        args.type === "seat_declined" ||
        args.type === "seat_cancelled" ||
        args.type === "seat_waitlisted" ||
        args.type === "seat_spot_available" ||
        args.type === "seat_completed"
      ) {
        shouldNotify = prefs.reservationUpdates
      } else if (args.type === "new_message") {
        shouldNotify = prefs.messages
      } else if (
        args.type === "payment_success" ||
        args.type === "payment_failed" ||
        args.type === "damage_invoice"
      ) {
        shouldNotify = prefs.paymentUpdates
      } else if (args.type === "review_received") {
        shouldNotify = prefs.reviewsAndRatings
      }

      // Skip creating notification if user has disabled this type
      if (!shouldNotify) {
        return null
      }
    }

    // Create the notification
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      message: args.message,
      isRead: false,
      link: args.link,
      metadata: args.metadata,
      createdAt: Date.now(),
    })

    return notificationId
  },
})

// Get user's notifications
export const getUserNotifications = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || identity.subject !== args.userId) {
      return []
    }

    const { userId, limit = 20 } = args

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit)

    return notifications
  },
})

// Get unread notification count
export const getUnreadCount = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || identity.subject !== args.userId) {
      return 0
    }

    const { userId } = args

    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("isRead", false))
      .collect()

    return unreadNotifications.length
  },
})

// Mark notification as read
export const markAsRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const notification = await ctx.db.get(args.notificationId)
    if (!notification) {
      throw new Error("Notification not found")
    }

    // Verify notification belongs to user
    if (notification.userId !== identity.subject) {
      throw new Error("Not authorized to mark this notification as read")
    }

    await ctx.db.patch(args.notificationId, {
      isRead: true,
    })

    return args.notificationId
  },
})

// Mark all notifications as read
export const markAllAsRead = mutation({
  args: {
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

    const { userId } = args

    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("isRead", false))
      .collect()

    for (const notification of unreadNotifications) {
      await ctx.db.patch(notification._id, {
        isRead: true,
      })
    }

    return unreadNotifications.length
  },
})
