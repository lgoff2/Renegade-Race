"use client"

import { useUser } from "@clerk/nextjs"
import { Button } from "@workspace/ui/components/button"
import { useAction, useQuery } from "convex/react"
import { ArrowLeft, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import { toast } from "sonner"
import { SeatCheckoutSummary } from "@/components/seat-checkout-summary"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import { seatAmountDue, toSeatBookingView } from "@/lib/seat-checkout"

function PaySeatInner() {
  const searchParams = useSearchParams()
  const bookingIdParam = searchParams.get("bookingId")
  const router = useRouter()
  const { isLoaded, isSignedIn } = useUser()
  const [paying, setPaying] = useState(false)

  const createDeposit = useAction(api.seatPayments.createDepositCheckoutSession)
  const createBalance = useAction(api.seatPayments.createBalanceCheckoutSession)

  const bookingId = bookingIdParam as Id<"seatBookings"> | null
  const booking = useQuery(
    api.seatBookings.getById,
    isSignedIn && bookingId ? { bookingId } : "skip"
  )

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    const next = `/checkout/pay-seat?bookingId=${bookingIdParam ?? ""}`
    router.push(`/sign-in?redirect_url=${encodeURIComponent(next)}`)
  }, [bookingIdParam, isLoaded, isSignedIn, router])

  const handlePay = async () => {
    if (!(bookingId && booking)) return
    const due = seatAmountDue(booking)
    if (!due) return
    setPaying(true)
    try {
      const result =
        due.phase === "deposit"
          ? await createDeposit({ bookingId })
          : await createBalance({ bookingId })
      if (result.url) {
        window.location.href = result.url
        return
      }
      toast.error("Stripe didn't return a checkout URL")
      setPaying(false)
    } catch (err) {
      handleErrorWithContext(err, { action: "start seat payment" })
      setPaying(false)
    }
  }

  if (!(isLoaded && isSignedIn) || (bookingId && booking === undefined)) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!bookingId || booking === null || !booking) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-bold text-2xl">Couldn't load this seat</h1>
        <p className="mt-2 text-muted-foreground">
          {bookingId ? "This booking wasn't found." : "Missing booking ID."}
        </p>
        <Button asChild className="mt-6">
          <Link href="/trips">Back to trips</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Link className="mb-4 inline-block" href="/trips">
        <Button size="sm" variant="ghost">
          <ArrowLeft className="mr-2 size-4" />
          Back to trips
        </Button>
      </Link>
      <SeatCheckoutSummary booking={toSeatBookingView(booking)} onPay={handlePay} paying={paying} />
    </div>
  )
}

export default function PaySeatPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PaySeatInner />
    </Suspense>
  )
}
