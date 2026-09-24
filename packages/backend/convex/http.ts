import type { WebhookEvent } from "@clerk/backend"
import { registerRoutes } from "@convex-dev/stripe"
import { httpRouter } from "convex/server"
import Stripe from "stripe"
import { Webhook } from "svix"
import { api, components, internal } from "./_generated/api"
import { httpAction } from "./_generated/server"
import { resendComponent } from "./emails"
import { rateLimiter } from "./rateLimiter"
import { isSeatPaymentMetadata } from "./seatPayments"

// Helper function to get Stripe instance
function _getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set")
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil",
  })
}

const http = httpRouter()

// Register Stripe component webhook routes with custom event handlers
registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  events: {
    // Custom handler for payment_intent.succeeded
    "payment_intent.succeeded": async (ctx, event: Stripe.PaymentIntentSucceededEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        // Already processed, skip silently
        return
      }

      const paymentIntent = event.data.object

      if (isSeatPaymentMetadata(paymentIntent.metadata)) {
        await ctx.runMutation(internal.seatPayments.ingestPaymentIntentEvent, {
          eventId: event.id,
          eventType: "payment_intent.succeeded",
          paymentIntentId: paymentIntent.id,
          metadata: paymentIntent.metadata ?? {},
        })
        return
      }

      // Find payment by Stripe payment intent ID
      const payment = await ctx.runQuery(api.stripe.findPaymentByStripeIntent, {
        stripePaymentIntentId: paymentIntent.id,
      })

      if (payment) {
        // Update your custom payment record
        await ctx.runMutation(api.stripe.handlePaymentSuccess, {
          paymentId: payment._id,
          stripeChargeId: paymentIntent.latest_charge as string,
        })
      } else if (paymentIntent.metadata?.type === "damage_invoice") {
        // Handle damage invoice payment
        const damageInvoiceId = paymentIntent.metadata.damageInvoiceId
        if (damageInvoiceId) {
          await ctx.runMutation(internal.damageInvoices.handlePaymentSuccess, {
            damageInvoiceId: damageInvoiceId as any,
            stripeChargeId: (paymentIntent.latest_charge as string) || "",
            stripePaymentIntentId: paymentIntent.id,
          })
        }
      } else if (paymentIntent.metadata?.type === "coaching_booking") {
        // Handle coaching booking payment
        const bookingId = paymentIntent.metadata.coachingBookingId
        if (bookingId) {
          await ctx.runMutation(internal.coachingPayments.handlePaymentSuccess, {
            bookingId: bookingId as any,
            stripePaymentIntentId: paymentIntent.id,
          })
        }
      }

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Custom handler for payment_intent.payment_failed
    "payment_intent.payment_failed": async (ctx, event: Stripe.PaymentIntentPaymentFailedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const paymentIntent = event.data.object

      if (isSeatPaymentMetadata(paymentIntent.metadata)) {
        await ctx.runMutation(internal.seatPayments.ingestPaymentIntentEvent, {
          eventId: event.id,
          eventType: "payment_intent.payment_failed",
          paymentIntentId: paymentIntent.id,
          metadata: paymentIntent.metadata ?? {},
          failureReason: paymentIntent.last_payment_error?.message,
        })
        return
      }

      const payment = await ctx.runQuery(api.stripe.findPaymentByStripeIntent, {
        stripePaymentIntentId: paymentIntent.id,
      })

      if (payment) {
        await ctx.runMutation(api.stripe.handlePaymentFailure, {
          paymentId: payment._id,
          failureReason: paymentIntent.last_payment_error?.message,
        })
      } else if (paymentIntent.metadata?.type === "coaching_booking") {
        const bookingId = paymentIntent.metadata.coachingBookingId
        if (bookingId) {
          await ctx.runMutation(internal.coachingPayments.handlePaymentFailure, {
            bookingId: bookingId as any,
            failureReason: paymentIntent.last_payment_error?.message,
          })
        }
      }

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle charge.dispute.created
    "charge.dispute.created": async (ctx, event: Stripe.ChargeDisputeCreatedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const dispute = event.data.object
      const paymentIntentId = dispute.payment_intent as string

      if (paymentIntentId) {
        await ctx.runMutation(api.stripe.handleDisputeCreated, {
          stripePaymentIntentId: paymentIntentId,
          disputeId: dispute.id,
          disputeReason: dispute.reason || undefined,
          disputeAmount: dispute.amount,
        })
      }

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle charge.refunded
    "charge.refunded": async (ctx, event: Stripe.ChargeRefundedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const charge = event.data.object
      const paymentIntentId = charge.payment_intent as string

      if (paymentIntentId && charge.amount_refunded > 0) {
        await ctx.runMutation(api.stripe.handleChargeRefunded, {
          stripePaymentIntentId: paymentIntentId,
          refundAmount: charge.amount_refunded,
          refundId: charge.refunds?.data[0]?.id || "unknown",
        })
      }

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle transfer.failed
    // @ts-expect-error - StripeEventHandlers type doesn't include transfer.failed
    "transfer.failed": async (ctx, event: Stripe.TransferUpdatedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const transfer = event.data.object

      await ctx.runMutation(api.stripe.handleTransferFailed, {
        stripeTransferId: transfer.id,
        failureReason: (transfer as unknown as { failure_message?: string }).failure_message,
      })

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle payout.failed
    "payout.failed": async (ctx, event: Stripe.PayoutFailedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const payout = event.data.object

      await ctx.runMutation(api.stripe.handlePayoutFailed, {
        stripeAccountId: (payout.destination as string) || "",
        payoutId: payout.id,
        failureReason: payout.failure_message || undefined,
      })

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle payment_intent.canceled
    "payment_intent.canceled": async (ctx, event: Stripe.PaymentIntentCanceledEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const paymentIntent = event.data.object

      if (isSeatPaymentMetadata(paymentIntent.metadata)) {
        await ctx.runMutation(internal.seatPayments.ingestPaymentIntentEvent, {
          eventId: event.id,
          eventType: "payment_intent.canceled",
          paymentIntentId: paymentIntent.id,
          metadata: paymentIntent.metadata ?? {},
          failureReason: "Payment was canceled",
        })
        return
      }

      await ctx.runMutation(api.stripe.handlePaymentCanceled, {
        stripePaymentIntentId: paymentIntent.id,
      })

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle account.application.deauthorized (Connect account disconnected)
    "account.application.deauthorized": async (
      ctx,
      event: Stripe.AccountApplicationDeauthorizedEvent
    ) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const _application = event.data.object
      // The account ID is in the event's account field for connected accounts
      const accountId = event.account

      if (accountId) {
        await ctx.runMutation(api.stripe.handleAccountDeauthorized, {
          stripeAccountId: accountId,
        })
      }

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle checkout.session.completed
    "checkout.session.completed": async (ctx, event: Stripe.CheckoutSessionCompletedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const session = event.data.object
      const paymentIntentId = session.payment_intent as string

      if (paymentIntentId) {
        const payment = await ctx.runQuery(api.stripe.findPaymentByStripeIntent, {
          stripePaymentIntentId: paymentIntentId,
        })

        if (payment) {
          // Payment success is already handled by payment_intent.succeeded
          // But we can add additional logic here if needed
        }
      }

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },

    // Handle account.updated - updates Stripe Connect account status
    "account.updated": async (ctx, event: Stripe.AccountUpdatedEvent) => {
      // Check idempotency
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: event.id,
        source: "stripe",
      })

      if (alreadyProcessed) {
        return
      }

      const account = event.data.object

      // Only process Connect accounts (Express accounts)
      if (account.type !== "express") {
        // Record even if skipped to prevent reprocessing
        await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
          eventId: event.id,
          source: "stripe",
          eventType: event.type,
        })
        return
      }

      // Find user by Stripe account ID
      const user = await ctx.runQuery(api.users.getByStripeAccountId, {
        stripeAccountId: account.id,
      })

      if (!user) {
        // Record even if user not found to prevent reprocessing
        await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
          eventId: event.id,
          source: "stripe",
          eventType: event.type,
        })
        return
      }

      // Determine account status based on Stripe account state
      let status: "pending" | "enabled" | "restricted" | "disabled"

      // Check if account is disabled
      if (account.details_submitted === false || !account.charges_enabled) {
        status = "pending"
      } else if (account.payouts_enabled === false) {
        // Account can accept charges but not payouts yet
        status = "pending"
      } else if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
        // Check for blocking restrictions (currently_due, past_due, or disabled_reason)
        // Note: eventually_due requirements are normal and don't block functionality
        const hasBlockingRestrictions =
          (account.requirements?.currently_due && account.requirements.currently_due.length > 0) ||
          (account.requirements?.past_due && account.requirements.past_due.length > 0) ||
          (account.requirements?.disabled_reason !== null &&
            account.requirements?.disabled_reason !== undefined)

        if (hasBlockingRestrictions) {
          status = "restricted"
        } else {
          // Account is fully enabled - charges and payouts enabled, details submitted
          // eventually_due requirements are normal and don't affect enabled status
          status = "enabled"
        }
      } else {
        status = "pending"
      }

      // Update the status in Convex
      await ctx.runMutation(internal.users.updateStripeAccountStatus, {
        stripeAccountId: account.id,
        status,
      })

      // Record successful processing
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: event.id,
        source: "stripe",
        eventType: event.type,
      })
    },
  },
})

// Add this route to your http router (after the Stripe route)
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Rate limit webhook endpoints: 100 requests per minute per IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown"

    const rateLimitStatus = await rateLimiter.limit(ctx, "webhookEndpoint", {
      key: ip,
    })

    if (!rateLimitStatus.ok) {
      return new Response("Too many requests", {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((rateLimitStatus.retryAfter - Date.now()) / 1000).toString(),
        },
      })
    }

    const event = await validateRequest(request)
    if (!event) {
      return new Response("Error occured", { status: 400 })
    }

    // Check idempotency using svix-id header
    const svixId = request.headers.get("svix-id")
    if (svixId) {
      const alreadyProcessed = await ctx.runQuery(internal.webhookIdempotency.checkWebhookEvent, {
        eventId: svixId,
        source: "clerk",
      })

      if (alreadyProcessed) {
        // Already processed, return 200 to acknowledge
        return new Response(null, { status: 200 })
      }
    }

    switch (event.type) {
      case "user.created": // intentional fallthrough
      case "user.updated":
        await ctx.runMutation(internal.users.upsertFromClerk, {
          data: event.data,
        })
        break

      case "user.deleted": {
        const clerkUserId = event.data.id!
        await ctx.runMutation(internal.users.deleteFromClerk, { clerkUserId })
        break
      }
      default:
        // Ignored Clerk webhook event - still record to prevent reprocessing
        break
    }

    // Record successful processing
    if (svixId) {
      await ctx.runMutation(internal.webhookIdempotency.recordWebhookEvent, {
        eventId: svixId,
        source: "clerk",
        eventType: event.type,
      })
    }

    return new Response(null, { status: 200 })
  }),
})

async function validateRequest(req: Request): Promise<WebhookEvent | null> {
  const payloadString = await req.text()
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id")!,
    "svix-timestamp": req.headers.get("svix-timestamp")!,
    "svix-signature": req.headers.get("svix-signature")!,
  }
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!)
  try {
    return wh.verify(payloadString, svixHeaders) as unknown as WebhookEvent
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logError } = require("./logger")
    logError(error, "Error verifying webhook event")
    return null
  }
}

// Resend webhook for email status tracking
http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // Rate limit webhook endpoints: 100 requests per minute per IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown"

    const rateLimitStatus = await rateLimiter.limit(ctx, "webhookEndpoint", {
      key: ip,
    })

    if (!rateLimitStatus.ok) {
      return new Response("Too many requests", {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((rateLimitStatus.retryAfter - Date.now()) / 1000).toString(),
        },
      })
    }

    return await resendComponent.handleResendEventWebhook(ctx, req)
  }),
})

export default http
