"use client"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { useMutation } from "convex/react"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import {
  formatCents,
  seatCancellationPolicySummary,
  seatDriverRefundPreview,
} from "@/lib/seat-checkout"

function refundNotice(preview: { capturedCents: number; refundCents: number; percentage: number }) {
  if (preview.capturedCents === 0) {
    return "Nothing has been charged, so there's nothing to refund. The seat is released immediately."
  }
  const captured = formatCents(preview.capturedCents)
  if (preview.percentage === 0) {
    return `This is inside the non-refundable window, so the team keeps ${captured}. The seat is released immediately.`
  }
  const refund = formatCents(preview.refundCents)
  return `You'll be refunded ${refund} (${preview.percentage}% of ${captured} already paid). The seat is released immediately.`
}

export function SeatCancelDialog({
  bookingId,
  eventStartDate,
  depositCents,
  balanceCents,
  depositPaymentStatus,
  balancePaymentStatus,
  open,
  onOpenChange,
}: {
  bookingId: Id<"seatBookings">
  eventStartDate: string
  depositCents: number
  balanceCents: number
  depositPaymentStatus?: string
  balancePaymentStatus?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const cancel = useMutation(api.seatBookings.cancel)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const preview = seatDriverRefundPreview({
    eventStartDate,
    depositCents,
    balanceCents,
    depositPaymentStatus,
    balancePaymentStatus,
    now: Date.now(),
  })

  const notice = refundNotice(preview)

  const handleCancel = async () => {
    setSubmitting(true)
    try {
      await cancel({
        bookingId,
        cancellationReason: reason.trim() || undefined,
      })
      toast.success("Seat booking cancelled")
      onOpenChange(false)
    } catch (err) {
      handleErrorWithContext(err, { action: "cancel seat booking", entity: "booking" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this seat?</DialogTitle>
          <DialogDescription>{notice}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-xs">{seatCancellationPolicySummary()}</p>
        <div className="space-y-2">
          <Label htmlFor="seat-cancel-reason">Reason (optional)</Label>
          <Textarea
            id="seat-cancel-reason"
            onChange={(event) => setReason(event.target.value)}
            placeholder="Let the team know why you're cancelling"
            value={reason}
          />
        </div>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
            Keep booking
          </Button>
          <Button disabled={submitting} onClick={handleCancel} variant="destructive">
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Cancel seat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
