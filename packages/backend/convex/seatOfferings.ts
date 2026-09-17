import { v } from "convex/values"
import { internal } from "./_generated/api"
import { mutation, query } from "./_generated/server"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"
import {
  assertOfferingPrices,
  assertSpotCount,
  countHeldSpots,
  getOfferingInventory,
  omitHostUserId,
  requireIdentity,
  requireTeamManager,
  toPublicTeamListing,
} from "./seatHelpers"

const experienceLevelValidator = v.union(
  v.literal("beginner"),
  v.literal("intermediate"),
  v.literal("advanced"),
  v.literal("professional")
)

export const create = mutation({
  args: {
    teamCarId: v.id("teamCars"),
    title: v.string(),
    description: v.optional(v.string()),
    spotCount: v.number(),
    priceCents: v.number(),
    depositCents: v.number(),
    experienceLevel: v.optional(experienceLevelValidator),
    stintNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await rateLimiter.limit(ctx, "createVehicle", {
      key: identity.subject,
      throws: true,
    })

    const teamCar = await ctx.db.get(args.teamCarId)
    if (!teamCar) {
      throwError(ErrorCode.NOT_FOUND, "Team car not found")
    }
    if (!teamCar.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Team car is not active")
    }
    await requireTeamManager(ctx, teamCar.teamId, identity.subject)

    const event = await ctx.db.get(teamCar.raceEventId)
    if (!event?.isActive) {
      throwError(ErrorCode.INVALID_STATUS, "Race event is not active")
    }

    const title = sanitizeShortText(args.title)
    if (!title) {
      throwError(ErrorCode.INVALID_INPUT, "Seat offering title is required")
    }
    assertSpotCount(args.spotCount)
    assertOfferingPrices(args.priceCents, args.depositCents)

    const now = Date.now()
    const offeringId = await ctx.db.insert("seatOfferings", {
      teamCarId: args.teamCarId,
      raceEventId: teamCar.raceEventId,
      teamId: teamCar.teamId,
      hostUserId: teamCar.hostUserId,
      title,
      description: args.description ? sanitizeMessage(args.description) : undefined,
      spotCount: args.spotCount,
      priceCents: args.priceCents,
      depositCents: args.depositCents,
      experienceLevel: args.experienceLevel,
      stintNotes: args.stintNotes ? sanitizeShortText(args.stintNotes) : undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "seat_offering",
      entityId: offeringId,
      action: "create",
      userId: identity.subject,
      newState: {
        teamCarId: args.teamCarId,
        spotCount: args.spotCount,
        priceCents: args.priceCents,
        depositCents: args.depositCents,
      },
    })

    return offeringId
  },
})

export const update = mutation({
  args: {
    offeringId: v.id("seatOfferings"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    spotCount: v.optional(v.number()),
    priceCents: v.optional(v.number()),
    depositCents: v.optional(v.number()),
    experienceLevel: v.optional(experienceLevelValidator),
    stintNotes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const offering = await ctx.db.get(args.offeringId)
    if (!offering) {
      throwError(ErrorCode.NOT_FOUND, "Seat offering not found")
    }
    await requireTeamManager(ctx, offering.teamId, identity.subject)

    await rateLimiter.limit(ctx, "updateVehicle", {
      key: identity.subject,
      throws: true,
    })

    const priceCents = args.priceCents ?? offering.priceCents
    const depositCents = args.depositCents ?? offering.depositCents
    assertOfferingPrices(priceCents, depositCents)

    if (args.spotCount !== undefined) {
      assertSpotCount(args.spotCount)
      const held = await countHeldSpots(ctx, args.offeringId)
      if (args.spotCount < held) {
        throwError(ErrorCode.CONFLICT, `Cannot reduce spots below ${held} currently held seat(s)`)
      }
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (args.title !== undefined) {
      const title = sanitizeShortText(args.title)
      if (!title) throwError(ErrorCode.INVALID_INPUT, "Seat offering title is required")
      patch.title = title
    }
    if (args.description !== undefined) {
      patch.description = args.description ? sanitizeMessage(args.description) : undefined
    }
    if (args.spotCount !== undefined) {
      patch.spotCount = args.spotCount
    }
    if (args.priceCents !== undefined) {
      patch.priceCents = args.priceCents
    }
    if (args.depositCents !== undefined) {
      patch.depositCents = args.depositCents
    }
    if (args.experienceLevel !== undefined) {
      patch.experienceLevel = args.experienceLevel
    }
    if (args.stintNotes !== undefined) {
      patch.stintNotes = args.stintNotes ? sanitizeShortText(args.stintNotes) : undefined
    }
    if (args.isActive !== undefined) {
      patch.isActive = args.isActive
    }

    await ctx.db.patch(args.offeringId, patch)

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "seat_offering",
      entityId: args.offeringId,
      action: "update",
      userId: identity.subject,
      previousState: {
        spotCount: offering.spotCount,
        priceCents: offering.priceCents,
        isActive: offering.isActive,
      },
      newState: patch,
    })

    return args.offeringId
  },
})

async function enrichOffering(ctx: any, offering: any) {
  const [teamCar, team, event, inventory] = await Promise.all([
    ctx.db.get(offering.teamCarId),
    ctx.db.get(offering.teamId),
    ctx.db.get(offering.raceEventId),
    getOfferingInventory(ctx, offering),
  ])
  return {
    ...omitHostUserId(offering),
    teamCar: teamCar ? omitHostUserId(teamCar) : null,
    team: toPublicTeamListing(team),
    event,
    inventory,
  }
}

export const getById = query({
  args: { offeringId: v.id("seatOfferings") },
  handler: async (ctx, args) => {
    const offering = await ctx.db.get(args.offeringId)
    if (!offering) return null
    return await enrichOffering(ctx, offering)
  },
})

export const getAvailability = query({
  args: { offeringId: v.id("seatOfferings") },
  handler: async (ctx, args) => {
    const offering = await ctx.db.get(args.offeringId)
    if (!offering) return null
    return await getOfferingInventory(ctx, offering)
  },
})

export const listByEvent = query({
  args: { raceEventId: v.id("raceEvents") },
  handler: async (ctx, args) => {
    const offerings = await ctx.db
      .query("seatOfferings")
      .withIndex("by_event_active", (q) =>
        q.eq("raceEventId", args.raceEventId).eq("isActive", true)
      )
      .collect()
    return await Promise.all(offerings.map((offering) => enrichOffering(ctx, offering)))
  },
})

export const listByTeamCar = query({
  args: { teamCarId: v.id("teamCars") },
  handler: async (ctx, args) => {
    const offerings = await ctx.db
      .query("seatOfferings")
      .withIndex("by_team_car", (q) => q.eq("teamCarId", args.teamCarId))
      .collect()
    return await Promise.all(offerings.map((offering) => enrichOffering(ctx, offering)))
  },
})

export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const offerings = await ctx.db
      .query("seatOfferings")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()
    return await Promise.all(offerings.map((offering) => enrichOffering(ctx, offering)))
  },
})
