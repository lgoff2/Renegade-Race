"use client"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { useQuery } from "convex/react"
import { Calendar, MapPin, Send } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { formatDateForDisplay } from "@/lib/date-utils"
import { r2Url } from "@/lib/r2-url"

function RequestSentContent() {
  const searchParams = useSearchParams()
  const reservationId = searchParams.get("reservationId")

  const reservation = useQuery(
    api.reservations.getById,
    reservationId ? { id: reservationId as Id<"reservations"> } : "skip"
  )

  if (!reservationId) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="mb-2 font-bold text-2xl">Invalid Request</h2>
            <p className="mb-6 text-muted-foreground">Reservation ID is missing</p>
            <Button asChild>
              <Link href="/vehicles">Browse Vehicles</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!reservation) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Loading reservation details...</p>
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

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Card>
        <CardContent className="py-12">
          <div className="mx-auto max-w-2xl text-center">
            <Send className="mx-auto mb-4 size-16 text-blue-500" />
            <h1 className="mb-2 font-bold text-4xl">Request Submitted!</h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Your rental request has been sent to the host. They will review your request and get
              back to you soon.
            </p>

            <div className="mb-8 rounded-lg border bg-muted/50 p-6 text-left">
              {vehicle && (
                <div className="mb-6 flex gap-4">
                  {primaryImage && primaryImage.trim() !== "" ? (
                    <div className="relative h-32 w-48 shrink-0 overflow-hidden rounded-lg">
                      <Image
                        alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                        className="object-cover"
                        fill
                        sizes="192px"
                        src={primaryImage}
                      />
                    </div>
                  ) : null}
                  <div className="flex-1">
                    <h2 className="mb-2 font-bold text-2xl">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </h2>
                    {vehicle.address && (
                      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                        <MapPin className="size-4" />
                        <span>
                          {vehicle.address.street}, {vehicle.address.city}, {vehicle.address.state}{" "}
                          {vehicle.address.zipCode}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Separator className="mb-6" />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-5 text-muted-foreground" />
                    <span className="font-medium">Rental Period</span>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      {formatDateForDisplay(reservation.startDate)} -{" "}
                      {formatDateForDisplay(reservation.endDate)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {reservation.totalDays} {reservation.totalDays === 1 ? "day" : "days"}
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="font-medium">Estimated Total</span>
                  <span className="font-bold text-2xl">
                    ${(reservation.totalAmount || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-left text-sm dark:border-blue-800 dark:bg-blue-950/50">
              <p className="font-medium text-blue-900 dark:text-blue-100">What happens next?</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-blue-800 dark:text-blue-200">
                <li>The host will review your request</li>
                <li>You can message the host while you wait</li>
                <li>If approved, you'll have 48 hours to complete payment</li>
                <li>No payment is required until the host approves</li>
              </ul>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button asChild size="lg">
                <Link href="/trips">View My Trips</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/messages">Messages</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function RequestSentPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Loading...</p>
            </CardContent>
          </Card>
        </div>
      }
    >
      <RequestSentContent />
    </Suspense>
  )
}
