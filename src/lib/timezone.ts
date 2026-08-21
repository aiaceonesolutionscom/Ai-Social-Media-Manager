import { getUserPreferences } from '../store.js'

// ---- Timezone helpers -------------------------------------------------------
// No external dependency: offset/wall-clock math uses Intl, which Node provides.
// The default timezone is UTC to keep backward compatibility with existing rows
// and clients that never configured a timezone.

export function isValidTimezone(tz: string | undefined): tz is string {
  if (!tz || typeof tz !== 'string' || !tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export async function resolveUserTimezone(phone: string): Promise<string> {
  try {
    const prefs = await getUserPreferences(phone)
    if (isValidTimezone(prefs?.timezone)) return prefs!.timezone!
  } catch {
    // fall through to UTC
  }
  return 'UTC'
}

// UTC offset (in minutes) of `tz` at the instant `utcMs`.
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, (+parts.hour) % 24, +parts.minute, +parts.second)
  return Math.round((asUTC - utcMs) / 60000)
}

// Convert a naive local wall-clock timestamp (no timezone marker) expressed in
// `tz` to the equivalent UTC epoch millis. Two offset passes converge even
// across DST boundaries (±1h shift).
export function naiveToUTC(isoNaive: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(isoNaive)
  if (!m) return NaN
  const y = +m[1]
  const mo = +m[2]
  const d = +m[3]
  const h = +(m[4] ?? 0)
  const mi = +(m[5] ?? 0)
  const s = +(m[6] ?? 0)
  const base = Date.UTC(y, mo - 1, d, h, mi, s)
  let offset = tzOffsetMinutes(tz, base)
  let adjusted = base - offset * 60000
  offset = tzOffsetMinutes(tz, adjusted)
  adjusted = base - offset * 60000
  return adjusted
}

// Format an absolute ISO timestamp as a human-readable wall-clock string in
// `tz` (e.g. "Aug 21, 2026, 5:00 PM (Asia/Karachi, UTC+05:00)"). Falls back to
// the raw string if the value is not a valid date. Used for schedule
// confirmations so the user sees the time in THEIR timezone, never the server's.
export function formatInZone(iso: string, tz: string, withOffset = true): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  const main = dtf.format(d)
  if (!withOffset) return main
  const offset = tzOffsetMinutes(tz, d.getTime())
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
  return `${main} (${tz}, UTC${off})`
}

// Human-readable "now" in `tz`, e.g. "2026-08-20 17:33:05 (Asia/Karachi, UTC+05:00)".
export function nowInZone(tz: string, now: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(now)) parts[p.type] = p.value
  const offset = tzOffsetMinutes(tz, now.getTime())
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
  return `${parts.year}-${parts.month}-${parts.day} ${String((+parts.hour) % 24).padStart(2, '0')}:${parts.minute}:${parts.second} (${tz}, UTC${off})`
}