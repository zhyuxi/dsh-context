import type { ContextTimeline, SurfaceNode } from '../shared/types'
import { assemble } from './assemble'

export type ContextDiffState = 'same' | 'removed' | 'added' | 'changed'

export interface ContextDiffRow {
  seq: number
  state: ContextDiffState
  moved: boolean
  before?: SurfaceNode
  after?: SurfaceNode
  beforePos?: number
  afterPos?: number
}

export interface ContextEventDiff {
  eventSeq: number
  replacementSeq: number
  approximate: boolean
  rows: ContextDiffRow[]
}

function fingerprint(node: SurfaceNode): string {
  return JSON.stringify([
    node.cat, node.tokens, node.reasoning, node.answerTokens, node.callTokens,
    node.imgs, node.form, node.name, node.text, node.tool, node.err, node.skill, node.calls,
  ])
}

function movedCommon(common: ContextDiffRow[]): Set<number> {
  const tails: number[] = []
  const tailRows: number[] = []
  const previous = common.map(() => -1)
  for (let i = 0; i < common.length; i++) {
    const position = common[i].beforePos as number
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (tails[mid] < position) low = mid + 1
      else high = mid
    }
    tails[low] = position
    tailRows[low] = i
    previous[i] = low > 0 ? tailRows[low - 1] : -1
  }
  const kept = new Set<number>()
  let index = tails.length > 0 ? tailRows[tails.length - 1] : -1
  while (index >= 0) {
    kept.add(common[index].seq)
    index = previous[index]
  }
  return new Set(common.filter(row => !kept.has(row.seq)).map(row => row.seq))
}

export function diffSurfaces(before: readonly SurfaceNode[], after: readonly SurfaceNode[]): ContextDiffRow[] {
  const beforeBySeq = new Map(before.map((node, index) => [node.seq, { node, position: index + 1 }]))
  const afterBySeq = new Map(after.map((node, index) => [node.seq, { node, position: index + 1 }]))
  const rows: ContextDiffRow[] = []
  const common: ContextDiffRow[] = []
  const removed = before.filter(node => !afterBySeq.has(node.seq)).map(node => ({
    seq: node.seq,
    state: 'removed' as const,
    moved: false,
    before: node,
    beforePos: beforeBySeq.get(node.seq)?.position,
  }))
  let removedIndex = 0
  for (const node of after) {
    const old = beforeBySeq.get(node.seq)
    if (old !== undefined) {
      while (removedIndex < removed.length && (removed[removedIndex].beforePos as number) < old.position) {
        rows.push(removed[removedIndex++])
      }
    }
    const afterPos = afterBySeq.get(node.seq)?.position
    if (old === undefined) {
      rows.push({ seq: node.seq, state: 'added', moved: false, after: node, afterPos })
      continue
    }
    const row: ContextDiffRow = {
      seq: node.seq,
      state: fingerprint(old.node) === fingerprint(node) ? 'same' : 'changed',
      moved: false,
      before: old.node,
      after: node,
      beforePos: old.position,
      afterPos,
    }
    rows.push(row)
    common.push(row)
  }
  rows.push(...removed.slice(removedIndex))
  const moved = movedCommon(common)
  for (const row of common) row.moved = moved.has(row.seq)
  return rows
}

export function replacementSeqForEvent(data: ContextTimeline, eventSeq: number): number | undefined {
  const event = data.events.find(item => item.seq === eventSeq)
  if (event === undefined || (event.kind !== 'compaction' && event.kind !== 'prune')) return undefined
  let replacement: number | undefined
  for (const node of data.archive) {
    if (node.gone !== undefined && node.gone > eventSeq && (replacement === undefined || node.gone < replacement)) {
      replacement = node.gone
    }
  }
  if (replacement === undefined) return undefined
  const intervening = data.events.some(item => item.seq > eventSeq && item.seq < replacement
    && (item.kind === 'compaction' || item.kind === 'prune'))
  return intervening ? undefined : replacement
}

export function buildContextEventDiff(data: ContextTimeline, eventSeq: number): ContextEventDiff | undefined {
  const replacementSeq = replacementSeqForEvent(data, eventSeq)
  if (replacementSeq === undefined) return undefined
  const before = assemble(data, null, replacementSeq)
  const replaced = new Map<number, SurfaceNode>()
  for (const node of data.archive) {
    if (node.seq < replacementSeq && node.gone === replacementSeq) replaced.set(node.seq, node)
  }
  before.nodes = before.nodes.filter(node => !replaced.has(node.seq))
  before.nodes.push(...replaced.values())
  before.nodes.sort((a, b) => (a.seat ?? a.seq) - (b.seat ?? b.seq) || a.seq - b.seq)
  const after = assemble(data, null, replacementSeq + 1)
  return {
    eventSeq,
    replacementSeq,
    approximate: data.droppedNodes > 0 || before.approximate,
    rows: diffSurfaces(before.nodes, after.nodes),
  }
}
