"use client"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Calendar, Car, Loader2, MapPin, ShieldCheck, Users } from "lucide-react"
import {
  formatCents,
  formatRaceRange,
  type SeatBookingView,
  seatAmountDue,
  seatCancellationPolicySummary,
  seatCheckoutBlockedReason,
} from "@/lib/seat-checkout"

export function SeatCheckoutSummary({
  booking,
  paying,
  onPay,
}: {
  booking: SeatBookingView
  paying: boolean
  onPay: () => void
}) {
  const due = seatAmountDue(booking)
  const depositPaid = booking.depositPaymentStatus === "paid" || booking.status === "deposit_paid"
  const depositFailed = booking.status === "approved" && booking.depositPaymentStatus === "failed"
  const balanceFailed =
    booking.status === "deposit_paid" && booking.balancePaymentStatus === "failed"
  const dateLabel = formatRaceRange(booking.eventStartDate, booking.eventEndDate)

  return (
    <div>
      <h1 className="mb-2 font-bold text-3xl tracking-tight">
        {due?.phase === "balance" ? "Pay the remaining balance" : "Pay your seat deposit"}
      </h1>
      <p className="mb-6 text-muted-foreground">
        {due
          ? `${booking.teamName} approved ${booking.offeringTitle}. ${
              due.phase === "deposit"
                ? "The deposit holds your spot."
                : "The deposit is paid. The balance confirms the seat."
            }`
          : seatCheckoutBlockedReason(booking.status)}
      </p>

      {(depositFailed || balanceFailed) && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          The last payment didn't go through. You can try again.
        </p>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Seat details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <span>
              {booking.teamName} · {booking.offeringTitle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Car className="size-4 text-muted-foreground" />
            <span>{booking.carLabel}</span>
          </div>
          <div className="flex items-center gap-2">
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
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{due ? "Due now" : "Payment"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Seat price</span>
            <span>{formatCents(booking.priceCents)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Deposit{depositPaid ? " (paid)" : ""}</span>
            <span>{formatCents(booking.depositCents)}</span>
          </div>
          {booking.balanceCents > 0 && (
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">
                Balance{booking.balancePaymentStatus === "paid" ? " (paid)" : ""}
              </span>
              <span>{formatCents(booking.balanceCents)}</span>
            </div>
          )}
          {due && (
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">
                {due.phase === "deposit" ? "Deposit" : "Balance"}
              </span>
              <span className="font-bold text-2xl">{formatCents(due.amountCents)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {due ? (
        <>
          <Button className="w-full" disabled={paying} onClick={onPay} size="lg">
            {paying ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 size-4" />
            )}
            {due.phase === "deposit" ? "Pay deposit" : "Pay balance"} {formatCents(due.amountCents)}
          </Button>
          {due.phase === "deposit" && (
            <p className="mt-3 text-center text-muted-foreground text-xs">
              Pay within 48 hours of approval. After that, the hold expires and the seat opens up.
            </p>
          )}
          <p className="mt-3 text-center text-muted-foreground text-xs">
            Secure payment powered by Stripe. Your card isn't charged until you complete checkout.
          </p>
        </>
      ) : null}

      <p className="mt-6 text-muted-foreground text-xs">{seatCancellationPolicySummary()}</p>
    </div>
  )
}
