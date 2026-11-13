"use client"

import { useUser } from "@clerk/nextjs"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import { useMutation, useQuery } from "convex/react"
import { Flame, Heart, MessageCircle, Send, Trophy, UserPlus } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { api } from "@/lib/convex"
import { r2Url } from "@/lib/r2-url"

function avatarSrc(person?: { profileImage?: string | null; profileImageR2Key?: string | null }) {
  if (person?.profileImageR2Key) return r2Url(person.profileImageR2Key)
  return person?.profileImage || undefined
}

type FeedScope = "for_you" | "following" | "global"

const SCOPE_TABS: { id: FeedScope; label: string }[] = [
  { id: "for_you", label: "For you" },
  { id: "following", label: "Following" },
  { id: "global", label: "Global" },
]

export function PaddockFeed() {
  const { user, isSignedIn } = useUser()
  const [scope, setScope] = useState<FeedScope>(isSignedIn ? "for_you" : "global")
  const [composerText, setComposerText] = useState("")
  const [isPosting, setIsPosting] = useState(false)

  const feed = useQuery(api.posts.listFeed, { scope, limit: 50 })
  const onlineUsers = useQuery(api.posts.listOnlineNow, { limit: 8 })
  const createPost = useMutation(api.posts.createPost)

  const handlePost = async () => {
    const trimmed = composerText.trim()
    if (!(trimmed && isSignedIn)) return
    setIsPosting(true)
    try {
      await createPost({ content: trimmed })
      setComposerText("")
    } finally {
      setIsPosting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
      <div className="space-y-4">
        <div className="flex gap-1 border-border border-b">
          {SCOPE_TABS.map((tab) => (
            <button
              className={`relative px-4 py-2 font-medium text-sm transition-colors ${
                scope === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              key={tab.id}
              onClick={() => setScope(tab.id)}
              type="button"
            >
              {tab.label}
              {scope === tab.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        {isSignedIn && (
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-3">
                <Avatar className="size-10">
                  <AvatarImage src={user?.imageUrl} />
                  <AvatarFallback>
                    {user?.firstName?.[0] ?? user?.username?.[0] ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <Textarea
                    className="min-h-[80px] resize-none"
                    onChange={(e) => setComposerText(e.target.value)}
                    placeholder="Share a lap time, a sale, an event, a question..."
                    value={composerText}
                  />
                  <div className="flex items-center justify-end">
                    <Button
                      disabled={!composerText.trim() || isPosting}
                      onClick={handlePost}
                      size="sm"
                    >
                      <Send className="mr-2 size-4" />
                      Post
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {feed === undefined ? (
          <FeedSkeleton />
        ) : feed.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <Flame className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="font-medium text-sm">The paddock is quiet right now.</p>
              <p className="mt-1 text-muted-foreground text-sm">
                {scope === "following"
                  ? "Follow drivers, teams, and coaches to see their updates here."
                  : "Be the first to post."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {feed.map((item: any) => (
              <FeedItem item={item} key={item._id} />
            ))}
          </div>
        )}
      </div>

      <aside className="hidden space-y-4 lg:block">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-sm">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Online now
            </h3>
            <Separator />
            {onlineUsers === undefined ? (
              <p className="text-muted-foreground text-xs">Loading...</p>
            ) : onlineUsers.length === 0 ? (
              <p className="text-muted-foreground text-xs">No one online right now.</p>
            ) : (
              <ul className="space-y-2">
                {onlineUsers.map((u: any) => (
                  <li className="flex items-center gap-2" key={u.userId}>
                    <Avatar className="size-7">
                      <AvatarImage src={avatarSrc(u)} />
                      <AvatarFallback>{u.name?.[0] ?? "?"}</AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium text-xs">{u.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <div className="size-10 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function FeedItem({ item }: { item: any }) {
  const { isSignedIn } = useUser()
  const reactToPost = useMutation(api.posts.toggleReaction)

  const created = useMemo(() => new Date(item.createdAt), [item.createdAt])
  const relative = useMemo(() => formatRelative(created), [created])

  const handleLike = async () => {
    if (!isSignedIn) return
    await reactToPost({ postId: item._id, type: "fire" })
  }

  if (item._kind === "activity") {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <ActivityIcon type={item.type} />
          <div className="flex-1 text-sm">
            <ActivityLine event={item} />
            <p className="text-muted-foreground text-xs">{relative}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarImage src={avatarSrc(item.author)} />
            <AvatarFallback>{item.author?.name?.[0] ?? "?"}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <Link
              className="font-semibold text-sm hover:underline"
              href={`/profile/${item.author?.userId}`}
            >
              {item.author?.name ?? "Driver"}
            </Link>
            <p className="text-muted-foreground text-xs">{relative}</p>
          </div>
          {item.featuredUntil && item.featuredUntil > Date.now() && (
            <Badge variant="secondary">Featured</Badge>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.content}</p>
        <div className="flex items-center gap-4 text-muted-foreground text-xs">
          <button
            className="flex items-center gap-1 transition-colors hover:text-foreground"
            disabled={!isSignedIn}
            onClick={handleLike}
            type="button"
          >
            <Heart className={`size-4 ${item.userReaction ? "fill-red-500 text-red-500" : ""}`} />
            <span>{item.reactionCount ?? 0}</span>
          </button>
          <Link
            className="flex items-center gap-1 transition-colors hover:text-foreground"
            href={`/paddock/${item._id}`}
          >
            <MessageCircle className="size-4" />
            <span>{item.commentCount ?? 0}</span>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function ActivityIcon({ type }: { type: string }) {
  switch (type) {
    case "driver_joined_team":
      return <UserPlus className="size-5 text-primary" />
    case "race_result_posted":
      return <Trophy className="size-5 text-amber-500" />
    default:
      return <Flame className="size-5 text-primary" />
  }
}

function ActivityLine({ event }: { event: any }) {
  const actor = event.actor?.name ?? "Someone"
  switch (event.type) {
    case "driver_joined_team":
      return (
        <span>
          <strong>{actor}</strong> joined a team
        </span>
      )
    case "team_event_created":
      return (
        <span>
          <strong>{actor}</strong> announced a team event
        </span>
      )
    case "coach_listing_created":
      return (
        <span>
          <strong>{actor}</strong> launched a new coaching listing
        </span>
      )
    case "vehicle_listed":
      return (
        <span>
          <strong>{actor}</strong> listed a new vehicle
        </span>
      )
    case "race_result_posted":
      return (
        <span>
          <strong>{actor}</strong> posted a new race result
        </span>
      )
    case "user_verified":
      return (
        <span>
          <strong>{actor}</strong> got verified
        </span>
      )
    default:
      return (
        <span>
          <strong>{actor}</strong> did something noteworthy
        </span>
      )
  }
}

function formatRelative(date: Date) {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString()
}
