import { api } from "@renegade/backend/convex/_generated/api"
import { ConvexHttpClient } from "convex/browser"
import type { MetadataRoute } from "next"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://renegaderace.com"

  // Static routes
  const staticRoutes = [
    "",
    "/vehicles",
    "/contact",
    "/help",
    "/faq",
    "/motorsports",
    "/motorsports/drivers",
    "/motorsports/teams",
  ].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: route === "" ? 1 : 0.8,
  }))

  // Dynamic vehicle routes
  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

    // Fetch all active, approved vehicles using a query that doesn't require auth
    const vehicles = await convex.query(api.vehicles.getAll, { limit: 1000 })

    const vehicleRoutes = vehicles.map((vehicle: any) => ({
      url: `${baseUrl}/vehicles/${vehicle._id}`,
      lastModified: new Date(vehicle.updatedAt || vehicle._creationTime),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }))

    return [...staticRoutes, ...vehicleRoutes]
  } catch (_error) {
    return staticRoutes
  }
}
