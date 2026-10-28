---
title: client_i18n
type: module
source_files:
  - src/client/i18n.tsx
  - src/i18n/core.ts
  - src/i18n/client-messages.ts
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/review-console/recovery-continuation.ts
  - tests/client-i18n.test.tsx
  - tests/i18n-core.test.ts
  - tests/i18n-catalogs.test.ts
  - tests/i18n-references.test.ts
tags: [i18n, client, react, locale, translation]
---

## Overview

`client_i18n` is the browser-side (DSH Client) locale layer. It provides React hooks and imperative helpers that let the Worktree client render bilingual (Chinese / English) copy sourced from a single catalog `clientMessages`, while staying decoupled from the shared i18n primitives in `src/i18n/core.ts`.

Two entry styles are supported:

- **React component tree** — `ClientI18nProvider` (`src/client/i18n.tsx:29`) wraps plugin-owned ToolViews in a `Language` context and re-renders when the host locale changes.
- **Imperative services / pure functions** — `clientTranslator()` (`src/client/i18n.tsx:23`) and `translatorForServices()` (`src/client/i18n.tsx:49`) build a stateless `ClientTranslator` from `clientMessages`, used by parsers, recovery prompts, and sidebar projections that run outside React.

The locale is supplied by the host through the `locale` service (`ctx.get('locale')`, see `src/client/index.tsx:51` / `src/client/index.tsx:40`). The host exposes a "LocaleFace" — an object with `getSnapshot()` / `subscribe()` — rather than a plain language string. `readClientLanguage()` (`src/client/i18n.tsx:19`) reads `snapshot.active` off that face and normalizes it via `normalizeLanguage()` (`src/i18n/core.ts:4`).

Key property: user/Host data passed into the catalog (IDs, paths, JSON, summaries) is interpolated verbatim and is **never** translated; only plugin-owned strings switch language.

## Key Components

### Shared primitives — `src/i18n/core.ts`

- `Language` (type, `src/i18n/core.ts:2`) — `'zh' | 'en'`.
- `normalizeLanguage(value: unknown): Language` (`src/i18n/core.ts:4`–`6`) — returns `'en'` only when `value` is a string matching `/^en(?:-|$)/i` (e.g. `'en'`, `'en-US'`, `'EN-gb'`); everything else (including `undefined`, `null`, `'zh'`, `'fr'`, `{}`) resolves to `'zh'`.
- `MessageCatalog` (type, `src/i18n/core.ts:8`) — `Record<string, { readonly zh: string; readonly en: string }>`.
- `Translator<C>` (type, `src/i18n/core.ts:14`–`17`) — generic function `(key, ...args) => string`. The args type is inferred from the `{...}` placeholders in each template's `zh`/`en`, so required placeholders are enforced at compile time (see `tests/i18n-core.test.ts:22` `@ts-expect-error` cases).
- `createTranslator(catalog, language): Translator<C>` (`src/i18n/core.ts:19`–`25`) — returns a translator that looks up `catalog[key][language]` and replaces `{name}` placeholders with values from the params record. Unknown keys are `undefined` (no fallback); missing params keep the literal `{name}` token (`src/i18n/core.ts:22`–`23`). This module never imports browser or Host-only modules (`src/i18n/core.ts:1`).

### Client locale source & React hooks — `src/client/i18n.tsx`

- `ClientTranslator` (type, `src/client/i18n.tsx:5`) — `Translator<typeof clientMessages>`.
- `ClientLocaleSource` (interface, `src/client/i18n.tsx:6`–`9`) — the host LocaleFace contract: `getSnapshot(): { active?: unknown }` and `subscribe(listener): () => void`.
- `localeSource(locale: unknown): ClientLocaleSource | undefined` (`src/client/i18n.tsx:11`–`16`) — duck-types the LocaleFace: returns it only if `locale` is a non-null object exposing both a `getSnapshot` function and a `subscribe` function; otherwise `undefined`.
- `readClientLanguage(locale: unknown): Language` (`src/client/i18n.tsx:20`–`21`) — reads `localeSource(locale)?.getSnapshot().active` and `normalizeLanguage()`-es it; wrapped in `try/catch` that falls back to `'zh'` on any throw (e.g. offline getter).
- `clientTranslator(language: Language = 'zh'): ClientTranslator` (`src/client/i18n.tsx:24`–`25`) — `createTranslator(clientMessages, language)`.
- `defaultClientTranslator` (`src/client/i18n.tsx:26`) — module-level `clientTranslator()` bound to default `'zh'`; used as the default translator in pure functions (`parseCreateTool`, `parseReviewTool`, `buildWorktreeRecoveryPrompt`).
- `ClientLanguageContext` (`src/client/i18n.tsx:27`) — `createContext<Language>('zh')`.
- `ClientI18nProvider({ locale, language, children })` (`src/client/i18n.tsx:29`–`40`) — builds a `useMemo` store whose `subscribe` delegates to the LocaleFace (falling back to a no-op `() => {}` when absent) and whose `getSnapshot` returns `language ?? readClientLanguage(locale)`. Feeds `useSyncExternalStore` (`src/client/i18n.tsx:38`) so React re-renders when the host locale flips, then provides the resolved `Language` to descendants.
- `useClientLanguage(): Language` (`src/client/i18n.tsx:42`) — context reader.
- `useClientTranslator(): ClientTranslator` (`src/client/i18n.tsx:42`–`46`) — `useClientLanguage()` + `useMemo(() => clientTranslator(language), [language])`.
- `translatorForServices(services: { locale?: unknown }): ClientTranslator` (`src/client/i18n.tsx:19`–`51`) — resolves the language *at invocation time* via `readClientLanguage(services.locale)`, so imperative services (e.g. recovery prompts) track the live locale instead of a module-load snapshot.

### Catalog — `src/i18n/client-messages.ts`

- `clientMessages` (`src/i18n/client-messages.ts:4`–`1815`) — the bilingual catalog of plugin-owned client copy, typed `as const satisfies MessageCatalog`. Keys are dotted identifiers; values are `{ zh, en }`, some with `{placeholder}` interpolation (e.g. `{count}`, `{p0}`–`{p4}`, `{project}`, `{iteration}`, `{target}`). Example keys: `manager.task.label` (`src/i18n/client-messages.ts:5`), `detail.title` (`src/i18n/client-messages.ts:7`), `worktree.creation.failed` (`src/i18n/client-messages.ts:87`), `count.files` (`src/i18n/client-messages.ts:1557`), `session.target.label` (`src/i18n/client-messages.ts:1560`), `the.user.approved.worktree.sync.encountered.real.conflicts` (`src/i18n/client-messages.ts:287`).

### Consumers (relevant to this module)

- `src/client/model.ts` — `parseCreateTool(block, t = defaultClientTranslator)` (`src/client/model.ts:100`) and `parseReviewTool(block, t = defaultClientTranslator)` (`src/client/model.ts:152`) use the translator for error strings (`worktree.creation.failed` `src/client/model.ts:105`, `malformed.worktree.create.result` `src/client/model.ts:114`, `ready.for.review.failed` `src/client/model.ts:159`, `malformed.ready.for.review.result` `src/client/model.ts:167`, `malformed.ready.for.review.arguments` `src/client/model.ts:170`).
- `src/client/review-console/recovery-continuation.ts` — `buildWorktreeRecoveryPrompt(request, t = defaultClientTranslator)` (`src/client/review-console/recovery-continuation.ts:378`) and the enqueue/restore/attempt flows call `translatorForServices(...)` (`src/client/review-console/recovery-continuation.ts:281`, `:395`, `:435`) to translate recovery prompts and diagnostics.
- `src/client/index.tsx` — the `apply()` entry (`src/client/index.tsx:49`) wraps every plugin registration in `ClientI18nProvider` via a `Proxy` over `ctx.slots` (`src/client/index.tsx:53`–`59`), passing the host `locale` from `services.locale` (`src/client/index.tsx:51`).

### Tests (read for this article)

- `tests/client-i18n.test.tsx` — LocaleFace read/subscribe/unsubscribe, two mounted clients not sharing language, catalog parameter parity + no CJK in `en`, tool-state parsing, review-panel switching while user data stays unchanged, imperative `translatorForServices` re-resolution per invocation, entry-point `apply` wiring, and sidebar projection translating only plugin badges.
- `tests/i18n-core.test.ts` — `normalizeLanguage` English detection + default-to-`zh`, placeholder interpolation preserving verbatim content, and typed keys/params.
- `tests/i18n-catalogs.test.ts` — asserts every entry of `clientMessages`/`hostMessages`/`transportMessages` has non-empty `zh`/`en` and identical named parameters.
- `tests/i18n-references.test.ts` — static guard: every literal `t("…")` in `src/client` must exist as a key in `clientMessages`.

## Architecture

The module isolates each DSH Client instance's locale into its own React subtree while sharing one immutable catalog. A host LocaleFace drives a single `useSyncExternalStore`; imperative code paths bypass React entirely and resolve language per call.

```text
┌─────────────────────────── Host (DSH Client) ───────────────────────────┐
│  ctx.get('locale') → LocaleFace { getSnapshot(), subscribe() }          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                     │ active='en-US' | 'zh'
                                     ▼
┌─────────────────── src/client/i18n.tsx ──────────────────────────────────┐
│ readClientLanguage(locale) ──► normalizeLanguage()  [src/i18n/core.ts:4] │
│ localeSource(locale) duck-type the face                                │
│                                                                         │
│ ClientI18nProvider ── useSyncExternalStore ──► Language context         │
│   useClientLanguage()  useClientTranslator()                           │
│ translatorForServices(services)  clientTranslator(lang)                │
└───────┬───────────────────────┬───────────────────────┬────────────────┘
        │ React tree            │ imperative            │ catalog
        ▼                       ▼                       ▼
┌──────────────┐  ┌─────────────────────┐  ┌──────────────────────────────┐
│ ToolViews    │  │ recovery-continuation│  │ clientMessages (const catalog) │
│ / React comps│  │ / model parsers      │  │ createTranslator(catalog,lang)│
│ (Worktree…)  │  │ (defaultClient…)    │  │     [src/i18n/core.ts:19]     │
└──────────────┘  └─────────────────────┘  └──────────────────────────────┘
```

The entry wrapper `apply()` (`src/client/index.tsx:49`) installs a `Proxy` over `ctx.slots` so every `register` of a plugin component is transparently wrapped in `<ClientI18nProvider locale={locale}>` (`src/client/index.tsx:53`–`59`), keeping each plugin fiber's locale scope isolated even when multiple client modules mount concurrently.

## Data Flow

**React path (live language switching):**

1. Host provides `locale` via `ctx.get('locale')` → `services.locale` (`src/client/index.tsx:40`).
2. `apply()` wraps each ToolView in `<ClientI18nProvider locale={locale}>` (`src/client/index.tsx:49`–`59`).
3. Inside the provider, `useMemo` builds a store delegating `subscribe` to the LocaleFace and `getSnapshot` to `language ?? readClientLanguage(locale)` (`src/client/i18n.tsx:34`–`37`).
4. `useSyncExternalStore` (`src/client/i18n.tsx:38`) yields the current `Language` and re-renders when the host calls the LocaleFace `subscribe` listener (see `tests/client-i18n.test.tsx:51` `fireEvent` + `locale.change`).
5. Descendant components call `useClientTranslator()` (`src/client/i18n.tsx:43`), which memoizes `clientTranslator(language)` and returns string labels from `clientMessages`.

**Imperative path (locale resolved per call):**

1. Pure functions (`parseCreateTool` `src/client/model.ts:100`, `buildWorktreeRecoveryPrompt` `src/client/review-console/recovery-continuation.ts:378`) default to `defaultClientTranslator` (module-load `'zh'`).
2. When a live `services` object is available, callers resolve language at invocation: `translatorForServices(entry.services)` (`src/client/review-console/recovery-continuation.ts:281`, `:395`, `:435`) reads `services.locale` fresh each time, so a mid-session language switch changes subsequent prompts without re-instantiating the flow (`tests/client-i18n.test.tsx:108`).

**Interpolation contract:** `createTranslator` replaces `{name}` tokens via `String(params[name])`, preserving user/Host data verbatim (CJK, `$&`, `<tag>`, paths) and leaving tokens untouched when the param is absent (`src/i18n/core.ts:23`–`23`; verified by `tests/i18n-core.test.ts:16`). English copy must contain no CJK and must declare exactly the same placeholder names as `zh` (`tests/client-i18n.test.tsx:123`).

## Connections

- **[[client]]** — `src/client/index.tsx` entry point wires the host `locale` service into every plugin ToolView via `ClientI18nProvider` (`src/client/index.tsx:56`–`59`); `src/client/model.ts` and `src/client/review-console/recovery-continuation.ts` consume translators.
- **[[i18n_core]]** — `src/i18n/core.ts` supplies `Language`, `normalizeLanguage`, `MessageCatalog`, `Translator`, and `createTranslator` used by this module (`src/client/i18n.tsx:2`, `:24`).
- **[[i18n_messages]]** — `src/i18n/client-messages.ts` (this module's catalog) is the `clientMessages` source; `tests/i18n-references.test.ts` enforces that all `t("…")` calls in `src/client` resolve to keys here. The sibling catalogs `hostMessages` / `transportMessages` are covered by `tests/i18n-catalogs.test.ts` but live outside this client module.
- **Host locale / DSH Client runtime** — the LocaleFace contract (`getSnapshot`/`subscribe`, `src/client/i18n.tsx:6`) is supplied by the host `locale` service injected in `src/client/index.tsx:36`; `src/client/harness-platform.d.ts` declares the virtual workspace-client module shape.

## Known Issues

- **No fallback language for unknown catalog keys.** `createTranslator` does `catalog[key]![language]` and then replaces placeholders (`src/i18n/core.ts:19`–`23`). If `key` is absent the lookup is `undefined` and `.replace` would throw; the static guard `tests/i18n-references.test.ts:23` mitigates this for `src/client` but does not protect runtime-only or dynamically composed keys.
- **Default translator is frozen at module load.** `defaultClientTranslator` (`src/client/i18n.tsx:26`) is `'zh'` fixed; pure functions that accept it as a default (`parseCreateTool` `src/client/model.ts:100`, `parseReviewTool` `src/client/model.ts:152`, `buildWorktreeRecoveryPrompt` `src/client/review-console/recovery-continuation.ts:378`) will emit Chinese even when the host is English, unless the caller passes a live translator. The recovery flows avoid this by calling `translatorForServices(...)` (`src/client/review-console/recovery-continuation.ts:281`).
- **English detection is prefix-only.** `normalizeLanguage` (`src/i18n/core.ts:4`) treats anything starting with `en` as English and everything else as Chinese, so locales like `fr`, `ja` silently become `'zh'` (documented default in `tests/i18n-core.test.ts:13`), and there is no regionalized Chinese beyond the single `'zh'`.
- **Subscribe safety depends on the host face.** When `locale` is not a valid LocaleFace, `useSyncExternalStore.subscribe` falls back to a no-op `() => {}` (`src/client/i18n.tsx:35`), so the provider will never react to host changes in that misconfigured case; it only resolves language once from `readClientLanguage(locale)`.
- **Catalog is hand-authored and large (1815 lines).** `clientMessages` (`src/i18n/client-messages.ts:4`–`1815`) has no codegen; consistency (non-empty `zh`/`en`, matching params, no CJK in `en`) is enforced solely by `tests/i18n-catalogs.test.ts` and `tests/client-i18n.test.tsx:75`. Adding keys without updating tests breaks CI.
