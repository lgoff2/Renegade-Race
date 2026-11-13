import type { UserJSON } from "@clerk/backend"
import { type Validator, v } from "convex/values"
import { api, internal } from "./_generated/api"
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server"
import { getWelcomeEmailTemplate, sendTransactionalEmail } from "./emails"
import { isEarlyAdopterPromoActive, resolvePlatformFeePercentage } from "./pricing"
import { r2 } from "./r2"

/** Matches Clerk/Convex placeholder names like "null null" from `${null} ${null}`. */
const NULLISH_NAME_RE = /^(null|undefined)(\s+(null|undefined))+$/i

type EarlyAdopterGrant = {
  isEarlyAdopter: true
  platformFeeCapPercentage: number
  earlyAdopterGrantedAt: number
}

/** Fields to stamp on a new user when the early-adopter promo window is active. */
async function earlyAdopterGrantIfPromoActive(
  ctx: MutationCtx
): Promise<EarlyAdopterGrant | Record<string, never>> {
  const settings = await ctx.db
    .query("platformSettings")
    .withIndex("by_active", (q) => q.eq("isActive", true))
    .first()
  if (!isEarlyAdopterPromoActive(settings)) {
    return {}
  }
  const now = Date.now()
  return {
    isEarlyAdopter: true,
    platformFeeCapPercentage: settings?.earlyAdopterFeeCapPercentage ?? 3,
    earlyAdopterGrantedAt: now,
  }
}

export const current = query({
  args: {},
  handler: async (ctx) => await getCurrentUser(ctx),
})

/** Provider-facing fee summary for host/coach portals. */
export const getMyPlatformFee = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const settings = await ctx.db
      .query("platformSettings")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first()
    const globalFeePercentage = settings?.platformFeePercentage ?? 5
    const effectiveFeePercentage = resolvePlatformFeePercentage(
      globalFeePercentage,
      user.platformFeeCapPercentage
    )

    return {
      isEarlyAdopter: user.isEarlyAdopter === true,
      platformFeeCapPercentage: user.platformFeeCapPercentage ?? null,
      globalFeePercentage,
      effectiveFeePercentage,
    }
  },
})

export const getByExternalId = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => await userByExternalId(ctx, args.externalId),
})

export const searchForInvoiceRecipients = query({
  args: {
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return []
    }

    const search = (args.search || "").trim().toLowerCase()
    const limit = Math.min(args.limit || 25, 50)
    const users = await ctx.db.query("users").take(200)

    return users
      .filter((user) => user.externalId !== identity.subject)
      .filter((user) => {
        if (!search) return true
        return (
          user.name.toLowerCase().includes(search) ||
          user.email?.toLowerCase().includes(search) ||
          user.externalId.toLowerCase().includes(search)
        )
      })
      .slice(0, limit)
      .map((user) => ({
        externalId: user.externalId,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
        profileImageR2Key: user.profileImageR2Key,
      }))
  },
})

// Get user by Convex document ID (for public profile pages)
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) {
      return null
    }
    // Return public profile data (exclude sensitive fields)
    return {
      _id: user._id,
      name: user.name,
      profileImage: user.profileImage,
      profileImageR2Key: user.profileImageR2Key,
      location: user.location,
      bio: user.bio,
      memberSince: user.memberSince,
      totalRentals: user.totalRentals,
      rating: user.rating,
      experience: user.experience,
      interests: user.interests,
      externalId: user.externalId, // Needed for fetching vehicles/reviews
      // Verification status (without exposing actual email/phone)
      isEmailVerified: !!user.email,
      isPhoneVerified: !!user.phone,
    }
  },
})

function isPlaceholderUserName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? ""
  if (!trimmed) return true
  const lower = trimmed.toLowerCase()
  return (
    lower === "unknown user" ||
    lower === "null" ||
    lower === "undefined" ||
    NULLISH_NAME_RE.test(trimmed)
  )
}

/** Build a display name from Clerk parts — never stringifies null into "null null". */
function displayNameFromClerkParts(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  return [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0 && !isPlaceholderUserName(part))
    .join(" ")
}

export const upsertFromClerk = internalMutation({
  args: { data: v.any() as Validator<UserJSON> }, // no runtime validation, trust Clerk
  async handler(ctx, { data }) {
    const userData = data as UserJSON // Type assertion for Clerk data
    const user = await userByExternalId(ctx, data.id)
    const isNewUser = user === null
    const nameFromClerk = displayNameFromClerkParts(userData.first_name, userData.last_name)
    const userEmail = userData.email_addresses?.[0]?.email_address
    const fallbackName = userEmail || "Unknown User"

    if (isNewUser) {
      const userName = nameFromClerk || fallbackName
      const earlyAdopter = await earlyAdopterGrantIfPromoActive(ctx)
      await ctx.db.insert("users", {
        externalId: data.id,
        name: userName,
        email: userEmail,
        ...earlyAdopter,
      })

      // Send welcome email to new user
      if (userEmail) {
        try {
          const template = getWelcomeEmailTemplate(userName)
          await sendTransactionalEmail(ctx, userEmail, template)
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { logError } = require("./logger")
          logError(error, "Failed to send welcome email")
          // Don't fail the mutation if email fails
        }
      }
    } else {
      // Only overwrite name when Clerk has real name parts, or the stored name is a placeholder.
      const updates: { name?: string; email?: string } = {
        email: userEmail || user.email,
      }
      if (nameFromClerk) {
        updates.name = nameFromClerk
      } else if (isPlaceholderUserName(user.name)) {
        updates.name = fallbackName
      }
      await ctx.db.patch(user._id, updates)
    }
  },
})

// Helper function to check Stripe balance
async function checkStripeBalance(stripeAccountId: string): Promise<string | null> {
  try {
    const stripe = await import("stripe").then((mod) => {
      const secretKey = process.env.STRIPE_SECRET_KEY
      if (!secretKey) {
        throw new Error("STRIPE_SECRET_KEY environment variable is not set")
      }
      return new mod.default(secretKey, {
        apiVersion: "2025-08-27.basil",
      })
    })

    const balance = await stripe.balance.retrieve({
      stripeAccount: stripeAccountId,
    })

    const hasPendingBalance = balance.pending.some((pendingBalance) => {
      const totalPending =
        pendingBalance.amount +
        (pendingBalance.source_types?.card || 0) +
        (pendingBalance.source_types?.bank_account || 0)
      return totalPending > 0
    })

    const hasAvailableBalance = balance.available.some((availableBalance) => {
      const totalAvailable =
        availableBalance.amount +
        (availableBalance.source_types?.card || 0) +
        (availableBalance.source_types?.bank_account || 0)
      return totalAvailable > 0
    })

    if (hasPendingBalance || hasAvailableBalance) {
      const balanceDetails: string[] = []
      if (hasPendingBalance) {
        const pendingUSD = balance.pending.find((b) => b.currency === "usd")
        if (pendingUSD && pendingUSD.amount > 0) {
          balanceDetails.push(`$${(pendingUSD.amount / 100).toFixed(2)} pending`)
        }
      }
      if (hasAvailableBalance) {
        const availableUSD = balance.available.find((b) => b.currency === "usd")
        if (availableUSD && availableUSD.amount > 0) {
          balanceDetails.push(`$${(availableUSD.amount / 100).toFixed(2)} available`)
        }
      }

      return `Stripe account has non-zero balance (${balanceDetails.join(", ")}). Please wait for all payouts to complete before deleting your account.`
    }

    return null
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logError } = require("./logger")
    logError(error, "Failed to check Stripe balance for user deletion")

    return "Unable to verify Stripe account balance. Please try again later or contact support."
  }
}

// Internal action to check if user can be safely deleted
// This includes checking Stripe balance for users with Connect accounts
export const checkUserDeletionEligibility = action({
  args: { clerkUserId: v.string() },
  async handler(
    ctx,
    { clerkUserId }
  ): Promise<{
    canDelete: boolean
    reason?: string
    blockingFactors: string[]
  }> {
    const user = await ctx.runQuery(api.users.getByExternalId, {
      externalId: clerkUserId,
    })

    if (!user) {
      return {
        canDelete: true,
        blockingFactors: [],
      }
    }

    const blockingFactors: string[] = []
    const today = new Date().toISOString().split("T")[0] as string

    // Check for active reservations as a renter
    const renterReservations = await ctx.runQuery(internal.users.getActiveReservationsAsRenter, {
      clerkUserId,
      today,
    })

    if (renterReservations.length > 0) {
      blockingFactors.push(
        `${renterReservations.length} active booking(s) as a renter. Please cancel them first.`
      )
    }

    // Check for active reservations on owned vehicles
    const activeHostReservations = await ctx.runQuery(internal.users.getActiveReservationsAsHost, {
      clerkUserId,
      today,
    })

    if (activeHostReservations.count > 0) {
      blockingFactors.push(
        `${activeHostReservations.count} active reservation(s) on your vehicles.`
      )
    }

    // Check Stripe balance if user has a Connect account
    if (user.stripeAccountId) {
      const balanceError = await checkStripeBalance(user.stripeAccountId)
      if (balanceError) {
        blockingFactors.push(balanceError)
      }
    }

    return {
      canDelete: blockingFactors.length === 0,
      reason:
        blockingFactors.length > 0
          ? `Cannot delete account: ${blockingFactors.join(" ")}`
          : undefined,
      blockingFactors,
    }
  },
})

// Internal query to get active reservations as renter
export const getActiveReservationsAsRenter = internalQuery({
  args: {
    clerkUserId: v.string(),
    today: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("reservations")
      .withIndex("by_renter", (q) => q.eq("renterId", args.clerkUserId))
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "confirmed")),
          q.gte(q.field("endDate"), args.today)
        )
      )
      .collect(),
})

// Internal query to get active reservations on owned vehicles
export const getActiveReservationsAsHost = internalQuery({
  args: {
    clerkUserId: v.string(),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const ownedVehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.clerkUserId))
      .collect()

    let reservationsCount = 0
    for (const vehicle of ownedVehicles) {
      const activeReservations = await ctx.db
        .query("reservations")
        .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
        .filter((q) =>
          q.and(
            q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "confirmed")),
            q.gte(q.field("endDate"), args.today)
          )
        )
        .collect()

      reservationsCount += activeReservations.length
    }

    return { count: reservationsCount }
  },
})

export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  async handler(ctx, { clerkUserId }) {
    const user = await userByExternalId(ctx, clerkUserId)

    if (user !== null) {
      // Schedule eligibility check action first
      // This will perform all validation including Stripe balance check
      await ctx.scheduler.runAfter(0, api.users.performUserDeletionWithChecks, {
        clerkUserId,
      })
    }
  },
})

// Action that performs the full deletion with eligibility checks
export const performUserDeletionWithChecks = action({
  args: { clerkUserId: v.string() },
  async handler(ctx, { clerkUserId }) {
    // Check eligibility (includes Stripe balance check)
    const eligibility = await ctx.runAction(api.users.checkUserDeletionEligibility, {
      clerkUserId,
    })

    if (!eligibility.canDelete) {
      throw new Error(eligibility.reason || "Cannot delete user account")
    }

    // If eligible, perform the actual deletion
    await ctx.runMutation(internal.users.performUserDeletion, {
      clerkUserId,
    })
  },
})

// Internal mutation to actually delete the user (only called after checks pass)
export const performUserDeletion = internalMutation({
  args: { clerkUserId: v.string() },
  async handler(ctx, { clerkUserId }) {
    const user = await userByExternalId(ctx, clerkUserId)

    if (user !== null) {
      await ctx.db.delete(user._id)
    }
  },
})

export const updateProfileImage = mutation({
  args: {
    r2Key: v.optional(v.string()), // R2 object key (preferred)
    storageId: v.optional(v.id("_storage")), // Legacy Convex storage ID
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const userId = identity.subject

    // Get or create user
    let user = await userByExternalId(ctx, userId)
    if (!user) {
      // Create user if they don't exist
      const earlyAdopter = await earlyAdopterGrantIfPromoActive(ctx)
      const userData = {
        externalId: userId,
        name: identity.name || identity.email || "Unknown User",
        email: identity.email,
        ...earlyAdopter,
      }
      const newUserId = await ctx.db.insert("users", userData)
      user = await ctx.db.get(newUserId)
    }

    if (!user) {
      throw new Error("Failed to create or retrieve user")
    }

    if (args.r2Key) {
      await ctx.db.patch(user._id, {
        profileImageR2Key: args.r2Key,
      })
    } else if (args.storageId) {
      // Legacy: Get the URL from the storage ID
      const profileImageUrl = await ctx.storage.getUrl(args.storageId)
      if (!profileImageUrl) {
        throw new Error("Failed to get image URL from storage")
      }
      await ctx.db.patch(user._id, {
        profileImage: profileImageUrl,
      })
    } else {
      throw new Error("Either r2Key or storageId must be provided")
    }

    return user._id
  },
})

export const updateProfile = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    experience: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const userId = identity.subject

    // Get or create user
    let user = await userByExternalId(ctx, userId)
    if (!user) {
      // Create user if they don't exist
      const earlyAdopter = await earlyAdopterGrantIfPromoActive(ctx)
      const userData = {
        externalId: userId,
        name: args.name || identity.name || identity.email || "Unknown User",
        email: args.email || identity.email,
        phone: args.phone,
        interests: args.interests,
        bio: args.bio,
        location: args.location,
        experience: args.experience,
        ...earlyAdopter,
      }
      const newUserId = await ctx.db.insert("users", userData)
      user = await ctx.db.get(newUserId)
    }

    if (!user) {
      throw new Error("Failed to create or retrieve user")
    }

    await ctx.db.patch(user._id, {
      name: args.name,
      email: args.email,
      phone: args.phone,
      interests: args.interests,
      bio: args.bio,
      location: args.location,
      experience: args.experience,
    })

    return user._id
  },
})

// Update notification preferences
export const updateNotificationPreferences = mutation({
  args: {
    preferences: v.object({
      reservationUpdates: v.boolean(),
      messages: v.boolean(),
      reviewsAndRatings: v.boolean(),
      paymentUpdates: v.boolean(),
      marketing: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    await ctx.db.patch(user._id, {
      notificationPreferences: args.preferences,
    })

    return user._id
  },
})

// Get notification preferences for current user
export const getNotificationPreferences = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      return null
    }

    // Return default preferences if none set
    return (
      user.notificationPreferences || {
        reservationUpdates: true,
        messages: true,
        reviewsAndRatings: true,
        paymentUpdates: true,
        marketing: false,
      }
    )
  },
})

export const setStripeAccountId = mutation({
  args: {
    userId: v.string(),
    stripeAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.userId))
      .first()

    if (!user) {
      throw new Error("User not found")
    }

    await ctx.db.patch(user._id, {
      stripeAccountId: args.stripeAccountId,
      stripeAccountStatus: "pending",
    })

    return user._id
  },
})

// Find user by Stripe account ID
export const getByStripeAccountId = query({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("stripeAccountId"), args.stripeAccountId))
      .first(),
})

// Update Stripe account status (called from webhook)
export const updateStripeAccountStatus = internalMutation({
  args: {
    stripeAccountId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("enabled"),
      v.literal("restricted"),
      v.literal("disabled")
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("stripeAccountId"), args.stripeAccountId))
      .first()

    if (user) {
      await ctx.db.patch(user._id, {
        stripeAccountStatus: args.status,
      })
    }
  },
})

export const setStripeCustomerId = mutation({
  args: {
    userId: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.userId))
      .first()

    if (!user) {
      throw new Error("User not found")
    }

    await ctx.db.patch(user._id, {
      stripeCustomerId: args.stripeCustomerId,
    })

    return user._id
  },
})

export async function getCurrentUserOrThrow(ctx: QueryCtx) {
  const userRecord = await getCurrentUser(ctx)
  if (!userRecord) throw new Error("Can't get current user")
  return userRecord
}

export async function getCurrentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (identity === null) {
    return null
  }
  return await userByExternalId(ctx, identity.subject)
}

async function userByExternalId(ctx: QueryCtx, externalId: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique()
}

// ============================================================================
// Host Onboarding Functions
// ============================================================================

export const getHostOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      return {
        status: "not_started" as const,
        steps: {
          personalInfo: false,
          vehicleAdded: false,
          payoutSetup: false,
          safetyStandards: false,
        },
      }
    }

    // Check if user has vehicles (for vehicleAdded step)
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .collect()

    // Check if user has Stripe account (for payoutSetup step)
    const hasStripeAccount = !!user.stripeAccountId

    // Auto-complete steps based on existing data
    // Note: payoutSetup is no longer required for onboarding completion
    const steps = {
      personalInfo: !!(user.phone && user.location),
      vehicleAdded: vehicles.length > 0,
      payoutSetup: hasStripeAccount, // Tracked but not required for completion
      safetyStandards: user.hostOnboardingSteps?.safetyStandards ?? false,
    }

    // Determine overall status
    // Only require vehicleAdded and safetyStandards for completion (payoutSetup is optional)
    const requiredStepsComplete =
      steps.vehicleAdded && (steps.safetyStandards || user.hostOnboardingStatus === "completed")
    const anyStepComplete = Object.values(steps).some((step) => step === true)

    let status: "not_started" | "in_progress" | "completed"
    if (user.hostOnboardingStatus === "completed" || requiredStepsComplete) {
      status = "completed"
    } else if (user.hostOnboardingStatus === "in_progress" || anyStepComplete) {
      status = "in_progress"
    } else {
      status = "not_started"
    }

    return {
      status,
      steps,
    }
  },
})

export const updateHostOnboardingStep = mutation({
  args: {
    step: v.union(
      v.literal("personalInfo"),
      v.literal("vehicleAdded"),
      v.literal("payoutSetup"),
      v.literal("safetyStandards")
    ),
    completed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    const currentSteps = user.hostOnboardingSteps || {
      personalInfo: false,
      vehicleAdded: false,
      payoutSetup: false,
      safetyStandards: false,
    }

    const updatedSteps = {
      ...currentSteps,
      [args.step]: args.completed,
    }

    // Check if required steps are complete (payoutSetup is optional)
    const requiredStepsComplete = updatedSteps.vehicleAdded && updatedSteps.safetyStandards

    await ctx.db.patch(user._id, {
      hostOnboardingSteps: updatedSteps,
      hostOnboardingStatus: requiredStepsComplete
        ? "completed"
        : user.hostOnboardingStatus === "not_started"
          ? "in_progress"
          : user.hostOnboardingStatus || "in_progress",
    })

    return { success: true }
  },
})

export const saveOnboardingVehicleAddress = mutation({
  args: {
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zipCode: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    // Save address without coordinates first (geocoding happens async)
    await ctx.db.patch(user._id, {
      onboardingVehicleAddress: args.address,
      hostOnboardingStatus:
        user.hostOnboardingStatus === "not_started"
          ? "in_progress"
          : user.hostOnboardingStatus || "in_progress",
    })

    // Schedule geocoding action
    await ctx.scheduler.runAfter(0, api.users.geocodeOnboardingAddress, {
      userId: user._id,
      address: args.address,
    })

    return { success: true }
  },
})

// Internal mutation to update onboarding address coordinates after geocoding
export const updateOnboardingAddressCoordinates = internalMutation({
  args: {
    userId: v.id("users"),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user?.onboardingVehicleAddress) {
      return
    }

    await ctx.db.patch(args.userId, {
      onboardingVehicleAddress: {
        ...user.onboardingVehicleAddress,
        latitude: args.latitude,
        longitude: args.longitude,
      },
    })
  },
})

// Action to geocode onboarding address (can make network calls)
export const geocodeOnboardingAddress = action({
  args: {
    userId: v.id("users"),
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zipCode: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const { geocodeAddress } = await import("./geocoding")

    const result = await geocodeAddress(args.address)

    if (result) {
      await ctx.runMutation(internal.users.updateOnboardingAddressCoordinates, {
        userId: args.userId,
        latitude: result.latitude,
        longitude: result.longitude,
      })
    }
  },
})

export const getOnboardingVehicleAddress = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      return null
    }

    return user.onboardingVehicleAddress || null
  },
})

export const completeHostOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    await ctx.db.patch(user._id, {
      hostOnboardingStatus: "completed",
      // Clear temporary onboarding data after completion
      // Note: Images are already associated with the vehicle, so we don't delete them
      onboardingVehicleAddress: undefined,
      hostOnboardingDraft: undefined,
    })

    return { success: true }
  },
})

export const resetHostOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    await ctx.db.patch(user._id, {
      hostOnboardingStatus: "not_started",
      hostOnboardingSteps: {
        personalInfo: false,
        vehicleAdded: false,
        payoutSetup: false,
        safetyStandards: false,
      },
    })

    return { success: true }
  },
})

export const checkFirstVehicle = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return false
    }

    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .collect()

    return vehicles.length === 0
  },
})

// Save onboarding draft data
export const saveOnboardingDraft = mutation({
  args: {
    address: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zipCode: v.string(),
      })
    ),
    vehicleData: v.optional(
      v.object({
        trackId: v.optional(v.string()),
        make: v.string(),
        model: v.string(),
        year: v.number(),
        dailyRate: v.number(),
        description: v.string(),
        horsepower: v.optional(v.number()),
        transmission: v.optional(v.string()),
        drivetrain: v.optional(v.string()),
        engineType: v.optional(v.string()),
        mileage: v.optional(v.number()),
        amenities: v.array(v.string()),
        addOns: v.array(
          v.object({
            name: v.string(),
            price: v.number(),
            description: v.optional(v.string()),
            isRequired: v.optional(v.boolean()),
            priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
          })
        ),
        advanceNotice: v.optional(v.string()),
        minTripDuration: v.optional(v.string()),
        maxTripDuration: v.optional(v.string()),
        requireWeekendMin: v.optional(v.boolean()),
      })
    ),
    images: v.optional(
      v.array(
        v.object({
          r2Key: v.string(),
          isPrimary: v.boolean(),
          order: v.number(),
        })
      )
    ),
    currentStep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    const currentDraft = user.hostOnboardingDraft || {}
    const updatedDraft = {
      ...currentDraft,
      address: args.address ?? currentDraft.address,
      vehicleData: args.vehicleData ?? currentDraft.vehicleData,
      images: args.images ?? currentDraft.images,
      currentStep: args.currentStep ?? currentDraft.currentStep,
      lastSavedAt: Date.now(),
    }

    await ctx.db.patch(user._id, {
      hostOnboardingDraft: updatedDraft,
      hostOnboardingStatus:
        user.hostOnboardingStatus === "not_started"
          ? "in_progress"
          : user.hostOnboardingStatus || "in_progress",
    })

    return { success: true }
  },
})

// Get onboarding draft data
export const getOnboardingDraft = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      return null
    }

    return user.hostOnboardingDraft || null
  },
})

// Clear onboarding draft
export const clearOnboardingDraft = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    // Clean up orphaned images from R2 before clearing draft
    if (user.hostOnboardingDraft?.images) {
      for (const image of user.hostOnboardingDraft.images) {
        if (image.r2Key) {
          try {
            await r2.deleteObject(ctx, image.r2Key)
          } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { logError } = require("./logger")
            logError(error, `Failed to delete orphaned R2 image ${image.r2Key}`)
            // Continue with cleanup even if R2 deletion fails
          }
        }
      }
    }

    await ctx.db.patch(user._id, {
      hostOnboardingDraft: undefined,
    })

    return { success: true }
  },
})

// Start over onboarding - clears draft, images, and resets status
export const startOverOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const user = await userByExternalId(ctx, identity.subject)
    if (!user) {
      throw new Error("User not found")
    }

    // Clean up orphaned images from R2 before clearing draft
    if (user.hostOnboardingDraft?.images) {
      for (const image of user.hostOnboardingDraft.images) {
        if (image.r2Key) {
          try {
            await r2.deleteObject(ctx, image.r2Key)
          } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { logError } = require("./logger")
            logError(error, `Failed to delete orphaned R2 image ${image.r2Key}`)
            // Continue with cleanup even if R2 deletion fails
          }
        }
      }
    }

    // Reset onboarding status and clear all draft data
    await ctx.db.patch(user._id, {
      hostOnboardingStatus: "not_started",
      hostOnboardingDraft: undefined,
      onboardingVehicleAddress: undefined,
    })

    return { success: true }
  },
})
