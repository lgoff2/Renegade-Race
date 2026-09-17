import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { parseLocalDate } from "./dateUtils"
import { ErrorCode, throwError } from "./errors"

export const SEAT_HOLDING_STATUSES = ["pending", "approved", "deposit_paid", "confirmed"] as const

export const SEAT_OPEN_STATUSES = [...SEAT_HOLDING_STATUSES, "waitlisted"] as const

export const MAX_SEAT_PRICE_CENTS = 5_000_000 // $50,000
export const MIN_SEAT_PRICE_CENTS = 100 // $1
export const MAX_SPOT_COUNT = 20
export const DEFAULT_PLATFORM_FEE_PERCENTAGE = 5

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

export function holdsSeat(status: string): boolean {
  return (SEAT_HOLDING_STATUSES as readonly string[]).includes(status)
}

export function isOpenSeatBooking(status: string): boolean {
  return (SEAT_OPEN_STATUSES as readonly string[]).includes(status)
}

export function isAdminIdentity(identity: { subject: string }): boolean {
  const metadata = identity as {
    metadata?: { role?: string }
    publicMetadata?: { role?: string }
    orgRole?: string
  }
  const role = metadata.metadata?.role || metadata.publicMetadata?.role || metadata.orgRole
  return role === "admin"
}

export async function requireIdentity(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
  }
  return identity
}

export async function requireTeamManager(
  ctx: QueryCtx,
  teamId: Id<"teams">,
  userId: string
): Promise<{ team: Doc<"teams">; role: "owner" | "manager" }> {
  const team = await ctx.db.get(teamId)
  if (!team) {
    throwError(ErrorCode.NOT_FOUND, "Team not found")
  }
  if (team.ownerId === userId) {
    return { team, role: "owner" }
  }
  const member = await ctx.db
    .query("teamMembers")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
    .first()
  if (
    member &&
    member.status === "active" &&
    (member.role === "owner" || member.role === "manager")
  ) {
    return { team, role: member.role }
  }
  throwError(ErrorCode.FORBIDDEN, "Not authorized to manage this team")
}

export async function isTeamManager(
  ctx: QueryCtx,
  teamId: Id<"teams">,
  userId: string
): Promise<boolean> {
  try {
    await requireTeamManager(ctx, teamId, userId)
    return true
  } catch {
    return false
  }
}

/** Admin, or a manager of the given team when teamId is provided. */
export async function requireAdminOrTeamManager(
  ctx: QueryCtx,
  teamId: Id<"teams"> | undefined
): Promise<{
  identity: Awaited<ReturnType<typeof requireIdentity>>
  isAdmin: boolean
  team: Doc<"teams"> | null
}> {
  const identity = await requireIdentity(ctx)
  if (isAdminIdentity(identity)) {
    const adminTeam = teamId ? ((await ctx.db.get(teamId)) ?? null) : null
    if (teamId && !adminTeam) {
      throwError(ErrorCode.NOT_FOUND, "Team not found")
    }
    return { identity, isAdmin: true, team: adminTeam }
  }
  if (!teamId) {
    throwError(ErrorCode.FORBIDDEN, "Admin or team access required")
  }
  const { team } = await requireTeamManager(ctx, teamId, identity.subject)
  return { identity, isAdmin: false, team }
}

export function assertYyyyMmDd(dateString: string, fieldName: string) {
  if (!(YYYY_MM_DD.test(dateString) && parseLocalDate(dateString))) {
    throwError(ErrorCode.INVALID_DATE_RANGE, `${fieldName} must be a valid YYYY-MM-DD date`)
  }
}

export function assertEventDateRange(startDate: string, endDate: string) {
  assertYyyyMmDd(startDate, "Start date")
  assertYyyyMmDd(endDate, "End date")
  if (startDate > endDate) {
    throwError(ErrorCode.INVALID_DATE_RANGE, "Start date must be on or before end date")
  }
}

export function assertMoneyCents(amount: number, fieldName: string) {
  if (!Number.isInteger(amount) || amount < MIN_SEAT_PRICE_CENTS || amount > MAX_SEAT_PRICE_CENTS) {
    throwError(
      ErrorCode.INVALID_AMOUNT,
      `${fieldName} must be between $${MIN_SEAT_PRICE_CENTS / 100} and $${MAX_SEAT_PRICE_CENTS / 100}`
    )
  }
}

export function assertSpotCount(spotCount: number) {
  if (!Number.isInteger(spotCount) || spotCount < 1 || spotCount > MAX_SPOT_COUNT) {
    throwError(ErrorCode.INVALID_INPUT, `Spot count must be between 1 and ${MAX_SPOT_COUNT}`)
  }
}

export function assertOfferingPrices(priceCents: number, depositCents: number) {
  assertMoneyCents(priceCents, "Price")
  assertMoneyCents(depositCents, "Deposit")
  if (depositCents > priceCents) {
    throwError(ErrorCode.INVALID_AMOUNT, "Deposit cannot exceed full seat price")
  }
}

export async function getActivePlatformFeePercentage(ctx: QueryCtx): Promise<number> {
  const settings = await ctx.db
    .query("platformSettings")
    .withIndex("by_active", (q) => q.eq("isActive", true))
    .first()
  if (!settings) {
    return DEFAULT_PLATFORM_FEE_PERCENTAGE
  }
  return settings.platformFeePercentage
}

export async function countHeldSpots(
  ctx: QueryCtx,
  offeringId: Id<"seatOfferings">,
  excludeBookingId?: Id<"seatBookings">
): Promise<number> {
  const bookings = await ctx.db
    .query("seatBookings")
    .withIndex("by_offering", (q) => q.eq("seatOfferingId", offeringId))
    .collect()
  return bookings.filter((booking) => holdsSeat(booking.status) && booking._id !== excludeBookingId)
    .length
}

export async function getOfferingInventory(
  ctx: QueryCtx,
  offering: Doc<"seatOfferings">,
  excludeBookingId?: Id<"seatBookings">
) {
  const bookings = await ctx.db
    .query("seatBookings")
    .withIndex("by_offering", (q) => q.eq("seatOfferingId", offering._id))
    .collect()
  const relevant = bookings.filter((booking) => booking._id !== excludeBookingId)
  const held = relevant.filter((booking) => holdsSeat(booking.status)).length
  const waitlisted = relevant.filter((booking) => booking.status === "waitlisted").length
  return {
    spotCount: offering.spotCount,
    held,
    waitlisted,
    remaining: Math.max(0, offering.spotCount - held),
  }
}

export async function findOpenBookingForDriver(
  ctx: QueryCtx,
  offeringId: Id<"seatOfferings">,
  driverId: string
) {
  const existing = await ctx.db
    .query("seatBookings")
    .withIndex("by_driver_offering", (q) =>
      q.eq("driverId", driverId).eq("seatOfferingId", offeringId)
    )
    .collect()
  return existing.find((booking) => isOpenSeatBooking(booking.status)) ?? null
}

/**
 * When a holding booking is released, the oldest waitlisted request becomes
 * pending. The team still must approve before payment — waitlist is not auto-confirm.
 */
export async function promoteOldestWaitlisted(
  ctx: MutationCtx,
  offeringId: Id<"seatOfferings">
): Promise<Id<"seatBookings"> | null> {
  const offering = await ctx.db.get(offeringId)
  if (!offering?.isActive) {
    return null
  }

  const inventory = await getOfferingInventory(ctx, offering)
  if (inventory.remaining <= 0) {
    return null
  }

  const waitlisted = await ctx.db
    .query("seatBookings")
    .withIndex("by_offering_status", (q) =>
      q.eq("seatOfferingId", offeringId).eq("status", "waitlisted")
    )
    .collect()
  waitlisted.sort((a, b) => a.createdAt - b.createdAt)
  const next = waitlisted[0]
  if (!next) {
    return null
  }

  const now = Date.now()
  await ctx.db.patch(next._id, {
    status: "pending",
    updatedAt: now,
  })

  await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
    userId: next.driverId,
    type: "seat_spot_available",
    title: "A race seat opened up",
    message:
      "A spot is now available for a seat you waitlisted. The team still needs to approve your request before payment.",
    link: "/trips",
    metadata: { bookingId: next._id, offeringId },
  })

  await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
    userId: next.hostUserId,
    type: "seat_request_pending",
    title: "Waitlisted driver is now pending",
    message: "A waitlisted driver moved into a free seat spot and is awaiting your approval.",
    link: "/motorsports/profile/team",
    metadata: { bookingId: next._id, offeringId },
  })

  return next._id
}

/** Public listing identity for a team on seat surfaces — no contact or owner profile. */
export function toPublicTeamListing(team: Doc<"teams"> | null) {
  if (!team) return null
  return {
    _id: team._id,
    name: team.name,
    location: team.location,
    logoUrl: team.logoUrl,
    logoR2Key: team.logoR2Key,
    specialties: team.specialties,
    racingType: team.racingType,
    isActive: team.isActive,
  }
}

/** Drop Stripe host id so clients cannot build a Message Host / profile link. */
export function omitHostUserId<T extends { hostUserId?: string }>(doc: T) {
  const { hostUserId: _hostUserId, ...rest } = doc
  return rest
}
