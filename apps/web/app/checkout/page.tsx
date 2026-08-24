"use client"

import { useUser } from "@clerk/nextjs"
import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { useMutation, useQuery } from "convex/react"
import { Calendar as CalendarIcon, Check, ChevronDown, Loader2 } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import {
  durationFromDateRange,
  endDateFromDuration,
  formatDateToISO,
  parseLocalDate,
  RENTAL_DURATION_OPTIONS,
  type RentalDurationDays,
} from "@/lib/date-utils"
import { r2Url } from "@/lib/r2-url"

interface AddOn {
  name: string
  price: number
  description?: string
  isRequired?: boolean
}

function CheckoutPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { isSignedIn, user } = useUser()
  const vehicleId = searchParams.get("vehicleId")
  const startDateParam = searchParams.get("startDate")
  const endDateParam = searchParams.get("endDate")

  const vehicle = useQuery(
    api.vehicles.getById,
    vehicleId ? { id: vehicleId as Id<"vehicles"> } : "skip"
  )

  // Fetch blocked dates from availability
  const availability = useQuery(
    api.availability.getByVehicle,
    vehicleId ? { vehicleId: vehicleId as Id<"vehicles"> } : "skip"
  )

  const createReservation = useMutation(api.reservations.create)

  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [durationDays, setDurationDays] = useState<RentalDurationDays>(1)
  const [openStartDate, setOpenStartDate] = useState(false)
  const [renterMessage, setRenterMessage] = useState("")
  const [selectedAddOns, setSelectedAddOns] = useState<AddOn[]>(() => {
    // Auto-select required add-ons if vehicle is loaded
    return vehicle?.addOns?.filter((addOn: AddOn) => addOn.isRequired) || []
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const overlappingReservations = useQuery(
    api.reservations.listActiveForVehicle,
    vehicleId ? { vehicleId: vehicleId as Id<"vehicles"> } : "skip"
  )

  // Update selected add-ons when vehicle loads
  useEffect(() => {
    if (vehicle?.addOns) {
      const requiredAddOns = vehicle.addOns.filter((addOn: AddOn) => addOn.isRequired)
      if (requiredAddOns.length > 0) {
        setSelectedAddOns(requiredAddOns)
      }
    }
  }, [vehicle?.addOns])

  // Initialize start date + duration from URL params if provided
  useEffect(() => {
    if (startDateParam && !startDate) {
      const parsedStart = parseLocalDate(startDateParam)
      if (!parsedStart) return

      parsedStart.setHours(0, 0, 0, 0)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (parsedStart < today) return

      setStartDate(parsedStart)

      if (endDateParam) {
        const parsedEnd = parseLocalDate(endDateParam)
        if (parsedEnd) {
          parsedEnd.setHours(0, 0, 0, 0)
          if (parsedEnd >= parsedStart) {
            setDurationDays(durationFromDateRange(parsedStart, parsedEnd))
          }
        }
      }
    }
  }, [startDateParam, endDateParam, startDate])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const endDate = startDate ? endDateFromDuration(startDate, durationDays) : undefined

  const ownerBlockedDates =
    availability
      ?.filter((item: { isAvailable: boolean; date: string }) => !item.isAvailable)
      .map((item: { date: string }) => parseLocalDate(item.date))
      .filter((d: Date | null): d is Date => d !== null) || []

  const requestedDates = useMemo(() => {
    if (!overlappingReservations) return []
    const dates: Date[] = []
    for (const reservation of overlappingReservations) {
      const rangeStart = parseLocalDate(reservation.startDate)
      const rangeEnd = parseLocalDate(reservation.endDate)
      if (!(rangeStart && rangeEnd)) continue
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d))
      }
    }
    return dates
  }, [overlappingReservations])

  const overlappingOnSelectedDates = useMemo(() => {
    if (!(startDate && endDate && overlappingReservations)) return []
    const startKey = formatDateToISO(startDate)
    const endKey = formatDateToISO(endDate)
    return overlappingReservations.filter(
      (reservation) => reservation.startDate <= endKey && reservation.endDate >= startKey
    )
  }, [startDate, endDate, overlappingReservations])

  const formatDateLabel = (date: Date) =>
    date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })

  // Toggle add-on selection
  const toggleAddOn = (addOn: AddOn) => {
    if (addOn.isRequired) return // Can't deselect required add-ons

    setSelectedAddOns((prev) => {
      const isSelected = prev.some((selected) => selected.name === addOn.name)
      if (isSelected) {
        return prev.filter((selected) => selected.name !== addOn.name)
      }
      return [...prev, addOn]
    })
  }

  // Calculate total days and price
  const calculateTotal = () => {
    if (!(startDate && vehicle)) {
      return { days: 0, total: 0, addOnsTotal: 0 }
    }

    const rentalDays = durationDays
    const addOnsTotal = selectedAddOns.reduce((sum, addOn) => sum + addOn.price, 0)
    return {
      days: rentalDays,
      total: rentalDays * vehicle.dailyRate + addOnsTotal,
      addOnsTotal,
    }
  }

  const { days, total } = calculateTotal()

  const handleSubmitRequest = async () => {
    if (!(isSignedIn && user?.id)) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`)
      return
    }

    if (!(startDate && vehicle)) {
      setError("Please choose a rental start date")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const reservationAddOns =
        selectedAddOns.length > 0
          ? selectedAddOns.map((addOn) => ({
              name: addOn.name,
              price: addOn.price,
              description: addOn.description,
            }))
          : undefined

      const newReservationId = await createReservation({
        vehicleId: vehicle._id,
        startDate: formatDateToISO(startDate),
        durationDays,
        renterMessage: renterMessage.trim() || undefined,
        addOns: reservationAddOns,
      })

      router.push(`/checkout/request-sent?reservationId=${newReservationId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request. Please try again.")
      setIsSubmitting(false)
    }
  }

  // Show loading state
  if (!vehicle && vehicleId) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
            <p className="font-medium text-lg text-muted-foreground">Loading vehicle...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show error if no vehicle
  if (!(vehicle || vehicleId)) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="mb-2 font-bold text-2xl">Vehicle Not Found</h2>
            <p className="mb-6 text-muted-foreground">Please select a vehicle to continue.</p>
            <Button asChild>
              <Link href="/vehicles">Browse Vehicles</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!vehicle) return null

  const vehicleImages = (vehicle as any)?.images as
    | Array<{ isPrimary: boolean; imageUrl?: string; r2Key?: string }>
    | undefined
  const primaryImageData = vehicleImages?.find((img) => img.isPrimary) || vehicleImages?.[0]
  const primaryImage =
    (primaryImageData?.r2Key ? r2Url(primaryImageData.r2Key) : primaryImageData?.imageUrl) || ""
  const isValid = Boolean(startDate && days > 0)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-8 font-bold text-4xl">Request a Rental</h1>

      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Reservation Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
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
                    <p className="text-muted-foreground text-sm">
                      ${vehicle.dailyRate.toLocaleString()}/day
                    </p>
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-4">
                <div>
                  <Label className="mb-2 flex items-center gap-2" htmlFor="rental-start-date">
                    <CalendarIcon className="size-4" />
                    Rental start date
                  </Label>
                  <Popover onOpenChange={setOpenStartDate} open={openStartDate}>
                    <PopoverTrigger asChild>
                      <Button
                        className="h-11 w-full justify-between px-3 py-2 font-normal"
                        id="rental-start-date"
                        variant="outline"
                      >
                        {startDate ? formatDateLabel(startDate) : "Select start date"}
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        disabled={(date: Date) => {
                          const dateStart = new Date(date)
                          dateStart.setHours(0, 0, 0, 0)
                          return dateStart < today
                        }}
                        initialFocus
                        mode="single"
                        modifiers={{
                          blocked: ownerBlockedDates,
                          requested: requestedDates,
                        }}
                        modifiersClassNames={{
                          blocked: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
                          requested:
                            "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400",
                        }}
                        onSelect={(date) => {
                          if (date) {
                            setStartDate(date)
                            setError(null)
                            setOpenStartDate(false)
                          }
                        }}
                        selected={startDate}
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                    {ownerBlockedDates.length > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="size-3 rounded bg-red-100 dark:bg-red-900/20" />
                        <span>Owner marked unavailable</span>
                      </div>
                    )}
                    {requestedDates.length > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="size-3 rounded bg-amber-100 dark:bg-amber-900/20" />
                        <span>Other requests or bookings</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="mb-2">Number of days</Label>
                  <ToggleGroup
                    className="grid w-full grid-cols-3"
                    onValueChange={(value) => {
                      const next = Number(value)
                      if (RENTAL_DURATION_OPTIONS.includes(next as RentalDurationDays)) {
                        setDurationDays(next as RentalDurationDays)
                      }
                    }}
                    size="lg"
                    value={String(durationDays)}
                  >
                    {RENTAL_DURATION_OPTIONS.map((option) => (
                      <ToggleGroupItem className="w-full" key={option} value={String(option)}>
                        {option} {option === 1 ? "day" : "days"}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p className="mt-2 text-muted-foreground text-sm">
                    The car stays at the track. Choose how many days you want, starting on the date
                    above.
                  </p>
                </div>

                {startDate && endDate && (
                  <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                    <p className="font-medium">
                      Starts {formatDateLabel(startDate)} · {durationDays}{" "}
                      {durationDays === 1 ? "day" : "days"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {durationDays === 1
                        ? `Rental day: ${formatDateLabel(startDate)}`
                        : `Rental days: ${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`}
                    </p>
                  </div>
                )}

                {overlappingOnSelectedDates.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    Other requests or bookings exist on some of these days. You can still submit —
                    the owner or admin will decide which request to accept.
                  </div>
                )}
              </div>

              {/* Add-ons Selection */}
              {vehicle.addOns && vehicle.addOns.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <Label className="font-semibold text-base">Add-ons (Optional)</Label>
                    <div className="space-y-2">
                      {vehicle.addOns.map((addOn: AddOn, index: number) => {
                        const isSelected = selectedAddOns.some(
                          (selected) => selected.name === addOn.name
                        )
                        return (
                          <Card
                            className={cn(
                              "cursor-pointer transition-all hover:border-primary",
                              isSelected ? "border-2 border-primary" : ""
                            )}
                            key={`${addOn.name}-${index}`}
                            onClick={() => toggleAddOn(addOn)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <div
                                  className={cn(
                                    "mt-1 flex size-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                                    isSelected
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-muted-foreground"
                                  )}
                                >
                                  {isSelected && <Check className="size-3" />}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-semibold">{addOn.name}</h4>
                                      {addOn.isRequired && (
                                        <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                                          Required
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-semibold">
                                      +${addOn.price.toLocaleString()}
                                    </span>
                                  </div>
                                  {addOn.description && (
                                    <p className="mt-1 text-muted-foreground text-sm">
                                      {addOn.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* Message to Host */}
              <div className="space-y-2">
                <Label htmlFor="renter-message">Message to Host (Optional)</Label>
                <Textarea
                  className="min-h-[100px]"
                  id="renter-message"
                  maxLength={1000}
                  onChange={(e) => setRenterMessage(e.target.value)}
                  placeholder="Introduce yourself, share your experience level, or ask any questions about the vehicle..."
                  value={renterMessage}
                />
                <p className="text-muted-foreground text-xs">
                  {renterMessage.length}/1000 characters
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle>Request Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {days > 0 && startDate && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Rental start</span>
                      <span>{formatDateLabel(startDate)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Daily Rate</span>
                      <span>${vehicle.dailyRate.toLocaleString()}/day</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Rental length</span>
                      <span>
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Base Price</span>
                      <span>${(days * vehicle.dailyRate).toLocaleString()}</span>
                    </div>
                  </>
                )}
                {selectedAddOns.length > 0 &&
                  selectedAddOns.map((addOn) => (
                    <div className="flex justify-between text-sm" key={addOn.name}>
                      <span className="text-muted-foreground">{addOn.name}</span>
                      <span>+${addOn.price.toLocaleString()}</span>
                    </div>
                  ))}
                <Separator />
                <div className="flex justify-between">
                  <span className="font-semibold">Estimated Total</span>
                  <span className="font-bold text-lg">${total.toLocaleString()}</span>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/50 p-3 text-muted-foreground text-sm">
                No payment required now. The host will review your request and you'll only pay if
                approved.
              </div>

              {error && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                className="w-full"
                disabled={!isValid || isSubmitting}
                onClick={handleSubmitRequest}
                size="lg"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Request"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function CheckoutPage() {
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
      <CheckoutPageContent />
    </Suspense>
  )
}
