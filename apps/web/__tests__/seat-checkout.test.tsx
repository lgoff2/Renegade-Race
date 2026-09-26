import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SeatCheckoutSummary } from "@/components/seat-checkout-summary"
import { SeatSuccessView } from "@/components/seat-success-view"
import {
  type SeatBookingView,
  seatAmountDue,
  seatCancellationPolicySummary,
  seatDriverRefundPreview,
} from "@/lib/seat-checkout"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const eventStart = Date.parse("2031-03-14T00:00:00Z")
const dayMs = 24 * 60 * 60 * 1000

const booking: SeatBookingView = {
  status: "approved",
  priceCents: 1_500_000,
  depositCents: 500_000,
  balanceCents: 1_000_000,
  availableStartDate: "2031-03-14",
  availableEndDate: "2031-03-16",
  offeringTitle: "Amateur endurance seat",
  carLabel: "2022 Porsche 911 GT3 Cup",
  eventName: "Sebring 12 Hours",
  eventStartDate: "2031-03-14",
  eventEndDate: "2031-03-16",
  trackLabel: "Sebring, Sebring, FL",
  teamName: "Gridlock Racing",
}

describe("seat checkout amounts", () => {
  it("asks for the deposit only after approval", () => {
    expect(seatAmountDue(booking)).toEqual({ phase: "deposit", amountCents: 500_000 })
  })

  it("asks for the balance after the deposit, and skips it when the deposit covered the price", () => {
    expect(seatAmountDue({ ...booking, status: "deposit_paid" })).toEqual({
      phase: "balance",
      amountCents: 1_000_000,
    })
    expect(seatAmountDue({ ...booking, status: "deposit_paid", balanceCents: 0 })).toBeNull()
  })

  it("does not ask for payment once the seat is confirmed", () => {
    expect(seatAmountDue({ ...booking, status: "confirmed" })).toBeNull()
  })
})

describe("seat driver refund preview", () => {
  const paid = {
    eventStartDate: "2031-03-14",
    depositCents: 500_000,
    balanceCents: 1_000_000,
    depositPaymentStatus: "paid",
    balancePaymentStatus: "paid",
  }

  it("refunds 100% at exactly 14 days and 50% of each charge at exactly 7 days", () => {
    expect(seatDriverRefundPreview({ ...paid, now: eventStart - 14 * dayMs })).toMatchObject({
      percentage: 100,
      refundCents: 1_500_000,
    })
    expect(
      seatDriverRefundPreview({
        ...paid,
        balancePaymentStatus: undefined,
        now: eventStart - 7 * dayMs,
      })
    ).toMatchObject({ capturedCents: 500_000, percentage: 50, refundCents: 250_000 })
    expect(seatDriverRefundPreview({ ...paid, now: eventStart - 7 * dayMs })).toMatchObject({
      capturedCents: 1_500_000,
      percentage: 50,
      refundCents: 750_000,
    })
  })

  it("refunds nothing just under 7 days", () => {
    expect(seatDriverRefundPreview({ ...paid, now: eventStart - 7 * dayMs + 1 })).toMatchObject({
      percentage: 0,
      refundCents: 0,
      capturedCents: 1_500_000,
    })
  })
})

describe("seat checkout views", () => {
  it("shows the deposit button and the shared cancellation rule", () => {
    render(<SeatCheckoutSummary booking={booking} onPay={vi.fn()} paying={false} />)
    expect(screen.getByRole("button", { name: "Pay deposit $5,000.00" })).toBeInTheDocument()
    expect(
      screen.getByText(
        "Pay within 48 hours of approval. After that, the hold expires and the seat opens up."
      )
    ).toBeInTheDocument()
    expect(screen.getByText(seatCancellationPolicySummary())).toBeInTheDocument()
    expect(screen.getByText("Sebring 12 Hours", { exact: false })).toBeInTheDocument()
  })

  it("shows the balance button after the deposit is paid", () => {
    render(
      <SeatCheckoutSummary
        booking={{ ...booking, status: "deposit_paid", depositPaymentStatus: "paid" }}
        onPay={vi.fn()}
        paying={false}
      />
    )
    expect(screen.getByRole("button", { name: "Pay balance $10,000.00" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Pay the remaining balance" })).toBeInTheDocument()
  })

  it("shows a confirmed seat with no pay button when the deposit covered the price", () => {
    render(
      <SeatCheckoutSummary
        booking={{
          ...booking,
          status: "confirmed",
          balanceCents: 0,
          depositCents: 800_000,
          priceCents: 800_000,
        }}
        onPay={vi.fn()}
        paying={false}
      />
    )
    expect(
      screen.queryByRole("button", { name: (name) => name.startsWith("Pay") })
    ).not.toBeInTheDocument()
    expect(screen.getByText("This seat is already paid and confirmed.")).toBeInTheDocument()
  })

  it("offers the balance only after a deposit return has been confirmed", () => {
    render(
      <SeatSuccessView
        booking={{ ...booking, status: "deposit_paid", depositPaymentStatus: "paid" }}
        bookingId="seat_1"
        phase="deposit"
      />
    )
    expect(screen.getByRole("heading", { name: "Deposit received" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Pay balance" })).toHaveAttribute(
      "href",
      "/checkout/pay-seat?bookingId=seat_1"
    )
  })

  it("confirms the seat after the balance return", () => {
    render(
      <SeatSuccessView
        booking={{
          ...booking,
          status: "confirmed",
          depositPaymentStatus: "paid",
          balancePaymentStatus: "paid",
        }}
        bookingId="seat_1"
        phase="balance"
      />
    )
    expect(screen.getByRole("heading", { name: "Seat confirmed" })).toBeInTheDocument()
    expect(screen.getByText("Total paid")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Pay balance" })).not.toBeInTheDocument()
  })
})
