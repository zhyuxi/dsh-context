import type { Assembled } from '../assemble'
import type { Category, RequestRecord, SurfaceNode } from '../../shared/types'
import type { RowKind } from './browserNodes'

export interface CatFocus {
  cat: string
  kind?: RowKind
  step?: number
  query?: string
}

export function countOf(asm: Assembled, byCat: Partial<Record<Category, SurfaceNode[]>>, c: string): number {
  if (c === 'system') return asm.system !== null ? 1 : 0
  if (c === 'tools') return asm.header !== null ? asm.header.tools.length : 0
  return byCat[c as Category]?.length ?? 0
}

export function lastOfTurn(requests: RequestRecord[], turn: number): RequestRecord | null {
  for (let i = requests.length - 1; i >= 0; i--) if ((requests[i].turn ?? 0) === turn) return requests[i]
  return null
}

export function stepStampOf(requests: RequestRecord[]): (itemSeq: number) => { turn: number; step: number } | null {
  const sorted = requests.slice().sort((a, b) => a.seq - b.seq)
  return (itemSeq) => {
    for (const r of sorted) {
      if (r.seq > itemSeq) {
        return typeof r.turn === 'number' && typeof r.step === 'number' ? { turn: r.turn, step: r.step } : null
      }
    }
    return null
  }
}


export function findRowByKey(root: HTMLElement, key: string): HTMLElement | null {
  for (const row of root.querySelectorAll<HTMLElement>('[data-lc-key]')) {
    if (row.dataset.lcKey === key) return row
  }
  return null
}

export const safeIdPart = (key: string): string => key.replace(/[^a-zA-Z0-9_-]/g, '_')

export function previousRequest(
  requests: readonly RequestRecord[],
  record: RequestRecord,
): RequestRecord | null {
  const index = requests.findIndex(item => item.seq === record.seq)
  return index > 0 ? requests[index - 1] : null
}

export const DNA_MIN_BAND = 0.35
