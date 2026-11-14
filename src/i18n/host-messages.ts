import type { MessageCatalog, Translator } from './core.js'

/** Host-owned prose. Keys are stable; user data is passed only as interpolation values. */
export const hostMessages = {
  "initialStateChanged": {"zh": "仓库状态已变化，请重新选择独立 Worktree 并确认。没有沿用旧确认创建提交。", "en": "The repository changed. Select Independent Worktree again and confirm the new state. The old confirmation was not used."},
  "initialCommitFailed": {"zh": "无法创建初始版本。请检查 Git 仓库权限和配置后重试。", "en": "Cannot create the initial version. Check Git repository permissions and configuration, then retry."},
  "initialIdentityMissing": {"zh": "Git 提交身份未配置。请在该仓库中设置 git config user.name \"你的名字\" 和 git config user.email \"你的邮箱\" 后重试。插件不会修改身份。", "en": "Git commit identity is not configured. In this repository, set git config user.name \"Your Name\" and git config user.email \"you@example.com\", then retry. The plugin will not change your identity."},
  "branchDoesNotExist": {"zh": "所选分支在这个仓库中不存在。", "en": "The selected branch does not exist in this repository."},
  "projectAlreadyVersioned": {"zh": "项目已有提交历史，无需初始化。", "en": "The project already has commits; initialization is not needed."},
  "initializationUnsupported": {"zh": "当前宿主不支持初始化 Git 仓库。", "en": "This host cannot initialize a Git repository."},
  "initialRepositoryBusy": {"zh": "仓库正在被其他操作使用。请等待操作完成后重试。", "en": "The repository is busy. Wait for the other operation to finish, then retry."},
  "initialConfirmationRequired": {"zh": "当前仓库尚无提交。请通过工作目录菜单确认创建初始版本，或使用本地目录。", "en": "This repository has no commits. Confirm an initial version through the working directory menu, or use the local directory."},
  "initialCreatedWorktreeFailed": {"zh": "初始版本已创建，但独立 Worktree 创建失败。提交已保留，请重新选择独立 Worktree 重试。", "en": "The initial version was created, but Worktree creation failed. The commit is retained. Select Independent Worktree again to retry."},

  "repositoryInspectionFailed": {
    "zh": "无法读取 Git 仓库状态。请检查目录权限、HEAD 和 Git 元数据是否完整，然后重试。",
    "en": "Cannot read the Git repository state. Check directory permissions, HEAD and Git metadata, then retry."
  },
  "sessionNotFound": {
    "zh": "会话不存在: {p0}",
    "en": "Session not found: {p0}"
  },
  "theSessionIsNotAssociatedWithAProject": {
    "zh": "会话尚未关联项目",
    "en": "The Session is not associated with a project."
  },
  "projectNotFound": {
    "zh": "项目不存在: {p0}",
    "en": "Project not found: {p0}"
  },
  "projectRootDirectoryNotFound": {
    "zh": "项目根目录不存在: {p0}",
    "en": "Project root directory not found: {p0}"
  },
  "theSessionWorkspaceNoLongerMatchesItsBoundSession": {
    "zh": "会话当前 Workspace 与已绑定 Session Target 不一致，已停止访问 checkout",
    "en": "The Session Workspace no longer matches its bound Session Target; checkout access has stopped."
  },
  "theSessionHasNotSelectedASessionTarget": {
    "zh": "会话尚未选择 Session Target",
    "en": "The Session has not selected a Session Target."
  },
  "onlyTheOwnerIsolatedSessionCanPrepareAReview": {
    "zh": "只有 owner Isolated 会话可以准备验收",
    "en": "Only the owner Isolated Session can prepare a review."
  },
  "theReviewSummaryCommitMessageOrValidationItemsAre": {
    "zh": "验收摘要、提交信息或验证项目无效",
    "en": "The review summary, commit message, or validation items are invalid."
  },
  "theIsolatedCheckoutRecordDoesNotExist": {
    "zh": "Isolated Checkout 记录不存在",
    "en": "The Isolated Checkout record does not exist."
  },
  "cannotPrepareAReviewInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能准备验收",
    "en": "Cannot prepare a review in the current {p0}/{p1} state."
  },
  "theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs": {
    "zh": "Isolated Checkout 身份无法确认，需要恢复",
    "en": "The Isolated Checkout identity cannot be verified; recovery is required."
  },
  "creationResidueBlocksRecovery": {
    "zh": "创建中断后仍有残留，插件无法确认其身份，因此不会自动删除。确认这些路径没有要保留的内容后手动删除，再重试恢复或放弃: {p0}",
    "en": "The interrupted creation left residue that the plugin cannot identify, so it does not delete it. Confirm nothing there needs keeping, delete these paths by hand, then retry Recover or Discard: {p0}"
  },
  "onlyTheOwnerIsolatedSessionCanSaveACheckpoint": {
    "zh": "只有 owner Isolated 会话可以保存阶段",
    "en": "Only the owner Isolated Session can save a checkpoint."
  },
  "theCheckpointRequestOrCommitMessageIsInvalid": {
    "zh": "Checkpoint 请求或 Commit Message 无效",
    "en": "The Checkpoint request or commit message is invalid."
  },
  "theCheckpointRequestIdIsAlreadyUsedByAnotherState": {
    "zh": "Checkpoint requestId 已被其他状态使用，请刷新",
    "en": "The Checkpoint requestId is already used by another state. Refresh and retry."
  },
  "theSessionTargetHasChangedRefreshAndRetry": {
    "zh": "Session Target 已变化，请刷新后重试",
    "en": "The Session Target has changed. Refresh and retry."
  },
  "cannotSaveACheckpointInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能保存阶段",
    "en": "Cannot save a checkpoint in the current {p0}/{p1} state."
  },
  "theCheckpointReviewOrGenerationHasChangedRefreshAnd": {
    "zh": "Checkpoint Review 或 generation 已变化，请刷新后重试",
    "en": "The Checkpoint Review or generation has changed. Refresh and retry."
  },
  "anotherTaskIsOccupyingThisProjectSLocalAcceptance": {
    "zh": "另一个任务正在占用该项目的 Local 验收槽位",
    "en": "Another task is occupying this project's Local acceptance slot."
  },
  "theCheckpointStateChangedBeforeTheHostCASRefresh": {
    "zh": "Checkpoint 状态在 Host CAS 前发生变化，请刷新后重试",
    "en": "The Checkpoint state changed before the Host CAS. Refresh and retry."
  },
  "previewWasRolledBackButTheCheckoutRecordIs": {
    "zh": "Preview 已撤回，但 Checkout 记录丢失",
    "en": "Preview was rolled back, but the Checkout record is missing."
  },
  "thereIsNoReviewCheckpointToSave": {
    "zh": "当前没有可保存的验收阶段",
    "en": "There is no review checkpoint to save."
  },
  "theCheckpointJournalChangedBeforeRetainingTheInternalRef": {
    "zh": "Checkpoint journal 在保留内部 ref 前发生变化",
    "en": "The Checkpoint journal changed before retaining the internal ref."
  },
  "checkpointWasCreatedButTheCheckoutRecordIsMissing": {
    "zh": "Checkpoint 已创建，但 Checkout 记录丢失",
    "en": "Checkpoint was created, but the Checkout record is missing."
  },
  "onlyTheOwnerIsolatedSessionCanResumeEditing": {
    "zh": "只有 owner Isolated 会话可以恢复编辑",
    "en": "Only the owner Isolated Session can resume editing."
  },
  "theCurrentWorktreeHasNoUnsyncedReviewToResume": {
    "zh": "当前 Worktree 没有可恢复编辑的未同步验收稿",
    "en": "The current Worktree has no unsynced review to resume editing."
  },
  "thisReviewCardIsNoLongerTheCurrentReview": {
    "zh": "该验收卡已不是当前 Review，请刷新后重试",
    "en": "This review card is no longer the current Review. Refresh and retry."
  },
  "theAcceptanceStateChangedBeforeResumingEditingRefreshAnd": {
    "zh": "验收状态在恢复编辑前发生变化，请刷新后重试",
    "en": "The acceptance state changed before resuming editing. Refresh and retry."
  },
  "theConflictRecoveryIdentityChangedBeforeHostCASRun": {
    "zh": "冲突恢复身份在 Host CAS 前已变化，请重新预检",
    "en": "The conflict recovery identity changed before Host CAS. Run preflight again."
  },
  "theAcceptanceStateChangedBeforeConflictRecoveryRefreshAnd": {
    "zh": "验收状态在冲突恢复前发生变化，请刷新后重试",
    "en": "The acceptance state changed before conflict recovery. Refresh and retry."
  },
  "onlyTheOwnerIsolatedSessionCanRequestReviewRegeneration": {
    "zh": "只有 owner Isolated 会话可以请求重新生成验收结果",
    "en": "Only the owner Isolated Session can request review regeneration."
  },
  "theReadOnlyReviewRegenerationIdentityChangedBeforeHost": {
    "zh": "只读验收再生成身份在 Host 授权前已变化",
    "en": "The read-only review regeneration identity changed before Host authorization."
  },
  "theReadyReviewChangedBeforeReadOnlyAuthorization": {
    "zh": "Ready Review 在只读授权前发生变化",
    "en": "The Ready Review changed before read-only authorization."
  },
  "theDetachedPreviewRecoveryProofHasChangedCheckAgain": {
    "zh": "Detached Preview Recovery proof 已变化，请重新检查",
    "en": "The Detached Preview Recovery proof has changed. Check again."
  },
  "theDetachedPreviewChangedBeforeAnalysisAuthorization": {
    "zh": "Detached Preview 在分析授权前发生变化",
    "en": "The Detached Preview changed before analysis authorization."
  },
  "recoveryHandoffRequiresANewPreallocatedSessionID": {
    "zh": "Recovery handoff 必须使用新的预分配 Session ID",
    "en": "Recovery handoff requires a new preallocated Session ID."
  },
  "theRecoveryHandoffSessionIDIsAlreadyInUse": {
    "zh": "Recovery handoff Session ID 已被占用",
    "en": "The Recovery handoff Session ID is already in use."
  },
  "thePreviousDetachedPreviewIdentityHasChanged": {
    "zh": "旧 Detached Preview 身份已变化",
    "en": "The previous Detached Preview identity has changed."
  },
  "theOriginalSourceSessionIsUnavailableNoHandoffWorktree": {
    "zh": "原始 source Session 不可用，未创建 handoff Worktree",
    "en": "The original source Session is unavailable; no handoff Worktree was created."
  },
  "theRecoveryHandoffWorktreeRecordIsMissingAfterCreation": {
    "zh": "Recovery handoff Worktree 创建后记录缺失",
    "en": "The Recovery handoff Worktree record is missing after creation."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform": {
    "zh": "继承 Session Target 的会话不能执行 Apply",
    "en": "A Session that inherited its Session Target cannot perform Apply."
  },
  "localCheckoutDoesNotSupportApply": {
    "zh": "Local Checkout 不支持 Apply",
    "en": "Local Checkout does not support Apply."
  },
  "cannotApplyInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能 Apply",
    "en": "Cannot Apply in the current {p0}/{p1} state."
  },
  "anotherAcceptanceTaskInTheSameProjectIsOccupying": {
    "zh": "同一项目已有验收任务正在占用 Local：{p0}",
    "en": "Another acceptance task in the same project is occupying Local: {p0}"
  },
  "theIsolatedCheckoutStateHasChangedRecoveryIsRequired": {
    "zh": "Isolated Checkout 状态已变化，需要恢复",
    "en": "The Isolated Checkout state has changed; recovery is required."
  },
  "worktreeChangedAfterBeingMarkedReadyForReviewPrepare": {
    "zh": "Worktree 在标记可验收后又发生变化，请重新准备验收",
    "en": "Worktree changed after being marked ready for review. Prepare the review again."
  },
  "worktreeChangesWereWrittenToLocalPreviewThroughApplyWorktree": {
    "zh": "Worktree 修改已通过 ApplyWorktree 写入 Local Preview",
    "en": "Worktree changes were written to Local Preview through ApplyWorktree."
  },
  "choreCommitWorktreeChanges": {
    "zh": "chore: 提交 Worktree 修改",
    "en": "chore: commit Worktree changes"
  },
  "onlyTheOwnerIsolatedSessionCanCheckPreviewRecovery": {
    "zh": "只有 owner Isolated 会话可以检查 Preview 恢复",
    "en": "Only the owner Isolated Session can check Preview recovery."
  },
  "theSessionTargetHasChangedRefreshBeforeCheckingAgain": {
    "zh": "Session Target 已变化，请刷新后重新检查",
    "en": "The Session Target has changed. Refresh before checking again."
  },
  "theCurrentStateIsNotTheSpecifiedDetachedPreview": {
    "zh": "当前并非指定的 detached Preview 恢复状态",
    "en": "The current state is not the specified detached Preview recovery state."
  },
  "theWorktreeIdentityPathOrGitStateCannotCurrently": {
    "zh": "Worktree 身份、路径或 Git 状态暂时无法确认",
    "en": "The Worktree identity, path, or Git state cannot currently be verified."
  },
  "previewRetainedArtifactsAreMissingOrDoNotMatch": {
    "zh": "Preview retained artifacts 缺失或与 receipt 不一致",
    "en": "Preview retained artifacts are missing or do not match the receipt."
  },
  "thePreviewRecoveryStateChangedDuringTheCheck": {
    "zh": "Preview 恢复状态在检查期间发生变化",
    "en": "The Preview recovery state changed during the check."
  },
  "previewRetainedArtifactsChangedDuringTheCheck": {
    "zh": "Preview retained artifacts 在检查期间发生变化",
    "en": "Preview retained artifacts changed during the check."
  },
  "previewRecoveryCheckFailed": {
    "zh": "Preview 恢复检查失败",
    "en": "Preview recovery check failed."
  },
  "onlyTheOwnerIsolatedSessionCanRunSyncPreflight": {
    "zh": "只有 owner Isolated 会话可以执行同步预检",
    "en": "Only the owner Isolated Session can run sync preflight."
  },
  "theSessionTargetHasChangedRefreshBeforeRunningPreflight": {
    "zh": "Session Target 已变化，请刷新后重新预检",
    "en": "The Session Target has changed. Refresh before running preflight again."
  },
  "theCurrentWorktreeIsNotReadyForReview": {
    "zh": "当前 Worktree 尚未处于可验收状态",
    "en": "The current Worktree is not ready for review."
  },
  "theSessionTargetChangedDuringPreflightRefreshAndRetry": {
    "zh": "Session Target 在预检期间发生变化，请刷新后重试",
    "en": "The Session Target changed during preflight. Refresh and retry."
  },
  "worktreeChangedAfterTheReviewWasPreparedRegenerateThe": {
    "zh": "Worktree 在准备验收后发生变化，请重新生成验收结果",
    "en": "Worktree changed after the review was prepared. Regenerate the review."
  },
  "onlyTheOwnerIsolatedSessionCanSyncAReview": {
    "zh": "只有 owner Isolated 会话可以同步验收",
    "en": "Only the owner Isolated Session can sync a review."
  },
  "theAcceptanceStateHasChangedRefreshAndRetry": {
    "zh": "验收状态已变化，请刷新后重试",
    "en": "The acceptance state has changed. Refresh and retry."
  },
  "thereIsNoLocalPreviewToRelease": {
    "zh": "当前没有可解除的 Local Preview",
    "en": "There is no Local Preview to release."
  },
  "thePreviewStateHasChangedRefreshAndRetry": {
    "zh": "Preview 状态已变化，请刷新后重试",
    "en": "The Preview state has changed. Refresh and retry."
  },
  "onlyTheOwnerIsolatedSessionCanRollBackAcceptance": {
    "zh": "只有 owner Isolated 会话可以撤回验收",
    "en": "Only the owner Isolated Session can roll back acceptance."
  },
  "thereIsNoLocalPreviewToRollBack": {
    "zh": "当前没有可撤回的 Local Preview",
    "en": "There is no Local Preview to roll back."
  },
  "thePreviewRecoveryProofHasExpiredOrDoesNot": {
    "zh": "Preview Recovery proof 已过期或不匹配，请重新检查",
    "en": "The Preview Recovery proof has expired or does not match. Check again."
  },
  "onlyTheOwnerIsolatedSessionCanFinalizeTheAcceptance": {
    "zh": "只有 owner Isolated 会话可以完成验收提交",
    "en": "Only the owner Isolated Session can finalize the acceptance commit."
  },
  "thereIsNoLocalPreviewAwaitingAcceptance": {
    "zh": "当前没有等待验收的 Local Preview",
    "en": "There is no Local Preview awaiting acceptance."
  },
  "theCommitWasCreatedButTheCheckoutRecordIs": {
    "zh": "提交已创建，但 Checkout 记录丢失",
    "en": "The commit was created, but the Checkout record is missing."
  },
  "theCommitWasCreatedButSavingTheRetainedWorktree": {
    "zh": "提交已创建，但保留 Worktree 状态写入失败",
    "en": "The commit was created, but saving the retained Worktree state failed."
  },
  "onlyTheOwnerIsolatedSessionCanRetryCleanup": {
    "zh": "只有 owner Isolated 会话可以重试清理",
    "en": "Only the owner Isolated Session can retry cleanup."
  },
  "thereIsNoWorktreeCleanupToRetry": {
    "zh": "当前没有待重试的 Worktree 清理",
    "en": "There is no Worktree cleanup to retry."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform162": {
    "zh": "继承 Session Target 的会话不能执行 Finish",
    "en": "A Session that inherited its Session Target cannot perform Finish."
  },
  "localCheckoutDoesNotSupportFinish": {
    "zh": "Local Checkout 不支持 Finish",
    "en": "Local Checkout does not support Finish."
  },
  "thisReviewCardIsNoLongerTheCurrentReview166": {
    "zh": "该验收卡已不是当前 Review，请刷新并确认最新交付",
    "en": "This review card is no longer the current Review. Refresh and confirm the latest delivery."
  },
  "thisLegacyWorktreeWasWrittenToLocalThroughAn": {
    "zh": "该历史 Worktree 已通过旧版 Apply 写入 Local；为避免遗漏或重复提交，已禁止自动 Finish，请先人工核对 Local 后再清理记录。",
    "en": "This legacy Worktree was written to Local through an older Apply. Automatic Finish is disabled to avoid missing or duplicate commits. Check Local manually before cleaning up the record."
  },
  "cannotFinishDirectlyInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能直接 Finish",
    "en": "Cannot Finish directly in the current {p0}/{p1} state."
  },
  "worktreeChangedAfterReviewPrepareTheReviewAgain": {
    "zh": "Worktree 在验收后又发生变化，请重新准备验收",
    "en": "Worktree changed after review. Prepare the review again."
  },
  "skipLocalAcceptanceAndCommitDirectly": {
    "zh": "跳过 Local 验收并直接提交",
    "en": "Skip Local acceptance and commit directly."
  },
  "theTaskCommitWasCreatedButTheCheckoutRecord": {
    "zh": "任务提交已创建，但 Checkout 记录丢失，需要人工检查",
    "en": "The task commit was created, but the Checkout record is missing. Manual inspection is required."
  },
  "theTaskCommitWasCreatedButSavingTheRetained": {
    "zh": "任务提交已创建，但保留 Worktree 状态写入失败",
    "en": "The task commit was created, but saving the retained Worktree state failed."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform178": {
    "zh": "继承 Session Target 的会话不能执行 Discard",
    "en": "A Session that inherited its Session Target cannot perform Discard."
  },
  "localCheckoutDoesNotSupportDiscard": {
    "zh": "Local Checkout 不支持 Discard",
    "en": "Local Checkout does not support Discard."
  },
  "worktreeDiscardAbortedBecauseTheAbandonedSnapshotFailed": {
    "zh": "放弃前的安全快照创建失败，已中止放弃（未删除任何内容）：{p0}。若确认无需保留，可手动删除该 Worktree 目录后重试。",
    "en": "Creating the pre-discard safety snapshot failed; discard was aborted and nothing was deleted: {p0}. If you are sure nothing needs to be kept, delete the Worktree directory manually and retry."
  },
  "thisWorktreeHasNoAbandonedSnapshotTo": {
    "zh": "该 Worktree 没有可恢复的放弃快照",
    "en": "This Worktree has no abandoned snapshot to restore."
  },
  "theCurrentSessionCheckoutModuleDoesNotSupportAbandonedSnapshotRestore": {
    "zh": "当前 Session Checkout 模块不支持恢复放弃快照",
    "en": "The current Session Checkout module does not support abandoned snapshot restore."
  },
  "theLocalRepositoryIsMissingSoTheAbandoned": {
    "zh": "本地仓库不存在，无法恢复放弃快照",
    "en": "The Local repository is missing, so the abandoned snapshot cannot be restored."
  },
  "localPreviewDriftedIntoDetachedRecoveryToPreserveRecovery": {
    "zh": "Local Preview 已因漂移进入 detached 恢复态；为保留恢复证据，不能删除 Worktree。请先成功撤回 Preview。",
    "en": "Local Preview drifted into detached recovery. To preserve recovery evidence, this Worktree cannot be deleted. Successfully roll back Preview first."
  },
  "thisLegacyWorktreeWasWrittenToLocalThroughAn183": {
    "zh": "该历史 Worktree 已通过旧版 Apply 写入 Local；不会自动 Discard，请先人工核对 Local 的未提交修改。",
    "en": "This legacy Worktree was written to Local through an older Apply. Automatic Discard is disabled. Check Local's uncommitted changes manually first."
  },
  "thisTaskIsPreviewingInLocalSafelyRollBack": {
    "zh": "本任务正在 Local 预览；放弃任务前必须先安全撤回 Preview",
    "en": "This task is previewing in Local. Safely roll back Preview before discarding the task."
  },
  "cannotDiscardInTheCurrentState": {
    "zh": "当前 {p0} 状态不能 Discard",
    "en": "Cannot Discard in the current {p0} state."
  },
  "confirmationWillPermanentlyDeleteCheckpointsNotYetDeliveredTo": {
    "zh": "；确认后会永久删除 {p0} 个尚未交付到 Local 的阶段",
    "en": "; confirmation will permanently delete {p0} checkpoints not yet delivered to Local"
  },
  "theIsolatedCheckoutHasUncommittedChangesUndeliveredCheckpointsOr": {
    "zh": "Isolated Checkout 含未提交修改、未交付阶段或状态无法确认，需要明确确认{p0}",
    "en": "The Isolated Checkout has uncommitted changes, undelivered checkpoints, or an unverified state. Explicit confirmation is required{p0}"
  },
  "failedToDeleteTheManagedCheckout": {
    "zh": "删除 managed checkout 失败",
    "en": "Failed to delete the managed checkout."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform192": {
    "zh": "继承 Session Target 的会话不能执行 Recover",
    "en": "A Session that inherited its Session Target cannot perform Recover."
  },
  "localCheckoutDoesNotSupportRecover": {
    "zh": "Local Checkout 不支持 Recover",
    "en": "Local Checkout does not support Recover."
  },
  "cannotSafelyDetermineWhetherApplyModifiedLocalItWill": {
    "zh": "Apply 是否已修改 Local 无法安全确认；不会自动重试或猜测成功",
    "en": "Cannot safely determine whether Apply modified Local. It will not retry automatically or assume success."
  },
  "theIsolatedCheckoutIsMissingOnlyAnExplicitDiscard": {
    "zh": "Isolated Checkout 缺失，只能由 owner 明确 Discard 收口",
    "en": "The Isolated Checkout is missing. Only an explicit Discard by its owner can close it."
  },
  "thisWorktreeHasAlreadyReachedATerminalDeliveryState": {
    "zh": "该 Worktree 已交付或已放弃，处于终态，无法 Recover。",
    "en": "This Worktree already reached a terminal delivery state; Recover is not available."
  },
  "theIsolatedCheckoutPathGitIdentityProjectHEADOr": {
    "zh": "Isolated Checkout 的路径、Git 身份、项目、HEAD 或状态无法完整确认",
    "en": "The Isolated Checkout path, Git identity, project, HEAD, or state cannot be fully verified."
  },
  "deletedAgentSession": {
    "zh": "已删除的 Agent 会话",
    "en": "Deleted Agent Session"
  },
  "theCurrentIterationIsStillBeingEditedAndHas": {
    "zh": "当前轮次仍在修改，尚未形成可清理的交付环境。",
    "en": "The current iteration is still being edited and has no delivered environment to clean up."
  },
  "theCurrentIterationIsAwaitingAcceptanceAndCannotBe": {
    "zh": "当前轮次正在等待验收，不能清理。",
    "en": "The current iteration is awaiting acceptance and cannot be cleaned up."
  },
  "localPreviewHasNotBeenSafelyResolvedAndCannot": {
    "zh": "Local Preview 尚未完成安全收口，不能清理。",
    "en": "Local Preview has not been safely resolved and cannot be cleaned up."
  },
  "worktreeHasBeenDeliveredAndReleasedFromManagementNo": {
    "zh": "Worktree 已交付并解除管理，无需再次清理。",
    "en": "Worktree has been delivered and released from management. No further cleanup is needed."
  },
  "theLocalCheckoutIdentityCannotBeVerifiedThisIteration": {
    "zh": "Local checkout identity 无法验证，不能证明本轮交付仍存在。",
    "en": "The Local checkout identity cannot be verified; this iteration's delivery cannot be proven to exist."
  },
  "thisIterationSDeliveryCommitIsNoLongerIn": {
    "zh": "本轮交付 commit 已不在 Local 历史中，不能清理环境。",
    "en": "This iteration's delivery commit is no longer in Local history. The environment cannot be cleaned up."
  },
  "cannotVerifyWhetherThisIterationSDeliveryCommitIs": {
    "zh": "无法验证本轮交付 commit 是否仍在 Local 历史中。",
    "en": "Cannot verify whether this iteration's delivery commit is still in Local history."
  },
  "theCleanupDirectoryIdentityCannotBeReverifiedTheEnvironment": {
    "zh": "清理目录身份无法重新验证，已保留环境。",
    "en": "The cleanup directory identity cannot be reverified. The environment was preserved."
  },
  "theWorktreeCheckoutIdentityCannotBeVerifiedTheEnvironment": {
    "zh": "Worktree checkout identity 无法验证，已保留环境。",
    "en": "The Worktree checkout identity cannot be verified. The environment was preserved."
  },
  "newChangesWereDetectedAfterCommitOrRetentionBulk": {
    "zh": "提交或保留后检测到新增修改，不能批量清理。",
    "en": "New changes were detected after commit or retention. Bulk cleanup is not allowed."
  },
  "cannotProveTheCurrentWorktreeStateIsSafeThe": {
    "zh": "无法证明 Worktree 当前状态安全，已保留环境。",
    "en": "Cannot prove the current Worktree state is safe. The environment was preserved."
  },
  "thePreviousCleanupDidNotFinishRevalidateAndRetry": {
    "zh": "上次清理未完成，可重新校验后重试。",
    "en": "The previous cleanup did not finish. Revalidate and retry."
  },
  "retainedManuallyAtTheUserSRequest": {
    "zh": "按用户选择手动保留。",
    "en": "Retained manually at the user's request."
  },
  "theRetentionPeriodHasNotExpired": {
    "zh": "保留期限尚未到期。",
    "en": "The retention period has not expired."
  },
  "readOnlySafetyInspectionPassedCleanupIsAvailable": {
    "zh": "已通过只读安全巡检，可以清理。",
    "en": "Read-only safety inspection passed. Cleanup is available."
  },
  "theWorktreeRevisionHasChangedCleanupWasNotPerformed": {
    "zh": "Worktree revision 已变化，未执行清理。",
    "en": "The Worktree revision has changed. Cleanup was not performed."
  },
  "worktreeChangedBeforeCleanupCleanupWasNotPerformed": {
    "zh": "Worktree 在清理前发生变化，未执行清理。",
    "en": "Worktree changed before cleanup. Cleanup was not performed."
  },
  "theWorktreeRecordDoesNotExist": {
    "zh": "Worktree 记录不存在",
    "en": "The Worktree record does not exist."
  },
  "theCurrentSessionIsNotAllowedToManageThis": {
    "zh": "当前 Session 无权管理该 Worktree",
    "en": "The current Session is not allowed to manage this Worktree."
  },
  "theOwnerSessionHasTakenOverThisWorktreeOnly": {
    "zh": "Owner Session 已接管该 Worktree，只有 owner 可以管理",
    "en": "The owner Session has taken over this Worktree. Only the owner can manage it."
  },
  "theCurrentSessionAndWorktreeDoNotBelongTo": {
    "zh": "当前 Session 与 Worktree 不属于同一原始项目",
    "en": "The current Session and Worktree do not belong to the same original project."
  },
  "theWorktreeStateHasChangedRefreshAndRetry": {
    "zh": "Worktree 状态已变化，请刷新后重试",
    "en": "The Worktree state has changed. Refresh and retry."
  },
  "onlyRetainedFrozenWorktreesCanHaveTheirRetentionPeriod": {
    "zh": "只有已保留的冻结 Worktree 可以调整保留期限",
    "en": "Only retained, frozen Worktrees can have their retention period changed."
  },
  "theCurrentWorktreeIsNotInACleanableState": {
    "zh": "当前 Worktree 不处于可清理状态",
    "en": "The current Worktree is not in a cleanable state."
  },
  "theWorktreeDirectoryNoLongerExists": {
    "zh": "Worktree 目录已不存在",
    "en": "The Worktree directory no longer exists."
  },
  "theWorktreeDirectoryIdentityCannotBeVerified": {
    "zh": "Worktree 目录身份无法验证",
    "en": "The Worktree directory identity cannot be verified."
  },
  "onlyADeliveredIsolatedSessionCanBeginTheNext": {
    "zh": "只有已交付的 Isolated Session 可以开始下一轮",
    "en": "Only a delivered Isolated Session can begin the next iteration."
  },
  "thePreviousIterationSWorktreeRecordDoesNotExist": {
    "zh": "上一轮 Worktree 记录不存在",
    "en": "The previous iteration's Worktree record does not exist."
  },
  "onlyTheOwnerSessionCanManageThisWorktree": {
    "zh": "只有 owner Session 可以管理该 Worktree 的保留策略与清理",
    "en": "Only the owner Session can manage this Worktree's retention and cleanup."
  },
  "onlyTheOwnerSessionCanBeginTheNextIteration": {
    "zh": "只有 owner Session 可以开始下一轮",
    "en": "Only the owner Session can begin the next iteration."
  },
  "theWorktreeStateHasChangedRefreshBeforeBeginningThe": {
    "zh": "Worktree 状态已变化，请刷新后再开始下一轮",
    "en": "The Worktree state has changed. Refresh before beginning the next iteration."
  },
  "onlyADeliveredStateWithSuccessfulCleanupCanBegin": {
    "zh": "只有已成功清理的交付状态可以开始下一轮",
    "en": "Only a delivered state with successful cleanup can begin the next iteration."
  },
  "theCurrentSessionIsNotAssociatedWithAWorkspace": {
    "zh": "当前 Session 尚未关联 Workspace",
    "en": "The current Session is not associated with a Workspace."
  },
  "theCurrentSessionSImmutableCwdDoesNotMatch": {
    "zh": "当前 Session 的 immutable cwd 与上一轮 Worktree 不一致",
    "en": "The current Session's immutable cwd does not match the previous iteration's Worktree."
  },
  "thePreviousIterationSWorktreePathHasReappearedUnknown": {
    "zh": "上一轮 Worktree 路径已重新出现，拒绝覆盖未知内容",
    "en": "The previous iteration's Worktree path has reappeared. Unknown content will not be overwritten."
  },
  "theOriginalLocalProjectIsUnavailableTheNextIteration": {
    "zh": "原始 Local 项目已不可用，不能开始下一轮",
    "en": "The original Local project is unavailable. The next iteration cannot begin."
  },
  "theOriginalLocalProjectIdentityHasChanged": {
    "zh": "原始 Local 项目身份已变化",
    "en": "The original Local project identity has changed."
  },
  "theOriginalLocalGitIdentityHasChanged": {
    "zh": "原始 Local Git 身份已变化",
    "en": "The original Local Git identity has changed."
  },
  "theProjectRootIsNotInsideItsGitCheckout": {
    "zh": "项目根目录不在其 Git checkout 内",
    "en": "The project root is not inside its Git checkout."
  },
  "thePreviousIterationSManagedProjectPathCannotBe": {
    "zh": "上一轮 managed project 路径无法从 Local 身份重建",
    "en": "The previous iteration's managed project path cannot be reconstructed from the Local identity."
  },
  "theWorktreeContainerIsNotATrustedDirectory": {
    "zh": "Worktree 容器不是可信目录",
    "en": "The Worktree container is not a trusted directory."
  },
  "theWorktreeContainerPathHasBeenRedirected": {
    "zh": "Worktree 容器路径已被重定向",
    "en": "The Worktree container path has been redirected."
  },
  "theNextIterationSCheckoutGitIdentityDoesNot": {
    "zh": "下一轮 checkout 的 Git 身份不匹配",
    "en": "The next iteration's checkout Git identity does not match."
  },
  "theStateChangedWhileCreatingTheNextIterationS": {
    "zh": "下一轮 Worktree 创建期间状态已变化",
    "en": "The state changed while creating the next iteration's Worktree."
  },
  "creatingTheNextIterationSWorktreeFailedAndIts": {
    "zh": "下一轮 Worktree 创建失败且残余目录包含未知内容，已保留现场",
    "en": "Creating the next iteration's Worktree failed and its remaining directory contains unknown content. The environment was preserved."
  },
  "theSessionIsAlreadyBoundToASessionTarget": {
    "zh": "会话已经绑定 Session Target，不能切换",
    "en": "The Session is already bound to a Session Target and cannot switch."
  },
  "theWorktreeHasNotBeenDeliveredToLocalYet": {
    "zh": "这个 Worktree 还没有交付到 Local，不能回到 Local（请先交付或放弃）",
    "en": "This Worktree has not been delivered to Local yet, so it cannot return to Local. Deliver or discard it first."
  },
  "aNonGitProjectCannotCreateAnIsolatedCheckout": {
    "zh": "非 Git 项目不能创建 Isolated Checkout",
    "en": "A non-Git project cannot create an Isolated Checkout."
  },
  "theProjectRootIsNotAGitRepositoryAndTheLedgerReferencesStaleRoots": {
    "zh": "项目根目录不是 Git 仓库（{p0}）。台账中仍有记录指向已不存在的路径（{p1}）——项目可能已被移动：请在仓库新位置打开会话，失效的 Worktree 台账会在绑定时自动修复。",
    "en": "The project root is not a Git repository ({p0}). The ledger still references paths that no longer exist ({p1}) — the project was likely moved. Reopen the session from the repository's new location; stale Worktree ledger entries repair automatically on bind."
  },
  "theFallbackWorktreeContainerIsNotATrustedDirectory": {
    "zh": "Worktree 容器 {p0} 不是可信目录：它不是普通目录，或内含本插件未登记的内容。未创建或修改任何 checkout；确认该目录归属后清空或移走它再重试。",
    "en": "The Worktree container {p0} is not a trusted directory: it is not a plain directory, or it holds content this plugin does not manage. No checkout was created or modified. Confirm who owns it, then empty or move it before retrying."
  },
  "theWorktreeContainerCouldNotBeCreatedOrAccessed": {
    "zh": "无法创建或访问 Worktree 容器 {p0}（{p1}）。这通常是环境问题：目录 ACL 拒绝、沙箱/杀软拦截或路径不可写，而非内容不可信。请检查该目录的文件权限后重试；未创建或修改任何 checkout。",
    "en": "The Worktree container {p0} could not be created or accessed ({p1}). This is usually environmental: the directory's file permissions deny access, or sandbox/antivirus software blocked the write — not untrusted content. Check the directory's file permissions and retry. No checkout was created or modified."
  },
  "allWorktreeCheckoutIdentityPathsAlreadyExistUnknownDirectories": {
    "zh": "Worktree Checkout identity 路径均已存在，拒绝覆盖未知目录",
    "en": "All Worktree Checkout identity paths already exist. Unknown directories will not be overwritten."
  },
  "theNewCheckoutSGitCommonDirectoryDoesNot": {
    "zh": "新建 checkout 的 Git common dir 不匹配",
    "en": "The new checkout's Git common directory does not match."
  },
  "worktreeCreationFailedAndTheRemainingDirectoryContainsUnknown": {
    "zh": "Worktree 创建失败且残余目录包含未知内容，已保留现场，请查看原因或改用新会话",
    "en": "Worktree creation failed and the remaining directory contains unknown content. The environment was preserved. Check the cause or use a new Session."
  },
  "worktreeCreationFailedTheRemainingDirectoryWasSafelyCleaned": {
    "zh": "Worktree 创建失败，已安全清理残余目录，可直接重试",
    "en": "Worktree creation failed. The remaining directory was safely cleaned up; you can retry."
  },
  "anIsolatedTargetRequiresASeparatePreallocatedSessionID": {
    "zh": "Isolated Target 必须使用独立的预分配 Session ID",
    "en": "An Isolated Target requires a separate preallocated Session ID."
  },
  "theTargetSessionIDIsAlreadyUsedByAnother": {
    "zh": "目标 Session ID 已被其他 Workspace 使用",
    "en": "The target Session ID is already used by another Workspace."
  },
  "aNewIsolatedTargetCanOnlyBeCreatedFrom": {
    "zh": "只能从 Local Session 创建新的 Isolated Target",
    "en": "A new Isolated Target can only be created from a Local Session."
  },
  "theIsolatedTargetRecordIsMissingAfterCreation": {
    "zh": "Isolated Target 创建后记录缺失",
    "en": "The Isolated Target record is missing after creation."
  },
  "gitExitedWithCode": {
    "zh": "git 命令退出码为 {p0}",
    "en": "git exited with code {p0}"
  },
  "gitCommandTimedOut": {
    "zh": "git 命令超时：{p0}",
    "en": "git command timed out: {p0}"
  },
  "theLocalBranchHasChangedPreviewCannotBeRolled": {
    "zh": "Local branch 已变化，不能自动撤回 Preview",
    "en": "The Local branch has changed. Preview cannot be rolled back automatically."
  },
  "localHEADIsNotASafeFastForwardFrom": {
    "zh": "Local HEAD 不是 Preview 基线的安全快进，不能自动撤回",
    "en": "Local HEAD is not a safe fast-forward from the Preview base. Automatic rollback is not allowed."
  },
  "newLocalCommitsConflictWithPrePreviewLocalChanges": {
    "zh": "Local 新提交与 Preview 前的本地修改冲突，无法安全撤回：{p0}",
    "en": "New Local commits conflict with pre-Preview local changes. Safe rollback is not possible: {p0}"
  },
  "newLocalCommitsConflictWithThePreviewTaskChanges": {
    "zh": "Local 新提交与 Preview 任务增量冲突，无法安全撤回：{p0}",
    "en": "New Local commits conflict with the Preview task changes. Safe rollback is not possible: {p0}"
  },
  "newLocalCommitsAlreadyContainSomeOrAllPreview": {
    "zh": "Local 新提交已经包含部分或全部 Preview 增量，不能通过撤回工作区改动来改写已提交历史",
    "en": "New Local commits already contain some or all Preview changes. Rolling back workspace changes cannot rewrite committed history."
  },
  "localHasAdditionalChangesInThePreviewAreaSafe": {
    "zh": "Local 在 Preview 区域出现额外修改，无法安全撤回：{p0}",
    "en": "Local has additional changes in the Preview area. Safe rollback is not possible: {p0}"
  },
  "localIsNotOnANormalBranchATask": {
    "zh": "Local 当前不是普通分支，不能自动创建任务提交",
    "en": "Local is not on a normal branch. A task commit cannot be created automatically."
  },
  "theLocalBranchHasChangedThePreviewCommitCannot": {
    "zh": "Local branch 已变化，不能完成 Preview 提交",
    "en": "The Local branch has changed. The Preview commit cannot be finalized."
  },
  "localHEADIsNotASafeFastForwardFrom281": {
    "zh": "Local HEAD 不是 Preview 基线的安全快进，不能完成 Preview 提交",
    "en": "Local HEAD is not a safe fast-forward from the Preview base. The Preview commit cannot be finalized."
  },
  "localHasAdditionalChangesInThePreviewAreaA": {
    "zh": "Local 在 Preview 区域出现额外修改，无法可靠提交：{p0}",
    "en": "Local has additional changes in the Preview area. A reliable commit is not possible: {p0}"
  },
  "previewTaskChangesCannotBeReliablySeparatedFromThe": {
    "zh": "Preview 任务增量无法与最新 Local HEAD 可靠拆分：{p0}",
    "en": "Preview task changes cannot be reliably separated from the latest Local HEAD: {p0}"
  },
  "previewTaskChangesAreAlreadyInLocalHEADNo": {
    "zh": "Preview 任务增量已经进入 Local HEAD；不会创建重复或空提交",
    "en": "Preview task changes are already in Local HEAD. No duplicate or empty commit will be created."
  },
  "thePreviewCommitCannotBeReliablySeparatedFromLocal": {
    "zh": "Preview 提交与 Local staged 修改无法可靠分离：{p0}",
    "en": "The Preview commit cannot be reliably separated from Local staged changes: {p0}"
  },
  "invalidCheckpointInput": {
    "zh": "Checkpoint 输入无效",
    "en": "Invalid Checkpoint input."
  },
  "theCheckpointProjectDirectoryDoesNotBelongToThe": {
    "zh": "Checkpoint 项目目录不属于当前 Worktree",
    "en": "The Checkpoint project directory does not belong to the current Worktree."
  },
  "checkpointCanOnlyWriteToADetachedManagedWorktree": {
    "zh": "Checkpoint 只允许写入 detached managed Worktree",
    "en": "Checkpoint can only write to a detached managed Worktree."
  },
  "worktreeChangedAfterPreparingTheReviewTheCheckpointCannot": {
    "zh": "Worktree 在准备验收后发生变化，不能保存阶段",
    "en": "Worktree changed after preparing the review. The checkpoint cannot be saved."
  },
  "worktreeContainsChangesOutsideTheProjectRootTheCheckpoint": {
    "zh": "Worktree 包含项目根目录外的变更，不能保存阶段",
    "en": "Worktree contains changes outside the project root. The checkpoint cannot be saved."
  },
  "theCurrentCheckpointHasNoNewChangesToSave": {
    "zh": "当前阶段没有可保存的新修改",
    "en": "The current checkpoint has no new changes to save."
  },
  "worktreeChangedBeforeSavingTheCheckpointPrepareTheReview": {
    "zh": "Worktree 在保存阶段前发生变化，请重新准备验收",
    "en": "Worktree changed before saving the checkpoint. Prepare the review again."
  },
  "checkpointIndexWriteFailedAndHEADCouldNotBe": {
    "zh": "Checkpoint index 写入失败且 HEAD 无法回滚：{p0}；{p1}",
    "en": "Checkpoint index write failed and HEAD could not be rolled back: {p0}; {p1}"
  },
  "checkpointWriteFailedAndWasRolledBack": {
    "zh": "Checkpoint 写入失败，已回滚：{p0}",
    "en": "Checkpoint write failed and was rolled back: {p0}"
  },
  "checkpointWasWrittenButWorktreeDidNotReachA": {
    "zh": "Checkpoint 已写入，但 Worktree 未收敛到 clean 状态",
    "en": "Checkpoint was written, but Worktree did not reach a clean state."
  },
  "cannotVerifyTheCheckpointAfterWritingTheEnvironmentMust": {
    "zh": "Checkpoint 写后无法完成验证，需要保留现场确认：{p0}",
    "en": "Cannot verify the Checkpoint after writing. The environment must be preserved for inspection: {p0}"
  },
  "anotherGitOperationIsUpdatingTheWorktreeIndexRetry": {
    "zh": "Worktree index 正在被其他 Git 操作更新，请重试",
    "en": "Another Git operation is updating the Worktree index. Retry later."
  },
  "invalidCheckpointRecoveryOID": {
    "zh": "Checkpoint 恢复 OID 无效",
    "en": "Invalid Checkpoint recovery OID."
  },
  "worktreeNoLongerHasADetachedHEAD": {
    "zh": "Worktree 已不再是 detached HEAD",
    "en": "Worktree no longer has a detached HEAD."
  },
  "cannotProveTheRemainingIndexLockBelongsToThe": {
    "zh": "遗留 index.lock 无法证明属于当前 Checkpoint，已保留现场",
    "en": "Cannot prove the remaining index.lock belongs to the current Checkpoint. The environment was preserved."
  },
  "worktreeHEADDoesNotMatchTheCheckpointBeingRecovered": {
    "zh": "Worktree HEAD 与待恢复 Checkpoint 不一致",
    "en": "Worktree HEAD does not match the Checkpoint being recovered."
  },
  "worktreeHasNewChangesAfterCheckpointInterruptionTheIndex": {
    "zh": "Worktree 在 Checkpoint 中断后出现新修改，不能自动恢复 index",
    "en": "Worktree has new changes after Checkpoint interruption. The index cannot be recovered automatically."
  },
  "theIndexHasNewStagedChangesAfterCheckpointInterruption": {
    "zh": "Checkpoint 中断后 index 出现新 staged 修改，不能自动覆盖",
    "en": "The index has new staged changes after Checkpoint interruption. Automatic overwrite is not allowed."
  },
  "theRemainingIndexLockDoesNotMatchTheCheckpoint": {
    "zh": "遗留 index.lock 与 Checkpoint 目标不一致，已保留现场",
    "en": "The remaining index.lock does not match the Checkpoint target. The environment was preserved."
  },
  "worktreeOrItsIndexChangedBeforeAcquiringTheCheckpoint": {
    "zh": "Checkpoint 恢复加锁前 Worktree 或 index 已变化",
    "en": "Worktree or its index changed before acquiring the Checkpoint recovery lock."
  },
  "worktreeIsStillNotCleanAfterCheckpointIndexRecovery": {
    "zh": "Checkpoint index 恢复后仍未收敛到 clean 状态",
    "en": "Worktree is still not clean after Checkpoint index recovery."
  },
  "invalidSessionBaseOIDFormat": {
    "zh": "Session Base OID 格式无效",
    "en": "Invalid Session Base OID format."
  },
  "localAndIsolatedDoNotBelongToTheSame": {
    "zh": "Local 与 Isolated 不属于同一 Git 仓库",
    "en": "Local and Isolated do not belong to the same Git repository."
  },
  "theLocalAndIsolatedProjectSubdirectoriesDoNotMatch": {
    "zh": "Local 与 Isolated 的项目子目录不一致",
    "en": "The Local and Isolated project subdirectories do not match."
  },
  "isolatedContainsChangesOutsideTheProjectRootAReview": {
    "zh": "Isolated 包含项目根目录外的变更，不能准备验收",
    "en": "Isolated contains changes outside the project root. A review cannot be prepared."
  },
  "isolatedContainsChangesOutsideTheProjectRootApplyWas": {
    "zh": "Isolated 包含项目根目录外的变更，已拒绝 Apply",
    "en": "Isolated contains changes outside the project root. Apply was rejected."
  },
  "theApplyPlanIsMissingAlreadyUsedOrModified": {
    "zh": "Apply plan 不存在、已使用或已被修改",
    "en": "The Apply plan is missing, already used, or modified."
  },
  "theApplyPlanSGitRepositoryIdentityHasChanged": {
    "zh": "Apply plan 的 Git 仓库身份已变化",
    "en": "The Apply plan's Git repository identity has changed."
  },
  "localChangedAfterPlanningRecalculateThePlan": {
    "zh": "Local 在 plan 后发生变化，请重新计算",
    "en": "Local changed after planning. Recalculate the plan."
  },
  "isolatedChangedAfterPlanningRecalculateThePlan": {
    "zh": "Isolated 在 plan 后发生变化，请重新计算",
    "en": "Isolated changed after planning. Recalculate the plan."
  },
  "localChangedBeforeApplyWroteItsChangesRecalculateThe": {
    "zh": "Local 在 Apply 写入前发生变化，请重新计算",
    "en": "Local changed before Apply wrote its changes. Recalculate the plan."
  },
  "thePreviewPlanIsMissingAlreadyUsedOrModified": {
    "zh": "Preview plan 不存在、已使用或已被修改",
    "en": "The Preview plan is missing, already used, or modified."
  },
  "invalidPreviewIdentity": {
    "zh": "Preview identity 无效",
    "en": "Invalid Preview identity."
  },
  "thePreviewPlanSGitRepositoryIdentityHasChanged": {
    "zh": "Preview plan 的 Git 仓库身份已变化",
    "en": "The Preview plan's Git repository identity has changed."
  },
  "thePersistentPreviewSnapshotDoesNotMatchTheReviewed": {
    "zh": "Preview 持久快照与审核 plan 不一致",
    "en": "The persistent Preview snapshot does not match the reviewed plan."
  },
  "localChangedBeforePreviewWroteItsChangesRecalculateThe": {
    "zh": "Local 在 Preview 写入前发生变化，请重新计算",
    "en": "Local changed before Preview wrote its changes. Recalculate the plan."
  },
  "theLocalSnapshotAfterPreviewDoesNotMatchThe": {
    "zh": "Preview 写入后的 Local snapshot 与准备结果不一致，需要恢复确认",
    "en": "The Local snapshot after Preview does not match the prepared result. Recovery confirmation is required."
  },
  "localChangedBeforePreviewRollbackRetry": {
    "zh": "Local 在撤回 Preview 前发生变化，请重试",
    "en": "Local changed before Preview rollback. Retry."
  },
  "cannotVerifyAfterWritingPreviewRollbackTheEnvironmentMust": {
    "zh": "Preview 撤回写后无法完成验证，需要保留现场确认：{p0}",
    "en": "Cannot verify after writing Preview rollback. The environment must be preserved for inspection: {p0}"
  },
  "theLocalSnapshotAfterPreviewRollbackDoesNotMatch": {
    "zh": "Preview 撤回后的 Local snapshot 与安全恢复结果不一致，需要保留现场确认",
    "en": "The Local snapshot after Preview rollback does not match the safe recovery result. The environment must be preserved for inspection."
  },
  "localChangedBeforeFinalizingPreviewRetry": {
    "zh": "Local 在完成 Preview 前发生变化，请重试",
    "en": "Local changed before finalizing Preview. Retry."
  },
  "thePreviewTaskCommitTreeDoesNotMatchThe": {
    "zh": "Preview 任务提交 tree 与恢复评估不一致",
    "en": "The Preview task commit tree does not match the recovery assessment."
  },
  "thePreviewFinalIndexTreeDoesNotMatchThe": {
    "zh": "Preview 最终 index tree 与恢复评估不一致",
    "en": "The Preview final index tree does not match the recovery assessment."
  },
  "anotherGitOperationIsUpdatingTheLocalIndexRetry": {
    "zh": "Local index 正在被其他 Git 操作更新，请重试",
    "en": "Another Git operation is updating the Local index. Retry later."
  },
  "localChangedBeforeThePreviewCommitWasWrittenRetry": {
    "zh": "Local 在 Preview 提交写入前发生变化，请重试",
    "en": "Local changed before the Preview commit was written. Retry."
  },
  "previewCommitVerificationFailedAfterWriting": {
    "zh": "Preview 提交写后验证失败",
    "en": "Preview commit verification failed after writing."
  },
  "indexLocalIndexChangedAfterPreviewWroteItsChanges": {
    "zh": "index: Local index 在 Preview 写入后发生变化，拒绝覆盖并发 staged 状态",
    "en": "index: Local index changed after Preview wrote its changes. Concurrent staged state will not be overwritten."
  },
  "refVerifiableIndexCompensationEvidenceIsMissingPartialRollback": {
    "zh": "ref: 缺少可验证的 index 补偿证据，拒绝部分回滚",
    "en": "ref: Verifiable index compensation evidence is missing. Partial rollback was rejected."
  },
  "thePreviewCommitWriteCouldNotBeVerifiedAnd": {
    "zh": "Preview 提交写入未能验证，已完整回滚：{p0}",
    "en": "The Preview commit write could not be verified and was fully rolled back: {p0}"
  },
  "cannotProveSuccessOrCompleteRollbackAfterWritingThe": {
    "zh": "Preview 提交写入后无法证明成功或完整回滚，需要保留现场确认（备份 index 文件：{p2}）：{p0}{p1}",
    "en": "Cannot prove success or complete rollback after writing the Preview commit. The environment must be preserved for inspection (backup index file: {p2}): {p0}{p1}"
  },
  "theFinishPlanIsMissingAlreadyUsedOrModified": {
    "zh": "Finish plan 不存在、已使用或已被修改",
    "en": "The Finish plan is missing, already used, or modified."
  },
  "theFinishPlanSGitRepositoryIdentityHasChanged": {
    "zh": "Finish plan 的 Git 仓库身份已变化",
    "en": "The Finish plan's Git repository identity has changed."
  },
  "finishRevalidationFoundConflictsInconsistentWithTheReviewedPlan": {
    "zh": "Finish 复验得到与已审核 plan 不一致的冲突",
    "en": "Finish revalidation found conflicts inconsistent with the reviewed plan."
  },
  "theFileSetChangedDuringFinishRevalidation": {
    "zh": "Finish 复验的文件集合已变化",
    "en": "The file set changed during Finish revalidation."
  },
  "localChangedBeforeFinishRecalculateThePlan": {
    "zh": "Local 在 Finish 前发生变化，请重新计算",
    "en": "Local changed before Finish. Recalculate the plan."
  },
  "taskChangesCannotBeReliablySeparatedFromExistingLocal": {
    "zh": "任务增量无法与 Local 原有修改可靠拆分：{p0}",
    "en": "Task changes cannot be reliably separated from existing Local changes: {p0}"
  },
  "theTaskCommitCannotBeReliablySeparatedFromExisting": {
    "zh": "任务提交与 Local 原有 staged 修改无法可靠分离：{p0}",
    "en": "The task commit cannot be reliably separated from existing Local staged changes: {p0}"
  },
  "localChangedBeforeFinishWroteItsChangesRecalculateThe": {
    "zh": "Local 在 Finish 写入前发生变化，请重新计算",
    "en": "Local changed before Finish wrote its changes. Recalculate the plan."
  },
  "finishWriteFailedAndCompleteRollbackCouldNotBe": {
    "zh": "Finish 写入失败且无法证明完整回滚：{p0}；{p1}",
    "en": "Finish write failed and complete rollback could not be proven: {p0}; {p1}"
  },
  "finishWriteFailedAndWasRolledBack": {
    "zh": "Finish 写入失败，已回滚：{p0}",
    "en": "Finish write failed and was rolled back: {p0}"
  },
  "gitOperationFailed": {
    "zh": "Git 操作失败（{p0}）：{p1}",
    "en": "Git operation failed ({p0}): {p1}"
  },
  "unknownGitError": {
    "zh": "未知 Git 错误",
    "en": "Unknown Git error"
  },
  "worktreeToolsCanOnlyBeCalledInADSH": {
    "zh": "worktree 工具只能在 DSH Agent 会话中调用",
    "en": "Worktree tools can only be called in a DSH Agent Session."
  },
  "reserveAUniqueManagedGitWorktreeAndADistinct": {
    "zh": "为当前会话创建托管 Git Worktree 并把本会话 cwd 切进去（与官方 create_worktree 一致），无需打开新会话。返回后直接在新目录继续工作，相对路径与文件工具都落在 Worktree 内。若返回 cwdSelected 为 false，说明宿主未挂载 workingDirectory 服务，此时改用 Authoritative cwd 的绝对路径继续工作。",
    "en": "Create a managed Git worktree for this Session and move this Session cwd into it (official create_worktree parity); no separate Session is needed. Keep working in the returned directory: relative paths and file tools resolve inside the Worktree. When cwdSelected is false the host did not mount the workingDirectory service — use absolute paths under the Authoritative cwd instead."
  },
  "createIsolatedSessionTarget": {
    "zh": "创建隔离会话目标",
    "en": "Create isolated Session Target"
  },
  "optionalLocalBranchWhoseCurrentTipBecomesThe": {
    "zh": "可选：以该本地分支的当前提交为起点创建 Worktree（不传则从当前 HEAD 开始）。",
    "en": "Optional: start the worktree from this local branch's current tip instead of HEAD."
  },
  "listManagedWorktreesVisibleToTheCurrentSessionResults": {
    "zh": "列出当前会话可见的托管 Worktree。结果仅限原始项目内由此会话拥有或创建的 Worktree。",
    "en": "List managed worktrees visible to the current Session. Results are scoped to the original project and to worktrees this Session owns or created."
  },
  "listManagedWorktrees": {
    "zh": "列出托管 Worktree",
    "en": "List managed worktrees"
  },
  "whenTheCurrentIsolatedSessionIsReadyForReview": {
    "zh": "当前 Isolated Session 处于尚未同步 Local 的 Ready for Review，且用户提出新的代码或文件修改时，必须先自动调用本工具使旧 Review 失效并恢复同一轮 Working，然后直接继续执行请求。纯讨论、问答或补充信息不要调用；不要要求用户点击恢复编辑，也不要先同步 Local。",
    "en": "When the current Isolated Session is Ready for Review but not yet synced to Local, and the user requests new code or file changes, automatically call this tool first to invalidate the old Review and resume Working in the same iteration, then continue the request directly. Do not call it for discussion, questions, or additional information. Do not ask the user to click resume editing or sync Local first."
  },
  "theCurrentWorktreeHasNoUnsyncedReviewToResume372": {
    "zh": "当前 Worktree 没有可恢复的未同步 Review: {p0}",
    "en": "The current Worktree has no unsynced Review to resume: {p0}"
  },
  "worktreeDidNotReturnToWorkingState": {
    "zh": "Worktree 未恢复到 working 状态: {p0}",
    "en": "Worktree did not return to working state: {p0}"
  },
  "resumeWorktreeRevision": {
    "zh": "恢复 Worktree 编辑",
    "en": "Resume Worktree revision"
  },
  "whenTheCurrentIsolatedSessionHasBeenDeliveredAnd": {
    "zh": "当当前 Isolated Session 已交付并完成 cleanup，而用户在同一对话中提出新的代码或文件修改时，先调用本工具安全重建同一个 immutable cwd 并进入下一轮，然后继续执行用户请求。不要改用 worktree_create；retained 或 cleanup_pending 状态不能调用。",
    "en": "When the current Isolated Session has been delivered and cleanup is complete, and the user requests new code or file changes in the same conversation, call this tool first to safely recreate the same immutable cwd and begin the next iteration, then continue the request. Do not use worktree_create instead. Do not call this tool in retained or cleanup_pending state."
  },
  "theNextWorktreeIterationDidNotEnterWorkingState": {
    "zh": "下一轮 Worktree 未进入 working 状态: {p0}",
    "en": "The next Worktree iteration did not enter working state: {p0}"
  },
  "startNextWorktreeIteration": {
    "zh": "开始下一轮 Worktree",
    "en": "Start next Worktree iteration"
  },
  "onlyForWorktreeSessionsThatHaveAlreadySelectedAn": {
    "zh": "仅用于已经选择 Isolated Checkout 的 Worktree Session，普通 Local Checkout 任务必须用正常助手回复结束且不得调用本工具。它是 Isolated Session 的最后一个模型动作：把完整交付报告、验证证据和建议 Commit Message 仅写入本工具参数，然后立即停止。不要在调用前后用普通回复重复完整报告；最多用一句话提示用户通过底部验收条处理。用户会显式决定是否提交或放弃，模型不得自动提交或清理。",
    "en": "Only for Worktree Sessions that have already selected an Isolated Checkout. Ordinary Local Checkout tasks must end with a normal assistant reply and must not call this tool. This is the Isolated Session's final model action: put the complete delivery report, validation evidence, and suggested commit message only in this tool's arguments, then stop immediately. Do not repeat the complete report in normal replies before or after calling it; at most one sentence may direct the user to the bottom acceptance bar. The user explicitly decides whether to commit or discard. The model must not automatically commit or clean up."
  },
  "oneLineSummaryOfTheChangeMax240Chars": {
    "zh": "一句话描述改动（最多 240 个字符）。",
    "en": "One-line summary of the change (max 240 chars)."
  },
  "optionalFullMarkdownDetailsMax12000Chars": {
    "zh": "可选的完整 Markdown 详情（最多 12000 个字符）。",
    "en": "Optional full Markdown details (max 12000 chars)."
  },
  "optionalOneLineValidationOutcome": {
    "zh": "可选的一句话验证结果。",
    "en": "Optional one-line validation outcome."
  },
  "suggestedCommitMessageForTheHumanAcceptanceAction": {
    "zh": "建议用于人工验收操作的提交信息。",
    "en": "Suggested commit message for the human acceptance action."
  },
  "worktreeDidNotEnterAReviewableState": {
    "zh": "worktree 未进入可验收状态: {p0}",
    "en": "Worktree did not enter a reviewable state: {p0}"
  },
  "worktreeCleanupDescription": {
    "zh": "清理一个已交付/保留终态的托管 Worktree：仅限当前会话拥有的 checkout，校验 expectedRevision（CAS）后走标准删除链路（含隔离区与安全快照）。脏工作树会被拒绝；拿不准时先调 worktree_list 查看可清理项。",
    "en": "Clean up one delivered/retained managed Worktree owned by the current session: validates expectedRevision (CAS) and goes through the standard removal chain (quarantine + safety snapshot included). Dirty worktrees are refused; call worktree_list first when unsure."
  },
  "worktreeCleanupCheckoutId": {
    "zh": "要清理的 checkout 标识（来自 worktree_list 的 checkoutId）。",
    "en": "Checkout to clean up (the checkoutId from worktree_list)."
  },
  "worktreeCleanupExpectedRevision": {
    "zh": "乐观并发校验：worktree_list 返回的 revision，防止清理过期目标。",
    "en": "Optimistic-concurrency check: the revision from worktree_list, so a stale target is never cleaned up."
  },
  "cleanupFinishedWorktree": {
    "zh": "清理已完成的 Worktree",
    "en": "Clean up finished Worktree"
  },
  "worktreeCleanupRequiresCheckoutId": {
    "zh": "worktree_cleanup 需要 checkoutId 参数（来自 worktree_list）。",
    "en": "worktree_cleanup requires the checkoutId parameter (from worktree_list)."
  },
  "worktreeCleanupRequiresExpectedRevision": {
    "zh": "worktree_cleanup 需要 expectedRevision 参数（来自 worktree_list 的 revision）。",
    "en": "worktree_cleanup requires the expectedRevision parameter (the revision from worktree_list)."
  },
  "worktreeCwdCouldNotBeRestoredBeforeRemoval": {
    "zh": "无法先把本会话 cwd 移出该 Worktree（{p0}），为避免 cwd 悬空指向已删目录，本次删除已中止。请先手动 cd 出该目录后重试。",
    "en": "The Session cwd could not be moved out of the Worktree first ({p0}); the removal was aborted so the cwd cannot be left pointing at a deleted directory. Leave the directory manually and retry."
  },
  "worktreeReturnToLocalDescription": {
    "zh": "把本会话从托管 worktree 释放回项目 Local 检出：只对已交付的 worktree（完成交付或合并后的记录）生效，会先把会话 cwd 移回 Local 根目录再解绑。已经在 Local 时幂等返回当前位置。交付/合并后想继续在 Local 上工作时用它；未交付的 worktree 会被拒绝——解绑会把未合并的改动留在冻结目录里。",
    "en": "Release this session from its managed worktree back to the project Local checkout. Only delivered checkouts (after delivery or merge) qualify: the session cwd is moved to the Local root first, then the binding is released. Idempotent when already on Local. Use it to keep working on Local after delivering or merging; undelivered checkouts are refused because unbinding would strand unmerged work in a frozen directory."
  },
  "worktreeReturnedToLocal": {
    "zh": "回到 Local 工作区",
    "en": "Return to Local"
  },
  "worktreeMergeThenReturnToLocal": {
    "zh": "这次合并没有移动会话：如果你还在托管 worktree 里，调 worktree_return_to_local 回到 Local；已经在 Local 时不需要调用。",
    "en": "The merge did not move the session: if you are still inside a managed worktree, call worktree_return_to_local to get back to Local; if you are already on Local, no call is needed."
  },
  "worktreeSwitchBranchDescription": {
    "zh": "把本会话项目的 Local 检出切到指定本地分支（create=true 时以当前 HEAD 为起点新建并切换）。这是唯一会移动 Local HEAD 的模型动作：该 HEAD 是所有待交付 apply 的基线，因此有会话正在交付时会被拒绝。被拒绝时返回 kind=worktree_branch_switch_blocked、结构化 code 与受影响 paths，按 nextAction 处理，不要对同一分支反复重试。",
    "en": "Switch this session's project Local checkout to a local branch (with create=true, create it from the current HEAD and switch). This is the only model action that moves the Local HEAD, which is the baseline every pending delivery is computed against, so it is refused while any session is mid-delivery. A refusal returns kind=worktree_branch_switch_blocked with a structured code and affected paths; follow nextAction instead of retrying the same branch."
  },
  "worktreeSwitchBranchBranch": {
    "zh": "目标本地分支短名（例如 main 或 feat/login）。",
    "en": "Target local branch short name (for example main or feat/login)."
  },
  "worktreeSwitchBranchCreate": {
    "zh": "true 时以当前 HEAD 为起点新建该分支并切换（git switch -c）；省略或 false 时只切换到已存在的分支。",
    "en": "When true, create the branch from the current HEAD and switch to it (git switch -c); omitted or false only switches to an existing branch."
  },
  "worktreeSwitchBranchRequiresBranch": {
    "zh": "worktree_switch_branch 需要 branch 参数（本地分支短名）。",
    "en": "worktree_switch_branch requires a branch argument (a local branch short name)."
  },
  "worktreeSwitchCommitThenRetry": {
    "zh": "这些文件有未提交改动，切换会覆盖它们：先提交（git add -A && git commit）或处理掉这些改动，再重试切换。paths 是 Git 报告的文件。",
    "en": "These files have uncommitted changes the switch would overwrite: commit them first (git add -A && git commit) or deal with the changes, then retry the switch. paths lists the files Git reported."
  },
  "worktreeSwitchResolveConflictsFirst": {
    "zh": "仓库里有未解决的合并/变基冲突：先解决冲突并完成或中止该操作，再切换分支。",
    "en": "The repository has unresolved merge or rebase conflicts: resolve them and finish or abort that operation before switching branches."
  },
  "worktreeSwitchOperationInProgress": {
    "zh": "仓库里有进行中的 merge/rebase/cherry-pick/revert：先完成或中止它，再切换分支。",
    "en": "A merge, rebase, cherry-pick or revert is in progress: finish or abort it before switching branches."
  },
  "worktreeSwitchBranchInOtherWorktree": {
    "zh": "该分支已被另一棵 worktree 检出：改切其它分支，或先移除占用它的那棵树。",
    "en": "Another worktree already has that branch checked out: switch to a different branch, or remove the worktree that holds it."
  },
  "worktreeSwitchTargetBranchMissing": {
    "zh": "目标分支不存在：用 create=true 新建并切换，或换一个已存在的分支名。",
    "en": "The target branch does not exist: create it with create=true, or pick an existing branch name."
  },
  "worktreeSwitchInvalidBranchName": {
    "zh": "分支名不合法：改用合法的短名（不含空格与 ~ ^ : ? * [ \\ 等字符）。",
    "en": "That branch name is invalid: use a legal short name without spaces or the characters ~ ^ : ? * [ \\."
  },
  "switchBranch": {
    "zh": "切换分支",
    "en": "Switch branch"
  },
  "worktreePruneBranchesDescription": {
    "zh": "安全清理当前会话项目里已完全合并的本地分支（git branch -d 语义，绝不强删）：当前分支、main/master 和未合并分支一律跳过并说明原因。先 dryRun 预览，再正式删除。仍被 Worktree 检出的分支，如果那棵树已交付、干净且不是永久保留，会先回收那棵树再删分支（手动调用不看保留期；后台自动清理仍等保留期结束）；其余跳过并给出 checkoutId。",
    "en": "Safely prune fully merged local branches in the current session's project (git branch -d semantics, never force): the current branch, main/master, and unmerged branches are skipped with a reason. Preview with dryRun first, then delete for real. A branch still checked out by a delivered, clean, non-permanent Worktree is deleted after that Worktree is reclaimed — manual calls ignore the retention window, the background sweep still waits for it; otherwise the skip names its checkoutId."
  },
  "worktreePruneBranchesDryRun": {
    "zh": "只报告会删哪些分支，不真的删除（建议先 true 预览）。",
    "en": "Report what would be deleted without touching any ref (preview with true first)."
  },
  "worktreePruneBranchesOlderThanDays": {
    "zh": "只清理 tip 提交时间早于该天数的已合并分支；不传则不做时间过滤。",
    "en": "Only prune merged branches whose tip commit is older than this many days; omit for no age filter."
  },
  "branchTipYoungerThanCutoffDays": {
    "zh": "分支 tip 晚于 {p0} 天 cutoff，暂不清理。",
    "en": "Branch tip is younger than the {p0}-day cutoff; kept for now."
  },
  "pruneMergedLocalBranches": {
    "zh": "清理已合并的本地分支",
    "en": "Prune merged local branches"
  },
  "theGitPortOfThisInstallationDoesNotSupportBranchPrune": {
    "zh": "当前安装的 Git 适配器不支持分支清理操作。",
    "en": "The Git adapter of this installation does not support branch pruning."
  },
  "cannotVerifyWhetherThisBranchIsFullyMerged": {
    "zh": "无法验证该分支是否已完全合并，已跳过。",
    "en": "Could not verify whether this branch is fully merged; skipped."
  },
  "thisBranchBelongsToALiveManagedCheckout": {
    "zh": "该分支仍被一个未交付的托管 Worktree 占用，已跳过。",
    "en": "An undelivered managed checkout still uses this branch; skipped."
  },
  "thisBranchIsPinnedByAPermanentWorktree": {
    "zh": "该分支被一个标记为永久保留的 Worktree 检出（{p0}）；先清理该 Worktree 再删除分支。",
    "en": "A permanently retained Worktree still has this branch checked out ({p0}); clean that Worktree up before deleting the branch."
  },
  "thisBranchIsPinnedByAManuallyRetainedWorktree": {
    "zh": "该分支被一个手动保留的 Worktree 检出（{p0}）；先清理该 Worktree 再删除分支。",
    "en": "A manually retained Worktree still has this branch checked out ({p0}); clean that Worktree up before deleting the branch."
  },
  "thisBranchIsStillCheckedOutByARetainedWorktree": {
    "zh": "该分支仍被一个保留期未到的 Worktree 检出（{p0}，保留至 {p1}）；先清理该 Worktree 或等保留期结束。",
    "en": "A retained Worktree still has this branch checked out ({p0}, retained until {p1}); clean that Worktree up or wait for the retention to expire."
  },
  "thisBranchIsStillCheckedOutByADeliveredWorktree": {
    "zh": "该分支被一个已交付但仍留在磁盘上的 Worktree 检出（{p0}）；先清理该 Worktree 再删除分支。",
    "en": "A delivered Worktree still on disk has this branch checked out ({p0}); clean that Worktree up before deleting the branch."
  },
  "thisBranchIsCheckedOutInAWorktree": {
    "zh": "该分支仍被另一个 Worktree 检出（{p0}）；先移除那个 Worktree。",
    "en": "Another Worktree still has this branch checked out ({p0}); remove that Worktree first."
  },
  "releasingItsDeliveredWorktreeFirst": {
    "zh": "已合并且已交付：回收其 Worktree 后删除分支。",
    "en": "Merged and delivered: its Worktree is reclaimed before the branch is deleted."
  },
  "theBranchIsStillCheckedOutByItsWorktree": {
    "zh": "该分支的 Worktree 未能清理，分支已保留。",
    "en": "The branch's Worktree could not be cleaned up, so the branch was kept."
  },
  "thisBranchHasCommitsNotYetMergedInto": {
    "zh": "该分支还有提交未合并进 {p0}，已跳过。",
    "en": "This branch has commits not yet merged into {p0}; skipped."
  },
  "worktreeMergeDescription": {
    "zh": "把本会话托管 worktree 的分支合并进 Local 当前分支。必须先 dryRun 预览（零改动试合并）；正式合并遇冲突时不回滚，返回逐文件冲突 diff，由你在 Local 就地解决后提交。direction='reverse' 时反向同步：把 Local 当前分支合进任务 worktree 的当前分支，冲突现场留在任务 worktree。只能操作本会话自己的 worktree 分支。",
    "en": "Merge a branch from a worktree owned by this session into the Local checkout HEAD. Always dryRun first (a zero-touch trial merge); on a real merge conflict nothing is rolled back — per-file conflict diffs are returned for you to resolve and commit in place. With direction='reverse' the Local checkout HEAD is synced back into the worktree branch, leaving any conflict scene in the worktree. Only branches of this session's own worktrees can be merged."
  },
  "worktreeMergeSourceBranch": {
    "zh": "本会话 worktree 的分支名：forward 时作为合并来源，reverse 时作为反向同步的接收分支（必须属于本会话的托管 worktree）。",
    "en": "A worktree branch of this session: the merge source on forward, or the receiving branch on reverse (must belong to a managed worktree of this session)."
  },
  "worktreeMergeDryRun": {
    "zh": "在临时 worktree 里试合并，不改动 Local（建议先 true 预览冲突）。",
    "en": "Trial-merge in a throwaway worktree without touching Local (preview with true first)."
  },
  "worktreeForceCleanupDescription": {
    "zh": "普通 worktree_cleanup 反复清不掉时的显式出口：处理已交付（finalized/retained）、但目录身份已失效（.git 指针损坏、Git 注册表里已没有这条 worktree）的记录。目录里仍有 .git 也照做——先移走或删除目录，再 prune 掉 Git 注册表里的悬空条目；目录已经不在时直接结账。默认把目录移到同级的隔离路径，或按 discard 删除，两种模式都写进台账留痕。",
    "en": "Explicit exit when ordinary worktree_cleanup keeps failing: handles delivered (finalized/retained) records whose directory identity no longer validates (.git pointer broken, worktree no longer registered in Git). A directory that still has .git is accepted — it is moved or removed and the dangling Git registration pruned; a directory that is already gone settles the record directly. Defaults to moving it beside itself as a quarantine; discard removes it. Both leave a record."
  },
  "worktreeForceCleanupCheckoutId": { "zh": "要清理的 Worktree 记录 id。", "en": "Checkout record id to clean up." },
  "worktreeForceCleanupExpectedRevision": { "zh": "读取记录时的 revision，防止清理过期目标。", "en": "Record revision read earlier, so a stale target is never cleaned up." },
  "worktreeForceCleanupMode": { "zh": "quarantine（默认）把目录移到同级隔离路径；discard 直接删除。", "en": "quarantine (default) moves the directory beside itself; discard removes it." },
  "worktreeForceCleanupConfirm": { "zh": "discard 模式必填，必须与 checkoutId 完全一致。", "en": "Required for discard; must repeat the checkoutId verbatim." },
  "worktreeForceCleanupRequiresDelivered": {
    "zh": "只有已交付（finalized/retained）的记录可以强制清理；工作中的 Worktree 请走普通清理。",
    "en": "Only delivered records (finalized/retained) can be force-cleaned; work in progress belongs to ordinary cleanup."
  },

  "worktreeForceCleanupConfirmRequired": {
    "zh": "discard 会不可撤销地删除目录，请把 confirm 设为 \"{p0}\"。",
    "en": "discard deletes the directory irreversibly; set confirm to \"{p0}\"."
  },
  "worktreeForceCleanupMoveUnsupported": {
    "zh": "当前安装不支持目录移动，无法隔离；可改用 discard 或手工移动后清理。",
    "en": "This installation cannot move directories, so quarantine is unavailable; use discard or move it by hand."
  },
  "theWorktreeRecordChangedSinceItWasRead": {
    "zh": "记录在读取之后被改过；请重新读取再试。",
    "en": "The record changed after it was read; read it again and retry."
  },
  "worktreeMergeTargetBranch": {
    "zh": "可选：forward 方向要合并进哪个 Local 分支。默认是 Local 当前检出的分支；指定后合并前会先切过去。",
    "en": "Optional: which Local branch to merge into for the forward direction. Defaults to the branch currently checked out; when set, the checkout switches to it before merging."
  },
  "worktreeMergeTargetBranchUnavailable": {
    "zh": "无法切换到目标分支 {p0}（{p1}）；合并只能在当前分支执行，请先处理该分支上的未提交改动或冲突。",
    "en": "Could not switch to target branch {p0} ({p1}); a merge runs on the checked-out branch, so resolve its uncommitted changes or conflicts first."
  },
  "worktreeMergeDirection": {
    "zh": "合并方向：forward（默认）把任务分支合进 Local 当前分支；'reverse' 反向同步，把 Local 当前分支合进任务 worktree 的当前分支，冲突现场留在任务 worktree。",
    "en": "Merge direction: forward (default) merges the worktree branch into the Local checkout HEAD; 'reverse' syncs the Local checkout HEAD into the worktree branch, leaving any conflict scene in the worktree."
  },
  "mergeWorktreeBranch": {
    "zh": "合并 worktree 分支",
    "en": "Merge worktree branch"
  },
  "worktreeMergeSourceBranchRequired": {
    "zh": "worktree_merge 需要 sourceBranch 参数。",
    "en": "worktree_merge requires the sourceBranch parameter."
  },
  "worktreeMergeSourceNotOwnedBySession": {
    "zh": "「{p0}」不是本会话托管 worktree 的当前分支，拒绝合并（只允许合并本会话自己的分支）。",
    "en": "\"{p0}\" is not the current branch of a managed worktree owned by this session; merge refused (only this session's own branches can be merged)."
  },
  "worktreeMergeSourceIsLocalHead": {
    "zh": "「{p0}」已是 Local 当前分支，无需合并。",
    "en": "\"{p0}\" is already the Local checkout's current branch; nothing to merge."
  },
  "worktreeMergeUnknownSourceBranch": {
    "zh": "找不到分支「{p0}」。",
    "en": "Unknown branch \"{p0}\"."
  },
  "worktreeMergeDirectionInvalid": {
    "zh": "未知的 direction「{p0}」，只支持 forward / reverse。",
    "en": "Unknown direction \"{p0}\"; use forward or reverse."
  },
  "worktreeMergeLocalHeadDetached": {
    "zh": "Local 检出当前不在任何分支上（detached HEAD），无法反向同步。",
    "en": "The Local checkout is not on a branch (detached HEAD); reverse sync is unavailable."
  },
  "theGitPortOfThisInstallationDoesNotSupportBranchMerge": {
    "zh": "当前安装的 Git 适配器不支持分支合并操作。",
    "en": "The Git adapter of this installation does not support branch merging."
  },
  "worktreeConflictDiffTruncated": {
    "zh": "冲突 diff 过长已截断。",
    "en": "Conflict diff truncated."
  },
  "worktreeConflictMoreFiles": {
    "zh": "（另有 {p0} 个冲突文件未展示详情）",
    "en": "(conflict details omitted for {p0} more files)"
  },
  "readyForWorktreeReview": {
    "zh": "提交 Worktree 验收",
    "en": "Ready for Worktree review"
  },
  "deliverWorktreeChangesNow": {
    "zh": "交付 Worktree 变更",
    "en": "Deliver Worktree changes"
  },
  "worktreeDeliverDescription": {
    "zh": "把当前 Worktree 的改动提交到**本会话自己的分支**上（不写 Local 的工作区、索引或 HEAD），随后按保留策略清理 Worktree。可在 Working 或 Ready for Review 状态调用；这是完成实现与验证后的最终模型工具。合并到 Local 是之后单独的一步（worktree_merge）。",
    "en": "Commit the current Worktree changes onto **this session's own branch** (never touching Local's working tree, index or HEAD), then clean the Worktree up per the retention policy. Callable from Working or Ready for Review state; this is the final model tool after implementation and validation are complete. Merging into Local is a separate later step (worktree_merge)."
  },
  "worktreeDeliverCommitMessage": {
    "zh": "交付提交信息（1-500 字符）。Ready for Review 状态下缺省使用评审的 suggestedCommitMessage。",
    "en": "Commit message for the delivery (1-500 chars). In Ready for Review state it defaults to the review's suggestedCommitMessage."
  },
  "worktreeDeliverRetention": {
    "zh": "交付后的保留策略：retain_24h（默认）保留冻结环境 24 小时后自动清理；retain_3d / retain_manual 保留更久或由人工清理；cleanup 交付后立即删除 Worktree。",
    "en": "Retention after delivery: retain_24h (default) keeps the frozen environment for 24 hours then cleans it up; retain_3d / retain_manual keep it longer or until removed by hand; cleanup removes the Worktree immediately."
  },
  "worktreeDeliverReport": {
    "zh": "面向用户的完整交付报告（Markdown），随交付结果返回，不写入提交。",
    "en": "Complete user-facing delivery report (Markdown), returned with the delivery result; not written into the commit."
  },
  "worktreeLinkDepsDescription": {
    "zh": "可选：需要在新建 Worktree 里联到主仓库的相对目录（如 android/frontend/node_modules）。Worktree 只含 Git 跟踪内容，依赖目录不会跟过来；这里建目录联接（Windows junction），源目录失效时直接报出悬空联接。",
    "en": "Optional: Worktree-relative directories to link from the Local checkout into the new Worktree (for example android/frontend/node_modules). A Worktree only contains Git-tracked content, so dependency directories never follow; this creates directory links (junctions on Windows) and reports a dangling source explicitly."
  },
  "worktreePreservePathsDescription": {
    "zh": "可选：交付后、清理冻结副本之前需要带回 Local 的相对路径（如 changelogs/ 这类被 gitignore 的收尾材料）。只复制文件，不覆盖 Local 已有的同名目录内容。",
    "en": "Optional: Worktree-relative paths to carry back to Local after delivery but before the frozen runtime is removed (gitignored hand-off material such as changelogs/). Files only; existing Local content is never merged over."
  },
  "worktreeConfigInvalidJson": {
    "zh": "项目配置 {p0} 不是合法 JSON：{p1}",
    "en": "The project config {p0} is not valid JSON: {p1}"
  },
  "worktreeConfigNotObject": {
    "zh": "项目配置 {p0} 必须是 JSON 对象。",
    "en": "The project config {p0} must be a JSON object."
  },
  "worktreeConfigFieldMustBeArray": {
    "zh": "项目配置 {p0} 的 {p1} 必须是字符串数组。",
    "en": "Field {p1} in the project config {p0} must be an array of strings."
  },
  "worktreeConfigPathInvalid": {
    "zh": "项目配置 {p0} 的 {p1} 只接受 Worktree 内的相对路径：{p2}",
    "en": "Field {p1} in the project config {p0} accepts only Worktree-relative paths: {p2}"
  },
  "worktreeLinkDepsInvalidPath": {
    "zh": "linkDeps 只接受 Worktree 内的相对路径：{p0}",
    "en": "linkDeps accepts only Worktree-relative paths: {p0}"
  },
  "worktreeLinkDepsSourceMissing": {
    "zh": "主仓库里没有可联接的 {p0}；先在主仓库安装依赖再重试。",
    "en": "The Local checkout has nothing to link at {p0}; install the dependencies there first."
  },
  "worktreeLinkDepsSourceDangling": {
    "zh": "主仓库的 {p0} 是悬空联接，指向的目标已不存在；先修复主仓库的依赖联接再重试。",
    "en": "The Local checkout's {p0} is a dangling link whose target no longer exists; repair the Local dependency link first."
  },
  "worktreeLinkDepsDrifted": {
    "zh": "主仓库与 Worktree 的 {p0} 依赖声明不一致（{p1}），依赖可能已漂移；不共享该目录，请在 Worktree 内安装依赖。",
    "en": "The dependency declarations for {p0} differ between the Local checkout and the Worktree ({p1}); the directory is not shared. Install dependencies inside the Worktree instead."
  },
  "worktreePreservePathInvalid": {
    "zh": "preservePaths 只接受 Worktree 内的相对路径：{p0}",
    "en": "preservePaths accepts only Worktree-relative paths: {p0}"
  },
  "worktreePreservePathMissing": {
    "zh": "Worktree 里没有可保留的 {p0}，已跳过。",
    "en": "The Worktree has nothing to preserve at {p0}; skipped."
  },
  "optionalTopicForHumanReadableWorktreeNaming": {
    "zh": "可选的主题名：既用于 Worktree 目录命名（<主题>-<YYYYMMDD>，需宿主配置 worktreesRoot），也用于生成本会话专属的分支名 feat/sess-<会话>--<主题>。",
    "en": "Optional topic: used both for the Worktree directory name (<topic>-<YYYYMMDD>, needs a host-configured worktreesRoot) and for this session's own branch name feat/sess-<session>--<topic>."
  },
  "worktreeDeliverUnexpectedResult": {
    "zh": "worktree_deliver 未返回预期结果: {p0}",
    "en": "worktree_deliver did not return the expected result: {p0}"
  },
  "worktreeCwdCouldNotBeRestoredAfterFailedDelivery": {
    "zh": "交付失败（{p0}），且无法把本会话 cwd 移回仍然存在的 Worktree（{p1}）：当前 cwd 仍在 Local 检出里，相对路径写入会打到原仓库，请手动 cd 回该 Worktree 后重试。",
    "en": "The delivery failed ({p0}) and the Session cwd could not be moved back into the surviving Worktree ({p1}): the cwd is still inside the Local checkout, where relative-path writes hit the original repository. Move back into the Worktree manually and retry."
  },
  "worktreeCwdCouldNotBeEntered": {
    "zh": "无法把本会话 cwd 切入 Worktree（{p0}）。相对路径写入仍会落在当前目录，请手动 cd 到该 Worktree 后重试。",
    "en": "The Session cwd could not be moved into the Worktree ({p0}). Relative-path writes still land in the current directory; change into the Worktree manually and retry."
  },
  "worktreeDeliverRequiresCommitMessage": {
    "zh": "worktree_deliver 需要提交信息（1-500 字符）；当前状态没有可用的 suggestedCommitMessage。",
    "en": "worktree_deliver requires a commit message (1-500 chars); the current state has no suggestedCommitMessage to fall back to."
  },
  "worktreeDeliverNotAllowedInState": {
    "zh": "当前状态（{p0}）不能交付：先完成实现，或在 Working/Ready for Review 状态调用。",
    "en": "Cannot deliver in the current state ({p0}): finish the implementation first, or call worktree_deliver in Working or Ready for Review state."
  },
  "worktreeDeliverDisabledByAutoDeliver": {
    "zh": "autoDeliver 已关闭：模型不能自行交付（commit/push/清理）。请把完整报告放在普通回复里交给用户，由用户在胶囊菜单点「交付到会话分支」。",
    'en': 'autoDeliver is disabled: the model cannot deliver on its own (commit/push/cleanup). Put the complete report in your ordinary reply and let the user click "Deliver to the session branch" in the capsule menu.'
  },
  "worktreeDeliverInvalidRetention": {
    "zh": "worktree_deliver 的 retention 参数无效：{p0}（可选值：cleanup、retain_24h、retain_3d、retain_manual）。",
    "en": "Invalid retention value for worktree_deliver: {p0} (expected cleanup, retain_24h, retain_3d, or retain_manual)."
  },
  "worktreeFinishCommitMessageTooLong": {
    "zh": "finish 的提交信息超长（上限 500 字符）。",
    "en": "The finish commit message exceeds the 500-character limit."
  },
  "worktreeFinishCommitMessageRequired": {
    "zh": "交付需要一条提交信息：请传入 summary 或 commitMessage。",
    "en": "Delivery needs a commit message: pass summary or commitMessage."
  },
  "thisVersionCannotDeliverToASessionBranch": {
    "zh": "当前版本无法交付到会话分支：git 端口未实现 attachWorktreeBranch。请升级插件后重试。",
    "en": "This version cannot deliver to a session branch: the git port does not implement attachWorktreeBranch. Upgrade the plugin and retry."
  },
  "theSessionBranchCouldNotBeAttachedToTheWorktree": {
    "zh": "无法为这个 Worktree 建立会话分支（候选名都被占用或写入失败）。请在仓库里手动创建一条分支后重试。",
    "en": "Could not create a session branch for this Worktree (every candidate name is taken or the write failed). Create a branch in the repository manually and retry."
  },
  "theSessionBranchCouldNotBeAttachedFallingBackTo": {
    "zh": "会话分支未能挂到 Worktree 上（git 端口未实现 attachWorktreeBranch），已退回旧的 detached HEAD 行为：对话栏将不显示分支名，交付也不会写回会话分支。",
    "en": "The session branch could not be attached to the Worktree (the git port does not implement attachWorktreeBranch), so the legacy detached-HEAD behaviour is used: the conversation chip will show no branch and delivery will not write to a session branch."
  },
  "theWorktreeIsNotOnTheSessionBranch": {
    "zh": "Worktree 的 HEAD 不在会话分支上（期望 {p0}，实际 {p1}）。交付只会写会话自己的分支，请先让该 Worktree 检出会话分支后重试。",
    "en": "The Worktree HEAD is not on the session branch (expected {p0}, found {p1}). Delivery only writes the session's own branch; check it out in the Worktree and retry."
  },
  "theWorktreeHeadDidNotAdvanceToTheDeliveryCommit": {
    "zh": "交付提交已创建，但 Worktree 的 HEAD 没有指向它。请检查该 Worktree 是否有并发提交，然后重试。",
    "en": "The delivery commit was created but the Worktree HEAD does not point at it. Check for concurrent commits in that Worktree and retry."
  },
  "reviewFieldsExceedLengthLimits": {
    "zh": "评审字段超长：summary≤240，detailsMarkdown≤12000，validationSummary≤500，tests[].command/summary≤500。",
    "en": "A review field exceeds its length limit: summary≤240, detailsMarkdown≤12000, validationSummary≤500, tests[].command/summary≤500."
  },
  "autoPushOutcome": {
    "zh": "自动推送：{p0}",
    "en": "Auto push: {p0}"
  },
  "autoPushPushed": {
    "zh": "已推送当前分支到上游",
    "en": "pushed the current branch to its upstream"
  },
  "autoPushFailed": {
    "zh": "推送失败（不影响交付）: {p0}",
    "en": "push failed (delivery unaffected): {p0}"
  },
  "pushSkippedNoLocalBranch": {
    "zh": "Local 处于分离 HEAD 状态，已跳过推送",
    "en": "Local HEAD is detached; push skipped"
  },
  "pushSkippedNoUpstream": {
    "zh": "分支 {p0} 没有上游，已跳过推送",
    "en": "branch {p0} has no upstream; push skipped"
  },
  "checkoutPhase": {
    "zh": "检出：{p0}（{p1}，阶段 {p2}）",
    "en": "checkout: {p0} ({p1}, phase {p2})"
  },
  "worktreeCanOnlyBeUsedInADSHAgent": {
    "zh": "`/worktree` 只能在 DSH Agent 会话中使用",
    "en": "`/worktree` can only be used in a DSH Agent Session."
  },
  "usageWorktreeStatusListContinueNextFinalizeReviewIdRevision": {
    "zh": "用法：/worktree status | list | continue | next | finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual] | finish <message> | discard | remove <checkoutId>",
    "en": "Usage: /worktree status | list | continue | next | finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual] | finish <message> | discard | remove <checkoutId>"
  },
  "finishedCommittedFileSAsCleanup": {
    "zh": "已完成：{p0} 个文件已提交为 {p1}（清理：{p2}）。",
    "en": "Finished: committed {p0} file(s) as {p1} (cleanup: {p2})."
  },
  "inspectAndExplicitlyAcceptManagedWorktreeDelivery": {
    "zh": "查看并明确确认托管 Worktree 交付",
    "en": "inspect and explicitly accept managed worktree delivery"
  },
  "statusListContinueNextFinalizeRetentionFinishMessageDiscard": {
    "zh": "status（状态）| list（列表）| continue（继续修改）| next（下一轮）| finalize [retention]（验收提交）| finish <message>（直接提交）| discard（丢弃）| remove <checkoutId>（移除）",
    "en": "status | list | continue | next | finalize [retention] | finish <message> | discard | remove <checkoutId>"
  },
  "noManagedWorktreesVisibleToThisSession": {
    "zh": "当前会话没有可见的托管 Worktree。",
    "en": "No managed worktrees visible to this Session."
  },
  "theCurrentWorktreeHasNoUnsyncedReadyForReview": {
    "zh": "当前 Worktree 没有尚未同步的 Ready for Review 验收稿。",
    "en": "The current Worktree has no unsynced Ready for Review draft."
  },
  "resumedWorktreeIterationLocalWasNotModified": {
    "zh": "已恢复 Worktree 第 {p0} 轮；未修改 Local。",
    "en": "Resumed Worktree iteration {p0}; Local was not modified."
  },
  "startedWorktreeIterationInTheCurrentSession": {
    "zh": "已在当前会话开始 Worktree 第 {p0} 轮。",
    "en": "Started Worktree iteration {p0} in the current Session."
  },
  "theCurrentWorktreeIsNotReadyForReviewAnd": {
    "zh": "当前 Worktree 尚未 Ready for Review，不能 finalize。",
    "en": "The current Worktree is not Ready for Review and cannot be finalized."
  },
  "thisReviewCardHasExpiredConfirmTheLatestReady": {
    "zh": "该验收卡已过期；请确认会话中的最新 Ready for Review 卡片。",
    "en": "This review card has expired. Confirm the latest Ready for Review card in the Session."
  },
  "conflictNLocalHEADSyncAndResolveConflictsInWorktree": {
    "zh": "Conflict: {p0}\nLocal HEAD: {p1} — 在 Worktree 内同步并解决后重新 Ready。",
    "en": "Conflict: {p0}\\nLocal HEAD: {p1} — Sync and resolve conflicts in Worktree, then mark it Ready again."
  },
  "applyConflictLocalDirtyHint": {
    "zh": "原因：Local 工作区有未提交改动，和本次交付重叠（{p0}）。解法二选一：在 Local 提交或 stash 这些改动（`git -C <Local> stash push -u`），或在 Worktree 里同步 Local 已提交的 HEAD 后重新 Ready；交付本身不会修改 Local 的工作区。",
    "en": "Cause: the Local working tree has uncommitted changes that overlap this delivery ({p0}). Either commit or stash them in Local (`git -C <Local> stash push -u`), or sync the Worktree to Local's committed HEAD and mark it Ready again; delivery never writes the Local working tree."
  },
  "applyConflictUntrackedHint": {
    "zh": "原因：本次交付会覆盖 Local 里尚未纳入 git 的同名文件（{p0}）。解法：把 Local 这些文件移走或加入 .gitignore 后重试；交付不会替你删除未跟踪文件。",
    "en": "Cause: this delivery would overwrite files that exist in Local but are not tracked by git ({p0}). Move them aside or gitignore them in Local, then retry; delivery never deletes untracked files for you."
  },
  "applyConflictContentHint": {
    "zh": "原因：两侧改动了同一批内容的真实差异（{p0}）。解法：在 Worktree 里合并 Local 已提交的 HEAD（`git -C <Worktree> merge <Local 分支>`），解决冲突并提交后重新 Ready。",
    "en": "Cause: both sides really changed the same content ({p0}). Merge Local's committed HEAD inside the Worktree (`git -C <Worktree> merge <local branch>`), resolve and commit, then mark it Ready again."
  },
  "deliveryNoLongerWritesLocalUseDeliverInstead": {
    "zh": "交付不再写入 Local：改动已经（或即将）提交在会话分支 {p0} 上，Local 的工作区、索引与 HEAD 都不会被动。这个操作属于旧的「写回 Local」路径，已停用——请用 worktree_deliver 交付，再用 worktree_merge 把 {p0} 合进 Local。",
    "en": "Delivery no longer writes Local: the changes are (or will be) committed on session branch {p0}, and Local's working tree, index and HEAD stay untouched. This operation belongs to the old write-into-Local path and is disabled — use worktree_deliver, then worktree_merge to bring {p0} into Local."
  },
  "worktreeMergeSourceBelongsAnotherSession": {
    "zh": "分支 {p0} 属于另一个会话（{p1}），本会话不会合并、推送或删除它。请确认要合并的是本会话自己的会话分支。",
    "en": "Branch {p0} belongs to another Session ({p1}); this Session never merges, pushes, or deletes it. Confirm you are merging this Session's own branch."
  },
  "finalizeDidNotReturnTheExpectedResult": {
    "zh": "Finalize 未返回预期结果",
    "en": "Finalize did not return the expected result."
  },
  "finishDidNotReturnTheExpectedResult": {
    "zh": "Finish 未返回预期结果",
    "en": "Finish did not return the expected result."
  },
  "worktreeDiscardedThisSessionTargetIsNoLongerAvailable": {
    "zh": "Worktree 已丢弃。此会话目标不再可用。",
    "en": "Worktree discarded. This Session target is no longer available."
  },
  "discardDidNotReturnTheExpectedResult": {
    "zh": "Discard 未返回预期结果",
    "en": "Discard did not return the expected result."
  },
  "noManagedWorktreeVisibleToThisSession": {
    "zh": "当前会话没有可见的托管 Worktree {p0}。",
    "en": "No managed worktree {p0} visible to this Session."
  },
  "removedWorktree": {
    "zh": "已移除 Worktree {p0}。",
    "en": "Removed worktree {p0}."
  },
  "unknownVerb": {
    "zh": "未知操作 {p0}。\\n{p1}",
    "en": "Unknown verb {p0}.\n{p1}"
  },
  "conflictRecoveryIsMissingAValidLocalHEADIdentity": {
    "zh": "冲突恢复缺少有效的 Local HEAD 身份",
    "en": "Conflict recovery is missing a valid Local HEAD identity."
  },
  "conflictRecoveryContainsUnsafeOrOutOfBoundsFile": {
    "zh": "冲突恢复包含不安全或越界的文件身份",
    "en": "Conflict recovery contains unsafe or out-of-bounds file identities."
  },
  "theCurrentSessionCheckoutModuleDoesNotSupportAcceptancePreflight": {
    "zh": "当前 SessionCheckoutModule 不支持验收预检",
    "en": "The current SessionCheckoutModule does not support acceptance preflight."
  },
  "theCurrentSessionDoesNotExist": {
    "zh": "当前 Session 不存在",
    "en": "The current Session does not exist."
  },
  "theCurrentSessionIsNotAssociatedWithAProject": {
    "zh": "当前 Session 尚未关联项目",
    "en": "The current Session is not associated with a project."
  },
  "theCurrentSessionSProjectDoesNotExist": {
    "zh": "当前 Session 项目不存在",
    "en": "The current Session's project does not exist."
  },
  "theCurrentSessionSProjectDirectoryDoesNotExist": {
    "zh": "当前 Session 项目目录不存在",
    "en": "The current Session's project directory does not exist."
  },
  "theCurrentSessionSProjectIsNotAnAvailable": {
    "zh": "当前 Session 项目不是可用的 Git Worktree",
    "en": "The current Session's project is not an available Git Worktree."
  },
  "theCurrentSessionWorkspaceCannotBeProvenToBelong": {
    "zh": "当前 Session Workspace 无法证明属于该 Worktree 的原始项目",
    "en": "The current Session Workspace cannot be proven to belong to this Worktree's original project."
  },
  "theCurrentSessionCwdDoesNotMatchTheWorktree": {
    "zh": "当前 Session cwd 与 Worktree 授权边界不一致",
    "en": "The current Session cwd does not match the Worktree authorization boundary."
  },
  "theCurrentSessionIsNotAllowedToAccessThis": {
    "zh": "当前 Session 无权访问该 Worktree",
    "en": "The current Session is not allowed to access this Worktree."
  },
  "worktreeDoesNotMatchTheCurrentSessionSProject": {
    "zh": "Worktree 与当前 Session 项目不一致",
    "en": "Worktree does not match the current Session's project."
  },
  "theAssociatedWorktreeSOwnerSessionIsUnavailable": {
    "zh": "关联 Worktree 的 owner Session 不可用",
    "en": "The associated Worktree's owner Session is unavailable."
  },
  "theAcceptanceSlotHolderHasChangedCheckAgain": {
    "zh": "验收槽位占用者已变化，请重新检查",
    "en": "The acceptance slot holder has changed. Check again."
  },
  "theWorktreeGitIdentityCannotBeVerified": {
    "zh": "Worktree Git 身份无法验证",
    "en": "The Worktree Git identity cannot be verified."
  },
  "theCurrentSessionWorkspaceCannotBeProvenToBe": {
    "zh": "当前 Session Workspace 无法证明关联 Worktree 项目",
    "en": "The current Session Workspace cannot be proven to be associated with the Worktree project."
  },
  "hostIdentityVerificationFailedForTheNewlyCreatedWorktree": {
    "zh": "新建 Worktree 的 Host 身份校验失败",
    "en": "Host identity verification failed for the newly created Worktree."
  },
  "onlyTheOwnerIsolatedSessionCanReadTheReview": {
    "zh": "只有 owner Isolated Session 可以读取验收 Diff",
    "en": "Only the owner Isolated Session can read the review Diff."
  },
  "theSessionTargetHasChangedRefresh": {
    "zh": "Session Target 已变化，请刷新",
    "en": "The Session Target has changed. Refresh."
  },
  "theReviewIdentityHasChangedRefresh": {
    "zh": "Review 身份已变化，请刷新",
    "en": "The Review identity has changed. Refresh."
  },
  "isolatedHEADChangedAfterReady": {
    "zh": "Ready 后 Isolated HEAD 已变化",
    "en": "Isolated HEAD changed after Ready."
  },
  "isolatedContentChangedAfterReadyDiffBytesWereDiscarded": {
    "zh": "Ready 后 Isolated 内容已变化，Diff bytes 已丢弃",
    "en": "Isolated content changed after Ready. Diff bytes were discarded."
  },
  "onlyTheOwnerIsolatedSessionCanRunSyncPreflight436": {
    "zh": "只有 owner Isolated Session 可以执行同步预检",
    "en": "Only the owner Isolated Session can run sync preflight."
  },
  "onlyTheOwnerIsolatedSessionCanCheckPreviewRecovery440": {
    "zh": "只有 owner Isolated Session 可以检查 Preview 恢复",
    "en": "Only the owner Isolated Session can check Preview recovery."
  },
  "theDetachedPreviewIdentityHasChangedRefresh": {
    "zh": "Detached Preview 身份已变化，请刷新",
    "en": "The Detached Preview identity has changed. Refresh."
  },
  "theCurrentSessionCheckoutModuleDoesNotSupportPreviewRecoveryPreflight": {
    "zh": "当前 SessionCheckoutModule 不支持 Preview Recovery 预检",
    "en": "The current SessionCheckoutModule does not support Preview Recovery preflight."
  },
  "thePreviewRecoveryAnalysisIdentityDoesNotMatch": {
    "zh": "Preview Recovery 分析身份不匹配",
    "en": "The Preview Recovery analysis identity does not match."
  },
  "thePreviewRecoveryHandoffIdentityDoesNotMatch": {
    "zh": "Preview Recovery handoff 身份不匹配",
    "en": "The Preview Recovery handoff identity does not match."
  },
  "hostIdentityVerificationFailedForTheRecoveryHandoffWorktree": {
    "zh": "Recovery handoff Worktree 的 Host 身份校验失败",
    "en": "Host identity verification failed for the Recovery handoff Worktree."
  },
  "onlyTheOwnerIsolatedSessionCanSaveACheckpoint447": {
    "zh": "只有 owner Isolated Session 可以保存阶段",
    "en": "Only the owner Isolated Session can save a checkpoint."
  },
  "theCheckpointCommitMessageOrRequestIdIsInvalid": {
    "zh": "Checkpoint Commit Message 或 requestId 无效",
    "en": "The Checkpoint commit message or requestId is invalid."
  },
  "checkpointReturnedAnUnexpectedState": {
    "zh": "Checkpoint 返回了非预期状态",
    "en": "Checkpoint returned an unexpected state."
  },
  "worktreeDidNotReturnToWorkingAfterCheckpoint": {
    "zh": "Checkpoint 后 Worktree 状态未收敛到 Working",
    "en": "Worktree did not return to Working after Checkpoint."
  },
  "onlyTheOwnerIsolatedSessionCanPreviewChanges": {
    "zh": "只有 owner Isolated Session 可以预览修改",
    "en": "Only the owner Isolated Session can preview changes."
  },
  "localPreviewPreflightFoundContentConflicts": {
    "zh": "Local Preview 预检发现内容冲突",
    "en": "Local Preview preflight found content conflicts."
  },
  "previewReturnedAnUnexpectedState": {
    "zh": "Preview 返回了非预期状态",
    "en": "Preview returned an unexpected state."
  },
  "onlyTheOwnerIsolatedSessionCanResumeEditing456": {
    "zh": "只有 owner Isolated Session 可以继续修改",
    "en": "Only the owner Isolated Session can resume editing."
  },
  "invalidConflictRecoveryRequestIdentity": {
    "zh": "冲突恢复请求身份无效",
    "en": "Invalid conflict recovery request identity."
  },
  "theWorktreeIdentityOrStateDoesNotMatchAfter": {
    "zh": "恢复编辑后 Worktree 身份或状态不一致",
    "en": "The Worktree identity or state does not match after resuming editing."
  },
  "theHostCouldNotPersistTheExactConflictRecovery": {
    "zh": "Host 未能持久化精确冲突恢复凭证",
    "en": "The Host could not persist the exact conflict recovery receipt."
  },
  "onlyTheOwnerIsolatedSessionCanRequestReviewRegeneration462": {
    "zh": "只有 owner Isolated Session 可以请求重新生成验收结果",
    "en": "Only the owner Isolated Session can request review regeneration."
  },
  "onlyTheOwnerIsolatedSessionCanRollBackLocal": {
    "zh": "只有 owner Isolated Session 可以撤回 Local Preview",
    "en": "Only the owner Isolated Session can roll back Local Preview."
  },
  "rollbackPreviewReturnedAnUnexpectedState": {
    "zh": "Rollback Preview 返回了非预期状态",
    "en": "Rollback Preview returned an unexpected state."
  },
  "theOwnerSessionHasTakenOverThisWorktreeOnly467": {
    "zh": "Owner Session 已接管该 Worktree，只有 owner 可以 Discard",
    "en": "The owner Session has taken over this Worktree. Only the owner can Discard it."
  },
  "discardReturnedAnUnexpectedState": {
    "zh": "Discard 返回了非预期状态",
    "en": "Discard returned an unexpected state."
  },
  "onlyTheOwnerIsolatedSessionCanCommitAcceptance": {
    "zh": "只有 owner Isolated Session 可以提交验收",
    "en": "Only the owner Isolated Session can commit acceptance."
  },
  "theCommitMessageMustBeNonemptyAndContainNoNul": {
    "zh": "Commit Message 不能为空或包含 NUL 字符",
    "en": "The commit message must not be empty or contain NUL characters."
  },
  "applyingToLocalCausedConflicts": {
    "zh": "Local 应用发生冲突",
    "en": "Applying to Local caused conflicts."
  },
  "finalizeReturnedAnUnexpectedState": {
    "zh": "Finalize 返回了非预期状态",
    "en": "Finalize returned an unexpected state."
  },
  "onlyTheOwnerIsolatedSessionCanFinalizeLocalPreview": {
    "zh": "只有 owner Isolated Session 可以完成 Local Preview 验收",
    "en": "Only the owner Isolated Session can finalize Local Preview acceptance."
  },
  "finalizePreviewReturnedAnUnexpectedState": {
    "zh": "Finalize Preview 返回了非预期状态",
    "en": "Finalize Preview returned an unexpected state."
  },
  "theNextWorktreeIterationDidNotEnterWorkingState484": {
    "zh": "下一轮 Worktree 未进入 working 状态",
    "en": "The next Worktree iteration did not enter working state."
  },
  "theNextIterationSWorktreeLineageOrCwdIdentity": {
    "zh": "下一轮 Worktree 的 lineage 或 cwd 身份不一致",
    "en": "The next iteration's Worktree lineage or cwd identity does not match."
  },
  "gitFailed": {
    "zh": "git {p0} 失败（{p1}）：{p2}",
    "en": "git {p0} failed ({p1}): {p2}"
  },
  "reviewChangedFilesContainsAnUnsafeProjectRelativePath": {
    "zh": "验收 changedFiles 包含不安全的项目相对路径。",
    "en": "review changedFiles contains an unsafe project-relative path"
  },
  "reviewDiffPathInventoryExceedsTheSafeReadBudget": {
    "zh": "验收 Diff 路径清单超出安全读取额度。",
    "en": "review diff path inventory exceeds the safe read budget"
  },
  "gitDiffReturnedAnUnsafeProjectRelativePath": {
    "zh": "git diff 返回了不安全的项目相对路径。",
    "en": "git diff returned an unsafe project-relative path"
  },
  "reviewChangedFilesNoLongerMatchesTheIsolatedSnapshot": {
    "zh": "验收 changedFiles 不再匹配隔离快照。",
    "en": "review changedFiles no longer matches the isolated snapshot"
  },
  "worktreeConsoleOperationFailed": {
    "zh": "Worktree Console 操作失败",
    "en": "Worktree Console operation failed."
  },
  "theWorktreeQuarantinePathIsInvalidOrAlreadyOccupied": {
    "zh": "Worktree quarantine 路径无效或已被占用",
    "en": "The Worktree quarantine path is invalid or already occupied."
  },
  "theWorktreeDirectoryObjectWasReplacedRecursiveCleanupWas": {
    "zh": "Worktree 目录对象已被替换，未执行递归清理",
    "en": "The Worktree directory object was replaced. Recursive cleanup was not performed."
  },
  "refusingToDeleteWorktreeResidueThatIsNotA": {
    "zh": "拒绝删除非目录或符号链接形式的 Worktree 残余",
    "en": "Refusing to delete Worktree residue that is not a directory or is a symbolic link."
  },
  "gitTimedOutMsAndWasTerminated": {
    "zh": "git {p0} 超时（{p1}ms），已终止",
    "en": "git {p0} timed out ({p1}ms) and was terminated."
  },
  "gitOperationFailedGit": {
    "zh": "Git 操作失败: git {p0}{p1}",
    "en": "Git operation failed: git {p0}{p1}"
  },
  "localBranchSwitchBlockedDuringDelivery": {
    "zh": "本会话正在验收 Worktree 交付，暂不能切换本地分支",
    "en": "This session has a Worktree delivery under review; the local branch cannot be switched right now."
  },
  "localBranchSwitchBlockedByAnotherDelivery": {
    "zh": "另一个会话（{p0}）正在这个 Local 检出上交付 Worktree，切换分支会改变它的交付基线；等那个会话交付或放弃后再切换",
    "en": "Another session ({p0}) is delivering a Worktree on this Local checkout, and switching the branch would move its delivery baseline. Wait until that session delivers or discards."
  },
  "localBranchCommitBlockedDuringDelivery": {
    "zh": "本会话正在验收 Worktree 交付，暂不能提交本地改动",
    "en": "This session has a Worktree delivery under review; local changes cannot be committed right now."
  },
  "localBranchCreateBlockedByActiveSession": {
    "zh": "这个工作区还有 {p0} 个会话正在进行，创建分支会切走它们脚下的本地 HEAD；先让它们在 Worktree 中隔离，或等它们结束",
    "en": "Other live Sessions are still working in this checkout ({p0} session(s)); creating a branch would move the local HEAD under them. Let them isolate in a Worktree, or wait until they finish."
  },
  "localBranchCommitBlockedByAnotherDelivery": {
    "zh": "另一个会话（{p0}）正在这个 Local 检出上交付 Worktree，提交会移动它的交付基线；等那个会话交付或放弃后再提交",
    "en": "Another session ({p0}) is delivering a Worktree on this Local checkout, and a commit would move its delivery baseline. Wait until that session delivers or discards."
  },
  "aDeliveredWorktreeCannotBeMarkedPermanent": {
    "zh": "已交付的 Worktree 无法设置常驻标记。",
    "en": "A delivered worktree cannot be marked as permanent."
  },
  "onlyATerminalWorktreeBadgeCanBeCleared": {
    "zh": "只有已放弃或已完成的 Worktree 标签可以清除。",
    "en": "Only a discarded or completed worktree badge can be cleared."
  },
  "invalidInternalGitArtifactName": {
    "zh": "内部 Git artifact 名称无效",
    "en": "Invalid internal Git artifact name."
  },
  "cannotReadTheInternalGitArtifact": {
    "zh": "无法读取内部 Git artifact",
    "en": "Cannot read the internal Git artifact."
  },
  "cannotProveGitCommitAncestry": {
    "zh": "无法证明 Git commit ancestry",
    "en": "Cannot prove Git commit ancestry."
  },
  "managedCheckoutsJsonIsCorruptCheckoutAccessHasStopped": {
    "zh": "managed-checkouts.json 损坏，已停止访问 checkout",
    "en": "managed-checkouts.json is corrupt. Checkout access has stopped."
  },
  "commandDirty": {
    "zh": "有未提交修改：{value}",
    "en": "dirty: {value}"
  },
  "commandCurrent": {
    "zh": "当前：{branch} @ {oid}",
    "en": "current: {branch} @ {oid}"
  },
  "commandDelivery": {
    "zh": "交付：{state}",
    "en": "delivery: {state}"
  },
  "commandDetached": {
    "zh": "分离 HEAD",
    "en": "detached"
  },
  "commandNoOp": {
    "zh": "无新增提交",
    "en": "no-op"
  },
  "cleanupIdentityChanged": {
    "zh": "Worktree 的 Git 身份或路径已变化，未执行清理。",
    "en": "The Worktree Git identity or path has changed. Cleanup was not performed."
  },
  "cleanupResidue": {
    "zh": "Git Worktree 已解除注册，仅剩物理目录残余；可重试清理环境。",
    "en": "Git Worktree has been unregistered; only directory residue remains. Environment cleanup can be retried."
  },
  "cleanupIncompleteDelivery": {
    "zh": "Worktree 交付状态不完整，未执行清理。",
    "en": "The Worktree delivery state is incomplete. Cleanup was not performed."
  },
  "cleanupIncompleteReceipt": {
    "zh": "Worktree cleanup receipt 不完整",
    "en": "The Worktree cleanup receipt is incomplete."
  },
  "cleanupMissingBeforeQuarantine": {
    "zh": "Worktree 记录在 quarantine 前丢失",
    "en": "The Worktree record was lost before quarantine."
  },
  "cleanupQuarantineIdentity": {
    "zh": "Worktree quarantine 身份无法验证",
    "en": "The Worktree quarantine identity cannot be verified."
  },
  "cleanupNewChanges": {
    "zh": "Worktree 在提交后出现了新修改，未执行清理。",
    "en": "Worktree has new changes after the commit. Cleanup was not performed."
  },
  "cleanupMissingBeforeRemoval": {
    "zh": "Worktree 记录在清理前丢失，未执行清理。",
    "en": "The Worktree record was lost before cleanup. Cleanup was not performed."
  },
  "cleanupQuarantineBusy": {
    "zh": "Worktree 已安全移入 quarantine，但目录仍被进程占用；dsh-git-worktree 会在同一清理授权内有限重试。",
    "en": "Worktree was safely moved into quarantine, but a process still holds the directory. dsh-git-worktree will retry a limited number of times under the same cleanup authorization."
  },
  "cleanupDirectoryBusy": {
    "zh": "Worktree 目录仍被进程占用或 Windows 暂时拒绝删除；dsh-git-worktree 已完成有限重试，可稍后重试清理。",
    "en": "A process still holds the Worktree directory or Windows temporarily denied deletion. dsh-git-worktree has completed its limited retries. Retry cleanup later."
  },
  "cleanupBusyHint": {
    "zh": "排查占用：资源监视器（resmon）→ CPU → 关联的句柄，搜索 {p0}；或安装 Sysinternals handle.exe 后执行 handle.exe {p0}。",
    "en": "To find the holder: Resource Monitor (resmon) → CPU → Associated Handles, search {p0}; or install Sysinternals handle.exe and run handle.exe {p0}."
  },
  "cleanupIdentityChangedActionable": {
    "zh": "Worktree 的 Git 身份或路径已变化，未执行清理。目录已没有可校验的 .git 身份，记录本身仍可解除注册。",
    "en": "The Worktree Git identity or path has changed. Cleanup was not performed: the directory no longer carries a verifiable .git identity, while the record itself can still be released."
  },
  "cleanupIdentityChangedForceHint": {
    "zh": "Worktree 的 Git 身份已无法复核，普通清理无法继续。下一步：调用 worktree_force_cleanup（mode = \"quarantine\"）解除登记——它会一并清掉 Git 注册表里的悬空条目，目录已经不在时也能直接结账，不需要手动删除目录。",
    "en": "The Worktree Git identity can no longer be verified, so ordinary cleanup cannot continue. Next: call worktree_force_cleanup (mode \"quarantine\") to release the record — it also prunes the dangling Git registration and settles the record even when the directory is already gone, so no manual deletion is needed."
  },
  "beginNextIterationCleanupHint": {
    "zh": "上一轮的清理尚未完成：先调用 worktree_force_cleanup（checkoutId = \"{p0}\"，expectedRevision = {p1}，mode = \"quarantine\"），再重试本步骤。",
    "en": "Cleanup of the previous iteration is still unfinished: call worktree_force_cleanup first (checkoutId \"{p0}\", expectedRevision {p1}, mode \"quarantine\"), then retry this step."
  },
  "commandConflict": {
    "zh": "冲突：{files}",
    "en": "Conflict: {files}"
  },
  "localCheckout": {
    "zh": "本地检出",
    "en": "Local Checkout"
  },
  "isolatedCheckout": {
    "zh": "隔离检出",
    "en": "Isolated Checkout"
  },
  "cleanupTimeout": {
    "zh": "[session-checkout] {p0} 清理超时（{p1}ms），已跳过本次收敛",
    "en": "[session-checkout] Cleanup of {p0} timed out ({p1}ms); skipped this reconciliation."
  },
  "checkpointRefCleanupFailed": {
    "zh": "[session-checkout] 清理未生效 Checkpoint ref 失败，已保守保留不可见引用",
    "en": "[session-checkout] Failed to clean up the unapplied Checkpoint ref; conservatively retained the hidden ref."
  },
  "tempDirectoryCleanupFailed": {
    "zh": "[session-checkout-apply] 临时目录清理失败：",
    "en": "[session-checkout-apply] Failed to clean up the temporary directory:"
  },
  "corruptPrimaryIndex": {
    "zh": "[数据恢复] 主索引文件损坏: {p0}",
    "en": "[Data recovery] Primary index file is corrupt: {p0}"
  },
  "recoveredFromTmp": {
    "zh": "[数据恢复] 从 .tmp 文件恢复: {p0}",
    "en": "[Data recovery] Recovered from .tmp file: {p0}"
  },
  "recoveredFromBak": {
    "zh": "[数据恢复] 从 .bak 文件恢复: {p0}",
    "en": "[Data recovery] Recovered from .bak file: {p0}"
  },
  "corruptBackupIndex": {
    "zh": "[数据恢复] .bak 文件也损坏: {p0}",
    "en": "[Data recovery] The .bak file is also corrupt: {p0}"
  },
  "previewRefsCleanupFailed": {
    "zh": "[session-checkout] 清理 Preview refs 失败，已保守保留不可见引用",
    "en": "[session-checkout] Failed to clean up Preview refs; conservatively retained the hidden refs."
  },
  "internalRefsCleanupFailed": {
    "zh": "[session-checkout] 清理内部 Session Checkout refs 失败，已保守保留不可见引用",
    "en": "[session-checkout] Failed to clean up internal Session Checkout refs; conservatively retained the hidden refs."
  },
  "checkoutRegistryLockTimeout": {
    "zh": "等待 checkout 注册表跨进程锁超时（{p0}ms）：{p1}",
    "en": "Timed out after {p0}ms waiting for the cross-process checkout registry lock: {p1}"
  },
  "lockFileUnreadableReclaimed": {
    "zh": "锁文件无法解析，按陈旧锁回收：{p0}",
    "en": "Lock file is unreadable and was reclaimed as stale: {p0}"
  },
  "lockFileOwnedByAnother": {
    "zh": "锁文件已不属于本进程，跳过释放：{p0}",
    "en": "Lock file is no longer owned by this process; released nothing: {p0}"
  },
  "lockFileReleaseFailed": {
    "zh": "锁文件释放失败，需要人工清理：{p0}",
    "en": "Failed to release the lock file; it needs manual cleanup: {p0}"
  },
  "registryRecordDropped": {
    "zh": "managed-checkouts.json 中 {p0} 的记录 {p1} 校验失败（{p2}），已丢弃该条并以内存视图继续",
    "en": "Dropped invalid {p0} record {p1} from managed-checkouts.json ({p2}); continuing with an in-memory view."
  }

} as const satisfies MessageCatalog

/** Registration metadata is shared between sessions, so expose both languages. */
export function hostRegistrationMessage(key: keyof typeof hostMessages): string {
  return hostMessages[key].zh + ' / ' + hostMessages[key].en
}

/**
 * These exact legacy messages are persisted and used by cleanup recovery discriminants.
 * Keep their stored values unchanged; localize only their public projection.
 * This finite allowlist never interprets or rewrites third-party error text.
 */
export const persistedCleanupKeys = ["cleanupIdentityChanged","cleanupIdentityChangedActionable","cleanupIdentityChangedForceHint","cleanupResidue","cleanupIncompleteDelivery","cleanupIncompleteReceipt","cleanupMissingBeforeQuarantine","cleanupQuarantineIdentity","cleanupNewChanges","cleanupMissingBeforeRemoval","cleanupQuarantineBusy","cleanupDirectoryBusy"] as const

export type PersistedCleanupKey = typeof persistedCleanupKeys[number]

/**
 * 持久化的清理说明。新记录把 key 一起存下来，读的时候按当前语言翻译；
 * 只有历史记录才只有一段定死的文本，用中文字面串反查兜底。
 */
export function hostPersistedCleanupMessage(
  message: string,
  translate: Translator<typeof hostMessages>,
  key?: string,
): string {
  const named = persistedCleanupKeys.find(candidate => candidate === key)
  if (named) return translate(named)
  const legacy = persistedCleanupKeys.find(candidate => hostMessages[candidate].zh === message)
  return legacy ? translate(legacy) : message
}
