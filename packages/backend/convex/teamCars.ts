import { v } from "convex/values"
import { internal } from "./_generated/api"
import { mutation, query } from "./_generated/server"
import { ErrorCode, throwError } from "./errors"
import { rateLimiter } from "./rateLimiter"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"
import {
  assertOfferingPrices,
  assertSpotCount,
  requireIdentity,
  requireTeamManager,
} from "./seatHelpers"

const experienceLevelValidator = v.union(
  v.literal("beginner"),
  v.literal("intermediate"),
  v.literal("advanced"),
  v.literal("professional")
)

const offeringArgs = {
  title: v.string(),
  description: v.optional(v.string()),
  spotCount: v.number(),
  priceCents: v.number(),
  depositCents: v.number(),
  experienceLevel: v.optional(experienceLevelValidator),
  stintNotes: v.optional(v.string()),
}

async function requireActiveEventAndTeam(ctx: any, teamId: any, raceEventId: any, userId: string) {
  const { team } = await requireTeamManager(ctx, teamId, userId)
  if (!team.isActive) {
    throwError(ErrorCode.INVALID_STATUS, "Team is not active")
  }

  const event = await ctx.db.get(raceEventId)
  if (!event) {
    throwError(ErrorCode.NOT_FOUND, "Race event not found")
  }
  if (!event.isActive) {
    throwError(ErrorCode.INVALID_STATUS, "Cannot enter an inactive event")
  }

  const series = await ctx.db.get(event.seriesId)
  if (!series?.isActive) {
    throwError(ErrorCode.INVALID_STATUS, "Race series is not active")
  }

  return { team, event, series }
}

export const create = mutation({
  args: {
    teamId: v.id("teams"),
    raceEventId: v.id("raceEvents"),
    carNumber: v.optional(v.string()),
    carClass: v.optional(v.string()),
    make: v.string(),
    model: v.string(),
    year: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await rateLimiter.limit(ctx, "createVehicle", {
      key: identity.subject,
      throws: true,
    })

    const { team } = await requireActiveEventAndTeam(
      ctx,
      args.teamId,
      args.raceEventId,
      identity.subject
    )

    const make = sanitizeShortText(args.make)
    const model = sanitizeShortText(args.model)
    if (!(make && model)) {
      throwError(ErrorCode.INVALID_INPUT, "Make and model are required")
    }

    const now = Date.now()
    const teamCarId = await ctx.db.insert("teamCars", {
      teamId: args.teamId,
      raceEventId: args.raceEventId,
      hostUserId: team.ownerId,
      carNumber: args.carNumber ? sanitizeShortText(args.carNumber) : undefined,
      carClass: args.carClass ? sanitizeShortText(args.carClass) : undefined,
      make,
      model,
      year: args.year,
      description: args.description ? sanitizeMessage(args.description) : undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "team_car",
      entityId: teamCarId,
      action: "create",
      userId: identity.subject,
      newState: { teamId: args.teamId, raceEventId: args.raceEventId, make, model },
    })

    return teamCarId
  },
})

export const createWithOffering = mutation({
  args: {
    teamId: v.id("teams"),
    raceEventId: v.id("raceEvents"),
    carNumber: v.optional(v.string()),
    carClass: v.optional(v.string()),
    make: v.string(),
    model: v.string(),
    year: v.optional(v.number()),
    description: v.optional(v.string()),
    offering: v.object(offeringArgs),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    await rateLimiter.limit(ctx, "createVehicle", {
      key: identity.subject,
      throws: true,
    })

    const { team } = await requireActiveEventAndTeam(
      ctx,
      args.teamId,
      args.raceEventId,
      identity.subject
    )

    const make = sanitizeShortText(args.make)
    const model = sanitizeShortText(args.model)
    if (!(make && model)) {
      throwError(ErrorCode.INVALID_INPUT, "Make and model are required")
    }

    const title = sanitizeShortText(args.offering.title)
    if (!title) {
      throwError(ErrorCode.INVALID_INPUT, "Seat offering title is required")
    }
    assertSpotCount(args.offering.spotCount)
    assertOfferingPrices(args.offering.priceCents, args.offering.depositCents)

    const now = Date.now()
    const teamCarId = await ctx.db.insert("teamCars", {
      teamId: args.teamId,
      raceEventId: args.raceEventId,
      hostUserId: team.ownerId,
      carNumber: args.carNumber ? sanitizeShortText(args.carNumber) : undefined,
      carClass: args.carClass ? sanitizeShortText(args.carClass) : undefined,
      make,
      model,
      year: args.year,
      description: args.description ? sanitizeMessage(args.description) : undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    const offeringId = await ctx.db.insert("seatOfferings", {
      teamCarId,
      raceEventId: args.raceEventId,
      teamId: args.teamId,
      hostUserId: team.ownerId,
      title,
      description: args.offering.description
        ? sanitizeMessage(args.offering.description)
        : undefined,
      spotCount: args.offering.spotCount,
      priceCents: args.offering.priceCents,
      depositCents: args.offering.depositCents,
      experienceLevel: args.offering.experienceLevel,
      stintNotes: args.offering.stintNotes
        ? sanitizeShortText(args.offering.stintNotes)
        : undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "team_car",
      entityId: teamCarId,
      action: "create_with_offering",
      userId: identity.subject,
      newState: { teamId: args.teamId, raceEventId: args.raceEventId, offeringId },
    })

    return { teamCarId, offeringId }
  },
})

export const update = mutation({
  args: {
    teamCarId: v.id("teamCars"),
    carNumber: v.optional(v.string()),
    carClass: v.optional(v.string()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    year: v.optional(v.number()),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const teamCar = await ctx.db.get(args.teamCarId)
    if (!teamCar) {
      throwError(ErrorCode.NOT_FOUND, "Team car not found")
    }
    await requireTeamManager(ctx, teamCar.teamId, identity.subject)

    await rateLimiter.limit(ctx, "updateVehicle", {
      key: identity.subject,
      throws: true,
    })

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (args.carNumber !== undefined) {
      patch.carNumber = args.carNumber ? sanitizeShortText(args.carNumber) : undefined
    }
    if (args.carClass !== undefined) {
      patch.carClass = args.carClass ? sanitizeShortText(args.carClass) : undefined
    }
    if (args.make !== undefined) {
      const make = sanitizeShortText(args.make)
      if (!make) throwError(ErrorCode.INVALID_INPUT, "Make is required")
      patch.make = make
    }
    if (args.model !== undefined) {
      const model = sanitizeShortText(args.model)
      if (!model) throwError(ErrorCode.INVALID_INPUT, "Model is required")
      patch.model = model
    }
    if (args.year !== undefined) {
      patch.year = args.year
    }
    if (args.description !== undefined) {
      patch.description = args.description ? sanitizeMessage(args.description) : undefined
    }
    if (args.isActive !== undefined) {
      patch.isActive = args.isActive
    }

    await ctx.db.patch(args.teamCarId, patch)

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "team_car",
      entityId: args.teamCarId,
      action: "update",
      userId: identity.subject,
      previousState: { isActive: teamCar.isActive },
      newState: patch,
    })

    return args.teamCarId
  },
})

async function enrichTeamCar(ctx: any, teamCar: any) {
  const [team, event] = await Promise.all([
    ctx.db.get(teamCar.teamId),
    ctx.db.get(teamCar.raceEventId),
  ])
  return { ...teamCar, team, event }
}

export const getById = query({
  args: { teamCarId: v.id("teamCars") },
  handler: async (ctx, args) => {
    const teamCar = await ctx.db.get(args.teamCarId)
    if (!teamCar) return null
    return await enrichTeamCar(ctx, teamCar)
  },
})

export const listByEvent = query({
  args: { raceEventId: v.id("raceEvents") },
  handler: async (ctx, args) => {
    const cars = await ctx.db
      .query("teamCars")
      .withIndex("by_event_active", (q) =>
        q.eq("raceEventId", args.raceEventId).eq("isActive", true)
      )
      .collect()
    return await Promise.all(cars.map((car) => enrichTeamCar(ctx, car)))
  },
})

export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const cars = await ctx.db
      .query("teamCars")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()
    return await Promise.all(cars.map((car) => enrichTeamCar(ctx, car)))
  },
})
