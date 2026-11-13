import type { Metadata } from "next"
import { PaddockFeed } from "@/components/paddock/paddock-feed"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Paddock",
  description:
    "The digital paddock — see what drivers, teams, and coaches are up to across the platform.",
}

export default function PaddockPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 space-y-1">
        <h1 className="font-bold text-2xl tracking-tight md:text-3xl">The Paddock</h1>
        <p className="text-muted-foreground text-sm">
          What drivers, teams, and coaches are up to right now.
        </p>
      </header>
      <PaddockFeed />
    </div>
  )
}
