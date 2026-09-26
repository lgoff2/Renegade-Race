import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Calendar,
  CalendarCheck,
  Car,
  CheckCircle,
  DollarSign,
  Flag,
  Search,
  Star,
} from "lucide-react"

export default function HowItWorksPage() {
  const renterSteps = [
    {
      icon: Search,
      title: "Browse Vehicles",
      description:
        "Search our collection of track-ready performance cars. Filter by location, date, and vehicle type to find the perfect ride for your track day.",
    },
    {
      icon: CalendarCheck,
      title: "Book Your Track Day",
      description:
        "Select your dates, review the vehicle details and cancellation policy, then complete your booking through our secure payment platform.",
    },
    {
      icon: Flag,
      title: "Hit the Track",
      description:
        "The owner brings the car to the track and supports you there through the rental. Push the limits in a high-performance vehicle built for racing.",
    },
    {
      icon: Star,
      title: "Return & Review",
      description:
        "When the rental ends, complete the return inspection and leave a review to help future renters.",
    },
  ]

  const hostSteps = [
    {
      icon: Car,
      title: "List Your Vehicle",
      description:
        "Complete our host application with your vehicle details, safety features, and photos. We'll verify your vehicle meets our track-ready standards.",
    },
    {
      icon: Calendar,
      title: "Set Availability",
      description:
        "Choose your rental rates, set your available dates, and define your cancellation policy. You have full control over when your vehicle is available.",
    },
    {
      icon: CheckCircle,
      title: "Accept Bookings",
      description:
        "Review booking requests from verified renters, communicate through our messaging platform, and approve rentals that work for you.",
    },
    {
      icon: DollarSign,
      title: "Get Paid",
      description:
        "Receive secure payments through Stripe Connect within 24-48 hours after each completed rental. Track your earnings in your host dashboard.",
    },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-16 text-center">
        <h1 className="mb-4 font-bold text-3xl md:text-4xl lg:text-5xl">How It Works</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground text-xl">
          Whether you're looking to rent a track car or earn money by hosting your own, Renegade
          makes it simple and secure
        </p>
      </div>

      {/* For Renters Section */}
      <div className="mb-16">
        <h2 className="mb-8 text-center font-bold text-2xl md:text-3xl">For Renters</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {renterSteps.map((step, index) => {
            const Icon = step.icon
            return (
              <Card className="relative" key={step.title}>
                <CardHeader>
                  <div className="mb-4 flex items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Icon className="size-6" />
                    </div>
                    <span className="font-bold text-3xl text-muted-foreground">{index + 1}</span>
                  </div>
                  <CardTitle className="text-xl">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">{step.description}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* For Hosts Section */}
      <div className="mb-16">
        <h2 className="mb-8 text-center font-bold text-2xl md:text-3xl">For Hosts</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {hostSteps.map((step, index) => {
            const Icon = step.icon
            return (
              <Card className="relative" key={step.title}>
                <CardHeader>
                  <div className="mb-4 flex items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Icon className="size-6" />
                    </div>
                    <span className="font-bold text-3xl text-muted-foreground">{index + 1}</span>
                  </div>
                  <CardTitle className="text-xl">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">{step.description}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
