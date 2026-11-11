import type { ReactElement, ReactNode } from 'react'
import type { ViewKit } from '../viewkit'
import type { AttachmentOpener, ImageLoader } from '../services'
import type { RichKit } from './richText'
import { makeAttachmentSection } from './attachments'
import type { NodeRow } from './browserRows'
import { NodeContent } from './browserNodes'

export interface BrowserRowOpts {
  tabIndex?: number
  rowRef?: (el: HTMLElement | null) => void
}

export interface BrowserElemRowOpts extends BrowserRowOpts {
  open?: boolean
  onHover?: (over: boolean) => void
}

export type BrowserElemRow = (
  key: string,
  tag: ReactNode | null,
  preview: string,
  tokens: number,
  time: number | undefined,
  body: ReactNode,
  err?: boolean,
  trailing?: ReactNode,
  stamp?: { turn: number; step: number; pending: boolean } | null,
  opts?: BrowserElemRowOpts,
) => ReactElement

export type BrowserMessageRow = (
  row: NodeRow,
  tag: ReactNode,
  onHover?: (over: boolean) => void,
  opts?: BrowserRowOpts,
) => ReactElement

export function makeBrowserMessageRow(
  kit: ViewKit,
  rich: RichKit,
  AttachmentSection: ReturnType<typeof makeAttachmentSection>,
  lineLabel: (n: number) => string,
  options: {
    elemRow: BrowserElemRow
    loadImage?: ImageLoader
    openAttachment?: AttachmentOpener
    missNote: ReactNode
    stampFor: (seq: number) => { turn: number; step: number; pending: boolean } | null
  },
): BrowserMessageRow {
  const { t } = kit
  return (row, tag, onHover, opts) => options.elemRow(
    `n${row.n.seq}`,
    tag,
    row.preview,
    row.n.tokens,
    row.n.time,
    <NodeContent
      node={row.n}
      conv={row.conv}
      rich={rich}
      att={{ Section: AttachmentSection, load: options.loadImage, open: options.openAttachment }}
      labels={{
        thinking: t('block.thinking'),
        answer: t('block.answer'),
        content: t('block.content'),
        result: t('block.result'),
        summary: t('block.summary'),
        other: t('attach.other'),
        lines: lineLabel,
        callState: (err: boolean, exit: number | null) => (
          <span className={'lc-ts-call-state ' + (err ? 'lc-ts-call-err' : 'lc-ts-call-ok')}>
            <i />
            {err
              ? t('call.fail') + (exit !== null ? ' · ' + t('call.exit', { n: exit }) : '')
              : t('call.ok')}
          </span>
        ),
      }}
      hint={row.conv === undefined ? options.missNote : t('browser.noContent')}
    />,
    row.rowErr,
    null,
    options.stampFor(row.n.seq),
    { onHover, tabIndex: opts?.tabIndex, rowRef: opts?.rowRef },
  )
}

export function browserRowTagNode(tag: string | null, names: readonly string[] | null): ReactNode {
  if (tag === null) return null
  if (names === null) return <span className="lc-br-tag">{tag}</span>
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => (
    <span key={name} className="lc-br-tag">{count > 1 ? name + ' ×' + String(count) : name}</span>
  ))
}
