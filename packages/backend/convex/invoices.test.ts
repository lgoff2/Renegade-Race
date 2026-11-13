import {
  calculateInvoiceSubtotal,
  calculateInvoiceTotal,
  calculatePaymentAmount,
  normalizeInvoiceLineItems,
  resolveInvoiceSettlement,
} from "./invoices"
import { buildDestinationChargeAmounts } from "./pricing"

describe("invoice totals", () => {
  it("normalizes line items and calculates subtotal", () => {
    const items = normalizeInvoiceLineItems([
      { description: " Coaching ", quantity: 2, unitAmount: 15_000, amount: 30_000 },
      { description: "Data review", quantity: 1, unitAmount: 5_000, amount: 5_000 },
    ])

    expect(items[0]?.description).toBe("Coaching")
    expect(calculateInvoiceSubtotal(items)).toBe(35_000)
  })

  it("applies tax and discount to total", () => {
    const total = calculateInvoiceTotal({
      lineItems: [{ description: "Coaching", quantity: 1, unitAmount: 50_000, amount: 50_000 }],
      taxAmount: 2_500,
      discountAmount: 5_000,
    })

    expect(total).toBe(47_500)
  })

  it("rejects mismatched line item amounts", () => {
    expect(() =>
      normalizeInvoiceLineItems([
        { description: "Coaching", quantity: 2, unitAmount: 15_000, amount: 20_000 },
      ])
    ).toThrow("Line item amount does not match")
  })
})

describe("invoice payment amounts", () => {
  it("does not add a damage deposit for card payments", () => {
    const result = calculatePaymentAmount({
      invoiceTotal: 100_000,
      selectedPaymentMethod: "stripe_card",
      damageDepositAmount: 50_000,
    })

    expect(result).toEqual({
      amountDue: 100_000,
      damageDepositAmount: 0,
      depositStatus: "not_required",
    })
  })

  it("adds configured damage deposit for ACH payments", () => {
    const result = calculatePaymentAmount({
      invoiceTotal: 100_000,
      selectedPaymentMethod: "stripe_ach",
      damageDepositAmount: 50_000,
    })

    expect(result).toEqual({
      amountDue: 150_000,
      damageDepositAmount: 50_000,
      depositStatus: "pending",
    })
  })

  it("does not require a deposit when the owner has not configured one", () => {
    const result = calculatePaymentAmount({
      invoiceTotal: 100_000,
      selectedPaymentMethod: "stripe_ach",
    })

    expect(result).toEqual({
      amountDue: 100_000,
      damageDepositAmount: 0,
      depositStatus: "not_required",
    })
  })
})

describe("invoice settlement", () => {
  const invoiceTotal = 100_000
  const platformFee = 3_000

  it("passes the card processing fee to the payer and keeps the sender at total minus platform fee", () => {
    const card = buildDestinationChargeAmounts({
      listingAmountCents: invoiceTotal,
      platformFeeCents: platformFee,
    })
    const result = resolveInvoiceSettlement({
      invoiceTotal,
      selectedPaymentMethod: "stripe_card",
      damageDepositAmount: 50_000,
      platformFee,
    })

    expect(result).toEqual({
      amountDue: card.chargeAmountCents,
      damageDepositAmount: 0,
      depositStatus: "not_required",
      platformFee,
      processingFee: card.processingFeeCents,
      applicationFeeAmount: card.applicationFeeCents,
      senderAmount: invoiceTotal - platformFee,
    })
    expect(result.processingFee).toBeGreaterThan(0)
    expect(result.amountDue - result.applicationFeeAmount).toBe(result.senderAmount)
  })

  it("does not add a card processing fee for ACH and does not fee the damage deposit", () => {
    const result = resolveInvoiceSettlement({
      invoiceTotal,
      selectedPaymentMethod: "stripe_ach",
      damageDepositAmount: 50_000,
      platformFee,
    })

    expect(result).toEqual({
      amountDue: 150_000,
      damageDepositAmount: 50_000,
      depositStatus: "pending",
      platformFee,
      processingFee: 0,
      applicationFeeAmount: platformFee,
      senderAmount: 150_000 - platformFee,
    })
  })

  it("rejects a platform fee larger than the invoice total", () => {
    expect(() =>
      resolveInvoiceSettlement({
        invoiceTotal,
        selectedPaymentMethod: "stripe_card",
        platformFee: invoiceTotal + 1,
      })
    ).toThrow("Platform fee must be an integer")
  })
})
