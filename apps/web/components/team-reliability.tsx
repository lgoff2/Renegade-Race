"use client"

import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { useQuery } from "convex/react"
import { api, type Id } from "@/lib/convex"
import {
  classPositionLabel,
  dnfBadgeLabel,
  dnfCountLabel,
  formatLapsPct,
  formatResultDate,
} from "@/lib/reliability"

const SPEEDHIVE_HOME = "https://speedhive.mylaps.com"

type TeamReliabilityProps = {
  teamId: Id<"teams">
}

export function TeamReliability({ teamId }: TeamReliabilityProps) {
  const groups = useQuery(api.reliability.getForTeam, { teamId })
  if (!groups || groups.length === 0) return null

  return (
    <section className="space-y-4" id="race-results">
      <div>
        <p className="font-medium text-primary text-sm uppercase tracking-wider">
          Endurance racing
        </p>
        <h2 className="mt-1 font-semibold text-2xl">Race results & reliability</h2>
        <p className="mt-1 text-muted-foreground">
          Verified starts in each series and class. Finish pace is how often the car runs near the
          class winner, and the class result is shown as a top percent.
        </p>
      </div>
      {groups.map((group) => {
        const speedhive = group.recent.some((result) => result.source === "speedhive")
        return (
          <Card key={`${group.seriesId}-${group.className}`}>
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl">
                {group.seriesName} Class {group.className}
              </CardTitle>
              <p className="text-muted-foreground text-sm">{group.starts} verified starts</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Avg laps vs class winner" value={formatLapsPct(group.avgLapsPct)} />
                <Stat label="DNFs out of starts" value={dnfCountLabel(group.dnfs)} />
                <Stat label="Typical class finish" value={group.typicalFinishLabel} />
              </div>
              <p className="text-sm">
                Last {group.last5.starts}: {formatLapsPct(group.last5.avgLapsPct)} of winner laps,{" "}
                {dnfCountLabel(group.last5.dnfs)}, {group.last5.typicalFinishLabel}
              </p>
              {group.recent.length > 0 && (
                <ul className="divide-y rounded-lg border">
                  {group.recent.map((result) => (
                    <li key={result.entryId}>
                      <a
                        className="flex flex-col gap-1 px-3 py-3 text-sm transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between"
                        href={result.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span>
                          <span className="font-medium">{result.eventName}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {formatResultDate(result.date)}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <span>
                            {classPositionLabel(result.posInClass, result.classStarters)} ·{" "}
                            {result.laps} of {result.classWinnerLaps} laps
                          </span>
                          {result.isDnf && (
                            <Badge variant="destructive">
                              {dnfBadgeLabel(result.dnfReason, group.dnfLapFraction)}
                            </Badge>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {speedhive && (
                <p className="text-muted-foreground text-xs">
                  Results:{" "}
                  <a className="underline" href={SPEEDHIVE_HOME} rel="noreferrer" target="_blank">
                    MYLAPS Speedhive
                  </a>
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-lg">{value}</p>
    </div>
  )
}
