"use client"

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
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { useAction, useMutation, useQuery } from "convex/react"
import { Loader2, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { PageHeader } from "@/components/page-header"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"

type SeriesRow = {
  _id: Id<"raceSeries">
  name: string
  showPublicResults?: boolean
  dnfLapThreshold?: number
}

type SessionChoice = {
  id: string
  name: string
  startTime: string
  resultStatus: "official" | "provisional"
}

type EventPreview = {
  eventId: string
  eventName: string
  trackName: string
  date: string
  sessions: SessionChoice[]
}

export default function RaceResultsPage() {
  const series = useQuery(api.raceSeries.listForAdmin, { includeInactive: true })
  const sessions = useQuery(api.timingResults.list, {})
  const pending = useQuery(api.teamResultLinks.listPending, {})

  return (
    <div className="space-y-6">
      <PageHeader
        description="Import Speedhive or CSV results, approve team claims, and choose which series are public."
        title="Race results"
      />
      <SeriesSettings series={series} />
      <SpeedhiveImport series={series} />
      <CsvImport series={series} />
      <ImportedSessions sessions={sessions} />
      <PendingLinks pending={pending} />
    </div>
  )
}

function SeriesSettings({ series }: { series: SeriesRow[] | undefined }) {
  const update = useMutation(api.timingResults.setSeriesResultsSettings)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Public results</CardTitle>
        <p className="text-muted-foreground text-sm">
          Turning a series off hides its reliability cards. Leave the DNF fraction blank to use 70%
          of the class winner's laps.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {series === undefined && <Loader2 className="size-4 animate-spin" />}
        {series?.length === 0 && <p className="text-muted-foreground text-sm">No series yet.</p>}
        {series?.map((item) => (
          <div
            className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center"
            key={item._id}
          >
            <div className="min-w-0 flex-1 font-medium">{item.name}</div>
            <div className="flex items-center gap-2">
              <Switch
                checked={item.showPublicResults !== false}
                onCheckedChange={(checked) => {
                  update({ seriesId: item._id, showPublicResults: checked }).catch(
                    (error: unknown) =>
                      handleErrorWithContext(error, { action: "update series visibility" })
                  )
                }}
              />
              <span className="text-sm">Public</span>
            </div>
            <Input
              className="w-28"
              defaultValue={item.dnfLapThreshold ?? ""}
              key={`${item._id}-${item.dnfLapThreshold ?? "default"}`}
              onBlur={(event) => saveThreshold(update, item._id, event.target.value)}
              placeholder="0.70"
              type="number"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function saveThreshold(
  update: (args: {
    seriesId: Id<"raceSeries">
    dnfLapThreshold: number | null
  }) => Promise<unknown>,
  seriesId: Id<"raceSeries">,
  raw: string
) {
  const trimmed = raw.trim()
  if (!trimmed) {
    update({ seriesId, dnfLapThreshold: null }).catch((error: unknown) =>
      handleErrorWithContext(error, { action: "clear DNF threshold" })
    )
    return
  }
  const value = Number(trimmed)
  if (!(value > 0 && value <= 1)) {
    toast.error("DNF fraction must be greater than 0 and at most 1")
    return
  }
  update({ seriesId, dnfLapThreshold: value }).catch((error: unknown) =>
    handleErrorWithContext(error, { action: "update DNF threshold" })
  )
}

function SpeedhiveImport({ series }: { series: SeriesRow[] | undefined }) {
  const listSessions = useAction(api.speedhive.listEventSessions)
  const importSession = useAction(api.speedhive.importSession)
  const [eventId, setEventId] = useState("")
  const [seriesId, setSeriesId] = useState("")
  const [raceEventId, setRaceEventId] = useState("")
  const [preview, setPreview] = useState<EventPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setPreview(await listSessions({ eventId }))
    } catch (error) {
      handleErrorWithContext(error, {
        action: "load Speedhive event",
        customMessages: { generic: "Speedhive did not return that event." },
      })
    } finally {
      setLoading(false)
    }
  }

  const importOne = async (sessionId: string) => {
    if (!seriesId) {
      toast.error("Choose a series")
      return
    }
    setImportingId(sessionId)
    try {
      const result = await importSession({
        eventId: preview?.eventId || eventId,
        sessionId,
        seriesId: seriesId as Id<"raceSeries">,
        raceEventId: raceEventId ? (raceEventId as Id<"raceEvents">) : undefined,
      })
      toast.success(`Imported ${result.entryCount} cars`)
    } catch (error) {
      handleErrorWithContext(error, {
        action: "import Speedhive session",
        customMessages: { generic: "We couldn't import that session." },
      })
    } finally {
      setImportingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Speedhive import</CardTitle>
        <p className="text-muted-foreground text-sm">
          Paste a Speedhive event id. Practice and qualifying are skipped, and a re-scored race
          keeps the Official session. Known organizations: ChampCar 711361 (Mar 2025 onward) and
          110092 (legacy), Lucky Dog 247264, WRL 209312.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event id">
            <Input onChange={(event) => setEventId(event.target.value)} value={eventId} />
          </Field>
          <Field label="Series">
            <SeriesSelect onChange={setSeriesId} series={series} value={seriesId} />
          </Field>
          <Field label="Linked seat event id (optional)">
            <Input
              onChange={(event) => setRaceEventId(event.target.value)}
              placeholder="raceEvents id"
              value={raceEventId}
            />
          </Field>
        </div>
        <Button disabled={loading || !eventId} onClick={load} type="button">
          {loading ? "Loading…" : "List race sessions"}
        </Button>
        {preview && (
          <div className="space-y-2">
            <p className="font-medium">
              {preview.eventName}
              {preview.trackName ? ` · ${preview.trackName}` : ""} {preview.date}
            </p>
            {preview.sessions.length === 0 && (
              <p className="text-muted-foreground text-sm">No race sessions on this event.</p>
            )}
            {preview.sessions.map((session) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                key={session.id}
              >
                <span>
                  {session.name} · {session.resultStatus}
                  {session.startTime ? ` · ${session.startTime.slice(0, 10)}` : ""}
                </span>
                <Button
                  disabled={importingId === session.id}
                  onClick={() => importOne(session.id)}
                  size="sm"
                  type="button"
                >
                  {importingId === session.id ? "Importing…" : "Import"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CsvImport({ series }: { series: SeriesRow[] | undefined }) {
  const importCsv = useMutation(api.timingResults.importCsv)
  const [form, setForm] = useState({
    seriesId: "",
    eventName: "",
    sessionName: "Race",
    trackName: "",
    date: "",
    resultStatus: "official" as "official" | "provisional",
    sourceUrl: "",
    csvText: "",
  })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.seriesId) {
      toast.error("Choose a series")
      return
    }
    setSaving(true)
    try {
      const result = await importCsv({
        seriesId: form.seriesId as Id<"raceSeries">,
        eventName: form.eventName,
        sessionName: form.sessionName,
        trackName: form.trackName,
        date: form.date,
        resultStatus: form.resultStatus,
        sourceUrl: form.sourceUrl,
        csvText: form.csvText,
      })
      toast.success(`Imported ${result.entryCount} cars`)
      setForm((current) => ({ ...current, csvText: "" }))
    } catch (error) {
      handleErrorWithContext(error, {
        action: "import results CSV",
        customMessages: { generic: "We couldn't import that CSV." },
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV upload</CardTitle>
        <p className="text-muted-foreground text-sm">
          Use the Speedhive columns Pos, Start Number, Competitor, Class, and Laps. Status and Class
          Pos are optional.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Series">
            <SeriesSelect
              onChange={(seriesId) => setForm((current) => ({ ...current, seriesId }))}
              series={series}
              value={form.seriesId}
            />
          </Field>
          <Field label="Result status">
            <Select
              onValueChange={(resultStatus) =>
                setForm((current) => ({
                  ...current,
                  resultStatus: resultStatus as "official" | "provisional",
                }))
              }
              value={form.resultStatus}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="official">Official</SelectItem>
                <SelectItem value="provisional">Provisional</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Event name">
            <Input
              onChange={(event) =>
                setForm((current) => ({ ...current, eventName: event.target.value }))
              }
              value={form.eventName}
            />
          </Field>
          <Field label="Session name">
            <Input
              onChange={(event) =>
                setForm((current) => ({ ...current, sessionName: event.target.value }))
              }
              value={form.sessionName}
            />
          </Field>
          <Field label="Track">
            <Input
              onChange={(event) =>
                setForm((current) => ({ ...current, trackName: event.target.value }))
              }
              value={form.trackName}
            />
          </Field>
          <Field label="Date">
            <Input
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              type="date"
              value={form.date}
            />
          </Field>
        </div>
        <Field label="Source URL">
          <Input
            onChange={(event) =>
              setForm((current) => ({ ...current, sourceUrl: event.target.value }))
            }
            placeholder="https://"
            value={form.sourceUrl}
          />
        </Field>
        <Field label="CSV">
          <Input
            accept=".csv,text/csv,text/plain"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const csvText = await file.text()
              setForm((current) => ({ ...current, csvText }))
            }}
            type="file"
          />
          <Textarea
            className="mt-2 font-mono text-xs"
            onChange={(event) =>
              setForm((current) => ({ ...current, csvText: event.target.value }))
            }
            rows={6}
            value={form.csvText}
          />
        </Field>
        <Button disabled={saving} onClick={submit} type="button">
          {saving ? "Importing…" : "Import CSV"}
        </Button>
      </CardContent>
    </Card>
  )
}

type ListedSession = {
  _id: Id<"timingSessions">
  eventName: string
  sessionName: string
  trackName: string
  date: string
  source: string
  resultStatus: string
  seriesName: string
  entryCount: number
  sourceUrl: string
}

function ImportedSessions({ sessions }: { sessions: ListedSession[] | undefined }) {
  const remove = useMutation(api.timingResults.remove)
  const [pendingDelete, setPendingDelete] = useState<Id<"timingSessions"> | null>(null)
  const [deleting, setDeleting] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imported sessions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions === undefined && <Loader2 className="size-4 animate-spin" />}
        {sessions?.length === 0 && (
          <p className="text-muted-foreground text-sm">Nothing imported yet.</p>
        )}
        {sessions?.map((session) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm"
            key={session._id}
          >
            <div>
              <p className="font-medium">
                {session.seriesName} · {session.eventName}
              </p>
              <p className="text-muted-foreground">
                {session.date} · {session.trackName} · {session.sessionName} · {session.source} ·{" "}
                {session.resultStatus} · {session.entryCount} cars
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a className="underline" href={session.sourceUrl} rel="noreferrer" target="_blank">
                Source
              </a>
              <Button
                onClick={() => setPendingDelete(session._id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
                <span className="sr-only">Delete session</span>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      <ConfirmDialog
        confirmLabel="Delete"
        description="This removes the session and its results. Claims stay, but those rows stop counting."
        isLoading={deleting}
        onConfirm={() => {
          if (!pendingDelete) return
          setDeleting(true)
          remove({ sessionId: pendingDelete })
            .then(() => setPendingDelete(null))
            .catch((error: unknown) => handleErrorWithContext(error, { action: "delete session" }))
            .finally(() => setDeleting(false))
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        open={pendingDelete !== null}
        title="Delete imported session?"
        variant="destructive"
      />
    </Card>
  )
}

function PendingLinks({
  pending,
}: {
  pending:
    | Array<{
        _id: Id<"teamResultLinks">
        teamName: string
        seriesName: string
        carNumber: string
        nameAliases: string[]
      }>
    | undefined
}) {
  const review = useMutation(api.teamResultLinks.review)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending result claims</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending === undefined && <Loader2 className="size-4 animate-spin" />}
        {pending?.length === 0 && (
          <p className="text-muted-foreground text-sm">No claims waiting.</p>
        )}
        {pending?.map((link) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm"
            key={link._id}
          >
            <div>
              <p className="font-medium">
                {link.teamName} · {link.seriesName} #{link.carNumber}
              </p>
              {link.nameAliases.length > 0 && (
                <p className="text-muted-foreground">{link.nameAliases.join(", ")}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  review({ linkId: link._id, decision: "verified" }).catch((error: unknown) =>
                    handleErrorWithContext(error, { action: "approve claim" })
                  )
                }}
                size="sm"
                type="button"
              >
                Approve
              </Button>
              <Button
                onClick={() => {
                  review({ linkId: link._id, decision: "rejected" }).catch((error: unknown) =>
                    handleErrorWithContext(error, { action: "reject claim" })
                  )
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SeriesSelect({
  series,
  value,
  onChange,
}: {
  series: SeriesRow[] | undefined
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Select onValueChange={onChange} value={value}>
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
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
