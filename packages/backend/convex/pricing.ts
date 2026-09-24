/**
 * Pure pricing and date-overlap helpers extracted from reservation/payment logic.
 * These functions have no Convex dependencies and are fully testable.
 */

/** Calculate add-on total, respecting daily vs one-time price types */
export function calculateAddOnsTotal(
  addOns: Array<{ price: number; priceType?: "daily" | "one-time" }>,
  totalDays: number
): number {
  let total = 0
  for (const addOn of addOns) {
    if (addOn.priceType === "daily") {
      total += addOn.price * totalDays
    } else {
      total += addOn.price
    }
  }
  return total
}

/** Calculate full reservation total: (days * dailyRate) + addOns */
export function calculateReservationTotal(
  dailyRate: number,
  totalDays: number,
  addOns?: Array<{ price: number; priceType?: "daily" | "one-time" }>
): number {
  const baseAmount = totalDays * dailyRate
  if (!addOns || addOns.length === 0) {
    return baseAmount
  }
  return baseAmount + calculateAddOnsTotal(addOns, totalDays)
}

/** Calculate platform fee with percentage, clamped to min/max bounds */
export function calculatePlatformFeeAmount(
  amount: number,
  feePercentage: number,
  minimumFee: number,
  maximumFee?: number
): { platformFee: number; ownerAmount: number } {
  const calculatedFee = Math.round((amount * feePercentage) / 100)
  const platformFee = Math.max(minimumFee, Math.min(calculatedFee, maximumFee ?? calculatedFee))
  return {
    platformFee,
    ownerAmount: amount - platformFee,
  }
}

/** Check if two date ranges overlap (string comparison, YYYY-MM-DD) */
export function datesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && endA >= startB
}

/** Calculate refund amount from payment amount and refund percentage */
export function calculateRefundAmount(paymentAmount: number, percentage: number): number {
  return Math.round(paymentAmount * (percentage / 100))
}

const HH_MM_RE = /^\d{2}:\d{2}$/

/**
 * Coaching cancellation refund policy. A coaching session is a scheduled
 * commitment that holds the coach's calendar, so:
 *  - the coach cancelling always refunds the renter in full;
 *  - the renter cancelling is refundable only when it's at least `minNoticeHours`
 *    (default 24h) before the session starts — otherwise the coach keeps the
 *    payment for the slot they held.
 * `startTime` is "HH:MM" (24h) for hourly sessions; day-length sessions assume
 * the start of the day. Dates/times are interpreted as UTC, matching how
 * bookings are stored. `now` is a timestamp (ms).
 */
export function isCoachingCancellationRefundable(params: {
  cancelledByCoach: boolean
  startDate: string
  startTime?: string
  now: number
  minNoticeHours?: number
}): boolean {
  if (params.cancelledByCoach) {
    return true
  }
  const minNoticeMs = (params.minNoticeHours ?? 24) * 60 * 60 * 1000
  const time = params.startTime && HH_MM_RE.test(params.startTime) ? params.startTime : "00:00"
  const sessionStart = Date.parse(`${params.startDate}T${time}:00Z`)
  if (Number.isNaN(sessionStart)) {
    // Unparseable date — be lenient and allow the refund rather than trap funds.
    return true
  }
  return params.now <= sessionStart - minNoticeMs
}

/**
 * Driver seat-cancellation refund tiers, measured against UTC midnight of the
 * race event start (the same reference coaching uses for its notice window).
 * These are the only thresholds — callers must not hardcode 14, 7, or 50.
 *  - `SEAT_DRIVER_FULL_REFUND_MIN_DAYS` or more before start: 100% of captured funds
 *  - at least `SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS` and less than that: partial %
 *  - less than the partial minimum: no refund
 * The team cancelling is always 100%, regardless of timing.
 */
export const SEAT_DRIVER_FULL_REFUND_MIN_DAYS = 14
export const SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS = 7
export const SEAT_DRIVER_PARTIAL_REFUND_PERCENT = 50

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function seatCancellationRefundPercentage(params: {
  cancelledByTeam: boolean
  eventStartDate: string
  now: number
}): number {
  if (params.cancelledByTeam) return 100
  const eventStart = Date.parse(`${params.eventStartDate}T00:00:00Z`)
  if (Number.isNaN(eventStart)) {
    // Unparseable date — be lenient and refund in full rather than trap funds.
    return 100
  }
  const msUntilStart = eventStart - params.now
  if (msUntilStart >= SEAT_DRIVER_FULL_REFUND_MIN_DAYS * MS_PER_DAY) return 100
  if (msUntilStart >= SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS * MS_PER_DAY) {
    return SEAT_DRIVER_PARTIAL_REFUND_PERCENT
  }
  return 0
}
