import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

export default function HelpPage() {
  const faqs = [
    {
      category: "Getting Started",
      questions: [
        {
          question: "How do I create an account?",
          answer:
            "Click 'Sign Up' in the top right corner. You'll need a valid email address and to complete our identity verification process.",
        },
        {
          question: "What are the age requirements?",
          answer:
            "Renters must be 18 years or older with a valid driver's license. Track requirements vary by location.",
        },
        {
          question: "How do I search for vehicles?",
          answer:
            "Use the search bar at the top or visit the Vehicles page. Filter by location, dates, and vehicle type to find your perfect track car.",
        },
      ],
    },
    {
      category: "Booking & Payments",
      questions: [
        {
          question: "How do I book a vehicle?",
          answer:
            "Browse available vehicles, select your dates, and click 'Submit Request' to send a booking request to the host. No payment is required up front — once the host approves, you'll have 48 hours to complete payment and confirm your rental.",
        },
        {
          question: "What payment methods do you accept?",
          answer:
            "We accept all major credit cards, debit cards, and digital wallet payments through Stripe.",
        },
        {
          question: "Are there any booking fees?",
          answer:
            "The price you see includes the daily rental rate. Additional fees may apply for delivery or special equipment.",
        },
        {
          question: "Can I cancel my booking?",
          answer:
            "Yes, cancellation policies vary by host and rental duration. Check the cancellation policy listed on each vehicle's details page.",
        },
      ],
    },
    {
      category: "Vehicle & Safety",
      questions: [
        {
          question: "What safety equipment is required?",
          answer:
            "All renters must have proper safety equipment including a DOT-approved helmet, appropriate clothing, and depending on the vehicle, additional safety gear may be required.",
        },
        {
          question: "What's the difference between DOT and Snell helmets?",
          answer:
            "DOT (Department of Transportation) is the minimum legal standard for motorcycle helmets in the US, ensuring basic impact protection. Snell is a voluntary certification with more rigorous testing standards, including multiple impact tests and higher performance thresholds. While DOT approval meets legal requirements, Snell-certified helmets offer enhanced protection and are often preferred for track use. Both are acceptable for rentals, but Snell helmets provide an extra layer of safety for high-performance driving.",
        },
        {
          question: "Are vehicles track-ready?",
          answer:
            "All vehicles listed on Renegade have been verified as track-ready by their hosts. We require basic safety inspections before listing.",
        },
        {
          question: "What if the vehicle has mechanical issues?",
          answer:
            "Contact us immediately. We'll work with the host to provide a replacement vehicle or full refund depending on the circumstances.",
        },
        {
          question: "Is track insurance required?",
          answer:
            "Track insurance is not required, but it is highly recommended to protect both you and the vehicle. Standard auto insurance typically does not cover track use, so track insurance provides important financial protection in case of accidents or damage during your rental. We recommend obtaining track insurance from a reputable provider before your rental period.",
        },
      ],
    },
    {
      category: "Hosting",
      questions: [
        {
          question: "How do I become a host?",
          answer:
            "Visit our host signup page, complete the application process, and verify your vehicle. We'll guide you through the entire onboarding process.",
        },
        {
          question: "What are the requirements for hosting?",
          answer:
            "You need a track-ready vehicle that passes our safety inspection and to complete our host verification process.",
        },
        {
          question: "How do I get paid?",
          answer:
            "Payments are processed through our secure platform and deposited to your linked bank account within 24-48 hours after each rental completes.",
        },
        {
          question: "How much can I earn?",
          answer:
            "Earnings vary based on your vehicle, location, and demand. You set your own daily rate, and we'll show you what comparable vehicles are renting for so you can price competitively.",
        },
      ],
    },
    {
      category: "Cancellation & Refunds",
      questions: [
        {
          question: "What is the cancellation policy?",
          answer:
            "Cancellation policies vary by listing and are set by the host. There are three types: Flexible (full refund up to 1 day before), Moderate (full refund up to 7 days before), and Strict (full refund up to 14 days before). Check the specific policy on each vehicle's listing page.",
        },
        {
          question: "How do I cancel my reservation?",
          answer:
            "Go to your Trips page, select the reservation you want to cancel, and click 'Cancel Reservation'. Follow the prompts to complete the cancellation. Your refund amount will depend on the cancellation policy and how far in advance you cancel.",
        },
        {
          question: "When will I receive my refund?",
          answer:
            "Refunds are processed back to your original payment method within 5-10 business days after the cancellation is confirmed. The exact timing may vary depending on your bank or credit card company.",
        },
        {
          question: "What if the host cancels my reservation?",
          answer:
            "If a host cancels your confirmed reservation, you will receive a full refund regardless of the cancellation policy. We take host cancellations seriously and will help you find an alternative vehicle when possible.",
        },
      ],
    },
    {
      category: "Account & Profile",
      questions: [
        {
          question: "How do I update my profile information?",
          answer:
            "Go to your Profile page from the main menu. You can update your name, profile photo, bio, and contact information. Remember to save your changes before leaving the page.",
        },
        {
          question: "Can I delete my account?",
          answer:
            "Yes, you can delete your account from the Profile Settings page. Note that you cannot delete your account if you have active reservations or pending payments. Once deleted, your account data will be permanently removed within 30 days.",
        },
        {
          question: "How do I become a host if I already have a renter account?",
          answer:
            "Your existing account works for both renting and hosting. Simply visit the Host Dashboard and click 'List Your Vehicle' to start the host onboarding process. You'll need to complete identity verification and connect a bank account for payouts.",
        },
        {
          question: "How do I manage my notification preferences?",
          answer:
            "Go to Profile Settings and click on the Notifications tab. You can customize which email and push notifications you receive for bookings, messages, payments, and promotional updates.",
        },
      ],
    },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-16 text-center">
        <h1 className="mb-4 font-bold text-3xl md:text-4xl lg:text-5xl">Help Center</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground text-xl">
          Find answers to common questions and learn how to make the most of Renegade. For how to
          request a car, list one, connect Stripe, and cancel, start with the{" "}
          <Link className="font-medium text-foreground underline" href="/faq">
            FAQ
          </Link>
          .
        </p>
      </div>

      {/* FAQ by Category */}
      <div className="space-y-8">
        {faqs.map((category) => (
          <Card key={category.category}>
            <CardContent className="p-6">
              <h2 className="mb-6 font-bold text-2xl">{category.category}</h2>
              <Accordion className="w-full" collapsible type="single">
                {category.questions.map((faq, index) => (
                  <AccordionItem key={`${category.category}-${index}`} value={`item-${index}`}>
                    <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                    <AccordionContent>
                      <p className="text-muted-foreground">{faq.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Contact CTA */}
      <Card className="mt-16 border bg-muted/30">
        <CardContent className="p-12 text-center">
          <h2 className="mb-4 font-bold text-2xl">Still need help?</h2>
          <p className="mb-6 text-muted-foreground">
            Can't find what you're looking for? Our support team is here to help.
          </p>
          <Link href="/contact">
            <Button className="gap-2" size="lg">
              Contact Support
              <ArrowRight className="size-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
