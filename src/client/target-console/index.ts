import { createElement, type ComponentType } from 'react'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { TargetStatusAction } from './TargetStatusAction.js'
import { WorktreeHeroChip } from './WorktreeHeroChip.js'
import { WorktreeReviewStatus } from './WorktreeReviewStatus.js'

export interface TargetConsoleContextLike {
  slots: {
    inject(name: 'conversation.session.header.actions' | 'conversation.input.dock' | 'conversation.hero.options', callback: () => unknown): void
    register(
      descriptor: Record<string, unknown>,
      component: ComponentType<any>,
    ): unknown
  }
}

/**
 * 官方 forge 面板那对「分支按钮 + 新建工作树复选框」的空占位。
 *
 * 同一个 cell（id `forge-panel.worktree`）里更低的 priority 会 shadow 掉官方
 * 注册：slot 只渲染 priority 最低的那一条，所以这里渲染 null 就把那对控件整个
 * 让出来，功能收进本插件的目标胶囊菜单。用 shadow 而不是去停用官方插件，是因为
 * 变更请求、diff、review 都在同一个包里，停用会连带砍掉那些真正的功能。
 */
function HiddenForgeWorktreeOption(): null {
  return null
}

/** Register the Harness-native Session Target contributions against an injected adapter seam. */
export function registerTargetConsole(
  ctx: TargetConsoleContextLike,
  adapter: WorktreeConsoleAdapter,
  services: WorktreeClientServices,
): void {
  const HeaderAction = ({ sessionId }: { sessionId: string }) =>
    createElement(TargetStatusAction, { sessionId, adapter, services })
  const ReviewStatus = ({ session }: { session: { sessionId: string } }) =>
    createElement(WorktreeReviewStatus, { session, adapter, services })
  const HeroChip = ({ session, sessionId }: { session?: { sessionId?: string; blank?: boolean } | null; sessionId?: string }) =>
    createElement(WorktreeHeroChip, { session, sessionId, adapter, services })
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'worktree-target',
    order: 30,
    label: 'Worktree Target',
  }, HeaderAction))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'worktree-review-status',
    order: 10,
  }, ReviewStatus))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'worktree-hero-chip',
    order: 20,
  }, HeroChip))
  // -1 低于官方的默认 0，于是这一个 cell 由本插件渲染（内容为空）。
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options',
    id: 'forge-panel.worktree',
    priority: -1,
  }, HiddenForgeWorktreeOption))
}

export { TargetStatusAction } from './TargetStatusAction.js'
export { WorktreeConsoleView } from './WorktreeConsoleView.js'
export { WorktreeHeroChip } from './WorktreeHeroChip.js'
export { WorktreeManagerModal } from './WorktreeManagerModal.js'
export { WorktreeReviewStatus } from './WorktreeReviewStatus.js'
