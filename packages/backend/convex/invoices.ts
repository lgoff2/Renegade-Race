import { StripeSubscriptions } from "@convex-dev/stripe"
import { v } from "convex/values"
import Stripe from "stripe"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import {
  getCustomInvoicePaidEmailTemplate,
  getCustomInvoiceSentEmailTemplate,
  getDepositRefundedEmailTemplate,
  sendTransactionalEmail,
} from "./emails"
import { ErrorCode, throwError } from "./errors"
import { getWebUrl } from "./helpers"
import { buildDestinationChargeAmounts, estimateStripeCardProcessingFee } from "./pricing"

const stripeClient = new StripeSubscriptions(components.stripe, {})

const MIN_INVOICE_AMOUNT = 100
const MAX_INVOICE_AMOUNT = 250_000_00

const lineItemValidator = v.object({
  description: v.string(),
  quantity: v.number(),
  unitAmount: v.number(),
  amount: v.number(),
})

const relatedEntityValidator = v.optional(
  v.object({
    type: v.union(
      v.literal("vehicle"),
      v.literal("rental"),
      v.literal("coaching"),
      v.literal("damage"),
      v.literal("contract"),
      v.literal("sponsorship"),
      v.literal("other")
    ),
    id: v.string(),
  })
)

const paymentMethodValidator = v.union(
  v.literal("stripe_card"),
  v.literal("stripe_ach"),
  v.literal("external")
)

type InvoiceLineItem = {
  description: string
  quantity: number
  unitAmount: number
  amount: number
}

export function normalizeInvoiceLineItems(lineItems: InvoiceLineItem[]): InvoiceLineItem[] {
  if (lineItems.length === 0) {
    throw new Error("At least one line item is required")
  }

  return lineItems.map((item) => {
    const description = item.description.trim()
    if (!description) {
      throw new Error("Line item description is required")
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("Line item quantity must be positive")
    }
    if (!Number.isInteger(item.unitAmount) || item.unitAmount < 0) {
      throw new Error("Line item unit amount must be a non-negative cent amount")
    }

    const amount = Math.round(item.quantity * item.unitAmount)
    if (amount !== item.amount) {
      throw new Error("Line item amount does not match quantity and unit amount")
    }

    return {
      description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      amount,
    }
  })
}

export function calculateInvoiceSubtotal(lineItems: InvoiceLineItem[]): number {
  return normalizeInvoiceLineItems(lineItems).reduce((total, item) => total + item.amount, 0)
}

export function calculateInvoiceTotal(args: {
  lineItems: InvoiceLineItem[]
  taxAmount?: number
  discountAmount?: number
}): number {
  const subtotal = calculateInvoiceSubtotal(args.lineItems)
  const taxAmount = args.taxAmount || 0
  const discountAmount = args.discountAmount || 0
  const total = subtotal + taxAmount - discountAmount

  if (taxAmount < 0 || discountAmount < 0) {
    throw new Error("Tax and discount amounts must be non-negative")
  }
  if (total < MIN_INVOICE_AMOUNT || total > MAX_INVOICE_AMOUNT) {
    throw new Error("Invoice total must be between $1.00 and $250,000.00")
  }

  return total
}

export function calculatePaymentAmount(args: {
  invoiceTotal: number
  selectedPaymentMethod: "stripe_card" | "stripe_ach"
  damageDepositAmount?: number
}): { amountDue: number; damageDepositAmount: number; depositStatus: "not_required" | "pending" } {
  const damageDepositAmount =
    args.selectedPaymentMethod === "stripe_ach" ? Math.max(args.damageDepositAmount || 0, 0) : 0

  return {
    amountDue: args.invoiceTotal + damageDepositAmount,
    damageDepositAmount,
    depositStatus: damageDepositAmount > 0 ? "pending" : "not_required",
  }
}

/**
 * Settlement for a custom invoice once the payer picks card or ACH.
 *
 * Card matches destination charges used by rentals and damage invoices:
 * the payer covers Stripe's estimated US card fee, the sender nets
 * invoice total − Renegade platform fee, and `application_fee_amount`
 * is the platform fee plus that processing fee.
 *
 * ACH has no card-processing pass-through in the rest of the billing code.
 * The payer owes the invoice total plus any refundable damage deposit, and
 * the platform fee (capped for early adopters) is taken only from the
 * invoice total — the deposit is not fee'd.
 */
export function resolveInvoiceSettlement(args: {
  invoiceTotal: number
  selectedPaymentMethod: "stripe_card" | "stripe_ach"
  damageDepositAmount?: number
  platformFee: number
}): {
  amountDue: number
  damageDepositAmount: number
  depositStatus: "not_required" | "pending"
  platformFee: number
  processingFee: number
  applicationFeeAmount: number
  senderAmount: number
} {
  if (
    !Number.isInteger(args.platformFee) ||
    args.platformFee < 0 ||
    args.platformFee > args.invoiceTotal
  ) {
    throw new Error("Platform fee must be an integer between 0 and the invoice total")
  }

  const payment = calculatePaymentAmount({
    invoiceTotal: args.invoiceTotal,
    selectedPaymentMethod: args.selectedPaymentMethod,
    damageDepositAmount: args.damageDepositAmount,
  })

  if (args.selectedPaymentMethod === "stripe_card") {
    const charge = buildDestinationChargeAmounts({
      listingAmountCents: args.invoiceTotal,
      platformFeeCents: args.platformFee,
    })
    return {
      amountDue: charge.chargeAmountCents,
      damageDepositAmount: 0,
      depositStatus: "not_required",
      platformFee: args.platformFee,
      processingFee: charge.processingFeeCents,
      applicationFeeAmount: charge.applicationFeeCents,
      senderAmount: charge.ownerAmountCents,
    }
  }

  return {
    amountDue: payment.amountDue,
    damageDepositAmount: payment.damageDepositAmount,
    depositStatus: payment.depositStatus,
    platformFee: args.platformFee,
    processingFee: 0,
    applicationFeeAmount: args.platformFee,
    senderAmount: payment.amountDue - args.platformFee,
  }
}

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throwError(ErrorCode.STRIPE_ERROR, "STRIPE_SECRET_KEY environment variable is not set")
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil",
  })
}

export const createDraft = mutation({
  args: {
    recipientId: v.string(),
    senderTeamId: v.optional(v.id("teams")),
    title: v.string(),
    description: v.optional(v.string()),
    lineItems: v.array(lineItemValidator),
    taxAmount: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    paymentMethods: v.array(paymentMethodValidator),
    relatedEntity: relatedEntityValidator,
    depositVehicleId: v.optional(v.id("vehicles")),
    dueDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }
    if (args.recipientId === identity.subject) {
      throwError(ErrorCode.INVALID_INPUT, "Cannot send an invoice to yourself")
    }
    if (args.paymentMethods.length === 0) {
      throwError(ErrorCode.INVALID_INPUT, "At least one payment method is required")
    }

    const recipient = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.recipientId))
      .first()
    if (!recipient) {
      throwError(ErrorCode.NOT_FOUND, "Recipient not found")
    }

    if (args.depositVehicleId) {
      const vehicle = await ctx.db.get(args.depositVehicleId)
      if (!vehicle) {
        throwError(ErrorCode.NOT_FOUND, "Deposit vehicle not found")
      }
      if (vehicle.ownerId !== identity.subject) {
        throwError(ErrorCode.FORBIDDEN, "Only the vehicle owner can use its damage deposit")
      }
    }

    const lineItems = normalizeInvoiceLineItems(args.lineItems)
    const subtotal = calculateInvoiceSubtotal(lineItems)
    const total = calculateInvoiceTotal({
      lineItems,
      taxAmount: args.taxAmount,
      discountAmount: args.discountAmount,
    })
    const now = Date.now()
    const invoiceId = await ctx.db.insert("invoices", {
      senderId: identity.subject,
      recipientId: args.recipientId,
      senderTeamId: args.senderTeamId,
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      lineItems,
      subtotal,
      taxAmount: args.taxAmount,
      discountAmount: args.discountAmount,
      total,
      currency: "usd",
      paymentMethods: args.paymentMethods,
      relatedEntity: args.relatedEntity,
      depositVehicleId: args.depositVehicleId,
      status: "draft",
      dueDate: args.dueDate,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "invoice",
      entityId: invoiceId,
      action: "create_invoice_draft",
      userId: identity.subject,
      newState: { total, recipientId: args.recipientId },
    })

    return invoiceId
  },
})

export const updateDraft = mutation({
  args: {
    invoiceId: v.id("invoices"),
    title: v.string(),
    description: v.optional(v.string()),
    lineItems: v.array(lineItemValidator),
    taxAmount: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    paymentMethods: v.array(paymentMethodValidator),
    relatedEntity: relatedEntityValidator,
    depositVehicleId: v.optional(v.id("vehicles")),
    dueDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const invoice = await ctx.db.get(args.invoiceId)
    if (!invoice) {
      throwError(ErrorCode.NOT_FOUND, "Invoice not found")
    }
    if (invoice.senderId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to edit this invoice")
    }
    if (invoice.status !== "draft") {
      throwError(ErrorCode.INVALID_STATUS, "Only draft invoices can be edited")
    }

    if (args.depositVehicleId) {
      const vehicle = await ctx.db.get(args.depositVehicleId)
      if (!vehicle || vehicle.ownerId !== identity.subject) {
        throwError(ErrorCode.FORBIDDEN, "Not authorized to use this vehicle deposit")
      }
    }

    const lineItems = normalizeInvoiceLineItems(args.lineItems)
    const subtotal = calculateInvoiceSubtotal(lineItems)
    const total = calculateInvoiceTotal({
      lineItems,
      taxAmount: args.taxAmount,
      discountAmount: args.discountAmount,
    })

    await ctx.db.patch(args.invoiceId, {
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      lineItems,
      subtotal,
      taxAmount: args.taxAmount,
      discountAmount: args.discountAmount,
      total,
      paymentMethods: args.paymentMethods,
      relatedEntity: args.relatedEntity,
      depositVehicleId: args.depositVehicleId,
      dueDate: args.dueDate,
      notes: args.notes,
      updatedAt: Date.now(),
    })

    return args.invoiceId
  },
})

export const send = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const invoice = await ctx.db.get(args.invoiceId)
    if (!invoice) {
      throwError(ErrorCode.NOT_FOUND, "Invoice not found")
    }
    if (invoice.senderId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to send this invoice")
    }
    if (invoice.status !== "draft") {
      throwError(ErrorCode.INVALID_STATUS, "Only draft invoices can be sent")
    }

    const [recipient, sender] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", invoice.recipientId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", invoice.senderId))
        .first(),
    ])

    const now = Date.now()
    await ctx.db.patch(args.invoiceId, {
      status: "sent",
      sentAt: now,
      updatedAt: now,
    })

    const invoiceUrl = `${getWebUrl()}/deals/invoices/${args.invoiceId}`

    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: invoice.recipientId,
      type: "invoice",
      title: "New invoice received",
      message: `${sender?.name || "A provider"} sent you an invoice for $${(invoice.total / 100).toFixed(2)}.`,
      link: `/deals/invoices/${args.invoiceId}`,
      metadata: { invoiceId: args.invoiceId },
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "invoice",
      entityId: args.invoiceId,
      action: "send_invoice",
      userId: identity.subject,
      metadata: { recipientId: invoice.recipientId },
    })

    if (recipient?.email) {
      await sendTransactionalEmail(
        ctx,
        recipient.email,
        getCustomInvoiceSentEmailTemplate({
          recipientName: recipient.name,
          senderName: sender?.name || "Renegade Race provider",
          title: invoice.title,
          amount: invoice.total,
          invoiceUrl,
        })
      )
    }

    return args.invoiceId
  },
})

export const markViewed = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return

    const invoice = await ctx.db.get(args.invoiceId)
    if (!invoice || invoice.recipientId !== identity.subject || invoice.viewedAt) return

    await ctx.db.patch(args.invoiceId, {
      status: invoice.status === "sent" ? "viewed" : invoice.status,
      viewedAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const invoice = await ctx.db.get(args.invoiceId)
    if (!invoice) return null
    if (invoice.senderId !== identity.subject && invoice.recipientId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Not authorized to view this invoice")
    }

    const [sender, recipient, depositVehicle] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", invoice.senderId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", invoice.recipientId))
        .first(),
      invoice.depositVehicleId ? ctx.db.get(invoice.depositVehicleId) : Promise.resolve(null),
    ])

    return {
      ...invoice,
      sender,
      recipient,
      depositVehicle,
      // Preview of the card pass-through before a method is chosen. ACH does not add this.
      estimatedCardProcessingFee: estimateStripeCardProcessingFee(invoice.total),
    }
  },
})

export const getMine = query({
  args: { role: v.optional(v.union(v.literal("sent"), v.literal("received"))) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const sent =
      args.role === "received"
        ? []
        : await ctx.db
            .query("invoices")
            .withIndex("by_sender", (q) => q.eq("senderId", identity.subject))
            .order("desc")
            .collect()
    const received =
      args.role === "sent"
        ? []
        : await ctx.db
            .query("invoices")
            .withIndex("by_recipient", (q) => q.eq("recipientId", identity.subject))
            .order("desc")
            .collect()

    return [...sent, ...received].sort((a, b) => b.createdAt - a.createdAt)
  },
})

export const getRawById = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => await ctx.db.get(args.invoiceId),
})

export const findByStripeInvoiceId = internalQuery({
  args: { stripeInvoiceId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("invoices")
      .filter((q) => q.eq(q.field("stripeInvoiceId"), args.stripeInvoiceId))
      .first(),
})

export const findByStripePaymentIntent = internalQuery({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("invoices")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first(),
})

export const updateWithStripeInvoice = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    selectedPaymentMethod: v.union(v.literal("stripe_card"), v.literal("stripe_ach")),
    amountDue: v.number(),
    damageDepositAmount: v.number(),
    depositStatus: v.union(v.literal("not_required"), v.literal("pending")),
    platformFee: v.number(),
    processingFee: v.number(),
    senderAmount: v.number(),
    stripeInvoiceId: v.string(),
    stripeCheckoutUrl: v.optional(v.string()),
    stripeInvoicePdf: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.invoiceId, {
      selectedPaymentMethod: args.selectedPaymentMethod,
      amountDue: args.amountDue,
      damageDepositAmount: args.damageDepositAmount,
      depositStatus: args.depositStatus,
      platformFee: args.platformFee,
      processingFee: args.processingFee,
      senderAmount: args.senderAmount,
      stripeInvoiceId: args.stripeInvoiceId,
      stripeCheckoutUrl: args.stripeCheckoutUrl,
      stripeInvoicePdf: args.stripeInvoicePdf,
      stripePaymentIntentId: args.stripePaymentIntentId,
      status: "payment_pending",
      updatedAt: Date.now(),
    })
  },
})

export const choosePaymentMethod = action({
  args: {
    invoiceId: v.id("invoices"),
    paymentMethod: v.union(v.literal("stripe_card"), v.literal("stripe_ach")),
  },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }

    const invoice = await ctx.runQuery(internal.invoices.getRawById, {
      invoiceId: args.invoiceId,
    })
    if (!invoice) {
      throwError(ErrorCode.NOT_FOUND, "Invoice not found")
    }
    if (invoice.recipientId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Only the recipient can choose a payment method")
    }
    if (!["sent", "viewed", "payment_pending"].includes(invoice.status)) {
      throwError(ErrorCode.INVALID_STATUS, "Invoice is not payable")
    }
    if (!invoice.paymentMethods.includes(args.paymentMethod)) {
      throwError(ErrorCode.INVALID_INPUT, "Payment method is not available for this invoice")
    }
    if (
      invoice.stripeInvoiceId &&
      invoice.selectedPaymentMethod === args.paymentMethod &&
      invoice.stripeCheckoutUrl
    ) {
      return { url: invoice.stripeCheckoutUrl }
    }
    if (invoice.stripeInvoiceId && invoice.selectedPaymentMethod !== args.paymentMethod) {
      throwError(ErrorCode.INVALID_STATUS, "Payment method has already been selected")
    }

    const [sender, recipient, depositVehicle] = await Promise.all([
      ctx.runQuery(api.users.getByExternalId, { externalId: invoice.senderId }),
      ctx.runQuery(api.users.getByExternalId, { externalId: invoice.recipientId }),
      invoice.depositVehicleId
        ? ctx.runQuery(api.vehicles.getById, { id: invoice.depositVehicleId as Id<"vehicles"> })
        : Promise.resolve(null),
    ])

    if (!sender?.stripeAccountId) {
      throwError(ErrorCode.STRIPE_ACCOUNT_INCOMPLETE, "Provider must complete Stripe onboarding")
    }
    if (!recipient) {
      throwError(ErrorCode.NOT_FOUND, "Recipient not found")
    }

    const stripe = getStripe()
    const connectAccount = await stripe.accounts.retrieve(sender.stripeAccountId)
    if (!(connectAccount.details_submitted && connectAccount.charges_enabled)) {
      throwError(ErrorCode.STRIPE_ACCOUNT_DISABLED, "Provider Stripe account is not ready")
    }

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: invoice.recipientId,
      email: recipient.email || identity.email || "",
      name: recipient.name || identity.name || "",
    })
    if (!recipient.stripeCustomerId) {
      await ctx.runMutation(api.users.setStripeCustomerId, {
        userId: invoice.recipientId,
        stripeCustomerId: customer.customerId,
      })
    }

    // Fee is on the invoice total (not the ACH deposit). Early-adopter caps apply to the sender.
    const { platformFee } = await ctx.runMutation(api.stripe.calculatePlatformFee, {
      amount: invoice.total,
      providerExternalId: invoice.senderId,
    })
    const settlement = resolveInvoiceSettlement({
      invoiceTotal: invoice.total,
      selectedPaymentMethod: args.paymentMethod,
      damageDepositAmount: depositVehicle?.damageDepositAmount,
      platformFee,
    })

    const dueDateTimestamp = invoice.dueDate
      ? Math.floor(new Date(`${invoice.dueDate}T23:59:59.000Z`).getTime() / 1000)
      : undefined

    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.customerId,
        collection_method: "send_invoice",
        days_until_due: dueDateTimestamp ? undefined : 14,
        due_date: dueDateTimestamp,
        description: invoice.description,
        metadata: {
          type: "custom_invoice",
          invoiceId: args.invoiceId,
          senderId: invoice.senderId,
          recipientId: invoice.recipientId,
          paymentMethod: args.paymentMethod,
          damageDepositAmount: settlement.damageDepositAmount.toString(),
          platformFee: settlement.platformFee.toString(),
          processingFee: settlement.processingFee.toString(),
          senderAmount: settlement.senderAmount.toString(),
        },
        application_fee_amount: settlement.applicationFeeAmount,
        transfer_data: {
          destination: sender.stripeAccountId,
        },
        payment_settings: {
          payment_method_types: [args.paymentMethod === "stripe_ach" ? "us_bank_account" : "card"],
        },
      } as Stripe.InvoiceCreateParams,
      { idempotencyKey: `invoice_create_${args.invoiceId}_${args.paymentMethod}` }
    )

    if (!stripeInvoice.id) {
      throwError(ErrorCode.STRIPE_ERROR, "Stripe invoice was created without an ID")
    }

    for (const lineItem of invoice.lineItems) {
      await stripe.invoiceItems.create(
        {
          customer: customer.customerId,
          invoice: stripeInvoice.id,
          currency: "usd",
          description: lineItem.description,
          amount: lineItem.amount,
          metadata: {
            invoiceId: args.invoiceId,
          },
        },
        {
          idempotencyKey: `invoice_item_${args.invoiceId}_${stripeInvoice.id}_${lineItem.description}`,
        }
      )
    }

    if (settlement.processingFee > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customer.customerId,
          invoice: stripeInvoice.id,
          currency: "usd",
          description: "Card processing fee",
          amount: settlement.processingFee,
          metadata: {
            invoiceId: args.invoiceId,
            type: "card_processing_fee",
          },
        },
        { idempotencyKey: `invoice_processing_${args.invoiceId}_${stripeInvoice.id}` }
      )
    }

    if (settlement.damageDepositAmount > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customer.customerId,
          invoice: stripeInvoice.id,
          currency: "usd",
          description: "Refundable damage deposit",
          amount: settlement.damageDepositAmount,
          metadata: {
            invoiceId: args.invoiceId,
            type: "damage_deposit",
          },
        },
        { idempotencyKey: `invoice_deposit_${args.invoiceId}_${stripeInvoice.id}` }
      )
    }

    const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id, {
      idempotencyKey: `invoice_finalize_${args.invoiceId}_${args.paymentMethod}`,
    })
    if (!finalized.id) {
      throwError(ErrorCode.STRIPE_ERROR, "Stripe invoice was finalized without an ID")
    }
    const sent = await stripe.invoices.sendInvoice(finalized.id, {
      idempotencyKey: `invoice_send_${args.invoiceId}_${args.paymentMethod}`,
    })
    if (!sent.id) {
      throwError(ErrorCode.STRIPE_ERROR, "Stripe invoice was sent without an ID")
    }
    const sentWithPaymentIntent = sent as Stripe.Invoice & {
      payment_intent?: string | { id?: string } | null
    }
    const stripePaymentIntentId =
      typeof sentWithPaymentIntent.payment_intent === "string"
        ? sentWithPaymentIntent.payment_intent
        : sentWithPaymentIntent.payment_intent?.id

    await ctx.runMutation(internal.invoices.updateWithStripeInvoice, {
      invoiceId: args.invoiceId,
      selectedPaymentMethod: args.paymentMethod,
      amountDue: settlement.amountDue,
      damageDepositAmount: settlement.damageDepositAmount,
      depositStatus: settlement.depositStatus,
      platformFee: settlement.platformFee,
      processingFee: settlement.processingFee,
      senderAmount: settlement.senderAmount,
      stripeInvoiceId: sent.id,
      stripeCheckoutUrl: sent.hosted_invoice_url || undefined,
      stripeInvoicePdf: sent.invoice_pdf || undefined,
      stripePaymentIntentId,
    })

    return { url: sent.hosted_invoice_url ?? null }
  },
})

export const handleStripeInvoicePaid = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .filter((q) => q.eq(q.field("stripeInvoiceId"), args.stripeInvoiceId))
      .first()
    if (!invoice) return

    const now = Date.now()
    await ctx.db.patch(invoice._id, {
      status: "paid",
      stripePaymentIntentId: args.stripePaymentIntentId || invoice.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId || invoice.stripeChargeId,
      depositStatus:
        invoice.damageDepositAmount && invoice.damageDepositAmount > 0
          ? "held"
          : invoice.depositStatus || "not_required",
      paidAt: now,
      updatedAt: now,
    })

    await Promise.all([
      ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
        userId: invoice.senderId,
        type: "invoice",
        title: "Invoice paid",
        message: `Your invoice "${invoice.title}" has been paid.`,
        link: `/deals/invoices/${invoice._id}`,
        metadata: { invoiceId: invoice._id },
      }),
      ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
        userId: invoice.recipientId,
        type: "invoice",
        title: "Payment received",
        message: `Your payment for "${invoice.title}" has been received.`,
        link: `/deals/invoices/${invoice._id}`,
        metadata: { invoiceId: invoice._id },
      }),
      ctx.runMutation(internal.auditLog.create, {
        entityType: "invoice",
        entityId: invoice._id,
        action: "invoice_paid",
        metadata: args,
      }),
    ])

    const [sender, recipient] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", invoice.senderId))
        .first(),
      ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", invoice.recipientId))
        .first(),
    ])
    if (sender?.email) {
      await sendTransactionalEmail(
        ctx,
        sender.email,
        getCustomInvoicePaidEmailTemplate({
          recipientName: sender.name,
          title: invoice.title,
          amount: invoice.amountDue || invoice.total,
          invoiceUrl: `${getWebUrl()}/deals/invoices/${invoice._id}`,
        })
      )
    }
    if (recipient?.email) {
      await sendTransactionalEmail(
        ctx,
        recipient.email,
        getCustomInvoicePaidEmailTemplate({
          recipientName: recipient.name,
          title: invoice.title,
          amount: invoice.amountDue || invoice.total,
          invoiceUrl: `${getWebUrl()}/deals/invoices/${invoice._id}`,
        })
      )
    }
  },
})

export const handlePaymentProcessing = internalMutation({
  args: { stripePaymentIntentId: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first()
    if (!invoice || invoice.status === "paid") return
    await ctx.db.patch(invoice._id, {
      status: "processing",
      updatedAt: Date.now(),
    })
  },
})

export const handlePaymentFailed = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
      )
      .first()
    if (!invoice || invoice.status === "paid") return
    await ctx.db.patch(invoice._id, {
      status: "payment_pending",
      notes: args.failureReason
        ? `${invoice.notes ? `${invoice.notes}\n\n` : ""}Payment failed: ${args.failureReason}`
        : invoice.notes,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.notifications.createNotification, {
      userId: invoice.recipientId,
      type: "invoice",
      title: "Invoice payment failed",
      message: `Payment failed for "${invoice.title}". Please try again.`,
      link: `/deals/invoices/${invoice._id}`,
      metadata: { invoiceId: invoice._id },
    })
  },
})

export const handleInvoiceTerminalStatus = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
    status: v.union(v.literal("cancelled"), v.literal("overdue")),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .filter((q) => q.eq(q.field("stripeInvoiceId"), args.stripeInvoiceId))
      .first()
    if (!invoice || invoice.status === "paid") return
    await ctx.db.patch(invoice._id, {
      status: args.status,
      updatedAt: Date.now(),
    })
  },
})

export const refundDeposit: ReturnType<typeof action> = action({
  args: {
    invoiceId: v.id("invoices"),
    amount: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Stripe.Response<Stripe.Refund>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throwError(ErrorCode.AUTH_REQUIRED, "Not authenticated")
    }
    const invoice = await ctx.runQuery(internal.invoices.getRawById, {
      invoiceId: args.invoiceId,
    })
    if (!invoice) {
      throwError(ErrorCode.NOT_FOUND, "Invoice not found")
    }
    if (invoice.senderId !== identity.subject) {
      throwError(ErrorCode.FORBIDDEN, "Only the invoice sender can refund the deposit")
    }
    if (invoice.status !== "paid" || !invoice.stripeChargeId) {
      throwError(ErrorCode.INVALID_STATUS, "Invoice must be paid before refunding a deposit")
    }
    const depositAmount = invoice.damageDepositAmount || 0
    const alreadyRefunded = invoice.depositRefundAmount || 0
    const remaining = depositAmount - alreadyRefunded
    if (remaining <= 0) {
      throwError(ErrorCode.INVALID_REFUND_AMOUNT, "No deposit remains to refund")
    }
    const refundAmount = args.amount || remaining
    if (refundAmount <= 0 || refundAmount > remaining) {
      throwError(ErrorCode.INVALID_REFUND_AMOUNT, "Invalid deposit refund amount")
    }

    const stripe = getStripe()
    const refund = await stripe.refunds.create(
      {
        charge: invoice.stripeChargeId,
        amount: refundAmount,
        reverse_transfer: true,
        refund_application_fee: false,
        reason: "requested_by_customer",
        metadata: {
          type: "invoice_damage_deposit_refund",
          invoiceId: args.invoiceId,
        },
      },
      { idempotencyKey: `invoice_deposit_refund_${args.invoiceId}_${refundAmount}_${remaining}` }
    )

    await ctx.runMutation(internal.invoices.updateDepositRefund, {
      invoiceId: args.invoiceId,
      refundAmount: refund.amount,
      refundReason: args.reason,
      stripeRefundId: refund.id,
    })

    return refund
  },
})

export const updateDepositRefund = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    refundAmount: v.number(),
    refundReason: v.optional(v.string()),
    stripeRefundId: v.string(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId)
    if (!invoice) return
    const totalRefunded = (invoice.depositRefundAmount || 0) + args.refundAmount
    const depositAmount = invoice.damageDepositAmount || 0
    const depositStatus = totalRefunded >= depositAmount ? "refunded" : "partially_refunded"

    await ctx.db.patch(args.invoiceId, {
      depositRefundAmount: totalRefunded,
      depositRefundReason: args.refundReason,
      stripeDepositRefundId: args.stripeRefundId,
      depositRefundedAt: Date.now(),
      depositStatus,
      updatedAt: Date.now(),
    })

    await ctx.runMutation(internal.auditLog.create, {
      entityType: "invoice",
      entityId: args.invoiceId,
      action: "refund_invoice_deposit",
      metadata: {
        refundAmount: args.refundAmount,
        totalRefunded,
        stripeRefundId: args.stripeRefundId,
      },
    })

    const recipient = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", invoice.recipientId))
      .first()
    if (recipient?.email) {
      await sendTransactionalEmail(
        ctx,
        recipient.email,
        getDepositRefundedEmailTemplate({
          recipientName: recipient.name,
          title: invoice.title,
          amount: args.refundAmount,
          invoiceUrl: `${getWebUrl()}/deals/invoices/${args.invoiceId}`,
        })
      )
    }
  },
})
