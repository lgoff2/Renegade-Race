"use client"

import { useUser } from "@clerk/nextjs"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useQuery } from "convex/react"
import {
  ArrowDownUp,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FlagTriangleRight,
  GraduationCap,
  Search,
  Send,
  Star,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { CoachCancelDialog } from "@/components/coach-cancel-dialog"
import { CoachReviewDialog } from "@/components/coach-review-dialog"
import { SeatBookingsList } from "@/components/seat-bookings-list"
import { TripCard } from "@/components/trip-card"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { r2Url } from "@/lib/r2-url"

type Trip = {
  reservationId: Id<"reservations">
  vehicleId: Id<"vehicles">
  vehicleName: string
  vehicleImage: string
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  location: string
  startDate: string
  endDate: string
  pickupTime?: string
  dropoffTime?: string
  totalDays: number
  dailyRate: number
  totalAmount: number
  status: "pending" | "approved" | "confirmed" | "cancelled" | "completed" | "declined"
  addOns?: Array<{ name: string; price: number; description?: string }>
}

function mapReservation(res: any): Trip | null {
  const vehicle = res.vehicle
  if (!vehicle) {
    return null
  }
  const primaryImage = vehicle.images?.find((img: any) => img.isPrimary) || vehicle.images?.[0]
  return {
    reservationId: res._id,
    vehicleId: vehicle._id,
    vehicleName: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    vehicleImage: primaryImage?.r2Key ? r2Url(primaryImage.r2Key) : "",
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    location: vehicle.track?.location || vehicle.track?.name || "Location TBD",
    startDate: res.startDate,
    endDate: res.endDate,
    pickupTime: res.pickupTime,
    dropoffTime: res.dropoffTime,
    totalDays: res.totalDays,
    dailyRate: res.dailyRate,
    totalAmount: res.totalAmount,
    status: res.status,
    addOns: res.addOns,
  }
}

function SkeletonCard() {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className="h-44 w-full shrink-0 animate-pulse bg-muted sm:h-auto sm:w-60 md:w-72" />
        <CardContent className="flex flex-1 flex-col gap-3 p-5">
          <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-auto flex gap-2 border-t pt-4">
            <div className="h-9 w-28 animate-pulse rounded bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </div>
    </Card>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
  showBrowse = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  showBrowse?: boolean
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center py-16 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
          <Icon className="size-7 text-muted-foreground" />
        </div>
        <p className="mb-1 font-semibold text-lg">{title}</p>
        <p className="mb-6 max-w-sm text-muted-foreground text-sm">{description}</p>
        {showBrowse && (
          <Link href="/vehicles">
            <Button>Browse Vehicles</Button>
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-5 text-primary" />
      </div>
      <div>
        <p className="font-bold text-2xl leading-none">{value}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">{label}</p>
      </div>
    </div>
  )
}

function TripList({
  trips,
  searchQuery,
  sortDirection,
}: {
  trips: Trip[]
  searchQuery: string
  sortDirection: "asc" | "desc"
}) {
  const filtered = useMemo(() => {
    let result = trips
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((t) => t.vehicleName.toLowerCase().includes(q))
    }
    return result.sort((a, b) =>
      sortDirection === "asc"
        ? a.startDate.localeCompare(b.startDate)
        : b.startDate.localeCompare(a.startDate)
    )
  }, [trips, searchQuery, sortDirection])

  if (filtered.length === 0 && searchQuery.trim()) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        No trips match &ldquo;{searchQuery}&rdquo;
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {filtered.map((trip) => (
        <TripCard key={trip.reservationId} {...trip} />
      ))}
    </div>
  )
}

const coachingStatusVariant: Record<string, { label: string; className: string }> = {
  pending: { label: "Awaiting coach", className: "" },
  approved: {
    label: "Approved — pay to confirm",
    className: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  },
  confirmed: {
    label: "Confirmed",
    className: "bg-green-500/15 text-green-900 dark:text-green-200",
  },
  completed: { label: "Completed", className: "" },
  cancelled: { label: "Cancelled", className: "" },
  declined: { label: "Declined", className: "" },
  expired: { label: "Expired — not paid in time", className: "" },
}

function coachingSessionLabel(b: any) {
  if (b.sessionType === "hourly") return `${b.hours}-hour session`
  if (b.sessionType === "half_day") return "Half-day session"
  return "Full-day session"
}

function CoachingBookingRow({ booking }: { booking: any }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const variant = coachingStatusVariant[booking.status] || coachingStatusVariant.pending
  const isCompleted = booking.status === "completed"
  const isCancellable =
    booking.status === "pending" || booking.status === "approved" || booking.status === "confirmed"

  const existingReview = useQuery(
    api.coachingReviews.getByBooking,
    isCompleted ? { bookingId: booking._id as Id<"coachingBookings"> } : "skip"
  )

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <GraduationCap className="size-4 text-muted-foreground" />
            <Link
              className="font-semibold hover:underline"
              href={`/coaches/${booking.coachProfileId}`}
            >
              {booking.coach?.name || "Coach"}
            </Link>
            <Badge className={variant?.className} variant="outline">
              {variant?.label}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {coachingSessionLabel(booking)} ·{" "}
            {new Date(`${booking.startDate}T00:00:00`).toLocaleDateString()}
            {booking.startTime ? ` · ${booking.startTime}` : ""}
          </p>
          {booking.eventName && (
            <p className="text-muted-foreground text-sm">{booking.eventName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold">${(booking.totalAmount / 100).toFixed(0)}</span>
          {booking.status === "approved" && (
            <Button asChild size="sm">
              <Link href={`/checkout/pay-coaching?bookingId=${booking._id}`}>
                <CreditCard className="mr-2 size-4" />
                Pay
              </Link>
            </Button>
          )}
          {isCancellable && (
            <>
              <Button onClick={() => setCancelOpen(true)} size="sm" variant="ghost">
                Cancel
              </Button>
              <CoachCancelDialog
                actorRole="renter"
                bookingId={booking._id as Id<"coachingBookings">}
                onOpenChange={setCancelOpen}
                open={cancelOpen}
                paymentStatus={booking.paymentStatus}
                startDate={booking.startDate}
                startTime={booking.startTime}
                status={booking.status}
                totalAmount={booking.totalAmount}
              />
            </>
          )}
          {isCompleted &&
            (existingReview ? (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <Star className="size-4 fill-primary text-primary" />
                Reviewed
              </span>
            ) : (
              existingReview === null && (
                <>
                  <Button onClick={() => setReviewOpen(true)} size="sm" variant="outline">
                    <Star className="mr-2 size-4" />
                    Leave a review
                  </Button>
                  <CoachReviewDialog
                    bookingId={booking._id as Id<"coachingBookings">}
                    coachName={booking.coach?.name || "your coach"}
                    onOpenChange={setReviewOpen}
                    open={reviewOpen}
                  />
                </>
              )
            ))}
        </div>
      </CardContent>
    </Card>
  )
}

function CoachingBookingsList({ coachingData }: { coachingData: any[] | undefined }) {
  if (coachingData === undefined) {
    return <p className="py-12 text-center text-muted-foreground">Loading coaching sessions…</p>
  }
  if (coachingData.length === 0) {
    return (
      <EmptyState
        description="Book a coach to elevate your next track day."
        icon={GraduationCap}
        title="No coaching sessions yet"
      />
    )
  }

  return (
    <div className="space-y-3">
      {coachingData.map((b) => (
        <CoachingBookingRow booking={b} key={b._id} />
      ))}
    </div>
  )
}

export default function TripsPage() {
  const { user } = useUser()
  const [searchQuery, setSearchQuery] = useState("")
  const [requestsSort, setRequestsSort] = useState<"asc" | "desc">("desc")
  const [upcomingSort, setUpcomingSort] = useState<"asc" | "desc">("asc")
  const [pastSort, setPastSort] = useState<"asc" | "desc">("desc")
  const [cancelledSort, setCancelledSort] = useState<"asc" | "desc">("desc")

  const reservationsData = useQuery(
    api.reservations.getByUser,
    user?.id ? { userId: user.id, role: "renter" as const } : "skip"
  )

  const coachingData = useQuery(
    api.coachingBookings.getByUser,
    user?.id ? { userId: user.id, role: "renter" as const } : "skip"
  )

  const seatData = useQuery(api.seatBookings.getByDriver, user?.id ? {} : "skip")

  const { pendingRequests, awaitingPayment, upcoming, past, cancelled } = useMemo(() => {
    if (!reservationsData) {
      return { pendingRequests: [], awaitingPayment: [], upcoming: [], past: [], cancelled: [] }
    }
    const today = new Date().toISOString().split("T")[0]
    const all = reservationsData.map(mapReservation).filter(Boolean) as Trip[]

    return {
      pendingRequests: all.filter((t) => t.status === "pending"),
      awaitingPayment: all.filter((t) => t.status === "approved"),
      upcoming: all.filter((t) => t.status === "confirmed" && t.endDate >= (today ?? "")),
      past: all.filter(
        (t) => t.status === "completed" || (t.endDate < (today ?? "") && t.status === "confirmed")
      ),
      cancelled: all.filter((t) => t.status === "cancelled" || t.status === "declined"),
    }
  }, [reservationsData])

  const isLoading = reservationsData === undefined
  const totalTrips =
    pendingRequests.length +
    awaitingPayment.length +
    upcoming.length +
    past.length +
    cancelled.length

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="mb-1 font-bold text-3xl tracking-tight">My Trips</h1>
        <p className="text-muted-foreground">
          {isLoading
            ? "Loading your trips..."
            : totalTrips === 0
              ? "Manage your reservations and review past experiences"
              : `${pendingRequests.length + awaitingPayment.length > 0 ? `${pendingRequests.length + awaitingPayment.length} pending, ` : ""}${upcoming.length} upcoming, ${past.length} past`}
        </p>
      </div>

      {/* Stats */}
      {!isLoading && totalTrips > 0 && (
        <div className="mb-8 grid grid-cols-3 gap-3">
          <StatCard icon={FlagTriangleRight} label="Total Trips" value={totalTrips} />
          <StatCard icon={Clock} label="Upcoming" value={upcoming.length} />
          <StatCard icon={CheckCircle2} label="Completed" value={past.length} />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Content */}
      {!isLoading && (
        <Tabs
          className="space-y-6"
          defaultValue={
            pendingRequests.length + awaitingPayment.length > 0 ? "requests" : "upcoming"
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              {(pendingRequests.length > 0 || awaitingPayment.length > 0) && (
                <TabsTrigger value="requests">
                  Requests
                  {pendingRequests.length + awaitingPayment.length > 0 &&
                    ` (${pendingRequests.length + awaitingPayment.length})`}
                </TabsTrigger>
              )}
              <TabsTrigger value="upcoming">
                Upcoming{upcoming.length > 0 && ` (${upcoming.length})`}
              </TabsTrigger>
              <TabsTrigger value="past">Past{past.length > 0 && ` (${past.length})`}</TabsTrigger>
              <TabsTrigger value="cancelled">
                Cancelled
                {cancelled.length > 0 && ` (${cancelled.length})`}
              </TabsTrigger>
              <TabsTrigger value="coaching">
                Coaching
                {coachingData && coachingData.length > 0 && ` (${coachingData.length})`}
              </TabsTrigger>
              <TabsTrigger value="seats">
                Race seats
                {seatData && seatData.length > 0 && ` (${seatData.length})`}
              </TabsTrigger>
            </TabsList>

            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by vehicle..."
                value={searchQuery}
              />
            </div>
          </div>

          {/* Requests (pending + approved) */}
          <TabsContent value="requests">
            {awaitingPayment.length > 0 && (
              <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/50">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-5 text-green-600 dark:text-green-400" />
                  <p className="font-medium text-green-900 dark:text-green-100">
                    {awaitingPayment.length} approved{" "}
                    {awaitingPayment.length === 1 ? "request" : "requests"} awaiting payment
                  </p>
                </div>
                <p className="mt-1 text-green-800 text-sm dark:text-green-200">
                  Complete payment within 48 hours to confirm your booking.
                </p>
              </div>
            )}
            {[...awaitingPayment, ...pendingRequests].length > 0 && (
              <div className="mb-4 flex justify-end">
                <Button
                  className="text-muted-foreground text-xs"
                  onClick={() => setRequestsSort((s) => (s === "asc" ? "desc" : "asc"))}
                  size="sm"
                  variant="ghost"
                >
                  <ArrowDownUp className="mr-1.5 size-3.5" />
                  {requestsSort === "desc" ? "Most recent first" : "Oldest first"}
                </Button>
              </div>
            )}
            {[...awaitingPayment, ...pendingRequests].length === 0 && !searchQuery.trim() ? (
              <EmptyState
                description="When you request a rental, it will appear here until the host responds."
                icon={Send}
                title="No pending requests"
              />
            ) : (
              <TripList
                searchQuery={searchQuery}
                sortDirection={requestsSort}
                trips={[...awaitingPayment, ...pendingRequests]}
              />
            )}
          </TabsContent>

          {/* Upcoming */}
          <TabsContent value="upcoming">
            {upcoming.length > 0 && (
              <div className="mb-4 flex justify-end">
                <Button
                  className="text-muted-foreground text-xs"
                  onClick={() => setUpcomingSort((s) => (s === "asc" ? "desc" : "asc"))}
                  size="sm"
                  variant="ghost"
                >
                  <ArrowDownUp className="mr-1.5 size-3.5" />
                  {upcomingSort === "asc" ? "Soonest first" : "Latest first"}
                </Button>
              </div>
            )}
            {upcoming.length === 0 && !searchQuery.trim() ? (
              <EmptyState
                description="Time to book your next track day! Browse our lineup of high-performance vehicles."
                icon={Calendar}
                showBrowse
                title="No upcoming trips"
              />
            ) : (
              <TripList searchQuery={searchQuery} sortDirection={upcomingSort} trips={upcoming} />
            )}
          </TabsContent>

          {/* Past */}
          <TabsContent value="past">
            {past.length > 0 && (
              <div className="mb-4 flex justify-end">
                <Button
                  className="text-muted-foreground text-xs"
                  onClick={() => setPastSort((s) => (s === "asc" ? "desc" : "asc"))}
                  size="sm"
                  variant="ghost"
                >
                  <ArrowDownUp className="mr-1.5 size-3.5" />
                  {pastSort === "desc" ? "Most recent first" : "Oldest first"}
                </Button>
              </div>
            )}
            {past.length === 0 && !searchQuery.trim() ? (
              <EmptyState
                description="Once you complete your first track day rental, it will show up here."
                icon={CheckCircle2}
                title="No completed trips yet"
              />
            ) : (
              <TripList searchQuery={searchQuery} sortDirection={pastSort} trips={past} />
            )}
          </TabsContent>

          {/* Coaching */}
          <TabsContent value="coaching">
            <CoachingBookingsList coachingData={coachingData} />
          </TabsContent>

          <TabsContent value="seats">
            <SeatBookingsList bookings={seatData} />
          </TabsContent>

          {/* Cancelled */}
          <TabsContent value="cancelled">
            {cancelled.length > 0 && (
              <div className="mb-4 flex justify-end">
                <Button
                  className="text-muted-foreground text-xs"
                  onClick={() => setCancelledSort((s) => (s === "asc" ? "desc" : "asc"))}
                  size="sm"
                  variant="ghost"
                >
                  <ArrowDownUp className="mr-1.5 size-3.5" />
                  {cancelledSort === "desc" ? "Most recent first" : "Oldest first"}
                </Button>
              </div>
            )}
            {cancelled.length === 0 && !searchQuery.trim() ? (
              <EmptyState
                description="Any cancelled or declined reservations will appear here."
                icon={XCircle}
                title="No cancelled trips"
              />
            ) : (
              <TripList searchQuery={searchQuery} sortDirection={cancelledSort} trips={cancelled} />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
