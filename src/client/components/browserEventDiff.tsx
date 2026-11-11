import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { ContextEventDiff, ContextDiffRow } from '../compactionDiff'
import type { ConversationNodeLike, ContentFetcher, AttachmentOpener, ImageLoader } from '../services'
import type { ViewKit } from '../viewkit'
import { makeNodeText } from './nodes'
import { makeRichText } from './richText'
import { makeAttachmentSection } from './attachments'
import { makeNodeRowOf } from './browserRows'
import { fetchMissNote, useFetchOnMiss } from './fetchOnMiss'
import { useSurfaceWindow } from './useRowWindow'
import { browserRowTagNode, makeBrowserMessageRow } from './browserMessageRow'
import type { BrowserElemRow } from './browserMessageRow'

export interface BrowserEventDiffProps {
  diff?: ContextEventDiff
  convNodes?: readonly ConversationNodeLike[]
  fetchContent?: ContentFetcher
  loadImage?: ImageLoader
  openAttachment?: AttachmentOpener
  session?: string
  onClose: () => void
}

const diffEstimateSize = (): number => 30

export function makeBrowserEventDiff(kit: ViewKit): (props: BrowserEventDiffProps) => ReactElement {
  const { t, fmt, fmtTime, catLabel } = kit
  const nodeText = makeNodeText(kit)
  const rich = makeRichText(kit)
  const AttachmentSection = makeAttachmentSection(kit)
  const lineLabel = (n: number): string => t(n === 1 ? 'block.line' : 'block.lines', { n })

  return function BrowserEventDiff(props: BrowserEventDiffProps): ReactElement {
    const [openElem, setOpenElem] = useState<string | null>(null)
    const idBase = useId()
    const diff = props.diff
    useEffect(() => { setOpenElem(null) }, [diff?.eventSeq, diff?.replacementSeq])
    const rows = useMemo(() => diff?.rows.slice().reverse() ?? [], [diff])
    const convNodes = props.convNodes
    const convBySeq = useMemo(() => {
      const map = new Map<number, ConversationNodeLike>()
      for (const node of convNodes ?? []) map.set(node.seq, node)
      return map
    }, [convNodes])
    const openSeq = openElem === null ? null : Number(openElem.slice(1))
    const miss = useFetchOnMiss(
      openSeq !== null && !convBySeq.has(openSeq) ? openSeq : null,
      props.fetchContent,
      'dsh-context: targeted history read failed',
      props.session,
    )
    const bySeq = useMemo(() => {
      if (miss.values.size === 0) return convBySeq
      const map = new Map(convBySeq)
      for (const [seq, node] of miss.values) map.set(seq, node)
      return map
    }, [convBySeq, miss.values])
    const missNote = fetchMissNote(t, props.fetchContent, miss.state, miss.retry, 'browser.noContent')
    const nodeRowOf = useMemo(
      () => makeNodeRowOf(kit, nodeText, bySeq, openElem),
      [bySeq, openElem],
    )
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const keyOf = useCallback((index: number): string => `n${rows[index].seq}`, [rows])
    const scope = useSurfaceWindow(scrollRef, {
      count: rows.length,
      getKey: keyOf,
      estimateSize: diffEstimateSize,
    })
    const toggleElem = (key: string): void => { setOpenElem(current => current === key ? null : key) }
    const elemRow: BrowserElemRow = (
      key, tag, preview, tokens, time, body, err = false, trailing = null, _stamp = null, opts,
    ) => {
      const open = openElem === key
      const bodyId = `${idBase}-diff-${key}`
      return (
        <div key={key} data-lc-key={key} ref={opts?.rowRef} className={'lc-br-elem' + (open ? ' lc-br-elem-on' : '')}>
          <button
            type="button"
            className="lc-br-elem-row hover:bg-(--dsw-alias-interactive-bg-hover)"
            tabIndex={opts?.tabIndex}
            aria-expanded={open}
            {...(open ? { 'aria-controls': bodyId } : {})}
            onClick={() => { toggleElem(key) }}
          >
            <span className={'lc-br-chev' + (open ? ' lc-br-chev-on' : '')} />
            {err ? <span className="lc-br-err-dot" title={t('node.failed')} /> : null}
            <span className="lc-br-tags">{tag}</span>
            <span className="lc-br-preview">{preview}</span>
            {trailing}
            {time !== undefined ? <span className="lc-br-time">{fmtTime(time)}</span> : null}
            <span className="lc-br-tokens">{'≈' + fmt(tokens)}</span>
          </button>
          {open ? <div className="lc-br-content" id={bodyId}>{body}</div> : null}
        </div>
      )
    }
    const messageRow = makeBrowserMessageRow(kit, rich, AttachmentSection, lineLabel, {
      elemRow,
      loadImage: props.loadImage,
      openAttachment: props.openAttachment,
      missNote,
      stampFor: () => null,
    })
    const positionOf = (row: ContextDiffRow): string => {
      const before = row.beforePos === undefined ? '—' : String(row.beforePos)
      const after = row.afterPos === undefined ? '—' : String(row.afterPos)
      return `${before} → ${after}`
    }
    const renderRow = (row: ContextDiffRow): ReactElement => {
      const node = (row.after ?? row.before)!
      const model = nodeRowOf(node)
      const key = `n${row.seq}`
      const tags = (
        <>
          <span className={`lc-br-tag lc-br-diff-${row.state}`}>{t(`browser.diff.${row.state}`)}</span>
          {row.moved ? <span className="lc-br-tag lc-br-diff-moved">{t('browser.diff.moved')}</span> : null}
          <span className="lc-br-tag lc-br-diff-position" title={t('browser.diff.positionTip')}>{positionOf(row)}</span>
          <span className="lc-br-tag">{catLabel(node.cat)}</span>
          {browserRowTagNode(model.tag, model.tagNames)}
        </>
      )
      return messageRow(model, tags, undefined, {
        tabIndex: scope.tabIndexFor(key),
        rowRef: scope.measure(key),
      })
    }
    return (
      <div className="lc-card lc-br">
        <div className="lc-br-head lc-br-diff-head">
          <div className="lc-card-title">
            <span className="lc-card-title-text">{t('browser.diff.title')}</span>
            <button type="button" className="lc-gran-btn lc-br-diff-close" onClick={props.onClose}>
              {t('browser.diff.close')}
            </button>
          </div>
        </div>
        <div className="lc-br-note">{t('browser.diff.tip')}</div>
        {diff?.approximate === true ? <div className="lc-br-note">{t('browser.diff.approx')}</div> : null}
        {diff === undefined ? <div className="lc-br-note">{t('browser.diff.unavailable')}</div> : null}
        {diff !== undefined && rows.length === 0 ? <div className="lc-br-note">{t('browser.diff.empty')}</div> : null}
        {rows.length > 0 ? (
          <div className="lc-br-rows lc-br-diff-list" ref={scrollRef} onKeyDown={scope.onKeyDown}>
            {scope.topPad > 0 ? <div className="lc-row-pad" style={{ height: scope.topPad }} aria-hidden="true" /> : null}
            {rows.slice(scope.from, scope.to + 1).map(renderRow)}
            {scope.bottomPad > 0 ? <div className="lc-row-pad" style={{ height: scope.bottomPad }} aria-hidden="true" /> : null}
          </div>
        ) : null}
      </div>
    )
  }
}
