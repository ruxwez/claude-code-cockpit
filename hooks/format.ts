export type Tone = 'green' | 'yellow' | 'red'

export function toneFor(percent: number): Tone {
  return percent < 50 ? 'green' : percent < 80 ? 'yellow' : 'red'
}

export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, percent))
}

/** `██████░░░░` with `cells` cells. */
export function bar(percent: number, cells: number): string {
  const filled = Math.round((clampPercent(percent) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, cells - filled))
}

/** Bar scaled to a max value (for proportional bars). */
export function ratioBar(value: number, max: number, cells: number): string {
  return bar(max > 0 ? (value / max) * 100 : 0, cells)
}

/** `$0.0123` under $1, `$1.23` otherwise, `?` when unknown. */
export function money(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '?'
  return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '')
}

/** `850`, `1.2k`, `3.4M`. */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return `${trim1(n / 1e3)}k`
  return `${trim1(n / 1e6)}M`
}

/** `1h 05m`, `4m 03s`, `12s`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

const FAMILY: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/** `claude-opus-5-5` -> `Opus 5.5`; `opus` -> `Opus`; unparseable ids come back as given. */
export function modelName(model: string | null | undefined): string {
  if (!model) return '—'
  const id = model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/^(us|eu|apac|global)\./, '')
    .replace(/^anthropic\./, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/-\d{8}$/, '')
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id)
  if (m) {
    const family = FAMILY[m[1] ?? ''] ?? cap(m[1] ?? '')
    return m[3] === undefined ? `${family} ${m[2]}` : `${family} ${m[2]}.${m[3]}`
  }
  if (/^[a-z]+$/.test(id)) return FAMILY[id] ?? cap(id)
  return model
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Local reset time: `18:40`, or `lun 09:00` with `withDay`. Empty for a missing or invalid date. */
export function resetLabel(iso: string | undefined, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return withDay ? `${WEEKDAYS[d.getDay()] ?? ''} ${hhmm(d)}` : hhmm(d)
}

const SPARK = '▁▂▃▄▅▆▇█'

export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  return values
    .map(v => {
      if (!(max > 0)) return SPARK.charAt(0)
      const i = Math.min(SPARK.length - 1, Math.floor((v / max) * (SPARK.length - 1) + 0.5))
      return SPARK.charAt(i)
    })
    .join('')
}

/** Local `HH:MM` of a millisecond timestamp. */
export function clock(ms: number): string {
  return hhmm(new Date(ms))
}
