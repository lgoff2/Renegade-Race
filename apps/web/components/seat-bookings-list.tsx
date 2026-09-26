"use client"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { CreditCard, Flag } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { SeatCancelDialog } from "@/components/seat-cancel-dialog"
import type { Id } from "@/lib/convex"
import {
  formatCents,
  formatRaceRange,
  seatAmountDue,
  seatStatusLabel,
  toSeatBookingView,
} from "@/lib/seat-checkout"

const CANCELLABLE = new Set(["pending", "waitlisted", "approved", "deposit_paid", "confirmed"])

function SeatBookingRow({
  booking,
}: {
  booking: Parameters<typeof toSeatBookingView>[0] & { _id: Id<"seatBookings"> }
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const view = toSeatBookingView(booking)
  const due = seatAmountDue(view)
  const dateLabel = formatRaceRange(view.eventStartDate, view.eventEndDate)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Flag className="size-4 text-muted-foreground" />
            <span className="font-semibold">{view.offeringTitle}</span>
            <Badge variant="outline">{seatStatusLabel(view.status, view.balanceCents)}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {view.teamName} · {view.carLabel}
          </p>
          <p className="text-muted-foreground text-sm">
            {view.eventName}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold">
            {due ? formatCents(due.amountCents) : formatCents(view.priceCents)}
          </span>
          {due && (
            <Button asChild size="sm">
              <Link href={`/checkout/pay-seat?bookingId=${booking._id}`}>
                <CreditCard className="mr-2 size-4" />
                {due.phase === "deposit" ? "Pay deposit" : "Pay balance"}
              </Link>
            </Button>
          )}
          {CANCELLABLE.has(view.status) && (
            <>
              <Button onClick={() => setCancelOpen(true)} size="sm" variant="ghost">
                Cancel
              </Button>
              <SeatCancelDialog
                balanceCents={view.balanceCents}
                balancePaymentStatus={view.balancePaymentStatus}
                bookingId={booking._id}
                depositCents={view.depositCents}
                depositPaymentStatus={view.depositPaymentStatus}
                eventStartDate={view.eventStartDate}
                onOpenChange={setCancelOpen}
                open={cancelOpen}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function SeatBookingsList({
  bookings,
}: {
  bookings: Array<Parameters<typeof toSeatBookingView>[0] & { _id: Id<"seatBookings"> }> | undefined
}) {
  if (bookings === undefined) {
    return <p className="py-12 text-center text-muted-foreground">Loading race seats…</p>
  }
  if (bookings.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <Flag className="size-7 text-muted-foreground" />
          </div>
          <p className="mb-1 font-semibold text-lg">No race seats yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            When you request an endurance seat, it will show up here — including the deposit and
            balance once the team approves you.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {bookings.map((booking) => (
        <SeatBookingRow booking={booking} key={booking._id} />
      ))}
    </div>
  )
}
