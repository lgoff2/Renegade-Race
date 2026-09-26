import { StripeSubscriptions } from "@convex-dev/stripe"
import { v } from "convex/values"
import Stripe from "stripe"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { action, internalAction, mutation, query } from "./_generated/server"
import { checkAdmin } from "./admin"
import { parseLocalDate } from "./dateUtils"
import { calculateAddOnsTotal, calculatePlatformFeeAmount, calculateRefundAmount } from "./pricing"
import {
  getPaymentFailedEmailTemplate,
  getPaymentSucceededEmailTemplate,
  sendTransactionalEmail,
} from "./emails"
import { getWebUrl } from "./helpers"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"

// ============================================================================
// Cancellation Policy - Tiered Refund Calculation
// ============================================================================

/**
 * Calculate refund percentage based on cancellation policy.
 *
 * Flexible Policy:
 * - 1+ days before start: 100% refund (full)
 * - <24 hours before start: 50% refund (partial)
 *
 * Moderate Policy (default):
 * - 7+ days before start: 100% refund (full)
 * - 2-7 days before start: 50% refund (partial)
 * - <48 hours before start: 0% refund (none)
 *
 * Strict Policy:
 * - 14+ days before start: 100% refund (full)
 * - 7-14 days before start: 50% refund (partial)
 * - <7 days before start: 0% refund (none)
 *
 * @param startDate - Rental start date in YYYY-MM-DD format
 * @param policyType - Cancellation policy type
 * @param cancellationDate - Date of cancellation (defaults to now)
 * @returns Object with refund percentage and policy tier
 */
export function calculateRefundTier(
  startDate: string,
  policyType: "flexible" | "moderate" | "strict" = "moderate",
  cancellationDate?: Date
): { percentage: number; policy: "full" | "partial" | "none" } {
  const now = cancellationDate || new Date()
  const start = parseLocalDate(startDate)

  if (!start) {
    // If we can't parse the date, default to no refund for safety
    return { percentage: 0, policy: "none" }
  }

  // Set both dates to start of day for accurate comparison
  now.setHours(0, 0, 0, 0)
  start.setHours(0, 0, 0, 0)

  // Calculate days until start
  const diffTime = start.getTime() - now.getTime()
  const daysUntilStart = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  // Apply policy-specific rules
  if (policyType === "flexible") {
    if (daysUntilStart >= 1) {
      return { percentage: 100, policy: "full" }
    }
    return { percentage: 50, policy: "partial" }
  }

  if (policyType === "strict") {
    if (daysUntilStart >= 14) {
      return { percentage: 100, policy: "full" }
    }
    if (daysUntilStart >= 7) {
      return { percentage: 50, policy: "partial" }
    }
    return { percentage: 0, policy: "none" }
  }

  // Default: moderate policy
  if (daysUntilStart >= 7) {
    return { percentage: 100, policy: "full" }
  }
  if (daysUntilStart >= 2) {
    return { percentage: 50, policy: "partial" }
  }
  return { percentage: 0, policy: "none" }
}

// Initialize Stripe client from component
const stripeClient = new StripeSubscriptions(components.stripe, {})

// Helper function to get Stripe instance (for Connect operations)
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

// ============================================================================
// Platform Fee Calculation (Keep your existing logic)
// ============================================================================

export const calculatePlatformFee = mutation({
  args: {
    amount: v.number(), // Amount in cents
  },
  handler: async (ctx, args) => {
    // Validate amount
    if (args.amount <= 0) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Amount must be positive")
    }

    const settings = await ctx.db
      .query("platformSettings")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first()

    if (!settings) {
      // Default platform settings if none exist
      return calculatePlatformFeeAmount(args.amount, 5, 0)
    }

    const feePercentage = settings.platformFeePercentage

    // Validate fee percentage (should already be validated on insert, but double-check)
    if (feePercentage < 0 || feePercentage > 100) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Platform fee percentage must be between 0 and 100"
      )
    }

    return calculatePlatformFeeAmount(
      args.amount,
      feePercentage,
      settings.minimumPlatformFee,
      settings.maximumPlatformFee
    )
  },
})

export const initializePlatformSettings = mutation({
  args: {},
  handler: async (ctx) => {
    const existingSettings = await ctx.db
      .query("platformSettings")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first()

    if (existingSettings) {
      return existingSettings._id
    }

    const settingsId = await ctx.db.insert("platformSettings", {
      platformFeePercentage: 5, // 5% platform fee
      minimumPlatformFee: 100, // $1.00 minimum fee
      maximumPlatformFee: 5000, // $50.00 maximum fee
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    return settingsId
  },
})

// ============================================================================
// Admin API for Platform Settings
// ============================================================================

// Get current platform settings (admin only)
export const getPlatformSettings = query({
  args: {},
  handler: async (ctx) => {
    await checkAdmin(ctx)

    return await ctx.db
      .query("platformSettings")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first()
  },
})

// Update platform settings (admin only)
export const updatePlatformSettings = mutation({
  args: {
    platformFeePercentage: v.number(),
    minimumPlatformFee: v.number(),
    maximumPlatformFee: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await checkAdmin(ctx)

    // Validate inputs
    if (args.platformFeePercentage < 0 || args.platformFeePercentage > 100) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Platform fee percentage must be between 0 and 100"
      )
    }

    if (args.minimumPlatformFee < 0) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Minimum platform fee must be positive")
    }

    if (
      args.maximumPlatformFee !== undefined &&
      args.maximumPlatformFee < args.minimumPlatformFee
    ) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Maximum platform fee must be greater than or equal to minimum fee"
      )
    }

    // Deactivate old settings
    const oldSettings = await ctx.db
      .query("platformSettings")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first()

    if (oldSettings) {
      await ctx.db.patch(oldSettings._id, {
        isActive: false,
        updatedAt: Date.now(),
      })
    }

    // Create new active settings
    const newSettingsId = await ctx.db.insert("platformSettings", {
      platformFeePercentage: args.platformFeePercentage,
      minimumPlatformFee: args.minimumPlatformFee,
      maximumPlatformFee: args.maximumPlatformFee,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Audit log for platform settings change
    await ctx.runMutation(internal.auditLog.create, {
      entityType: "payment",
      entityId: newSettingsId,
      action: "update_platform_settings",
      userId: identity.subject,
      previousState: oldSettings
        ? {
            platformFeePercentage: oldSettings.platformFeePercentage,
            minimumPlatformFee: oldSettings.minimumPlatformFee,
            maximumPlatformFee: oldSettings.maximumPlatformFee,
          }
        : undefined,
      newState: {
        platformFeePercentage: args.platformFeePercentage,
        minimumPlatformFee: args.minimumPlatformFee,
        maximumPlatformFee: args.maximumPlatformFee,
      },
      metadata: {
        oldSettingsId: oldSettings?._id,
        newSettingsId,
      },
    })

    return newSettingsId
  },
})

// ============================================================================
// Stripe Connect - Account Management
// ============================================================================

// Create Stripe Connect account for vehicle owners
export const createConnectAccount = action({
  args: {
    ownerId: v.string(),
    returnUrlBase: v.optional(v.string()), // Allow client to specify the base URL for redirects
  },
  handler: async (
    ctx,
    args
  ): Promise<{ accountId: string; onboardingUrl: string | null; isComplete: boolean }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || identity.subject !== args.ownerId) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized")
    }

    // Check if user already has a Connect account
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: args.ownerId,
    })

    if (user?.stripeAccountId) {
      // Check account status
      const stripe = getStripe()
      const account = await stripe.accounts.retrieve(user.stripeAccountId)

      if (account.details_submitted) {
        return {
          accountId: account.id,
          onboardingUrl: null,
          isComplete: true,
        }
      }
    }

    const stripe = getStripe()

    // Create a Connect Express account for the owner
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user?.email || identity.email || "",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    })

    // Store the Connect account ID
    await ctx.runMutation(api.users.setStripeAccountId, {
      userId: args.ownerId,
      stripeAccountId: account.id,
    })

    // Mark payoutSetup step as complete in onboarding (account created, even if not fully onboarded)
    await ctx.runMutation(api.users.updateHostOnboardingStep, {
      step: "payoutSetup",
      completed: true,
    })

    // Determine the base URL to use for redirects
    // Priority: client-provided URL > WEB_URL env var > production default
    let baseUrl = args.returnUrlBase || getWebUrl()

    // Validate the URL is allowed (security check)
    // In development, allow localhost, ngrok, and 127.0.0.1
    // In production, only allow configured production domains
    const isDevelopment =
      baseUrl.includes("localhost") ||
      baseUrl.includes("ngrok") ||
      baseUrl.includes("127.0.0.1") ||
      baseUrl.startsWith("http://")

    // Production allowed domains
    const allowedProductionDomains = ["https://renegaderace.com", "https://www.renegaderace.com"]

    // If not development, validate against allowed domains
    if (!isDevelopment) {
      const isAllowed = allowedProductionDomains.some((domain) => baseUrl.startsWith(domain))
      if (!isAllowed) {
        throwError(
          ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
          `Invalid return URL: ${baseUrl}. ` +
            `Allowed domains: ${allowedProductionDomains.join(", ")}`
        )
      }
    }

    // Ensure baseUrl doesn't end with a slash
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1)
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create(
      {
        account: account.id,
        refresh_url: `${baseUrl}/host/dashboard?stripe_refresh=true`,
        return_url: `${baseUrl}/host/dashboard?stripe_return=true`,
        type: "account_onboarding",
      },
      {
        idempotencyKey: `account_link_${account.id}_${Date.now()}`,
      }
    )

    return {
      accountId: account.id,
      onboardingUrl: accountLink.url,
      isComplete: false,
    }
  },
})

// Get Connect account status
export const getConnectAccountStatus = action({
  args: {
    ownerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    hasAccount: boolean
    isComplete: boolean
    chargesEnabled?: boolean
    payoutsEnabled?: boolean
    accountId?: string
  }> => {
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: args.ownerId,
    })

    if (!user?.stripeAccountId) {
      return {
        hasAccount: false,
        isComplete: false,
      }
    }

    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(user.stripeAccountId)

    return {
      hasAccount: true,
      isComplete: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      accountId: account.id,
    }
  },
})

// Refresh Connect account status (sync with Stripe)
// Call this to update the database status based on current Stripe account state
export const refreshConnectAccountStatus = action({
  args: {
    ownerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean
    reason?: string
    status?: "pending" | "enabled" | "restricted" | "disabled"
    chargesEnabled?: boolean
    payoutsEnabled?: boolean
    detailsSubmitted?: boolean
  }> => {
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: args.ownerId,
    })

    if (!user?.stripeAccountId) {
      return {
        success: false,
        reason: "No Stripe Connect account found",
      }
    }

    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(user.stripeAccountId)

    // Determine account status based on Stripe account state
    // Same logic as the webhook handler
    let status: "pending" | "enabled" | "restricted" | "disabled"

    if (account.details_submitted === false || !account.charges_enabled) {
      status = "pending"
    } else if (account.payouts_enabled === false) {
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
        status = "enabled"
      }
    } else {
      status = "pending"
    }

    // Update the status in Convex
    await ctx.runMutation(internal.users.updateStripeAccountStatus, {
      stripeAccountId: user.stripeAccountId,
      status,
    })

    return {
      success: true,
      status,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    }
  },
})

// Create login link for Connect account dashboard
export const createConnectLoginLink = action({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || identity.subject !== args.ownerId) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized")
    }

    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: args.ownerId,
    })

    if (!user?.stripeAccountId) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "No Stripe Connect account found")
    }

    const stripe = getStripe()
    const loginLink = await stripe.accounts.createLoginLink(user.stripeAccountId)

    return {
      url: loginLink.url,
    }
  },
})

// ============================================================================
// Payment Creation with Stripe Connect
// ============================================================================

// Create checkout session for one-time payment (using component + Connect)
export const createCheckoutSession = action({
  args: {
    reservationId: v.id("reservations"),
    amount: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ paymentId: any; sessionId: string; url: string | null }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const reservation = await ctx.runQuery(api.reservations.getById, {
      id: args.reservationId,
    })
    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found")
    }

    if (reservation.renterId !== identity.subject) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Not authorized to create payment for this reservation"
      )
    }

    if (reservation.status !== "approved") {
      throwError(ErrorCode.INVALID_STATUS, "Reservation must be approved to create payment")
    }

    // Monetary validation
    const MAX_AMOUNT_CENTS = 1_000_000 // $10,000 max
    const MIN_AMOUNT_CENTS = 100 // $1 min

    if (args.amount <= 0 || args.amount < MIN_AMOUNT_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Payment amount must be at least $1.00")
    }

    if (args.amount > MAX_AMOUNT_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Payment amount cannot exceed $10,000.00")
    }

    // Get current vehicle pricing to validate payment amount
    const vehicle = await ctx.runQuery(api.vehicles.getById, {
      id: reservation.vehicleId,
    })

    if (!vehicle) {
      throwError(ErrorCode.NOT_FOUND, "Vehicle not found")
    }

    // Recalculate total from current pricing (server-side validation).
    // Use the stored rental length so start-date + duration stays consistent
    // (inclusive occupied days), rather than hotel-style date-pair math.
    const totalDays = reservation.totalDays
    const baseAmount = totalDays * vehicle.dailyRate

    // Validate add-ons against vehicle's current add-ons
    const validatedAddOns: Array<{ price: number; priceType?: "daily" | "one-time" }> = []
    if (reservation.addOns && reservation.addOns.length > 0) {
      for (const reservationAddOn of reservation.addOns) {
        const vehicleAddOn = vehicle.addOns?.find((va: any) => va.name === reservationAddOn.name)
        if (!vehicleAddOn) {
          throwError(
            ErrorCode.INVALID_INPUT,
            `Add-on "${reservationAddOn.name}" is no longer available`
          )
        }
        if (vehicleAddOn.price !== reservationAddOn.price) {
          throwError(
            ErrorCode.PRICE_CHANGED,
            `Add-on "${reservationAddOn.name}" price has changed from ${reservationAddOn.price} to ${vehicleAddOn.price} cents`
          )
        }
        const priceType = reservationAddOn.priceType || vehicleAddOn.priceType || "one-time"
        validatedAddOns.push({ price: reservationAddOn.price, priceType })
      }
    }

    const addOnsTotal = calculateAddOnsTotal(validatedAddOns, totalDays)
    const expectedTotal = baseAmount + addOnsTotal

    // Validate that the payment amount matches the recalculated total
    if (args.amount !== expectedTotal) {
      throwError(
        ErrorCode.PRICE_CHANGED,
        `Payment amount mismatch: expected ${expectedTotal} cents (based on current pricing), got ${args.amount} cents. ` +
          "Vehicle daily rate may have changed."
      )
    }

    // Get owner's Stripe Connect account
    const owner = await ctx.runQuery(api.users.getByExternalId, {
      externalId: reservation.ownerId,
    })

    if (!owner?.stripeAccountId) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Owner must complete Stripe onboarding before accepting payments"
      )
    }

    // Verify Connect account is ready
    const stripe = getStripe()
    const connectAccount = await stripe.accounts.retrieve(owner.stripeAccountId)

    if (!connectAccount.details_submitted) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Owner account onboarding is not complete. Please complete Stripe onboarding."
      )
    }

    if (!connectAccount.charges_enabled) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_DISABLED,
        "Owner account cannot accept charges yet. Please complete Stripe onboarding."
      )
    }

    // Check if transfers capability is enabled (required for destination payments)
    const capabilities = connectAccount.capabilities as Record<string, string> | undefined
    const transfersEnabled =
      capabilities?.transfers === "active" || capabilities?.legacy_payments === "active"

    if (!transfersEnabled) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Owner account does not have transfers enabled. Please complete Stripe onboarding to enable transfers capability."
      )
    }

    // Calculate platform fee
    const { platformFee, ownerAmount } = await ctx.runMutation(api.stripe.calculatePlatformFee, {
      amount: args.amount,
    })

    // Get or create Stripe customer (component handles this)
    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email || "",
      name: identity.name || "",
    })

    // Store customer ID on user record if not already stored
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: identity.subject,
    })
    if (user && !user.stripeCustomerId) {
      await ctx.runMutation(api.users.setStripeCustomerId, {
        userId: identity.subject,
        stripeCustomerId: customer.customerId,
      })
    }

    const webUrl = getWebUrl()

    // Create checkout session using Stripe directly (component doesn't support Connect)
    // but we use the component's customer management
    const checkoutSession = await stripe.checkout.sessions.create(
      {
        customer: customer.customerId,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Vehicle Rental - Reservation ${args.reservationId}`,
              },
              unit_amount: args.amount,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: platformFee, // Your platform fee
          transfer_data: {
            destination: owner.stripeAccountId, // Owner's Connect account
          },
          metadata: {
            reservationId: args.reservationId,
            renterId: reservation.renterId,
            ownerId: reservation.ownerId,
            vehicleId: reservation.vehicleId,
            platformFee: platformFee.toString(),
            ownerAmount: ownerAmount.toString(),
          },
        },
        success_url: `${webUrl}/checkout/success?reservationId=${args.reservationId}`,
        cancel_url: `${webUrl}/checkout?reservationId=${args.reservationId}`,
        metadata: {
          reservationId: args.reservationId,
          renterId: reservation.renterId,
          ownerId: reservation.ownerId,
        },
      },
      {
        idempotencyKey: `cs_create_${args.reservationId}`,
      }
    )

    // Create payment record
    const paymentId = await ctx.runMutation(api.stripe.createPaymentRecord, {
      reservationId: args.reservationId,
      renterId: reservation.renterId,
      ownerId: reservation.ownerId,
      amount: args.amount,
      platformFee,
      ownerAmount,
      stripeCustomerId: customer.customerId,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeAccountId: owner.stripeAccountId,
      metadata: {
        vehicleId: reservation.vehicleId,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalDays: reservation.totalDays,
      },
    })

    return {
      paymentId,
      sessionId: checkoutSession.id,
      url: checkoutSession.url,
    }
  },
})

// Legacy: Create payment intent (for embedded payment form)
// This still works but uses Connect
export const createPaymentIntent = action({
  args: {
    reservationId: v.id("reservations"),
    amount: v.number(),
  },
  handler: async (ctx, args): Promise<{ paymentId: Id<"payments">; clientSecret: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    // Rate limit: 20 payment operations per hour per user
    await rateLimiter.limit(ctx, "processPayment", {
      key: identity.subject,
      throws: true,
    })

    const reservation = await ctx.runQuery(api.reservations.getById, {
      id: args.reservationId,
    })
    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found")
    }

    if (reservation.renterId !== identity.subject) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Not authorized to create payment for this reservation"
      )
    }

    if (reservation.status !== "approved") {
      throwError(ErrorCode.INVALID_STATUS, "Reservation must be approved to create payment")
    }

    // Monetary validation
    const MAX_AMOUNT_CENTS = 1_000_000 // $10,000 max
    const MIN_AMOUNT_CENTS = 100 // $1 min

    if (args.amount <= 0 || args.amount < MIN_AMOUNT_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Payment amount must be at least $1.00")
    }

    if (args.amount > MAX_AMOUNT_CENTS) {
      throwError(ErrorCode.INVALID_AMOUNT, "Payment amount cannot exceed $10,000.00")
    }

    // Get current vehicle pricing to validate payment amount
    const vehicle = await ctx.runQuery(api.vehicles.getById, {
      id: reservation.vehicleId,
    })

    if (!vehicle) {
      throwError(ErrorCode.NOT_FOUND, "Vehicle not found")
    }

    // Recalculate total from current pricing (server-side validation).
    // Use the stored rental length so start-date + duration stays consistent
    // (inclusive occupied days), rather than hotel-style date-pair math.
    const totalDays = reservation.totalDays
    const baseAmount = totalDays * vehicle.dailyRate

    // Validate add-ons against vehicle's current add-ons
    const validatedAddOns: Array<{ price: number; priceType?: "daily" | "one-time" }> = []
    if (reservation.addOns && reservation.addOns.length > 0) {
      for (const reservationAddOn of reservation.addOns) {
        const vehicleAddOn = vehicle.addOns?.find((va: any) => va.name === reservationAddOn.name)
        if (!vehicleAddOn) {
          throwError(
            ErrorCode.INVALID_INPUT,
            `Add-on "${reservationAddOn.name}" is no longer available`
          )
        }
        if (vehicleAddOn.price !== reservationAddOn.price) {
          throwError(
            ErrorCode.PRICE_CHANGED,
            `Add-on "${reservationAddOn.name}" price has changed from ${reservationAddOn.price} to ${vehicleAddOn.price} cents`
          )
        }
        const priceType = reservationAddOn.priceType || vehicleAddOn.priceType || "one-time"
        validatedAddOns.push({ price: reservationAddOn.price, priceType })
      }
    }

    const addOnsTotal = calculateAddOnsTotal(validatedAddOns, totalDays)
    const expectedTotal = baseAmount + addOnsTotal

    // Validate that the payment amount matches the recalculated total
    if (args.amount !== expectedTotal) {
      throwError(
        ErrorCode.PRICE_CHANGED,
        `Payment amount mismatch: expected ${expectedTotal} cents (based on current pricing), got ${args.amount} cents. ` +
          "Vehicle daily rate may have changed."
      )
    }

    // Get owner's Stripe Connect account
    const owner = await ctx.runQuery(api.users.getByExternalId, {
      externalId: reservation.ownerId,
    })

    if (!owner?.stripeAccountId) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Owner must complete Stripe onboarding before accepting payments"
      )
    }

    // Verify Connect account is ready and has required capabilities
    const stripe = getStripe()
    const connectAccount = await stripe.accounts.retrieve(owner.stripeAccountId)

    if (!connectAccount.details_submitted) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Owner account onboarding is not complete. Please complete Stripe onboarding."
      )
    }

    if (!connectAccount.charges_enabled) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_DISABLED,
        "Owner account cannot accept charges yet. Please complete Stripe onboarding."
      )
    }

    // Check if transfers capability is enabled (required for destination payments)
    const capabilities = connectAccount.capabilities as Record<string, string> | undefined
    const transfersEnabled =
      capabilities?.transfers === "active" || capabilities?.legacy_payments === "active"

    if (!transfersEnabled) {
      throwError(
        ErrorCode.STRIPE_ACCOUNT_INCOMPLETE,
        "Owner account does not have transfers enabled. Please complete Stripe onboarding to enable transfers capability."
      )
    }

    // Calculate platform fee
    const { platformFee, ownerAmount } = await ctx.runMutation(api.stripe.calculatePlatformFee, {
      amount: args.amount,
    })

    // Get or create Stripe customer (component handles this)
    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email || "",
      name: identity.name || "",
    })

    // Store customer ID on user record if not already stored
    const renter = await ctx.runQuery(api.users.getByExternalId, {
      externalId: identity.subject,
    })
    if (renter && !renter.stripeCustomerId) {
      await ctx.runMutation(api.users.setStripeCustomerId, {
        userId: identity.subject,
        stripeCustomerId: customer.customerId,
      })
    }

    // Create Stripe Payment Intent with Connect
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: args.amount,
        currency: "usd",
        customer: customer.customerId,
        application_fee_amount: platformFee, // Your platform fee
        transfer_data: {
          destination: owner.stripeAccountId, // Owner's Connect account
        },
        metadata: {
          reservationId: args.reservationId,
          renterId: reservation.renterId,
          ownerId: reservation.ownerId,
          vehicleId: reservation.vehicleId,
          platformFee: platformFee.toString(),
          ownerAmount: ownerAmount.toString(),
        },
        automatic_payment_methods: {
          enabled: true,
        },
      },
      {
        idempotencyKey: `pi_create_${args.reservationId}`,
      }
    )

    // Create payment record
    const paymentId = await ctx.runMutation(api.stripe.createPaymentRecord, {
      reservationId: args.reservationId,
      renterId: reservation.renterId,
      ownerId: reservation.ownerId,
      amount: args.amount,
      platformFee,
      ownerAmount,
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId: customer.customerId,
      stripeAccountId: owner.stripeAccountId,
      metadata: {
        vehicleId: reservation.vehicleId,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalDays: reservation.totalDays,
      },
    })

    return {
      paymentId,
      clientSecret: paymentIntent.client_secret as string,
    }
  },
})

// ============================================================================
// Payment Record Management
// ============================================================================

export const createPaymentRecord = mutation({
  args: {
    reservationId: v.id("reservations"),
    renterId: v.string(),
    ownerId: v.string(),
    amount: v.number(),
    platformFee: v.number(),
    ownerAmount: v.number(),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeAccountId: v.optional(v.string()),
    metadata: v.object({
      vehicleId: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      totalDays: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const paymentId = await ctx.db.insert("payments", {
      reservationId: args.reservationId,
      renterId: args.renterId,
      ownerId: args.ownerId,
      amount: args.amount,
      platformFee: args.platformFee,
      ownerAmount: args.ownerAmount,
      currency: "usd",
      status: "pending",
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeCustomerId: args.stripeCustomerId,
      stripeAccountId: args.stripeAccountId,
      metadata: args.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    await ctx.db.patch(args.reservationId, {
      paymentId,
      paymentStatus: "pending",
      updatedAt: Date.now(),
    })

    return paymentId
  },
})

// Find payment by Stripe payment intent ID (for webhooks)
export const findPaymentByStripeIntent = query({
  args: {
    stripePaymentIntentId: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first(),
})

// Find payment by Stripe checkout session ID
export const findPaymentByCheckoutSession = query({
  args: {
    stripeCheckoutSessionId: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("payments")
      .withIndex("by_stripe_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId)
      )
      .first(),
})

// Handle payment success (called from webhook)
export const handlePaymentSuccess = mutation({
  args: {
    paymentId: v.id("payments"),
    stripeChargeId: v.string(),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId)
    if (!payment) {
      return
    }

    await ctx.db.patch(args.paymentId, {
      status: "succeeded",
      stripeChargeId: args.stripeChargeId,
      updatedAt: Date.now(),
    })

    try {
      await ctx.db.patch(payment.reservationId, {
        status: "confirmed",
        paymentStatus: "paid",
        updatedAt: Date.now(),
      })

      // Trigger notification for renter
      await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
        userId: payment.renterId,
        type: "payment_success",
        title: "Payment Successful",
        message: `Your payment of $${(payment.amount / 100).toFixed(2)} was successful.`,
        link: "/trips",
        metadata: {
          paymentId: args.paymentId,
          reservationId: payment.reservationId,
        },
      })
    } catch (error) {
      // If updating reservation fails after payment succeeded, log and schedule retry
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to update reservation after payment success")

      // Log to audit log
      try {
        await ctx.runMutation(internal.auditLog.create, {
          entityType: "payment",
          entityId: args.paymentId,
          action: "reservation_update_failed",
          metadata: {
            reservationId: payment.reservationId,
            error: String(error),
            reason: "Reservation status update failed after payment succeeded",
          },
        })
      } catch {
        // Don't fail if audit log fails
      }

      // Schedule retry after 1 minute
      await ctx.scheduler.runAfter(60_000, internal.stripe.retryReservationUpdate, {
        paymentId: args.paymentId,
        reservationId: payment.reservationId,
      })
    }

    // Send payment success email
    try {
      const [reservation, vehicle, renter] = await Promise.all([
        ctx.db.get(payment.reservationId),
        payment.metadata?.vehicleId
          ? ctx.db.get(payment.metadata.vehicleId as Id<"vehicles">)
          : null,
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", payment.renterId))
          .first(),
      ])

      if (reservation && vehicle && renter?.email) {
        const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        const webUrl = getWebUrl()

        const template = getPaymentSucceededEmailTemplate({
          renterName: renter.name || "Guest",
          vehicleName,
          totalAmount: payment.amount,
          paymentDate: new Date().toISOString(),
          reservationUrl: `${webUrl}/trips`,
        })
        await sendTransactionalEmail(ctx, renter.email, template)
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send payment success email")
    }
  },
})

// Handle payment failure (called from webhook)
export const handlePaymentFailure = mutation({
  args: {
    paymentId: v.id("payments"),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId)
    if (!payment) {
      return
    }

    await ctx.db.patch(args.paymentId, {
      status: "failed",
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    })

    // Trigger notification for renter
    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: payment.renterId,
      type: "payment_failed",
      title: "Payment Failed",
      message: "Your payment failed. Please try again or use a different payment method.",
      link: `/checkout?reservationId=${payment.reservationId}`,
      metadata: {
        paymentId: args.paymentId,
        reservationId: payment.reservationId,
        failureReason: args.failureReason,
      },
    })

    // Send payment failure email
    try {
      const [reservation, vehicle, renter] = await Promise.all([
        ctx.db.get(payment.reservationId),
        payment.metadata?.vehicleId
          ? ctx.db.get(payment.metadata.vehicleId as Id<"vehicles">)
          : null,
        ctx.db
          .query("users")
          .withIndex("by_external_id", (q) => q.eq("externalId", payment.renterId))
          .first(),
      ])

      if (reservation && vehicle && renter?.email) {
        const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        const webUrl = getWebUrl()

        const template = getPaymentFailedEmailTemplate({
          renterName: renter.name || "Guest",
          vehicleName,
          totalAmount: payment.amount,
          failureReason: args.failureReason,
          reservationUrl: `${webUrl}/checkout?reservationId=${reservation._id}`,
        })
        await sendTransactionalEmail(ctx, renter.email, template)
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Failed to send payment failure email")
    }
  },
})

// ============================================================================
// Customer Portal
// ============================================================================

export const createCustomerPortalSession = action({
  args: {
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    // Get or create customer
    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email || "",
      name: identity.name || "",
    })

    // Create portal session
    const session = await stripeClient.createCustomerPortalSession(ctx, {
      customerId: customer.customerId,
      returnUrl: args.returnUrl,
    })

    return {
      url: session.url,
    }
  },
})

// ============================================================================
// Refunds (with Connect support)
// ============================================================================

// Internal action to process refund on cancellation (called via scheduler)
// Uses tiered refund policy based on vehicle's cancellation policy
export const processRefundOnCancellation = internalAction({
  args: {
    paymentId: v.id("payments"),
    reservationId: v.id("reservations"),
    reason: v.string(),
    forceFullRefund: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success?: boolean
    skipped?: boolean
    reason?: string
    refunded?: boolean
    refundId?: string
    refundAmount?: number
    percentage?: number
    policy?: string
  }> => {
    const payment = await ctx.runQuery(api.stripe.getPaymentById, {
      paymentId: args.paymentId,
    })

    if (!payment?.stripeChargeId) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Payment not found or charge ID missing")
    }

    // Only refund if payment is succeeded
    if (payment.status !== "succeeded") {
      return { skipped: true, reason: `Payment status is ${payment.status}, cannot refund` }
    }

    // Get the reservation to fetch vehicle cancellation policy
    const reservation = await ctx.runQuery(api.reservations.getById, {
      id: args.reservationId,
    })

    if (!reservation) {
      throwError(ErrorCode.NOT_FOUND, "Reservation not found")
    }

    // Get vehicle to fetch cancellation policy
    const vehicle = await ctx.runQuery(api.vehicles.getById, {
      id: reservation.vehicleId,
    })

    if (!vehicle) {
      throwError(ErrorCode.NOT_FOUND, "Vehicle not found")
    }

    // Get the reservation start date to calculate refund tier
    const startDate = payment.metadata?.startDate
    if (!startDate) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Payment metadata missing start date")
    }

    // If forceFullRefund is true (owner cancellation), apply 100% refund
    let percentage: number
    let policy: "full" | "partial" | "none"

    if (args.forceFullRefund) {
      percentage = 100
      policy = "full"
    } else {
      // Calculate refund tier based on vehicle's cancellation policy
      const policyType = vehicle.cancellationPolicy || "moderate"
      const refundTier = calculateRefundTier(startDate, policyType)
      percentage = refundTier.percentage
      policy = refundTier.policy
    }

    // If no refund is due, just update the status
    if (percentage === 0) {
      await ctx.runMutation(api.stripe.updateRefundStatus, {
        paymentId: args.paymentId,
        status: "succeeded", // Keep as succeeded, no refund
        refundAmount: 0,
        refundReason: `${args.reason} - No refund (cancelled less than 48 hours before start)`,
        refundPercentage: 0,
        refundPolicy: "none",
      })

      // Update reservation payment status
      await ctx.runMutation(api.stripe.updateReservationStatus, {
        reservationId: args.reservationId,
        status: "cancelled",
        paymentStatus: "paid", // Payment was successful, just no refund
      })

      return {
        success: true,
        refunded: false,
        reason: "No refund due - cancelled less than 48 hours before start",
        policy,
        percentage,
      }
    }

    const stripe = getStripe()

    // Calculate the refund amount based on percentage
    const refundAmount = calculateRefundAmount(payment.amount, percentage)

    // Validate refund amount
    if (refundAmount <= 0 || refundAmount > payment.amount) {
      throwError(ErrorCode.INVALID_REFUND_AMOUNT, "Invalid refund amount")
    }

    // Refund with Connect - automatically reverses transfer proportionally
    const refundParams: Stripe.RefundCreateParams = {
      charge: payment.stripeChargeId,
      amount: refundAmount, // Partial or full based on policy
      reverse_transfer: true, // Automatically reverse the transfer to owner
      refund_application_fee: percentage === 100, // Only refund platform fee on full refund
      reason: "requested_by_customer" as Stripe.RefundCreateParams.Reason,
    }

    const refund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `refund_${args.paymentId}_${refundAmount}`,
    })

    // Verify that transfer reversal succeeded if it was requested
    if (refundParams.reverse_transfer && refund.status !== "succeeded") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(
        new Error(
          `Refund created but status is ${refund.status}, transfer reversal may have failed`
        ),
        "Transfer reversal verification failed"
      )

      // Log to audit log for admin visibility
      try {
        await ctx.runMutation(internal.auditLog.create, {
          entityType: "payment",
          entityId: args.paymentId,
          action: "refund_transfer_reversal_failed",
          metadata: {
            refundId: refund.id,
            refundStatus: refund.status,
            transferReversed: refund.transfer_reversal,
            reason: "Transfer reversal may have failed - refund status not succeeded",
          },
        })
      } catch {
        // Don't fail if audit log fails
      }
    }

    // Determine status based on refund percentage
    const newStatus = percentage === 100 ? "refunded" : "partially_refunded"

    await ctx.runMutation(api.stripe.updateRefundStatus, {
      paymentId: args.paymentId,
      status: newStatus,
      refundAmount: refund.amount,
      refundReason: args.reason,
      refundPercentage: percentage,
      refundPolicy: policy,
    })

    // Update reservation payment status
    await ctx.runMutation(api.stripe.updateReservationStatus, {
      reservationId: args.reservationId,
      status: "cancelled",
      paymentStatus: newStatus,
    })

    return {
      success: true,
      refundId: refund.id,
      refunded: true,
      refundAmount: refund.amount,
      percentage,
      policy,
    }
  },
})

export const processRefund: ReturnType<typeof action> = action({
  args: {
    paymentId: v.id("payments"),
    amount: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const payment = await ctx.runQuery(api.stripe.getPaymentById, {
      paymentId: args.paymentId,
    })
    if (!payment?.stripeChargeId) {
      throwError(ErrorCode.NOT_FOUND, "Payment not found")
    }

    // Check authorization (owner or admin can refund)
    if (payment.ownerId !== identity.subject) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Not authorized to refund this payment")
    }

    const stripe = getStripe()

    // Validate refund amount if provided
    const refundAmount = args.amount || payment.amount
    if (refundAmount <= 0 || refundAmount > payment.amount) {
      throwError(ErrorCode.INVALID_REFUND_AMOUNT, "Invalid refund amount")
    }

    // Refund with Connect - automatically reverses transfer
    const refundParams: Stripe.RefundCreateParams = {
      charge: payment.stripeChargeId,
      reverse_transfer: true, // Automatically reverse the transfer to owner
      refund_application_fee: true, // Refund your platform fee too
    }

    if (args.amount) {
      refundParams.amount = args.amount
    }
    if (args.reason) {
      refundParams.reason = args.reason as Stripe.RefundCreateParams.Reason
    }

    const refund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `refund_${args.paymentId}_${refundAmount}_${Date.now()}`,
    })

    await ctx.runMutation(api.stripe.updateRefundStatus, {
      paymentId: args.paymentId,
      status: args.amount && args.amount < payment.amount ? "partially_refunded" : "refunded",
      refundAmount: refund.amount,
      refundReason: args.reason,
    })

    // Update reservation status if fully refunded
    if (!args.amount || args.amount >= payment.amount) {
      await ctx.runMutation(api.stripe.updateReservationStatus, {
        reservationId: payment.reservationId,
        status: "cancelled",
        paymentStatus: "refunded",
      })
    }

    return refund
  },
})

// ============================================================================
// Helper Mutations
// ============================================================================

export const updatePaymentStatus = mutation({
  args: {
    paymentId: v.id("payments"),
    status: v.string(),
    stripeChargeId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      status: args.status as
        | "pending"
        | "cancelled"
        | "failed"
        | "refunded"
        | "processing"
        | "succeeded"
        | "partially_refunded",
      stripeChargeId: args.stripeChargeId,
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    })
  },
})

export const updateReservationStatus = mutation({
  args: {
    reservationId: v.id("reservations"),
    status: v.string(),
    paymentStatus: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reservationId, {
      status: args.status as
        | "pending"
        | "approved"
        | "cancelled"
        | "confirmed"
        | "completed"
        | "declined",
      paymentStatus: args.paymentStatus as "pending" | "paid" | "failed" | "refunded",
      updatedAt: Date.now(),
    })
  },
})

export const updateRefundStatus = mutation({
  args: {
    paymentId: v.id("payments"),
    status: v.string(),
    refundAmount: v.optional(v.number()),
    refundReason: v.optional(v.string()),
    refundPercentage: v.optional(v.number()),
    refundPolicy: v.optional(v.union(v.literal("full"), v.literal("partial"), v.literal("none"))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      status: args.status as
        | "pending"
        | "cancelled"
        | "failed"
        | "refunded"
        | "partially_refunded"
        | "succeeded",
      refundAmount: args.refundAmount,
      refundReason: args.refundReason,
      updatedAt: Date.now(),
    })
  },
})

// ============================================================================
// Queries
// ============================================================================

export const getUserPayments = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_renter", (q) => q.eq("renterId", args.userId))
      .order("desc")
      .collect()

    const paymentsWithDetails = await Promise.all(
      payments.map(async (payment) => {
        const [reservation, vehicle, owner] = await Promise.all([
          ctx.db.get(payment.reservationId),
          payment.metadata?.vehicleId
            ? ctx.db.get(payment.metadata.vehicleId as Id<"vehicles">)
            : Promise.resolve(undefined),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", payment.ownerId))
            .first(),
        ])

        return {
          ...payment,
          reservation,
          vehicle,
          owner,
        }
      })
    )

    return paymentsWithDetails
  },
})

export const getPaymentById = query({
  args: {
    paymentId: v.id("payments"),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId)
    if (!payment) {
      return null
    }

    const [reservation, vehicle, renter, owner] = await Promise.all([
      ctx.db.get(payment.reservationId),
      payment.metadata?.vehicleId ? ctx.db.get(payment.metadata.vehicleId as Id<"vehicles">) : null,
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", payment.renterId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", payment.ownerId))
        .first(),
    ])

    return {
      ...payment,
      reservation,
      vehicle,
      renter,
      owner,
    }
  },
})

// ============================================================================
// Customer Billing Data (for renters)
// ============================================================================

// Get payment methods for a customer
export const getCustomerPaymentMethods = action({
  args: {
    customerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      id: string
      type: string
      card: { brand: string; last4: string; expMonth: number; expYear: number } | null
      billingDetails: any
      created: number
    }>
  > => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    // Verify the customer belongs to the current user
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: identity.subject,
    })

    if (!user || user.stripeCustomerId !== args.customerId) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized")
    }

    const stripe = getStripe()
    const paymentMethods = await stripe.paymentMethods.list({
      customer: args.customerId,
      type: "card",
    })

    return paymentMethods.data.map((pm) => ({
      id: pm.id,
      type: pm.type,
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : null,
      billingDetails: pm.billing_details,
      created: pm.created,
    }))
  },
})

// Get invoices for a customer
export const getCustomerInvoices = action({
  args: {
    customerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      id: string
      number: string | null
      amount: number
      currency: string
      status: string | null
      created: number
      dueDate: number | null
      hostedInvoiceUrl: string | null
      invoicePdf: string | null
      description: string
    }>
  > => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    // Verify the customer belongs to the current user
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: identity.subject,
    })

    if (!user || user.stripeCustomerId !== args.customerId) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized")
    }

    const stripe = getStripe()
    const invoices = await stripe.invoices.list({
      customer: args.customerId,
      limit: args.limit || 10,
    })

    return invoices.data.map((invoice) => ({
      id: invoice.id!,
      number: invoice.number,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status,
      created: invoice.created,
      dueDate: invoice.due_date,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
      description: invoice.description || invoice.lines?.data[0]?.description || "Vehicle rental",
    }))
  },
})

// Get customer details including default payment method
export const getCustomerDetails = action({
  args: {
    customerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    id: string
    email: string | null
    name: string | null
    phone: string | null
    address: any
    defaultSource: any
    invoiceSettings: any
  }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    // Verify the customer belongs to the current user
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: identity.subject,
    })

    if (!user || user.stripeCustomerId !== args.customerId) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized")
    }

    const stripe = getStripe()
    const customer = await stripe.customers.retrieve(args.customerId)

    if (customer.deleted) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Customer not found")
    }

    return {
      id: customer.id,
      email: customer.email ?? null,
      name: customer.name ?? null,
      phone: customer.phone ?? null,
      address: customer.address,
      defaultSource: customer.default_source,
      invoiceSettings: customer.invoice_settings,
    }
  },
})

// ============================================================================
// Webhook Handler Mutations
// ============================================================================

// Handle charge refunded webhook event
export const handleChargeRefunded = mutation({
  args: {
    stripePaymentIntentId: v.string(),
    refundAmount: v.number(),
    refundId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first()

    if (!payment) {
      return
    }

    // Determine if full or partial refund
    const isFullRefund = args.refundAmount >= payment.amount
    const newStatus = isFullRefund ? "refunded" : "partially_refunded"

    await ctx.db.patch(payment._id, {
      status: newStatus,
      refundAmount: (payment.refundAmount || 0) + args.refundAmount,
      updatedAt: Date.now(),
    })

    // Update reservation if exists
    if (payment.reservationId) {
      const reservation = await ctx.db.get(payment.reservationId)
      if (reservation) {
        await ctx.db.patch(payment.reservationId, {
          paymentStatus: newStatus as "pending" | "paid" | "failed" | "refunded",
          updatedAt: Date.now(),
        })
      }
    }
  },
})

// Handle transfer failed webhook event
export const handleTransferFailed = mutation({
  args: {
    stripeTransferId: v.string(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    // Find payment by transfer ID
    const payments = await ctx.db.query("payments").collect()
    const payment = payments.find((p) => p.stripeTransferId === args.stripeTransferId)

    if (!payment) {
      return
    }

    await ctx.db.patch(payment._id, {
      failureReason: args.failureReason || "Transfer failed",
      updatedAt: Date.now(),
    })
  },
})

// Handle payout failed webhook event
export const handlePayoutFailed = mutation({
  args: {
    stripeAccountId: v.string(),
    payoutId: v.string(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    // Find user by Stripe account ID
    const users = await ctx.db.query("users").collect()
    const user = users.find((u) => u.stripeAccountId === args.stripeAccountId)

    if (user) {
      // TODO: handle payout failure notification
    }
  },
})

// Handle payment intent canceled webhook event
export const handlePaymentCanceled = mutation({
  args: {
    stripePaymentIntentId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first()

    if (!payment) {
      return
    }

    // Only update if payment is still pending
    if (payment.status === "pending" || payment.status === "processing") {
      await ctx.db.patch(payment._id, {
        status: "cancelled",
        updatedAt: Date.now(),
      })

      // Update reservation if exists
      if (payment.reservationId) {
        const reservation = await ctx.db.get(payment.reservationId)
        if (reservation && reservation.status === "pending") {
          await ctx.db.patch(payment.reservationId, {
            paymentStatus: "failed",
            updatedAt: Date.now(),
          })
        }
      }
    }
  },
})

// Handle account deauthorized webhook event
export const handleAccountDeauthorized = mutation({
  args: {
    stripeAccountId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Find user by Stripe account ID
    const users = await ctx.db.query("users").collect()
    const user = users.find((u) => u.stripeAccountId === args.stripeAccountId)

    if (!user) {
      return
    }

    // Update user's Stripe account status to disabled
    await ctx.db.patch(user._id, {
      stripeAccountStatus: "disabled",
    })
  },
})

// Handle charge dispute created webhook event
export const handleDisputeCreated = mutation({
  args: {
    stripePaymentIntentId: v.string(),
    disputeId: v.string(),
    disputeReason: v.optional(v.string()),
    disputeAmount: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first()

    if (!payment) {
      return
    }

    // Could create a system notification or flag the reservation for review
    if (payment.reservationId) {
      const reservation = await ctx.db.get(payment.reservationId)
      if (reservation) {
        // TODO: flag reservation for review
      }
    }
  },
})

// Internal mutation to retry reservation update after payment success
export const retryReservationUpdate = internalAction({
  args: {
    paymentId: v.id("payments"),
    reservationId: v.id("reservations"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(api.stripe.updateReservationStatus, {
        reservationId: args.reservationId,
        status: "confirmed",
        paymentStatus: "paid",
      })
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logError } = require("./logger")
      logError(error, "Retry failed to update reservation after payment success")

      // Log final failure to audit log
      try {
        await ctx.runMutation(internal.auditLog.create, {
          entityType: "payment",
          entityId: args.paymentId,
          action: "reservation_update_retry_failed",
          metadata: {
            reservationId: args.reservationId,
            error: String(error),
            reason: "Reservation status update retry failed - manual intervention required",
          },
        })
      } catch {
        // Don't fail if audit log fails
      }
    }
  },
})
