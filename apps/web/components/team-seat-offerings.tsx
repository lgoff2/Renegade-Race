"use client"

import { useUser } from "@clerk/nextjs"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { useMutation, useQuery } from "convex/react"
import {
  CalendarDays,
  Car,
  Check,
  Clock,
  DollarSign,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Power,
  Users,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { api, type Id } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import { classesMatch, reliabilitySummaryLine } from "@/lib/reliability"
import {
  formatSeatPrice,
  seatAvailabilityLabel,
  type TeamSeatOfferingView,
  teamCarLabel,
  visibleTeamSeatOfferings,
} from "@/lib/team-seat-offerings"
import { TeamSeatListingDialog } from "./team-seat-listing-dialog"
import { TeamSeatRequestDialog } from "./team-seat-request-dialog"

type TeamSeatOfferingCardProps = {
  offering: TeamSeatOfferingView
  canManage: boolean
  isUpdating?: boolean
  reliabilityLine?: string
  onRequest?: (offering: TeamSeatOfferingView) => void
  onToggleActive?: (offering: TeamSeatOfferingView) => void
}

function formatRaceDate(startDate?: string, endDate?: string): string {
  if (!startDate) return "Dates to be announced"
  const start = new Date(`${startDate}T00:00:00`)
  const end = endDate ? new Date(`${endDate}T00:00:00`) : start
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return startDate === endDate ? endLabel : `${startLabel} – ${endLabel}`
}

export function TeamSeatOfferingCard({
  offering,
  canManage,
  isUpdating = false,
  reliabilityLine,
  onRequest,
  onToggleActive,
}: TeamSeatOfferingCardProps) {
  const eventLocation = [offering.event?.trackName, offering.event?.trackLocation]
    .filter(Boolean)
    .join(" · ")

  return (
    <Card className={offering.isActive ? undefined : "border-dashed opacity-75"}>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{offering.title}</CardTitle>
            <p className="mt-1 text-muted-foreground text-sm">
              {offering.event?.name ?? "Race event"}
            </p>
            {reliabilityLine && <p className="mt-2 text-sm">{reliabilityLine}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!offering.isActive && <Badge variant="secondary">Unpublished</Badge>}
            <Badge variant={offering.inventory.remaining > 0 ? "default" : "outline"}>
              {seatAvailabilityLabel(offering)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{formatRaceDate(offering.event?.startDate, offering.event?.endDate)}</span>
          </div>
          <div className="flex items-start gap-2">
            <Car className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{teamCarLabel(offering)}</span>
          </div>
          {eventLocation && (
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{eventLocation}</span>
            </div>
          )}
          {offering.teamCar?.carClass && (
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>Class {offering.teamCar.carClass}</span>
            </div>
          )}
        </div>

        {offering.description && (
          <p className="text-muted-foreground leading-relaxed">{offering.description}</p>
        )}

        {offering.stintNotes && (
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Clock className="size-4 text-primary" />
              Stint and schedule notes
            </div>
            <p className="text-muted-foreground">{offering.stintNotes}</p>
          </div>
        )}

        <Separator />

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <DollarSign className="size-4 text-primary" />
              <span className="font-bold text-2xl">{formatSeatPrice(offering.priceCents)}</span>
            </div>
            <p className="text-muted-foreground text-sm">
              {formatSeatPrice(offering.depositCents)} deposit
              {offering.experienceLevel
                ? ` · ${offering.experienceLevel[0]?.toUpperCase()}${offering.experienceLevel.slice(1)} experience`
                : ""}
            </p>
          </div>

          {canManage ? (
            <Button
              disabled={isUpdating}
              onClick={() => onToggleActive?.(offering)}
              type="button"
              variant="outline"
            >
              {isUpdating ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Power className="mr-2 size-4" />
              )}
              {offering.isActive ? "Unpublish" : "Publish"}
            </Button>
          ) : (
            <Button onClick={() => onRequest?.(offering)} type="button">
              {offering.inventory.remaining > 0 ? "Request this seat" : "Join waitlist"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function reliabilityLineFor(
  offering: TeamSeatOfferingView,
  groups:
    | Array<{
        seriesId: string
        seriesName: string
        className: string
        starts: number
        dnfs: number
        avgLapsPct: number
        typicalFinishLabel: string
      }>
    | undefined
) {
  const seriesId = offering.event?.seriesId
  const carClass = offering.teamCar?.carClass
  if (!(seriesId && carClass && groups)) return
  const match = groups.find(
    (group) => group.seriesId === seriesId && classesMatch(group.className, carClass)
  )
  return match ? reliabilitySummaryLine(match) : undefined
}

type TeamSeatOfferingsProps = {
  teamId: Id<"teams">
  isOwner: boolean
}

type TeamSeatRequestView = {
  _id: Id<"seatBookings">
  status: "pending" | "waitlisted"
  availableStartDate: string
  availableEndDate: string
  driverExperience: string
  budgetBand: string
  seriesClass: string
  whyBuying: string
  conversationId?: Id<"conversations"> | null
  driver?: { name?: string; email?: string } | null
  offering?: { title?: string } | null
  event?: { name?: string } | null
}

export function TeamSeatOfferings({ teamId, isOwner }: TeamSeatOfferingsProps) {
  const { isSignedIn } = useUser()
  const router = useRouter()
  const offeringsResult = useQuery(api.seatOfferings.listByTeam, {
    teamId,
    includeInactive: isOwner,
  })
  const reliability = useQuery(api.reliability.getForTeam, { teamId })
  const upcomingEventsResult = useQuery(api.raceEvents.listUpcoming, {})
  const currentUser = useQuery(api.users.current)
  const pendingBookings = useQuery(
    api.seatBookings.getPendingForTeam,
    isOwner ? { teamId } : "skip"
  )
  const updateOffering = useMutation(api.seatOfferings.update)
  const approveBooking = useMutation(api.seatBookings.approve)
  const declineBooking = useMutation(api.seatBookings.decline)

  const [listingOpen, setListingOpen] = useState(false)
  const [selectedOffering, setSelectedOffering] = useState<TeamSeatOfferingView | null>(null)
  const [updatingOfferingId, setUpdatingOfferingId] = useState<Id<"seatOfferings"> | null>(null)
  const [updatingBookingId, setUpdatingBookingId] = useState<Id<"seatBookings"> | null>(null)

  const offerings = (offeringsResult ?? []) as unknown as TeamSeatOfferingView[]
  const visibleOfferings = visibleTeamSeatOfferings(offerings, { canManage: isOwner })
  const teamSeatRequests = (pendingBookings ?? []) as unknown as TeamSeatRequestView[]
  const upcomingEvents = (upcomingEventsResult ?? []) as Array<{
    _id: Id<"raceEvents">
    name: string
    startDate: string
    endDate: string
    trackName?: string
    series?: { name?: string } | null
  }>
  const stripeReady = Boolean(
    isOwner && currentUser?.stripeAccountId && currentUser.stripeAccountStatus === "enabled"
  )

  const handleRequest = (offering: TeamSeatOfferingView) => {
    if (!isSignedIn) {
      const next = `/motorsports/teams/${teamId}`
      router.push(`/sign-in?redirect_url=${encodeURIComponent(next)}`)
      return
    }
    setSelectedOffering(offering)
  }

  const handleToggleActive = async (offering: TeamSeatOfferingView) => {
    setUpdatingOfferingId(offering._id)
    try {
      await updateOffering({ offeringId: offering._id, isActive: !offering.isActive })
      toast.success(offering.isActive ? "Race seat unpublished." : "Race seat published.")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "update race seat",
        customMessages: { generic: "We couldn't update this race seat." },
      })
    } finally {
      setUpdatingOfferingId(null)
    }
  }

  const handleBookingDecision = async (
    bookingId: Id<"seatBookings">,
    decision: "approve" | "decline"
  ) => {
    setUpdatingBookingId(bookingId)
    try {
      if (decision === "approve") {
        await approveBooking({ bookingId })
        toast.success("Seat request approved. The driver can now pay the deposit.")
      } else {
        await declineBooking({ bookingId })
        toast.success("Seat request declined.")
      }
    } catch (error) {
      handleErrorWithContext(error, {
        action: `${decision} race seat request`,
        customMessages: { generic: `We couldn't ${decision} this request.` },
      })
    } finally {
      setUpdatingBookingId(null)
    }
  }

  let offeringsContent: ReactNode
  if (offeringsResult === undefined) {
    offeringsContent = (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  } else if (visibleOfferings.length === 0) {
    offeringsContent = (
      <Card>
        <CardContent className="py-10 text-center">
          <Car className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No race seats listed right now</p>
          <p className="mt-1 text-muted-foreground text-sm">
            {isOwner
              ? "Publish an event-specific seat when your next driver opportunity is ready."
              : "Check back as the team adds cars and events."}
          </p>
        </CardContent>
      </Card>
    )
  } else {
    offeringsContent = (
      <div className="space-y-4">
        {visibleOfferings.map((offering) => (
          <TeamSeatOfferingCard
            canManage={isOwner}
            isUpdating={updatingOfferingId === offering._id}
            key={offering._id}
            offering={offering}
            onRequest={handleRequest}
            onToggleActive={handleToggleActive}
            reliabilityLine={reliabilityLineFor(offering, reliability)}
          />
        ))}
      </div>
    )
  }

  return (
    <section className="space-y-6" id="race-seats">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="font-medium text-primary text-sm uppercase tracking-wider">
            Endurance racing
          </p>
          <h2 className="mt-1 font-semibold text-2xl">Available race seats</h2>
          <p className="mt-1 text-muted-foreground">
            Event-specific paid seats are separate from general openings on the team roster.
          </p>
        </div>
        {isOwner && (
          <Button onClick={() => setListingOpen(true)}>
            <Plus className="mr-2 size-4" />
            List a race seat
          </Button>
        )}
      </div>

      {offeringsContent}

      {isOwner && teamSeatRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Seat requests</CardTitle>
            <p className="text-muted-foreground text-sm">
              Review pending drivers and waitlisted requests for this team.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {teamSeatRequests.map((booking) => {
              const driverName =
                booking.driver?.name || booking.driver?.email || "Prospective driver"
              const isUpdating = updatingBookingId === booking._id
              return (
                <div className="space-y-3 rounded-lg border p-4" key={booking._id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{driverName}</p>
                        <Badge variant={booking.status === "waitlisted" ? "outline" : "secondary"}>
                          {booking.status === "waitlisted" ? "Waitlisted" : "Pending"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground text-sm">
                        {booking.offering?.title ?? "Race seat"} ·{" "}
                        {booking.event?.name ?? "Race event"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {booking.conversationId && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/messages/${booking.conversationId}`}>
                            <MessageSquare className="mr-2 size-4" />
                            Message
                          </Link>
                        </Button>
                      )}
                      <Button
                        disabled={isUpdating}
                        onClick={() => handleBookingDecision(booking._id, "decline")}
                        size="sm"
                        variant="outline"
                      >
                        <X className="mr-2 size-4" />
                        Decline
                      </Button>
                      <Button
                        disabled={isUpdating}
                        onClick={() => handleBookingDecision(booking._id, "approve")}
                        size="sm"
                      >
                        {isUpdating ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 size-4" />
                        )}
                        Approve
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p>
                      <span className="font-medium">Experience:</span> {booking.driverExperience}
                    </p>
                    <p>
                      <span className="font-medium">Budget:</span> {booking.budgetBand}
                    </p>
                    <p>
                      <span className="font-medium">Series/class:</span> {booking.seriesClass}
                    </p>
                    <p>
                      <span className="font-medium">Available:</span> {booking.availableStartDate} –{" "}
                      {booking.availableEndDate}
                    </p>
                  </div>
                  <p className="text-muted-foreground text-sm">{booking.whyBuying}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {selectedOffering && (
        <TeamSeatRequestDialog
          offering={selectedOffering}
          onOpenChange={(open) => {
            if (!open) setSelectedOffering(null)
          }}
          open
        />
      )}

      {isOwner && (
        <TeamSeatListingDialog
          events={upcomingEvents}
          onOpenChange={setListingOpen}
          open={listingOpen}
          stripeReady={stripeReady}
          teamId={teamId}
        />
      )}
    </section>
  )
}
