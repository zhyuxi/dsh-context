import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { buildContextEventDiff, diffSurfaces, replacementSeqForEvent } from '../../src/client/compactionDiff'
import type { ContextEventRecord, ContextTimeline, SurfaceNode } from '../../src/shared/types'

function surfaceNode(over: Partial<SurfaceNode> = {}): SurfaceNode {
  return { seq: 1, cat: 'user', tokens: 1, ...over }
}

function timeline(over: Partial<ContextTimeline> = {}): ContextTimeline {
  return {
    ok: true,
    current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 0 },
    requests: [],
    events: [],
    nodes: [],
    droppedNodes: 0,
    archive: [],
    ...over,
  }
}

const event: ContextEventRecord = { seq: 4, time: 0, kind: 'compaction' }

describe('diffSurfaces', () => {
  test('aligns messages by seq, keeps removed groups next to their replacement and reports one-based positions', () => {
    const rows = diffSurfaces(
      [surfaceNode({ seq: 1 }), surfaceNode({ seq: 2 }), surfaceNode({ seq: 3, text: 'old' })],
      [surfaceNode({ seq: 1 }), surfaceNode({ seq: 3, text: 'new' }), surfaceNode({ seq: 7, cat: 'assistant' })],
    )
    assert.deepEqual(rows.map(row => [row.seq, row.state]), [[1, 'same'], [2, 'removed'], [3, 'changed'], [7, 'added']])
    assert.deepEqual(rows.map(row => [row.beforePos, row.afterPos]), [[1, 1], [2, undefined], [3, 2], [undefined, 3]])
  })

  test('does not confuse a deleted prefix with reordering', () => {
    const rows = diffSurfaces(
      [surfaceNode({ seq: 1 }), surfaceNode({ seq: 2 }), surfaceNode({ seq: 3 })],
      [surfaceNode({ seq: 2 }), surfaceNode({ seq: 3 })],
    )
    assert.deepEqual(rows.filter(row => row.state !== 'removed').map(row => row.moved), [false, false])
  })

  test('marks only common messages outside a longest increasing subsequence as moved', () => {
    const rows = diffSurfaces(
      [1, 2, 3, 4].map(seq => surfaceNode({ seq })),
      [1, 3, 2, 4].map(seq => surfaceNode({ seq })),
    )
    assert.equal(rows.find(row => row.seq === 3)?.moved, true)
    assert.deepEqual(rows.filter(row => row.seq !== 3).map(row => row.moved), [false, false, false])
  })

  test('handles empty surfaces and pure additions or removals', () => {
    assert.deepEqual(diffSurfaces([], []), [])
    assert.deepEqual(diffSurfaces([], [surfaceNode()]).map(row => row.state), ['added'])
    assert.deepEqual(diffSurfaces([surfaceNode()], []).map(row => row.state), ['removed'])
  })

  test('fingerprints every content metadata field but ignores position and lifecycle metadata', () => {
    const base = surfaceNode({ time: 1, seat: 2 })
    assert.equal(diffSurfaces([base], [{ ...base, time: 9, seat: 8, gone: 10 }])[0].state, 'same')
    const changes: Array<Partial<SurfaceNode>> = [
      { cat: 'assistant' }, { tokens: 2 }, { reasoning: 1 }, { answerTokens: 1 }, { callTokens: 1 },
      { imgs: 1 }, { form: 'snapshot' }, { name: 'name' }, { text: 'text' }, { tool: 'bash' },
      { err: true }, { skill: 'skill' }, { calls: ['bash'] },
    ]
    for (const change of changes) assert.equal(diffSurfaces([base], [{ ...base, ...change }])[0].state, 'changed')
  })
})

describe('buildContextEventDiff', () => {
  test('accepts only compaction and prune events with a nearest replacement and no intervening rewrite', () => {
    const data = timeline({ events: [event], archive: [surfaceNode({ seq: 2, gone: 7 })] })
    assert.equal(replacementSeqForEvent(data, 4), 7)
    assert.equal(replacementSeqForEvent(data, 99), undefined)
    assert.equal(replacementSeqForEvent(timeline({ events: [{ ...event, kind: 'inject' }], archive: data.archive }), 4), undefined)
    assert.equal(replacementSeqForEvent(timeline({ events: [event] }), 4), undefined)
    assert.equal(replacementSeqForEvent(timeline({
      events: [event, { seq: 5, time: 0, kind: 'prune' }],
      archive: data.archive,
    }), 4), undefined)
    assert.equal(replacementSeqForEvent(timeline({
      events: [{ ...event, kind: 'prune' }],
      archive: [surfaceNode({ seq: 2, gone: 9 }), surfaceNode({ seq: 3, gone: 7 })],
    }), 4), 7)
  })

  test('reconstructs the replacement boundary without changing ordinary archive semantics', () => {
    const data = timeline({
      events: [event],
      nodes: [surfaceNode({ seq: 1 }), surfaceNode({ seq: 3, text: 'new' }), surfaceNode({ seq: 7, cat: 'assistant' })],
      archive: [
        surfaceNode({ seq: 2, text: 'removed', gone: 7 }),
        surfaceNode({ seq: 3, text: 'old', gone: 7 }),
        surfaceNode({ seq: 8, text: 'later', gone: 9 }),
      ],
    })
    const diff = buildContextEventDiff(data, 4)
    assert.deepEqual(diff?.rows.map(row => [row.seq, row.state]), [[1, 'same'], [2, 'removed'], [3, 'changed'], [7, 'added']])
    assert.equal(diff?.rows[2].before?.text, 'old')
    assert.equal(diff?.rows[2].after?.text, 'new')
    assert.equal(diff?.replacementSeq, 7)
    assert.equal(buildContextEventDiff(timeline(), 4), undefined)
  })

  test('uses archived content once when the same seq has newer live content and preserves seat ordering', () => {
    const data = timeline({
      events: [event],
      nodes: [surfaceNode({ seq: 3, text: 'new', seat: 1 }), surfaceNode({ seq: 7, cat: 'assistant', seat: 2 })],
      archive: [surfaceNode({ seq: 3, text: 'old', gone: 7 })],
    })
    const diff = buildContextEventDiff(data, 4)
    assert.deepEqual(diff?.rows.map(row => [row.seq, row.state]), [[3, 'changed'], [7, 'added']])
    assert.equal(diff?.rows[0].before?.text, 'old')
    assert.equal(diff?.rows[0].after?.text, 'new')
  })

  test('marks dropped or floor-limited history as approximate', () => {
    const archive = [surfaceNode({ seq: 2, gone: 7 })]
    assert.equal(buildContextEventDiff(timeline({ events: [event], archive, droppedNodes: 1 }), 4)?.approximate, true)
    assert.equal(buildContextEventDiff(timeline({ events: [event], archive, archiveFloor: 8 }), 4)?.approximate, true)
    assert.equal(buildContextEventDiff(timeline({ events: [event], archive }), 4)?.approximate, false)
  })
})
