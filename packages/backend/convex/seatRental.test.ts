// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
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

import { SEAT_REQUEST_INTRO } from "./seatHelpers"

const OWNER = "team_owner_1"
const DRIVER_A = "driver_a"
const DRIVER_B = "driver_b"
const DRIVER_C = "driver_c"
const STRANGER = "stranger_1"
const ADMIN = "admin_1"

const REQUEST_FIELDS = {
  availableStartDate: "2031-03-14",
  availableEndDate: "2031-03-16",
  driverExperience: "intermediate" as const,
  budgetBand: "$10k–$20k",
  seriesClass: "GT4",
  whyBuying: "Looking for a Sebring co-drive",
}

function requestArgs(
  offeringId: Id<"seatOfferings">,
  extra: Partial<typeof REQUEST_FIELDS> & { note?: string } = {}
) {
  return { offeringId, ...REQUEST_FIELDS, ...extra }
}

function adminIdentity() {
  return { subject: ADMIN, publicMetadata: { role: "admin" }, orgRole: "admin" }
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  externalId: string,
  name: string,
  contact?: { email?: string; phone?: string }
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      externalId,
      name,
      email: contact?.email,
      phone: contact?.phone,
    })
  )
}

async function seedTeam(t: ReturnType<typeof convexTest>, ownerId = OWNER) {
  return await t.run(async (ctx) =>
    ctx.db.insert("teams", {
      ownerId,
      name: "Gridlock Racing",
      description: "Endurance team",
      location: "Austin, TX",
      specialties: ["Endurance"],
      availableSeats: 4,
      requirements: [],
      contactInfo: {
        phone: "555-0199",
        email: "team@secret.example",
      },
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
}

async function seedCatalog(t: ReturnType<typeof convexTest>, teamId: Id<"teams">) {
  const asOwner = t.withIdentity({ subject: OWNER })
  const seriesId = await asOwner.mutation(api.raceSeries.create, {
    name: "World Racing League",
    teamId,
  })
  const eventId = await asOwner.mutation(api.raceEvents.create, {
    seriesId,
    teamId,
    name: "Sebring 12 Hours",
    startDate: "2031-03-14",
    endDate: "2031-03-16",
    trackName: "Sebring International Raceway",
    trackLocation: "Sebring, FL",
  })
  return { seriesId, eventId }
}

async function seedOffering(
  t: ReturnType<typeof convexTest>,
  teamId: Id<"teams">,
  eventId: Id<"raceEvents">,
  spotCount = 1
) {
  const asOwner = t.withIdentity({ subject: OWNER })
  const created = await asOwner.mutation(api.teamCars.createWithOffering, {
    teamId,
    raceEventId: eventId,
    make: "Porsche",
    model: "911 GT3 Cup",
    year: 2022,
    carNumber: "17",
    carClass: "GT4",
    offering: {
      title: "Amateur endurance seat",
      spotCount,
      priceCents: 1500000,
      depositCents: 500000,
      experienceLevel: "intermediate",
    },
  })
  return created
}

describe("race series and events", () => {
  it("lets a team create a series and event, and lists upcoming events", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { seriesId, eventId } = await seedCatalog(t, teamId)

    const series = await t.query(api.raceSeries.getById, { seriesId })
    expect(series?.name).toBe("World Racing League")
    expect(series?.createdByTeamId).toBe(teamId)

    const event = await t.query(api.raceEvents.getById, { eventId })
    expect(event?.name).toBe("Sebring 12 Hours")
    expect(event?.series?._id).toBe(seriesId)

    const upcoming = await t.query(api.raceEvents.listUpcoming, { fromDate: "2031-01-01" })
    expect(upcoming.some((e) => e._id === eventId)).toBe(true)
  })

  it("lets an admin create a catalog series without a team", async () => {
    const t = convexTest(schema, modules)
    const asAdmin = t.withIdentity(adminIdentity())
    const seriesId = await asAdmin.mutation(api.raceSeries.create, {
      name: "IMSA WeatherTech",
    })
    const series = await t.query(api.raceSeries.getById, { seriesId })
    expect(series?.name).toBe("IMSA WeatherTech")
    expect(series?.createdByTeamId).toBeUndefined()
  })

  it("forbids a non-member from creating a series for a team", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const asStranger = t.withIdentity({ subject: STRANGER })
    await expect(
      asStranger.mutation(api.raceSeries.create, { name: "Hijack Series", teamId })
    ).rejects.toThrow()
  })
})

describe("team cars and seat offerings", () => {
  it("creates a team car with an offering and reports remaining spots server-side", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 2)

    const availability = await t.query(api.seatOfferings.getAvailability, { offeringId })
    expect(availability).toEqual({
      spotCount: 2,
      held: 0,
      waitlisted: 0,
      remaining: 2,
    })
  })

  it("rejects reducing spot count below currently held seats", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 2)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const asB = t.withIdentity({ subject: DRIVER_B })
    await asA.mutation(api.seatBookings.request, requestArgs(offeringId))
    await asB.mutation(api.seatBookings.request, requestArgs(offeringId))

    const asOwner = t.withIdentity({ subject: OWNER })
    await expect(
      asOwner.mutation(api.seatOfferings.update, { offeringId, spotCount: 1 })
    ).rejects.toThrow("CONFLICT")
  })
})

describe("seat bookings — request / waitlist / approve", () => {
  it("creates a pending booking and waitlists overflow without double-booking", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const first = await asA.mutation(
      api.seatBookings.request,
      requestArgs(offeringId, { note: "I have a NASA TT4 license" })
    )
    expect(first.status).toBe("pending")
    expect(first.conversationId).toBeTruthy()

    const asB = t.withIdentity({ subject: DRIVER_B })
    const second = await asB.mutation(api.seatBookings.request, requestArgs(offeringId))
    expect(second.status).toBe("waitlisted")
    expect(second.conversationId).toBeTruthy()

    await t.finishInProgressScheduledFunctions()

    const availability = await t.query(api.seatOfferings.getAvailability, { offeringId })
    expect(availability?.held).toBe(1)
    expect(availability?.waitlisted).toBe(1)
    expect(availability?.remaining).toBe(0)

    const asOwner = t.withIdentity({ subject: OWNER })
    await expect(
      asOwner.mutation(api.seatBookings.approve, { bookingId: second.bookingId })
    ).rejects.toThrow()
  })

  it("rejects booking a seat on your own team car", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asOwner = t.withIdentity({ subject: OWNER })
    await expect(
      asOwner.mutation(api.seatBookings.request, requestArgs(offeringId))
    ).rejects.toThrow()
  })

  it("rejects a duplicate open request from the same driver", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 2)

    const asA = t.withIdentity({ subject: DRIVER_A })
    await asA.mutation(api.seatBookings.request, requestArgs(offeringId))
    await expect(asA.mutation(api.seatBookings.request, requestArgs(offeringId))).rejects.toThrow()
  })

  it("requires team approval before a deposit can confirm the seat", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const { bookingId } = await asA.mutation(api.seatBookings.request, requestArgs(offeringId))

    await expect(
      t.mutation(internal.seatPayments.handleDepositSuccess, {
        bookingId,
        stripePaymentIntentId: "pi_before_approval",
      })
    ).rejects.toThrow("INVALID_STATUS")

    const asOwner = t.withIdentity({ subject: OWNER })
    await asOwner.mutation(api.seatBookings.approve, { bookingId })
    await t.finishInProgressScheduledFunctions()

    const approved = await t.run((ctx) => ctx.db.get(bookingId))
    expect(approved?.status).toBe("approved")

    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_deposit",
    })
    await t.finishInProgressScheduledFunctions()
    const deposited = await t.run((ctx) => ctx.db.get(bookingId))
    expect(deposited?.status).toBe("deposit_paid")
    expect(deposited?.depositPaymentStatus).toBe("paid")

    await t.mutation(internal.seatPayments.handleBalanceSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_balance",
    })
    await t.finishInProgressScheduledFunctions()
    const confirmed = await t.run((ctx) => ctx.db.get(bookingId))
    expect(confirmed?.status).toBe("confirmed")
  })

  it("promotes the oldest waitlisted driver to pending when a held spot is released", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const first = await asA.mutation(api.seatBookings.request, requestArgs(offeringId))
    const asB = t.withIdentity({ subject: DRIVER_B })
    const second = await asB.mutation(api.seatBookings.request, requestArgs(offeringId))
    const asC = t.withIdentity({ subject: DRIVER_C })
    const third = await asC.mutation(api.seatBookings.request, requestArgs(offeringId))

    expect(second.status).toBe("waitlisted")
    expect(third.status).toBe("waitlisted")

    const asOwner = t.withIdentity({ subject: OWNER })
    await asOwner.mutation(api.seatBookings.decline, { bookingId: first.bookingId })
    await t.finishInProgressScheduledFunctions()

    const promoted = await t.run((ctx) => ctx.db.get(second.bookingId))
    const stillWaitlisted = await t.run((ctx) => ctx.db.get(third.bookingId))
    expect(promoted?.status).toBe("pending")
    expect(stillWaitlisted?.status).toBe("waitlisted")

    await asOwner.mutation(api.seatBookings.approve, { bookingId: second.bookingId })
    const approved = await t.run((ctx) => ctx.db.get(second.bookingId))
    expect(approved?.status).toBe("approved")

    const availability = await t.query(api.seatOfferings.getAvailability, { offeringId })
    expect(availability?.held).toBe(1)
    expect(availability?.remaining).toBe(0)
  })

  it("forbids a non-team member from approving", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const { bookingId } = await asA.mutation(api.seatBookings.request, requestArgs(offeringId))

    await expect(asA.mutation(api.seatBookings.approve, { bookingId })).rejects.toThrow()
  })

  it("confirms immediately when deposit covers the full price", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const asOwner = t.withIdentity({ subject: OWNER })
    const { offeringId } = await asOwner.mutation(api.teamCars.createWithOffering, {
      teamId,
      raceEventId: eventId,
      make: "Ligier",
      model: "JS P320",
      offering: {
        title: "Pro seat",
        spotCount: 1,
        priceCents: 800000,
        depositCents: 800000,
      },
    })

    const asA = t.withIdentity({ subject: DRIVER_A })
    const { bookingId } = await asA.mutation(api.seatBookings.request, requestArgs(offeringId))
    await asOwner.mutation(api.seatBookings.approve, { bookingId })
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_full_deposit",
    })
    await t.finishInProgressScheduledFunctions()

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("confirmed")
    expect(booking?.balancePaymentStatus).toBe("paid")
  })

  it("expires unpaid approved bookings and frees the spot for the waitlist", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const first = await asA.mutation(api.seatBookings.request, requestArgs(offeringId))
    const asB = t.withIdentity({ subject: DRIVER_B })
    const second = await asB.mutation(api.seatBookings.request, requestArgs(offeringId))

    const asOwner = t.withIdentity({ subject: OWNER })
    await asOwner.mutation(api.seatBookings.approve, { bookingId: first.bookingId })

    const twoDaysAgo = Date.now() - 49 * 60 * 60 * 1000
    await t.run(async (ctx) => {
      await ctx.db.patch(first.bookingId, { approvedAt: twoDaysAgo })
    })

    await t.mutation(internal.seatBookings.expireApprovedUnpaidBookings, {})
    await t.finishInProgressScheduledFunctions()

    const expired = await t.run((ctx) => ctx.db.get(first.bookingId))
    const promoted = await t.run((ctx) => ctx.db.get(second.bookingId))
    expect(expired?.status).toBe("expired")
    expect(promoted?.status).toBe("pending")
  })

  it("opens an in-app seat conversation immediately and keeps contact off public listings", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    await seedUser(t, OWNER, "Alex Host", {
      email: "alex@secret.example",
      phone: "555-0100",
    })
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)

    const asA = t.withIdentity({ subject: DRIVER_A })
    const { bookingId, conversationId, status } = await asA.mutation(
      api.seatBookings.request,
      requestArgs(offeringId, { note: "Need a co-driver for Sebring" })
    )
    expect(status).toBe("pending")
    expect(conversationId).toBeTruthy()

    const conversation = await t.run(async (ctx) => ctx.db.get(conversationId))
    expect(conversation?.conversationType).toBe("seat")
    expect(conversation?.seatBookingId).toBe(bookingId)
    expect(conversation?.isActive).toBe(true)
    expect(conversation?.renterId).toBe(DRIVER_A)
    expect(conversation?.ownerId).toBe(OWNER)
    expect(conversation?.lastMessageText).toContain(SEAT_REQUEST_INTRO)
    expect(conversation?.lastMessageText).toContain("GT4")
    expect(conversation?.lastMessageText).toContain("Need a co-driver for Sebring")

    const messages = await t.run(async (ctx) => ctx.db.query("messages").collect())
    expect(messages).toHaveLength(1)
    expect(messages[0]?.conversationId).toBe(conversationId)

    const booking = await asA.query(api.seatBookings.getById, { bookingId })
    expect(booking).toBeTruthy()
    expect((booking as { conversationId?: string } | null)?.conversationId).toBe(conversationId)
    expect((booking as { hostUserId?: string } | null)?.hostUserId).toBeUndefined()
    expect(
      (booking as { host?: { name?: string; email?: string; phone?: string } } | null)?.host?.name
    ).toBe("Alex Host")
    expect((booking as { host?: { email?: string } } | null)?.host?.email).toBeUndefined()
    expect((booking as { host?: { phone?: string } } | null)?.host?.phone).toBeUndefined()
    expect((booking as { team?: { name?: string } } | null)?.team?.name).toBe("Gridlock Racing")
    expect(
      (booking as { team?: { contactInfo?: unknown } } | null)?.team?.contactInfo
    ).toBeUndefined()

    const thread = await asA.query(api.conversations.getById, {
      conversationId,
      userId: DRIVER_A,
    })
    expect(thread.seatBooking?._id).toBe(String(bookingId))
    expect(thread.team?.name).toBe("Gridlock Racing")
    expect(
      (thread.team as { contactInfo?: unknown } | null | undefined)?.contactInfo
    ).toBeUndefined()
    expect((thread.owner as { email?: string } | null | undefined)?.email).toBeUndefined()
    expect((thread.owner as { phone?: string } | null | undefined)?.phone).toBeUndefined()
    expect((thread.owner as { name?: string } | null | undefined)?.name).toBe("Alex Host")

    const offering = await t.query(api.seatOfferings.getById, { offeringId })
    expect((offering as { hostUserId?: string } | null)?.hostUserId).toBeUndefined()
    expect((offering as { host?: unknown } | null)?.host).toBeUndefined()
    expect(
      (offering as { team?: { contactInfo?: unknown; ownerId?: string } } | null)?.team?.contactInfo
    ).toBeUndefined()
    expect((offering as { team?: { ownerId?: string } } | null)?.team?.ownerId).toBeUndefined()
    expect((offering as { team?: { name?: string } } | null)?.team?.name).toBe("Gridlock Racing")
  })

  it("requires structured request fields and dates that overlap the event", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, 1)
    const asA = t.withIdentity({ subject: DRIVER_A })

    await expect(
      asA.mutation(api.seatBookings.request, requestArgs(offeringId, { whyBuying: "   " }))
    ).rejects.toThrow("INVALID_INPUT")

    await expect(
      asA.mutation(api.seatBookings.request, requestArgs(offeringId, { budgetBand: "   " }))
    ).rejects.toThrow("INVALID_INPUT")

    await expect(
      asA.mutation(api.seatBookings.request, requestArgs(offeringId, { seriesClass: "   " }))
    ).rejects.toThrow("INVALID_INPUT")

    await expect(
      asA.mutation(
        api.seatBookings.request,
        requestArgs(offeringId, {
          availableStartDate: "2030-01-01",
          availableEndDate: "2030-01-02",
        })
      )
    ).rejects.toThrow("INVALID_DATE_RANGE")
  })
})
