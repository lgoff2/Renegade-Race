import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server"
import { checkAdmin } from "./admin"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"
import {
  findOpenBookingForDriver,
  getActivePlatformFeePercentage,
  getOfferingInventory,
  holdsSeat,
  isAdminIdentity,
  isTeamManager,
  omitHostUserId,
  promoteOldestWaitlisted,
  requireIdentity,
  requireTeamManager,
  toPublicTeamListing,
} from "./seatHelpers"

const bookingStatusValidator = v.union(
  v.literal("pending"),
  v.literal("waitlisted"),
  v.literal("approved"),
  v.literal("deposit_paid"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("declined"),
  v.literal("expired"),
  v.literal("completed")
)

async function notify(
  ctx: MutationCtx,
  args: {
    userId: string
    type:
      | "seat_request_pending"
      | "seat_approved"
      | "seat_declined"
      | "seat_cancelled"
      | "seat_waitlisted"
      | "seat_spot_available"
      | "seat_completed"
    title: string
    message: string
    link: string
    metadata: Record<string, unknown>
  }
) {
  await ctx.scheduler.runAfter(0, internal.notifications.createNotification, args)
}

async function auditStatusChange(
  ctx: MutationCtx,
  args: {
    bookingId: any
    userId?: string
    previousStatus: string
    newStatus: string
  }
) {
  await ctx.runMutation(internal.auditLog.create, {
    entityType: "seat_booking",
    entityId: args.bookingId,
    action: "status_change",
    userId: args.userId,
    previousState: { status: args.previousStatus },
    newState: { status: args.newStatus },
  })
}

export const request = mutation({
  args: {
    offeringId: v.id("seatOfferings"),
    driverMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await rateLimiter.limit(ctx, "createReservation", {
      key: identity.subject,
      throws: true,
    })

    const driverId = identity.subject
    const offering = await ctx.db.get(args.offeringId)
    if (!offering) {
      throwError(ErrorCode.NOT_FOUND, "Seat offering not found")
    }
    if (!offering.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "This seat offering is no longer listed")
    }

    const [teamCar, event, team] = await Promise.all([
      ctx.db.get(offering.teamCarId),
      ctx.db.get(offering.raceEventId),
      ctx.db.get(offering.teamId),
    ])
    if (!teamCar?.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Team car is not available")
    }
    if (!event?.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Race event is not available")
    }
    if (!team?.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Team is not available")
    }

    const today = new Date().toISOString().split("T")[0] as string
    if (event.endDate < today) {
      throwError(ErrorCode.INVALID_DATE_RANGE, "This event has already ended")
    }

    if (driverId === offering.hostUserId || driverId === team.ownerId) {
      throwError(ErrorCode.CANNOT_BOOK_OWN_VEHICLE, "Cannot request a seat on your own team car")
    }

    const [block1, block2] = await Promise.all([
      ctx.db
        .query("userBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", driverId).eq("blockedUserId", offering.hostUserId)
        )
        .first(),
      ctx.db
        .query("userBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", offering.hostUserId).eq("blockedUserId", driverId)
        )
        .first(),
    ])
    if (block1 || block2) {
      throwError(ErrorCode.USER_BLOCKED, "Cannot request this seat")
    }

    const duplicate = await findOpenBookingForDriver(ctx, args.offeringId, driverId)
    if (duplicate) {
      throwError(ErrorCode.ALREADY_EXISTS, "You already have an open request for this seat")
    }

    const inventory = await getOfferingInventory(ctx, offering)
    const waitlisted = inventory.remaining <= 0
    const now = Date.now()
    const driverMessage = args.driverMessage ? sanitizeMessage(args.driverMessage) : undefined
    const platformFeePercentage = await getActivePlatformFeePercentage(ctx)

    const bookingId = await ctx.db.insert("seatBookings", {
      seatOfferingId: offering._id,
      teamCarId: offering.teamCarId,
      raceEventId: offering.raceEventId,
      teamId: offering.teamId,
      hostUserId: offering.hostUserId,
      driverId,
      status: waitlisted ? "waitlisted" : "pending",
      priceCents: offering.priceCents,
      depositCents: offering.depositCents,
      balanceCents: offering.priceCents - offering.depositCents,
      platformFeePercentage,
      driverMessage,
      waitlistedAt: waitlisted ? now : undefined,
      createdAt: now,
      updatedAt: now,
    })

    if (waitlisted) {
      await notify(ctx, {
        userId: driverId,
        type: "seat_waitlisted",
        title: "You're on the waitlist",
        message:
          "This seat offering is full. We'll notify you if a spot opens; the team still has to approve before payment.",
        link: "/trips",
        metadata: { bookingId, offeringId: offering._id },
      })
      await notify(ctx, {
        userId: offering.hostUserId,
        type: "seat_request_pending",
        title: "New seat waitlist request",
        message: "A driver joined the waitlist for a full seat offering.",
        link: "/motorsports/profile/team",
        metadata: { bookingId, offeringId: offering._id },
      })
    } else {
      await notify(ctx, {
        userId: offering.hostUserId,
        type: "seat_request_pending",
        title: "New race seat request",
        message: "A driver requested a seat on your team car. Approve or decline the request.",
        link: "/motorsports/profile/team",
        metadata: { bookingId, offeringId: offering._id },
      })
    }

    await auditStatusChange(ctx, {
      bookingId,
      userId: driverId,
      previousStatus: "none",
      newStatus: waitlisted ? "waitlisted" : "pending",
    })

    return { bookingId, status: waitlisted ? "waitlisted" : "pending" }
  },
})

export const approve = mutation({
  args: {
    bookingId: v.id("seatBookings"),
    teamMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) {
      throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
    }
    await requireTeamManager(ctx, booking.teamId, identity.subject)

    if (booking.status !== "pending" && booking.status !== "waitlisted") {
      throwError(ErrorCode.INVALID_STATUS, "Booking cannot be approved in current status")
    }

    const offering = await ctx.db.get(booking.seatOfferingId)
    if (!offering?.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Seat offering is no longer listed")
    }

    // Waitlisted requests do not hold a spot; pending already does. Re-count
    // server-side so a client cannot oversell.
    const inventory = await getOfferingInventory(
      ctx,
      offering,
      booking.status === "pending" ? args.bookingId : undefined
    )
    const needsNewSpot = booking.status === "waitlisted"
    if (needsNewSpot && inventory.remaining <= 0) {
      throwError(
        ErrorCode.CONFLICT,
        "No seats remaining. Decline or cancel a held booking before approving a waitlisted driver."
      )
    }
    if (!needsNewSpot && inventory.held >= offering.spotCount) {
      throwError(ErrorCode.CONFLICT, "No seats remaining on this offering")
    }

    const now = Date.now()
    await ctx.db.patch(args.bookingId, {
      status: "approved",
      approvedAt: now,
      teamMessage: args.teamMessage ? sanitizeMessage(args.teamMessage) : undefined,
      updatedAt: now,
    })

    await notify(ctx, {
      userId: booking.driverId,
      type: "seat_approved",
      title: "Seat request approved",
      message: "The team approved your seat request. Complete the deposit to hold your spot.",
      link: "/trips",
      metadata: { bookingId: args.bookingId },
    })

    await auditStatusChange(ctx, {
      bookingId: args.bookingId,
      userId: identity.subject,
      previousStatus: booking.status,
      newStatus: "approved",
    })

    return args.bookingId
  },
})

export const decline = mutation({
  args: {
    bookingId: v.id("seatBookings"),
    teamMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) {
      throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
    }
    await requireTeamManager(ctx, booking.teamId, identity.subject)

    if (
      booking.status !== "pending" &&
      booking.status !== "waitlisted" &&
      booking.status !== "approved"
    ) {
      throwError(ErrorCode.INVALID_STATUS, "Booking cannot be declined in current status")
    }

    const wasHolding = holdsSeat(booking.status)
    const now = Date.now()
    await ctx.db.patch(args.bookingId, {
      status: "declined",
      teamMessage: args.teamMessage ? sanitizeMessage(args.teamMessage) : undefined,
      updatedAt: now,
    })

    await notify(ctx, {
      userId: booking.driverId,
      type: "seat_declined",
      title: "Seat request declined",
      message: "The team declined your race seat request.",
      link: "/trips",
      metadata: { bookingId: args.bookingId },
    })

    if (wasHolding) {
      await promoteOldestWaitlisted(ctx, booking.seatOfferingId)
    }

    await auditStatusChange(ctx, {
      bookingId: args.bookingId,
      userId: identity.subject,
      previousStatus: booking.status,
      newStatus: "declined",
    })

    return args.bookingId
  },
})

export const cancel = mutation({
  args: {
    bookingId: v.id("seatBookings"),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) {
      throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
    }

    const isDriver = booking.driverId === identity.subject
    const isTeam = await isTeamManager(ctx, booking.teamId, identity.subject)
    if (!(isDriver || isTeam)) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to cancel this booking")
    }

    if (
      booking.status !== "pending" &&
      booking.status !== "waitlisted" &&
      booking.status !== "approved" &&
      booking.status !== "deposit_paid" &&
      booking.status !== "confirmed"
    ) {
      throwError(ErrorCode.INVALID_STATUS, "Booking cannot be cancelled in current status")
    }

    const wasHolding = holdsSeat(booking.status)
    const now = Date.now()
    await ctx.db.patch(args.bookingId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason
        ? sanitizeShortText(args.cancellationReason)
        : undefined,
      updatedAt: now,
    })

    const otherPartyId = isDriver ? booking.hostUserId : booking.driverId
    await notify(ctx, {
      userId: otherPartyId,
      type: "seat_cancelled",
      title: "Seat booking cancelled",
      message: "A race seat booking has been cancelled.",
      link: isDriver ? "/motorsports/profile/team" : "/trips",
      metadata: { bookingId: args.bookingId },
    })

    if (wasHolding) {
      await promoteOldestWaitlisted(ctx, booking.seatOfferingId)
    }

    await auditStatusChange(ctx, {
      bookingId: args.bookingId,
      userId: identity.subject,
      previousStatus: booking.status,
      newStatus: "cancelled",
    })

    return args.bookingId
  },
})

export const complete = mutation({
  args: { bookingId: v.id("seatBookings") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) {
      throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
    }
    await requireTeamManager(ctx, booking.teamId, identity.subject)
    if (booking.status !== "confirmed") {
      throwError(ErrorCode.INVALID_STATUS, "Only confirmed seat bookings can be completed")
    }

    const now = Date.now()
    await ctx.db.patch(args.bookingId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
    })

    for (const userId of [booking.driverId, booking.hostUserId]) {
      await notify(ctx, {
        userId,
        type: "seat_completed",
        title: "Seat booking completed",
        message: "A race seat booking has been marked completed.",
        link: "/trips",
        metadata: { bookingId: args.bookingId },
      })
    }

    await auditStatusChange(ctx, {
      bookingId: args.bookingId,
      userId: identity.subject,
      previousStatus: booking.status,
      newStatus: "completed",
    })

    return args.bookingId
  },
})

/**
 * Stripe webhook stub: records deposit payment. Approve-before-confirm is
 * enforced here — pending/waitlisted bookings cannot be paid.
 * If the deposit covers the full price, the booking is confirmed immediately.
 */
export const markDepositPaid = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) {
      throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
    }
    if (booking.status !== "approved") {
      throwError(
        ErrorCode.INVALID_STATUS,
        "Seat must be team-approved before deposit payment can confirm"
      )
    }

    const offering = await ctx.db.get(booking.seatOfferingId)
    if (!offering) {
      throwError(ErrorCode.NOT_FOUND, "Seat offering not found")
    }
    const inventory = await getOfferingInventory(ctx, offering, args.bookingId)
    if (inventory.held >= offering.spotCount) {
      throwError(ErrorCode.CONFLICT, "No seats remaining on this offering")
    }

    const now = Date.now()
    const fullyPaid = booking.balanceCents <= 0
    await ctx.db.patch(args.bookingId, {
      status: fullyPaid ? "confirmed" : "deposit_paid",
      depositPaymentStatus: "paid",
      balancePaymentStatus: fullyPaid ? "paid" : booking.balancePaymentStatus,
      depositPaidAt: now,
      confirmedAt: fullyPaid ? now : undefined,
      stripeDepositCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeDepositPaymentIntentId: args.stripePaymentIntentId,
      updatedAt: now,
    })

    await auditStatusChange(ctx, {
      bookingId: args.bookingId,
      previousStatus: "approved",
      newStatus: fullyPaid ? "confirmed" : "deposit_paid",
    })

    return args.bookingId
  },
})

/** Stripe webhook stub: records balance payment and confirms the seat. */
export const markBalancePaid = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) {
      throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
    }
    if (booking.status !== "deposit_paid") {
      throwError(
        ErrorCode.INVALID_STATUS,
        "Balance can only be paid after the deposit, on an approved booking"
      )
    }

    const now = Date.now()
    await ctx.db.patch(args.bookingId, {
      status: "confirmed",
      balancePaymentStatus: "paid",
      confirmedAt: now,
      stripeBalanceCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeBalancePaymentIntentId: args.stripePaymentIntentId,
      updatedAt: now,
    })

    await auditStatusChange(ctx, {
      bookingId: args.bookingId,
      previousStatus: "deposit_paid",
      newStatus: "confirmed",
    })

    return args.bookingId
  },
})

export const expireApprovedUnpaidBookings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const APPROVED_TIMEOUT_MS = 48 * 60 * 60 * 1000
    const now = Date.now()

    const expired = await ctx.db
      .query("seatBookings")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .filter((q) => q.lt(q.field("approvedAt"), now - APPROVED_TIMEOUT_MS))
      .collect()

    for (const booking of expired) {
      await ctx.db.patch(booking._id, {
        status: "expired",
        cancellationReason: "Approval expired — deposit not completed within 48 hours",
        updatedAt: now,
      })

      await notify(ctx, {
        userId: booking.driverId,
        type: "seat_declined",
        title: "Seat request expired",
        message: "Your approved seat expired because the deposit wasn't completed within 48 hours.",
        link: "/trips",
        metadata: { bookingId: booking._id },
      })

      await promoteOldestWaitlisted(ctx, booking.seatOfferingId)
      await auditStatusChange(ctx, {
        bookingId: booking._id,
        previousStatus: "approved",
        newStatus: "expired",
      })
    }

    return { expired: expired.length }
  },
})

async function enrichBooking(ctx: any, booking: any, viewer: "driver" | "team" | "admin") {
  const [offering, teamCar, event, team, driver] = await Promise.all([
    ctx.db.get(booking.seatOfferingId),
    ctx.db.get(booking.teamCarId),
    ctx.db.get(booking.raceEventId),
    ctx.db.get(booking.teamId),
    ctx.db
      .query("users")
      .withIndex("by_external_id", (q: any) => q.eq("externalId", booking.driverId))
      .first(),
  ])

  const teamListing = toPublicTeamListing(team)
  const offeringPublic = offering ? omitHostUserId(offering) : null
  const teamCarPublic = teamCar ? omitHostUserId(teamCar) : null

  if (viewer === "driver") {
    const { hostUserId: _hostUserId, ...bookingPublic } = booking
    return {
      ...bookingPublic,
      offering: offeringPublic,
      teamCar: teamCarPublic,
      event,
      team: teamListing,
    }
  }

  return {
    ...booking,
    offering: offeringPublic,
    teamCar: teamCarPublic,
    event,
    team: teamListing,
    driver,
  }
}

async function assertCanViewBooking(ctx: any, booking: any, userId: string, identity: any) {
  if (isAdminIdentity(identity)) return
  if (booking.driverId === userId || booking.hostUserId === userId) return
  if (await isTeamManager(ctx, booking.teamId, userId)) return
  throwError(ErrorCode.FORBIDDEN, "Not authorized to view this booking")
}

async function viewerForBooking(ctx: any, booking: any, identity: { subject: string }) {
  if (isAdminIdentity(identity)) return "admin" as const
  if (await isTeamManager(ctx, booking.teamId, identity.subject)) return "team" as const
  return "driver" as const
}

export const getById = query({
  args: { bookingId: v.id("seatBookings") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) return null
    await assertCanViewBooking(ctx, booking, identity.subject, identity)
    const viewer = await viewerForBooking(ctx, booking, identity)
    return await enrichBooking(ctx, booking, viewer)
  },
})

export const getByDriver = query({
  args: {
    status: v.optional(bookingStatusValidator),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    let q = ctx.db
      .query("seatBookings")
      .withIndex("by_driver", (i) => i.eq("driverId", identity.subject))
    if (args.status) {
      const status = args.status
      q = q.filter((f) => f.eq(f.field("status"), status))
    }
    const bookings = await q.order("desc").collect()
    return await Promise.all(bookings.map((booking) => enrichBooking(ctx, booking, "driver")))
  },
})

export const getPendingForTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await requireTeamManager(ctx, args.teamId, identity.subject)
    const bookings = await ctx.db
      .query("seatBookings")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()
    const pending = bookings.filter(
      (booking) => booking.status === "pending" || booking.status === "waitlisted"
    )
    pending.sort((a, b) => b.createdAt - a.createdAt)
    return await Promise.all(pending.map((booking) => enrichBooking(ctx, booking, "team")))
  },
})

export const getByTeam = query({
  args: {
    teamId: v.id("teams"),
    status: v.optional(bookingStatusValidator),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await requireTeamManager(ctx, args.teamId, identity.subject)
    const bookings = await ctx.db
      .query("seatBookings")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()
    const filtered = args.status
      ? bookings.filter((booking) => booking.status === args.status)
      : bookings
    filtered.sort((a, b) => b.createdAt - a.createdAt)
    return await Promise.all(filtered.map((booking) => enrichBooking(ctx, booking, "team")))
  },
})

export const getWaitlistForOffering = query({
  args: { offeringId: v.id("seatOfferings") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const offering = await ctx.db.get(args.offeringId)
    if (!offering) {
      throwError(ErrorCode.NOT_FOUND, "Seat offering not found")
    }
    await requireTeamManager(ctx, offering.teamId, identity.subject)
    const waitlisted = await ctx.db
      .query("seatBookings")
      .withIndex("by_offering_status", (q) =>
        q.eq("seatOfferingId", args.offeringId).eq("status", "waitlisted")
      )
      .collect()
    waitlisted.sort((a, b) => a.createdAt - b.createdAt)
    return await Promise.all(waitlisted.map((booking) => enrichBooking(ctx, booking, "team")))
  },
})

export const getByOffering = query({
  args: { offeringId: v.id("seatOfferings") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const offering = await ctx.db.get(args.offeringId)
    if (!offering) {
      throwError(ErrorCode.NOT_FOUND, "Seat offering not found")
    }
    await requireTeamManager(ctx, offering.teamId, identity.subject)
    const bookings = await ctx.db
      .query("seatBookings")
      .withIndex("by_offering", (q) => q.eq("seatOfferingId", args.offeringId))
      .collect()
    bookings.sort((a, b) => b.createdAt - a.createdAt)
    return await Promise.all(bookings.map((booking) => enrichBooking(ctx, booking, "team")))
  },
})

export const getForAdmin = query({
  args: {
    status: v.optional(bookingStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)
    const limit = args.limit ?? 100
    const status = args.status
    const bookings = status
      ? await ctx.db
          .query("seatBookings")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .take(limit)
      : await ctx.db.query("seatBookings").order("desc").take(limit)
    return await Promise.all(bookings.map((booking) => enrichBooking(ctx, booking, "admin")))
  },
})
