export type CockpitModelStats = {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Estimated cost in USD from the plugin's own price table; null when the model is unpriced. */
  costUsd: number | null
}

export type CockpitTurn = {
  at: number
  durationMs: number
  tokensIn: number
  tokensOut: number
  costUsd: number | null
  tools: number
  model: string
  aborted: boolean
}

export type CockpitRateLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type CockpitSnapshot = {
  at: number
  startedAt: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  rateLimits: CockpitRateLimit[]
  costUsd: number | null
}

export type CockpitMeta = {
  model: string | null
  effort: string | number | null
  lastStepAt: number | null
}

export type CockpitCounters = {
  /** Completed subagent turns. */
  subagentTurns: number
  /** Completed main-loop turns. */
  turns: number
}

declare module 'claude-code' {
  interface PluginState {
    'code-cockpit': {
      snapshot: Shaped<CockpitSnapshot | null>
      byModel: Shaped<Record<string, CockpitModelStats>>
      turns: Shaped<CockpitTurn[]>
      tools: Shaped<Record<string, number>>
      toolErrors: Shaped<Record<string, number>>
      meta: Shaped<CockpitMeta>
      counters: Shaped<CockpitCounters>
    }
  }
}
