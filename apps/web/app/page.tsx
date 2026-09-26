"use client"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { useQuery } from "convex/react"
import { ArrowRight, Car, CheckCircle2, CreditCard, Search, Trophy, Zap } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { Reveal } from "@/components/home/reveal"
import { VehicleCard } from "@/components/vehicle-card"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"

const TRACKS = [
  "Laguna Seca",
  "Watkins Glen",
  "Road America",
  "Circuit of the Americas",
  "Sebring",
  "VIR",
  "Road Atlanta",
  "Sonoma Raceway",
  "Barber Motorsports",
  "Lime Rock Park",
]

const STEPS = [
  {
    icon: Search,
    title: "Search & Browse",
    body: "Find your perfect track car from our extensive collection of verified vehicles. Filter by location, price, and specifications.",
  },
  {
    icon: CreditCard,
    title: "Request to Book",
    body: "Send a booking request for the dates that fit your schedule. Once the host approves, your rental is confirmed with secure, protected payments.",
  },
  {
    icon: Car,
    title: "Hit the Track",
    body: "The car is waiting at the track. Show up for your session and we'll provide full support throughout your rental.",
  },
]

export default function HomePage() {
  const router = useRouter()
  // Track video load error for hero section
  const [heroVideoFailed, setHeroVideoFailed] = useState(false)
  // Track video load error for about section
  const [videoError, setVideoError] = useState(false)
  // Hero quick-search query
  const [searchQuery, setSearchQuery] = useState("")

  // Fetch vehicles from Convex
  const vehiclesData = useQuery(api.vehicles.getAllWithOptimizedImages, { limit: 6 })

  // Fetch vehicle stats for featured vehicles
  const featuredVehicleIds = useMemo(() => {
    if (!vehiclesData) return []
    return vehiclesData.slice(0, 6).map((v: any) => v._id as Id<"vehicles">)
  }, [vehiclesData])

  const featuredVehicleStats = useQuery(
    api.reviews.getVehicleStatsBatch,
    featuredVehicleIds.length > 0 ? { vehicleIds: featuredVehicleIds } : "skip"
  )

  const featuredVehicles = useMemo(() => {
    if (!vehiclesData) return []
    return vehiclesData.slice(0, 6).map((vehicle: any) => {
      const primaryImage = vehicle.images?.find((img: any) => img.isPrimary) || vehicle.images?.[0]
      const stats = featuredVehicleStats?.[vehicle._id]

      // Build location string from vehicle address (city, state) or fall back to track location
      const locationParts = []
      if (vehicle.address?.city) locationParts.push(vehicle.address.city)
      if (vehicle.address?.state) locationParts.push(vehicle.address.state)
      const location =
        locationParts.length > 0 ? locationParts.join(", ") : vehicle.track?.location || ""

      return {
        id: vehicle._id,
        image: "",
        imageKey: primaryImage?.r2Key ?? undefined,
        name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        pricePerDay: vehicle.dailyRate,
        location,
        track: vehicle.track?.name || "",
        rating: stats?.averageRating || 0,
        reviews: stats?.totalReviews || 0,
        horsepower: vehicle.horsepower,
        transmission: vehicle.transmission,
        drivetrain: vehicle.drivetrain,
      }
    })
  }, [vehiclesData, featuredVehicleStats])

  const benefits = [
    "Host-approved booking requests",
    "Verified host vehicles",
    "Responsive email support",
  ]

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    router.push(q ? `/vehicles?q=${encodeURIComponent(q)}` : "/vehicles")
  }

  return (
    <div className="pb-32">
      {/* Hero Section */}
      <section className="relative flex h-screen max-h-[920px] min-h-[640px] flex-col overflow-hidden">
        {/* Fallback Background Image - only shown when video fails */}
        {heroVideoFailed && (
          <div className="absolute inset-0">
            <Image
              alt="Racing on track"
              className="animate-ken-burns object-cover"
              fill
              priority
              src="/images/clement-delacre-JuEQI7nssh0-unsplash.jpg"
            />
          </div>
        )}

        {/* Video Background - only shown when video hasn't failed */}
        {!heroVideoFailed && (
          <video
            autoPlay
            className="absolute inset-0 h-full w-full animate-ken-burns object-cover"
            loop
            muted
            onAbort={() => setHeroVideoFailed(true)}
            onError={() => setHeroVideoFailed(true)}
            playsInline
            poster="/images/hero-vid-thumbnail.png"
          >
            <source
              src="https://pub-a50e44fe83ed433f81cb9d89aa0e106b.r2.dev/site-media/renegade-hero-video.mp4"
              type="video/mp4"
            />
          </video>
        )}

        {/* Cinematic overlays: bottom-up darkening + red speed glow */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/40" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_15%_100%,rgba(239,28,37,0.28),transparent_55%)]" />

        {/* Content Overlay */}
        <div className="container relative z-10 mx-auto flex flex-1 items-center px-4 sm:px-6">
          <div className="max-w-3xl space-y-8 text-white">
            {/* Kicker */}
            <div className="flex items-center gap-3">
              <span className="h-px w-10 bg-primary" />
              <span className="font-medium font-mono text-primary text-xs uppercase tracking-[0.3em]">
                Track-Ready Rentals
              </span>
            </div>

            <div className="space-y-6">
              <h1 className="font-bold text-4xl uppercase leading-[0.95] tracking-tight md:text-6xl lg:text-7xl xl:text-8xl">
                Experience the
                <span className="block text-primary">ultimate thrill</span>
                of racing
              </h1>
              <p className="max-w-xl text-lg text-white/80 leading-relaxed md:text-xl">
                Rent high-performance track cars from verified hosts. Book your dream car today and
                feel the adrenaline rush on the world's best tracks.
              </p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {benefits.map((benefit) => (
                <div className="flex items-center gap-2 text-sm text-white/85" key={benefit}>
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>

            {/* Quick search */}
            <form
              className="flex w-full max-w-xl flex-col gap-2 rounded-xl border border-white/15 bg-black/40 p-2 backdrop-blur-md sm:flex-row sm:items-center"
              onSubmit={handleSearch}
            >
              <div className="flex flex-1 items-center gap-2 px-3">
                <Search className="size-5 shrink-0 text-white/60" />
                <input
                  className="w-full bg-transparent py-3 text-white placeholder:text-white/50 focus:outline-none"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by make, model, or track…"
                  value={searchQuery}
                />
              </div>
              <Button className="shrink-0" size="lg" type="submit">
                <Car className="mr-2 size-5" />
                Find Cars
              </Button>
            </form>
          </div>
        </div>

        {/* Trusted-tracks marquee pinned to hero bottom */}
        <div className="relative z-10 border-white/10 border-t bg-black/50 py-4 backdrop-blur-sm">
          <div className="flex w-max animate-marquee items-center gap-12 pl-12">
            {[...TRACKS, ...TRACKS].map((track, i) => (
              <span
                className="flex items-center gap-3 whitespace-nowrap font-medium font-mono text-sm text-white/50 uppercase tracking-widest"
                key={`${track}-${i}`}
              >
                <Trophy className="size-4 text-primary/70" />
                {track}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-28 sm:px-6">
        <Reveal className="mb-16 text-center">
          <span className="font-medium font-mono text-primary text-xs uppercase tracking-[0.3em]">
            Simple Process
          </span>
          <h2 className="mt-3 mb-4 font-bold text-3xl uppercase tracking-tight md:text-4xl lg:text-5xl">
            How It Works
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Get on the track in three simple steps
          </p>
        </Reveal>
        <div className="relative">
          {/* Dashed racing line connecting the steps - desktop only */}
          <div className="absolute top-[4.75rem] right-[16.66%] left-[16.66%] hidden border-border border-t-2 border-dashed md:block" />

          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal delay={i * 120} key={step.title}>
                <Card className="group relative h-full overflow-hidden border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-[0_24px_48px_-16px_rgba(0,0,0,0.3)]">
                  {/* top accent */}
                  <div className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-primary transition-transform duration-300 group-hover:scale-x-100" />
                  {/* Ghosted step numeral watermark */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-4 right-2 select-none font-bold text-7xl text-foreground/[0.06] text-stroke leading-none transition-colors duration-300 group-hover:text-primary/15 md:text-8xl"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <CardContent className="relative p-8">
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 transition-all duration-300 group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground group-hover:ring-primary">
                      <step.icon className="size-8" />
                    </div>
                    <span className="font-medium font-mono text-muted-foreground text-xs uppercase tracking-[0.25em]">
                      Step {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-2 mb-3 font-semibold text-xl transition-colors group-hover:text-primary">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">{step.body}</p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Vehicles - light garage */}
      <section className="relative overflow-hidden bg-muted/40 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_85%_0%,rgba(239,28,37,0.07),transparent_55%)]" />
        <div className="container relative mx-auto px-4 sm:px-6">
          <Reveal className="mb-16 text-center">
            <span className="font-medium font-mono text-primary text-xs uppercase tracking-[0.3em]">
              The Garage
            </span>
            <h2 className="mt-3 mb-4 font-bold text-3xl uppercase tracking-tight md:text-4xl lg:text-5xl">
              Premium Track Vehicles
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Hand-picked selection of top-rated track cars from verified hosts
            </p>
          </Reveal>
          {vehiclesData ? (
            featuredVehicles.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-muted-foreground">No vehicles available yet</p>
              </div>
            ) : (
              <div className="grid auto-rows-fr gap-6 md:grid-cols-2 lg:grid-cols-3">
                {featuredVehicles.slice(0, 3).map((vehicle: any, i: number) => (
                  <Reveal delay={i * 120} key={vehicle.id}>
                    <VehicleCard {...vehicle} />
                  </Reveal>
                ))}
              </div>
            )
          ) : (
            <div className="py-16 text-center">
              <div className="mb-4 inline-block size-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
              <p className="text-muted-foreground">Loading featured vehicles...</p>
            </div>
          )}
          <div className="mt-16 text-center">
            <Link href="/vehicles">
              <Button className="group" size="lg">
                View All Vehicles
                <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="container mx-auto px-4 py-28 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Text Content */}
          <Reveal className="space-y-6" from="left">
            <span className="font-medium font-mono text-primary text-xs uppercase tracking-[0.3em]">
              Who We Are
            </span>
            <h2 className="font-bold text-3xl uppercase tracking-tight md:text-4xl lg:text-5xl">
              Your Gateway to Track Day Excellence
            </h2>
            <div className="space-y-5 text-lg text-muted-foreground leading-relaxed md:text-xl">
              <p>
                Renegade Rentals connects passionate drivers with high-performance track cars from
                verified hosts. Whether you're a seasoned racer looking to experience a new vehicle
                or a track enthusiast wanting to push your limits, we make it easy to find and rent
                the perfect track car for your next event.
              </p>
              <p>
                Our platform ensures every vehicle meets strict quality and safety standards. Join
                our community of drivers and hosts who share a passion for motorsports and
                performance.
              </p>
            </div>
          </Reveal>

          {/* Video Content */}
          <Reveal from="right">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-muted shadow-[0_30px_60px_-20px_rgba(0,0,0,0.4)] ring-1 ring-border">
              {videoError ? (
                <Image
                  alt="Racing on track"
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  src="/images/clement-delacre-JuEQI7nssh0-unsplash.jpg"
                />
              ) : (
                <video
                  className="h-full w-full object-cover"
                  controls
                  loop
                  muted
                  onError={() => setVideoError(true)}
                  playsInline
                >
                  <source
                    src="https://pub-a50e44fe83ed433f81cb9d89aa0e106b.r2.dev/site-media/Renegade_promo_video.mp4"
                    type="video/mp4"
                  />
                  Your browser does not support the video tag.
                </video>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl bg-zinc-950 p-12 text-center md:p-20">
            {/* Cinematic background image */}
            <Image
              alt=""
              className="object-cover object-center opacity-35"
              fill
              sizes="(max-width: 1280px) 100vw, 1280px"
              src="/images/clement-delacre-JuEQI7nssh0-unsplash.jpg"
            />
            {/* Overlays: darken + red speed glow */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/50" />
            <div className="absolute inset-0 bg-[radial-gradient(90%_130%_at_50%_120%,rgba(239,28,37,0.45),transparent_60%)]" />

            {/* Checkered-flag accent strip */}
            <div className="absolute inset-x-0 top-0 h-3 opacity-25 [background-image:conic-gradient(#fff_25%,transparent_0_50%,#fff_0_75%,transparent_0)] [background-size:14px_14px]" />

            {/* Shine sweep */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute top-0 left-0 h-full w-1/3 animate-shine-sweep bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>

            <div className="relative z-10 text-white">
              <div className="mb-5 flex items-center justify-center gap-3">
                <span className="h-px w-8 bg-primary" />
                <span className="font-medium font-mono text-primary text-xs uppercase tracking-[0.3em]">
                  Start Your Engine
                </span>
                <span className="h-px w-8 bg-primary" />
              </div>
              <h2 className="mb-6 font-bold text-4xl uppercase leading-[0.95] tracking-tight md:text-5xl lg:text-6xl">
                Ready to <span className="text-primary">Race?</span>
              </h2>
              <p className="mx-auto mb-10 max-w-2xl text-lg text-white/80 leading-relaxed md:text-xl">
                Experience the thrill of track car rentals. Start your journey today.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link href="/vehicles">
                  <Button
                    className="group w-full bg-white text-zinc-950 hover:bg-white/90 sm:w-auto"
                    size="lg"
                  >
                    <Car className="mr-2 size-5" />
                    Browse Available Vehicles
                    <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <Link href="/host/dashboard">
                  <Button
                    className="w-full border-white/30 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 sm:w-auto"
                    size="lg"
                    variant="outline"
                  >
                    <Zap className="mr-2 size-5" />
                    Become a Host
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  )
}
