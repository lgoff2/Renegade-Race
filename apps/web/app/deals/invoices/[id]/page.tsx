"use client"

import { useUser } from "@clerk/nextjs"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { useAction, useMutation, useQuery } from "convex/react"
import { ArrowLeft, Banknote, CreditCard, ExternalLink, Loader2, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

const statusLabel = (status: string) => status.replace(/_/g, " ")

export default function InvoiceDetailPage() {
  const params = useParams()
  const invoiceId = params.id as Id<"invoices">
  const { user } = useUser()
  const invoice = useQuery(api.invoices.getById, { invoiceId })
  const markViewed = useMutation(api.invoices.markViewed)
  const choosePaymentMethod = useAction(api.invoices.choosePaymentMethod)
  const refundDeposit = useAction(api.invoices.refundDeposit)
  const [isChoosing, setIsChoosing] = useState<"stripe_card" | "stripe_ach" | null>(null)
  const [refundAmount, setRefundAmount] = useState("")
  const [isRefunding, setIsRefunding] = useState(false)

  useEffect(() => {
    if (invoice?._id && invoice.recipientId === user?.id) {
      markViewed({ invoiceId }).catch(() => undefined)
    }
  }, [invoice?._id, invoice?.recipientId, invoiceId, markViewed, user?.id])

  if (invoice === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-semibold text-xl">Invoice not found</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isRecipient = invoice.recipientId === user?.id
  const isSender = invoice.senderId === user?.id
  const achDeposit = invoice.depositVehicle?.damageDepositAmount || 0
  const achTotal = invoice.total + achDeposit
  const cardProcessingFee = invoice.estimatedCardProcessingFee || 0
  const cardTotal = invoice.total + cardProcessingFee
  const canPay = isRecipient && ["sent", "viewed", "payment_pending"].includes(invoice.status)
  const canRefundDeposit =
    isSender &&
    invoice.status === "paid" &&
    (invoice.damageDepositAmount || 0) > 0 &&
    invoice.depositStatus !== "refunded"
  const remainingDeposit = (invoice.damageDepositAmount || 0) - (invoice.depositRefundAmount || 0)

  const handleChoosePayment = async (paymentMethod: "stripe_card" | "stripe_ach") => {
    setIsChoosing(paymentMethod)
    try {
      const result = await choosePaymentMethod({ invoiceId, paymentMethod })
      if (result.url) {
        window.location.href = result.url
      } else {
        toast.success("Payment link created")
      }
    } catch (error) {
      handleErrorWithContext(error, { action: "create invoice payment link" })
    } finally {
      setIsChoosing(null)
    }
  }

  const handleRefundDeposit = async () => {
    setIsRefunding(true)
    try {
      const amount = refundAmount ? Math.round(Number(refundAmount) * 100) : undefined
      await refundDeposit({ invoiceId, amount })
      toast.success("Deposit refund issued")
      setRefundAmount("")
    } catch (error) {
      handleErrorWithContext(error, { action: "refund deposit" })
    } finally {
      setIsRefunding(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/deals/invoices">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="mr-2 size-4" />
            Invoices
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="font-bold text-2xl tracking-tight md:text-3xl">{invoice.title}</h1>
          <p className="text-muted-foreground text-sm">
            {invoice.sender?.name || "Provider"} to {invoice.recipient?.name || "Recipient"}
          </p>
        </div>
        <Badge variant="outline">{statusLabel(invoice.status)}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Invoice details</CardTitle>
            {invoice.description && <CardDescription>{invoice.description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {invoice.lineItems.map((item, index) => (
                <div className="flex items-start justify-between gap-4" key={index}>
                  <div>
                    <p className="font-medium">{item.description}</p>
                    <p className="text-muted-foreground text-sm">
                      {item.quantity} × {formatCurrency(item.unitAmount)}
                    </p>
                  </div>
                  <p className="font-semibold">{formatCurrency(item.amount)}</p>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal)}</span>
              </div>
              {invoice.taxAmount ? (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(invoice.taxAmount)}</span>
                </div>
              ) : null}
              {invoice.discountAmount ? (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span>-{formatCurrency(invoice.discountAmount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-semibold">
                <span>Invoice total</span>
                <span>{formatCurrency(invoice.total)}</span>
              </div>
              {invoice.selectedPaymentMethod === "stripe_card" &&
              (invoice.processingFee || 0) > 0 ? (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Card processing fee</span>
                  <span>{formatCurrency(invoice.processingFee || 0)}</span>
                </div>
              ) : null}
              {invoice.amountDue ? (
                <div className="flex justify-between font-semibold">
                  <span>Amount due</span>
                  <span>{formatCurrency(invoice.amountDue)}</span>
                </div>
              ) : null}
            </div>

            {invoice.stripeCheckoutUrl && (
              <Button asChild variant="outline">
                <a href={invoice.stripeCheckoutUrl} rel="noreferrer" target="_blank">
                  <ExternalLink className="mr-2 size-4" />
                  Open Stripe invoice
                </a>
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {canPay && (
            <Card>
              <CardHeader>
                <CardTitle>Choose payment method</CardTitle>
                <CardDescription>
                  Card payments include Stripe&apos;s standard US card processing fee. ACH Direct
                  Debit does not add that fee, but can take several business days to settle.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {invoice.paymentMethods.includes("stripe_card") && (
                  <Button
                    className="h-auto w-full justify-start p-4"
                    disabled={isChoosing !== null}
                    onClick={() => handleChoosePayment("stripe_card")}
                    variant="outline"
                  >
                    {isChoosing === "stripe_card" ? (
                      <Loader2 className="mr-3 size-5 animate-spin" />
                    ) : (
                      <CreditCard className="mr-3 size-5" />
                    )}
                    <span className="text-left">
                      <span className="block font-semibold">Pay by card</span>
                      <span className="text-muted-foreground text-sm">
                        {formatCurrency(cardTotal)}
                        {cardProcessingFee > 0
                          ? ` includes ${formatCurrency(cardProcessingFee)} card processing fee`
                          : ""}
                      </span>
                    </span>
                  </Button>
                )}

                {invoice.paymentMethods.includes("stripe_ach") && (
                  <Button
                    className="h-auto w-full justify-start p-4"
                    disabled={isChoosing !== null}
                    onClick={() => handleChoosePayment("stripe_ach")}
                    variant="outline"
                  >
                    {isChoosing === "stripe_ach" ? (
                      <Loader2 className="mr-3 size-5 animate-spin" />
                    ) : (
                      <Banknote className="mr-3 size-5" />
                    )}
                    <span className="text-left">
                      <span className="block font-semibold">Pay by ACH Direct Debit</span>
                      <span className="text-muted-foreground text-sm">
                        {formatCurrency(achTotal)}
                        {achDeposit > 0
                          ? ` includes ${formatCurrency(achDeposit)} refundable deposit`
                          : " no deposit required"}
                      </span>
                    </span>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {(invoice.damageDepositAmount || achDeposit > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Damage deposit</CardTitle>
                <CardDescription>
                  Deposits are collected only for ACH/debit invoice payments.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Configured deposit</span>
                  <span>{formatCurrency(invoice.damageDepositAmount || achDeposit)}</span>
                </div>
                {invoice.depositStatus && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span>{statusLabel(invoice.depositStatus)}</span>
                  </div>
                )}
                {invoice.depositRefundAmount ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Refunded</span>
                    <span>{formatCurrency(invoice.depositRefundAmount)}</span>
                  </div>
                ) : null}

                {canRefundDeposit && (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="refundAmount">Refund amount</Label>
                    <Input
                      id="refundAmount"
                      max={remainingDeposit / 100}
                      min="0"
                      onChange={(event) => setRefundAmount(event.target.value)}
                      placeholder={`${formatCurrency(remainingDeposit)} remaining`}
                      type="number"
                      value={refundAmount}
                    />
                    <Button disabled={isRefunding} onClick={handleRefundDeposit} variant="outline">
                      {isRefunding ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-2 size-4" />
                      )}
                      Refund deposit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
