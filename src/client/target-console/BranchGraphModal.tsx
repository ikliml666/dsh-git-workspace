import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleGitGraphCommit,
} from '../../console-contract.js'
import type { ClientTranslator } from '../i18n.js'

export type LaneGlyph = 'node' | 'pass' | 'merge' | 'gap'

export interface GraphRowLanes {
  columns: LaneGlyph[]
  nodeColumn: number
  merge: boolean
}

/**
 * Lane topology ported from @linxin666/dsh-client-ui-git-graph (computeLanes):
 * first parent keeps the commit's lane, other parents open lanes to the right;
 * a lane goes quiet once every child has been rendered.
 */
export function computeGraphLanes(rows: Pick<WorktreeConsoleGitGraphCommit, 'oid' | 'parents'>[]): GraphRowLanes[] {
  const later = new Set<string>()
  for (const row of rows) for (const parent of row.parents) later.add(parent)
  let lanes: (string | null)[] = []
  const result: GraphRowLanes[] = []
  for (const row of rows) {
    let nodeColumn = lanes.findIndex(pending => pending === row.oid)
    if (nodeColumn === -1) {
      lanes.push(row.oid)
      nodeColumn = lanes.length - 1
    }
    const columns = lanes.map((pending, column): LaneGlyph => {
      if (pending === null) return 'gap'
      if (column === nodeColumn) return row.parents.length > 1 ? 'merge' : 'node'
      if (pending === row.oid) return 'gap'
      if (later.has(pending)) return 'pass'
      return 'gap'
    })
    lanes = lanes.map((pending, column) => column === nodeColumn ? pending : pending === row.oid ? null : pending)
    lanes[nodeColumn] = row.parents[0] ?? null
    for (const parent of row.parents.slice(1)) {
      if (!lanes.includes(parent)) lanes.push(parent)
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    result.push({ columns, nodeColumn, merge: row.parents.length > 1 })
  }
  return result
}

const GLYPH_CHAR: Record<LaneGlyph, string> = { node: '●', merge: '◆', pass: '│', gap: ' ' }
const LANE_COLORS = ['#5a8dee', '#8e6fe8', '#3aa981', '#d9913b', '#d76a8c', '#5aa9c9']
const INITIAL_LIMIT = 200
const PAGE_STEP = 100

function formatTime(epochSeconds: number, t: ClientTranslator): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds))
  if (elapsed < 60) return t("time.just.now")
  if (elapsed < 3600) return t("time.minutes.ago", { p0: Math.floor(elapsed / 60) })
  if (elapsed < 86400) return t("time.hours.ago", { p0: Math.floor(elapsed / 3600) })
  if (elapsed < 30 * 86400) return t("time.days.ago", { p0: Math.floor(elapsed / 86400) })
  const date = new Date(epochSeconds * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface BranchGraphModalProps {
  open: boolean
  onClose: () => void
  adapter: WorktreeConsoleAdapter
  sessionId: string
  t: ClientTranslator
  currentBranch: string | null
}

/** Repo-wide commit graph (git log --topo-order) with ASCII lane rendering. */
export function BranchGraphModal({ open, onClose, adapter, sessionId, t, currentBranch }: BranchGraphModalProps) {
  const [limit, setLimit] = useState(INITIAL_LIMIT)
  const [commits, setCommits] = useState<WorktreeConsoleGitGraphCommit[] | null>(null)
  const [lanes, setLanes] = useState<GraphRowLanes[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const requestSeq = useRef(0)

  const load = useCallback(async (nextLimit: number): Promise<void> => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const outcome = await adapter.gitGraph(sessionId, nextLimit)
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (!outcome.ok) {
      setError(outcome.error.message)
      return
    }
    setCommits(outcome.value.commits)
    setLanes(computeGraphLanes(outcome.value.commits))
  }, [adapter, sessionId])

  useEffect(() => {
    if (!open) return
    setLimit(INITIAL_LIMIT)
    setCommits(null)
    setLanes(null)
    setError(null)
    void load(INITIAL_LIMIT)
    return () => { requestSeq.current += 1 }
  }, [open, load])

  const hasMore = commits !== null && commits.length >= limit

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("commit.graph.title")}
      closeLabel={t("close")}
      footer={(
        <span className="dsh-wtc-graph-footer">
          {hasMore ? (
            <button
              type="button"
              className="dsh-wtc-button"
              disabled={loading}
              onClick={() => {
                const nextLimit = limit + PAGE_STEP
                setLimit(nextLimit)
                void load(nextLimit)
              }}
            >
              {loading ? t("commit.graph.loading") : t("commit.graph.more", { p0: PAGE_STEP })}
            </button>
          ) : null}
          {loading && hasMore ? null : loading ? <span>{t("commit.graph.loading")}</span> : null}
        </span>
      )}
    >
      <div className="dsh-wtc-graph" role="log" aria-label={t("commit.graph.title")}>
        {commits === null && !error ? <div className="dsh-wtc-graph-empty">{t("commit.graph.loading")}</div> : null}
        {commits !== null && commits.length === 0 ? <div className="dsh-wtc-graph-empty">{t("commit.graph.empty")}</div> : null}
        {error ? <div className="dsh-wtc-menu-error">{error}</div> : null}
        {commits !== null && lanes !== null ? commits.map((commit, index) => {
          const row = lanes[index]!
          return (
            <div className="dsh-wtc-graph-row" key={commit.oid}>
              <span className="dsh-wtc-graph-oid" title={commit.oid}>{commit.oid.slice(0, 7)}</span>
              <span className="dsh-wtc-graph-lanes" aria-hidden>
                {row.columns.map((glyph, column) => (
                  <span
                    key={column}
                    data-gitgraph-glyph={glyph}
                    style={glyph === 'node' || glyph === 'merge' ? { color: LANE_COLORS[column % LANE_COLORS.length] } : undefined}
                  >
                    {GLYPH_CHAR[glyph]}
                  </span>
                ))}
              </span>
              <span className="dsh-wtc-graph-main">
                <span className="dsh-wtc-graph-subject" title={commit.subject}>{commit.subject}</span>
                <span className="dsh-wtc-graph-meta">
                  {commit.refs.map(ref => (
                    <span
                      key={ref}
                      className="dsh-wtc-graph-ref"
                      data-gitgraph-ref-current={ref === currentBranch || ref === 'HEAD' ? '' : undefined}
                      title={ref}
                    >
                      {ref}
                    </span>
                  ))}
                  <span>{commit.author}</span>
                  <span>{formatTime(commit.authorTime, t)}</span>
                </span>
              </span>
            </div>
          )
        }) : null}
      </div>
    </Modal>
  )
}
