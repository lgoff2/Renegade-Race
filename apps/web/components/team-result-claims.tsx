"use client"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { toast } from "sonner"
import { api, type Id } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import { formatResultDate } from "@/lib/reliability"

type TeamResultClaimsProps = {
  teamId: Id<"teams">
}

export function TeamResultClaims({ teamId }: TeamResultClaimsProps) {
  const manage = useQuery(api.teamResultLinks.listForTeam, { teamId })
  const series = useQuery(api.raceSeries.list, manage ? {} : "skip")
  const claim = useMutation(api.teamResultLinks.claim)
  const confirmSuggestion = useMutation(api.teamResultLinks.confirmSuggestion)
  const rejectSuggestion = useMutation(api.teamResultLinks.rejectSuggestion)
  const [seriesId, setSeriesId] = useState("")
  const [carNumbers, setCarNumbers] = useState("")
  const [aliases, setAliases] = useState("")
  const [saving, setSaving] = useState(false)

  if (!manage) return null

  const submit = async () => {
    if (!seriesId) {
      toast.error("Choose a series")
      return
    }
    setSaving(true)
    try {
      await claim({
        teamId,
        seriesId: seriesId as Id<"raceSeries">,
        carNumbers: carNumbers.split(",").map((value) => value.trim()),
        nameAliases: aliases.split(",").map((value) => value.trim()),
      })
      setCarNumbers("")
      setAliases("")
      toast.success("Car number claim saved")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "claim race results",
        customMessages: { generic: "We couldn't save that claim." },
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4" id="result-claims">
      <Card>
        <CardHeader>
          <CardTitle>Link race results</CardTitle>
          <p className="text-muted-foreground text-sm">
            Claim the car numbers you run. A number already on a linked seat listing is verified
            immediately. Everything else waits for an admin.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Series</Label>
              <Select onValueChange={setSeriesId} value={seriesId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a series" />
                </SelectTrigger>
                <SelectContent>
                  {(series ?? []).map((item) => (
                    <SelectItem key={item._id} value={item._id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="claim-numbers">Car numbers</Label>
              <Input
                id="claim-numbers"
                onChange={(event) => setCarNumbers(event.target.value)}
                placeholder="17, 08"
                value={carNumbers}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="claim-aliases">Alternate team names</Label>
            <Input
              id="claim-aliases"
              onChange={(event) => setAliases(event.target.value)}
              placeholder="Gridlock, Gridlock Racing"
              value={aliases}
            />
          </div>
          <Button disabled={saving} onClick={submit} type="button">
            {saving ? "Saving…" : "Claim car numbers"}
          </Button>
          {manage.links.length > 0 && (
            <ul className="space-y-2 text-sm">
              {manage.links.map((link) => (
                <li className="flex flex-wrap items-center gap-2" key={link._id}>
                  <span className="font-medium">
                    {link.seriesName} #{link.carNumber}
                  </span>
                  <Badge variant={link.status === "verified" ? "default" : "secondary"}>
                    {link.status}
                  </Badge>
                  {link.nameAliases.length > 0 && (
                    <span className="text-muted-foreground">{link.nameAliases.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {manage.suggestions.map((group) =>
        group.matches.length === 0 ? null : (
          <Card key={group.linkId}>
            <CardHeader>
              <CardTitle className="text-lg">
                Suggested {group.seriesName} #{group.carNumber} results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.matches.map((match) => (
                <div
                  className="flex flex-col gap-2 border-b pb-3 text-sm last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  key={match.entryId}
                >
                  <div>
                    <p className="font-medium">
                      {match.eventName} · {formatResultDate(match.date)}
                    </p>
                    <p className="text-muted-foreground">
                      #{match.carNumber} {match.teamNameRaw} · {match.className} · {match.laps} laps
                      · {match.reason} match
                    </p>
                  </div>
                  {match.linked ? (
                    <Badge>Counted</Badge>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          confirmSuggestion({ linkId: group.linkId, entryId: match.entryId }).catch(
                            (error: unknown) =>
                              handleErrorWithContext(error, { action: "confirm result" })
                          )
                        }
                        size="sm"
                        type="button"
                      >
                        {match.confirmed ? "Confirmed" : "Confirm"}
                      </Button>
                      <Button
                        onClick={() =>
                          rejectSuggestion({ linkId: group.linkId, entryId: match.entryId }).catch(
                            (error: unknown) =>
                              handleErrorWithContext(error, { action: "reject result" })
                          )
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      )}
    </section>
  )
}
