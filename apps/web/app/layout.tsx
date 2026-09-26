import { ClerkProvider } from "@clerk/nextjs"
import { ThemeProvider } from "@workspace/ui/components/theme-provider"
import type { Metadata } from "next"
import { Lato, Oxanium } from "next/font/google"
import "@workspace/ui/globals.css"
import { LayoutWrapper } from "@/components/layout-wrapper"
import { Providers } from "@/components/providers"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: {
    default: "Renegade Race Rentals - Track Car Rentals",
    template: "%s | Renegade Race Rentals",
  },
  description:
    "Rent high-performance track cars for your racing adventures. Experience the thrill of professional racing vehicles at premier tracks across the country.",
  keywords: [
    "track car rental",
    "race car rental",
    "performance car rental",
    "racing experience",
    "track day rental",
    "sports car rental",
  ],
  authors: [{ name: "Renegade Race Rentals" }],
  creator: "Renegade Race Rentals",
  publisher: "Renegade Race Rentals",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://renegaderace.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://renegaderace.com",
    siteName: "Renegade Race Rentals",
    title: "Renegade Race Rentals - Track Car Rentals",
    description:
      "Rent high-performance track cars for your racing adventures. Experience the thrill of professional racing vehicles at premier tracks across the country.",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "Renegade Race Rentals",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Renegade Race Rentals - Track Car Rentals",
    description:
      "Rent high-performance track cars for your racing adventures. Experience the thrill of professional racing vehicles.",
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Add verification codes when available
    // google: "your-google-verification-code",
    // yandex: "your-yandex-verification-code",
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/icon1.png",
    other: [
      {
        rel: "icon",
        type: "image/svg+xml",
        url: "/icon0.svg",
      },
    ],
  },
}

const fontHeader = Oxanium({
  subsets: ["latin"],
  variable: "--font-header",
  weight: "400",
  display: "swap",
  preload: true,
  style: "normal",
})

const fontBody = Lato({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "700"] as const,
  preload: true,
  style: "normal",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      {/* Clip sideways overflow so a horizontal scrollbar cannot sit under the fixed cookie banner. */}
      <html className="overflow-x-clip" lang="en" suppressHydrationWarning>
        <body className={`${fontHeader.variable} ${fontBody.variable} font-sans antialiased`}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            disableTransitionOnChange
            enableColorScheme
            enableSystem
          >
            <Providers>
              <LayoutWrapper>{children}</LayoutWrapper>
            </Providers>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
