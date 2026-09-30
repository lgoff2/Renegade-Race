import type { Id } from "@/lib/convex"

export type TeamSeatOfferingView = {
  _id: Id<"seatOfferings">
  title: string
  description?: string
  spotCount: number
  priceCents: number
  depositCents: number
  experienceLevel?: "beginner" | "intermediate" | "advanced" | "professional"
  stintNotes?: string
  isActive: boolean
  inventory: {
    spotCount: number
    held: number
    waitlisted: number
    remaining: number
  }
  event: {
    _id: Id<"raceEvents">
    seriesId?: Id<"raceSeries">
    name: string
    startDate: string
    endDate: string
    trackName?: string
    trackLocation?: string
  } | null
  teamCar: {
    _id: Id<"teamCars">
    make: string
    model: string
    year?: number
    carNumber?: string
    carClass?: string
  } | null
}

export function dollarsToCents(value: string): number | null {
  const amount = Number(value)
  if (!(Number.isFinite(amount) && amount > 0)) {
    return null
  }
  return Math.round(amount * 100)
}

export function formatSeatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export function teamCarLabel(offering: TeamSeatOfferingView): string {
  const car = offering.teamCar
  if (!car) return "Team race car"
  const vehicle = [car.year, car.make, car.model].filter(Boolean).join(" ")
  return car.carNumber ? `${vehicle} · #${car.carNumber}` : vehicle
}

export function seatAvailabilityLabel(offering: TeamSeatOfferingView): string {
  const { remaining, waitlisted } = offering.inventory
  if (remaining > 1) return `${remaining} seats available`
  if (remaining === 1) return "1 seat available"
  if (waitlisted > 0) {
    return `Waitlist open · ${waitlisted} ${waitlisted === 1 ? "driver" : "drivers"} waiting`
  }
  return "Join the waitlist"
}

export function visibleTeamSeatOfferings(
  offerings: TeamSeatOfferingView[],
  options: { canManage: boolean; today?: string }
): TeamSeatOfferingView[] {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  return offerings
    .filter((offering) => {
      if (!(options.canManage || offering.isActive)) return false
      if (!options.canManage && offering.event && offering.event.endDate < today) return false
      return true
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return (a.event?.startDate ?? "").localeCompare(b.event?.startDate ?? "")
    })
}
