"use client"

import { useUser } from "@clerk/nextjs"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { useAction, useQuery } from "convex/react"
import { Calendar, Loader2, MapPin } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { formatDateForDisplay } from "@/lib/date-utils"
import { r2Url } from "@/lib/r2-url"

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "")

function PaymentForm({
  reservationId,
  totalAmount,
}: {
  reservationId: string
  totalAmount: number
}) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()

  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!(stripe && elements)) {
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const { error: submitError } = await elements.submit()
      if (submitError) {
        setError(submitError.message || "Payment failed")
        setIsProcessing(false)
        return
      }

      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success?reservationId=${reservationId}`,
        },
        redirect: "if_required",
      })

      if (confirmError) {
        setError(confirmError.message || "Payment failed")
        setIsProcessing(false)
      } else {
        router.push(`/checkout/success?reservationId=${reservationId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed")
      setIsProcessing(false)
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="rounded-lg border bg-muted/50 p-4">
        <h3 className="mb-4 font-semibold text-lg">Payment Details</h3>
        <PaymentElement />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-medium">${totalAmount.toLocaleString()}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="font-semibold text-lg">Total</span>
          <span className="font-bold text-2xl">${totalAmount.toLocaleString()}</span>
        </div>
      </div>

      <Button className="w-full" disabled={!stripe || isProcessing} size="lg" type="submit">
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Processing...
          </>
        ) : (
          `Pay $${totalAmount.toLocaleString()}`
        )}
      </Button>
    </form>
  )
}

function PayPageContent() {
  const searchParams = useSearchParams()
  const _router = useRouter()
  const { isSignedIn } = useUser()
  const reservationId = searchParams.get("reservationId")

  const reservation = useQuery(
    api.reservations.getById,
    reservationId ? { id: reservationId as Id<"reservations"> } : "skip"
  )

  const createPaymentIntent = useAction(api.stripe.createPaymentIntent)

  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isCreatingPayment, setIsCreatingPayment] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Calculate time remaining for payment deadline
  const getTimeRemaining = () => {
    if (!reservation?.approvedAt) return null
    const deadline = reservation.approvedAt + 48 * 60 * 60 * 1000
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null

    const hours = Math.floor(remaining / (1000 * 60 * 60))
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
    return { hours, minutes }
  }

  const timeRemaining = getTimeRemaining()

  // Create payment intent when page loads and reservation is approved
  useEffect(() => {
    if (
      !(
        reservation &&
        reservation.status === "approved" &&
        isSignedIn &&
        !clientSecret &&
        !isCreatingPayment
      )
    ) {
      return
    }

    const initPayment = async () => {
      setIsCreatingPayment(true)
      try {
        const { clientSecret: newClientSecret } = await createPaymentIntent({
          reservationId: reservation._id,
          amount: reservation.totalAmount,
        })
        setClientSecret(newClientSecret)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize payment")
      } finally {
        setIsCreatingPayment(false)
      }
    }

    initPayment()
  }, [reservation, isSignedIn, clientSecret, isCreatingPayment, createPaymentIntent])

  if (!reservationId) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="mb-2 font-bold text-2xl">Invalid Request</h2>
            <p className="mb-6 text-muted-foreground">Reservation ID is missing</p>
            <Button asChild>
              <Link href="/trips">View My Trips</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!reservation) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
            <p className="font-medium text-lg text-muted-foreground">Loading reservation...</p>
          </div>
        </div>
      </div>
    )
  }

  if (reservation.status !== "approved") {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="mb-2 font-bold text-2xl">Payment Not Available</h2>
            <p className="mb-6 text-muted-foreground">
              {reservation.status === "confirmed"
                ? "This reservation has already been paid."
                : reservation.status === "cancelled"
                  ? "This reservation has been cancelled."
                  : reservation.status === "pending"
                    ? "This reservation is still awaiting host approval."
                    : "This reservation is not available for payment."}
            </p>
            <Button asChild>
              <Link href="/trips">View My Trips</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const vehicle = reservation.vehicle
  const vehicleImages = (vehicle as any)?.images as
    | Array<{ isPrimary: boolean; imageUrl?: string; r2Key?: string }>
    | undefined
  const primaryImageData = vehicleImages?.find((img) => img.isPrimary) || vehicleImages?.[0]
  const primaryImage =
    (primaryImageData?.r2Key ? r2Url(primaryImageData.r2Key) : primaryImageData?.imageUrl) || ""

  const options: StripeElementsOptions | null = clientSecret
    ? {
        clientSecret,
        appearance: {
          theme: "stripe",
        },
      }
    : null

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-8 font-bold text-4xl">Complete Payment</h1>

      {timeRemaining && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            Payment deadline: {timeRemaining.hours}h {timeRemaining.minutes}m remaining
          </p>
          <p className="text-amber-800 text-sm dark:text-amber-200">
            Complete payment before the deadline or your reservation will be automatically
            cancelled.
          </p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Reservation Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {vehicle && (
                <div className="flex gap-4">
                  {primaryImage && primaryImage.trim() !== "" ? (
                    <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-lg">
                      <Image
                        alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                        className="object-cover"
                        fill
                        sizes="160px"
                        src={primaryImage}
                      />
                    </div>
                  ) : null}
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </h3>
                    {vehicle.address && (
                      <p className="flex items-center gap-1 text-muted-foreground text-sm">
                        <MapPin className="size-3" />
                        {vehicle.address.city}, {vehicle.address.state}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-muted-foreground" />
                    <span className="text-sm">Rental Period</span>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-sm">
                      {formatDateForDisplay(reservation.startDate)} -{" "}
                      {formatDateForDisplay(reservation.endDate)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {reservation.totalDays} {reservation.totalDays === 1 ? "day" : "days"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Information</CardTitle>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
                  {error}
                </div>
              )}

              {isCreatingPayment && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="mr-2 size-6 animate-spin" />
                  <span className="text-muted-foreground">Initializing payment...</span>
                </div>
              )}

              {options && (
                <Elements options={options} stripe={stripePromise}>
                  <PaymentForm
                    reservationId={reservationId!}
                    totalAmount={reservation.totalAmount || 0}
                  />
                </Elements>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Daily Rate</span>
                  <span>${(reservation.dailyRate || 0).toLocaleString()}/day</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Duration</span>
                  <span>
                    {reservation.totalDays} {reservation.totalDays === 1 ? "day" : "days"}
                  </span>
                </div>
                {reservation.addOns &&
                  reservation.addOns.length > 0 &&
                  reservation.addOns.map((addOn: { name: string; price: number }) => (
                    <div className="flex justify-between text-sm" key={addOn.name}>
                      <span className="text-muted-foreground">{addOn.name}</span>
                      <span>+${addOn.price.toLocaleString()}</span>
                    </div>
                  ))}
                <Separator />
                <div className="flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold text-lg">
                    ${(reservation.totalAmount || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
              <p className="font-medium text-lg text-muted-foreground">Loading...</p>
            </div>
          </div>
        </div>
      }
    >
      <PayPageContent />
    </Suspense>
  )
}
