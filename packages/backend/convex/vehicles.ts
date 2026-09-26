import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { checkAdmin } from "./admin"
import { calculateDistance } from "./geocoding"
import { r2 } from "./r2"
import { normalizeMake } from "./vehicleMakes"

// Get all active and approved vehicles with optimized images
export const getAllWithOptimizedImages = query({
  args: {
    trackId: v.optional(v.id("tracks")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { trackId, limit = 50 } = args

    // Get current user identity to filter out their own vehicles
    const identity = await ctx.auth.getUserIdentity()
    const currentUserId = identity?.subject

    let vehicles
    if (trackId) {
      vehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_track", (q) => q.eq("trackId", trackId))
        .filter((q) =>
          q.and(
            q.eq(q.field("isActive"), true),
            q.eq(q.field("isApproved"), true),
            q.eq(q.field("deletedAt"), undefined),
            q.neq(q.field("isSuspended"), true)
          )
        )
        .order("desc")
        .take(limit)
    } else {
      vehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_active_approved", (q) => q.eq("isActive", true).eq("isApproved", true))
        .filter((q) =>
          q.and(q.eq(q.field("deletedAt"), undefined), q.neq(q.field("isSuspended"), true))
        )
        .order("desc")
        .take(limit)
    }

    // Filter out vehicles owned by the current user (if authenticated)
    if (currentUserId) {
      vehicles = vehicles.filter((vehicle) => vehicle.ownerId !== currentUserId)
    }

    // Get vehicle images and owner details
    const vehiclesWithDetails = await Promise.all(
      vehicles.map(async (vehicle) => {
        const [images, owner, track] = await Promise.all([
          ctx.db
            .query("vehicleImages")
            .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
            .order("asc")
            .collect(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", vehicle.ownerId))
            .first(),
          ctx.db.get(vehicle.trackId),
        ])

        const hostStripeReady = !!owner?.stripeAccountId && owner.stripeAccountStatus === "enabled"

        const optimizedImages = images.filter((image) => image.r2Key)

        return {
          ...vehicle,
          images: optimizedImages,
          owner,
          track,
          hostStripeReady,
        }
      })
    )

    return vehiclesWithDetails
  },
})

// Search vehicles with availability filtering.
// Returns the FULL matching set (capped) so the client can filter (text/amenities/
// rating), sort, and paginate over all results — not just one page. Filters that map
// to indexed/scannable fields, plus availability and distance, run in the DB here.
const SEARCH_RESULT_CAP = 500

export const searchWithAvailability = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    trackId: v.optional(v.id("tracks")),
    // Server-side filterable fields
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    transmission: v.optional(v.string()),
    drivetrain: v.optional(v.string()),
    minYear: v.optional(v.number()),
    maxYear: v.optional(v.number()),
    minHorsepower: v.optional(v.number()),
    maxHorsepower: v.optional(v.number()),
    minDailyRate: v.optional(v.number()),
    maxDailyRate: v.optional(v.number()),
    experienceLevel: v.optional(v.string()),
    tireType: v.optional(v.string()),
    deliveryOnly: v.optional(v.boolean()),
    // Distance-based filtering (optional)
    userLatitude: v.optional(v.number()),
    userLongitude: v.optional(v.number()),
    maxDistanceMiles: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startDate =
      typeof args.startDate === "string" && args.startDate.trim() !== ""
        ? args.startDate.trim()
        : undefined
    const endDate =
      typeof args.endDate === "string" && args.endDate.trim() !== ""
        ? args.endDate.trim()
        : undefined

    const identity = await ctx.auth.getUserIdentity()
    const currentUserId = identity?.subject

    // Build the base indexed query
    const baseQuery = args.trackId
      ? ctx.db.query("vehicles").withIndex("by_track", (q) => q.eq("trackId", args.trackId!))
      : ctx.db
          .query("vehicles")
          .withIndex("by_active_approved", (q) => q.eq("isActive", true).eq("isApproved", true))

    // Apply optional filters. When using by_track we still need to enforce
    // active/approved/non-deleted; when using by_active_approved those are implicit.
    const filtered = baseQuery.filter((q) => {
      const preds = [q.eq(q.field("deletedAt"), undefined), q.neq(q.field("isSuspended"), true)]
      if (args.trackId) {
        preds.push(q.eq(q.field("isActive"), true))
        preds.push(q.eq(q.field("isApproved"), true))
      }
      if (args.make) {
        preds.push(q.eq(q.field("make"), args.make))
      }
      if (args.model) {
        preds.push(q.eq(q.field("model"), args.model))
      }
      if (args.transmission) {
        preds.push(q.eq(q.field("transmission"), args.transmission))
      }
      if (args.drivetrain) {
        preds.push(q.eq(q.field("drivetrain"), args.drivetrain))
      }
      if (args.minYear !== undefined) {
        preds.push(q.gte(q.field("year"), args.minYear))
      }
      if (args.maxYear !== undefined) {
        preds.push(q.lte(q.field("year"), args.maxYear))
      }
      if (args.minDailyRate !== undefined) {
        preds.push(q.gte(q.field("dailyRate"), args.minDailyRate))
      }
      if (args.maxDailyRate !== undefined) {
        preds.push(q.lte(q.field("dailyRate"), args.maxDailyRate))
      }
      // Horsepower is optional; preserve "no listed hp = pass" behavior from the client.
      if (args.minHorsepower !== undefined) {
        preds.push(
          q.or(
            q.eq(q.field("horsepower"), undefined),
            q.gte(q.field("horsepower"), args.minHorsepower)
          )
        )
      }
      if (args.maxHorsepower !== undefined) {
        preds.push(
          q.or(
            q.eq(q.field("horsepower"), undefined),
            q.lte(q.field("horsepower"), args.maxHorsepower)
          )
        )
      }
      if (args.experienceLevel) {
        preds.push(q.eq(q.field("experienceLevel"), args.experienceLevel))
      }
      if (args.tireType) {
        preds.push(q.eq(q.field("tireType"), args.tireType))
      }
      if (args.deliveryOnly) {
        preds.push(q.eq(q.field("deliveryAvailable"), true))
      }
      return q.and(...preds)
    })

    // Collect the full matching set (capped), newest first. The client handles
    // text/amenity/rating filtering, sorting, and "load more" pagination over this.
    let pageVehicles = await filtered.order("desc").take(SEARCH_RESULT_CAP)

    // Exclude vehicles owned by the current user
    if (currentUserId) {
      pageVehicles = pageVehicles.filter((vehicle) => vehicle.ownerId !== currentUserId)
    }

    // Date availability filter (only over the current page).
    // Owner-blocked dates still hide a vehicle from date search. Existing
    // bookings/requests do not — multiple renters can request the same days.
    if (startDate && endDate && pageVehicles.length > 0) {
      const blockedDatesInRange = await ctx.db
        .query("availability")
        .filter((q) =>
          q.and(
            q.eq(q.field("isAvailable"), false),
            q.gte(q.field("date"), startDate),
            q.lte(q.field("date"), endDate)
          )
        )
        .collect()
      const vehiclesWithBlockedDates = new Set(blockedDatesInRange.map((a) => a.vehicleId))

      pageVehicles = pageVehicles.filter((vehicle) => !vehiclesWithBlockedDates.has(vehicle._id))
    }

    // Distance filter (within the page only — cross-page distance sort isn't possible here)
    if (
      args.userLatitude &&
      args.userLongitude &&
      args.maxDistanceMiles &&
      args.maxDistanceMiles > 0
    ) {
      const lat = args.userLatitude
      const lng = args.userLongitude
      const maxMiles = args.maxDistanceMiles
      pageVehicles = pageVehicles.filter((vehicle) => {
        if (!(vehicle.address?.latitude && vehicle.address?.longitude)) {
          return false
        }
        return (
          calculateDistance(lat, lng, vehicle.address.latitude, vehicle.address.longitude) <=
          maxMiles
        )
      })
    }

    // Hydrate with images, owner, track
    const page = await Promise.all(
      pageVehicles.map(async (vehicle) => {
        const [images, owner, track] = await Promise.all([
          ctx.db
            .query("vehicleImages")
            .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
            .order("asc")
            .collect(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", vehicle.ownerId))
            .first(),
          ctx.db.get(vehicle.trackId),
        ])

        const hostStripeReady = !!owner?.stripeAccountId && owner.stripeAccountStatus === "enabled"
        const optimizedImages = images.filter((image) => image.r2Key)

        return {
          ...vehicle,
          images: optimizedImages,
          owner,
          track,
          hostStripeReady,
        }
      })
    )

    return page
  },
})

// Get all active and approved vehicles
export const getAll = query({
  args: {
    trackId: v.optional(v.id("tracks")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { trackId, limit = 50 } = args

    // Get current user identity to filter out their own vehicles
    const identity = await ctx.auth.getUserIdentity()
    const currentUserId = identity?.subject

    let vehicles
    if (trackId) {
      vehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_track", (q) => q.eq("trackId", trackId))
        .filter((q) =>
          q.and(
            q.eq(q.field("isActive"), true),
            q.eq(q.field("isApproved"), true),
            q.eq(q.field("deletedAt"), undefined),
            q.neq(q.field("isSuspended"), true)
          )
        )
        .order("desc")
        .take(limit)
    } else {
      vehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_active_approved", (q) => q.eq("isActive", true).eq("isApproved", true))
        .filter((q) =>
          q.and(q.eq(q.field("deletedAt"), undefined), q.neq(q.field("isSuspended"), true))
        )
        .order("desc")
        .take(limit)
    }

    // Filter out vehicles owned by the current user (if authenticated)
    if (currentUserId) {
      vehicles = vehicles.filter((vehicle) => vehicle.ownerId !== currentUserId)
    }

    // Get vehicle images and owner details
    const vehiclesWithDetails = await Promise.all(
      vehicles.map(async (vehicle) => {
        const [images, owner, track] = await Promise.all([
          ctx.db
            .query("vehicleImages")
            .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
            .order("asc")
            .collect(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", vehicle.ownerId))
            .first(),
          ctx.db.get(vehicle.trackId),
        ])

        const hostStripeReady = !!owner?.stripeAccountId && owner.stripeAccountStatus === "enabled"

        return {
          ...vehicle,
          images,
          owner,
          track,
          hostStripeReady,
        }
      })
    )

    return vehiclesWithDetails
  },
})

// Get vehicle by ID with all details
export const getById = query({
  args: { id: v.id("vehicles") },
  handler: async (ctx, args) => {
    const vehicle = await ctx.db.get(args.id)
    if (vehicle === null) {
      throw new Error("NOT_FOUND")
    }

    const [images, owner, track, availability] = await Promise.all([
      ctx.db
        .query("vehicleImages")
        .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.id))
        .order("asc")
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", vehicle.ownerId))
        .first(),
      ctx.db.get(vehicle.trackId),
      ctx.db
        .query("availability")
        .withIndex("by_vehicle_date", (q) => q.eq("vehicleId", args.id))
        .order("asc")
        .collect(),
    ])

    const hostStripeReady = !!owner?.stripeAccountId && owner.stripeAccountStatus === "enabled"

    return {
      ...vehicle,
      images,
      owner,
      track,
      availability,
      hostStripeReady,
    }
  },
})

// Get vehicle image by ID
export const getVehicleImageById = query({
  args: { id: v.id("vehicleImages") },
  handler: async (ctx, args) => {
    const image = await ctx.db.get(args.id)
    if (!image?.r2Key) {
      return null
    }
    return image
  },
})

// Get vehicles by owner (excludes soft-deleted vehicles)
export const getByOwner = query({
  args: {
    ownerId: v.string(),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_owner_active", (q) => q.eq("ownerId", args.ownerId).eq("isActive", true))
      .order("desc")
      .collect()

    // Filter out soft-deleted vehicles unless explicitly requested
    if (!args.includeDeleted) {
      vehicles = vehicles.filter((v) => !v.deletedAt)
    }

    const vehiclesWithDetails = await Promise.all(
      vehicles.map(async (vehicle) => {
        const [images, track] = await Promise.all([
          ctx.db
            .query("vehicleImages")
            .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
            .order("asc")
            .collect(),
          ctx.db.get(vehicle.trackId),
        ])

        const optimizedImages = images.filter((image) => image.r2Key)

        return {
          ...vehicle,
          images: optimizedImages,
          track,
        }
      })
    )

    return vehiclesWithDetails
  },
})

// Generate upload URL for file storage (legacy - use R2 mutations instead)
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    return await ctx.storage.generateUploadUrl()
  },
})

// Create a new vehicle with processed images
export const createVehicleWithImages = mutation({
  args: {
    trackId: v.optional(v.id("tracks")),
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
    addOns: v.optional(
      v.array(
        v.object({
          name: v.string(),
          price: v.number(),
          description: v.optional(v.string()),
          isRequired: v.optional(v.boolean()),
          priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
        })
      )
    ),
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zipCode: v.string(),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
      })
    ),
    advanceNotice: v.optional(v.string()),
    minTripDuration: v.optional(v.string()),
    maxTripDuration: v.optional(v.string()),
    requireWeekendMin: v.optional(v.boolean()),
    cancellationPolicy: v.optional(
      v.union(v.literal("flexible"), v.literal("moderate"), v.literal("strict"))
    ),
    images: v.array(
      v.object({
        r2Key: v.string(),
        isPrimary: v.boolean(),
        order: v.number(),
        metadata: v.optional(
          v.object({
            fileName: v.string(),
            originalSize: v.number(),
            processedSizes: v.object({
              thumbnail: v.number(),
              card: v.number(),
              detail: v.number(),
              hero: v.number(),
            }),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const userId = identity.subject
    const now = Date.now()

    // If no trackId provided, we need to handle it - but schema requires trackId
    // For now, we'll require it or throw an error
    if (!args.trackId) {
      // Get the first active track as default
      const defaultTrack = await ctx.db
        .query("tracks")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .first()
      if (!defaultTrack) {
        throw new Error("No active tracks available. Please select a track.")
      }
      args.trackId = defaultTrack._id
    }

    // Create the vehicle (geocoding happens async after creation)
    const vehicleId = await ctx.db.insert("vehicles", {
      ownerId: userId,
      trackId: args.trackId,
      make: normalizeMake(args.make),
      model: args.model,
      year: args.year,
      dailyRate: args.dailyRate,
      description: args.description,
      horsepower: args.horsepower,
      transmission: args.transmission,
      drivetrain: args.drivetrain,
      engineType: args.engineType,
      mileage: args.mileage,
      amenities: args.amenities,
      addOns: args.addOns || [],
      address: args.address,
      advanceNotice: args.advanceNotice,
      minTripDuration: args.minTripDuration,
      maxTripDuration: args.maxTripDuration,
      requireWeekendMin: args.requireWeekendMin,
      cancellationPolicy: args.cancellationPolicy || "moderate",
      isActive: true,
      isApproved: false,
      createdAt: now,
      updatedAt: now,
    })

    // Schedule geocoding action if address provided
    if (args.address) {
      await ctx.scheduler.runAfter(0, api.vehicles.geocodeVehicleAddress, {
        vehicleId,
        address: args.address,
      })
    }

    // Create vehicle images (R2 only)
    await Promise.all(
      args.images.map(async (image) =>
        ctx.db.insert("vehicleImages", {
          vehicleId,
          r2Key: image.r2Key,
          isPrimary: image.isPrimary,
          order: image.order,
          metadata: image.metadata,
        })
      )
    )

    // Check if this is the user's first vehicle and update onboarding status
    const existingVehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect()

    // If this is the first vehicle, mark vehicleAdded step as complete
    if (existingVehicles.length === 1) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", userId))
        .first()

      if (user) {
        const currentSteps = user.hostOnboardingSteps || {
          personalInfo: false,
          vehicleAdded: false,
          payoutSetup: false,
          safetyStandards: false,
        }

        const updatedSteps = {
          ...currentSteps,
          vehicleAdded: true,
        }

        // Check if all steps are complete
        const allStepsComplete = Object.values(updatedSteps).every((step) => step === true)

        await ctx.db.patch(user._id, {
          hostOnboardingSteps: updatedSteps,
          hostOnboardingStatus: allStepsComplete
            ? "completed"
            : user.hostOnboardingStatus === "not_started"
              ? "in_progress"
              : user.hostOnboardingStatus || "in_progress",
        })
      }
    }

    return vehicleId
  },
})

// Update vehicle
export const update = mutation({
  args: {
    id: v.id("vehicles"),
    trackId: v.optional(v.id("tracks")),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    year: v.optional(v.number()),
    dailyRate: v.optional(v.number()),
    description: v.optional(v.string()),
    horsepower: v.optional(v.number()),
    transmission: v.optional(v.string()),
    drivetrain: v.optional(v.string()),
    engineType: v.optional(v.string()),
    mileage: v.optional(v.number()),
    fuelType: v.optional(v.string()),
    color: v.optional(v.string()),
    amenities: v.optional(v.array(v.string())),
    performanceSpecs: v.optional(
      v.object({
        torque: v.optional(v.number()),
        acceleration: v.optional(v.number()),
        topSpeed: v.optional(v.number()),
        weight: v.optional(v.number()),
        engineType: v.optional(v.string()),
        displacement: v.optional(v.number()),
        fuelCapacity: v.optional(v.number()),
        tireSize: v.optional(v.string()),
        brakeType: v.optional(v.string()),
        suspensionType: v.optional(v.string()),
        differentialType: v.optional(v.string()),
        coolingSystem: v.optional(v.string()),
      })
    ),
    addOns: v.optional(
      v.array(
        v.object({
          name: v.string(),
          price: v.number(),
          description: v.optional(v.string()),
          isRequired: v.optional(v.boolean()),
          priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
        })
      )
    ),
    advanceNotice: v.optional(v.string()),
    minTripDuration: v.optional(v.string()),
    maxTripDuration: v.optional(v.string()),
    requireWeekendMin: v.optional(v.boolean()),
    cancellationPolicy: v.optional(
      v.union(v.literal("flexible"), v.literal("moderate"), v.literal("strict"))
    ),
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zipCode: v.string(),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const vehicle = await ctx.db.get(args.id)
    if (!vehicle) {
      throw new Error("Vehicle not found")
    }

    if (vehicle.ownerId !== identity.subject) {
      throw new Error("Not authorized to update this vehicle")
    }

    // Check if address changed and needs geocoding
    const addressChanged =
      args.address && (!vehicle.address || vehicle.address.zipCode !== args.address.zipCode)

    const { id, ...updateData } = args
    void id // Exclude id from updateData

    // Save the address without coordinates first (geocoding happens async)
    await ctx.db.patch(args.id, {
      ...updateData,
      ...(updateData.make !== undefined ? { make: normalizeMake(updateData.make) } : {}),
      updatedAt: Date.now(),
    })

    // Schedule geocoding action if address changed
    if (addressChanged && args.address) {
      await ctx.scheduler.runAfter(0, api.vehicles.geocodeVehicleAddress, {
        vehicleId: args.id,
        address: args.address,
      })
    }

    return args.id
  },
})

// One-time backfill: normalize every existing vehicle's `make` to its canonical form.
// Idempotent — safe to re-run (already-normalized rows are skipped). Run from the
// Convex dashboard's function runner or `npx convex run vehicles:normalizeAllMakes`.
export const normalizeAllMakes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const vehicles = await ctx.db.query("vehicles").collect()
    let updated = 0
    for (const vehicle of vehicles) {
      const normalized = normalizeMake(vehicle.make)
      if (normalized && normalized !== vehicle.make) {
        await ctx.db.patch(vehicle._id, { make: normalized })
        updated++
      }
    }
    return { scanned: vehicles.length, updated }
  },
})

// Vehicles that have an address ZIP but no geocoded coordinates yet.
export const listVehiclesMissingCoordinates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const vehicles = await ctx.db.query("vehicles").collect()
    return vehicles
      .filter(
        (vehicle) =>
          !vehicle.deletedAt &&
          vehicle.address?.zipCode &&
          !(vehicle.address?.latitude && vehicle.address?.longitude)
      )
      .map((vehicle) => ({
        vehicleId: vehicle._id,
        address: {
          street: vehicle.address?.street,
          city: vehicle.address?.city,
          state: vehicle.address?.state,
          zipCode: vehicle.address?.zipCode ?? "",
        },
      }))
  },
})

// One-time backfill: geocode every existing vehicle that's missing coordinates so
// distance filtering can include it. Idempotent — already-geocoded vehicles are
// skipped. Run with `npx convex run vehicles:backfillVehicleCoordinates`.
export const backfillVehicleCoordinates = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; updated: number }> => {
    const { geocodeAddress } = await import("./geocoding")
    const todo: Array<{
      vehicleId: Id<"vehicles">
      address: { street?: string; city?: string; state?: string; zipCode: string }
    }> = await ctx.runQuery(internal.vehicles.listVehiclesMissingCoordinates, {})
    let updated = 0
    for (const item of todo) {
      const result = await geocodeAddress(item.address)
      if (result) {
        await ctx.runMutation(internal.vehicles.updateVehicleCoordinates, {
          vehicleId: item.vehicleId,
          latitude: result.latitude,
          longitude: result.longitude,
        })
        updated++
      }
    }
    return { scanned: todo.length, updated }
  },
})

// Internal mutation to update vehicle coordinates after geocoding
export const updateVehicleCoordinates = internalMutation({
  args: {
    vehicleId: v.id("vehicles"),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const vehicle = await ctx.db.get(args.vehicleId)
    if (!vehicle?.address) {
      return
    }

    await ctx.db.patch(args.vehicleId, {
      address: {
        ...vehicle.address,
        latitude: args.latitude,
        longitude: args.longitude,
      },
      updatedAt: Date.now(),
    })
  },
})

// Action to geocode a vehicle's address (can make network calls)
export const geocodeVehicleAddress = action({
  args: {
    vehicleId: v.id("vehicles"),
    address: v.object({
      street: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zipCode: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const { geocodeZipCode } = await import("./geocoding")

    const result = await geocodeZipCode(args.address.zipCode)

    if (result) {
      // Update the vehicle with coordinates
      await ctx.runMutation(internal.vehicles.updateVehicleCoordinates, {
        vehicleId: args.vehicleId,
        latitude: result.latitude,
        longitude: result.longitude,
      })
    }
  },
})

// Check if vehicle can be deleted (has no pending actions)
export const canDelete = query({
  args: { id: v.id("vehicles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { canDelete: false, reason: "Not authenticated" }
    }

    const vehicle = await ctx.db.get(args.id)
    if (!vehicle) {
      return { canDelete: false, reason: "Vehicle not found" }
    }

    if (vehicle.ownerId !== identity.subject) {
      return { canDelete: false, reason: "Not authorized" }
    }

    if (vehicle.deletedAt) {
      return { canDelete: false, reason: "Vehicle already deleted" }
    }

    const blockers: string[] = []

    // Check for active or upcoming reservations (pending or confirmed)
    const today = new Date().toISOString().split("T")[0] as string
    const activeReservations = await ctx.db
      .query("reservations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.id))
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "confirmed")),
          q.gte(q.field("endDate"), today)
        )
      )
      .collect()

    if (activeReservations.length > 0) {
      const pendingCount = activeReservations.filter((r) => r.status === "pending").length
      const confirmedCount = activeReservations.filter((r) => r.status === "confirmed").length
      if (pendingCount > 0) {
        blockers.push(`${pendingCount} pending reservation${pendingCount > 1 ? "s" : ""}`)
      }
      if (confirmedCount > 0) {
        blockers.push(
          `${confirmedCount} confirmed/upcoming reservation${confirmedCount > 1 ? "s" : ""}`
        )
      }
    }

    // Check for open disputes
    const openDisputes = await ctx.db
      .query("disputes")
      .filter((q) => q.and(q.eq(q.field("vehicleId"), args.id), q.eq(q.field("status"), "open")))
      .collect()

    if (openDisputes.length > 0) {
      blockers.push(`${openDisputes.length} open dispute${openDisputes.length > 1 ? "s" : ""}`)
    }

    // Check for pending payments (not succeeded, failed, cancelled, or refunded)
    const vehicleReservationIds = await ctx.db
      .query("reservations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.id))
      .collect()

    const reservationIds = vehicleReservationIds.map((r) => r._id)

    if (reservationIds.length > 0) {
      const pendingPayments = await ctx.db
        .query("payments")
        .filter((q) =>
          q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "processing"))
        )
        .collect()

      // Filter to only payments for this vehicle's reservations
      const vehiclePendingPayments = pendingPayments.filter((p) =>
        reservationIds.some((id) => id === p.reservationId)
      )

      if (vehiclePendingPayments.length > 0) {
        blockers.push(
          `${vehiclePendingPayments.length} pending payment${vehiclePendingPayments.length > 1 ? "s" : ""}`
        )
      }
    }

    if (blockers.length > 0) {
      return {
        canDelete: false,
        reason: `Cannot delete vehicle with: ${blockers.join(", ")}`,
        blockers,
      }
    }

    return { canDelete: true, reason: null, blockers: [] }
  },
})

// Delete vehicle (soft delete)
export const remove = mutation({
  args: { id: v.id("vehicles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const vehicle = await ctx.db.get(args.id)
    if (!vehicle) {
      throw new Error("Vehicle not found")
    }

    if (vehicle.ownerId !== identity.subject) {
      throw new Error("Not authorized to delete this vehicle")
    }

    if (vehicle.deletedAt) {
      throw new Error("Vehicle already deleted")
    }

    // Check for active or upcoming reservations (pending or confirmed)
    const today = new Date().toISOString().split("T")[0] as string
    const activeReservations = await ctx.db
      .query("reservations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.id))
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "confirmed")),
          q.gte(q.field("endDate"), today)
        )
      )
      .collect()

    if (activeReservations.length > 0) {
      throw new Error(
        "Cannot delete vehicle with active or upcoming reservations. Please wait until all reservations are completed or cancelled."
      )
    }

    // Check for open disputes
    const openDisputes = await ctx.db
      .query("disputes")
      .filter((q) => q.and(q.eq(q.field("vehicleId"), args.id), q.eq(q.field("status"), "open")))
      .collect()

    if (openDisputes.length > 0) {
      throw new Error(
        "Cannot delete vehicle with open disputes. Please resolve all disputes first."
      )
    }

    // Check for pending payments
    const vehicleReservations = await ctx.db
      .query("reservations")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.id))
      .collect()

    const reservationIds = vehicleReservations.map((r) => r._id)

    if (reservationIds.length > 0) {
      const pendingPayments = await ctx.db
        .query("payments")
        .filter((q) =>
          q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "processing"))
        )
        .collect()

      const vehiclePendingPayments = pendingPayments.filter((p) =>
        reservationIds.some((id) => id === p.reservationId)
      )

      if (vehiclePendingPayments.length > 0) {
        throw new Error(
          "Cannot delete vehicle with pending payments. Please wait for all payments to be processed."
        )
      }
    }

    // Soft delete: set deletedAt timestamp and deactivate
    await ctx.db.patch(args.id, {
      deletedAt: Date.now(),
      isActive: false,
      updatedAt: Date.now(),
    })

    return args.id
  },
})

// Add vehicle image
export const addImage = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    r2Key: v.string(),
    isPrimary: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const vehicle = await ctx.db.get(args.vehicleId)
    if (!vehicle) {
      throw new Error("Vehicle not found")
    }

    if (vehicle.ownerId !== identity.subject) {
      throw new Error("Not authorized to modify this vehicle")
    }

    // Get current image count for order
    const existingImages = await ctx.db
      .query("vehicleImages")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect()

    const imageId = await ctx.db.insert("vehicleImages", {
      vehicleId: args.vehicleId,
      r2Key: args.r2Key,
      isPrimary: args.isPrimary,
      order: existingImages.length,
    })

    // If this is primary, unset other primary images
    if (args.isPrimary) {
      await Promise.all(
        existingImages
          .filter((img) => img.isPrimary)
          .map((img) => ctx.db.patch(img._id, { isPrimary: false }))
      )
    }

    return imageId
  },
})

// Remove vehicle image
export const removeImage = mutation({
  args: { imageId: v.id("vehicleImages") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const image = await ctx.db.get(args.imageId)
    if (!image) {
      throw new Error("Image not found")
    }

    const vehicle = await ctx.db.get(image.vehicleId)
    if (!vehicle || vehicle.ownerId !== identity.subject) {
      throw new Error("Not authorized to modify this vehicle")
    }

    // Delete from R2 if r2Key exists
    if (image.r2Key) {
      try {
        await r2.deleteObject(ctx, image.r2Key)
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logError } = require("./logger")
        logError(error, `Failed to delete R2 object ${image.r2Key}`)
        // Continue with database deletion even if R2 deletion fails
      }
    }

    await ctx.db.delete(args.imageId)
    return args.imageId
  },
})

// Update image order
export const updateImageOrder = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    imageOrders: v.array(
      v.object({
        imageId: v.id("vehicleImages"),
        order: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const vehicle = await ctx.db.get(args.vehicleId)
    if (!vehicle) {
      throw new Error("Vehicle not found")
    }

    if (vehicle.ownerId !== identity.subject) {
      throw new Error("Not authorized to modify this vehicle")
    }

    // Update all image orders
    await Promise.all(
      args.imageOrders.map(({ imageId, order }) => ctx.db.patch(imageId, { order }))
    )

    return { success: true }
  },
})

// Update image properties (e.g., isPrimary)
export const updateImage = mutation({
  args: {
    imageId: v.id("vehicleImages"),
    isPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const image = await ctx.db.get(args.imageId)
    if (!image) {
      throw new Error("Image not found")
    }

    const vehicle = await ctx.db.get(image.vehicleId)
    if (!vehicle || vehicle.ownerId !== identity.subject) {
      throw new Error("Not authorized to modify this vehicle")
    }

    // If setting as primary, unset other primary images
    if (args.isPrimary === true) {
      const existingImages = await ctx.db
        .query("vehicleImages")
        .withIndex("by_vehicle", (q) => q.eq("vehicleId", image.vehicleId))
        .collect()

      await Promise.all(
        existingImages
          .filter((img) => img.isPrimary && img._id !== args.imageId)
          .map((img) => ctx.db.patch(img._id, { isPrimary: false }))
      )
    }

    // Update the image
    await ctx.db.patch(args.imageId, {
      isPrimary: args.isPrimary ?? image.isPrimary,
    })

    return args.imageId
  },
})

// Get all tracks
export const getTracks = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("tracks")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("asc")
      .collect(),
})

// Admin function to approve a vehicle
export const approveVehicle = mutation({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const identity = await checkAdmin(ctx)

    const vehicle = await ctx.db.get(args.vehicleId)
    if (!vehicle) {
      throw new Error("Vehicle not found")
    }

    await ctx.db.patch(args.vehicleId, {
      isApproved: true,
      updatedAt: Date.now(),
    })

    // Audit log
    await ctx.runMutation(internal.auditLog.create, {
      entityType: "vehicle",
      entityId: args.vehicleId,
      action: "approve_vehicle",
      userId: identity.subject,
      previousState: { isApproved: vehicle.isApproved ?? false },
      newState: { isApproved: true },
      metadata: {
        ownerId: vehicle.ownerId,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vehicleYear: vehicle.year,
      },
    })

    return args.vehicleId
  },
})

// Admin function to reject a vehicle
export const rejectVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await checkAdmin(ctx)

    const vehicle = await ctx.db.get(args.vehicleId)
    if (!vehicle) {
      throw new Error("Vehicle not found")
    }

    await ctx.db.patch(args.vehicleId, {
      isApproved: false,
      updatedAt: Date.now(),
    })

    // Audit log
    await ctx.runMutation(internal.auditLog.create, {
      entityType: "vehicle",
      entityId: args.vehicleId,
      action: "reject_vehicle",
      userId: identity.subject,
      previousState: { isApproved: vehicle.isApproved ?? false },
      newState: { isApproved: false },
      metadata: {
        reason: args.reason || "Did not meet approval criteria",
        ownerId: vehicle.ownerId,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vehicleYear: vehicle.year,
      },
    })

    return args.vehicleId
  },
})

// Admin function to get all pending vehicles for review
export const getPendingVehicles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await checkAdmin(ctx)

    const { limit = 50 } = args

    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_active_approved", (q) => q.eq("isActive", true).eq("isApproved", false))
      .order("desc")
      .take(limit)

    // Get vehicle images and owner details
    const vehiclesWithDetails = await Promise.all(
      vehicles.map(async (vehicle) => {
        const [images, owner, track] = await Promise.all([
          ctx.db
            .query("vehicleImages")
            .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
            .order("asc")
            .collect(),
          ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", vehicle.ownerId))
            .first(),
          ctx.db.get(vehicle.trackId),
        ])

        return {
          ...vehicle,
          images,
          owner,
          track,
        }
      })
    )

    return vehiclesWithDetails
  },
})
