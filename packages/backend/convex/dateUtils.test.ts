import {
  parseLocalDate,
  formatDateToISO,
  calculateDaysBetween,
  generateDateRange,
  addCalendarDays,
  endDateFromDuration,
  inclusiveRentalDays,
  isValidRentalDuration,
} from "./dateUtils"

describe("parseLocalDate", () => {
  it("parses a valid date string", () => {
    const date = parseLocalDate("2024-06-15")
    expect(date).toBeInstanceOf(Date)
    expect(date?.getFullYear()).toBe(2024)
    expect(date?.getMonth()).toBe(5) // 0-indexed
    expect(date?.getDate()).toBe(15)
  })

  it("parses Jan 1st correctly", () => {
    const date = parseLocalDate("2024-01-01")
    expect(date).toBeInstanceOf(Date)
    expect(date?.getMonth()).toBe(0)
    expect(date?.getDate()).toBe(1)
  })

  it("parses Dec 31st correctly", () => {
    const date = parseLocalDate("2024-12-31")
    expect(date).toBeInstanceOf(Date)
    expect(date?.getMonth()).toBe(11)
    expect(date?.getDate()).toBe(31)
  })

  it("returns null for invalid date Feb 30", () => {
    expect(parseLocalDate("2024-02-30")).toBeNull()
  })

  it("returns null for invalid date Feb 29 in non-leap year", () => {
    expect(parseLocalDate("2023-02-29")).toBeNull()
  })

  it("parses Feb 29 in a leap year", () => {
    const date = parseLocalDate("2024-02-29")
    expect(date).toBeInstanceOf(Date)
    expect(date?.getDate()).toBe(29)
  })

  it("returns null for malformed strings", () => {
    expect(parseLocalDate("not-a-date")).toBeNull()
    expect(parseLocalDate("2024-13-01")).toBeNull()
    expect(parseLocalDate("2024-00-01")).toBeNull()
    expect(parseLocalDate("2024/06/15")).toBeNull()
    expect(parseLocalDate("")).toBeNull()
  })

  it("returns null for incomplete date strings", () => {
    expect(parseLocalDate("2024-06")).toBeNull()
    expect(parseLocalDate("2024")).toBeNull()
  })
})

describe("formatDateToISO", () => {
  it("formats a date to YYYY-MM-DD", () => {
    const date = new Date(2024, 5, 15) // June 15, 2024
    expect(formatDateToISO(date)).toBe("2024-06-15")
  })

  it("zero-pads single-digit months and days", () => {
    const date = new Date(2024, 0, 5) // Jan 5, 2024
    expect(formatDateToISO(date)).toBe("2024-01-05")
  })

  it("handles Dec 31", () => {
    const date = new Date(2024, 11, 31)
    expect(formatDateToISO(date)).toBe("2024-12-31")
  })
})

describe("calculateDaysBetween", () => {
  it("returns 1 for the same day", () => {
    expect(calculateDaysBetween("2024-06-15", "2024-06-15")).toBe(1)
  })

  it("calculates multi-day spans", () => {
    expect(calculateDaysBetween("2024-06-15", "2024-06-17")).toBe(2)
  })

  it("calculates across month boundaries", () => {
    expect(calculateDaysBetween("2024-01-30", "2024-02-02")).toBe(3)
  })

  it("returns 0 for invalid start date", () => {
    expect(calculateDaysBetween("invalid", "2024-06-15")).toBe(0)
  })

  it("returns 0 for invalid end date", () => {
    expect(calculateDaysBetween("2024-06-15", "invalid")).toBe(0)
  })
})

describe("generateDateRange", () => {
  it("generates a range of dates inclusive", () => {
    const range = generateDateRange("2024-06-15", "2024-06-17")
    expect(range).toEqual(["2024-06-15", "2024-06-16", "2024-06-17"])
  })

  it("returns a single date for same start and end", () => {
    const range = generateDateRange("2024-06-15", "2024-06-15")
    expect(range).toEqual(["2024-06-15"])
  })

  it("returns empty array for invalid start date", () => {
    expect(generateDateRange("invalid", "2024-06-15")).toEqual([])
  })

  it("returns empty array for invalid end date", () => {
    expect(generateDateRange("2024-06-15", "invalid")).toEqual([])
  })

  it("returns empty array when start is after end", () => {
    expect(generateDateRange("2024-06-17", "2024-06-15")).toEqual([])
  })

  it("generates range across month boundary", () => {
    const range = generateDateRange("2024-01-30", "2024-02-02")
    expect(range).toEqual(["2024-01-30", "2024-01-31", "2024-02-01", "2024-02-02"])
  })
})

describe("inclusive rental duration", () => {
  it("treats the same start and end as 1 day", () => {
    expect(inclusiveRentalDays("2024-06-15", "2024-06-15")).toBe(1)
  })

  it("counts occupied calendar days inclusively", () => {
    expect(inclusiveRentalDays("2024-06-15", "2024-06-16")).toBe(2)
    expect(inclusiveRentalDays("2024-06-15", "2024-06-17")).toBe(3)
  })

  it("computes the last occupied day from start + duration", () => {
    expect(endDateFromDuration("2024-06-15", 1)).toBe("2024-06-15")
    expect(endDateFromDuration("2024-06-15", 2)).toBe("2024-06-16")
    expect(endDateFromDuration("2024-06-15", 3)).toBe("2024-06-17")
  })

  it("adds calendar days across a month boundary", () => {
    expect(addCalendarDays("2024-01-31", 1)).toBe("2024-02-01")
  })

  it("accepts only 1, 2, or 3 day rentals", () => {
    expect(isValidRentalDuration(1)).toBe(true)
    expect(isValidRentalDuration(2)).toBe(true)
    expect(isValidRentalDuration(3)).toBe(true)
    expect(isValidRentalDuration(0)).toBe(false)
    expect(isValidRentalDuration(4)).toBe(false)
  })
})
