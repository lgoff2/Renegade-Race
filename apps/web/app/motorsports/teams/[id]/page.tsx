"use client"

import { useUser } from "@clerk/nextjs"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowLeft,
  Edit,
  Eye,
  EyeOff,
  Globe,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Trash2,
  Twitter,
  Users,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useEffect, useState } from "react"
import { toast } from "sonner"
import { ProfileAnalytics } from "@/components/profile-analytics"
import { TeamApplicationForm } from "@/components/team-application-form"
import { TeamCalendar } from "@/components/team-calendar"
import { TeamCard } from "@/components/team-card"
import { TeamReliability } from "@/components/team-reliability"
import { TeamResultClaims } from "@/components/team-result-claims"
import { TeamRoster } from "@/components/team-roster"
import { TeamSeatOfferings } from "@/components/team-seat-offerings"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import { r2Url } from "@/lib/r2-url"

type TeamDetailPageProps = {
  params: Promise<{
    id: string
  }>
}

const racingTypeLabels: Record<string, string> = {
  "real-world": "🏎️ Real-World",
  "sim-racing": "🎮 Sim Racing",
  both: "🏎️🎮 Both",
}

function getInstagramUrl(instagram: string): string {
  if (instagram.startsWith("@")) {
    return `https://instagram.com/${instagram.slice(1)}`
  }
  if (instagram.startsWith("http")) {
    return instagram
  }
  return `https://instagram.com/${instagram}`
}

function getTwitterUrl(twitter: string): string {
  if (twitter.startsWith("@")) {
    return `https://twitter.com/${twitter.slice(1)}`
  }
  if (twitter.startsWith("http")) {
    return twitter
  }
  return `https://twitter.com/${twitter}`
}

function _getWebsiteUrl(website: string): string {
  if (website.startsWith("http")) {
    return website
  }
  return `https://${website}`
}

export default function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = use(params)
  const { user } = useUser()
  const router = useRouter()
  const teamId = id as Id<"teams">
  const team = useQuery(api.teams.getById, { teamId })
  const similarTeams = useQuery(api.teams.getSimilar, { teamId })
  const isOwner = team && user ? team.ownerId === user.id : false
  const createConversation = useMutation(api.conversations.createMotorsportsConversation)
  const recordView = useMutation(api.profileViews.recordView)
  const updateTeam = useMutation(api.teams.update)
  const deleteTeam = useMutation(api.teams.deleteTeam)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  // Record profile view
  useEffect(() => {
    if (team && user && !isOwner) {
      recordView({ profileId: teamId, profileType: "team" })
    }
  }, [team, user, isOwner, teamId, recordView])

  if (team === undefined) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="mb-6 h-10 w-40" />
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <Skeleton className="h-64 w-full rounded-t-lg rounded-b-none" />
              <CardHeader>
                <Skeleton className="h-8 w-64" />
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Skeleton className="mb-3 h-6 w-24" />
                  <Skeleton className="h-20 w-full" />
                </div>
                <Separator />
                <div>
                  <Skeleton className="mb-3 h-6 w-32" />
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-7 w-24" />
                    <Skeleton className="h-7 w-32" />
                    <Skeleton className="h-7 w-28" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Separator />
                  <Skeleton className="h-12 w-full" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  if (team === null) {
    return (
      <div className="container mx-auto px-4 py-8">
        <nav className="mb-3 flex items-center gap-1.5 text-sm">
          <Link
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            href="/motorsports/teams"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Teams
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-foreground">Not Found</span>
        </nav>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="mb-4 font-semibold text-lg">Team not found</p>
            <p className="mb-6 text-muted-foreground text-sm">
              The team you're looking for doesn't exist or has been removed.
            </p>
            <Button asChild>
              <Link href="/motorsports/teams">Browse Teams</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Allow owners to see their team profile even if it's hidden
  const isHidden = team.isActive === false
  if (isHidden && !isOwner) {
    return (
      <div className="container mx-auto px-4 py-8">
        <nav className="mb-3 flex items-center gap-1.5 text-sm">
          <Link
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            href="/motorsports/teams"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Teams
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-foreground">Not Found</span>
        </nav>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="mb-4 font-semibold text-lg">Team not found</p>
            <p className="mb-6 text-muted-foreground text-sm">
              The team you're looking for doesn't exist or has been removed.
            </p>
            <Button asChild>
              <Link href="/motorsports/teams">Browse Teams</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleToggleVisibility = async () => {
    setIsToggling(true)
    try {
      await updateTeam({ teamId, isActive: !team.isActive })
      toast.success(
        team.isActive
          ? "Team profile hidden successfully"
          : "Team profile made visible successfully"
      )
    } catch (error) {
      handleErrorWithContext(error, {
        action: "update team visibility",
        customMessages: {
          generic: "Failed to update team visibility. Please try again.",
        },
      })
    } finally {
      setIsToggling(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteTeam({ teamId })
      toast.success("Team deleted successfully")
      router.push("/motorsports/teams")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "delete team",
        customMessages: {
          generic: "Failed to delete team. Please try again.",
        },
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 pb-20 lg:pb-8">
      <nav className="mb-4 flex items-center gap-1.5 text-sm">
        <Link
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          href="/motorsports/teams"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Teams
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="truncate text-foreground">{team.name}</span>
      </nav>

      {isHidden && isOwner && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <EyeOff className="size-5 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Your team profile is currently hidden
            </p>
            <p className="text-amber-700 text-sm dark:text-amber-300">
              Other users cannot see this profile.
            </p>
          </div>
          <Button
            disabled={isToggling}
            onClick={handleToggleVisibility}
            size="sm"
            variant="outline"
          >
            {isToggling ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Eye className="mr-1 size-3" />
            )}
            Make Visible
          </Button>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="relative h-64 w-full overflow-hidden rounded-t-lg">
              {team.logoR2Key ? (
                <Image
                  alt={team.name}
                  className="object-cover"
                  fill
                  sizes="(max-width: 1024px) 100vw, 66vw"
                  src={r2Url(team.logoR2Key)}
                />
              ) : team.logoUrl ? (
                // biome-ignore lint/performance/noImgElement: legacy user-supplied URL not in remotePatterns
                <img alt={team.name} className="size-full object-cover" src={team.logoUrl} />
              ) : (
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-primary">
                  <h3 className="font-bold text-4xl text-white">{team.name}</h3>
                </div>
              )}
            </div>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-2xl">{team.name}</CardTitle>
                {team.racingType && (
                  <Badge variant="secondary">{racingTypeLabels[team.racingType]}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {team.description && (
                <>
                  <div>
                    <h3 className="mb-3 font-semibold text-lg">About</h3>
                    <p className="text-muted-foreground leading-relaxed">{team.description}</p>
                  </div>
                  <Separator />
                </>
              )}

              {((team.specialties && team.specialties.length > 0) ||
                (team.requirements && team.requirements.length > 0) ||
                (team.simRacingPlatforms &&
                  team.simRacingPlatforms.length > 0 &&
                  (team.racingType === "sim-racing" || team.racingType === "both"))) && (
                <div>
                  <h3 className="mb-4 font-semibold text-lg">Details</h3>
                  <div className="grid gap-6 sm:grid-cols-2">
                    {team.specialties && team.specialties.length > 0 && (
                      <div>
                        <p className="mb-2 font-medium text-muted-foreground text-sm">
                          Specialties
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {team.specialties.map((specialty: string) => (
                            <Badge className="px-3 py-1 text-sm" key={specialty} variant="outline">
                              {specialty}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {team.requirements && team.requirements.length > 0 && (
                      <div>
                        <p className="mb-2 font-medium text-muted-foreground text-sm">
                          Requirements
                        </p>
                        <ul className="space-y-1">
                          {team.requirements.map((requirement: string) => (
                            <li
                              className="flex items-start gap-2 text-muted-foreground text-sm"
                              key={`requirement-${requirement}`}
                            >
                              <span className="text-primary">•</span>
                              <span>{requirement}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {team.simRacingPlatforms &&
                      team.simRacingPlatforms.length > 0 &&
                      (team.racingType === "sim-racing" || team.racingType === "both") && (
                        <div>
                          <p className="mb-2 font-medium text-muted-foreground text-sm">
                            Sim Racing Platforms
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {team.simRacingPlatforms.map((platform: string) => (
                              <Badge
                                className="px-3 py-1 text-sm"
                                key={platform}
                                variant="secondary"
                              >
                                🎮 {platform}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <TeamRoster isOwner={isOwner} teamId={teamId} />

          <TeamCalendar isOwner={isOwner} teamId={teamId} />

          <TeamReliability teamId={teamId} />

          <TeamResultClaims teamId={teamId} />

          <TeamSeatOfferings isOwner={isOwner} teamId={teamId} />

          <TeamApplicationForm teamId={teamId} />

          {similarTeams && similarTeams.length > 0 && (
            <div>
              <h2 className="mb-4 font-semibold text-xl">Similar Teams</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {similarTeams.map((team: any) => (
                  <TeamCard
                    availableSeats={team.availableSeats}
                    id={team._id}
                    key={team._id}
                    location={team.location}
                    logoR2Key={team.logoR2Key}
                    logoUrl={team.logoUrl}
                    name={team.name}
                    racingType={team.racingType}
                    specialties={team.specialties}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {isOwner && <ProfileAnalytics profileId={teamId} profileType="team" />}

          {user && !isOwner && (
            <Card>
              <CardContent className="p-6">
                <Button
                  className="w-full"
                  onClick={async () => {
                    try {
                      if (!team) return
                      const conversationId = await createConversation({
                        participantId: team.ownerId,
                        conversationType: "team",
                        teamId,
                      })
                      router.push(`/messages/${conversationId}`)
                    } catch {
                      toast.error("Failed to start conversation")
                    }
                  }}
                >
                  <MessageSquare className="mr-2 size-4" />
                  Message Team
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <MapPin className="size-5 text-primary" />
                  <div>
                    <p className="font-semibold">Location</p>
                    <p className="text-muted-foreground text-sm">{team.location}</p>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center gap-3">
                  <Users className="size-5 text-primary" />
                  <div>
                    <p className="font-semibold">Team Openings</p>
                    <p className="text-muted-foreground text-sm">
                      {team.availableSeats} positions open
                    </p>
                  </div>
                </div>

                {team.contactInfo && (
                  <>
                    {team.contactInfo.phone && (
                      <>
                        <Separator />
                        <div className="flex items-center gap-3">
                          <Phone className="size-5 text-primary" />
                          <div>
                            <p className="font-semibold">Phone</p>
                            <p className="text-muted-foreground text-sm">
                              {team.contactInfo.phone}
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {team.contactInfo.email && (
                      <>
                        <Separator />
                        <div className="flex items-center gap-3">
                          <Mail className="size-5 text-primary" />
                          <div>
                            <p className="font-semibold">Email</p>
                            <p className="break-all text-muted-foreground text-sm">
                              {team.contactInfo.email}
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {team.contactInfo.website && (
                      <>
                        <Separator />
                        <div className="flex items-center gap-3">
                          <Globe className="size-5 text-primary" />
                          <div>
                            <p className="font-semibold">Website</p>
                            <p className="text-muted-foreground text-sm">
                              {team.contactInfo.website}
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {team.socialLinks &&
            (team.socialLinks.instagram ||
              team.socialLinks.twitter ||
              team.socialLinks.facebook ||
              team.socialLinks.linkedin) && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {team.socialLinks.instagram && (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a
                          aria-label="Visit Instagram profile"
                          href={getInstagramUrl(team.socialLinks.instagram)}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <Instagram className="mr-2 size-4" />
                          Instagram
                        </a>
                      </Button>
                    )}
                    {team.socialLinks.twitter && (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a
                          aria-label="Visit Twitter profile"
                          href={getTwitterUrl(team.socialLinks.twitter)}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <Twitter className="mr-2 size-4" />
                          Twitter
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Manage Team</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  You own this team profile. You can edit it, hide it from public view, or delete it
                  permanently.
                </p>
                <div className="flex flex-col gap-2">
                  <Button asChild variant="outline">
                    <Link href={`/motorsports/profile/team?edit=${teamId}`}>
                      <Edit className="mr-2 size-4" />
                      Edit Team
                    </Link>
                  </Button>
                  <Button disabled={isToggling} onClick={handleToggleVisibility} variant="outline">
                    {(() => {
                      if (isToggling) {
                        return <Loader2 className="mr-2 size-4 animate-spin" />
                      }
                      return team.isActive ? (
                        <EyeOff className="mr-2 size-4" />
                      ) : (
                        <Eye className="mr-2 size-4" />
                      )
                    })()}
                    {team.isActive ? "Hide Team" : "Show Team"}
                  </Button>
                  <Button
                    disabled={isDeleting}
                    onClick={() => setShowDeleteDialog(true)}
                    variant="destructive"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete Team
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {!isOwner && user && (
        <div className="fixed right-0 bottom-0 left-0 border-t bg-background p-4 lg:hidden">
          <Button
            className="w-full"
            onClick={async () => {
              try {
                if (!team) return
                const conversationId = await createConversation({
                  participantId: team.ownerId,
                  conversationType: "team",
                  teamId,
                })
                router.push(`/messages/${conversationId}`)
              } catch {
                toast.error("Failed to start conversation")
              }
            }}
          >
            <MessageSquare className="mr-2 size-4" />
            Message Team
          </Button>
        </div>
      )}

      <Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this team? This action cannot be undone. Your team
              will be permanently removed from the platform.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isDeleting}
              onClick={() => setShowDeleteDialog(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isDeleting} onClick={handleDelete} variant="destructive">
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 size-4" />
                  Delete Team
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
