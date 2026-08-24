"use client"

import { AlertCircle, Calendar, CheckCircle2, Clock, Info, XCircle } from "lucide-react"
import type * as React from "react"
import { cn } from "../lib/utils"

interface CancellationPolicyProps {
  /** Display variant: 'full' shows all tiers, 'compact' shows summary */
  variant?: "full" | "compact" | "inline"
  /** Additional CSS classes */
  className?: string
  /** Show as a card with border */
  showCard?: boolean
}

interface PolicyTier {
  name: string
  timeframe: string
  refundPercent: number
  icon: React.ElementType
  iconColor: string
  bgColor: string
}

const policyTiers: PolicyTier[] = [
  {
    name: "Full Refund",
    timeframe: "7+ days before rental start",
    refundPercent: 100,
    icon: CheckCircle2,
    iconColor: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-950/30",
  },
  {
    name: "Partial Refund",
    timeframe: "2-7 days before rental start",
    refundPercent: 50,
    icon: AlertCircle,
    iconColor: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
  },
  {
    name: "No Refund",
    timeframe: "Less than 48 hours",
    refundPercent: 0,
    icon: XCircle,
    iconColor: "text-red-600",
    bgColor: "bg-red-50 dark:bg-red-950/30",
  },
]

export function CancellationPolicy({
  variant = "full",
  className,
  showCard = true,
}: CancellationPolicyProps) {
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2 text-muted-foreground text-sm", className)}>
        <Info className="size-4 shrink-0" />
        <span>
          Free cancellation up to 7 days before the rental starts. 50% refund 2-7 days before. No
          refund within 48 hours.
        </span>
      </div>
    )
  }

  if (variant === "compact") {
    return (
      <div className={cn(showCard && "rounded-lg border bg-muted/30 p-4", className)}>
        <div className="flex items-start gap-3">
          <Calendar className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h4 className="mb-1 font-medium">Cancellation Policy</h4>
            <p className="text-muted-foreground text-sm">
              Full refund 7+ days before the rental starts. 50% refund 2-7 days before. No refund
              within 48 hours.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Full variant
  return (
    <div className={cn(showCard && "rounded-lg border bg-card p-6", className)}>
      <div className="mb-4 flex items-center gap-2">
        <Calendar className="size-5 text-primary" />
        <h3 className="font-semibold text-lg">Cancellation Policy</h3>
      </div>

      <div className="space-y-3">
        {policyTiers.map((tier) => {
          const Icon = tier.icon
          return (
            <div
              className={cn("flex items-center gap-4 rounded-lg p-3", tier.bgColor)}
              key={tier.name}
            >
              <Icon className={cn("size-5 shrink-0", tier.iconColor)} />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{tier.name}</span>
                  <span className={cn("font-semibold", tier.iconColor)}>
                    {tier.refundPercent}% refund
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Clock className="size-3.5" />
                  <span>{tier.timeframe}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-muted-foreground text-xs">
        Refunds are processed within 5-10 business days to your original payment method.
      </p>
    </div>
  )
}
