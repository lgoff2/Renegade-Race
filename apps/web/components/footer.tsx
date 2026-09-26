import { Facebook, Instagram } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-border border-t bg-background">
      <div className="container mx-auto px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          <div className="flex items-center gap-2.5">
            <Image alt="Renegade" className="rounded-full" height={24} src="/logo.png" width={24} />
            <h3 className="font-semibold text-base text-foreground tracking-tight">Renegade</h3>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/vehicles"
            >
              Browse Vehicles
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/faq"
            >
              FAQ
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/help"
            >
              Help Center
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/contact"
            >
              Contact Us
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/how-it-works"
            >
              How It Works
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/safety"
            >
              Safety
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/cancellation-policy"
            >
              Cancellation Policy
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <Link
              aria-label="Instagram"
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="https://instagram.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Instagram className="size-5" />
            </Link>
            <Link
              aria-label="Facebook"
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="https://facebook.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Facebook className="size-5" />
            </Link>
          </div>
        </div>

        <div className="mt-8 border-border border-t pt-8">
          <p className="mb-4 text-center text-muted-foreground text-sm">
            Questions? Email{" "}
            <a
              className="font-medium text-foreground underline-offset-4 transition-colors hover:underline"
              href="mailto:levi@renegaderace.com"
            >
              levi@renegaderace.com
            </a>
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <p className="text-center text-muted-foreground text-sm">
              © {new Date().getFullYear()} Renegade. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-muted-foreground text-sm">
              <Link className="transition-colors hover:text-foreground" href="/privacy">
                Privacy Policy
              </Link>
              <span>•</span>
              <Link className="transition-colors hover:text-foreground" href="/terms">
                Terms of Service
              </Link>
              <span>•</span>
              <Link className="transition-colors hover:text-foreground" href="/cookie-preferences">
                Cookie Preferences
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
