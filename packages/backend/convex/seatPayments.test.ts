// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { parseSeatPaymentMetadata } from "./seatPayments"

type CheckoutParams = {
  metadata?: { phase?: string }
  payment_intent_data?: {
    application_fee_amount?: number
    transfer_data?: { destination?: string }
  }
}

type RefundParams = {
  payment_intent?: string
  amount?: number
  reverse_transfer?: boolean
  refund_application_fee?: boolean
}

type ConnectAccount = {
  id: string
  details_submitted: boolean
  charges_enabled: boolean
  capabilities: Record<string, string>
}

const { refundsCreate, checkoutSessionsCreate, customersCreate, accountsRetrieve } = vi.hoisted(
  () => ({
    refundsCreate: vi.fn(
      async (_params?: RefundParams, _options?: { idempotencyKey?: string }) => ({
        id: "re_test_123",
      })
    ),
    checkoutSessionsCreate: vi.fn(async (params?: CheckoutParams) => ({
      id: `cs_${params?.metadata?.phase ?? "seat"}`,
      url: "https://checkout.stripe.test/session",
      payment_intent: `pi_${params?.metadata?.phase ?? "seat"}`,
    })),
    customersCreate: vi.fn(async () => ({ id: "cus_created" })),
    accountsRetrieve: vi.fn(
      async (): Promise<ConnectAccount> => ({
        id: "acct_host",
        details_submitted: true,
        charges_enabled: true,
        capabilities: { transfers: "active" },
      })
    ),
  })
)

vi.mock("stripe", () => ({
  default: class {
    refunds = { create: refundsCreate }
    checkout = { sessions: { create: checkoutSessionsCreate } }
    customers = { create: customersCreate }
    accounts = { retrieve: accountsRetrieve }
  },
}))

vi.mock("./rateLimiter", () => ({
  rateLimiter: { limit: async () => ({ ok: true, retryAfter: 0 }) },
}))

process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
process.env.WEB_URL = "https://renegaderace.test"

const modules = (
  import.meta as unknown as {
    glob: (g: string) => Record<string, () => Promise<unknown>>
  }
).glob("./**/*.ts")

const OWNER = "team_owner_1"
const DRIVER_A = "driver_a"
const DRIVER_B = "driver_b"
const STRANGER = "stranger_1"

const REQUEST_FIELDS = {
  availableStartDate: "2031-03-14",
  availableEndDate: "2031-03-16",
  driverExperience: "intermediate" as const,
  budgetBand: "$10k–$20k",
  seriesClass: "GT4",
  whyBuying: "Looking for a Sebring co-drive",
}

function requestArgs(offeringId: Id<"seatOfferings">) {
  return { offeringId, ...REQUEST_FIELDS }
}

function readyConnectAccount(): ConnectAccount {
  return {
    id: "acct_host",
    details_submitted: true,
    charges_enabled: true,
    capabilities: { transfers: "active" },
  }
}

beforeEach(() => {
  refundsCreate.mockClear()
  customersCreate.mockClear()
  checkoutSessionsCreate.mockClear()
  accountsRetrieve.mockReset()
  accountsRetrieve.mockResolvedValue(readyConnectAccount())
  checkoutSessionsCreate.mockImplementation(async (params?: CheckoutParams) => ({
    id: `cs_${params?.metadata?.phase ?? "seat"}`,
    url: "https://checkout.stripe.test/session",
    payment_intent: `pi_${params?.metadata?.phase ?? "seat"}`,
  }))
})

async function seedUsers(
  t: ReturnType<typeof convexTest>,
  options: { hostAccountId?: string | null; driverCustomerId?: string | null } = {}
) {
  const hostAccountId = options.hostAccountId === undefined ? "acct_host" : options.hostAccountId
  const driverCustomerId =
    options.driverCustomerId === undefined ? "cus_driver_a" : options.driverCustomerId
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      externalId: OWNER,
      name: "Alex Host",
      ...(hostAccountId ? { stripeAccountId: hostAccountId } : {}),
    })
    await ctx.db.insert("users", {
      externalId: DRIVER_A,
      name: "Driver A",
      email: "driver-a@example.com",
      ...(driverCustomerId ? { stripeCustomerId: driverCustomerId } : {}),
    })
    await ctx.db.insert("users", {
      externalId: DRIVER_B,
      name: "Driver B",
    })
  })
}

async function seedTeam(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.insert("teams", {
      ownerId: OWNER,
      name: "Gridlock Racing",
      description: "Endurance team",
      location: "Austin, TX",
      specialties: ["Endurance"],
      availableSeats: 4,
      requirements: [],
      contactInfo: { phone: "555-0199", email: "team@example.com" },
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
    trackName: "Sebring",
    trackLocation: "Sebring, FL",
  })
  return { seriesId, eventId }
}

async function seedOffering(
  t: ReturnType<typeof convexTest>,
  teamId: Id<"teams">,
  eventId: Id<"raceEvents">,
  options: { spotCount?: number; priceCents?: number; depositCents?: number } = {}
) {
  const asOwner = t.withIdentity({ subject: OWNER })
  return await asOwner.mutation(api.teamCars.createWithOffering, {
    teamId,
    raceEventId: eventId,
    make: "Porsche",
    model: "911 GT3 Cup",
    year: 2022,
    offering: {
      title: "Amateur endurance seat",
      spotCount: options.spotCount ?? 1,
      priceCents: options.priceCents ?? 1_500_000,
      depositCents: options.depositCents ?? 500_000,
    },
  })
}

async function seedApprovedBooking(
  t: ReturnType<typeof convexTest>,
  options: { spotCount?: number; priceCents?: number; depositCents?: number } = {}
) {
  await seedUsers(t)
  const teamId = await seedTeam(t)
  const { eventId } = await seedCatalog(t, teamId)
  const { offeringId } = await seedOffering(t, teamId, eventId, options)
  const asDriver = t.withIdentity({ subject: DRIVER_A })
  const requested = await asDriver.mutation(api.seatBookings.request, requestArgs(offeringId))
  const asOwner = t.withIdentity({ subject: OWNER })
  await asOwner.mutation(api.seatBookings.approve, { bookingId: requested.bookingId })
  await t.finishInProgressScheduledFunctions()
  return { ...requested, offeringId, teamId, eventId }
}

async function insertActiveFee(
  t: ReturnType<typeof convexTest>,
  settings: {
    platformFeePercentage: number
    minimumPlatformFee: number
    maximumPlatformFee?: number
  }
) {
  await t.run(async (ctx) => {
    const active = (await ctx.db.query("platformSettings").collect()).filter((row) => row.isActive)
    for (const row of active) {
      await ctx.db.patch(row._id, { isActive: false, updatedAt: Date.now() })
    }
    await ctx.db.insert("platformSettings", {
      platformFeePercentage: settings.platformFeePercentage,
      minimumPlatformFee: settings.minimumPlatformFee,
      maximumPlatformFee: settings.maximumPlatformFee,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
}

describe("seat checkout", () => {
  it("starts a deposit Checkout for an approved booking and pays the snapshotted fee to the team", async () => {
    const t = convexTest(schema, modules)
    await insertActiveFee(t, { platformFeePercentage: 10, minimumPlatformFee: 0 })
    const { bookingId } = await seedApprovedBooking(t)
    // Live settings change after the request; the booking snapshot stays 10%.
    await insertActiveFee(t, { platformFeePercentage: 5, minimumPlatformFee: 0 })

    const asDriver = t.withIdentity({ subject: DRIVER_A, email: "driver-a@example.com" })
    const session = await asDriver.action(api.seatPayments.createDepositCheckoutSession, {
      bookingId,
    })

    expect(session.sessionId).toBe("cs_deposit")
    expect(session.url).toContain("checkout.stripe.test")
    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        payment_intent_data: expect.objectContaining({
          application_fee_amount: 50_000, // 10% of the $5,000 deposit, not the live 5%
          transfer_data: { destination: "acct_host" },
          metadata: expect.objectContaining({
            bookingType: "seat",
            phase: "deposit",
            seatBookingId: bookingId,
          }),
        }),
        metadata: expect.objectContaining({ bookingType: "seat", phase: "deposit" }),
      }),
      expect.objectContaining({ idempotencyKey: `cs_seat_deposit_${bookingId}` })
    )

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("approved")
    expect(booking?.depositPaymentStatus).toBe("pending")
    expect(booking?.stripeDepositCheckoutSessionId).toBe("cs_deposit")

    const routed = await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_deposit_1",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_deposit",
      metadata: {
        bookingType: "seat",
        phase: "deposit",
        seatBookingId: bookingId,
      },
    })
    expect(routed).toEqual({ routed: "seat", phase: "deposit" })
    await t.finishInProgressScheduledFunctions()

    const paid = await t.run((ctx) => ctx.db.get(bookingId))
    expect(paid?.status).toBe("deposit_paid")
    expect(paid?.depositPaymentStatus).toBe("paid")
    expect(paid?.stripeDepositPaymentIntentId).toBe("pi_deposit")
    expect(paid?.balancePaymentStatus).toBeUndefined()
  })

  it("clamps the snapshotted percentage to the active min and max fee", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(bookingId, { platformFeePercentage: 1 })
    })
    await insertActiveFee(t, { platformFeePercentage: 20, minimumPlatformFee: 8_000 })

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    await asDriver.action(api.seatPayments.createDepositCheckoutSession, { bookingId })
    expect(
      checkoutSessionsCreate.mock.calls[0]?.[0]?.payment_intent_data?.application_fee_amount
    ).toBe(8_000)

    checkoutSessionsCreate.mockClear()
    await t.run(async (ctx) => {
      await ctx.db.patch(bookingId, { platformFeePercentage: 40 })
    })
    await insertActiveFee(t, {
      platformFeePercentage: 1,
      minimumPlatformFee: 0,
      maximumPlatformFee: 3_000,
    })
    await asDriver.action(api.seatPayments.createDepositCheckoutSession, { bookingId })
    expect(
      checkoutSessionsCreate.mock.calls[0]?.[0]?.payment_intent_data?.application_fee_amount
    ).toBe(3_000)
  })

  it("confirms the booking when the balance Checkout is paid", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_deposit",
    })
    await t.finishInProgressScheduledFunctions()

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    const session = await asDriver.action(api.seatPayments.createBalanceCheckoutSession, {
      bookingId,
    })
    expect(session.sessionId).toBe("cs_balance")
    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent_data: expect.objectContaining({
          application_fee_amount: 50_000, // default 5% of the $10,000 balance
          transfer_data: { destination: "acct_host" },
          metadata: expect.objectContaining({ bookingType: "seat", phase: "balance" }),
        }),
      }),
      expect.objectContaining({ idempotencyKey: `cs_seat_balance_${bookingId}` })
    )

    await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_balance_1",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_balance",
      metadata: { bookingType: "seat", phase: "balance", seatBookingId: bookingId },
    })
    await t.finishInProgressScheduledFunctions()

    const confirmed = await t.run((ctx) => ctx.db.get(bookingId))
    expect(confirmed?.status).toBe("confirmed")
    expect(confirmed?.balancePaymentStatus).toBe("paid")
    expect(confirmed?.stripeBalancePaymentIntentId).toBe("pi_balance")
    expect(confirmed?.confirmedAt).toBeTruthy()
  })

  it("confirms a full-price deposit without opening a balance Checkout", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t, {
      priceCents: 800_000,
      depositCents: 800_000,
    })

    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_full",
    })
    await t.finishInProgressScheduledFunctions()

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("confirmed")
    expect(booking?.depositPaymentStatus).toBe("paid")
    expect(booking?.balancePaymentStatus).toBe("paid")
    expect(booking?.stripeBalanceCheckoutSessionId).toBeUndefined()
    expect(booking?.stripeBalancePaymentIntentId).toBeUndefined()

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    await expect(
      asDriver.action(api.seatPayments.createBalanceCheckoutSession, { bookingId })
    ).rejects.toThrow("INVALID_AMOUNT")
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })
})

describe("seat checkout gating", () => {
  it("rejects deposit Checkout unless the booking is approved and the caller is the driver", async () => {
    const t = convexTest(schema, modules)
    await seedUsers(t)
    const teamId = await seedTeam(t)
    const { eventId } = await seedCatalog(t, teamId)
    const { offeringId } = await seedOffering(t, teamId, eventId, { spotCount: 1 })

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    const pending = await asDriver.mutation(api.seatBookings.request, requestArgs(offeringId))
    const asOther = t.withIdentity({ subject: DRIVER_B })
    const waitlisted = await asOther.mutation(api.seatBookings.request, requestArgs(offeringId))
    await t.finishInProgressScheduledFunctions()

    await expect(
      asDriver.action(api.seatPayments.createDepositCheckoutSession, {
        bookingId: pending.bookingId,
      })
    ).rejects.toThrow("INVALID_STATUS")
    await expect(
      asOther.action(api.seatPayments.createDepositCheckoutSession, {
        bookingId: waitlisted.bookingId,
      })
    ).rejects.toThrow("INVALID_STATUS")

    const asOwner = t.withIdentity({ subject: OWNER })
    await asOwner.mutation(api.seatBookings.approve, { bookingId: pending.bookingId })
    await t.finishInProgressScheduledFunctions()

    await expect(
      asOwner.action(api.seatPayments.createDepositCheckoutSession, {
        bookingId: pending.bookingId,
      })
    ).rejects.toThrow("FORBIDDEN")
    await expect(
      t.withIdentity({ subject: STRANGER }).action(api.seatPayments.createDepositCheckoutSession, {
        bookingId: pending.bookingId,
      })
    ).rejects.toThrow("FORBIDDEN")
    await expect(
      t.action(api.seatPayments.createDepositCheckoutSession, { bookingId: pending.bookingId })
    ).rejects.toThrow("AUTH_REQUIRED")

    await asDriver.action(api.seatPayments.createDepositCheckoutSession, {
      bookingId: pending.bookingId,
    })
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId: pending.bookingId,
      stripePaymentIntentId: "pi_deposit",
    })
    await t.finishInProgressScheduledFunctions()
    await expect(
      asDriver.action(api.seatPayments.createDepositCheckoutSession, {
        bookingId: pending.bookingId,
      })
    ).rejects.toThrow("INVALID_STATUS")
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1)
  })

  it("rejects balance Checkout until the deposit is paid", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    const asDriver = t.withIdentity({ subject: DRIVER_A })
    await expect(
      asDriver.action(api.seatPayments.createBalanceCheckoutSession, { bookingId })
    ).rejects.toThrow("INVALID_STATUS")
    await expect(
      t.withIdentity({ subject: OWNER }).action(api.seatPayments.createBalanceCheckoutSession, {
        bookingId,
      })
    ).rejects.toThrow("FORBIDDEN")
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })

  it("requires a usable Stripe Connect account on the team owner", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    const asDriver = t.withIdentity({ subject: DRIVER_A })

    await t.run(async (ctx) => {
      const host = await ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", OWNER))
        .first()
      if (!host) throw new Error("missing host")
      await ctx.db.delete(host._id)
      await ctx.db.insert("users", { externalId: OWNER, name: "Alex Host" })
    })
    await expect(
      asDriver.action(api.seatPayments.createDepositCheckoutSession, { bookingId })
    ).rejects.toThrow("hasn't finished setting up payouts")

    await t.run(async (ctx) => {
      const host = await ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", OWNER))
        .first()
      if (!host) throw new Error("missing host")
      await ctx.db.patch(host._id, { stripeAccountId: "acct_host" })
    })

    accountsRetrieve.mockResolvedValueOnce({
      ...readyConnectAccount(),
      details_submitted: false,
    })
    await expect(
      asDriver.action(api.seatPayments.createDepositCheckoutSession, { bookingId })
    ).rejects.toThrow("isn't complete yet")

    accountsRetrieve.mockResolvedValueOnce({
      ...readyConnectAccount(),
      charges_enabled: false,
    })
    await expect(
      asDriver.action(api.seatPayments.createDepositCheckoutSession, { bookingId })
    ).rejects.toThrow("STRIPE_ACCOUNT_DISABLED")

    accountsRetrieve.mockResolvedValueOnce({
      ...readyConnectAccount(),
      capabilities: { transfers: "inactive", legacy_payments: "inactive" },
    })
    await expect(
      asDriver.action(api.seatPayments.createDepositCheckoutSession, { bookingId })
    ).rejects.toThrow("transfers not enabled")

    accountsRetrieve.mockResolvedValueOnce({
      ...readyConnectAccount(),
      capabilities: { legacy_payments: "active" },
    })
    const session = await asDriver.action(api.seatPayments.createDepositCheckoutSession, {
      bookingId,
    })
    expect(session.sessionId).toBe("cs_deposit")
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1)
  })
})

describe("seat payment webhooks", () => {
  it("is idempotent for a repeated success call and a replayed webhook event", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)

    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_deposit",
    })
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_deposit",
    })
    await t.finishInProgressScheduledFunctions()

    const paid = await t.run((ctx) => ctx.db.get(bookingId))
    expect(paid?.status).toBe("deposit_paid")

    const first = await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_replay",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_deposit_again",
      metadata: { bookingType: "seat", phase: "deposit", seatBookingId: bookingId },
    })
    expect(first.routed).toBe("seat")
    const replay = await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_replay",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_deposit_again",
      metadata: { bookingType: "seat", phase: "deposit", seatBookingId: bookingId },
    })
    expect(replay).toEqual({ routed: "replay" })
    await t.finishInProgressScheduledFunctions()

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("deposit_paid")
    expect(booking?.stripeDepositPaymentIntentId).toBe("pi_deposit")
    expect(refundsCreate).not.toHaveBeenCalled()
  })

  it("keeps the booking approved when deposit payment fails or is canceled, so the 48h expiry still applies", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)

    await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_fail",
      eventType: "payment_intent.payment_failed",
      paymentIntentId: "pi_failed",
      metadata: { bookingType: "seat", phase: "deposit", seatBookingId: bookingId },
      failureReason: "card_declined",
    })
    await t.finishInProgressScheduledFunctions()

    const failed = await t.run((ctx) => ctx.db.get(bookingId))
    expect(failed?.status).toBe("approved")
    expect(failed?.depositPaymentStatus).toBe("failed")

    await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_cancel",
      eventType: "payment_intent.canceled",
      paymentIntentId: "pi_canceled",
      metadata: { bookingType: "seat", phase: "deposit", seatBookingId: bookingId },
    })
    await t.finishInProgressScheduledFunctions()
    const canceled = await t.run((ctx) => ctx.db.get(bookingId))
    expect(canceled?.status).toBe("approved")

    const twoDaysAgo = Date.now() - 49 * 60 * 60 * 1000
    await t.run(async (ctx) => {
      await ctx.db.patch(bookingId, { approvedAt: twoDaysAgo })
    })
    await t.mutation(internal.seatBookings.expireApprovedUnpaidBookings, {})
    await t.finishInProgressScheduledFunctions()
    const expired = await t.run((ctx) => ctx.db.get(bookingId))
    expect(expired?.status).toBe("expired")
  })

  it("does not expire an approved booking that already captured a deposit", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    const twoDaysAgo = Date.now() - 49 * 60 * 60 * 1000
    await t.run(async (ctx) => {
      await ctx.db.patch(bookingId, {
        approvedAt: twoDaysAgo,
        depositPaymentStatus: "paid",
        stripeDepositPaymentIntentId: "pi_held",
      })
    })
    await t.mutation(internal.seatBookings.expireApprovedUnpaidBookings, {})
    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("approved")
    expect(booking?.depositPaymentStatus).toBe("paid")
  })

  it("routes seat metadata to seat handlers and ignores foreign metadata", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)

    const coachingId = await t.run(async (ctx) => {
      const coachProfileId = await ctx.db.insert("coachProfiles", {
        userId: "coach_1",
        bio: "Test coach",
        specialties: ["HPDE"],
        hourlyRate: 15000,
        location: "Austin, TX",
        isActive: true,
        verificationStatus: "verified",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return await ctx.db.insert("coachingBookings", {
        coachProfileId,
        coachUserId: "coach_1",
        renterId: "renter_1",
        startDate: "2030-06-01",
        endDate: "2030-06-01",
        sessionType: "hourly",
        hours: 2,
        totalDays: 1,
        rate: 15000,
        totalAmount: 30000,
        status: "approved",
        paymentStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const paymentId = await t.run(async (ctx) => {
      const trackId = await ctx.db.insert("tracks", {
        name: "COTA",
        location: "Austin, TX",
        isActive: true,
      })
      const vehicleId = await ctx.db.insert("vehicles", {
        ownerId: "owner_1",
        trackId,
        make: "Mazda",
        model: "MX-5",
        year: 2020,
        dailyRate: 10000,
        description: "Spec Miata",
        amenities: [],
        addOns: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const reservationId = await ctx.db.insert("reservations", {
        vehicleId,
        renterId: "renter_1",
        ownerId: "owner_1",
        startDate: "2031-04-01",
        endDate: "2031-04-02",
        totalDays: 1,
        dailyRate: 10000,
        totalAmount: 10000,
        status: "approved",
        paymentStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return await ctx.db.insert("payments", {
        reservationId,
        renterId: "renter_1",
        ownerId: "owner_1",
        amount: 10000,
        platformFee: 500,
        ownerAmount: 9500,
        currency: "usd",
        status: "pending",
        stripePaymentIntentId: "pi_rental",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const foreign = await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_foreign",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_rental",
      metadata: { type: "coaching_booking", coachingBookingId: coachingId },
    })
    expect(foreign).toEqual({ routed: "ignored" })

    const malformed = await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_malformed",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_malformed",
      metadata: { bookingType: "seat", phase: "tip" },
    })
    expect(malformed).toEqual({ routed: "ignored" })

    const seat = await t.mutation(internal.seatPayments.ingestPaymentIntentEvent, {
      eventId: "evt_seat",
      eventType: "payment_intent.succeeded",
      paymentIntentId: "pi_seat",
      metadata: { bookingType: "seat", phase: "deposit", seatBookingId: bookingId },
    })
    expect(seat).toEqual({ routed: "seat", phase: "deposit" })
    await t.finishInProgressScheduledFunctions()

    const seatBooking = await t.run((ctx) => ctx.db.get(bookingId))
    const coaching = await t.run((ctx) => ctx.db.get(coachingId))
    const payment = await t.run((ctx) => ctx.db.get(paymentId))
    expect(seatBooking?.status).toBe("deposit_paid")
    expect(coaching?.status).toBe("approved")
    expect(coaching?.paymentStatus).toBe("pending")
    expect(payment?.status).toBe("pending")

    expect(parseSeatPaymentMetadata({ type: "coaching_booking" })).toBeNull()
    expect(parseSeatPaymentMetadata({ bookingType: "rental", phase: "deposit" })).toBeNull()
    expect(
      parseSeatPaymentMetadata({
        bookingType: "seat",
        phase: "balance",
        seatBookingId: bookingId,
      })
    ).toEqual({ bookingId, phase: "balance" })
  })
})

async function withRefundTimers(now: string | undefined, run: () => Promise<void>) {
  vi.useFakeTimers()
  if (now) vi.setSystemTime(new Date(now))
  try {
    await run()
  } finally {
    vi.useRealTimers()
  }
}

describe("seat payment races and refunds", () => {
  it("refunds the losing driver when the last spot is already secured", async () => {
    const t = convexTest(schema, modules)
    const { bookingId: winnerId } = await seedApprovedBooking(t, { spotCount: 1 })
    const loserId = await t.run(async (ctx) => {
      const winner = await ctx.db.get(winnerId)
      if (!winner) throw new Error("missing winner")
      return await ctx.db.insert("seatBookings", {
        seatOfferingId: winner.seatOfferingId,
        teamCarId: winner.teamCarId,
        raceEventId: winner.raceEventId,
        teamId: winner.teamId,
        hostUserId: winner.hostUserId,
        driverId: DRIVER_B,
        status: "approved",
        priceCents: winner.priceCents,
        depositCents: winner.depositCents,
        balanceCents: winner.balanceCents,
        platformFeePercentage: winner.platformFeePercentage,
        availableStartDate: winner.availableStartDate,
        availableEndDate: winner.availableEndDate,
        driverExperience: winner.driverExperience,
        budgetBand: winner.budgetBand,
        seriesClass: winner.seriesClass,
        whyBuying: winner.whyBuying,
        approvedAt: Date.now(),
        createdAt: Date.now() + 1,
        updatedAt: Date.now() + 1,
      })
    })

    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId: winnerId,
      stripePaymentIntentId: "pi_winner",
    })
    await t.finishInProgressScheduledFunctions()

    await withRefundTimers(undefined, async () => {
      refundsCreate.mockClear()
      await t.mutation(internal.seatPayments.handleDepositSuccess, {
        bookingId: loserId,
        stripePaymentIntentId: "pi_loser",
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })

    const winner = await t.run((ctx) => ctx.db.get(winnerId))
    const loser = await t.run((ctx) => ctx.db.get(loserId))
    expect(winner?.status).toBe("deposit_paid")
    expect(winner?.depositPaymentStatus).toBe("paid")
    expect(loser?.status).toBe("cancelled")
    expect(loser?.depositPaymentStatus).toBe("refunded")
    expect(loser?.cancellationReason).toContain("already taken")
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_loser",
        reverse_transfer: true,
        refund_application_fee: true,
      }),
      expect.objectContaining({ idempotencyKey: `rf_seat_deposit_${loserId}` })
    )
  })

  it("refunds everything in full when the team cancels inside 7 days", async () => {
    const t = convexTest(schema, modules)
    const deposited = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId: deposited.bookingId,
      stripePaymentIntentId: "pi_deposit_only",
    })
    await t.finishInProgressScheduledFunctions()

    const confirmed = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId: confirmed.bookingId,
      stripePaymentIntentId: "pi_dep_full",
    })
    await t.mutation(internal.seatPayments.handleBalanceSuccess, {
      bookingId: confirmed.bookingId,
      stripePaymentIntentId: "pi_bal_full",
    })
    await t.finishInProgressScheduledFunctions()

    const asOwner = t.withIdentity({ subject: OWNER })
    // Race start is 2031-03-14T00:00:00Z. Both times are inside 7 days.
    await withRefundTimers("2031-03-13T12:00:00Z", async () => {
      refundsCreate.mockClear()
      await asOwner.mutation(api.seatBookings.cancel, { bookingId: deposited.bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })

    const afterDepositCancel = await t.run((ctx) => ctx.db.get(deposited.bookingId))
    expect(afterDepositCancel?.status).toBe("cancelled")
    expect(afterDepositCancel?.depositPaymentStatus).toBe("refunded")
    expect(refundsCreate).toHaveBeenCalledTimes(1)
    expect(refundsCreate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        payment_intent: "pi_deposit_only",
        reverse_transfer: true,
        refund_application_fee: true,
      })
    )
    expect(refundsCreate.mock.calls[0]?.[0]?.amount).toBeUndefined()

    await withRefundTimers("2031-03-13T18:00:00Z", async () => {
      refundsCreate.mockClear()
      await asOwner.mutation(api.seatBookings.cancel, { bookingId: confirmed.bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })

    const afterConfirmCancel = await t.run((ctx) => ctx.db.get(confirmed.bookingId))
    expect(afterConfirmCancel?.status).toBe("cancelled")
    expect(afterConfirmCancel?.depositPaymentStatus).toBe("refunded")
    expect(afterConfirmCancel?.balancePaymentStatus).toBe("refunded")
    expect(refundsCreate.mock.calls.map((call) => call[0]?.payment_intent)).toEqual(
      expect.arrayContaining(["pi_dep_full", "pi_bal_full"])
    )
    for (const call of refundsCreate.mock.calls) {
      expect(call[0]?.amount).toBeUndefined()
      expect(call[0]?.refund_application_fee).toBe(true)
    }
  })

  it("refunds the driver 100% at exactly 14 days and nothing just under 7 days", async () => {
    const t = convexTest(schema, modules)
    const early = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId: early.bookingId,
      stripePaymentIntentId: "pi_early_notice",
    })
    await t.mutation(internal.seatPayments.handleBalanceSuccess, {
      bookingId: early.bookingId,
      stripePaymentIntentId: "pi_early_balance",
    })
    await t.finishInProgressScheduledFunctions()

    const late = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId: late.bookingId,
      stripePaymentIntentId: "pi_late_deposit",
    })
    await t.finishInProgressScheduledFunctions()

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    // Exactly 14 days before 2031-03-14T00:00:00Z.
    await withRefundTimers("2031-02-28T00:00:00.000Z", async () => {
      refundsCreate.mockClear()
      await asDriver.mutation(api.seatBookings.cancel, { bookingId: early.bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })
    const refunded = await t.run((ctx) => ctx.db.get(early.bookingId))
    expect(refunded?.status).toBe("cancelled")
    expect(refunded?.depositPaymentStatus).toBe("refunded")
    expect(refunded?.balancePaymentStatus).toBe("refunded")
    expect(refundsCreate).toHaveBeenCalledTimes(2)
    for (const call of refundsCreate.mock.calls) {
      expect(call[0]?.amount).toBeUndefined()
      expect(call[0]?.refund_application_fee).toBe(true)
      expect(call[0]?.reverse_transfer).toBe(true)
    }

    // 1ms inside the 7-day window: no Stripe refund, seat still cancelled.
    await withRefundTimers("2031-03-07T00:00:00.001Z", async () => {
      refundsCreate.mockClear()
      await asDriver.mutation(api.seatBookings.cancel, { bookingId: late.bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })
    const kept = await t.run((ctx) => ctx.db.get(late.bookingId))
    expect(kept?.status).toBe("cancelled")
    expect(kept?.depositPaymentStatus).toBe("paid")
    expect(refundsCreate).not.toHaveBeenCalled()
  })

  it("refunds 50% of a deposit-only capture at exactly 7 days, including a proportional fee", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_half_deposit",
    })
    await t.finishInProgressScheduledFunctions()

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    await withRefundTimers("2031-03-07T00:00:00.000Z", async () => {
      refundsCreate.mockClear()
      await asDriver.mutation(api.seatBookings.cancel, { bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("cancelled")
    expect(booking?.depositPaymentStatus).toBe("refunded")
    expect(booking?.depositCents).toBe(500_000)
    // refund_application_fee with a partial amount is Stripe's proportional fee refund.
    expect(refundsCreate).toHaveBeenCalledTimes(1)
    expect(refundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: "pi_half_deposit",
        amount: 250_000,
        reverse_transfer: true,
        refund_application_fee: true,
        reason: "requested_by_customer",
      },
      expect.objectContaining({ idempotencyKey: `rf_seat_deposit_${bookingId}` })
    )
  })

  it("refunds 50% of deposit and balance at exactly 7 days, including a proportional fee", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t)
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_half_dep",
    })
    await t.mutation(internal.seatPayments.handleBalanceSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_half_bal",
    })
    await t.finishInProgressScheduledFunctions()

    const asDriver = t.withIdentity({ subject: DRIVER_A })
    await withRefundTimers("2031-03-07T00:00:00.000Z", async () => {
      refundsCreate.mockClear()
      await asDriver.mutation(api.seatBookings.cancel, { bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("cancelled")
    expect(booking?.depositPaymentStatus).toBe("refunded")
    expect(booking?.balancePaymentStatus).toBe("refunded")
    expect(booking?.depositCents).toBe(500_000)
    expect(booking?.balanceCents).toBe(1_000_000)
    expect(refundsCreate).toHaveBeenCalledTimes(2)
    expect(refundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: "pi_half_dep",
        amount: 250_000,
        reverse_transfer: true,
        refund_application_fee: true,
        reason: "requested_by_customer",
      },
      expect.objectContaining({ idempotencyKey: `rf_seat_deposit_${bookingId}` })
    )
    expect(refundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: "pi_half_bal",
        amount: 500_000,
        reverse_transfer: true,
        refund_application_fee: true,
        reason: "requested_by_customer",
      },
      expect.objectContaining({ idempotencyKey: `rf_seat_balance_${bookingId}` })
    )
  })

  it("refunds a full-price deposit without a balance PaymentIntent", async () => {
    const t = convexTest(schema, modules)
    const { bookingId } = await seedApprovedBooking(t, {
      priceCents: 800_000,
      depositCents: 800_000,
    })
    await t.mutation(internal.seatPayments.handleDepositSuccess, {
      bookingId,
      stripePaymentIntentId: "pi_full_only",
    })
    await t.finishInProgressScheduledFunctions()

    const asOwner = t.withIdentity({ subject: OWNER })
    await withRefundTimers("2031-01-01T00:00:00Z", async () => {
      refundsCreate.mockClear()
      await asOwner.mutation(api.seatBookings.cancel, { bookingId })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    })

    const booking = await t.run((ctx) => ctx.db.get(bookingId))
    expect(booking?.status).toBe("cancelled")
    expect(booking?.depositPaymentStatus).toBe("refunded")
    expect(booking?.balancePaymentStatus).toBe("refunded")
    expect(refundsCreate).toHaveBeenCalledTimes(1)
    expect(refundsCreate.mock.calls[0]?.[0]?.payment_intent).toBe("pi_full_only")
  })
})
