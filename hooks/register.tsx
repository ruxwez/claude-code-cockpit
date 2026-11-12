import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  CockpitCounters,
  CockpitMeta,
  CockpitModelStats,
  CockpitSnapshot,
  CockpitTurn,
} from '../types'
import {
  bar,
  clock,
  duration,
  modelName,
  money,
  ratioBar,
  resetLabel,
  sparkline,
  tokens,
  toneFor,
} from './format'
import { cacheSavings, costOf } from './pricing'

const PANE = 'cockpit'
const PANE_TITLE = 'Cockpit · analíticas de la sesión'
const MAX_TURNS = 50

// Change a tag when the shape of its value changes: an older stored value is declined.
const snapshot = atom({ plugin: 'code-cockpit', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })
const byModel = atom({ plugin: 'code-cockpit', key: 'byModel' } as const, {}, { shape: 'by-model-1' })
const turns = atom({ plugin: 'code-cockpit', key: 'turns' } as const, [], { shape: 'turns-1' })
const tools = atom({ plugin: 'code-cockpit', key: 'tools' } as const, {}, { shape: 'tools-1' })
const toolErrors = atom({ plugin: 'code-cockpit', key: 'toolErrors' } as const, {}, { shape: 'tool-errors-1' })
const meta = atom(
  { plugin: 'code-cockpit', key: 'meta' } as const,
  { model: null, effort: null, lastStepAt: null },
  { shape: 'meta-1' },
)
const counters = atom(
  { plugin: 'code-cockpit', key: 'counters' } as const,
  { subagentTurns: 0, turns: 0 },
  { shape: 'counters-1' },
)

type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback

type Engine = EngineInterface

// Module variables reset on a reload, so a stale interval cannot outlive the module that
// started it; `timer` guards against a second one within this module.
let timer: { cancel: () => void } | undefined
let turnTools = 0
let refreshMs = 5000
let cacheTtlMs = 300_000

async function tick($: Engine): Promise<void> {
  try {
    const u = await $.session.usage()
    const snap: CockpitSnapshot = {
      at: await $.clock.now(),
      startedAt: u.startedAt,
      contextPercent: u.context.percent ?? null,
      contextTokens: u.context.tokens ?? null,
      contextWindow: u.context.window,
      rateLimits: u.rateLimits.map(r => ({
        kind: r.kind,
        percentUsed: r.percentUsed,
        ...(r.resetsAt === undefined ? {} : { resetsAt: r.resetsAt }),
      })),
      costUsd: u.cost?.usd ?? null,
    }
    await update($, snapshot, () => snap)
  } catch {
    // The cockpit never gets in the way: a failed reading is skipped.
  }
}

function ensureTimer($: Engine): void {
  if (timer !== undefined) return
  try {
    timer = $.clock.every(refreshMs, () => {
      void tick($)
    })
    void tick($)
  } catch {
    timer = undefined
  }
}

function openPane($: Engine) {
  return $.ui.open({
    id: PANE,
    title: PANE_TITLE,
    focus: true,
    closeOnEscape: true,
    holdToasts: true,
  })
}

export const register: Register = (on, options) => {
  refreshMs = num(options.refreshSeconds, 5) * 1000
  cacheTtlMs = num(options.cacheTtlMinutes, 60) * 60_000

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'cockpit',
        description: 'Abre las analíticas de la sesión (Cockpit)',
      })
    } catch {
      // A failed registration leaves the band working.
    }
    timer?.cancel()
    timer = undefined
    ensureTimer($)

    return next(e)
  })

  on('session.end', ($, e, next) => {
    timer?.cancel()
    timer = undefined

    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await openPane($)

    return { text: 'Cockpit abierto.' }
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain) {
      try {
        await update($, meta, (m: CockpitMeta) => ({
          ...m,
          model: e.model,
          effort: e.effort ?? null,
        }))
      } catch {
        // Analytics only.
      }
    }
    const result = yield* next(e)
    if (isMain) {
      try {
        const now = await $.clock.now()
        await update($, meta, (m: CockpitMeta) => ({ ...m, lastStepAt: now }))
      } catch {
        // Analytics only.
      }
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const isMain = e.agentId === undefined
      const u = e.usage
      if (u !== undefined) {
        const cost = costOf(u.model, u)
        await update($, byModel, (all: Record<string, CockpitModelStats>) => {
          const prev = all[u.model] ?? {
            requests: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            costUsd: 0,
          }
          return {
            ...all,
            [u.model]: {
              requests: prev.requests + 1,
              input: prev.input + u.input_tokens,
              output: prev.output + u.output_tokens,
              cacheRead: prev.cacheRead + u.cache_read_input_tokens,
              cacheWrite: prev.cacheWrite + u.cache_creation_input_tokens,
              costUsd: cost === null || prev.costUsd === null ? null : prev.costUsd + cost,
            },
          }
        })
        if (isMain) {
          const turn: CockpitTurn = {
            at: now,
            durationMs: e.durationMs,
            tokensIn: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
            tokensOut: u.output_tokens,
            costUsd: cost,
            tools: turnTools,
            model: u.model,
            aborted: e.isAborted,
          }
          await update($, turns, (list: CockpitTurn[]) => [...list, turn].slice(-MAX_TURNS))
        }
      }
      await update($, counters, (c: CockpitCounters) =>
        isMain ? { ...c, turns: c.turns + 1 } : { ...c, subagentTurns: c.subagentTurns + 1 },
      )
      if (isMain) turnTools = 0
    } catch {
      // Analytics only.
    }
    void tick($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    if (e.agentId === undefined) turnTools += 1
    try {
      await update($, tools, (t: Record<string, number>) => ({ ...t, [name]: (t[name] ?? 0) + 1 }))
    } catch {
      // Analytics only.
    }
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      try {
        await update($, toolErrors, (t: Record<string, number>) => ({
          ...t,
          [name]: (t[name] ?? 0) + 1,
        }))
      } catch {
        // Analytics only.
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // ---- the band -----------------------------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    ensureTimer($)

    const { Box, Button, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const m = await read($, meta)
    const now = await $.clock.now()
    const columns = e.viewport?.columns

    const limit = (kind: string) => snap?.rateLimits.find(r => r.kind === kind)

    const build = (level: number): Seg[][] => {
      const ctxCells = level >= 2 ? 5 : 10
      const limCells = level >= 2 ? 5 : 8
      const withReset = level < 1
      const rows: Seg[][] = []

      rows.push([
        { text: '◆ ', color: 'cyan' },
        { text: `${modelName(m.model)}${m.effort === null ? '' : ` (${m.effort})`}`, bold: true },
      ])

      const pct = snap?.contextPercent
      if (pct === null || pct === undefined) {
        rows.push([{ text: 'ctx —', dim: true }])
      } else {
        const tone = toneFor(pct)
        rows.push([
          { text: 'ctx ▕' },
          { text: bar(pct, ctxCells), color: tone },
          { text: `▏ ${Math.round(pct)}%`, color: tone },
        ])
      }

      const lim = (label: string, kind: string, withDay: boolean) => {
        const r = limit(kind)
        if (r === undefined) return
        const tone = toneFor(r.percentUsed)
        const reset = withReset ? resetLabel(r.resetsAt, withDay) : ''
        rows.push([
          { text: `${label} ▕` },
          { text: bar(r.percentUsed, limCells), color: tone },
          { text: `▏ ${Math.round(r.percentUsed)}%`, color: tone },
          ...(reset === '' ? [] : [{ text: ` ↻${reset}`, dim: true }]),
        ])
      }
      if (level < 4) lim('5h', 'five_hour', false)
      if (level < 3) lim('sem', 'seven_day', true)

      if (m.lastStepAt !== null) {
        const left = cacheTtlMs - (now - m.lastStepAt)
        const label =
          left >= 60_000 ? `${Math.floor(left / 60_000)}m` : `${Math.max(1, Math.ceil(left / 1000))}s`
        rows.push(
          left > 0
            ? [
                { text: 'cache ' },
                { text: label, color: left > 5 * 60_000 ? 'green' : 'yellow' },
                ...(withReset ? [{ text: ` ↻${clock(m.lastStepAt + cacheTtlMs)}`, dim: true }] : []),
              ]
            : [{ text: 'cache fría', color: 'red', dim: true }],
        )
      }

      if (snap?.costUsd !== null && snap?.costUsd !== undefined) {
        rows.push([{ text: `${money(snap.costUsd)} API`, color: 'yellow', bold: true }])
      }

      return rows
    }

    const widthOf = (rows: Seg[][]) =>
      rows.reduce((n, r) => n + r.reduce((k, s) => k + s.text.length, 0), 0) + (rows.length - 1) * 3

    let rows = build(0)
    if (columns !== undefined) {
      const room = Math.max(20, columns - 4)
      for (let level = 0; level <= 4; level++) {
        rows = build(level)
        if (widthOf(rows) <= room) break
      }
    }

    return (
      <Box>
        <Button key="cockpit-open" hotkey="c" plain onPress={() => void openPane($)}>
          {rows.map((segs, i) => [
            i > 0 ? <Text dimColor> │ </Text> : '',
            ...segs.map(s => (
              <Text
                {...(s.color === undefined ? {} : { color: s.color })}
                {...(s.dim === true ? { dimColor: true } : {})}
                {...(s.bold === true ? { weight: 'bold' as const } : {})}
              >
                {s.text}
              </Text>
            )),
          ])}
        </Button>
      </Box>
    )
  })

  // ---- the analytics dialog -----------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const models = await read($, byModel)
    const turnList = await read($, turns)
    const toolMap = await read($, tools)
    const errMap = await read($, toolErrors)
    const count = await read($, counters)
    const now = await $.clock.now()
    const room = Math.max(8, (e.viewport?.rows ?? 50) - 6)

    const CELLS = 20
    const modelRows = Object.entries(models)
    const sum = (f: (s: CockpitModelStats) => number) => modelRows.reduce((n, [, s]) => n + f(s), 0)
    const tIn = sum(s => s.input)
    const tOut = sum(s => s.output)
    const tRead = sum(s => s.cacheRead)
    const tWrite = sum(s => s.cacheWrite)
    const hitDen = tIn + tRead + tWrite
    const hit = hitDen > 0 ? (tRead / hitDen) * 100 : 0
    const saved = modelRows.reduce((n, [id, s]) => n + cacheSavings(id, s.cacheRead), 0)
    const toolRows = Object.entries(toolMap).sort((a, b) => b[1] - a[1])
    const toolTotal = toolRows.reduce((n, [, c]) => n + c, 0)
    const elapsed = snap === null ? 0 : now - snap.startedAt
    const perHour =
      snap?.costUsd !== null && snap?.costUsd !== undefined && elapsed >= 60_000
        ? snap.costUsd / (elapsed / 3_600_000)
        : null

    const Head = ({ children }: { children: string }) => (
      <Text color="cyan" weight="bold">
        {children}
      </Text>
    )
    const kv = (label: string, value: string, color?: string) => (
      <Text>
        {label.padEnd(24)}
        <Text {...(color === undefined ? {} : { color })} weight="bold">
          {value}
        </Text>
      </Text>
    )
    const gauge = (label: string, pct: number | null | undefined, reset?: string) => {
      if (pct === null || pct === undefined) return <Text dimColor>{label.padEnd(8)}—</Text>
      const tone = toneFor(pct)
      return (
        <Text>
          {label.padEnd(8)}▕<Text color={tone}>{bar(pct, CELLS)}</Text>▏{' '}
          <Text color={tone}>{`${Math.round(pct)}%`.padStart(4)}</Text>
          {reset ? <Text dimColor>{` ↻${reset}`}</Text> : null}
        </Text>
      )
    }

    const five = snap?.rateLimits.find(r => r.kind === 'five_hour')
    const week = snap?.rateLimits.find(r => r.kind === 'seven_day')
    const tokMax = Math.max(tIn, tOut, tRead, tWrite)
    const tokRow = (label: string, v: number, color: string) => (
      <Text>
        {label.padEnd(14)}
        <Text color={color}>{ratioBar(v, tokMax, CELLS)}</Text> {tokens(v).padStart(6)}
      </Text>
    )
    const toolMax = toolRows[0]?.[1] ?? 0
    const lastTurns = turnList.slice(-5)
    const spark = sparkline(turnList.slice(-30).map(t => t.costUsd ?? 0))

    type Section = { lines: number; node: unknown }
    const sections: Section[] = [
      {
        lines: 7,
        node: (
          <Box flexDirection="column">
            <Head>Resumen</Head>
            {kv('Duración', snap === null ? '—' : duration(elapsed))}
            {kv('Coste API total', money(snap?.costUsd), 'yellow')}
            {kv('Coste / hora', perHour === null ? '—' : money(perHour))}
            {kv('Turnos', String(count.turns))}
            {kv('Llamadas a herramientas', String(toolTotal))}
            {kv('Turnos de subagentes', String(count.subagentTurns))}
          </Box>
        ),
      },
      {
        lines: 4,
        node: (
          <Box flexDirection="column">
            <Head>Contexto y límites</Head>
            {gauge('ctx', snap?.contextPercent)}
            {gauge('5h', five?.percentUsed, resetLabel(five?.resetsAt, false))}
            {gauge('semana', week?.percentUsed, resetLabel(week?.resetsAt, true))}
          </Box>
        ),
      },
      {
        lines: 7,
        node: (
          <Box flexDirection="column">
            <Head>Tokens</Head>
            {tokRow('input', tIn, 'cyan')}
            {tokRow('output', tOut, 'magenta')}
            {tokRow('cache read', tRead, 'green')}
            {tokRow('cache write', tWrite, 'yellow')}
            {kv('Aciertos de caché', `${hit.toFixed(1)}%`, 'green')}
            {kv('Ahorro por caché', money(saved), 'green')}
          </Box>
        ),
      },
      {
        lines: 2 + Math.max(1, modelRows.length),
        node: (
          <Box flexDirection="column">
            <Head>Por modelo (coste estimado)</Head>
            <Text dimColor>
              {'modelo'.padEnd(14)}
              {'turnos'.padStart(11)}
              {'in'.padStart(8)}
              {'out'.padStart(8)}
              {'coste'.padStart(10)}
            </Text>
            {modelRows.length === 0 ? <Text dimColor>Sin datos todavía.</Text> : null}
            {modelRows.map(([id, s]) => (
              <Text>
                {modelName(id).padEnd(14)}
                {String(s.requests).padStart(11)}
                {tokens(s.input + s.cacheRead + s.cacheWrite).padStart(8)}
                {tokens(s.output).padStart(8)}
                {money(s.costUsd).padStart(10)}
              </Text>
            ))}
          </Box>
        ),
      },
      {
        lines: 1 + Math.max(1, Math.min(8, toolRows.length)),
        node: (
          <Box flexDirection="column">
            <Head>Herramientas</Head>
            {toolRows.length === 0 ? <Text dimColor>Sin llamadas todavía.</Text> : null}
            {toolRows.slice(0, 8).map(([name, c]) => (
              <Text>
                {name.slice(0, 18).padEnd(19)}
                <Text color="cyan">{ratioBar(c, toolMax, 14)}</Text> {String(c).padStart(4)}
                {errMap[name] ? <Text color="red">{` (${errMap[name]} errores)`}</Text> : null}
              </Text>
            ))}
          </Box>
        ),
      },
      {
        lines: 2 + lastTurns.length,
        node: (
          <Box flexDirection="column">
            <Head>Últimos turnos</Head>
            <Text>
              {'coste/turno '}
              <Text color="yellow">{spark === '' ? '—' : spark}</Text>
            </Text>
            {lastTurns.map(t => (
              <Text dimColor={t.aborted}>
                {clock(t.at)} {duration(t.durationMs).padStart(7)}{' '}
                {`${tokens(t.tokensIn)}→${tokens(t.tokensOut)}`.padStart(13)} {money(t.costUsd).padStart(8)}
                {t.aborted ? ' (interrumpido)' : ''}
              </Text>
            ))}
          </Box>
        ),
      },
    ]

    let used = 1
    const shown: Section[] = []
    for (const s of sections) {
      if (used + s.lines + 1 > room && shown.length > 0) break
      shown.push(s)
      used += s.lines + 1
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {shown.map(s => (
          <Box flexDirection="column" marginBottom={1}>
            {s.node as never}
          </Box>
        ))}
        <Button key="cockpit-close" hotkey="q" onPress={() => void $.ui.close({ id: PANE })}>
          Cerrar
        </Button>
      </Box>
    )
  })
}
