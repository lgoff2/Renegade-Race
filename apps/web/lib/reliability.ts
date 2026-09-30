export function formatLapsPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function dnfCountLabel(dnfs: number): string {
  return dnfs === 1 ? "1 DNF" : `${dnfs} DNFs`
}

export function reliabilitySummaryLine(stat: {
  seriesName: string
  className: string
  starts: number
  dnfs: number
  avgLapsPct: number
  typicalFinishLabel: string
}): string {
  return `${stat.seriesName} Class ${stat.className}: ${stat.starts} starts, ${formatLapsPct(stat.avgLapsPct)} of winner laps, ${dnfCountLabel(stat.dnfs)}, ${stat.typicalFinishLabel}`
}

const CLASS_PREFIX = /^class\s+/

export function classesMatch(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(CLASS_PREFIX, "")
  return normalize(a) === normalize(b)
}

export function formatResultDate(iso: string): string {
  const [year, month, day] = iso.split("-").map((part) => Number(part))
  if (!(year && month && day)) return iso
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function classPositionLabel(posInClass: number, classStarters: number): string {
  if (posInClass > 0) return `P${posInClass} of ${classStarters}`
  return `— of ${classStarters}`
}

export function dnfBadgeLabel(reason: "status" | "laps" | undefined, fraction: number): string {
  if (reason === "laps") {
    return `Did not complete ${Math.round(fraction * 100)}% of the distance`
  }
  return "DNF"
}
