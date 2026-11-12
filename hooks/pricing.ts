export type Price = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export type UsageCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// USD per million tokens; cacheWrite is the 5-minute write. Matched by longest prefix.
const PRICES: Record<string, Price> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
}

const PREFIXES = Object.keys(PRICES).sort((a, b) => b.length - a.length)

/** Strips provider prefixes, `[1m]`, version and date suffixes: `us.anthropic.claude-opus-5-5-20260101-v1:0[1m]` -> `claude-opus-5-5`. */
export function normalizeModel(model: string): string {
  let id = model.trim().toLowerCase()
  id = id.replace(/\[[^\]]*\]/g, '')
  id = id.replace(/^(us|eu|apac|global)\./, '')
  id = id.replace(/^anthropic\./, '')
  id = id.replace(/-v\d+(:\d+)?$/, '')
  id = id.replace(/-\d{8}$/, '')
  return id
}

export function priceOf(model: string): Price | null {
  const id = normalizeModel(model)
  for (const prefix of PREFIXES) {
    if (id === prefix || id.startsWith(`${prefix}-`)) return PRICES[prefix] ?? null
  }
  return null
}

/** Estimated cost in USD of one usage record; null for an unknown model. */
export function costOf(model: string, usage: UsageCounts): number | null {
  const p = priceOf(model)
  if (p === null) return null
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_creation_input_tokens * p.cacheWrite +
      usage.cache_read_input_tokens * p.cacheRead) /
    1e6
  )
}

/** USD saved by cache reads versus paying the full input price. */
export function cacheSavings(model: string, cacheRead: number): number {
  const p = priceOf(model)
  if (p === null) return 0
  return (cacheRead * (p.input - p.cacheRead)) / 1e6
}
