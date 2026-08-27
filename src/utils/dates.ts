const OPTIONAL_TIME_RE = '(?:(?:T|\\s)\\d{1,2}:\\d{2}(?::\\d{2})?)?'
const DATE_RE = new RegExp(`^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2}|\\d{4})${OPTIONAL_TIME_RE}$`)
const YMD_RE = new RegExp(`^(\\d{4})[/-](\\d{1,2})[/-](\\d{1,2})${OPTIONAL_TIME_RE}$`)
const TIME_RE = /(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/

interface DateParseOptions {
  date1904?: boolean
}

export function parseDateValue(value: unknown, options: DateParseOptions = {}): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return parseExcelSerialDate(value, options.date1904)
  }

  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null

  const isoLike = YMD_RE.exec(trimmed)
  if (isoLike) {
    return toIso(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]))
  }

  const match = DATE_RE.exec(trimmed)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = normalizeYear(Number(match[3]))
  return toIso(year, month, day)
}

export function parseDdMmYyyy(value: unknown): string | null {
  return parseDateValue(value)
}

export function parseTimestampValue(
  value: unknown,
  timeValue?: unknown,
  options: DateParseOptions = {},
): string | null {
  const dateIso = parseDateValue(value, options)
  if (!dateIso) return null

  let time = extractTime(value)
  if (!time && timeValue !== undefined) time = normalizeTimeValue(timeValue)
  return time && time !== '00:00:00' ? `${dateIso}T${time}` : dateIso
}

function extractTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatTime(value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds())
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = value - Math.floor(value)
    if (fraction > 0) return secondsToTime(Math.round(fraction * 86400) % 86400)
  }
  const match = TIME_RE.exec(String(value ?? '').trim())
  return match ? formatTime(Number(match[1]), Number(match[2]), Number(match[3] ?? 0)) : null
}

function normalizeTimeValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatTime(value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds())
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    return secondsToTime(Math.round(value * 86400) % 86400)
  }
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim())
  return match ? formatTime(Number(match[1]), Number(match[2]), Number(match[3] ?? 0)) : null
}

function formatTime(hour: number, minute: number, second: number) {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

function secondsToTime(totalSeconds: number) {
  const hour = Math.floor(totalSeconds / 3600)
  const minute = Math.floor((totalSeconds % 3600) / 60)
  const second = totalSeconds % 60
  return formatTime(hour, minute, second)
}

export function normalizeDateDisplay(value: unknown) {
  const iso = parseDateValue(value)
  return iso ? formatIsoToDdMmYyyy(iso) : String(value ?? '').trim()
}

function normalizeYear(year: number) {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year
  return year
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function parseExcelSerialDate(value: number, date1904 = false) {
  if (value < 0 || value > 100000) return null
  const serial1900 = value + (date1904 ? 1462 : 0)
  const utcDays = Math.floor(serial1900 - 25569)
  const date = new Date(utcDays * 86400 * 1000)
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function isoToExcelSerial(iso: string, date1904 = false) {
  const parsed = parseDateValue(iso)
  if (!parsed) return null
  const [year, month, day] = parsed.split('-').map(Number)
  const serial1900 = Date.UTC(year, month - 1, day) / 86400000 + 25569
  const time = extractTime(iso)
  const timeFraction = time
    ? time.split(':').map(Number).reduce((seconds, value, index) =>
        seconds + value * [3600, 60, 1][index], 0) / 86400
    : 0
  return serial1900 + timeFraction - (date1904 ? 1462 : 0)
}

export function formatIsoToDdMmYyyy(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-')
  if (!year || !month || !day) return iso
  return `${day}/${month}/${year}`
}

export function formatIsoToDdMmYy(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-')
  if (!year || !month || !day) return iso
  return `${day}-${month}-${year.slice(-2)}`
}

export function formatTimestampLabel(iso: string) {
  const date = formatIsoToDdMmYyyy(iso)
  return iso.includes('T') ? `${date} ${iso.slice(11, 16)}` : date
}

export function compareDateText(a: string, b: string) {
  const aIso = parseTimestampValue(a)
  const bIso = parseTimestampValue(b)
  if (aIso && bIso) return aIso.localeCompare(bIso)
  if (aIso) return -1
  if (bIso) return 1
  return a.localeCompare(b)
}

export function isInRange(iso: string, range: string, maxIso: string) {
  if (range === 'ALL') return true
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const maxDate = new Date(`${maxIso.slice(0, 10)}T00:00:00Z`)
  const start = new Date(maxDate)

  if (range === 'YTD') {
    start.setUTCMonth(0, 1)
  } else if (range.endsWith('Y')) {
    start.setUTCFullYear(start.getUTCFullYear() - Number(range.replace('Y', '')))
  } else if (range.endsWith('M')) {
    start.setUTCMonth(start.getUTCMonth() - Number(range.replace('M', '')))
  }

  return date >= start && date <= maxDate
}
