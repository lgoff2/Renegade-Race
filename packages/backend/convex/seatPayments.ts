import { v } from "convex/values"
import Stripe from "stripe"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server"
import { ErrorCode, throwError } from "./errors"
import { getWebUrl } from "./helpers"
import { logError } from "./logger"
import { calculatePlatformFeeAmount } from "./pricing"
import { rateLimiter } from "./rateLimiter"
import {
  holdsSeat,
  MAX_SEAT_PRICE_CENTS,
  MIN_SEAT_PRICE_CENTS,
  promoteOldestWaitlisted,
} from "./seatHelpers"

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throwError(
      ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
      "STRIPE_SECRET_KEY environment variable is not set"
    )
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil",
  })
}

export type SeatPaymentPhase = "deposit" | "balance"

const SECURED_STATUSES = new Set(["deposit_paid", "confirmed", "completed"])

/**
 * Seat Checkout and PaymentIntents are routed by this metadata contract:
 *   bookingType: "seat"
 *   phase: "deposit" | "balance"
 *   seatBookingId: seatBookings id
 * Foreign metadata (coaching, rentals, unknown) is not a seat payment.
 */
export function isSeatPaymentMetadata(
  metadata: Record<string, string> | null | undefined
): boolean {
  return metadata?.bookingType === "seat"
}

export function parseSeatPaymentMetadata(
  metadata: Record<string, string> | null | undefined
): { bookingId: string; phase: SeatPaymentPhase } | null {
  if (!(isSeatPaymentMetadata(metadata) && metadata)) return null
  const phase = metadata.phase
  const bookingId = metadata.seatBookingId
  if ((phase !== "deposit" && phase !== "balance") || !bookingId) return null
  return { bookingId, phase }
}

function asBookingId(id: string): Id<"seatBookings"> {
  return id as Id<"seatBookings">
}

async function countSecuredSpots(
  ctx: MutationCtx,
  offeringId: Id<"seatOfferings">,
  excludeBookingId: Id<"seatBookings">
): Promise<number> {
  const bookings = await ctx.db
    .query("seatBookings")
    .withIndex("by_offering", (q) => q.eq("seatOfferingId", offeringId))
    .collect()
  return bookings.filter(
    (booking) => booking._id !== excludeBookingId && SECURED_STATUSES.has(booking.status)
  ).length
}

export const getStripeUser = internalQuery({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .first()
    if (!user) return null
    return {
      stripeAccountId: user.stripeAccountId ?? null,
      stripeCustomerId: user.stripeCustomerId ?? null,
    }
  },
})

export const setDriverStripeCustomerId = internalMutation({
  args: { externalId: v.string(), stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .first()
    if (!user) return
    await ctx.db.patch(user._id, { stripeCustomerId: args.stripeCustomerId })
  },
})

async function assertTeamConnectReady(ctx: ActionCtx, hostUserId: string): Promise<string> {
  const host = await ctx.runQuery(internal.seatPayments.getStripeUser, { externalId: hostUserId })
  if (!host?.stripeAccountId) {
    throwError(
      ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
      "The team hasn't finished setting up payouts. Try again later or message the team."
    )
  }

  const stripe = getStripe()
  const connectAccount = await stripe.accounts.retrieve(host.stripeAccountId)
  if (!connectAccount.details_submitted) {
    throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "The team's payout setup isn't complete yet")
  }
  if (!connectAccount.charges_enabled) {
    throwError(ErrorCode.STRIPE_ACCOUNT_DISABLED, "The team's payouts are temporarily disabled")
  }
  const capabilities = connectAccount.capabilities as Record<string, string> | undefined
  const transfersEnabled =
    capabilities?.transfers === "active" || capabilities?.legacy_payments === "active"
  if (!transfersEnabled) {
    throwError(
      ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
      "The team's payout setup isn't complete (transfers not enabled)"
    )
  }
  return host.stripeAccountId
}

export const getBookingForPayment = internalQuery({
  args: { bookingId: v.id("seatBookings") },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) return null
    const [offering, event] = await Promise.all([
      ctx.db.get(booking.seatOfferingId),
      ctx.db.get(booking.raceEventId),
    ])
    return {
      ...booking,
      offeringTitle: offering?.title ?? "Race seat",
      eventName: event?.name ?? "Race event",
      eventStartDate: event?.startDate ?? booking.availableStartDate,
    }
  },
})

export const getPlatformFeeBounds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("platformSettings")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first()
    return {
      minimumPlatformFee: settings?.minimumPlatformFee ?? 0,
      maximumPlatformFee: settings?.maximumPlatformFee ?? null,
    }
  },
})

async function loadPayableBooking(ctx: ActionCtx, bookingId: Id<"seatBookings">, driverId: string) {
  const booking = await ctx.runQuery(internal.seatPayments.getBookingForPayment, { bookingId })
  if (!booking) {
    throwError(ErrorCode.NOT_FOUND, "Seat booking not found")
  }
  if (booking.driverId !== driverId) {
    throwError(ErrorCode.FORBIDDEN, "Only the driver on this booking can pay")
  }
  return booking
}

function assertPhasePayable(
  booking: { status: string; balanceCents: number; depositCents: number },
  phase: SeatPaymentPhase
) {
  if (phase === "deposit") {
    if (booking.status !== "approved") {
      throwError(ErrorCode.INVALID_STATUS, "Seat must be team-approved before paying the deposit")
    }
    return
  }
  if (booking.balanceCents <= 0) {
    throwError(ErrorCode.INVALID_AMOUNT, "This booking has no balance due")
  }
  if (booking.status !== "deposit_paid") {
    throwError(ErrorCode.INVALID_STATUS, "Balance can only be paid after the deposit")
  }
}

async function startCheckout(
  ctx: ActionCtx,
  bookingId: Id<"seatBookings">,
  phase: SeatPaymentPhase
): Promise<{ sessionId: string; url: string | null }> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
  }
  await rateLimiter.limit(ctx, "processPayment", { key: identity.subject, throws: true })

  const booking = await loadPayableBooking(ctx, bookingId, identity.subject)
  assertPhasePayable(booking, phase)

  const amount = phase === "deposit" ? booking.depositCents : booking.balanceCents
  if (amount < MIN_SEAT_PRICE_CENTS || amount > MAX_SEAT_PRICE_CENTS) {
    throwError(ErrorCode.INVALID_AMOUNT, "Payment amount out of allowed range")
  }

  const destination = await assertTeamConnectReady(ctx, booking.hostUserId)

  const bounds = await ctx.runQuery(internal.seatPayments.getPlatformFeeBounds, {})
  const { platformFee } = calculatePlatformFeeAmount(
    amount,
    booking.platformFeePercentage,
    bounds.minimumPlatformFee,
    bounds.maximumPlatformFee ?? undefined
  )

  const stripe = getStripe()
  const driver = await ctx.runQuery(internal.seatPayments.getStripeUser, {
    externalId: identity.subject,
  })
  let customerId = driver?.stripeCustomerId
  if (!customerId) {
    if (!driver) {
      throwError(ErrorCode.NOT_FOUND, "Driver account not found")
    }
    const created = await stripe.customers.create({
      email: identity.email || undefined,
      name: identity.name || undefined,
      metadata: { userId: identity.subject },
    })
    customerId = created.id
    await ctx.runMutation(internal.seatPayments.setDriverStripeCustomerId, {
      externalId: identity.subject,
      stripeCustomerId: customerId,
    })
  }

  const webUrl = getWebUrl()
  const label =
    phase === "deposit"
      ? `Race seat deposit — ${booking.offeringTitle}`
      : `Race seat balance — ${booking.offeringTitle}`
  const metadata = {
    bookingType: "seat",
    phase,
    seatBookingId: bookingId,
    driverId: booking.driverId,
    hostUserId: booking.hostUserId,
    platformFee: platformFee.toString(),
  }

  const session = await stripe.checkout.sessions.create(
    {
      customer: customerId,
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: label,
              description: booking.eventName,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: { destination },
        metadata,
      },
      success_url: `${webUrl}/checkout/success?seatBookingId=${bookingId}&phase=${phase}`,
      cancel_url: `${webUrl}/trips`,
      metadata,
    },
    { idempotencyKey: `cs_seat_${phase}_${bookingId}` }
  )

  await ctx.runMutation(internal.seatPayments.recordCheckoutSession, {
    bookingId,
    phase,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id,
  })

  return { sessionId: session.id, url: session.url }
}

export const createDepositCheckoutSession = action({
  args: { bookingId: v.id("seatBookings") },
  handler: async (ctx, args): Promise<{ sessionId: string; url: string | null }> =>
    await startCheckout(ctx, args.bookingId, "deposit"),
})

export const createBalanceCheckoutSession = action({
  args: { bookingId: v.id("seatBookings") },
  handler: async (ctx, args): Promise<{ sessionId: string; url: string | null }> =>
    await startCheckout(ctx, args.bookingId, "balance"),
})

export const recordCheckoutSession = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    phase: v.union(v.literal("deposit"), v.literal("balance")),
    stripeCheckoutSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) return
    const now = Date.now()
    if (args.phase === "deposit") {
      if (booking.status !== "approved") return
      await ctx.db.patch(args.bookingId, {
        stripeDepositCheckoutSessionId: args.stripeCheckoutSessionId,
        stripeDepositPaymentIntentId: args.stripePaymentIntentId,
        depositPaymentStatus: booking.depositPaymentStatus === "paid" ? "paid" : "pending",
        updatedAt: now,
      })
      return
    }
    if (booking.status !== "deposit_paid") return
    await ctx.db.patch(args.bookingId, {
      stripeBalanceCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeBalancePaymentIntentId: args.stripePaymentIntentId,
      balancePaymentStatus: booking.balancePaymentStatus === "paid" ? "paid" : "pending",
      updatedAt: now,
    })
  },
})

async function notifyPayment(
  ctx: MutationCtx,
  args: {
    userId: string
    type: "payment_success" | "payment_failed" | "seat_cancelled" | "seat_approved"
    title: string
    message: string
    link: string
    bookingId: Id<"seatBookings">
  }
) {
  await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
    userId: args.userId,
    type: args.type,
    title: args.title,
    message: args.message,
    link: args.link,
    metadata: { bookingId: args.bookingId },
  })
}

async function auditStatus(
  ctx: MutationCtx,
  bookingId: Id<"seatBookings">,
  previousStatus: string,
  newStatus: string
) {
  await ctx.runMutation(internal.auditLog.create, {
    entityType: "seat_booking",
    entityId: bookingId,
    action: "status_change",
    previousState: { status: previousStatus },
    newState: { status: newStatus },
  })
}

function depositAlreadySettled(booking: Doc<"seatBookings">): boolean {
  return (
    booking.depositPaymentStatus === "paid" ||
    booking.depositPaymentStatus === "refunded" ||
    booking.status === "deposit_paid" ||
    booking.status === "confirmed" ||
    booking.status === "completed"
  )
}

function balanceAlreadySettled(booking: Doc<"seatBookings">): boolean {
  return (
    booking.balancePaymentStatus === "paid" ||
    booking.balancePaymentStatus === "refunded" ||
    booking.status === "confirmed" ||
    booking.status === "completed"
  )
}

async function refuseCapturedPayment(
  ctx: MutationCtx,
  args: {
    booking: Doc<"seatBookings">
    phase: SeatPaymentPhase
    stripePaymentIntentId: string
    reason: string
  }
) {
  const { booking, phase, stripePaymentIntentId, reason } = args
  const now = Date.now()
  const wasHolding = holdsSeat(booking.status)
  const nextStatus =
    booking.status === "completed" || booking.status === "cancelled" ? booking.status : "cancelled"
  await ctx.db.patch(booking._id, {
    status: nextStatus,
    cancellationReason: booking.cancellationReason ?? reason,
    updatedAt: now,
    ...(phase === "deposit"
      ? {
          depositPaymentStatus: "paid" as const,
          stripeDepositPaymentIntentId: stripePaymentIntentId,
        }
      : {
          balancePaymentStatus: "paid" as const,
          stripeBalancePaymentIntentId: stripePaymentIntentId,
        }),
  })
  if (wasHolding && nextStatus === "cancelled") {
    await promoteOldestWaitlisted(ctx, booking.seatOfferingId)
  }
  await ctx.scheduler.runAfter(0, internal.seatPayments.refundSeatBooking, {
    bookingId: booking._id,
    reason,
  })
  await notifyPayment(ctx, {
    userId: booking.driverId,
    type: "seat_cancelled",
    title: "Seat payment refunded",
    message: reason,
    link: "/trips",
    bookingId: booking._id,
  })
  if (nextStatus !== booking.status) {
    await auditStatus(ctx, booking._id, booking.status, nextStatus)
  }
}

async function applyDepositSuccess(
  ctx: MutationCtx,
  args: { bookingId: Id<"seatBookings">; stripePaymentIntentId: string }
) {
  const booking = await ctx.db.get(args.bookingId)
  if (!booking) return
  if (depositAlreadySettled(booking)) return

  // Checkout cannot be opened before approval, so a captured payment here is a bug.
  if (booking.status === "pending" || booking.status === "waitlisted") {
    throwError(
      ErrorCode.INVALID_STATUS,
      "Seat must be team-approved before deposit payment can confirm"
    )
  }

  const offering = await ctx.db.get(booking.seatOfferingId)
  const securedByOthers = offering
    ? await countSecuredSpots(ctx, offering._id, booking._id)
    : Number.POSITIVE_INFINITY
  const spotGone = !offering || securedByOthers >= (offering?.spotCount ?? 0)
  if (booking.status !== "approved" || spotGone) {
    await refuseCapturedPayment(ctx, {
      booking,
      phase: "deposit",
      stripePaymentIntentId: args.stripePaymentIntentId,
      reason: spotGone
        ? "This seat was already taken — payment refunded in full."
        : "This seat was no longer available — payment refunded in full.",
    })
    return
  }

  const now = Date.now()
  const fullyPaid = booking.balanceCents <= 0
  const nextStatus = fullyPaid ? "confirmed" : "deposit_paid"
  await ctx.db.patch(args.bookingId, {
    status: nextStatus,
    depositPaymentStatus: "paid",
    depositPaidAt: now,
    stripeDepositPaymentIntentId: args.stripePaymentIntentId,
    updatedAt: now,
    ...(fullyPaid ? { balancePaymentStatus: "paid" as const, confirmedAt: now } : {}),
  })
  await auditStatus(ctx, args.bookingId, booking.status, nextStatus)

  const amountLabel = `$${(booking.depositCents / 100).toFixed(2)}`
  await notifyPayment(ctx, {
    userId: booking.driverId,
    type: "payment_success",
    title: fullyPaid ? "Race seat confirmed" : "Seat deposit paid",
    message: fullyPaid
      ? `Your payment of ${amountLabel} succeeded and the seat is confirmed.`
      : `Your deposit of ${amountLabel} succeeded. Pay the balance to confirm the seat.`,
    link: "/trips",
    bookingId: args.bookingId,
  })
  await notifyPayment(ctx, {
    userId: booking.hostUserId,
    type: "seat_approved",
    title: fullyPaid ? "Race seat confirmed" : "Seat deposit received",
    message: fullyPaid
      ? "A driver paid in full and the seat is confirmed."
      : "A driver paid the seat deposit.",
    link: "/motorsports/profile/team",
    bookingId: args.bookingId,
  })
}

async function applyBalanceSuccess(
  ctx: MutationCtx,
  args: { bookingId: Id<"seatBookings">; stripePaymentIntentId: string }
) {
  const booking = await ctx.db.get(args.bookingId)
  if (!booking) return
  if (balanceAlreadySettled(booking)) return

  if (booking.status !== "deposit_paid") {
    await refuseCapturedPayment(ctx, {
      booking,
      phase: "balance",
      stripePaymentIntentId: args.stripePaymentIntentId,
      reason: "The seat balance could not be applied — payment refunded in full.",
    })
    return
  }

  const now = Date.now()
  await ctx.db.patch(args.bookingId, {
    status: "confirmed",
    balancePaymentStatus: "paid",
    confirmedAt: now,
    stripeBalancePaymentIntentId: args.stripePaymentIntentId,
    updatedAt: now,
  })
  await auditStatus(ctx, args.bookingId, "deposit_paid", "confirmed")
  await notifyPayment(ctx, {
    userId: booking.driverId,
    type: "payment_success",
    title: "Race seat confirmed",
    message: `Your balance of $${(booking.balanceCents / 100).toFixed(2)} succeeded. The seat is confirmed.`,
    link: "/trips",
    bookingId: args.bookingId,
  })
  await notifyPayment(ctx, {
    userId: booking.hostUserId,
    type: "seat_approved",
    title: "Race seat confirmed",
    message: "A driver paid the remaining seat balance. The booking is confirmed.",
    link: "/motorsports/profile/team",
    bookingId: args.bookingId,
  })
}

async function applyPaymentFailure(
  ctx: MutationCtx,
  args: {
    bookingId: Id<"seatBookings">
    phase: SeatPaymentPhase
    failureReason?: string
  }
) {
  const booking = await ctx.db.get(args.bookingId)
  if (!booking) return
  const now = Date.now()
  if (args.phase === "deposit") {
    if (booking.status !== "approved") return
    if (booking.depositPaymentStatus === "paid" || booking.depositPaymentStatus === "refunded") {
      return
    }
    await ctx.db.patch(args.bookingId, { depositPaymentStatus: "failed", updatedAt: now })
  } else {
    if (booking.status !== "deposit_paid") return
    if (booking.balancePaymentStatus === "paid" || booking.balancePaymentStatus === "refunded") {
      return
    }
    await ctx.db.patch(args.bookingId, { balancePaymentStatus: "failed", updatedAt: now })
  }
  await notifyPayment(ctx, {
    userId: booking.driverId,
    type: "payment_failed",
    title: args.phase === "deposit" ? "Seat deposit failed" : "Seat balance failed",
    message: args.failureReason || "Your payment did not go through. Please try again.",
    link: "/trips",
    bookingId: args.bookingId,
  })
}

export const handleDepositSuccess = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    stripePaymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    await applyDepositSuccess(ctx, args)
  },
})

export const handleBalanceSuccess = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    stripePaymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    await applyBalanceSuccess(ctx, args)
  },
})

export const handlePaymentFailure = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    phase: v.union(v.literal("deposit"), v.literal("balance")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await applyPaymentFailure(ctx, args)
  },
})

/**
 * Webhook entry for seat PaymentIntents. Idempotent on Stripe event id.
 * Unknown or non-seat metadata is ignored and does not write booking or
 * webhook state, so coaching and rental handlers can still process the event.
 */
export const ingestPaymentIntentEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.union(
      v.literal("payment_intent.succeeded"),
      v.literal("payment_intent.payment_failed"),
      v.literal("payment_intent.canceled")
    ),
    paymentIntentId: v.string(),
    metadata: v.record(v.string(), v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
      eventId: args.eventId,
      source: "stripe",
    })
    if (alreadyProcessed) {
      return { routed: "replay" as const }
    }

    if (!isSeatPaymentMetadata(args.metadata)) {
      return { routed: "ignored" as const }
    }

    const parsed = parseSeatPaymentMetadata(args.metadata)
    if (!parsed) {
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: args.eventId,
        source: "stripe",
        eventType: args.eventType,
      })
      return { routed: "ignored" as const }
    }

    const bookingId = asBookingId(parsed.bookingId)
    if (args.eventType === "payment_intent.succeeded") {
      if (parsed.phase === "deposit") {
        await applyDepositSuccess(ctx, {
          bookingId,
          stripePaymentIntentId: args.paymentIntentId,
        })
      } else {
        await applyBalanceSuccess(ctx, {
          bookingId,
          stripePaymentIntentId: args.paymentIntentId,
        })
      }
    } else {
      await applyPaymentFailure(ctx, {
        bookingId,
        phase: parsed.phase,
        failureReason:
          args.failureReason ||
          (args.eventType === "payment_intent.canceled" ? "Payment was canceled" : undefined),
      })
    }

    await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
      eventId: args.eventId,
      source: "stripe",
      eventType: args.eventType,
    })
    return { routed: "seat" as const, phase: parsed.phase }
  },
})

export const markPaymentsRefunded = internalMutation({
  args: {
    bookingId: v.id("seatBookings"),
    refundDeposit: v.boolean(),
    refundBalance: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId)
    if (!booking) return
    const now = Date.now()
    await ctx.db.patch(args.bookingId, {
      updatedAt: now,
      ...(args.refundDeposit ? { depositPaymentStatus: "refunded" as const } : {}),
      ...(args.refundBalance ? { balancePaymentStatus: "refunded" as const } : {}),
      ...(booking.cancellationReason ? {} : { cancellationReason: args.reason }),
    })
  },
})

/** Full refund of every captured seat PaymentIntent. Reverses the Connect transfer and platform fee. */
export const refundSeatBooking = internalAction({
  args: {
    bookingId: v.id("seatBookings"),
    reason: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const booking = await ctx.runQuery(internal.seatPayments.getBookingForPayment, {
      bookingId: args.bookingId,
    })
    if (!booking) return

    const stripe = getStripe()
    let refundedDeposit = false
    let refundedBalance = false

    if (booking.stripeDepositPaymentIntentId && booking.depositPaymentStatus === "paid") {
      try {
        await stripe.refunds.create(
          {
            payment_intent: booking.stripeDepositPaymentIntentId,
            reverse_transfer: true,
            refund_application_fee: true,
            reason: "requested_by_customer",
          },
          { idempotencyKey: `rf_seat_deposit_${args.bookingId}` }
        )
        refundedDeposit = true
      } catch (error) {
        logError(error, "Failed to refund seat deposit")
      }
    }

    if (booking.stripeBalancePaymentIntentId && booking.balancePaymentStatus === "paid") {
      try {
        await stripe.refunds.create(
          {
            payment_intent: booking.stripeBalancePaymentIntentId,
            reverse_transfer: true,
            refund_application_fee: true,
            reason: "requested_by_customer",
          },
          { idempotencyKey: `rf_seat_balance_${args.bookingId}` }
        )
        refundedBalance = true
      } catch (error) {
        logError(error, "Failed to refund seat balance")
      }
    }

    const refundBalanceBookkeeping =
      refundedDeposit &&
      !booking.stripeBalancePaymentIntentId &&
      booking.balancePaymentStatus === "paid"
    if (!(refundedDeposit || refundedBalance || refundBalanceBookkeeping)) return

    await ctx.runMutation(internal.seatPayments.markPaymentsRefunded, {
      bookingId: args.bookingId,
      refundDeposit: refundedDeposit,
      refundBalance: refundedBalance || refundBalanceBookkeeping,
      reason: args.reason,
    })
  },
})
