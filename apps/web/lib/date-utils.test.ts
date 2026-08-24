import { describe, expect, it } from "vitest"
import {
  addCalendarDays,
  durationFromDateRange,
  endDateFromDuration,
  inclusiveRentalDays,
} from "./date-utils"

describe("inclusive rental duration (web)", () => {
  it("counts occupied calendar days inclusively", () => {
    const start = new Date(2024, 5, 15)
    expect(inclusiveRentalDays(start, start)).toBe(1)
    expect(inclusiveRentalDays(start, new Date(2024, 5, 16))).toBe(2)
    expect(inclusiveRentalDays(start, new Date(2024, 5, 17))).toBe(3)
  })

  it("computes last occupied day from start + duration", () => {
    const start = new Date(2024, 5, 15)
    expect(endDateFromDuration(start, 1).getDate()).toBe(15)
    expect(endDateFromDuration(start, 2).getDate()).toBe(16)
    expect(endDateFromDuration(start, 3).getDate()).toBe(17)
  })

  it("clamps search date ranges to 1–3 days", () => {
    const start = new Date(2024, 5, 15)
    expect(durationFromDateRange(start, start)).toBe(1)
    expect(durationFromDateRange(start, new Date(2024, 5, 16))).toBe(2)
    expect(durationFromDateRange(start, new Date(2024, 5, 20))).toBe(3)
  })

  it("adds calendar days across a month boundary", () => {
    const end = addCalendarDays(new Date(2024, 0, 31), 1)
    expect(end.getFullYear()).toBe(2024)
    expect(end.getMonth()).toBe(1)
    expect(end.getDate()).toBe(1)
  })
})
