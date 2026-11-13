import { Card, CardContent } from "@workspace/ui/components/card"
import { FileSignature, Receipt } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Deals",
  description: "Custom invoices and e-signed contracts.",
}

export default function DealsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-8 space-y-1">
        <h1 className="font-bold text-2xl tracking-tight md:text-3xl">Deals</h1>
        <p className="text-muted-foreground text-sm">Send invoices, sign contracts, close deals.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/deals/invoices">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent className="flex h-full flex-col gap-3 p-6">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                <Receipt className="size-6 text-primary" />
              </div>
              <h2 className="font-semibold text-lg">Invoices</h2>
              <p className="text-muted-foreground text-sm">
                Create custom invoices with line items, tax, due dates, and Stripe checkout (cards
                or ACH).
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/deals/contracts">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent className="flex h-full flex-col gap-3 p-6">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                <FileSignature className="size-6 text-primary" />
              </div>
              <h2 className="font-semibold text-lg">Contracts</h2>
              <p className="text-muted-foreground text-sm">
                E-signable agreements: rental, coaching, driver-team contract, NDAs, sponsorship
                MoUs.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
