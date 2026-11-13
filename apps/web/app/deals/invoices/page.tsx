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
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
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
import { ArrowLeft, Loader2, Plus, Send, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"

type LineItem = {
  description: string
  quantity: number
  unitAmountDollars: string
}

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

const statusLabel = (status: string) => status.replace(/_/g, " ")

export default function InvoicesPage() {
  const { user } = useUser()
  const invoices = useQuery(api.invoices.getMine, {})
  const vehicles = useQuery(api.vehicles.getByOwner, user?.id ? { ownerId: user.id } : "skip")
  const [recipientSearch, setRecipientSearch] = useState("")
  const recipients = useQuery(api.users.searchForInvoiceRecipients, {
    search: recipientSearch,
    limit: 25,
  })
  const createDraft = useMutation(api.invoices.createDraft)
  const sendInvoice = useMutation(api.invoices.send)

  const [recipientId, setRecipientId] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [depositVehicleId, setDepositVehicleId] = useState<string>("none")
  const [allowCard, setAllowCard] = useState(true)
  const [allowAch, setAllowAch] = useState(true)
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitAmountDollars: "" },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const invoiceTotal = lineItems.reduce((total, item) => {
    const unitAmount = Math.round(Number(item.unitAmountDollars || 0) * 100)
    return total + unitAmount * Number(item.quantity || 0)
  }, 0)

  const resetForm = () => {
    setRecipientId("")
    setTitle("")
    setDescription("")
    setDueDate("")
    setDepositVehicleId("none")
    setAllowCard(true)
    setAllowAch(true)
    setLineItems([{ description: "", quantity: 1, unitAmountDollars: "" }])
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!(recipientId && title.trim())) {
      toast.error("Choose a recipient and add a title")
      return
    }
    const paymentMethods = [
      ...(allowCard ? (["stripe_card"] as const) : []),
      ...(allowAch ? (["stripe_ach"] as const) : []),
    ]
    if (paymentMethods.length === 0) {
      toast.error("Enable at least one payment method")
      return
    }

    const normalizedLineItems = lineItems.map((item) => {
      const unitAmount = Math.round(Number(item.unitAmountDollars || 0) * 100)
      return {
        description: item.description.trim(),
        quantity: Number(item.quantity || 0),
        unitAmount,
        amount: unitAmount * Number(item.quantity || 0),
      }
    })

    setIsSubmitting(true)
    try {
      const invoiceId = await createDraft({
        recipientId,
        title,
        description: description || undefined,
        dueDate: dueDate || undefined,
        lineItems: normalizedLineItems,
        paymentMethods,
        depositVehicleId:
          depositVehicleId === "none" ? undefined : (depositVehicleId as Id<"vehicles">),
      })
      await sendInvoice({ invoiceId })
      toast.success("Invoice sent")
      resetForm()
    } catch (error) {
      handleErrorWithContext(error, { action: "send invoice" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const updateLineItem = (index: number, patch: Partial<LineItem>) => {
    setLineItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/deals">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="mr-2 size-4" />
            Deals
          </Button>
        </Link>
        <div>
          <h1 className="font-bold text-2xl tracking-tight md:text-3xl">Invoices</h1>
          <p className="text-muted-foreground text-sm">
            Send custom invoices with lower-fee ACH Direct Debit and optional vehicle deposits.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Create invoice</CardTitle>
            <CardDescription>
              The recipient chooses card or ACH before the Stripe invoice is finalized.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="recipientSearch">Recipient</Label>
                <Input
                  id="recipientSearch"
                  onChange={(event) => setRecipientSearch(event.target.value)}
                  placeholder="Search name or email"
                  value={recipientSearch}
                />
                <Select onValueChange={setRecipientId} value={recipientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select recipient" />
                  </SelectTrigger>
                  <SelectContent>
                    {(recipients || []).map((recipient) => (
                      <SelectItem key={recipient.externalId} value={recipient.externalId}>
                        {recipient.name} {recipient.email ? `(${recipient.email})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Coaching package"
                    value={title}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dueDate">Due date</Label>
                  <Input
                    id="dueDate"
                    onChange={(event) => setDueDate(event.target.value)}
                    type="date"
                    value={dueDate}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional notes for the recipient"
                  value={description}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Line items</Label>
                  <Button
                    onClick={() =>
                      setLineItems((items) => [
                        ...items,
                        { description: "", quantity: 1, unitAmountDollars: "" },
                      ])
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus className="mr-2 size-4" />
                    Add item
                  </Button>
                </div>
                {lineItems.map((item, index) => (
                  <div
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_90px_120px_auto]"
                    key={index}
                  >
                    <Input
                      onChange={(event) =>
                        updateLineItem(index, { description: event.target.value })
                      }
                      placeholder="Description"
                      value={item.description}
                    />
                    <Input
                      min="1"
                      onChange={(event) =>
                        updateLineItem(index, { quantity: Number(event.target.value) })
                      }
                      type="number"
                      value={item.quantity}
                    />
                    <Input
                      min="0"
                      onChange={(event) =>
                        updateLineItem(index, { unitAmountDollars: event.target.value })
                      }
                      placeholder="Amount"
                      type="number"
                      value={item.unitAmountDollars}
                    />
                    <Button
                      disabled={lineItems.length === 1}
                      onClick={() =>
                        setLineItems((items) => items.filter((_, itemIndex) => itemIndex !== index))
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-right font-semibold">Total: {formatCurrency(invoiceTotal)}</p>
              </div>

              <div className="space-y-3">
                <Label>Payment methods</Label>
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowCard}
                      id="allow-card"
                      onCheckedChange={(checked) => setAllowCard(checked === true)}
                    />
                    <Label htmlFor="allow-card">Card</Label>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowAch}
                      id="allow-ach"
                      onCheckedChange={(checked) => setAllowAch(checked === true)}
                    />
                    <Label htmlFor="allow-ach">ACH Direct Debit</Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Vehicle deposit rule</Label>
                <Select onValueChange={setDepositVehicleId} value={depositVehicleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No vehicle deposit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No damage deposit</SelectItem>
                    {(vehicles || []).map((vehicle) => (
                      <SelectItem key={vehicle._id} value={vehicle._id}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                        {vehicle.damageDepositAmount
                          ? ` (${formatCurrency(vehicle.damageDepositAmount)} deposit)`
                          : " (no deposit set)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Deposits are collected only when the recipient chooses ACH/debit.
                </p>
              </div>

              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                Send invoice
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent invoices</CardTitle>
            <CardDescription>Invoices you have sent or received.</CardDescription>
          </CardHeader>
          <CardContent>
            {invoices === undefined ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : invoices.length === 0 ? (
              <p className="py-10 text-center text-muted-foreground text-sm">No invoices yet.</p>
            ) : (
              <div className="space-y-3">
                {invoices.map((invoice) => (
                  <Link href={`/deals/invoices/${invoice._id}`} key={invoice._id}>
                    <div className="rounded-lg border p-4 transition-colors hover:border-primary/50">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{invoice.title}</p>
                          <p className="text-muted-foreground text-sm">
                            {invoice.senderId === user?.id ? "Sent" : "Received"}
                          </p>
                        </div>
                        <Badge variant="outline">{statusLabel(invoice.status)}</Badge>
                      </div>
                      <p className="mt-3 font-semibold">
                        {formatCurrency(invoice.amountDue || invoice.total)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
