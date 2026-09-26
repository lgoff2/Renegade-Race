import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import FaqPage from "@/app/faq/page"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

describe("FAQ page", () => {
  it("explains rental requests, listing, Stripe, and cancellation", () => {
    render(<FaqPage />)

    expect(screen.getByRole("heading", { name: "FAQ" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Requesting a rental" })).toHaveAttribute(
      "href",
      "#renting"
    )
    expect(screen.getByRole("link", { name: "Listing your car" })).toHaveAttribute(
      "href",
      "#listing"
    )

    expect(screen.getByText("Submit Request", { exact: false })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Browse Vehicles" })).toHaveAttribute(
      "href",
      "/vehicles"
    )

    expect(screen.getByText("Vehicle and location, including the daily rate")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Become a Host" })).toHaveAttribute(
      "href",
      "/host/onboarding"
    )

    expect(screen.getByText("Set Up Payouts")).toBeInTheDocument()
    expect(screen.getAllByText("Continue Setup", { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText("Open Stripe dashboard", { exact: false })).toBeInTheDocument()

    expect(
      screen.getByText("14 or more days before the race", { exact: false })
    ).toBeInTheDocument()
    expect(screen.getByText("The team cancels", { exact: false })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "cancellation policy" })).toHaveAttribute(
      "href",
      "/cancellation-policy"
    )
  })
})
