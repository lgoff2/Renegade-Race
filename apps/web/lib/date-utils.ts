/**
 * Date utility functions for consistent date handling across the application.
 * All dates are stored in the database as YYYY-MM-DD strings (date-only, no time).
 * These utilities ensure dates are handled consistently without timezone issues.
 */

/**
 * Parse a YYYY-MM-DD date string as a local date (not UTC).
 * This prevents timezone shifts when parsing date-only strings.
 *
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object in local timezone, or null if invalid
 */
export function parseLocalDate(dateString: string): Date | null {
  try {
    const parts = dateString.split("-")
    if (parts.length !== 3) return null

    const year = Number.parseInt(parts[0] || "0", 10)
    const month = Number.parseInt(parts[1] || "0", 10) - 1 // Month is 0-indexed
    const day = Number.parseInt(parts[2] || "0", 10)

    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null

    // Create date in local timezone
    const date = new Date(year, month, day)

    // Validate the date is correct (handles invalid dates like Feb 30)
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null
    }

    return date
  } catch {
    return null
  }
}

/**
 * Format a Date object to YYYY-MM-DD string (local date, not UTC).
 * This prevents timezone shifts when converting dates to strings.
 *
 * @param date - Date object
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateToISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Format a YYYY-MM-DD date string for display to users.
 * Parses the date as local to avoid timezone issues.
 *
 * @param dateString - Date string in YYYY-MM-DD format
 * @param options - Optional formatting options
 * @returns Formatted date string (e.g., "Jan 19, 2024")
 */
export function formatDateForDisplay(
  dateString: string,
  options?: {
    month?: "short" | "long" | "numeric" | "2-digit"
    day?: "numeric" | "2-digit"
    year?: "numeric" | "2-digit"
  }
): string {
  const date = parseLocalDate(dateString)
  if (!date) return dateString

  const defaultOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }

  return date.toLocaleDateString("en-US", defaultOptions)
}

/** Track-day rentals last 1, 2, or 3 calendar days starting on the chosen date. */
export const MIN_RENTAL_DURATION_DAYS = 1
export const MAX_RENTAL_DURATION_DAYS = 3
export const RENTAL_DURATION_OPTIONS = [1, 2, 3] as const
export type RentalDurationDays = (typeof RENTAL_DURATION_OPTIONS)[number]

const MS_PER_DAY = 1000 * 60 * 60 * 24

function startOfLocalDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

/** Add (or subtract) calendar days from a local Date. */
export function addCalendarDays(date: Date, days: number): Date {
  const next = startOfLocalDay(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Last occupied calendar day for a rental that starts on `startDate`
 * and lasts `durationDays` days (inclusive).
 */
export function endDateFromDuration(startDate: Date, durationDays: number): Date {
  return addCalendarDays(startDate, durationDays - 1)
}

/** Inclusive occupied-day count (same day = 1, Jun 15–16 = 2). */
export function inclusiveRentalDays(startDate: Date, endDate: Date): number {
  const start = startOfLocalDay(startDate)
  const end = startOfLocalDay(endDate)
  const diffDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)
  return diffDays >= 0 ? diffDays + 1 : 0
}

/**
 * Clamp an inclusive start/end pair to a valid 1–3 day rental duration.
 * Used when search URL params still carry a date range.
 */
export function durationFromDateRange(startDate: Date, endDate: Date): RentalDurationDays {
  const days = inclusiveRentalDays(startDate, endDate)
  if (days <= 1) return 1
  if (days >= 3) return 3
  return 2
}

export function isValidRentalDuration(days: number): days is RentalDurationDays {
  return RENTAL_DURATION_OPTIONS.includes(days as RentalDurationDays)
}

/**
 * Calculate the number of days between two date strings.
 * Uses local date parsing to avoid timezone issues.
 *
 * @param startDateString - Start date in YYYY-MM-DD format
 * @param endDateString - End date in YYYY-MM-DD format
 * @returns Number of days (same day = 1; Jun 15–17 = 2, hotel-style night count)
 */
export function calculateDaysBetween(startDateString: string, endDateString: string): number {
  const start = parseLocalDate(startDateString)
  const end = parseLocalDate(endDateString)

  if (!(start && end)) return 0

  // Set both to midnight local time for accurate calculation
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  const diffTime = end.getTime() - start.getTime()
  const diffDays = Math.ceil(diffTime / MS_PER_DAY)

  return diffDays > 0 ? diffDays : 0
}

/**
 * Generate an array of date strings between start and end dates (inclusive).
 * Uses local date parsing to avoid timezone issues.
 *
 * @param startDateString - Start date in YYYY-MM-DD format
 * @param endDateString - End date in YYYY-MM-DD format
 * @returns Array of date strings in YYYY-MM-DD format
 */
export function generateDateRange(startDateString: string, endDateString: string): string[] {
  const start = parseLocalDate(startDateString)
  const end = parseLocalDate(endDateString)

  if (!(start && end)) return []

  const dates: string[] = []
  const current = new Date(start)
  current.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  while (current <= end) {
    dates.push(formatDateToISO(current))
    current.setDate(current.getDate() + 1)
  }

  return dates
}
