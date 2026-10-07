import { describe, expect, it } from 'vitest'
import { computeGraphLanes, mergeRefs } from '../src/client/target-console/BranchGraphModal.js'

describe('computeGraphLanes', () => {
  it('routes a linear history through a single lane', () => {
    const rows = computeGraphLanes([
      { oid: 'a', parents: ['b'] },
      { oid: 'b', parents: [] },
    ])
    expect(rows[0]).toEqual({
      nodeColumn: 0,
      laneCount: 1,
      edges: [{ x1: 0, y1: 0.5, x2: 0, y2: 1, color: 0 }],
    })
    expect(rows[1]).toEqual({
      nodeColumn: 0,
      laneCount: 1,
      edges: [{ x1: 0, y1: 0, x2: 0, y2: 0.5, color: 0 }],
    })
  })

  it('opens a lane for a second parent and converges it back at the merge', () => {
    const rows = computeGraphLanes([
      { oid: 'a', parents: ['b', 'c'] },
      { oid: 'b', parents: ['d'] },
      { oid: 'c', parents: ['d'] },
      { oid: 'd', parents: [] },
    ])
    expect(rows.map(row => row.laneCount)).toEqual([2, 2, 2, 2])
    expect(rows[0]!.edges).toEqual([
      { x1: 0, y1: 0.5, x2: 0, y2: 1, color: 0 },
      { x1: 0, y1: 0.5, x2: 1, y2: 1, color: 1 },
    ])
    expect(rows[1]!.edges).toEqual([
      { x1: 0, y1: 0, x2: 0, y2: 0.5, color: 0 },
      { x1: 0, y1: 0.5, x2: 0, y2: 1, color: 0 },
      { x1: 1, y1: 0, x2: 1, y2: 1, color: 1 },
    ])
    expect(rows[2]!.edges).toEqual([
      { x1: 1, y1: 0, x2: 1, y2: 0.5, color: 1 },
      { x1: 1, y1: 0.5, x2: 1, y2: 1, color: 1 },
      { x1: 0, y1: 0, x2: 0, y2: 1, color: 0 },
    ])
    expect(rows[3]!).toEqual({
      nodeColumn: 0,
      laneCount: 2,
      edges: [
        { x1: 0, y1: 0, x2: 0, y2: 0.5, color: 0 },
        { x1: 1, y1: 0, x2: 0, y2: 0.5, color: 1 },
      ],
    })
  })

  it('renders a root commit as a bare node with no edges', () => {
    expect(computeGraphLanes([{ oid: 'r', parents: [] }])).toEqual([
      { nodeColumn: 0, laneCount: 1, edges: [] },
    ])
  })

  it('reuses a quiet lane for a later branch instead of growing rightward', () => {
    const rows = computeGraphLanes([
      { oid: 'a1', parents: ['a2'] },
      { oid: 'x1', parents: ['x2'] },
      { oid: 'a2', parents: [] },
      { oid: 'b1', parents: ['b2'] },
      { oid: 'x2', parents: [] },
      { oid: 'b2', parents: [] },
    ])
    expect(rows.map(row => row.laneCount)).toEqual([2, 2, 2, 2, 2, 2])
    expect(rows[0]!.nodeColumn).toBe(0)
    expect(rows[1]!.nodeColumn).toBe(1)
    expect(rows[3]!.nodeColumn).toBe(0)
  })

  it('merges duplicate pendings when sibling branches converge on one parent', () => {
    const rows = computeGraphLanes([
      { oid: 's1', parents: ['p'] },
      { oid: 's2', parents: ['p'] },
      { oid: 's3', parents: ['p'] },
      { oid: 'x', parents: ['p'] },
      { oid: 'p', parents: [] },
    ])
    expect(rows.map(row => row.laneCount)).toEqual([2, 2, 2, 2, 2])
    expect(rows[0]!.nodeColumn).toBe(0)
    expect(rows[1]!.nodeColumn).toBe(1)
    expect(rows[2]!.nodeColumn).toBe(1)
    expect(rows[3]!.nodeColumn).toBe(1)
    expect(rows[4]!.nodeColumn).toBe(0)
  })
})

describe('mergeRefs', () => {
  it('collapses local and remote refs with the same short name into one badge', () => {
    expect(mergeRefs(['feat/a', 'origin/feat/a'])).toEqual([{ label: 'feat/a', full: 'feat/a · origin/feat/a' }])
  })

  it('keeps distinct branches separate', () => {
    expect(mergeRefs(['feat/a', 'origin/feat/b'])).toEqual([
      { label: 'feat/a', full: 'feat/a' },
      { label: 'feat/b', full: 'origin/feat/b' },
    ])
  })

  it('does not duplicate a repeated ref', () => {
    expect(mergeRefs(['feat/a', 'feat/a'])).toEqual([{ label: 'feat/a', full: 'feat/a' }])
  })
})
