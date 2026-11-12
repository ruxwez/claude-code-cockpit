import { expect, mock, test } from 'claude-code/testing'

import { bar, duration, modelName, money, sparkline, tokens, toneFor } from './format'
import { cacheSavings, costOf } from './pricing'

const USAGE = {
  startedAt: 0,
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23, resetsAt: '2026-11-12T17:40:00Z' },
    { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-11-16T08:00:00Z' },
  ],
  cost: { usd: 1.23 },
}

const BAND = {
  plugin: 'code-cockpit',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 5,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'code-cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  props: {
    title: 'Cockpit',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6

const U = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_read_input_tokens: 1_000_000,
  cache_creation_input_tokens: 1_000_000,
}

test('costOf prices opus-5-5, strips suffixes, and returns null for unknown models', () => {
  // 4 + 20 + 5 + 0.2 per million of each
  expect(close(costOf('claude-opus-5-5', U), 29.2)).toBe(true)
  expect(close(costOf('us.anthropic.claude-opus-5-5-20260101-v1:0[1m]', U), 29.2)).toBe(true)
  expect(close(costOf('claude-opus-4-7', U), 5 + 25 + 6.25 + 0.5)).toBe(true)
  expect(close(costOf('claude-sonnet-5-5', U), 2 + 10 + 2.5 + 0.1)).toBe(true)
  expect(costOf('mystery-model', U)).toBeNull()
  expect(costOf('opus', U)).toBeNull()
  expect(close(cacheSavings('claude-opus-5-5', 1_000_000), 3.8)).toBe(true)
})

test('format helpers', () => {
  expect(bar(42, 10)).toBe('████░░░░░░')
  expect(bar(250, 4)).toBe('████')
  expect(toneFor(10)).toBe('green')
  expect(toneFor(50)).toBe('yellow')
  expect(toneFor(80)).toBe('red')
  expect(money(0.01234)).toBe('$0.0123')
  expect(money(1.234)).toBe('$1.23')
  expect(money(null)).toBe('?')
  expect(tokens(950)).toBe('950')
  expect(tokens(1234)).toBe('1.2k')
  expect(tokens(3_400_000)).toBe('3.4M')
  expect(duration(3_900_000)).toBe('1h 05m')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-2')).toBe('Fable 5.2')
  expect(modelName('claude-sonnet-4-6-20250101')).toBe('Sonnet 4.6')
  expect(modelName('opus')).toBe('Opus')
  expect(modelName(null)).toBe('—')
  expect(sparkline([0, 1, 2, 4])).toHaveLength(4)
  expect(sparkline([1, 1]).charAt(0)).toBe('█')
})

const opened: string[] = []
const closed: string[] = []

function seed(on: any) {
  mock.clock(on, { now: 60_000 })
  on('command.register', () => ({ value: { command: 'cockpit' } }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    closed.push(e.id)
    return { value: { isClosed: true } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('tool.call', () => ({ result: {} }))
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
}

async function boot($: any) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('the band shows model, ctx, limits, cache and cost on every surface; the button opens the pane', async ($, on) => {
  seed(on)
  await boot($)
  opened.length = 0

  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-opus-5-5',
    effort: 'high',
    messageCount: 1,
  })
  for await (const _ of stream) void _
  await stream.result
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1500,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', ...U },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /high/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache 5m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23 API/ })).toBeDefined()
    await ui.press({ key: 'cockpit-open' })
    await ui.unmount()
  }
  expect(opened).toEqual(['cockpit', 'cockpit'])
})

test('the band yields to a survey', async ($, on) => {
  seed(on)
  on('ui.render', ($2, e) => {
    const { Text } = $2.ui.resolve(e)
    return <Text>engine</Text>
  })
  await boot($)
  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
    surface: 'terminal',
  })
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('the pane renders seeded analytics', async ($, on) => {
  seed(on)
  await boot($)
  for (const name of ['Read', 'Read', 'Bash']) await $.tool.call({ tool: name === 'Bash' ? 'Bash' : 'Read', ...(name === 'Bash' ? { command: 'ls' } : { file_path: '/a' }) } as never)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 2000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', ...U },
  })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 900,
    isAborted: false,
    turnId: 't2',
    agentId: 'sub1',
    reason: 'answer',
    usage: { model: 'claude-haiku-5-5', ...U },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const re of [
      /Resumen/,
      /Coste API total/,
      /\$1\.23/,
      /Contexto y límites/,
      /Tokens/,
      /Por modelo/,
      /Opus 5\.5/,
      /Haiku 5\.5/,
      /Herramientas/,
      /Read/,
      /Últimos turnos/,
    ]) {
      expect(await ui.find({ type: 'Text', text: re }), String(re)).toBeDefined()
    }
    await ui.press({ key: 'cockpit-close' })
    expect(closed.at(-1)).toBe('cockpit')
    await ui.unmount()
  }
})
