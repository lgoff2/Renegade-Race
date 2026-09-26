import {
  SEAT_DRIVER_FULL_REFUND_MIN_DAYS,
  SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS,
  SEAT_DRIVER_PARTIAL_REFUND_PERCENT,
} from "@renegade/backend/convex/pricing"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "How to request a track car, list your own car, connect Stripe, and what the cancellation rules are.",
}

type FaqItem = {
  question: string
  answer: ReactNode
}

const fullSeatDays = SEAT_DRIVER_FULL_REFUND_MIN_DAYS
const partialSeatDays = SEAT_DRIVER_PARTIAL_REFUND_MIN_DAYS
const partialSeatPercent = SEAT_DRIVER_PARTIAL_REFUND_PERCENT

const sections: { id: string; title: string; intro: string; items: FaqItem[] }[] = [
  {
    id: "renting",
    title: "Requesting a rental",
    intro: "You send a request first. The host decides, and you pay only after they approve.",
    items: [
      {
        question: "How do I send a rental request?",
        answer: (
          <>
            <p>
              Create an account, then open <Link href="/vehicles">Browse Vehicles</Link>. Pick a car
              and choose your dates. <strong>Reserve Now</strong> opens checkout, where you review
              the price, pickup details, and that car's cancellation policy.{" "}
              <strong>Submit Request</strong> sends it to the host.
            </p>
            <p>Nothing is charged when you submit. You can message the host while you wait.</p>
          </>
        ),
      },
      {
        question: "When do I pay?",
        answer: (
          <>
            <p>
              After the host approves, the trip moves to <Link href="/trips">My Trips</Link> and you
              have <strong>48 hours</strong> to pay. Paying confirms the rental. If you don't pay in
              that window, the approval expires and the dates open up again.
            </p>
            <p>
              Payment is by card through Stripe. The charge goes to the host's Stripe account, minus
              Renegade's platform fee.
            </p>
          </>
        ),
      },
      {
        question: "Why does a car say Booking Unavailable?",
        answer: (
          <p>
            The host hasn't finished Stripe payout setup. You can still read the listing, but{" "}
            <strong>Reserve Now</strong> stays off until their account can accept charges.
          </p>
        ),
      },
      {
        question: "What happens on the rental day?",
        answer: (
          <p>
            Meet the host, look the car over, and complete the handoff. When the trip ends, both of
            you record the return. If something is damaged, the host can send a separate damage
            invoice for you to pay. Track insurance is not included — a normal auto policy usually
            does not cover track use. Gear requirements are on the{" "}
            <Link href="/safety">safety</Link> page.
          </p>
        ),
      },
    ],
  },
  {
    id: "listing",
    title: "Listing your car",
    intro:
      "The same account can rent and host. Listing is an application, then a Stripe connection.",
    items: [
      {
        question: "How do I apply to list my car?",
        answer: (
          <>
            <p>
              Sign in and open <Link href="/host/onboarding">Become a Host</Link>. The application
              has five steps:
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Vehicle and pickup location, including the daily rate</li>
              <li>Photos</li>
              <li>Optional add-ons</li>
              <li>Availability</li>
              <li>Safety and quality standards</li>
            </ol>
            <p>
              You can leave and come back. The draft is saved on your account. When you finish, the
              car waits for Renegade to approve it. It does not show up in Browse Vehicles until
              then.
            </p>
          </>
        ),
      },
      {
        question: "When can renters book it?",
        answer: (
          <p>
            Renegade has to approve the listing before renters can find it. Your Stripe payout
            account also has to be enabled. If the listing is approved but Stripe is not ready,
            renters can open the car and see Booking Unavailable — Reserve Now stays off. Once both
            are done, requests show up on the <Link href="/host/dashboard">host dashboard</Link>.
            You approve or decline each one. Approving does not charge the renter — they have 48
            hours to pay.
          </p>
        ),
      },
      {
        question: "Can I list another car later?",
        answer: (
          <p>
            Yes. From the host dashboard, use <strong>List New Vehicle</strong>. Each car has its
            own rate, photos, and availability. New listings use the Moderate cancellation policy.
          </p>
        ),
      },
    ],
  },
  {
    id: "stripe",
    title: "Connecting Stripe",
    intro: "Stripe is how you get paid. Renegade never asks for your bank login.",
    items: [
      {
        question: "How do I connect Stripe?",
        answer: (
          <>
            <p>Finish host onboarding, then open the host dashboard.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Choose <strong>Set Up Payouts</strong>. If you already started, the button says{" "}
                <strong>Continue Setup</strong>.
              </li>
              <li>
                Stripe's own form asks for identity details and the bank account that should receive
                payouts. Complete every required field.
              </li>
              <li>
                Stripe sends you back to the dashboard. If anything is still missing, the banner
                stays up — use Continue Setup again.
              </li>
              <li>
                When the dashboard says payouts are enabled, renters can reserve your cars.{" "}
                <strong>Open Stripe dashboard</strong> shows charges and bank deposits.
              </li>
            </ol>
            <p>
              Coaches do the same thing from the{" "}
              <Link href="/coach/dashboard">coach dashboard</Link>. It is one Stripe account on your
              Renegade profile, so you do not connect a second time for coaching or for race-seat
              payouts you host.
            </p>
          </>
        ),
      },
      {
        question: "When does the money arrive?",
        answer: (
          <p>
            The renter's payment is transferred to your Stripe account when they pay, minus
            Renegade's platform fee. Stripe then deposits it to the bank account you added, on the
            payout schedule in your Stripe dashboard. That deposit is not held until the rental day
            is over.
          </p>
        ),
      },
      {
        question: "What if Stripe says my account needs more information?",
        answer: (
          <p>
            Use Continue Setup, or open the Stripe dashboard and finish the request there. Until
            charges are enabled, renters cannot book your car, and coaching payments cannot be
            collected. A team owner's Stripe account has to be enabled before a driver can pay for a
            seat on that team's car.
          </p>
        ),
      },
    ],
  },
  {
    id: "cancellation",
    title: "Cancellation policies",
    intro: "Vehicle rentals, coaching, and race seats each follow their own rule.",
    items: [
      {
        question: "What are the vehicle cancellation policies?",
        answer: (
          <>
            <p>
              Each listing uses one policy, shown before you submit a request. New listings use
              Moderate. The full comparison is on the{" "}
              <Link href="/cancellation-policy">cancellation policy</Link> page. Measured in days
              before the rental start date:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Flexible:</strong> 100% if you cancel at least 1 day before. 50% on the
                start day or after.
              </li>
              <li>
                <strong>Moderate</strong> (the default): 100% at 7 or more days before. 50% at least
                2 days before and fewer than 7. No refund inside 2 days.
              </li>
              <li>
                <strong>Strict:</strong> 100% at 14 or more days before. 50% at least 7 days before
                and fewer than 14. No refund inside 7 days.
              </li>
            </ul>
            <p>
              Cancel from <Link href="/trips">My Trips</Link>. If the host cancels a rental you
              already paid for, you are refunded in full. On a partial vehicle refund, Renegade's
              platform fee is returned only when the refund is 100%.
            </p>
          </>
        ),
      },
      {
        question: "How do coaching cancellations work?",
        answer: (
          <p>
            Cancel at least 24 hours before the session starts for a full refund. Inside 24 hours,
            the coach keeps the payment. If the coach cancels, you are refunded in full no matter
            the timing.
          </p>
        ),
      },
      {
        question: "How do race seat cancellations work?",
        answer: (
          <>
            <p>
              Refunds use the race start date, and they apply to everything already captured — the
              deposit and any balance.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>You cancel {fullSeatDays} or more days before the race: 100% back.</li>
              <li>
                You cancel at least {partialSeatDays} and less than {fullSeatDays} days before:{" "}
                {partialSeatPercent}% back. The platform fee is refunded in the same proportion.
              </li>
              <li>You cancel with less than {partialSeatDays} days to go: no refund.</li>
              <li>The team cancels: 100% back, at any time.</li>
            </ul>
            <p>Cancelling frees the seat immediately, including when the payment is kept.</p>
          </>
        ),
      },
      {
        question: "When will a refund appear on my card?",
        answer: (
          <p>
            Renegade sends the refund through Stripe to the original payment method as soon as the
            cancellation is confirmed. Your bank decides when it posts. Nothing is refunded for a
            request that was never paid.
          </p>
        ),
      },
    ],
  },
  {
    id: "coaching-seats",
    title: "Coaching, teams, and race seats",
    intro:
      "These are separate from renting a car, and they use the same Stripe account for payouts.",
    items: [
      {
        question: "How do I book a coach?",
        answer: (
          <p>
            Open a profile under <Link href="/coaches">Coaches</Link>, pick dates the coach has
            marked open, and send a request. The coach approves it, then you pay from My Trips. You
            are not charged when you send the request. A coach cannot be paid until they finish
            Stripe setup.
          </p>
        ),
      },
      {
        question: "How do I coach on Renegade?",
        answer: (
          <p>
            Start at <Link href="/coach/onboarding">coach onboarding</Link>. Add your rates,
            experience, and the days you can teach, then connect Stripe from the coach dashboard.
            Requests wait for you to approve them.
          </p>
        ),
      },
      {
        question: "How is joining a team different from buying a race seat?",
        answer: (
          <>
            <p>
              Joining a team is an application, not a payment. Create a{" "}
              <Link href="/motorsports/profile/driver">driver profile</Link>, open a team under{" "}
              <Link href="/motorsports/teams">Teams</Link>, and send your experience and a note. The
              team accepts or declines. You can only have one pending application to that team.
            </p>
            <p>
              A race seat is a paid spot in a specific car for a specific event. The team approves
              the booking first. You then pay a deposit within 48 hours. If the deposit is only part
              of the price, you pay the balance to confirm the seat. If the deposit already covers
              the full price, the seat confirms when that payment succeeds. The team owner has to
              have Stripe payouts enabled or the payment cannot start.
            </p>
          </>
        ),
      },
    ],
  },
]

function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <Accordion className="w-full" defaultValue={items.map((item) => item.question)} type="multiple">
      {items.map((item) => (
        <AccordionItem key={item.question} value={item.question}>
          <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 text-muted-foreground">{item.answer}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-10">
        <h1 className="mb-4 font-bold text-3xl md:text-4xl lg:text-5xl">FAQ</h1>
        <p className="text-lg text-muted-foreground">
          How rentals, hosting, payouts, and cancellations work on Renegade. For a shorter list of
          account questions, see the <Link href="/help">help center</Link>.
        </p>
      </div>

      <nav aria-label="FAQ sections" className="mb-12 flex flex-wrap gap-2">
        {sections.map((section) => (
          <a
            className="rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted"
            href={`#${section.id}`}
            key={section.id}
          >
            {section.title}
          </a>
        ))}
      </nav>

      <div className="space-y-12">
        {sections.map((section) => (
          <section id={section.id} key={section.id}>
            <h2 className="mb-2 font-bold text-2xl">{section.title}</h2>
            <p className="mb-4 text-muted-foreground">{section.intro}</p>
            <Card>
              <CardContent className="p-6">
                <FaqList items={section.items} />
              </CardContent>
            </Card>
          </section>
        ))}
      </div>

      <Card className="mt-16 border bg-muted/30">
        <CardContent className="p-8 text-center sm:p-12">
          <h2 className="mb-4 font-bold text-2xl">Still need help?</h2>
          <p className="mb-6 text-muted-foreground">
            Email{" "}
            <a
              className="font-medium text-foreground underline"
              href="mailto:levi@renegaderace.com"
            >
              levi@renegaderace.com
            </a>{" "}
            or send a note through the contact form.
          </p>
          <Link href="/contact">
            <Button className="gap-2" size="lg">
              Contact support
              <ArrowRight className="size-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
