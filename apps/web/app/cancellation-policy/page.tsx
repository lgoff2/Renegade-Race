import {
  SEAT_DRIVER_FULL_REFUND_MIN_DAYS,
  SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS,
  SEAT_DRIVER_PARTIAL_REFUND_PERCENT,
} from "@renegade/backend/convex/pricing"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Check, X } from "lucide-react"

export default function CancellationPolicyPage() {
  const policies = [
    {
      name: "Flexible",
      description: "Maximum flexibility for last-minute changes",
      refunds: [
        { timeframe: "1+ days before check-in", refund: "100% refund" },
        { timeframe: "Less than 24 hours before", refund: "50% refund" },
      ],
      badge: null,
    },
    {
      name: "Moderate",
      description: "Balanced protection for hosts and renters",
      refunds: [
        { timeframe: "7+ days before check-in", refund: "100% refund" },
        { timeframe: "2-6 days before check-in", refund: "50% refund" },
        { timeframe: "Less than 48 hours before", refund: "No refund" },
      ],
      badge: "Most Popular",
    },
    {
      name: "Strict",
      description: "Firm commitment required from renters",
      refunds: [
        { timeframe: "14+ days before check-in", refund: "100% refund" },
        { timeframe: "7-13 days before check-in", refund: "50% refund" },
        { timeframe: "Less than 7 days before", refund: "No refund" },
      ],
      badge: null,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-16 text-center">
        <h1 className="mb-4 font-bold text-3xl md:text-4xl lg:text-5xl">Cancellation Policy</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground text-xl">
          Every vehicle listing has a cancellation policy set by the host. Review the policy before
          booking to understand your refund eligibility
        </p>
      </div>

      <Card className="mb-12">
        <CardHeader>
          <CardTitle className="text-2xl">Endurance race seats</CardTitle>
          <p className="text-muted-foreground text-sm">
            Refunds are measured from the race start date. Cancelling frees the seat immediately.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-medium text-sm">
                {SEAT_DRIVER_FULL_REFUND_MIN_DAYS}+ days before the race
              </p>
              <p className="text-muted-foreground text-xs">100% refund of everything paid</p>
            </div>
            <div>
              <p className="font-medium text-sm">
                At least {SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS} and less than{" "}
                {SEAT_DRIVER_FULL_REFUND_MIN_DAYS} days before
              </p>
              <p className="text-muted-foreground text-xs">
                {SEAT_DRIVER_PARTIAL_REFUND_PERCENT}% refund of everything paid
              </p>
            </div>
            <div>
              <p className="font-medium text-sm">
                Less than {SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS} days before
              </p>
              <p className="text-muted-foreground text-xs">No refund</p>
            </div>
            <div>
              <p className="font-medium text-sm">The team cancels</p>
              <p className="text-muted-foreground text-xs">100% refund, at any time</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Policy Comparison */}
      <div className="mb-12 grid gap-6 md:grid-cols-3">
        {policies.map((policy) => (
          <Card
            className={policy.badge ? "relative border-2 border-primary" : "relative"}
            key={policy.name}
          >
            {policy.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground text-xs">
                  {policy.badge}
                </span>
              </div>
            )}
            <CardHeader>
              <CardTitle className="text-2xl">{policy.name}</CardTitle>
              <p className="text-muted-foreground text-sm">{policy.description}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {policy.refunds.map((item) => {
                  const isRefund = item.refund !== "No refund"
                  return (
                    <div className="flex items-start gap-3" key={item.timeframe}>
                      <div
                        className={`mt-0.5 flex size-5 flex-shrink-0 items-center justify-center rounded-full ${
                          isRefund ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {isRefund ? <Check className="size-3" /> : <X className="size-3" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{item.timeframe}</p>
                        <p className="text-muted-foreground text-xs">{item.refund}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Additional Information */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">How to Cancel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground text-sm">
            <p>
              To cancel a reservation, go to your Trips page and select the booking you wish to
              cancel. Click "Cancel Reservation" and follow the prompts.
            </p>
            <p>
              Refunds are processed back to your original payment method within 5-10 business days
              after cancellation is confirmed.
            </p>
            <p>
              The cancellation deadline is based on the check-in time listed in your reservation
              confirmation, not the calendar date.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Host Cancellations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground text-sm">
            <p>
              If a host cancels your confirmed reservation, you will receive a full refund
              regardless of the cancellation policy.
            </p>
            <p>
              We take host cancellations seriously and may suspend hosts who frequently cancel
              confirmed bookings.
            </p>
            <p>
              If your reservation is cancelled by the host, we'll help you find a comparable
              alternative vehicle when possible.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Extenuating Circumstances</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground text-sm">
            <p>
              In rare cases involving unforeseen events (natural disasters, medical emergencies,
              government travel restrictions), we may grant exceptions to the standard cancellation
              policy.
            </p>
            <p>
              To request consideration for extenuating circumstances, contact our support team with
              documentation of the situation within 14 days of the incident.
            </p>
            <p>Each case is reviewed individually and approval is not guaranteed.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Dispute Resolution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground text-sm">
            <p>
              If you believe a cancellation was processed incorrectly or wish to dispute a refund
              amount, contact our support team within 7 days of the cancellation.
            </p>
            <p>
              Provide all relevant details including your reservation ID, cancellation timestamp,
              and explanation of the issue.
            </p>
            <p>
              Our team will review the case and respond within 3-5 business days with a resolution.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
