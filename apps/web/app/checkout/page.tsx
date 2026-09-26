"use client"

import { useUser } from "@clerk/nextjs"
import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { useMutation, useQuery } from "convex/react"
import { Calendar as CalendarIcon, Check, ChevronDown, Clock, Loader2 } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { formatDateToISO, parseLocalDate } from "@/lib/date-utils"
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

  const [pickupDate, setPickupDate] = useState<Date | undefined>(undefined)
  const [pickupTime, setPickupTime] = useState("")
  const [dropoffDate, setDropoffDate] = useState<Date | undefined>(undefined)
  const [dropoffTime, setDropoffTime] = useState("")
  const [openPickupDate, setOpenPickupDate] = useState(false)
  const [openDropoffDate, setOpenDropoffDate] = useState(false)
  const [renterMessage, setRenterMessage] = useState("")
  const [selectedAddOns, setSelectedAddOns] = useState<AddOn[]>(() => {
    // Auto-select required add-ons if vehicle is loaded
    return vehicle?.addOns?.filter((addOn: AddOn) => addOn.isRequired) || []
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Update selected add-ons when vehicle loads
  useEffect(() => {
    if (vehicle?.addOns) {
      const requiredAddOns = vehicle.addOns.filter((addOn: AddOn) => addOn.isRequired)
      if (requiredAddOns.length > 0) {
        setSelectedAddOns(requiredAddOns)
      }
    }
  }, [vehicle?.addOns])

  // Initialize dates from URL params if provided
  useEffect(() => {
    if (startDateParam && endDateParam && !pickupDate && !dropoffDate) {
      const startDate = parseLocalDate(startDateParam)
      const endDate = parseLocalDate(endDateParam)

      if (startDate && endDate) {
        // Set to midnight local time
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(0, 0, 0, 0)

        // Only set if dates are valid and in the future
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        if (startDate >= today && endDate >= startDate) {
          setPickupDate(startDate)
          setDropoffDate(endDate)
        }
      }
    }
  }, [startDateParam, endDateParam, pickupDate, dropoffDate])

  // Generate time options (every 30 minutes from 6 AM to 10 PM)
  const generateTimeOptions = () => {
    const times: string[] = []
    for (let hour = 6; hour < 22; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time24 = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
        times.push(time24)
      }
    }
    return times
  }

  const timeOptions = generateTimeOptions()

  const formatTimeForDisplay = (time24: string) => {
    const [hours, minutes] = time24.split(":")
    if (!(hours && minutes)) return time24
    const hour = Number.parseInt(hours, 10)
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
    const ampm = hour < 12 ? "AM" : "PM"
    return `${hour12}:${minutes} ${ampm}`
  }

  // Calculate minimum dates
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const minPickupDate = today
  const minDropoffDate = pickupDate || today

  // Get blocked dates from availability (where isAvailable is false)
  const blockedDates =
    availability
      ?.filter((item: { isAvailable: boolean; date: string }) => !item.isAvailable)
      .map((item: { date: string }) => parseLocalDate(item.date))
      .filter((d: Date | null): d is Date => d !== null) || []

  // Combine blocked dates (availability already accounts for reservations)
  const unavailableDates = new Set(blockedDates.map((d: Date) => formatDateToISO(d)))

  // Function to check if a date is unavailable
  const isDateUnavailable = (date: Date): boolean => {
    const dateStr = formatDateToISO(date)
    return unavailableDates.has(dateStr)
  }

  // Function to check if a date range contains any unavailable dates
  const isDateRangeUnavailable = (startDate: Date, endDate: Date): boolean => {
    const start = new Date(startDate)
    const end = new Date(endDate)
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)

    // Check each date in the range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (isDateUnavailable(d)) {
        return true
      }
    }
    return false
  }

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
    if (!(pickupDate && dropoffDate && vehicle)) {
      return { days: 0, total: 0, addOnsTotal: 0 }
    }

    const start = new Date(pickupDate)
    const end = new Date(dropoffDate)
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

    if (days <= 0) return { days: 0, total: 0, addOnsTotal: 0 }

    const baseTotal = days * vehicle.dailyRate
    const addOnsTotal = selectedAddOns.reduce((sum, addOn) => sum + addOn.price, 0)
    const total = baseTotal + addOnsTotal

    return { days, total, addOnsTotal }
  }

  const { days, total } = calculateTotal()

  const handleSubmitRequest = async () => {
    if (!(isSignedIn && user?.id)) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`)
      return
    }

    if (!(pickupDate && dropoffDate && pickupTime && dropoffTime && vehicle)) {
      setError("Please fill in all required fields")
      return
    }

    // Validate that the selected date range doesn't contain blocked dates
    if (isDateRangeUnavailable(pickupDate, dropoffDate)) {
      setError("The selected dates include unavailable dates. Please select different dates.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Prepare selected add-ons data (without isRequired field)
      const reservationAddOns =
        selectedAddOns.length > 0
          ? selectedAddOns.map((addOn) => ({
              name: addOn.name,
              price: addOn.price,
              description: addOn.description,
            }))
          : undefined

      // Convert Date objects to ISO date strings (YYYY-MM-DD) using local date formatting
      // This prevents timezone shifts when converting dates
      const startDateString = formatDateToISO(pickupDate)
      const endDateString = formatDateToISO(dropoffDate)

      // Create reservation request (no payment at this stage)
      const newReservationId = await createReservation({
        vehicleId: vehicle._id,
        startDate: startDateString,
        endDate: endDateString,
        pickupTime,
        dropoffTime,
        renterMessage: renterMessage.trim() || undefined,
        addOns: reservationAddOns,
      })

      // Redirect to request confirmation page
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
  // Check if form is valid and dates don't contain blocked dates
  const isValid =
    pickupDate &&
    dropoffDate &&
    pickupTime &&
    dropoffTime &&
    days > 0 &&
    !isDateRangeUnavailable(pickupDate, dropoffDate)

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

              {/* Pickup Date and Time */}
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 flex items-center gap-2" htmlFor="pickup-date">
                    <CalendarIcon className="size-4" />
                    Start date
                  </Label>
                  <Popover onOpenChange={setOpenPickupDate} open={openPickupDate}>
                    <PopoverTrigger asChild>
                      <Button
                        className="h-11 w-full justify-between px-3 py-2 font-normal"
                        id="pickup-date"
                        variant="outline"
                      >
                        {pickupDate
                          ? pickupDate.toLocaleDateString("en-US", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "Select date"}
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        disabled={(date: Date) => {
                          const dateStart = new Date(date)
                          dateStart.setHours(0, 0, 0, 0)
                          return dateStart < minPickupDate || isDateUnavailable(dateStart)
                        }}
                        initialFocus
                        mode="single"
                        modifiers={{
                          blocked: blockedDates,
                        }}
                        modifiersClassNames={{
                          blocked: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
                        }}
                        onSelect={(date) => {
                          if (date) {
                            if (isDateUnavailable(date)) {
                              setError("This date is unavailable. Please select a different date.")
                              return
                            }
                            setPickupDate(date)
                            setError(null)
                            // Reset dropoff date if it's before new pickup date or if it's unavailable
                            if (dropoffDate && date && dropoffDate < date) {
                              setDropoffDate(undefined)
                            } else if (dropoffDate && isDateRangeUnavailable(date, dropoffDate)) {
                              setError(
                                "The selected date range includes unavailable dates. Please select different dates."
                              )
                              setDropoffDate(undefined)
                            }
                            setOpenPickupDate(false)
                          }
                        }}
                        selected={pickupDate}
                      />
                    </PopoverContent>
                  </Popover>
                  {blockedDates.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
                      <div className="size-3 rounded bg-red-100 dark:bg-red-900/20" />
                      <span>Unavailable dates</span>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="mb-2 flex items-center gap-2" htmlFor="pickup-time">
                    <Clock className="size-4" />
                    Start time
                  </Label>
                  <Select onValueChange={setPickupTime} required value={pickupTime}>
                    <SelectTrigger id="pickup-time">
                      <SelectValue placeholder="Select start time" />
                    </SelectTrigger>
                    <SelectContent>
                      {timeOptions.map((time) => (
                        <SelectItem key={time} value={time}>
                          {formatTimeForDisplay(time)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Dropoff Date and Time */}
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 flex items-center gap-2" htmlFor="dropoff-date">
                    <CalendarIcon className="size-4" />
                    End date
                  </Label>
                  <Popover onOpenChange={setOpenDropoffDate} open={openDropoffDate}>
                    <PopoverTrigger asChild>
                      <Button
                        className="h-11 w-full justify-between px-3 py-2 font-normal"
                        id="dropoff-date"
                        variant="outline"
                      >
                        {dropoffDate
                          ? dropoffDate.toLocaleDateString("en-US", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "Select date"}
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        disabled={(date: Date) => {
                          const dateStart = new Date(date)
                          dateStart.setHours(0, 0, 0, 0)
                          const minDate = new Date(minDropoffDate)
                          minDate.setHours(0, 0, 0, 0)
                          return dateStart < minDate || isDateUnavailable(dateStart)
                        }}
                        initialFocus
                        mode="single"
                        modifiers={{
                          blocked: blockedDates,
                        }}
                        modifiersClassNames={{
                          blocked: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
                        }}
                        onSelect={(date) => {
                          if (date) {
                            if (isDateUnavailable(date)) {
                              setError("This date is unavailable. Please select a different date.")
                              return
                            }
                            // Validate that the date range from pickup to dropoff doesn't contain blocked dates
                            if (pickupDate && isDateRangeUnavailable(pickupDate, date)) {
                              setError(
                                "The selected date range includes unavailable dates. Please select different dates."
                              )
                              return
                            }
                            setDropoffDate(date)
                            setError(null)
                            setOpenDropoffDate(false)
                          }
                        }}
                        selected={dropoffDate}
                      />
                    </PopoverContent>
                  </Popover>
                  {blockedDates.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
                      <div className="size-3 rounded bg-red-100 dark:bg-red-900/20" />
                      <span>Unavailable dates</span>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="mb-2 flex items-center gap-2" htmlFor="dropoff-time">
                    <Clock className="size-4" />
                    End time
                  </Label>
                  <Select onValueChange={setDropoffTime} required value={dropoffTime}>
                    <SelectTrigger id="dropoff-time">
                      <SelectValue placeholder="Select end time" />
                    </SelectTrigger>
                    <SelectContent>
                      {timeOptions.map((time) => (
                        <SelectItem key={time} value={time}>
                          {formatTimeForDisplay(time)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                {days > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Daily Rate</span>
                      <span>${vehicle.dailyRate.toLocaleString()}/day</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
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
