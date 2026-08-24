"use client"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { useMutation, useQuery } from "convex/react"
import { format, formatDistanceToNow } from "date-fns"
import {
  Calendar,
  Car,
  Clock,
  CreditCard,
  DollarSign,
  ExternalLink,
  MapPin,
  MessageSquare,
  Package,
  Star,
  User,
  XCircle,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DetailPageLayout } from "@/components/detail-page-layout"
import { LoadingState } from "@/components/loading-state"
import { StatusBadge } from "@/components/status-badge"
import { UserAvatar } from "@/components/user-avatar"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import { r2Url } from "@/lib/r2-url"

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount / 100)

type ReservationData = NonNullable<ReturnType<typeof useQuery<typeof api.reservations.getById>>>

type VehicleWithImages = NonNullable<ReservationData["vehicle"]> & {
  images?: Array<{ isPrimary: boolean; r2Key?: string; imageUrl?: string }>
  track?: { name: string; location?: string }
}

function SummaryCards({ reservation }: { reservation: ReservationData }) {
  const addOnsTotal =
    reservation.addOns?.reduce((sum: number, addon: { price: number; priceType?: string }) => {
      if (addon.priceType === "daily") {
        return sum + addon.price * reservation.totalDays
      }
      return sum + addon.price
    }, 0) ?? 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <p className="font-medium text-muted-foreground text-sm">Total Amount</p>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
              <DollarSign className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            </div>
          </div>
          <p className="mt-3 font-bold text-2xl tracking-tight">
            {formatCurrency(reservation.totalAmount)}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {formatCurrency(reservation.dailyRate)}/day
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <p className="font-medium text-muted-foreground text-sm">Duration</p>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Calendar className="h-4 w-4 text-blue-700 dark:text-blue-400" />
            </div>
          </div>
          <p className="mt-3 font-bold text-2xl tracking-tight">
            {reservation.totalDays} {reservation.totalDays === 1 ? "day" : "days"}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {format(new Date(reservation.startDate), "MMM d")} -{" "}
            {format(new Date(reservation.endDate), "MMM d, yyyy")}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <p className="font-medium text-muted-foreground text-sm">Status</p>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div className="mt-3">
            <StatusBadge className="text-sm" status={reservation.status} />
          </div>
          <p className="mt-2 text-muted-foreground text-xs">
            Created {formatDistanceToNow(reservation.createdAt, { addSuffix: true })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <p className="font-medium text-muted-foreground text-sm">Add-ons</p>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <Package className="h-4 w-4 text-purple-700 dark:text-purple-400" />
            </div>
          </div>
          <p className="mt-3 font-bold text-2xl tracking-tight">
            {reservation.addOns?.length ?? 0}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {addOnsTotal > 0 ? formatCurrency(addOnsTotal) : "None selected"}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function BookingDetailsCard({ reservation }: { reservation: ReservationData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4" />
          Booking Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Rental start
            </p>
            <p className="mt-2 font-semibold">
              {format(new Date(reservation.startDate), "EEEE, MMMM d, yyyy")}
            </p>
            {reservation.pickupTime && (
              <p className="mt-1 text-muted-foreground text-sm">{reservation.pickupTime}</p>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Last day
            </p>
            <p className="mt-2 font-semibold">
              {format(new Date(reservation.endDate), "EEEE, MMMM d, yyyy")}
            </p>
            {reservation.dropoffTime && (
              <p className="mt-1 text-muted-foreground text-sm">{reservation.dropoffTime}</p>
            )}
          </div>
        </div>
        <Separator />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Created</span>
            <span className="font-medium">{format(reservation.createdAt, "PPp")}</span>
          </div>
          {reservation.approvedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Approved</span>
              <span className="font-medium">{format(reservation.approvedAt, "PPp")}</span>
            </div>
          )}
          {reservation.updatedAt && reservation.updatedAt !== reservation.createdAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Last Updated</span>
              <span className="font-medium">{format(reservation.updatedAt, "PPp")}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function PaymentBreakdownCard({ reservation }: { reservation: ReservationData }) {
  const baseAmount = reservation.dailyRate * reservation.totalDays

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" />
          Payment Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {formatCurrency(reservation.dailyRate)} x {reservation.totalDays}{" "}
              {reservation.totalDays === 1 ? "day" : "days"}
            </span>
            <span className="font-medium">{formatCurrency(baseAmount)}</span>
          </div>
          {reservation.addOns &&
            reservation.addOns.length > 0 &&
            reservation.addOns.map(
              (
                addon: {
                  name: string
                  price: number
                  description?: string
                  priceType?: string
                },
                index: number
              ) => (
                <div className="flex justify-between text-sm" key={index}>
                  <span className="text-muted-foreground">
                    {addon.name}
                    {addon.priceType === "daily"
                      ? ` (${formatCurrency(addon.price)}/day x ${reservation.totalDays})`
                      : ""}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(
                      addon.priceType === "daily"
                        ? addon.price * reservation.totalDays
                        : addon.price
                    )}
                  </span>
                </div>
              )
            )}
          <Separator />
          <div className="flex justify-between">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-lg">{formatCurrency(reservation.totalAmount)}</span>
          </div>
          {reservation.paymentStatus && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payment Status</span>
                <StatusBadge status={reservation.paymentStatus} />
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MessagesCard({ reservation }: { reservation: ReservationData }) {
  if (!(reservation.renterMessage || reservation.ownerMessage || reservation.cancellationReason)) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          Messages
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {reservation.renterMessage && (
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Renter Message
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {reservation.renterMessage}
            </p>
          </div>
        )}
        {reservation.ownerMessage && (
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Owner Message
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {reservation.ownerMessage}
            </p>
          </div>
        )}
        {reservation.cancellationReason && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
            <p className="mb-1 font-medium text-red-700 text-xs uppercase tracking-wider dark:text-red-400">
              Cancellation Reason
            </p>
            <p className="whitespace-pre-wrap text-red-700 text-sm leading-relaxed dark:text-red-300">
              {reservation.cancellationReason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function VehicleCard({ reservation }: { reservation: ReservationData }) {
  const router = useRouter()
  const vehicleWithImages = reservation.vehicle as VehicleWithImages | null
  const primaryImage =
    vehicleWithImages?.images?.find((img) => img.isPrimary) || vehicleWithImages?.images?.[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Car className="h-4 w-4" />
          Vehicle
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {primaryImage && (
          <img
            alt={`${reservation.vehicle?.make} ${reservation.vehicle?.model}`}
            className="h-40 w-full rounded-lg object-cover"
            src={primaryImage.r2Key ? r2Url(primaryImage.r2Key) : primaryImage.imageUrl}
          />
        )}
        <div>
          <p className="font-semibold">
            {reservation.vehicle?.year} {reservation.vehicle?.make} {reservation.vehicle?.model}
          </p>
          {vehicleWithImages?.track && (
            <div className="mt-1 flex items-center gap-1 text-muted-foreground text-sm">
              <MapPin className="h-3.5 w-3.5" />
              <span>{vehicleWithImages.track.name}</span>
            </div>
          )}
        </div>
        {reservation.vehicle && (
          <Button
            className="w-full"
            onClick={() => router.push(`/vehicles/${reservation.vehicle?._id}`)}
            size="sm"
            variant="outline"
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            View Vehicle
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function UserCard({
  user,
  label,
  badgeLabel,
}: {
  user: ReservationData["renter"] | ReservationData["owner"]
  label: string
  badgeLabel: string
}) {
  const router = useRouter()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <UserAvatar email={user?.email} name={user?.name} />
          <Badge className="ml-auto px-1.5 py-0 text-[10px]" variant="outline">
            {badgeLabel}
          </Badge>
        </div>
        {user?.phone && <p className="text-muted-foreground text-sm">{user.phone}</p>}
        {user?.rating && (
          <div className="flex items-center gap-1.5 text-sm">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="font-medium">{user.rating}</span>
            <span className="text-muted-foreground">rating</span>
          </div>
        )}
        {user && (
          <Button
            className="w-full"
            onClick={() => router.push(`/users/${user.externalId}`)}
            size="sm"
            variant="outline"
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            View Profile
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function ReservationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const reservationId = params.id as Id<"reservations">
  const reservation = useQuery(api.reservations.getById, { id: reservationId })
  const cancelReservation = useMutation(api.admin.cancelReservationAsAdmin)

  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const handleCancel = async () => {
    setIsCancelling(true)
    try {
      await cancelReservation({ reservationId })
      toast.success("Reservation cancelled successfully")
      setCancelConfirm(false)
      router.push("/reservations")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "cancel reservation",
        entity: "reservation",
      })
    } finally {
      setIsCancelling(false)
    }
  }

  if (reservation === undefined) {
    return <LoadingState message="Loading reservation..." />
  }

  if (reservation === null) {
    return (
      <DetailPageLayout title="Reservation Not Found">
        <p className="text-muted-foreground">This reservation could not be found.</p>
      </DetailPageLayout>
    )
  }

  const canCancel =
    reservation.status !== "cancelled" &&
    reservation.status !== "completed" &&
    reservation.status !== "declined"

  return (
    <DetailPageLayout
      actions={
        canCancel ? (
          <Button onClick={() => setCancelConfirm(true)} variant="destructive">
            <XCircle className="mr-2 h-4 w-4" />
            Cancel Reservation
          </Button>
        ) : undefined
      }
      badges={
        <div className="flex items-center gap-2">
          <StatusBadge status={reservation.status} />
          {reservation.paymentStatus && <StatusBadge status={reservation.paymentStatus} />}
        </div>
      }
      title={`Reservation ${reservation._id.slice(-8).toUpperCase()}`}
    >
      <SummaryCards reservation={reservation} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <BookingDetailsCard reservation={reservation} />
          <PaymentBreakdownCard reservation={reservation} />
          <MessagesCard reservation={reservation} />
        </div>

        <div className="space-y-6">
          <VehicleCard reservation={reservation} />
          <UserCard badgeLabel="driver" label="Renter" user={reservation.renter} />
          <UserCard badgeLabel="host" label="Owner" user={reservation.owner} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reservation ID</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="break-all font-mono text-muted-foreground text-xs">{reservation._id}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        confirmLabel="Cancel Reservation"
        description="Are you sure you want to cancel this reservation? This action cannot be undone and the renter will be notified."
        isLoading={isCancelling}
        onConfirm={handleCancel}
        onOpenChange={setCancelConfirm}
        open={cancelConfirm}
        title="Cancel Reservation"
        variant="destructive"
      />
    </DetailPageLayout>
  )
}
