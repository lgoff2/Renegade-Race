"use client"

import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useCookieConsent } from "@/hooks/useCookieConsent"
import { loadSentry } from "@/lib/sentry-loader"

export function CookieConsentBanner() {
  const { needsConsent, acceptCookies, rejectCookies, isLoading } = useCookieConsent()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Only show banner if consent is needed and not loading
    if (!isLoading && needsConsent) {
      setIsVisible(true)
    }
  }, [needsConsent, isLoading])

  if (!isVisible) {
    return null
  }

  const handleAccept = async () => {
    acceptCookies()
    setIsVisible(false)
    // Initialize Sentry after consent is given
    await loadSentry()
  }

  const handleReject = () => {
    rejectCookies()
    setIsVisible(false)
  }

  return (
    <div
      aria-label="Cookie consent"
      aria-modal="false"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50",
        "border-border border-t bg-background/95 shadow-lg backdrop-blur-sm"
      )}
      role="dialog"
    >
      <Card className="rounded-none border-0 shadow-none">
        <div className="container mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 space-y-2">
              <p className="text-foreground text-sm">
                We use cookies to enhance your experience, analyze site usage, and assist in our
                error tracking efforts. By clicking "Accept", you consent to our use of cookies.{" "}
                <Link
                  className="text-primary underline hover:text-primary/80"
                  href="/privacy"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Learn more in our Privacy Policy
                </Link>
                .
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                className="w-full sm:w-auto"
                onClick={handleReject}
                size="sm"
                variant="outline"
              >
                Decline
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleAccept} size="sm">
                Accept
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
