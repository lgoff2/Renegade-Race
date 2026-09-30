/**
 * Pure race-result parsing and reliability math.
 *
 * A start is an entry with at least 1 lap that is not DNS.
 * Finish percentile (higher is better) is (N - classPos) / (N - 1) among
 * class starters. A class of one is 1.0. Class position 0 is last place.
 * Laps % of the class winner is laps / max laps among class starters.
 *
 * DNF uses a real source status (DNF/DSQ/NC) when the feed has one.
 * Otherwise a start under DEFAULT_DNF_LAP_FRACTION of the class winner's
 * laps is a DNF. Series may override that fraction.
 */

export const DEFAULT_DNF_LAP_FRACTION = 0.7
export const MIN_PUBLIC_STARTS = 3
export const ROLLING_STARTS = 5
export const SPEEDHIVE_HOME_URL = "https://speedhive.mylaps.com"

export type NormalizedEntry = {
  carNumber: string
  teamNameRaw: string
  vehicleRaw?: string
  className: string
  posOverall: number
  posInClass: number
  laps: number
  statusRaw: string
  transponder?: string
}

export type DerivedEntry = NormalizedEntry & {
  classStarters: number
  classWinnerLaps: number
  finishPctile: number
  lapsPctClassWinner: number
  isStart: boolean
  isDnf: boolean
  dnfReason?: "status" | "laps"
}

export type LinkMatchFields = {
  teamId: string
  carNumber: string
  nameAliases: string[]
  transponders: string[]
  confirmedEntryIds?: string[]
  rejectedEntryIds?: string[]
}

export type MatchableEntry = {
  _id?: string
  carNumber: string
  teamNameRaw: string
  transponder?: string
}

const NON_ALNUM = /[^a-z0-9]/g
const LEADING_ZEROS = /^0+/
const TRAILING_LETTERS = /[a-z]+$/
const COMPETITOR_YEAR = /^(.*?)(?:\s+|-)((?:19|20)\d{2}\s+.+)$/
const TRAILING_SEPARATOR = /[\s-]+$/
const TOKEN_SPLIT = /[^a-z0-9]+/g
const BOM = /^\uFEFF/
const RACE_NAME_NOISE = /\b(final|official|provisional|ec|rescored|re-scored)\b/g
const MULTI_SPACE = /\s+/g
const CLASS_PREFIX = /^class\s+/

const NAME_STOPWORDS = new Set(["racing", "motorsports", "motorsport", "team", "the", "and"])

export function clampDnfFraction(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 1) {
    return DEFAULT_DNF_LAP_FRACTION
  }
  return value
}

export function speedhiveSessionUrl(sessionId: string): string {
  return `${SPEEDHIVE_HOME_URL}/sessions/${sessionId}`
}

/** "08" and "8" match. "53x" and "53" match. */
export function carNumberKey(raw: string): string {
  const stripped = raw
    .trim()
    .toLowerCase()
    .replace(NON_ALNUM, "")
    .replace(LEADING_ZEROS, "")
    .replace(TRAILING_LETTERS, "")
  return stripped || "0"
}

export function carNumbersMatch(a: string, b: string): boolean {
  return carNumberKey(a) === carNumberKey(b) && carNumberKey(a) !== "0"
}

export function isDnsStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === "dns" || normalized === "did not start" || normalized === "not started"
}

export function isRealDnfStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  if (
    !normalized ||
    normalized === "normal" ||
    normalized === "finished" ||
    normalized === "classified" ||
    normalized === "running"
  ) {
    return false
  }
  return (
    normalized === "dnf" ||
    normalized === "dsq" ||
    normalized === "dq" ||
    normalized === "nc" ||
    normalized.includes("did not finish") ||
    normalized.includes("disqual") ||
    normalized.includes("not classified")
  )
}

export function isStartEntry(laps: number, statusRaw: string): boolean {
  return laps >= 1 && !isDnsStatus(statusRaw)
}

export function splitCompetitorName(name: string): { teamName: string; vehicle?: string } {
  const trimmed = name.trim()
  const yearMatch = trimmed.match(COMPETITOR_YEAR)
  if (yearMatch?.[1] && yearMatch[2]) {
    const teamName = yearMatch[1].replace(TRAILING_SEPARATOR, "").trim()
    if (teamName) {
      return { teamName, vehicle: yearMatch[2].trim() }
    }
  }
  return { teamName: trimmed }
}

function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(TOKEN_SPLIT, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !NAME_STOPWORDS.has(token))
}

/** Loose team-name match that ignores generic words like "racing". */
export function looseNameMatch(a: string, b: string): boolean {
  const left = significantTokens(a)
  const right = significantTokens(b)
  if (left.length === 0 || right.length === 0) return false
  const rightSet = new Set(right)
  const shared = left.filter((token) => rightSet.has(token))
  if (shared.length === 0) return false
  const smaller = Math.min(left.length, right.length)
  return shared.length === smaller || shared.length / smaller >= 0.5
}

export function deriveEntries(
  rows: NormalizedEntry[],
  dnfFraction: number = DEFAULT_DNF_LAP_FRACTION
): DerivedEntry[] {
  const fraction = clampDnfFraction(dnfFraction)
  const starterIndexes = new Map<string, number[]>()
  const started = rows.map((row) => isStartEntry(row.laps, row.statusRaw))
  for (let index = 0; index < rows.length; index++) {
    if (!started[index]) continue
    const row = rows[index]
    if (!row) continue
    const indexes = starterIndexes.get(row.className) ?? []
    indexes.push(index)
    starterIndexes.set(row.className, indexes)
  }

  const classMeta = new Map<string, { starters: number; winnerLaps: number }>()
  for (const [className, indexes] of starterIndexes) {
    let winnerLaps = 0
    for (const index of indexes) {
      const laps = rows[index]?.laps ?? 0
      if (laps > winnerLaps) winnerLaps = laps
    }
    classMeta.set(className, { starters: indexes.length, winnerLaps })
  }

  return rows.map((row, index) => {
    const meta = classMeta.get(row.className) ?? { starters: 0, winnerLaps: 0 }
    const isStart = started[index] ?? false
    const lapsPctClassWinner = meta.winnerLaps > 0 ? row.laps / meta.winnerLaps : 0
    let finishPctile = 0
    if (isStart) {
      if (meta.starters <= 1) {
        finishPctile = 1
      } else {
        const pos =
          row.posInClass >= 1 && row.posInClass <= meta.starters ? row.posInClass : meta.starters
        finishPctile = (meta.starters - pos) / (meta.starters - 1)
      }
    }

    let isDnf = false
    let dnfReason: DerivedEntry["dnfReason"]
    if (isStart && isRealDnfStatus(row.statusRaw)) {
      isDnf = true
      dnfReason = "status"
    } else if (isStart && meta.winnerLaps > 0 && lapsPctClassWinner < fraction) {
      isDnf = true
      dnfReason = "laps"
    }

    return {
      ...row,
      classStarters: meta.starters,
      classWinnerLaps: meta.winnerLaps,
      finishPctile,
      lapsPctClassWinner,
      isStart,
      isDnf,
      dnfReason,
    }
  })
}

export function linkMatchesEntry(
  entry: MatchableEntry,
  link: LinkMatchFields,
  teamName: string
): boolean {
  const entryId = entry._id
  if (entryId && link.rejectedEntryIds?.includes(entryId)) return false
  if (entryId && link.confirmedEntryIds?.includes(entryId)) return true
  if (entry.transponder && link.transponders.includes(entry.transponder)) return true
  if (!carNumbersMatch(entry.carNumber, link.carNumber)) return false
  if (link.nameAliases.length === 0) return true
  return [teamName, ...link.nameAliases].some((alias) => looseNameMatch(alias, entry.teamNameRaw))
}

export type SuggestionReason = "transponder" | "car" | "name"

export function suggestionReason(
  entry: MatchableEntry,
  link: LinkMatchFields,
  teamName: string
): SuggestionReason | null {
  if (entry._id && link.rejectedEntryIds?.includes(entry._id)) return null
  if (entry.transponder && link.transponders.includes(entry.transponder)) return "transponder"
  if (carNumbersMatch(entry.carNumber, link.carNumber)) return "car"
  const names = [teamName, ...link.nameAliases]
  if (names.some((alias) => looseNameMatch(alias, entry.teamNameRaw))) return "name"
  return null
}

type CsvColumn = "pos" | "number" | "competitor" | "class" | "laps" | "status" | "classPos"

const CSV_HEADERS: Record<string, CsvColumn> = {
  pos: "pos",
  "start number": "number",
  competitor: "competitor",
  class: "class",
  laps: "laps",
  status: "status",
  "class pos": "classPos",
  "class position": "classPos",
  positioninclass: "classPos",
}

export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  const source = text.replace(BOM, "")

  const pushRow = () => {
    row.push(field)
    field = ""
    if (row.some((value) => value.trim() !== "")) rows.push(row)
    row = []
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char ?? ""
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1
      pushRow()
    } else {
      field += char ?? ""
    }
  }
  if (field.length > 0 || row.length > 0) pushRow()
  return rows
}

function headerIndex(headers: string[]): Map<CsvColumn, number> {
  const map = new Map<CsvColumn, number>()
  headers.forEach((header, index) => {
    const key = header.trim().toLowerCase()
    const column = CSV_HEADERS[key]
    if (column && !map.has(column)) map.set(column, index)
  })
  return map
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return ""
  return (row[index] ?? "").trim()
}

export function parseResultsCsv(text: string): NormalizedEntry[] {
  const table = parseCsvTable(text)
  const header = table[0]
  if (!header) return []
  const columns = headerIndex(header)
  if (!(columns.has("number") && columns.has("competitor") && columns.has("class"))) {
    throw new Error("INVALID_INPUT: CSV must include Start Number, Competitor, and Class columns")
  }

  const parsed: NormalizedEntry[] = []
  for (const row of table.slice(1)) {
    const carNumber = cell(row, columns.get("number"))
    const competitor = cell(row, columns.get("competitor"))
    const className = cell(row, columns.get("class"))
    if (!(carNumber && competitor && className)) continue
    const lapsValue = Number.parseInt(cell(row, columns.get("laps")), 10)
    const posValue = Number.parseInt(cell(row, columns.get("pos")), 10)
    const classPosRaw = columns.has("classPos") ? cell(row, columns.get("classPos")) : ""
    const classPosValue = classPosRaw === "" ? Number.NaN : Number.parseInt(classPosRaw, 10)
    const { teamName, vehicle } = splitCompetitorName(competitor)
    parsed.push({
      carNumber,
      teamNameRaw: teamName,
      vehicleRaw: vehicle,
      className,
      posOverall: Number.isFinite(posValue) ? posValue : parsed.length + 1,
      posInClass: Number.isFinite(classPosValue) ? classPosValue : -1,
      laps: Number.isFinite(lapsValue) ? Math.max(0, lapsValue) : 0,
      statusRaw: cell(row, columns.get("status")),
      transponder: undefined,
    })
  }

  const used = new Map<string, Set<number>>()
  for (const entry of parsed) {
    if (entry.posInClass < 0) continue
    const taken = used.get(entry.className) ?? new Set<number>()
    taken.add(entry.posInClass)
    used.set(entry.className, taken)
  }
  return parsed.map((entry) => {
    if (entry.posInClass >= 0) return entry
    const taken = used.get(entry.className) ?? new Set<number>()
    let next = 1
    while (taken.has(next)) next += 1
    taken.add(next)
    used.set(entry.className, taken)
    return { ...entry, posInClass: next }
  })
}

type ClassificationRow = {
  numberOfLaps?: number
  name?: string
  position?: number
  status?: string
  startNumber?: string
  resultClass?: string
  positionInClass?: number
  transponder?: string | number
}

export function classificationToEntries(payload: {
  rows?: ClassificationRow[]
}): NormalizedEntry[] {
  const rows = payload.rows ?? []
  return rows.flatMap((row, index) => {
    const carNumber = String(row.startNumber ?? "").trim()
    const name = String(row.name ?? "").trim()
    const className = String(row.resultClass ?? "").trim()
    if (!(carNumber && name && className)) return []
    const { teamName, vehicle } = splitCompetitorName(name)
    const laps = Number.isFinite(row.numberOfLaps) ? Math.max(0, row.numberOfLaps ?? 0) : 0
    const transponder =
      row.transponder === undefined || row.transponder === null || row.transponder === ""
        ? undefined
        : String(row.transponder)
    return [
      {
        carNumber,
        teamNameRaw: teamName,
        vehicleRaw: vehicle,
        className,
        posOverall: row.position && row.position > 0 ? row.position : index + 1,
        posInClass: row.positionInClass ?? 0,
        laps,
        statusRaw: row.status?.trim() || "Normal",
        transponder,
      },
    ]
  })
}

export type SpeedhiveSessionNode = {
  id: number
  name?: string
  type?: string
  startTime?: string
  resultStatus?: string
  groupName?: string
  eventId?: number
}

export type SpeedhiveGroupNode = {
  name?: string
  sessions?: SpeedhiveSessionNode[]
  subGroups?: SpeedhiveGroupNode[]
  groups?: SpeedhiveGroupNode[]
}

export type ListedRaceSession = {
  id: string
  name: string
  type: string
  startTime: string
  resultStatus: "official" | "provisional"
  groupName?: string
}

export function flattenSpeedhiveSessions(node: {
  sessions?: SpeedhiveSessionNode[]
  groups?: SpeedhiveGroupNode[]
  subGroups?: SpeedhiveGroupNode[]
}): SpeedhiveSessionNode[] {
  const into: SpeedhiveSessionNode[] = []
  const walk = (current: {
    sessions?: SpeedhiveSessionNode[]
    groups?: SpeedhiveGroupNode[]
    subGroups?: SpeedhiveGroupNode[]
  }) => {
    if (current.sessions) into.push(...current.sessions)
    for (const group of [...(current.groups ?? []), ...(current.subGroups ?? [])]) walk(group)
  }
  walk(node)
  return into
}

export function isRaceSessionType(type: string | undefined): boolean {
  const normalized = (type ?? "").trim().toLowerCase()
  return normalized === "race" || normalized === "racemerge"
}

export function normalizeResultStatus(raw: string | undefined): "official" | "provisional" {
  return raw?.trim().toLowerCase() === "official" ? "official" : "provisional"
}

function raceIdentity(session: SpeedhiveSessionNode): string {
  const day = (session.startTime ?? "").slice(0, 10)
  const name = (session.name ?? "")
    .toLowerCase()
    .replace(RACE_NAME_NOISE, " ")
    .replace(TOKEN_SPLIT, " ")
    .replace(MULTI_SPACE, " ")
    .trim()
  return `${day}|${name}`
}

/**
 * Race sessions only. When a race was re-scored (Final / EC), keep the
 * Official copy and drop the Provisional duplicate.
 */
export function selectRaceSessions(eventSessions: {
  sessions?: SpeedhiveSessionNode[]
  groups?: SpeedhiveGroupNode[]
}): ListedRaceSession[] {
  const races = flattenSpeedhiveSessions(eventSessions).filter(
    (session) => isRaceSessionType(session.type) && session.id
  )
  const grouped = new Map<string, SpeedhiveSessionNode[]>()
  for (const session of races) {
    const key = raceIdentity(session)
    const list = grouped.get(key) ?? []
    list.push(session)
    grouped.set(key, list)
  }

  const picked: SpeedhiveSessionNode[] = []
  for (const group of grouped.values()) {
    const official = group.filter(
      (session) => normalizeResultStatus(session.resultStatus) === "official"
    )
    const pool = official.length > 0 ? official : group
    pool.sort((a, b) => b.id - a.id)
    const chosen = pool[0]
    if (chosen) picked.push(chosen)
  }

  picked.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.id - b.id)
  return picked.map((session) => ({
    id: String(session.id),
    name: session.name?.trim() || "Race",
    type: session.type ?? "race",
    startTime: session.startTime ?? "",
    resultStatus: normalizeResultStatus(session.resultStatus),
    groupName: session.groupName,
  }))
}

export type StartSnapshot = {
  date: string
  finishPctile: number
  lapsPctClassWinner: number
  isDnf: boolean
}

export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function summarizeStarts(starts: StartSnapshot[]) {
  const recent = starts.slice(0, ROLLING_STARTS)
  const pack = (rows: StartSnapshot[]) => ({
    starts: rows.length,
    dnfs: rows.filter((row) => row.isDnf).length,
    avgFinishPctile: average(rows.map((row) => row.finishPctile)),
    avgLapsPct: average(rows.map((row) => row.lapsPctClassWinner)),
  })
  return { allTime: pack(starts), last5: pack(recent) }
}

/** "top 30%" means the car beat about 70% of class starters. */
export function topPercentLabel(finishPctile: number): string {
  const top = Math.round((1 - finishPctile) * 100)
  if (top <= 0) return "top 1%"
  return `top ${top}%`
}

export function classesMatch(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(CLASS_PREFIX, "")
  return normalize(a) === normalize(b)
}
