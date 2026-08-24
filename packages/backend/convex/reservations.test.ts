// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"

vi.mock("./rateLimiter", () => ({
  rateLimiter: { limit: async () => ({ ok: true, retryAfter: 0 }) },
}))

const modules = (
  import.meta as unknown as {
    glob: (g: string) => Record<string, () => Promise<unknown>>
  }
).glob("./**/*.ts")

const INVALID_DATE_RANGE = /INVALID_DATE_RANGE/
const OWNER = "owner_1"
const RENTER_A = "renter_a"
const RENTER_B = "renter_b"

async function seedVehicle(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const trackId = await ctx.db.insert("tracks", {
      name: "Laguna Seca",
      location: "Monterey, CA",
      isActive: true,
    })
    const vehicleId = await ctx.db.insert("vehicles", {
      ownerId: OWNER,
      trackId,
      make: "Porsche",
      model: "911 GT3",
      year: 2022,
      dailyRate: 15000,
      description: "Track car",
      amenities: [],
      addOns: [],
      isActive: true,
      isApproved: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return vehicleId as Id<"vehicles">
  })
}

describe("reservations.create — start date + duration", () => {
  it("stores inclusive occupancy for a 2-day rental", async () => {
    const t = convexTest(schema, modules)
    const vehicleId = await seedVehicle(t)
    const asRenter = t.withIdentity({ subject: RENTER_A })

    const reservationId = await asRenter.mutation(api.reservations.create, {
      vehicleId,
      startDate: "2030-06-15",
      durationDays: 2,
    })

    const reservation = await t.run((ctx) => ctx.db.get(reservationId))
    expect(reservation?.startDate).toBe("2030-06-15")
    expect(reservation?.endDate).toBe("2030-06-16")
    expect(reservation?.totalDays).toBe(2)
    expect(reservation?.totalAmount).toBe(30000)
    expect(reservation?.status).toBe("pending")
  })

  it("rejects a rental longer than 3 days", async () => {
    const t = convexTest(schema, modules)
    const vehicleId = await seedVehicle(t)
    const asRenter = t.withIdentity({ subject: RENTER_A })

    await expect(
      asRenter.mutation(api.reservations.create, {
        vehicleId,
        startDate: "2030-06-15",
        durationDays: 4,
      })
    ).rejects.toThrow(INVALID_DATE_RANGE)
  })

  it("allows a second request that overlaps a pending request", async () => {
    const t = convexTest(schema, modules)
    const vehicleId = await seedVehicle(t)

    const firstId = await t.withIdentity({ subject: RENTER_A }).mutation(api.reservations.create, {
      vehicleId,
      startDate: "2030-07-10",
      durationDays: 2,
    })
    const secondId = await t.withIdentity({ subject: RENTER_B }).mutation(api.reservations.create, {
      vehicleId,
      startDate: "2030-07-10",
      durationDays: 3,
    })

    const first = await t.run((ctx) => ctx.db.get(firstId))
    const second = await t.run((ctx) => ctx.db.get(secondId))
    expect(first?.status).toBe("pending")
    expect(second?.status).toBe("pending")
    expect(second?.endDate).toBe("2030-07-12")
  })

  it("allows a request that overlaps a confirmed booking", async () => {
    const t = convexTest(schema, modules)
    const vehicleId = await seedVehicle(t)

    const confirmedId = await t
      .withIdentity({ subject: RENTER_A })
      .mutation(api.reservations.create, {
        vehicleId,
        startDate: "2030-08-01",
        durationDays: 1,
      })
    await t.run(async (ctx) => {
      await ctx.db.patch(confirmedId, { status: "confirmed" })
    })

    const overlappingId = await t
      .withIdentity({ subject: RENTER_B })
      .mutation(api.reservations.create, {
        vehicleId,
        startDate: "2030-08-01",
        durationDays: 2,
      })

    const overlapping = await t.run((ctx) => ctx.db.get(overlappingId))
    expect(overlapping?.status).toBe("pending")
    expect(overlapping?.totalDays).toBe(2)
  })

  it("lists overlapping activity without hiding either request", async () => {
    const t = convexTest(schema, modules)
    const vehicleId = await seedVehicle(t)

    await t.withIdentity({ subject: RENTER_A }).mutation(api.reservations.create, {
      vehicleId,
      startDate: "2030-09-01",
      durationDays: 1,
    })
    await t.withIdentity({ subject: RENTER_B }).mutation(api.reservations.create, {
      vehicleId,
      startDate: "2030-09-01",
      durationDays: 1,
    })

    const active = await t.query(api.reservations.listActiveForVehicle, { vehicleId })
    expect(active).toHaveLength(2)
    expect(active.every((r) => r.status === "pending")).toBe(true)
  })
})
