import {
  calculateRefundAmount,
  SEAT_DRIVER_FULL_REFUND_MIN_DAYS,
  SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS,
  SEAT_DRIVER_PARTIAL_REFUND_PERCENT,
  seatCancellationRefundPercentage,
} from "@renegade/backend/convex/pricing"

export type SeatPayPhase = "deposit" | "balance"

export type SeatBookingView = {
  status: string
  priceCents: number
  depositCents: number
  balanceCents: number
  availableStartDate: string
  availableEndDate: string
  depositPaymentStatus?: string
  balancePaymentStatus?: string
  offeringTitle: string
  carLabel: string
  eventName: string
  eventStartDate: string
  eventEndDate: string
  trackLabel?: string
  teamName: string
}

type SeatBookingSource = {
  status: string
  priceCents: number
  depositCents: number
  balanceCents: number
  availableStartDate: string
  availableEndDate: string
  depositPaymentStatus?: string
  balancePaymentStatus?: string
  offering?: { title?: string } | null
  teamCar?: {
    year?: number
    make?: string
    model?: string
    carNumber?: string
    carClass?: string
  } | null
  event?: {
    name?: string
    startDate?: string
    endDate?: string
    trackName?: string
    trackLocation?: string
  } | null
  team?: { name?: string } | null
}

export function formatCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function formatRaceDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatRaceRange(start: string, end: string) {
  if (!start) return ""
  if (!end || start === end) return formatRaceDate(start)
  return `${formatRaceDate(start)} – ${formatRaceDate(end)}`
}

function carLabel(car: SeatBookingSource["teamCar"]) {
  if (!car) return "Race car"
  const name = [car.year, car.make, car.model].filter(Boolean).join(" ")
  const extras = [car.carNumber ? `#${car.carNumber}` : "", car.carClass ?? ""].filter(Boolean)
  return extras.length > 0 ? `${name} (${extras.join(" · ")})` : name
}

export function toSeatBookingView(booking: SeatBookingSource): SeatBookingView {
  const start = booking.event?.startDate || booking.availableStartDate
  const end = booking.event?.endDate || booking.availableEndDate
  const track = [booking.event?.trackName, booking.event?.trackLocation].filter(Boolean).join(", ")
  return {
    status: booking.status,
    priceCents: booking.priceCents,
    depositCents: booking.depositCents,
    balanceCents: booking.balanceCents,
    availableStartDate: booking.availableStartDate,
    availableEndDate: booking.availableEndDate,
    depositPaymentStatus: booking.depositPaymentStatus,
    balancePaymentStatus: booking.balancePaymentStatus,
    offeringTitle: booking.offering?.title || "Race seat",
    carLabel: carLabel(booking.teamCar),
    eventName: booking.event?.name || "Race event",
    eventStartDate: start,
    eventEndDate: end,
    trackLabel: track || undefined,
    teamName: booking.team?.name || "Team",
  }
}

/** What the driver can pay right now. A full-price deposit has no balance step. */
export function seatAmountDue(booking: {
  status: string
  depositCents: number
  balanceCents: number
}): { phase: SeatPayPhase; amountCents: number } | null {
  if (booking.status === "approved") {
    return { phase: "deposit", amountCents: booking.depositCents }
  }
  if (booking.status === "deposit_paid" && booking.balanceCents > 0) {
    return { phase: "balance", amountCents: booking.balanceCents }
  }
  return null
}

export function seatStatusLabel(status: string, balanceCents: number) {
  switch (status) {
    case "pending":
      return "Awaiting team"
    case "waitlisted":
      return "Waitlisted"
    case "approved":
      return "Approved — pay deposit"
    case "deposit_paid":
      return balanceCents > 0 ? "Deposit paid — balance due" : "Deposit paid"
    case "confirmed":
      return "Confirmed"
    case "completed":
      return "Completed"
    case "cancelled":
      return "Cancelled"
    case "declined":
      return "Declined"
    case "expired":
      return "Expired — deposit not paid in time"
    default:
      return status
  }
}

export function seatCheckoutBlockedReason(status: string) {
  switch (status) {
    case "pending":
      return "The team hasn't approved this request yet. You'll be able to pay the deposit once they do."
    case "waitlisted":
      return "You're on the waitlist. Payment opens if a spot frees up and the team approves you."
    case "confirmed":
    case "completed":
      return "This seat is already paid and confirmed."
    case "cancelled":
      return "This booking was cancelled."
    case "declined":
      return "The team declined this request."
    case "expired":
      return "The 48-hour window to pay the deposit has passed."
    default:
      return "This booking can't be paid in its current state."
  }
}

export function seatCancellationPolicySummary() {
  const fullDays = SEAT_DRIVER_FULL_REFUND_MIN_DAYS
  const partialDays = SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS
  const partialPercent = SEAT_DRIVER_PARTIAL_REFUND_PERCENT
  return `Cancel ${fullDays} or more days before the race for a full refund of what you've paid. At least ${partialDays} and less than ${fullDays} days is a ${partialPercent}% refund. Less than ${partialDays} days is non-refundable. If the team cancels, you get a full refund at any time. Cancelling frees the seat immediately.`
}

export function seatCapturedCents(booking: {
  depositCents: number
  balanceCents: number
  depositPaymentStatus?: string
  balancePaymentStatus?: string
}) {
  const deposit = booking.depositPaymentStatus === "paid" ? booking.depositCents : 0
  const balance =
    booking.balancePaymentStatus === "paid" && booking.balanceCents > 0 ? booking.balanceCents : 0
  return { deposit, balance, total: deposit + balance }
}

/** Driver-facing refund preview. Each captured charge is rounded on its own, matching Stripe. */
export function seatDriverRefundPreview(params: {
  eventStartDate: string
  depositCents: number
  balanceCents: number
  depositPaymentStatus?: string
  balancePaymentStatus?: string
  now: number
}) {
  const captured = seatCapturedCents(params)
  if (captured.total === 0) {
    return { capturedCents: 0, refundCents: 0, percentage: 0 }
  }
  const percentage = seatCancellationRefundPercentage({
    cancelledByTeam: false,
    eventStartDate: params.eventStartDate,
    now: params.now,
  })
  const refundCents =
    calculateRefundAmount(captured.deposit, percentage) +
    calculateRefundAmount(captured.balance, percentage)
  return { capturedCents: captured.total, refundCents, percentage }
}
