// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  carNumbersMatch,
  classificationToEntries,
  deriveEntries,
  looseNameMatch,
  parseResultsCsv,
  selectRaceSessions,
  splitCompetitorName,
  topPercentLabel,
} from "./reliabilityMetrics"
import schema from "./schema"

vi.mock("./rateLimiter", () => ({
  rateLimiter: { limit: async () => ({ ok: true, retryAfter: 0 }) },
}))

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>
  }
).glob("./**/*.ts")

const OWNER = "team_owner_1"
const MANAGER = "team_manager_1"
const CREW = "team_crew_1"
const STRANGER = "stranger_1"
const ADMIN = "admin_1"

function adminIdentity() {
  return { subject: ADMIN, publicMetadata: { role: "admin" }, orgRole: "admin" }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

let winnerLaps = 448

function champEvent() {
  return {
    id: 3670260,
    name: "The Thompson 12",
    startDate: "2026-08-22",
    location: { name: "Thompson Speedway" },
    organization: { name: "ChampCar Endurance Series" },
    sessions: {
      sessions: [
        {
          id: 111,
          name: "Practice",
          type: "practice",
          startTime: "2026-08-21T12:00:00",
          resultStatus: "Official",
        },
      ],
      groups: [
        {
          name: "The Thompson 12",
          sessions: [
            {
              id: 12678126,
              name: "The Thompson 12",
              type: "race",
              startTime: "2026-08-22T06:00:00",
              resultStatus: "Provisional",
              eventId: 3670260,
            },
          ],
        },
        {
          name: "The Thompson - Final",
          sessions: [
            {
              id: 12678138,
              name: "The Thompson 12 -Final",
              type: "race",
              startTime: "2026-08-22T06:00:00",
              resultStatus: "Official",
              eventId: 3670260,
              groupName: "The Thompson - Final",
            },
          ],
        },
      ],
    },
  }
}

function champClassification() {
  return {
    type: "Race",
    rows: [
      {
        numberOfLaps: winnerLaps,
        name: "RAMN Racing - Noodles 2001 Mazda Miata (Purple)",
        position: 1,
        status: "Normal",
        startNumber: "591",
        resultClass: "A",
        positionInClass: 1,
        transponder: "15288737",
      },
      {
        numberOfLaps: 439,
        name: "Jacobsen Motorsports 1999 Mazda Miata (White)",
        position: 2,
        status: "Normal",
        startNumber: "930",
        resultClass: "A",
        positionInClass: 2,
        transponder: "100",
      },
      {
        numberOfLaps: 136,
        name: "Miskoe Motorsports 1994 Mazda Miata (YELLOW)",
        position: 19,
        status: "Normal",
        startNumber: "770",
        resultClass: "A",
        positionInClass: 11,
        transponder: "699666",
      },
      {
        numberOfLaps: 399,
        name: "Team Z 1988 Nissan 300zx (White)",
        position: 11,
        status: "Normal",
        startNumber: "260",
        resultClass: "D",
        positionInClass: 1,
        transponder: "260260",
      },
    ],
  }
}

const START_NUMBER_COLUMN = /Start Number/
const ADMIN_REQUIRED = /ADMIN_REQUIRED/
const FORBIDDEN = /FORBIDDEN/

function installFetch() {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/events/3670260")) return jsonResponse(champEvent())
    if (url.includes("/sessions/12678138/classification"))
      return jsonResponse(champClassification())
    return new Response("missing", { status: 404 })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  winnerLaps = 448
})

async function seedTeam(t: ReturnType<typeof convexTest>, ownerId = OWNER) {
  return await t.run(async (ctx) =>
    ctx.db.insert("teams", {
      ownerId,
      name: "Gridlock Racing",
      description: "Endurance team",
      location: "Austin, TX",
      specialties: ["Endurance"],
      availableSeats: 2,
      requirements: [],
      contactInfo: { email: "team@example.com" },
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
}

async function seedMember(
  t: ReturnType<typeof convexTest>,
  teamId: Id<"teams">,
  userId: string,
  role: "manager" | "crew"
) {
  const now = Date.now()
  await t.run(async (ctx) =>
    ctx.db.insert("teamMembers", {
      teamId,
      userId,
      role,
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  )
}

describe("reliability math", () => {
  it("scores a class of one as 1.0 and ignores 0-lap entries", () => {
    const derived = deriveEntries([
      {
        carNumber: "1",
        teamNameRaw: "Solo",
        className: "SD",
        posOverall: 1,
        posInClass: 1,
        laps: 12,
        statusRaw: "Normal",
      },
      {
        carNumber: "220",
        teamNameRaw: "Third Coast Racing",
        className: "C",
        posOverall: 54,
        posInClass: 32,
        laps: 0,
        statusRaw: "Normal",
      },
      {
        carNumber: "12",
        teamNameRaw: "Croc",
        className: "C",
        posOverall: 2,
        posInClass: 1,
        laps: 151,
        statusRaw: "Normal",
      },
    ])
    const solo = derived.find((row) => row.carNumber === "1")
    const zero = derived.find((row) => row.carNumber === "220")
    const winner = derived.find((row) => row.carNumber === "12")
    expect(solo).toMatchObject({
      finishPctile: 1,
      lapsPctClassWinner: 1,
      isStart: true,
      isDnf: false,
    })
    expect(zero).toMatchObject({ isStart: false, isDnf: false, classStarters: 1 })
    expect(winner?.classWinnerLaps).toBe(151)
    expect(winner?.classStarters).toBe(1)
  })

  it("infers a DNF under 70% and keeps a real DNF with class position 0", () => {
    const derived = deriveEntries([
      {
        carNumber: "591",
        teamNameRaw: "RAMN",
        className: "A",
        posOverall: 1,
        posInClass: 1,
        laps: 100,
        statusRaw: "Normal",
      },
      {
        carNumber: "70",
        teamNameRaw: "Even",
        className: "A",
        posOverall: 2,
        posInClass: 2,
        laps: 70,
        statusRaw: "Normal",
      },
      {
        carNumber: "69",
        teamNameRaw: "Short",
        className: "A",
        posOverall: 3,
        posInClass: 3,
        laps: 69,
        statusRaw: "Normal",
      },
      {
        carNumber: "18",
        teamNameRaw: "Kingpin",
        className: "GTO",
        posOverall: 4,
        posInClass: 0,
        laps: 90,
        statusRaw: "DNF",
      },
      {
        carNumber: "120",
        teamNameRaw: "AE Victory",
        className: "GTO",
        posOverall: 1,
        posInClass: 1,
        laps: 100,
        statusRaw: "Normal",
      },
      {
        carNumber: "290",
        teamNameRaw: "Morehead",
        className: "GTO",
        posOverall: 34,
        posInClass: 0,
        laps: 0,
        statusRaw: "DNS",
      },
    ])

    expect(derived.find((row) => row.carNumber === "70")).toMatchObject({
      isDnf: false,
      isStart: true,
    })
    expect(derived.find((row) => row.carNumber === "69")).toMatchObject({
      isDnf: true,
      dnfReason: "laps",
    })
    const realDnf = derived.find((row) => row.carNumber === "18")
    expect(realDnf).toMatchObject({
      isDnf: true,
      dnfReason: "status",
      finishPctile: 0,
      isStart: true,
    })
    expect(derived.find((row) => row.carNumber === "290")).toMatchObject({
      isStart: false,
      isDnf: false,
    })
    expect(derived.find((row) => row.carNumber === "120")?.classStarters).toBe(2)
    expect(topPercentLabel(0.7)).toBe("top 30%")
    expect(topPercentLabel(1)).toBe("top 1%")
  })

  it("parses Speedhive CSV columns plus optional status and class position", () => {
    const rows = parseResultsCsv(
      [
        "Pos,Start Number,Competitor,Class,Total Time,Diff,Laps,Best Lap,Best Lap No.,Best Speed,Status,Class Pos",
        '1,591,"RAMN Racing - Noodles 2001 Mazda Miata (Purple)",A,12:0:56.636,0.000,448,1:21.952,73,74.678 mi/h,Normal,1',
        "2,770,Miskoe Motorsports 1994 Mazda Miata (YELLOW),A,3:39:35.588,312 laps,136,1:24.112,42,72.76 mi/h,,",
        "3,18,Kingpin Racing,GTO,1:00:00,0,7,,, ,DNF,0",
      ].join("\n")
    )
    expect(rows[0]).toMatchObject({
      carNumber: "591",
      teamNameRaw: "RAMN Racing - Noodles",
      vehicleRaw: "2001 Mazda Miata (Purple)",
      laps: 448,
      posInClass: 1,
      statusRaw: "Normal",
    })
    expect(rows[1]?.posInClass).toBe(2)
    expect(rows[2]).toMatchObject({ carNumber: "18", posInClass: 0, statusRaw: "DNF", laps: 7 })
    expect(() => parseResultsCsv("Name,Laps\nA,1")).toThrow(START_NUMBER_COLUMN)
  })

  it("matches number variants and prefers the official copy of a re-scored race", () => {
    expect(carNumbersMatch("08", "8")).toBe(true)
    expect(carNumbersMatch("53x", "53")).toBe(true)
    expect(carNumbersMatch("17", "18")).toBe(false)
    expect(looseNameMatch("Gridlock Racing", "Gridlock Racing - Noodles")).toBe(true)
    expect(looseNameMatch("Gridlock Racing", "AE Victory Racing")).toBe(false)
    expect(splitCompetitorName("ColeFab 462").vehicle).toBeUndefined()

    const sessions = selectRaceSessions(champEvent().sessions)
    expect(sessions.map((session) => session.id)).toEqual(["12678138"])
    expect(sessions[0]?.resultStatus).toBe("official")
  })
})

describe("speedhive import", () => {
  it("imports a race once and updates it on a second import", async () => {
    installFetch()
    const t = convexTest(schema, modules)
    const asAdmin = t.withIdentity(adminIdentity())
    const seriesId = await asAdmin.mutation(api.raceSeries.create, { name: "ChampCar" })

    const preview = await asAdmin.action(api.speedhive.listEventSessions, { eventId: "3670260" })
    expect(preview.sessions.map((session) => session.id)).toEqual(["12678138"])
    expect(preview.trackName).toBe("Thompson Speedway")

    const first = await asAdmin.action(api.speedhive.importSession, {
      eventId: "3670260",
      sessionId: "12678138",
      seriesId,
    })
    expect(first.entryCount).toBe(4)

    winnerLaps = 400
    const second = await asAdmin.action(api.speedhive.importSession, {
      eventId: "3670260",
      sessionId: "12678138",
      seriesId,
    })
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.entryCount).toBe(4)

    const stored = await t.run(async (ctx) => {
      const sessions = await ctx.db.query("timingSessions").collect()
      const entries = await ctx.db.query("sessionEntries").collect()
      return { sessions, entries }
    })
    expect(stored.sessions).toHaveLength(1)
    expect(stored.sessions[0]).toMatchObject({
      source: "speedhive",
      resultStatus: "official",
      externalSessionId: "12678138",
      sourceUrl: "https://speedhive.mylaps.com/sessions/12678138",
      trackName: "Thompson Speedway",
    })
    const winner = stored.entries.find((entry) => entry.carNumber === "591")
    const short = stored.entries.find((entry) => entry.carNumber === "770")
    const classOfOne = stored.entries.find((entry) => entry.carNumber === "260")
    expect(winner).toMatchObject({ laps: 400, isDnf: false, teamNameRaw: "RAMN Racing - Noodles" })
    expect(short).toMatchObject({ isDnf: true, dnfReason: "laps", finishPctile: 0 })
    expect(classOfOne).toMatchObject({ finishPctile: 1, classStarters: 1, isDnf: false })
  })

  it("rejects a non-admin import", async () => {
    installFetch()
    const t = convexTest(schema, modules)
    const asOwner = t.withIdentity({ subject: OWNER })
    const teamId = await seedTeam(t)
    const seriesId = await asOwner.mutation(api.raceSeries.create, {
      name: "ChampCar",
      teamId,
    })
    await expect(
      asOwner.action(api.speedhive.importSession, {
        eventId: "3670260",
        sessionId: "12678138",
        seriesId,
      })
    ).rejects.toThrow(ADMIN_REQUIRED)
  })
})

const CSV_HEADER = "Pos,Start Number,Competitor,Class,Laps,Status,Class Pos"

function csvRow(pos: number, number: string, name: string, laps: number) {
  return `${pos},${number},${name},A,${laps},Normal,${pos}`
}

describe("claims, auth, and the public toggle", () => {
  it("auto-verifies a linked seat car and matches number variants", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const asOwner = t.withIdentity({ subject: OWNER })
    const seriesId = await asOwner.mutation(api.raceSeries.create, { name: "WRL", teamId })
    const eventId = await asOwner.mutation(api.raceEvents.create, {
      seriesId,
      teamId,
      name: "Watkins Glen",
      startDate: "2026-08-29",
      endDate: "2026-08-30",
      trackName: "Watkins Glen",
    })
    await t.run(async (ctx) =>
      ctx.db.insert("teamCars", {
        teamId,
        raceEventId: eventId,
        hostUserId: OWNER,
        carNumber: "53x",
        make: "Porsche",
        model: "Cayman",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )

    const asAdmin = t.withIdentity(adminIdentity())
    await asAdmin.mutation(api.timingResults.importCsv, {
      seriesId,
      eventName: "Watkins Glen",
      sessionName: "Saturday - 8 Hour",
      trackName: "Watkins Glen",
      date: "2026-08-29",
      resultStatus: "official",
      sourceUrl: "https://example.com/wrl",
      raceEventId: eventId,
      csvText: [
        CSV_HEADER,
        csvRow(1, "53", "Gridlock Racing", 219),
        csvRow(2, "08", "Other Team", 200),
      ].join("\n"),
    })

    const linkIds = await asOwner.mutation(api.teamResultLinks.claim, {
      teamId,
      seriesId,
      carNumbers: ["53"],
      nameAliases: ["Gridlock"],
    })
    const link = await t.run(async (ctx) => ctx.db.get(linkIds[0] as Id<"teamResultLinks">))
    expect(link?.status).toBe("verified")
    const linked = await t.run(async (ctx) =>
      ctx.db
        .query("sessionEntries")
        .collect()
        .then((entries) => entries.find((entry) => entry.carNumber === "53"))
    )
    expect(linked?.teamId).toBe(teamId)

    const eight = await asOwner.mutation(api.teamResultLinks.claim, {
      teamId,
      seriesId,
      carNumbers: ["8"],
    })
    const pending = await t.run(async (ctx) => ctx.db.get(eight[0] as Id<"teamResultLinks">))
    expect(pending?.status).toBe("pending")
    const manage = await asOwner.query(api.teamResultLinks.listForTeam, { teamId })
    const eightGroup = manage?.suggestions.find((group) => group.carNumber === "8")
    expect(
      eightGroup?.matches.some((match) => match.carNumber === "08" && match.reason === "car")
    ).toBe(true)
  })

  it("blocks non-managers from claiming and non-admins from approving", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    await seedMember(t, teamId, MANAGER, "manager")
    await seedMember(t, teamId, CREW, "crew")
    const asOwner = t.withIdentity({ subject: OWNER })
    const seriesId = await asOwner.mutation(api.raceSeries.create, { name: "Lucky Dog", teamId })

    await expect(
      t.withIdentity({ subject: STRANGER }).mutation(api.teamResultLinks.claim, {
        teamId,
        seriesId,
        carNumbers: ["17"],
      })
    ).rejects.toThrow(FORBIDDEN)
    await expect(
      t.withIdentity({ subject: CREW }).mutation(api.teamResultLinks.claim, {
        teamId,
        seriesId,
        carNumbers: ["17"],
      })
    ).rejects.toThrow(FORBIDDEN)

    const linkIds = await t.withIdentity({ subject: MANAGER }).mutation(api.teamResultLinks.claim, {
      teamId,
      seriesId,
      carNumbers: ["17"],
    })
    await expect(
      t.withIdentity({ subject: MANAGER }).mutation(api.teamResultLinks.review, {
        linkId: linkIds[0] as Id<"teamResultLinks">,
        decision: "verified",
      })
    ).rejects.toThrow(ADMIN_REQUIRED)
  })

  it("hides stats below 3 starts and when the series is not public", async () => {
    const t = convexTest(schema, modules)
    const teamId = await seedTeam(t)
    const asOwner = t.withIdentity({ subject: OWNER })
    const asAdmin = t.withIdentity(adminIdentity())
    const seriesId = await asAdmin.mutation(api.raceSeries.create, { name: "ChampCar" })

    const importOne = (date: string, name: string) =>
      asAdmin.mutation(api.timingResults.importCsv, {
        seriesId,
        eventName: name,
        sessionName: "Race",
        trackName: "Thompson",
        date,
        resultStatus: "official",
        sourceUrl: "https://example.com/results",
        csvText: [CSV_HEADER, csvRow(1, "17", "Gridlock Racing", 100)].join("\n"),
      })

    await importOne("2026-06-01", "Race 1")
    await importOne("2026-07-01", "Race 2")
    const linkIds = await asOwner.mutation(api.teamResultLinks.claim, {
      teamId,
      seriesId,
      carNumbers: ["17"],
    })
    await asAdmin.mutation(api.teamResultLinks.review, {
      linkId: linkIds[0] as Id<"teamResultLinks">,
      decision: "verified",
    })

    expect(await t.query(api.reliability.getForTeam, { teamId })).toEqual([])

    await importOne("2026-08-01", "Race 3")
    const visible = await t.query(api.reliability.getForTeam, { teamId })
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({
      seriesName: "ChampCar",
      className: "A",
      starts: 3,
      dnfs: 0,
      avgLapsPct: 1,
      avgFinishPctile: 1,
      typicalFinishLabel: "top 1%",
    })
    expect(visible[0]?.last5.starts).toBe(3)

    await asAdmin.mutation(api.timingResults.setSeriesResultsSettings, {
      seriesId,
      showPublicResults: false,
    })
    expect(await t.query(api.reliability.getForTeam, { teamId })).toEqual([])
    const adminView = await asAdmin.query(api.reliability.getForTeam, {
      teamId,
      audience: "admin",
    })
    expect(adminView).toHaveLength(1)
    expect(adminView[0]?.showPublicResults).toBe(false)
  })
})

describe("classification adapter", () => {
  it("keeps transponders and real statuses from a trimmed WRL classification", () => {
    const entries = classificationToEntries({
      rows: [
        {
          numberOfLaps: 220,
          name: "AE Victory Racing",
          position: 1,
          status: "Normal",
          startNumber: "120",
          resultClass: "GTO",
          positionInClass: 1,
          transponder: 10092195,
        },
        {
          numberOfLaps: 7,
          name: "Kingpin Racing",
          position: 32,
          status: "DNF",
          startNumber: "18",
          resultClass: "GTO",
          positionInClass: 0,
          transponder: "18",
        },
      ],
    })
    const derived = deriveEntries(entries)
    expect(derived[0]?.transponder).toBe("10092195")
    expect(derived[1]).toMatchObject({
      isDnf: true,
      dnfReason: "status",
      posInClass: 0,
      finishPctile: 0,
    })
  })
})
