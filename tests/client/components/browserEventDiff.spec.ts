import { act, createElement as h, useState } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { makeBrowserEventDiff } from '../../../src/client/components/browserEventDiff'
import type { ContextBrowserProps } from '../../../src/client/components/browser'
import { diffSurfaces } from '../../../src/client/compactionDiff'
import type { ContextEventRecord, SurfaceNode } from '../../../src/shared/types'
import { Browser, kit, props, tl } from './browserHarness'
import { click, mount, query, queryAll, text } from '../helpers/kit'

const event: ContextEventRecord = { seq: 4, time: 0, kind: 'compaction' }
const node = (over: Partial<SurfaceNode>): SurfaceNode => ({ seq: 1, cat: 'user', tokens: 1, ...over })

function data(): ReturnType<typeof tl> {
  return tl({
    events: [event],
    nodes: [
      node({ seq: 1, text: 'kept' }),
      node({ seq: 3, text: 'new' }),
      node({ seq: 7, cat: 'assistant', text: 'summary', time: 0 }),
    ],
    archive: [
      node({ seq: 2, text: 'removed', gone: 7 }),
      node({ seq: 3, text: 'old', gone: 7 }),
    ],
  })
}

async function mountDiff(over: Partial<ContextBrowserProps> = {}, withCallback = true) {
  const browserProps = props({ data: data(), ...over })
  function Controlled(): ReturnType<typeof Browser> {
    const [focus, setFocus] = useState<{ seq: number; nonce: number } | null>({ seq: 4, nonce: 0 })
    const [dna, setDna] = useState(true)
    return h(Browser, {
      ...browserProps,
      dna,
      onDnaChange: setDna,
      eventDiff: focus,
      ...(withCallback ? { onEventDiffHandled: () => { setFocus(null) } } : {}),
    })
  }
  const mounted = await mount(h(Controlled))
  await act(async () => {})
  return mounted
}

describe('ContextBrowser compaction diff', () => {
  test('shows states, reverse model order, positions, moved and approximate metadata', async () => {
    const changed = data()
    changed.nodes[0] = node({ seq: 1, text: 'kept', seat: 3 })
    changed.nodes[1] = node({ seq: 3, text: 'new', seat: 1 })
    changed.nodes[2] = node({ seq: 7, cat: 'assistant', text: 'summary', seat: 2 })
    changed.droppedNodes = 1
    const m = await mountDiff({ data: changed })
    assert.ok(text(m.container).includes('Context Changes'))
    assert.ok(text(m.container).includes('approximate'))
    const keys = queryAll(m.container, '.lc-br-elem').map(row => row.getAttribute('data-lc-key'))
    assert.deepEqual(keys, ['n1', 'n7', 'n3', 'n2'])
    assert.ok(text(m.container).includes('Added'))
    assert.ok(text(m.container).includes('Removed'))
    assert.ok(text(m.container).includes('Content changed'))
    assert.ok(text(m.container).includes('Kept'))
    assert.ok(text(m.container).includes('Order changed'))
    assert.ok(text(m.container).includes('3 → 1'))
    await m.unmount()
  })

  test('expands added and removed rows with the existing content renderer and lazy fetch', async () => {
    const fetchContent = (seq: number) => Promise.resolve(seq === 2
      ? { seq, kind: 'user' as const, content: [{ type: 'text' as const, text: 'fetched removed body\nsecond line' }] }
      : null)
    const m = await mountDiff({ fetchContent })
    const removed = query(m.container, '[data-lc-key="n2"] .lc-br-elem-row')
    await click(removed)
    await act(async () => {})
    assert.ok(text(m.container).includes('fetched removed body'))
    assert.ok(text(m.container).includes('2 lines'))
    const added = query(m.container, '[data-lc-key="n7"] .lc-br-elem-row')
    await click(added)
    assert.ok(text(m.container).includes('summary'))
    await click(added)
    assert.equal(added.getAttribute('aria-expanded'), 'false')
    await m.unmount()
  })

  test('keeps tool result status and exit details in expanded rows', async () => {
    const toolData = tl({
      events: [event],
      nodes: [node({ seq: 7, cat: 'tool', tool: 'bash', err: true })],
      archive: [node({ seq: 2, gone: 7 })],
    })
    const m = await mountDiff({
      data: toolData,
      convNodes: [{ seq: 7, kind: 'tool-result', isError: true, content: [{ type: 'text' as const, text: '[exit code: 3]' }], call: { name: 'bash', argsRaw: '{}' } }],
    })
    await click(query(m.container, '[data-lc-key="n7"] .lc-br-elem-row'))
    assert.ok(text(m.container).includes('Failed'))
    assert.ok(text(m.container).includes('exit 3'))
    await m.unmount()
  })

  test('supports an uncontrolled event focus and ignores an unknown event seq', async () => {
    const m = await mount(h(Browser, props({ data: data(), eventDiff: { seq: 4, nonce: 0 } })))
    await act(async () => {})
    assert.ok(text(m.container).includes('Context Changes'))
    await m.unmount()
    const unknown = await mount(h(Browser, props({ data: data(), eventDiff: { seq: 99, nonce: 0 } })))
    await act(async () => {})
    assert.ok(text(unknown.container).includes('Context Browser'))
    await unknown.unmount()
  })

  test('shows unavailable and empty fallbacks and closes back to steps', async () => {
    const unavailable = await mountDiff({ data: tl({ events: [event] }) })
    assert.ok(text(unavailable.container).includes('no reconstructible replacement'))
    await click(query(unavailable.container, '.lc-br-diff-close'))
    assert.ok(text(unavailable.container).includes('Context Browser'))
    await unavailable.unmount()
    const Diff = makeBrowserEventDiff(kit)
    const empty = await mount(h(Diff, {
      diff: { eventSeq: 4, replacementSeq: 7, approximate: false, rows: [] },
      onClose: () => {},
    }))
    assert.ok(text(empty.container).includes('No message changes'))
    await empty.unmount()
  })

  test('windows a long message list with scrolling spacers', async () => {
    const before = Array.from({ length: 100 }, (_, index) => node({ seq: index + 1, text: `message ${index + 1}` }))
    const Diff = makeBrowserEventDiff(kit)
    const m = await mount(h(Diff, {
      diff: { eventSeq: 4, replacementSeq: 7, approximate: false, rows: diffSurfaces(before, before) },
      onClose: () => {},
    }))
    assert.ok(queryAll(m.container, '.lc-br-elem').length < 100)
    const list = query<HTMLElement>(m.container, '.lc-br-diff-list')
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true })
    await act(async () => {
      list.scrollTop = 1500
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    assert.ok(queryAll(m.container, '.lc-row-pad').length > 0)
    await m.unmount()
  })
})
