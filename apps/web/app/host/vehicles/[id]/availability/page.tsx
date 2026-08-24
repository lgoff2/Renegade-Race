"use client"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { useMutation, useQuery } from "convex/react"
import { format } from "date-fns"
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Edit,
  Info,
  Loader2,
  Settings,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import type { DateRange } from "react-day-picker"
import { toast } from "sonner"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"

const ADVANCE_NOTICE_OPTIONS = [
  { value: "same-day", label: "Same day" },
  { value: "1-day", label: "1 day (recommended)" },
  { value: "2-days", label: "2 days" },
  { value: "3-days", label: "3 days" },
  { value: "1-week", label: "1 week" },
]

const TRIP_DURATION_OPTIONS = [
  { value: "1-day", label: "1 day (recommended)" },
  { value: "2-days", label: "2 days" },
  { value: "3-days", label: "3 days" },
  { value: "1-week", label: "1 week" },
  { value: "2-weeks", label: "2 weeks" },
  { value: "3-weeks", label: "3 weeks (recommended)" },
  { value: "1-month", label: "1 month" },
  { value: "2-months", label: "2 months" },
  { value: "3-months", label: "3 months" },
  { value: "unlimited", label: "Unlimited" },
]

export default function HostVehicleAvailabilityPage() {
  const params = useParams()
  const vehicleId = params.id as string

  // State for calendar interaction
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(undefined)
  const [isSelectingRange, setIsSelectingRange] = useState(false)
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [selectedDateForBlock, setSelectedDateForBlock] = useState<Date | null>(null)
  const [blockReason, setBlockReason] = useState("")
  const [rangeBlockDialogOpen, setRangeBlockDialogOpen] = useState(false)
  const [rangeBlockReason, setRangeBlockReason] = useState("")

  // Fetch vehicle from Convex
  const vehicle = useQuery(
    api.vehicles.getById,
    vehicleId ? { id: vehicleId as Id<"vehicles"> } : "skip"
  )

  // Fetch availability data for the current month
  const calendarData = useQuery(
    api.availability.getCalendarData,
    vehicle?._id
      ? {
          vehicleId: vehicle._id,
          year: selectedMonth.getFullYear(),
          month: selectedMonth.getMonth() + 1,
        }
      : "skip"
  )

  // Mutations
  const blockDateRange = useMutation(api.availability.blockDateRange)
  const unblockDateRange = useMutation(api.availability.unblockDateRange)
  const blockDate = useMutation(api.availability.blockDate)
  const unblockDate = useMutation(api.availability.unblockDate)
  const updateVehicle = useMutation(api.vehicles.update)

  // State for editing availability settings
  const [editSettingsDialogOpen, setEditSettingsDialogOpen] = useState(false)
  const [advanceNotice, setAdvanceNotice] = useState("1-day")
  const [minTripDuration, setMinTripDuration] = useState("1-day")
  const [maxTripDuration, setMaxTripDuration] = useState("3-weeks")
  const [requireWeekendMin, setRequireWeekendMin] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)

  // Load current settings when vehicle loads or dialog opens
  useEffect(() => {
    if (vehicle) {
      setAdvanceNotice(vehicle.advanceNotice || "1-day")
      setMinTripDuration(vehicle.minTripDuration || "1-day")
      setMaxTripDuration(vehicle.maxTripDuration || "3-weeks")
      setRequireWeekendMin(vehicle.requireWeekendMin ?? false)
    }
  }, [vehicle, editSettingsDialogOpen])

  // Helper function to parse YYYY-MM-DD string to local Date (avoids timezone issues)
  const parseDateString = (dateString: string): Date => {
    const [year, month, day] = dateString.split("-").map(Number) as [number, number, number]
    return new Date(year, (month ?? 1) - 1, day)
  }

  // Get blocked dates for calendar
  const blockedDates = useMemo(() => {
    if (!calendarData?.availability) return []
    return calendarData.availability
      .filter((a: any) => !a.isAvailable)
      .map((a: any) => parseDateString(a.date))
  }, [calendarData])

  // Get reserved dates for calendar
  const reservedDates = useMemo(() => {
    if (!calendarData?.reservations) return []
    const reserved: Date[] = []
    calendarData.reservations.forEach((res: any) => {
      const start = parseDateString(res.startDate)
      const end = parseDateString(res.endDate)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        reserved.push(new Date(d))
      }
    })
    return reserved
  }, [calendarData])

  // Calculate available dates for current month
  const availableThisMonth = useMemo(() => {
    const year = selectedMonth.getFullYear()
    const month = selectedMonth.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // Count blocked and reserved dates in the current month
    const monthStart = new Date(year, month, 1)
    monthStart.setHours(0, 0, 0, 0)
    const monthEnd = new Date(year, month + 1, 0)
    monthEnd.setHours(23, 59, 59, 999)

    const blockedInMonth = blockedDates.filter((d: Date) => {
      const date = new Date(d)
      date.setHours(0, 0, 0, 0)
      return date >= monthStart && date <= monthEnd
    }).length

    const reservedInMonth = reservedDates.filter((d) => {
      const date = new Date(d)
      date.setHours(0, 0, 0, 0)
      return date >= monthStart && date <= monthEnd
    }).length

    return daysInMonth - blockedInMonth - reservedInMonth
  }, [selectedMonth, blockedDates, reservedDates])

  // Show loading state
  if (vehicle === undefined || calendarData === undefined) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 size-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading availability...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show error if vehicle not found
  if (!vehicle) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="mx-auto mb-4 size-12 text-destructive" />
            <h2 className="mb-2 font-bold text-2xl">Vehicle Not Found</h2>
            <p className="mb-6 text-muted-foreground">
              The vehicle you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/host/vehicles/list">
              <Button>Back to Vehicles</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Handle date selection - toggle blocked state or open dialog
  const handleDateSelect = async (date: Date | undefined) => {
    if (!(vehicle?._id && date)) return

    // Extract date components directly to avoid any timezone conversion issues
    // react-day-picker passes dates in local time, so we use the components directly
    const year = date.getFullYear()
    const month = date.getMonth() + 1 // getMonth() returns 0-11, we need 1-12
    const day = date.getDate()

    // Create normalized date for comparisons
    const normalizedDate = new Date(year, date.getMonth(), day)

    // Don't allow blocking reserved dates
    if (isDateReserved(normalizedDate)) {
      toast.error("Cannot block reserved dates")
      return
    }

    const isBlocked = isDateBlocked(normalizedDate)

    // If unblocking, do it immediately
    if (isBlocked) {
      const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      try {
        await unblockDate({
          vehicleId: vehicle._id,
          date: dateString,
        })
        toast.success("Date unblocked")
      } catch (_error) {
        toast.error("An error occurred")
      }
    } else {
      // If blocking, open dialog to allow reason
      setSelectedDateForBlock(date)
      setBlockReason("")
      setBlockDialogOpen(true)
    }
  }

  // Handle blocking date with reason and price override
  const handleBlockDateWithDetails = async () => {
    if (!(vehicle?._id && selectedDateForBlock)) return

    const year = selectedDateForBlock.getFullYear()
    const month = selectedDateForBlock.getMonth() + 1
    const day = selectedDateForBlock.getDate()
    const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

    const normalizedDate = new Date(year, selectedDateForBlock.getMonth(), day)
    const isBlocked = isDateBlocked(normalizedDate)

    try {
      if (isBlocked) {
        // Unblock the date
        await unblockDate({
          vehicleId: vehicle._id,
          date: dateString,
        })
        toast.success("Date unblocked")
      } else {
        // Block the date
        await blockDate({
          vehicleId: vehicle._id,
          date: dateString,
          reason: blockReason || undefined,
        })
        toast.success("Date blocked")
      }
      setBlockDialogOpen(false)
      setSelectedDateForBlock(null)
      setBlockReason("")
    } catch (_error) {
      toast.error("An error occurred")
    }
  }

  // Handle range selection - block or unblock entire range
  const handleRangeSelect = async (range: DateRange | undefined) => {
    if (!(vehicle?._id && range?.from)) return

    // Extract date components directly to avoid any timezone conversion issues
    const fromYear = range.from.getFullYear()
    const fromMonth = range.from.getMonth() + 1
    const fromDay = range.from.getDate()

    const startDate = `${fromYear}-${String(fromMonth).padStart(2, "0")}-${String(fromDay).padStart(2, "0")}`

    let endDate = startDate
    if (range.to) {
      const toYear = range.to.getFullYear()
      const toMonth = range.to.getMonth() + 1
      const toDay = range.to.getDate()
      endDate = `${toYear}-${String(toMonth).padStart(2, "0")}-${String(toDay).padStart(2, "0")}`
    }

    // Normalize dates for comparisons
    const normalizedFrom = new Date(fromYear, range.from.getMonth(), fromDay)
    const normalizedTo = range.to
      ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate())
      : normalizedFrom

    // Check if range contains reserved dates
    const start = new Date(normalizedFrom)
    const end = new Date(normalizedTo)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const normalizedD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      if (isDateReserved(normalizedD)) {
        toast.error("Cannot block dates that are reserved")
        setSelectedRange(undefined)
        return
      }
    }

    // Determine if we're blocking or unblocking
    // If all dates in range are blocked, unblock them; otherwise open dialog to block
    let allBlocked = true
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const normalizedD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      if (!isDateBlocked(normalizedD)) {
        allBlocked = false
        break
      }
    }

    if (allBlocked) {
      // Unblock immediately
      try {
        await unblockDateRange({
          vehicleId: vehicle._id,
          startDate,
          endDate,
        })
        toast.success("Date range unblocked")
        setSelectedRange(undefined)
      } catch (_error) {
        toast.error("Failed to unblock date range")
      }
    } else {
      // Open dialog to block with details
      setRangeBlockReason("")
      setRangeBlockDialogOpen(true)
    }
  }

  // Handle blocking date range with reason
  const handleBlockRangeWithDetails = async () => {
    if (!(vehicle?._id && selectedRange?.from)) return

    const fromYear = selectedRange.from.getFullYear()
    const fromMonth = selectedRange.from.getMonth() + 1
    const fromDay = selectedRange.from.getDate()
    const startDate = `${fromYear}-${String(fromMonth).padStart(2, "0")}-${String(fromDay).padStart(2, "0")}`

    let endDate = startDate
    if (selectedRange.to) {
      const toYear = selectedRange.to.getFullYear()
      const toMonth = selectedRange.to.getMonth() + 1
      const toDay = selectedRange.to.getDate()
      endDate = `${toYear}-${String(toMonth).padStart(2, "0")}-${String(toDay).padStart(2, "0")}`
    }

    const isFullyBlocked = isRangeFullyBlocked(selectedRange)

    try {
      if (isFullyBlocked) {
        // Unblock the range
        await unblockDateRange({
          vehicleId: vehicle._id,
          startDate,
          endDate,
        })
        toast.success("Date range unblocked")
      } else {
        // Block the range
        await blockDateRange({
          vehicleId: vehicle._id,
          startDate,
          endDate,
          reason: rangeBlockReason || undefined,
        })
        toast.success("Date range blocked")
      }
      setRangeBlockDialogOpen(false)
      setSelectedRange(undefined)
      setRangeBlockReason("")
    } catch (_error) {
      toast.error("An error occurred")
    }
  }

  // Check if a date is blocked
  const isDateBlocked = (date: Date) => {
    // Normalize both dates to midnight for accurate comparison
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const dateString = format(normalizedDate, "yyyy-MM-dd")
    return blockedDates.some((d: Date) => {
      const normalizedD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      return format(normalizedD, "yyyy-MM-dd") === dateString
    })
  }

  // Check if a date is reserved
  const isDateReserved = (date: Date) => {
    // Normalize both dates to midnight for accurate comparison
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const dateString = format(normalizedDate, "yyyy-MM-dd")
    return reservedDates.some((d) => {
      const normalizedD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      return format(normalizedD, "yyyy-MM-dd") === dateString
    })
  }

  // Check if a date range is fully blocked
  const isRangeFullyBlocked = (range: DateRange | undefined): boolean => {
    if (!range?.from) return false

    const start = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate())
    const end = range.to
      ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate())
      : start

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const normalizedD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      if (!isDateBlocked(normalizedD)) {
        return false
      }
    }
    return true
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <Link href={`/host/vehicles/${vehicleId}`}>
          <Button className="mb-6" variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            Back to Vehicle
          </Button>
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="mb-2 font-bold text-3xl">
          Manage Availability - {vehicle.year} {vehicle.make} {vehicle.model}
        </h1>
        <p className="text-muted-foreground">
          Click dates to block or unblock them. Use range mode to select multiple dates at once.
        </p>
      </div>

      {/* Vehicle Availability Settings */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="size-5 text-muted-foreground" />
              <CardTitle>Availability Settings</CardTitle>
            </div>
            <Button onClick={() => setEditSettingsDialogOpen(true)} size="sm" variant="outline">
              <Edit className="mr-2 size-4" />
              Edit Settings
            </Button>
          </div>
          <CardDescription>Your vehicle's default availability rules</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {vehicle.advanceNotice && (
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Advance Notice</div>
                <div className="mt-1 font-semibold text-sm capitalize">
                  {vehicle.advanceNotice.replace("-", " ")}
                </div>
              </div>
            )}
            {vehicle.minTripDuration && (
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Minimum Trip</div>
                <div className="mt-1 font-semibold text-sm capitalize">
                  {vehicle.minTripDuration.replace("-", " ")}
                </div>
              </div>
            )}
            {vehicle.maxTripDuration && (
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Maximum Trip</div>
                <div className="mt-1 font-semibold text-sm capitalize">
                  {vehicle.maxTripDuration === "unlimited"
                    ? "Unlimited"
                    : vehicle.maxTripDuration.replace("-", " ")}
                </div>
              </div>
            )}
            {vehicle.requireWeekendMin && (
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Weekend Minimum</div>
                <div className="mt-1 font-semibold text-sm">2-day minimum</div>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 p-3">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground text-xs">
              These settings apply to all bookings. You can override pricing for specific dates when
              blocking them.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Availability Calendar</CardTitle>
              <p className="text-muted-foreground text-sm">
                {isSelectingRange
                  ? "Select a date range to block or unblock"
                  : "Click a date to toggle its blocked state"}
              </p>
            </div>
            <Button
              onClick={() => {
                setIsSelectingRange(!isSelectingRange)
                setSelectedRange(undefined)
              }}
              size="sm"
              variant={isSelectingRange ? "default" : "outline"}
            >
              <CalendarIcon className="mr-2 size-4" />
              {isSelectingRange ? "Single Date Mode" : "Range Mode"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Calendar */}
            <div className="flex justify-center rounded-lg border p-4">
              {isSelectingRange ? (
                <div className="space-y-4">
                  <Calendar
                    className="rounded-md border"
                    disabled={(date) => {
                      // Don't allow blocking dates in the past or reserved dates
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      const normalizedDate = new Date(
                        date.getFullYear(),
                        date.getMonth(),
                        date.getDate()
                      )
                      normalizedDate.setHours(0, 0, 0, 0)
                      return normalizedDate < today || isDateReserved(normalizedDate)
                    }}
                    mode="range"
                    modifiers={{
                      blocked: blockedDates,
                      reserved: reservedDates,
                    }}
                    modifiersClassNames={{
                      blocked: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
                      reserved: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
                    }}
                    month={selectedMonth}
                    numberOfMonths={2}
                    onMonthChange={setSelectedMonth}
                    onSelect={setSelectedRange}
                    selected={selectedRange}
                  />
                  {selectedRange?.from && (
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-1">
                        <p className="font-medium text-sm">Selected Range</p>
                        <p className="text-muted-foreground text-sm">
                          {selectedRange.from ? format(selectedRange.from, "PPP") : "Start date"}
                          {selectedRange.to ? ` - ${format(selectedRange.to, "PPP")}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            setSelectedRange(undefined)
                          }}
                          size="sm"
                          variant="outline"
                        >
                          Clear
                        </Button>
                        {selectedRange.to && (
                          <Button
                            onClick={() => {
                              if (selectedRange?.from && selectedRange?.to) {
                                handleRangeSelect(selectedRange)
                              }
                            }}
                            size="sm"
                          >
                            {isRangeFullyBlocked(selectedRange) ? "Unblock Range" : "Block Range"}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Calendar
                  className="rounded-md border"
                  disabled={(date) => {
                    // Don't allow blocking dates in the past
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    const normalizedDate = new Date(
                      date.getFullYear(),
                      date.getMonth(),
                      date.getDate()
                    )
                    normalizedDate.setHours(0, 0, 0, 0)
                    return normalizedDate < today
                  }}
                  mode="single"
                  modifiers={{
                    blocked: blockedDates,
                    reserved: reservedDates,
                  }}
                  modifiersClassNames={{
                    blocked: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
                    reserved: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
                  }}
                  month={selectedMonth}
                  onMonthChange={setSelectedMonth}
                  onSelect={handleDateSelect}
                />
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <div className="size-4 rounded bg-red-100 dark:bg-red-900/20" />
                <span className="font-medium text-sm">Blocked</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-4 rounded bg-blue-100 dark:bg-blue-900/20" />
                <span className="font-medium text-sm">Booked / requested</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-4 rounded border" />
                <span className="font-medium text-sm">Available</span>
              </div>
              <div className="ml-auto text-muted-foreground text-sm">
                {isSelectingRange
                  ? "Select a date range to block or unblock all dates in that range"
                  : "Click any available date to toggle its blocked state"}
              </div>
            </div>

            {/* Summary Stats */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="text-muted-foreground text-sm">Blocked This Month</div>
                <div className="mt-1 font-bold text-2xl">{blockedDates.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-muted-foreground text-sm">Booked / Requested This Month</div>
                <div className="mt-1 font-bold text-2xl">{reservedDates.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-muted-foreground text-sm">Available This Month</div>
                <div className="mt-1 font-bold text-2xl">{availableThisMonth}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Block Date Dialog */}
      <Dialog onOpenChange={setBlockDialogOpen} open={blockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDateForBlock && isDateBlocked(selectedDateForBlock)
                ? "Unblock Date"
                : "Block Date"}
            </DialogTitle>
            <DialogDescription>
              {selectedDateForBlock &&
                (isDateBlocked(selectedDateForBlock)
                  ? `Unblock ${format(selectedDateForBlock, "EEEE, MMMM d, yyyy")} to make it available for bookings.`
                  : `Block ${format(selectedDateForBlock, "EEEE, MMMM d, yyyy")} from bookings.`)}
            </DialogDescription>
          </DialogHeader>
          {selectedDateForBlock && !isDateBlocked(selectedDateForBlock) && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="blockReason">Reason (Optional)</Label>
                <Textarea
                  id="blockReason"
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="e.g., Personal use, Maintenance, Track day..."
                  value={blockReason}
                />
                <p className="text-muted-foreground text-xs">
                  Add a note to help you remember why this date is blocked.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setBlockDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button onClick={handleBlockDateWithDetails}>
              {selectedDateForBlock && isDateBlocked(selectedDateForBlock)
                ? "Unblock Date"
                : "Block Date"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block Range Dialog */}
      <Dialog onOpenChange={setRangeBlockDialogOpen} open={rangeBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedRange && isRangeFullyBlocked(selectedRange)
                ? "Unblock Date Range"
                : "Block Date Range"}
            </DialogTitle>
            <DialogDescription>
              {selectedRange?.from &&
                selectedRange?.to &&
                (isRangeFullyBlocked(selectedRange)
                  ? `Unblock ${format(selectedRange.from, "MMM d")} - ${format(selectedRange.to, "MMM d, yyyy")} to make it available for bookings.`
                  : `Block ${format(selectedRange.from, "MMM d")} - ${format(selectedRange.to, "MMM d, yyyy")} from bookings.`)}
            </DialogDescription>
          </DialogHeader>
          {selectedRange && !isRangeFullyBlocked(selectedRange) && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="rangeBlockReason">Reason (Optional)</Label>
                <Textarea
                  id="rangeBlockReason"
                  onChange={(e) => setRangeBlockReason(e.target.value)}
                  placeholder="e.g., Personal use, Maintenance, Track day..."
                  value={rangeBlockReason}
                />
                <p className="text-muted-foreground text-xs">
                  Add a note to help you remember why this range is blocked.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRangeBlockDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button onClick={handleBlockRangeWithDetails}>
              {selectedRange && isRangeFullyBlocked(selectedRange)
                ? "Unblock Range"
                : "Block Range"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Availability Settings Dialog */}
      <Dialog onOpenChange={setEditSettingsDialogOpen} open={editSettingsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Availability Settings</DialogTitle>
            <DialogDescription>
              Update your vehicle's default availability rules. These settings apply to all future
              bookings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Advance Notice */}
            <div className="space-y-2">
              <Label htmlFor="editAdvanceNotice">Advance Notice</Label>
              <p className="text-muted-foreground text-xs">
                How much advance notice do you need before a trip starts?
              </p>
              <Select onValueChange={setAdvanceNotice} value={advanceNotice}>
                <SelectTrigger id="editAdvanceNotice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADVANCE_NOTICE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Trip Duration */}
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 font-semibold text-sm">Trip Duration</h3>
                <p className="text-muted-foreground text-xs">
                  What's the shortest and longest possible trip you'll accept?
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="editMinTripDuration">Minimum Trip Duration</Label>
                  <Select onValueChange={setMinTripDuration} value={minTripDuration}>
                    <SelectTrigger id="editMinTripDuration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIP_DURATION_OPTIONS.filter((opt) => opt.value !== "unlimited").map(
                        (option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                  <Checkbox
                    checked={requireWeekendMin}
                    id="editRequireWeekendMin"
                    onCheckedChange={(checked) => setRequireWeekendMin(checked === true)}
                  />
                  <Label
                    className="cursor-pointer font-normal leading-tight"
                    htmlFor="editRequireWeekendMin"
                  >
                    Require a 2-day minimum for trips that start Friday, Saturday, or Sunday
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="editMaxTripDuration">Maximum Trip Duration</Label>
                  <Select onValueChange={setMaxTripDuration} value={maxTripDuration}>
                    <SelectTrigger id="editMaxTripDuration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIP_DURATION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setEditSettingsDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={isSavingSettings}
              onClick={async () => {
                if (!vehicle?._id) return
                setIsSavingSettings(true)
                try {
                  await updateVehicle({
                    id: vehicle._id,
                    advanceNotice,
                    minTripDuration,
                    maxTripDuration,
                    requireWeekendMin,
                  })
                  toast.success("Availability settings updated")
                  setEditSettingsDialogOpen(false)
                } catch (_error) {
                  toast.error("Failed to update settings")
                } finally {
                  setIsSavingSettings(false)
                }
              }}
            >
              {isSavingSettings ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
