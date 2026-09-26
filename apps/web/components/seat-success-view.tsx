"use client"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Calendar, CheckCircle2, MapPin } from "lucide-react"
import Link from "next/link"
import {
  formatCents,
  formatRaceRange,
  type SeatBookingView,
  type SeatPayPhase,
} from "@/lib/seat-checkout"

export function seatSuccessState(booking: SeatBookingView, phase: SeatPayPhase | null) {
  const confirmed = booking.status === "confirmed" || booking.status === "completed"
  const balanceDue = booking.balanceCents > 0 && !confirmed

  if (phase === "deposit" && booking.status === "approved") {
    return {
      title: "Deposit submitted",
      body: "We're confirming your deposit. This page updates when it lands.",
      showPayBalance: false,
    }
  }
  if (phase === "balance" && !confirmed) {
    return {
      title: "Balance submitted",
      body: "We're confirming your payment. This page updates when the seat is confirmed.",
      showPayBalance: false,
    }
  }
  if (balanceDue && (booking.status === "deposit_paid" || phase === "deposit")) {
    return {
      title: "Deposit received",
      body: `Pay the remaining ${formatCents(booking.balanceCents)} to confirm the seat.`,
      showPayBalance: booking.status === "deposit_paid",
    }
  }
  return {
    title: "Seat confirmed",
    body: `${booking.teamName} has your payment. You're set for ${booking.eventName}.`,
    showPayBalance: false,
  }
}

export function SeatSuccessView({
  booking,
  bookingId,
  phase,
}: {
  booking: SeatBookingView
  bookingId: string
  phase: SeatPayPhase | null
}) {
  const state = seatSuccessState(booking, phase)
  const confirmed = booking.status === "confirmed" || booking.status === "completed"
  const dateLabel = formatRaceRange(booking.eventStartDate, booking.eventEndDate)
  let paidCents = 0
  if (confirmed) {
    paidCents = booking.priceCents
  } else if (phase === "deposit" || booking.depositPaymentStatus === "paid") {
    paidCents = booking.depositCents
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardContent className="py-12">
          <div className="mx-auto max-w-xl text-center">
            <CheckCircle2 className="mx-auto mb-4 size-16 text-green-500" />
            <h1 className="mb-2 font-bold text-4xl">{state.title}</h1>
            <p className="mb-8 text-lg text-muted-foreground">{state.body}</p>

            <div className="mb-8 rounded-lg border bg-muted/50 p-6 text-left">
              <p className="mb-1 font-semibold">{booking.offeringTitle}</p>
              <p className="mb-4 text-muted-foreground text-sm">
                {booking.teamName} · {booking.carLabel}
              </p>
              <div className="mb-3 flex items-center gap-2">
                <Calendar className="size-4 text-muted-foreground" />
                <span>
                  {booking.eventName}
                  {dateLabel ? ` · ${dateLabel}` : ""}
                </span>
              </div>
              {booking.trackLabel && (
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span>{booking.trackLabel}</span>
                </div>
              )}
              <Separator className="my-4" />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Seat price</span>
                  <span>{formatCents(booking.priceCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Deposit</span>
                  <span>{formatCents(booking.depositCents)}</span>
                </div>
                {booking.balanceCents > 0 && (
                  <div className="flex justify-between">
                    <span>Balance</span>
                    <span>{formatCents(booking.balanceCents)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>{confirmed ? "Total paid" : "Paid so far"}</span>
                  <span>{formatCents(paidCents)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              {state.showPayBalance && (
                <Button asChild>
                  <Link href={`/checkout/pay-seat?bookingId=${bookingId}`}>Pay balance</Link>
                </Button>
              )}
              <Button asChild variant={state.showPayBalance ? "outline" : "default"}>
                <Link href="/trips">View my trips</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
