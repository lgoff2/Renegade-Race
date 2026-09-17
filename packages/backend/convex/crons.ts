import { cronJobs } from "convex/server"
import { api, internal } from "./_generated/api"

const crons = cronJobs()

// Clean up approved reservations that weren't paid within 48 hours
// This cancels approved reservations without payment to free up availability
crons.interval(
  "cleanup expired approved reservations",
  { hours: 1 },
  api.reservations.cleanupExpiredApprovedReservations
)

// Expire approved coaching bookings that weren't paid within 48 hours, freeing
// the coach's dates for other requests
crons.interval(
  "expire approved unpaid coaching bookings",
  { hours: 1 },
  internal.coachingBookings.expireApprovedUnpaidBookings
)

// Expire approved seat bookings whose deposit wasn't paid within 48 hours
crons.interval(
  "expire approved unpaid seat bookings",
  { hours: 1 },
  internal.seatBookings.expireApprovedUnpaidBookings
)

// Clean up old webhook events every 24 hours
// Removes webhook events older than 7 days to prevent table bloat
// Webhook idempotency only needs to track recent events
crons.daily(
  "cleanup old webhook events",
  { hourUTC: 3, minuteUTC: 0 }, // Run at 3 AM UTC daily
  api.webhookIdempotency.cleanupOldWebhookEvents
)

export default crons
