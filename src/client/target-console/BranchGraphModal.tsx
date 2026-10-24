import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleGitGraphCommit,
} from '../../console-contract.js'
import type { ClientTranslator } from '../i18n.js'

/** One drawn segment: x in lane units (column), y in row fractions (0 top, 0.5 node center, 1 bottom). */
export interface GraphEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  color: number
}

export interface GraphRowLanes {
  nodeColumn: number
  /** Graph-wide maximum lane count, so every row renders the same svg width. */
  laneCount: number
  edges: GraphEdge[]
}

export interface GraphRefBadge {
  /** Short name shown in the badge (origin/ prefix and the tag marker stripped). */
  label: string
  /** Every raw ref collapsed into this badge, joined for the tooltip. */
  full: string
  /** True for a tag ref, so the badge renders apart from branch refs. */
  tag: boolean
}

/**
 * Collapse local + remote refs sharing a short name (foo + origin/foo) into one
 * badge. Tag refs arrive marked (`tag:<name>` from the git adapter) and never
 * collapse with a same-named branch: a tag and a branch are different objects.
 */
export function mergeRefs(refs: string[]): GraphRefBadge[] {
  const merged: GraphRefBadge[] = []
  const indexByKey = new Map<string, number>()
  for (const ref of refs) {
    const isTag = ref.startsWith('tag:')
    const raw = isTag ? ref.slice('tag:'.length) : ref
    const label = raw.startsWith('origin/') ? raw.slice('origin/'.length) : raw
    const key = `${isTag ? 'tag' : 'ref'}:${label}`
    const existing = indexByKey.get(key)
    if (existing === undefined) {
      indexByKey.set(key, merged.length)
      merged.push({ label, full: raw, tag: isTag })
      continue
    }
    const entry = merged[existing]!
    if (!entry.full.split(' · ').includes(raw)) entry.full = `${entry.full} · ${raw}`
  }
  return merged
}

/**
 * Lane topology ported from @linxin666/dsh-client-ui-git-graph (computeLanes),
 * emitting edge geometry instead of per-row glyphs so consecutive rows join up:
 * first parent keeps the commit's lane, other parents open lanes to the right;
 * a lane goes quiet once every child has been rendered, and quiet lanes are
 * reused leftmost-first so lane count tracks concurrent branches, not total.
 */
export function computeGraphLanes(rows: Pick<WorktreeConsoleGitGraphCommit, 'oid' | 'parents'>[]): GraphRowLanes[] {
  let lanes: (string | null)[] = []
  let laneCount = 1
  const result: GraphRowLanes[] = []
  const acquireLane = (pending: string): number => {
    const existing = lanes.indexOf(pending)
    if (existing !== -1) return existing
    // Convergent branches leave duplicate pendings (the same oid parked in
    // several slots): keep the leftmost copy and treat the freed slots as
    // reusable holes, so sibling branches share one lane instead of each
    // growing the graph rightward.
    const seen = new Set<string>()
    const holes: number[] = []
    lanes.forEach((slot, column) => {
      if (slot === null) holes.push(column)
      else if (seen.has(slot)) {
        lanes[column] = null
        holes.push(column)
      } else seen.add(slot)
    })
    if (holes.length > 0) {
      const hole = holes[0]!
      lanes[hole] = pending
      return hole
    }
    lanes.push(pending)
    return lanes.length - 1
  }
  for (const row of rows) {
    const found = lanes.findIndex(pending => pending === row.oid)
    let nodeColumn = found
    if (nodeColumn === -1) nodeColumn = acquireLane(row.oid)
    const edges: GraphEdge[] = []
    if (found !== -1) edges.push({ x1: nodeColumn, y1: 0, x2: nodeColumn, y2: 0.5, color: nodeColumn })
    for (let column = 0; column < lanes.length; column++) {
      if (column !== nodeColumn && lanes[column] === row.oid) {
        edges.push({ x1: column, y1: 0, x2: nodeColumn, y2: 0.5, color: column })
      }
    }
    const before = lanes.slice()
    lanes = lanes.map((pending, column) => (column === nodeColumn || pending === row.oid ? null : pending))
    lanes[nodeColumn] = row.parents[0] ?? null
    if (row.parents.length > 0) {
      edges.push({ x1: nodeColumn, y1: 0.5, x2: nodeColumn, y2: 1, color: nodeColumn })
      for (const parent of row.parents.slice(1)) {
        const target = acquireLane(parent)
        if (target !== nodeColumn) edges.push({ x1: nodeColumn, y1: 0.5, x2: target, y2: 1, color: target })
      }
    }
    for (let column = 0; column < before.length; column++) {
      const pending = before[column]
      if (pending !== null && column !== nodeColumn && pending !== row.oid && lanes[column] === pending) {
        edges.push({ x1: column, y1: 0, x2: column, y2: 1, color: column })
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    laneCount = Math.max(laneCount, lanes.length)
    result.push({ nodeColumn, laneCount, edges })
  }
  for (const row of result) row.laneCount = laneCount
  return result
}

const LANE_COLORS = ['#5a8dee', '#8e6fe8', '#3aa981', '#d9913b', '#d76a8c', '#5aa9c9']
const LANE_WIDTH = 14
const ROW_HEIGHT = 36
const NODE_RADIUS = 4
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
  /** Open the tag manager pointing at this commit. */
  onTagCommit?: (oid: string) => void
  /** Open the tag manager without a target (HEAD). */
  onManageTags?: () => void
}

function laneX(column: number): number {
  return column * LANE_WIDTH + LANE_WIDTH / 2
}

function edgePath(edge: GraphEdge): string {
  const x1 = laneX(edge.x1)
  const x2 = laneX(edge.x2)
  const y1 = edge.y1 * ROW_HEIGHT
  const y2 = edge.y2 * ROW_HEIGHT
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

/** Repo-wide commit graph (git log --topo-order) with GitHub-style svg lane rendering. */
export function BranchGraphModal({ open, onClose, adapter, sessionId, t, currentBranch, onTagCommit, onManageTags }: BranchGraphModalProps) {
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
  const graphWidth = lanes !== null && lanes.length > 0 ? lanes[0]!.laneCount * LANE_WIDTH : LANE_WIDTH

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("commit.graph.title")}
      closeLabel={t("close")}
      className="dsh-wtc-graph-modal"
      footer={(
        <span className="dsh-wtc-graph-footer">
          {onManageTags ? (
            <button type="button" className="dsh-wtc-button" onClick={onManageTags}>
              {t("tag.manager.title")}
            </button>
          ) : null}
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
                <svg
                  className="dsh-wtc-graph-lane-svg"
                  width={graphWidth}
                  height={ROW_HEIGHT}
                  viewBox={`0 0 ${graphWidth} ${ROW_HEIGHT}`}
                >
                  {row.edges.map((edge, edgeIndex) => (
                    <path
                      key={edgeIndex}
                      d={edgePath(edge)}
                      stroke={LANE_COLORS[edge.color % LANE_COLORS.length]}
                      strokeWidth={1.5}
                      fill="none"
                      strokeLinecap="round"
                    />
                  ))}
                  <circle
                    cx={laneX(row.nodeColumn)}
                    cy={ROW_HEIGHT / 2}
                    r={NODE_RADIUS}
                    fill={LANE_COLORS[row.nodeColumn % LANE_COLORS.length]}
                  />
                </svg>
              </span>
              <span className="dsh-wtc-graph-main">
                <span className="dsh-wtc-graph-subject" title={commit.subject}>{commit.subject}</span>
                <span className="dsh-wtc-graph-meta">
                  {mergeRefs(commit.refs).map(entry => (
                    <span
                      key={`${entry.tag ? 'tag' : 'ref'}:${entry.full}`}
                      className="dsh-wtc-graph-ref"
                      data-gitgraph-ref-tag={entry.tag ? '' : undefined}
                      data-gitgraph-ref-current={!entry.tag && (entry.label === currentBranch || (currentBranch !== null && entry.full.split(' · ').includes(currentBranch))) ? '' : undefined}
                      title={entry.tag ? `tag: ${entry.full}` : entry.full}
                    >
                      {entry.label}
                    </span>
                  ))}
                  <span>{commit.author}</span>
                  <span>{formatTime(commit.authorTime, t)}</span>
                  {onTagCommit ? (
                    <button
                      type="button"
                      className="dsh-wtc-graph-tag-action"
                      title={t("tag.graph.action")}
                      onClick={() => onTagCommit(commit.oid)}
                    >
                      {t("tag.manager.title")}
                    </button>
                  ) : null}
                </span>
              </span>
            </div>
          )
        }) : null}
      </div>
    </Modal>
  )
}
