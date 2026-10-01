export const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata'

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export type Week = { index: number; start: string; end: string; days: number }

const pad = (n: number) => String(n).padStart(2, '0')

export function today() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date())
}

export function currentMonth() {
  return today().slice(0, 7)
}

export function parseMonth(value: string | undefined) {
  return value && MONTH_RE.test(value) ? value : currentMonth()
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

// Weeks run Monday–Sunday, clipped to the month's first and last day.
export function monthWeeks(month: string): Week[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const weeks: Week[] = []
  let start = 1
  for (let d = 1; d <= last; d++) {
    const isSunday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0
    if (isSunday || d === last) {
      weeks.push({
        index: weeks.length,
        start: `${month}-${pad(start)}`,
        end: `${month}-${pad(d)}`,
        days: d - start + 1,
      })
      start = d + 1
    }
  }
  return weeks
}

// Splits a monthly amount across weeks in proportion to their days, in whole units.
export function splitBudget(amount: number, weeks: Week[]) {
  const totalDays = weeks.reduce((s, w) => s + w.days, 0)
  const parts = weeks.map((w) => Math.floor((amount * w.days) / totalDays))
  parts[parts.length - 1] += Math.round(amount - parts.reduce((s, p) => s + p, 0))
  return parts
}

export function weekRangeLabel(w: Week) {
  const s = Number(w.start.slice(8))
  const e = Number(w.end.slice(8))
  return s === e ? `${s}` : `${s}–${e}`
}
