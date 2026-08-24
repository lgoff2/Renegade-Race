import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import {
  endDateFromDuration,
  inclusiveRentalDays,
  isValidRentalDuration,
  MAX_RENTAL_DURATION_DAYS,
  MIN_RENTAL_DURATION_DAYS,
} from "./dateUtils"
import { calculateReservationTotal } from "./pricing"
import {
  getReservationApprovedRenterEmailTemplate,
  getReservationCancelledEmailTemplate,
  getReservationCompletedEmailTemplate,
  getReservationDeclinedRenterEmailTemplate,
  getReservationPendingOwnerEmailTemplate,
  sendTransactionalEmail,
} from "./emails"
import { ErrorCode, throwError } from "./errors"
import { getWebUrl } from "./helpers"
import { rateLimiter } from "./rateLimiter"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"

// Get reservations for a user (as renter or owner)
export const getByUser = query({
  args: {
    userId: v.string(),
    role: v.union(v.literal("renter"), v.literal("owner")),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("confirmed"),
        v.literal("cancelled"),
        v.literal("completed"),
        v.literal("declined")
      )
    ),
  },
  handler: async (ctx, args) => {
    const { userId, role, status } = args

    let reservationsQuery
    if (role === "renter") {
      reservationsQuery = ctx.db
        .query("reservations")
        .withIndex("by_renter", (q) => q.eq("renterId", userId))
    } else {
      reservationsQuery = ctx.db
        .query("reservations")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    }

    if (status) {
      reservationsQuery = reservationsQuery.filter((q) => q.eq(q.field("status"), status))
    }

    const reservations = await reservationsQuery.order("desc").collect()

    // Get vehicle and user details
    const reservationsWithDetails = await Promise.all(
      reservations.map(async (reservation) => {
        const [vehicle, renter, owner] = await Promise.all([
          ctx.db.get(reservation.vehicleId),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
            .first(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
            .first(),
        ])

        // Get vehicle images if vehicle exists
        let vehicleWithImages = vehicle
        if (vehicle) {
          const images = await ctx.db
            .query("vehicleImages")
            .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id as Id<"vehicles">))
            .order("asc")
            .collect()

          vehicleWithImages = {
            ...vehicle,
            images,
          } as typeof vehicle & { images: typeof images }
        }

        return {
          ...reservation,
          vehicle: vehicleWithImages,
          renter,
          owner,
        }
      })
    )

    return reservationsWithDetails
  },
})

// Get reservation by ID
export const getById = query({
  args: { id: v.id("reservations") },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.id)
    if (!reservation) {
      return null
    }

    const [vehicle, renter, owner] = await Promise.all([
      ctx.db.get(reservation.vehicleId),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
        .first(),
    ])

    // Get vehicle images if vehicle exists
    let vehicleWithImages = vehicle
    if (vehicle) {
      const images = await ctx.db
        .query("vehicleImages")
        .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
        .order("asc")
        .collect()

      vehicleWithImages = {
        ...vehicle,
        images,
      } as typeof vehicle & { images: typeof images }
    }

    return {
      ...reservation,
      vehicle: vehicleWithImages,
      renter,
      owner,
    }
  },
})

// Active requests/bookings for a vehicle — informational, not a renter block.
export const listActiveForVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "approved"),
          q.eq(q.field("status"), "confirmed")
        )
      )
      .collect()

    return reservations.map((reservation) => ({
      _id: reservation._id,
      status: reservation.status,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
    }))
  },
})

// Create a new reservation
export const create = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    startDate: v.string(),
    // Inclusive last occupied day. Preferred: pass durationDays and omit this.
    endDate: v.optional(v.string()),
    durationDays: v.optional(v.number()),
    pickupTime: v.optional(v.string()),
    dropoffTime: v.optional(v.string()),
    renterMessage: v.optional(v.string()),
    addOns: v.optional(
      v.array(
        v.object({
          name: v.string(),
          price: v.number(),
          description: v.optional(v.string()),
          priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    // Rate limit: 10 reservations per hour per user
    await rateLimiter.limit(ctx, "createReservation", {
      key: identity.subject,
      throws: true,
    })

    const renterId = identity.subject
    const now = Date.now()

    // Get vehicle details
    const vehicle = await ctx.db.get(args.vehicleId)
    if (!vehicle) {
      throwError(ErrorCode.NOT_FOUND, "Vehicle not found", { vehicleId: args.vehicleId })
    }

    if (vehicle.ownerId === renterId) {
      throwError(ErrorCode.CANNOT_BOOK_OWN_VEHICLE, "Cannot book your own vehicle")
    }

    // Check if either party has blocked the other
    const block1 = await ctx.db
      .query("userBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", renterId).eq("blockedUserId", vehicle.ownerId)
      )
      .first()

    const block2 = await ctx.db
      .query("userBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", vehicle.ownerId).eq("blockedUserId", renterId)
      )
      .first()

    if (block1 || block2) {
      throwError(ErrorCode.USER_BLOCKED, "Cannot book vehicles from blocked users")
    }

    // Rental length is start date + 1–3 occupied days (inclusive).
    let totalDays: number
    let endDate: string

    if (args.durationDays !== undefined) {
      if (!isValidRentalDuration(args.durationDays)) {
        throwError(
          ErrorCode.INVALID_DATE_RANGE,
          `Rental length must be ${MIN_RENTAL_DURATION_DAYS}–${MAX_RENTAL_DURATION_DAYS} days`,
          { durationDays: args.durationDays }
        )
      }
      const computedEnd = endDateFromDuration(args.startDate, args.durationDays)
      if (!computedEnd) {
        throwError(ErrorCode.INVALID_DATE_RANGE, "Invalid start date", {
          startDate: args.startDate,
        })
      }
      totalDays = args.durationDays
      endDate = computedEnd
    } else if (args.endDate) {
      totalDays = inclusiveRentalDays(args.startDate, args.endDate)
      endDate = args.endDate
      if (!isValidRentalDuration(totalDays)) {
        throwError(
          ErrorCode.INVALID_DATE_RANGE,
          `Rental length must be ${MIN_RENTAL_DURATION_DAYS}–${MAX_RENTAL_DURATION_DAYS} days`,
          { startDate: args.startDate, endDate: args.endDate, totalDays }
        )
      }
    } else {
      throwError(ErrorCode.INVALID_DATE_RANGE, "Start date and rental length are required")
    }

    // Monetary validation for daily rate
    const MAX_DAILY_RATE_CENTS = 5_000_000 // $50,000 per day max
    const MIN_DAILY_RATE_CENTS = 100 // $1 per day min

    if (vehicle.dailyRate <= 0 || vehicle.dailyRate < MIN_DAILY_RATE_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Daily rate must be at least $1.00", {
        dailyRate: vehicle.dailyRate,
      })
    }

    if (vehicle.dailyRate > MAX_DAILY_RATE_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Daily rate cannot exceed $50,000.00 per day", {
        dailyRate: vehicle.dailyRate,
      })
    }

    // Validate add-on prices before calculating totals
    if (args.addOns && args.addOns.length > 0) {
      for (const addOn of args.addOns) {
        if (addOn.price < 0) {
          throwError(ErrorCode.INVALID_AMOUNT, `Add-on price for ${addOn.name} cannot be negative`)
        }
        // Validate reasonable max for add-ons
        if (addOn.price > 100_000) {
          // $1,000 max per add-on
          throwError(
            ErrorCode.INVALID_AMOUNT,
            `Add-on price for ${addOn.name} cannot exceed $1,000.00`
          )
        }
      }
    }

    const totalAmount = calculateReservationTotal(vehicle.dailyRate, totalDays, args.addOns)

    // Validate total amount
    const MAX_TOTAL_AMOUNT_CENTS = 1_000_000 // $10,000 max
    const MIN_TOTAL_AMOUNT_CENTS = 100 // $1 min

    if (totalAmount < MIN_TOTAL_AMOUNT_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Total amount must be at least $1.00", { totalAmount })
    }

    if (totalAmount > MAX_TOTAL_AMOUNT_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Total amount cannot exceed $10,000.00", {
        totalAmount,
      })
    }

    // Owner-blocked dates stay visible to hosts, but they do not prevent a
    // renter from submitting a request. Existing bookings/requests also do not
    // block — owners and admins choose which overlapping request to accept.

    // Create the reservation with sanitized content
    const reservationId = await ctx.db.insert("reservations", {
      vehicleId: args.vehicleId,
      renterId,
      ownerId: vehicle.ownerId,
      startDate: args.startDate,
      endDate,
      pickupTime: args.pickupTime,
      dropoffTime: args.dropoffTime,
      totalDays,
      dailyRate: vehicle.dailyRate,
      totalAmount,
      status: "pending",
      renterMessage: args.renterMessage ? sanitizeMessage(args.renterMessage) : undefined,
      addOns: args.addOns,
      createdAt: now,
      updatedAt: now,
    })

    // Auto-create a conversation linked to this reservation
    const conversationId = await ctx.db.insert("conversations", {
      vehicleId: args.vehicleId,
      renterId,
      ownerId: vehicle.ownerId,
      reservationId,
      lastMessageAt: now,
      unreadCountRenter: 0,
      unreadCountOwner: args.renterMessage ? 1 : 0,
      isActive: !!args.renterMessage,
      createdAt: now,
      updatedAt: now,
    })

    // If renter included a message, insert it as the first message in the conversation
    if (args.renterMessage) {
      await ctx.db.insert("messages", {
        conversationId,
        senderId: renterId,
        content: sanitizeMessage(args.renterMessage),
        messageType: "text",
        isRead: false,
        createdAt: now,
      })
    }

    // Send email to owner about new reservation request
    try {
      const [owner, renter] = await Promise.all([
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", vehicle.ownerId))
          .first(),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", renterId))
          .first(),
      ])

      const ownerEmail = owner?.email || (identity as any).email
      const renterName = renter?.name || identity.name || "Guest"
      const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`

      if (ownerEmail) {
        const webUrl = getWebUrl()
        const template = getReservationPendingOwnerEmailTemplate({
          ownerName: owner?.name || "Owner",
          renterName,
          vehicleName,
          startDate: args.startDate,
          endDate,
          totalAmount,
          renterMessage: args.renterMessage,
          reservationUrl: `${webUrl}/host/reservations`,
        })
        await sendTransactionalEmail(ctx, ownerEmail, template)
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send reservation created email")
      // Don't fail the mutation if email fails
    }

    return reservationId
  },
})

// Approve a reservation
export const approve = mutation({
  args: {
    reservationId: v.id("reservations"),
    ownerMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found", {
        reservationId: args.reservationId,
      })
    }

    if (reservation.ownerId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to approve this reservation")
    }

    if (reservation.status !== "pending") {
      throwError(ErrorCode.INVALID_STATUS, "Reservation is not pending", {
        currentStatus: reservation.status,
      })
    }

    const now = Date.now()

    await ctx.db.patch(args.reservationId, {
      status: "approved",
      approvedAt: now,
      ownerMessage: args.ownerMessage ? sanitizeMessage(args.ownerMessage) : undefined,
      updatedAt: now,
    })

    // Auto-decline overlapping pending requests for the same vehicle/dates
    const overlappingPending = await ctx.db
      .query("reservations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", reservation.vehicleId))
      .filter((q) =>
        q.and(
          q.neq(q.field("_id"), args.reservationId),
          q.eq(q.field("status"), "pending"),
          q.and(
            q.lte(q.field("startDate"), reservation.endDate),
            q.gte(q.field("endDate"), reservation.startDate)
          )
        )
      )
      .collect()

    for (const pendingRes of overlappingPending) {
      await ctx.db.patch(pendingRes._id, {
        status: "declined",
        ownerMessage: "Another request for these dates was approved.",
        updatedAt: now,
      })

      // Notify declined renters
      await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
        userId: pendingRes.renterId,
        type: "reservation_declined",
        title: "Reservation Declined",
        message: "Another request for these dates was approved by the host.",
        link: `/vehicles/${pendingRes.vehicleId}`,
        metadata: {
          reservationId: pendingRes._id,
        },
      })
    }

    // Trigger notification for renter with link to pay
    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: reservation.renterId,
      type: "reservation_approved",
      title: "Reservation Approved",
      message: "Your reservation has been approved! Complete payment to confirm your booking.",
      link: `/checkout/pay?reservationId=${args.reservationId}`,
      metadata: {
        reservationId: args.reservationId,
      },
    })

    // Send email to renter about approved reservation
    try {
      const [vehicle, renter] = await Promise.all([
        ctx.db.get(reservation.vehicleId),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
          .first(),
      ])

      if (vehicle && renter) {
        const renterEmail = renter.email
        const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`

        if (renterEmail) {
          const webUrl = getWebUrl()
          const template = getReservationApprovedRenterEmailTemplate({
            renterName: renter.name || "Guest",
            vehicleName,
            startDate: reservation.startDate,
            endDate: reservation.endDate,
            totalAmount: reservation.totalAmount,
            ownerMessage: args.ownerMessage,
            paymentUrl: `${webUrl}/checkout/pay?reservationId=${args.reservationId}`,
          })
          await sendTransactionalEmail(ctx, renterEmail, template)
        }
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send reservation approved email")
      // Don't fail the mutation if email fails
    }

    return args.reservationId
  },
})

// Decline a reservation
export const decline = mutation({
  args: {
    reservationId: v.id("reservations"),
    ownerMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found", {
        reservationId: args.reservationId,
      })
    }

    if (reservation.ownerId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to decline this reservation")
    }

    if (reservation.status !== "pending" && reservation.status !== "approved") {
      throwError(ErrorCode.INVALID_STATUS, "Reservation is not pending or approved", {
        currentStatus: reservation.status,
      })
    }

    await ctx.db.patch(args.reservationId, {
      status: "declined",
      ownerMessage: args.ownerMessage ? sanitizeMessage(args.ownerMessage) : undefined,
      updatedAt: Date.now(),
    })

    // Trigger notification for renter
    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: reservation.renterId,
      type: "reservation_declined",
      title: "Reservation Declined",
      message: "Your reservation request has been declined.",
      link: `/vehicles/${reservation.vehicleId}`,
      metadata: {
        reservationId: args.reservationId,
      },
    })

    // Send email to renter about declined reservation
    try {
      const [vehicle, renter] = await Promise.all([
        ctx.db.get(reservation.vehicleId),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
          .first(),
      ])

      if (vehicle && renter) {
        const renterEmail = renter.email
        const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`

        if (renterEmail) {
          const template = getReservationDeclinedRenterEmailTemplate({
            renterName: renter.name || "Guest",
            vehicleName,
            ownerMessage: args.ownerMessage,
          })
          await sendTransactionalEmail(ctx, renterEmail, template)
        }
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send reservation declined email")
      // Don't fail the mutation if email fails
    }

    return args.reservationId
  },
})

// Cancel a reservation
export const cancel = mutation({
  args: {
    reservationId: v.id("reservations"),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found", {
        reservationId: args.reservationId,
      })
    }

    if (reservation.renterId !== identity.subject && reservation.ownerId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to cancel this reservation")
    }

    if (
      reservation.status !== "pending" &&
      reservation.status !== "approved" &&
      reservation.status !== "confirmed"
    ) {
      throwError(ErrorCode.INVALID_STATUS, "Reservation cannot be cancelled", {
        currentStatus: reservation.status,
      })
    }

    await ctx.db.patch(args.reservationId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason
        ? sanitizeShortText(args.cancellationReason)
        : undefined,
      updatedAt: Date.now(),
    })

    // Detect if the canceller is the owner
    const isOwnerCancelling = identity.subject === reservation.ownerId

    // Trigger notification for the other party
    const otherPartyId = isOwnerCancelling ? reservation.renterId : reservation.ownerId
    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: otherPartyId,
      type: "reservation_cancelled",
      title: "Reservation Cancelled",
      message: "A reservation has been cancelled.",
      link: isOwnerCancelling ? "/trips" : "/host/reservations",
      metadata: {
        reservationId: args.reservationId,
      },
    })

    // Process automatic refund if payment exists and is paid
    if (reservation.paymentId) {
      try {
        const payment = await ctx.db.get(reservation.paymentId)
        if (payment && payment.status === "succeeded" && payment.stripeChargeId) {
          // If owner is cancelling a confirmed reservation, force 100% refund
          const forceFullRefund = isOwnerCancelling && reservation.status === "confirmed"

          // Schedule refund processing (use scheduler to call internal action)
          await ctx.scheduler.runAfter(0, internal.stripe.processRefundOnCancellation, {
            paymentId: reservation.paymentId,
            reservationId: args.reservationId,
            reason: args.cancellationReason || "Reservation cancelled",
            forceFullRefund,
          })

          // If owner cancelled a confirmed reservation, increment their cancellation count
          if (forceFullRefund) {
            const owner = await ctx.db
              .query("users")
              .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
              .first()

            if (owner) {
              await ctx.db.patch(owner._id, {
                ownerCancellationCount: (owner.ownerCancellationCount || 0) + 1,
              })
            }
          }
        }
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logError } = require("./logger")
        logError(error, "Failed to initiate refund on cancellation")
        // Don't fail the cancellation if refund initiation fails
        // The refund can be processed manually later
      }
    }

    // Send emails to both parties about cancelled reservation
    try {
      const [vehicle, renter, owner] = await Promise.all([
        ctx.db.get(reservation.vehicleId),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
          .first(),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
          .first(),
      ])

      if (vehicle) {
        const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        const _isRenter = reservation.renterId === identity.subject

        // Email to renter
        if (renter?.email) {
          const template = getReservationCancelledEmailTemplate({
            userName: renter.name || "Guest",
            vehicleName,
            role: "renter",
            cancellationReason: args.cancellationReason,
          })
          await sendTransactionalEmail(ctx, renter.email, template)
        }

        // Email to owner
        if (owner?.email) {
          const template = getReservationCancelledEmailTemplate({
            userName: owner.name || "Owner",
            vehicleName,
            role: "owner",
            cancellationReason: args.cancellationReason,
          })
          await sendTransactionalEmail(ctx, owner.email, template)
        }
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send reservation cancelled emails")
      // Don't fail the mutation if email fails
    }

    return args.reservationId
  },
})

// Complete a reservation
export const complete = mutation({
  args: {
    reservationId: v.id("reservations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found", {
        reservationId: args.reservationId,
      })
    }

    if (reservation.ownerId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to complete this reservation")
    }

    if (reservation.status !== "confirmed") {
      throwError(ErrorCode.INVALID_STATUS, "Reservation is not confirmed", {
        currentStatus: reservation.status,
      })
    }

    await ctx.db.patch(args.reservationId, {
      status: "completed",
      updatedAt: Date.now(),
    })

    // Trigger notifications for both parties
    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: reservation.renterId,
      type: "reservation_completed",
      title: "Reservation Completed",
      message: "Your reservation has been completed. Please leave a review!",
      link: `/review/${args.reservationId}`,
      metadata: {
        reservationId: args.reservationId,
      },
    })

    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: reservation.ownerId,
      type: "reservation_completed",
      title: "Reservation Completed",
      message: "A reservation has been completed. Please leave a review!",
      link: `/review/${args.reservationId}`,
      metadata: {
        reservationId: args.reservationId,
      },
    })

    // Send emails to both parties about completed reservation (prompt for review)
    try {
      const [vehicle, renter, owner] = await Promise.all([
        ctx.db.get(reservation.vehicleId),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
          .first(),
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
          .first(),
      ])

      if (vehicle) {
        const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        const webUrl = getWebUrl()

        // Email to renter (prompt to review owner/vehicle)
        if (renter?.email) {
          const template = getReservationCompletedEmailTemplate({
            userName: renter.name || "Guest",
            vehicleName,
            role: "renter",
            reviewUrl: `${webUrl}/review/${reservation._id}`,
          })
          await sendTransactionalEmail(ctx, renter.email, template)
        }

        // Email to owner (prompt to review renter)
        if (owner?.email) {
          const template = getReservationCompletedEmailTemplate({
            userName: owner.name || "Owner",
            vehicleName,
            role: "owner",
            reviewUrl: `${webUrl}/review/${reservation._id}`,
          })
          await sendTransactionalEmail(ctx, owner.email, template)
        }
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send reservation completed emails")
      // Don't fail the mutation if email fails
    }

    return args.reservationId
  },
})

// Get pending reservations for an owner
export const getPendingForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", args.ownerId).eq("status", "pending"))
      .order("desc")
      .collect()

    // Get vehicle and renter details
    const reservationsWithDetails = await Promise.all(
      reservations.map(async (reservation) => {
        const [vehicle, renter] = await Promise.all([
          ctx.db.get(reservation.vehicleId),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
            .first(),
        ])

        return {
          ...reservation,
          vehicle,
          renter,
        }
      })
    )

    return reservationsWithDetails
  },
})

// Get approved reservations awaiting payment for a renter
export const getApprovedForRenter = query({
  args: { renterId: v.string() },
  handler: async (ctx, args) => {
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_renter_status", (q) =>
        q.eq("renterId", args.renterId).eq("status", "approved")
      )
      .order("desc")
      .collect()

    // Get vehicle and owner details
    const reservationsWithDetails = await Promise.all(
      reservations.map(async (reservation) => {
        const [vehicle, owner] = await Promise.all([
          ctx.db.get(reservation.vehicleId),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
            .first(),
        ])

        return {
          ...reservation,
          vehicle,
          owner,
        }
      })
    )

    return reservationsWithDetails
  },
})

// Get confirmed reservations for an owner
export const getConfirmedForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", args.ownerId).eq("status", "confirmed"))
      .order("desc")
      .collect()

    // Get vehicle and renter details
    const reservationsWithDetails = await Promise.all(
      reservations.map(async (reservation) => {
        const [vehicle, renter] = await Promise.all([
          ctx.db.get(reservation.vehicleId),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
            .first(),
        ])

        return {
          ...reservation,
          vehicle,
          renter,
        }
      })
    )

    return reservationsWithDetails
  },
})

// Get upcoming reservations for a user
export const getUpcoming = query({
  args: {
    userId: v.string(),
    role: v.union(v.literal("renter"), v.literal("owner")),
  },
  handler: async (ctx, args) => {
    const { userId, role } = args
    const today = new Date().toISOString().split("T")[0] as string

    let reservationsQuery
    if (role === "renter") {
      reservationsQuery = ctx.db
        .query("reservations")
        .withIndex("by_renter_status", (q) => q.eq("renterId", userId).eq("status", "confirmed"))
    } else {
      reservationsQuery = ctx.db
        .query("reservations")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", userId).eq("status", "confirmed"))
    }

    const reservations = await reservationsQuery
      .filter((q) => q.gte(q.field("startDate"), today))
      .order("asc")
      .collect()

    // Get vehicle and user details
    const reservationsWithDetails = await Promise.all(
      reservations.map(async (reservation) => {
        const [vehicle, renter, owner] = await Promise.all([
          ctx.db.get(reservation.vehicleId),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
            .first(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
            .first(),
        ])

        return {
          ...reservation,
          vehicle,
          renter,
          owner,
        }
      })
    )

    return reservationsWithDetails
  },
})

// Get completed reservation for a specific vehicle by a user (for review purposes)
export const getCompletedReservationForVehicle = query({
  args: {
    userId: v.string(),
    vehicleId: v.id("vehicles"),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("reservations")
      .withIndex("by_renter_status", (q) => q.eq("renterId", args.userId).eq("status", "completed"))
      .filter((q) => q.eq(q.field("vehicleId"), args.vehicleId))
      .order("desc")
      .first()

    if (!reservation) {
      return null
    }

    // Get related data
    const [vehicle, renter, owner] = await Promise.all([
      ctx.db.get(reservation.vehicleId),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", reservation.renterId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", reservation.ownerId))
        .first(),
    ])

    return {
      ...reservation,
      vehicle,
      renter,
      owner,
    }
  },
})

// ============================================================================
// Cleanup Functions for Stale Pending Reservations
// ============================================================================

/**
 * Clean up approved reservations that weren't paid within 48 hours.
 * This should be called periodically (e.g., by a cron job) to:
 * - Cancel approved reservations without payment that are older than 48 hours
 * - This frees up the vehicle for other renters
 *
 * Called via: ctx.scheduler or cron.ts
 */
export const cleanupExpiredApprovedReservations = mutation({
  args: {},
  handler: async (ctx) => {
    const APPROVED_TIMEOUT_MS = 48 * 60 * 60 * 1000 // 48 hours
    const now = Date.now()

    // Find all approved reservations without payment that are older than 48 hours
    const expiredReservations = await ctx.db
      .query("reservations")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .filter((q) =>
        q.and(
          // No payment associated
          q.eq(q.field("paymentId"), undefined),
          // Approved more than 48 hours ago
          q.lt(q.field("approvedAt"), now - APPROVED_TIMEOUT_MS)
        )
      )
      .collect()

    // Cancel each expired reservation
    const cancelledIds: Id<"reservations">[] = []
    for (const reservation of expiredReservations) {
      await ctx.db.patch(reservation._id, {
        status: "cancelled",
        cancellationReason: "Automatically cancelled - payment not completed within 48 hours",
        updatedAt: now,
      })
      cancelledIds.push(reservation._id)

      // Notify the renter
      await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
        userId: reservation.renterId,
        type: "reservation_cancelled",
        title: "Reservation Expired",
        message:
          "Your approved reservation was cancelled because payment was not completed within 48 hours.",
        link: `/vehicles/${reservation.vehicleId}`,
        metadata: {
          reservationId: reservation._id,
        },
      })
    }

    return {
      cleanedUp: cancelledIds.length,
      reservationIds: cancelledIds,
    }
  },
})
