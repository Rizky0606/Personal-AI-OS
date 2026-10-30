# Rich Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan blok fenced `aios-ui` yang tervalidasi ketat, aman, interaktif, memiliki fallback kode, renderer desktop, dan subset Android.

**Architecture:** Contract menjadi sumber schema, limits, dan fixture. Desktop memakai parser Markdown yang sudah ada: fenced block terbuka menjadi skeleton, block tertutup divalidasi lalu dirender komponen client-owned; kegagalan selalu kembali ke `CodeBlock`. Follow-up interaktif memakai payload contract baru dan dikirim sebagai pesan user, tanpa efek samping lokal. Android memakai fixture/schema payload yang sama, mendukung subset eksplisit.

**Tech Stack:** TypeScript, Zod existing, React, SVG native, CSS token existing, Jetpack Compose/Kotlin, Vitest, React Testing Library.

**Spec:** `docs/RICH_ANSWERS.md`

## Global Constraints

- JSON maksimum 20 KiB.
- Maksimum 12 komponen/blok, 24 titik chart, 100 baris tabel, 20 item list.
- Semua object schema strict; tone hanya semantic.
- Invalid, oversized, unsupported, atau malformed block selalu tampil sebagai code block.
- Tidak ada dependency baru, iframe, HTML injection, evaluator, script execution, atau raw color.
- Interaksi hanya pada jawaban assistant terakhir yang selesai; history read-only.
- OMP/dsh capability diuji; Hermes nonaktif sampai terbukti.
- Android mendukung metric/table/checklist/choices/callout/steps; unsupported tetap code block.

---

### Task 1: Contract schema dan fixture

**Files:**
- Create: `packages/contracts/src/rich-answers.ts`
- Create: `packages/contracts/src/rich-answers.test.ts`
- Create: `packages/contracts/src/fixtures/rich-answers.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/api-schemas.ts`
- Modify: generated `packages/contracts/openapi.json` via existing build

**Interfaces:**
- Produce `RichAnswerSchema`, `RichAnswerFollowUpSchema`, exported limits, inferred types, and `RICH_ANSWER_FALLBACK_LANGUAGE`.
- `RichAnswerFollowUpSchema` shape: `{ blockId, componentId, action: 'choice'|'slider'|'checklist', value: string|string[]|number|boolean }`.
- `SendMessageRequestSchema` adds optional `followUp`.

- [ ] Write failing tests for each valid type, strict unknown properties, malformed values, aggregate limits, oversized serialized input fixture, and follow-up values.
- [ ] Run `pnpm --filter @aios/contracts test -- rich-answers.test.ts`; confirm expected failures.
- [ ] Implement strict discriminated schemas and `superRefine` aggregate limits.
- [ ] Add shared valid/invalid/security fixtures without executable content.
- [ ] Run contract tests and build/OpenAPI generation; confirm pass.

### Task 2: Desktop rich parser and fallback

**Files:**
- Create: `apps/desktop/src/rich/richAnswer.ts`
- Create: `apps/desktop/src/rich/richAnswer.test.ts`
- Modify: `apps/desktop/src/markdown/Markdown.tsx`
- Modify: `apps/desktop/src/markdown/Markdown.test.tsx`

**Interfaces:**
- `parseRichAnswer(code: string): { kind: 'valid'; value: RichAnswer } | { kind: 'invalid' }`.
- `RichAnswer` receives `readOnly`, `onFollowUp`, and stable `blockId`.

- [ ] Write tests for closed valid block, open block skeleton marker, malformed/oversized/unknown/unsupported fallback, and ordinary fenced code unchanged.
- [ ] Run focused desktop Markdown tests; confirm failures.
- [ ] Parse byte length before JSON parsing, validate through contract schema, and expose no raw object to unsafe rendering.
- [ ] Integrate `language === 'aios-ui'`: open code block skeleton; closed valid rich renderer; all invalid cases existing `CodeBlock`.
- [ ] Run focused tests; confirm pass.

### Task 3: Desktop components, SVG chart, accessibility, interaction

**Files:**
- Create: `apps/desktop/src/rich/RichAnswer.tsx`
- Create: `apps/desktop/src/rich/RichAnswer.test.tsx`
- Create: `apps/desktop/src/rich/RichChart.tsx`
- Create: `apps/desktop/src/rich/RichComponents.tsx`
- Create: `apps/desktop/src/rich/rich.css`
- Modify: `apps/desktop/src/chat/AssistantMessage.tsx`
- Modify: `apps/desktop/src/chat/MessageList.tsx`
- Modify: `apps/desktop/src/chat/useChatController.ts`
- Modify: `apps/desktop/src/chat/ChatScreen.tsx`

**Interfaces:**
- `RichAnswer({ value, blockId, readOnly, onFollowUp })` renders one component per supported type.
- Follow-up callback receives `RichAnswerFollowUp` only after user interaction.

- [ ] Write RTL tests for all nine renderers, empty components, semantic tone classes, chart axis/labels/aria summary, read-only history, and follow-up payloads.
- [ ] Run tests to confirm failures.
- [ ] Implement components with existing token classes; use React text nodes only.
- [ ] Implement native SVG bar/line chart with title/desc/aria label and 420ms animation; add 240ms entrance and reduced-motion CSS.
- [ ] Wire `AssistantMessage` and `MessageList` so only last completed assistant receives callback.
- [ ] Wire controller/API send path to send structured `followUp` as a new user message; preserve existing suggestions behavior.
- [ ] Add tests for interaction send and old-message read-only behavior.
- [ ] Run desktop rich/chat tests; confirm pass.

### Task 4: Security and layout verification

**Files:**
- Modify: `apps/desktop/src/rich/RichAnswer.test.tsx`
- Modify: `apps/desktop/src/markdown/Markdown.test.tsx`
- Modify: `apps/desktop/src/rich/rich.css`

- [ ] Add tests for HTML, event attributes, `javascript:`, `data:`, raw style/color/script, long text, excessive nested data, and unsupported type.
- [ ] Verify no DOM execution, no link outside `ExternalLink`, no blank unsupported output, and no horizontal layout break.
- [ ] Run focused security tests.

### Task 5: Role skill and capability gating

**Files:**
- Create: `packages/roles/skills/rich-answers/SKILL.md`
- Modify: role/engine capability type and prompt assembly files identified by existing role tests
- Create/modify: capability tests

- [ ] Add registry test proving skill frontmatter/body validity and correct/incorrect examples.
- [ ] Add engine capability mapping: OMP and dsh enabled only through explicit tested capability; Hermes false.
- [ ] Ensure unsupported engine does not receive rich-answer instruction.
- [ ] Run roles tests and affected prompt tests.

### Task 6: Android subset and shared fixtures

**Files:**
- Create: `apps/android/app/src/main/kotlin/app/aios/android/ui/rich/RichAnswer.kt`
- Create: `apps/android/app/src/main/kotlin/app/aios/android/ui/rich/RichAnswerComponents.kt`
- Create: `apps/android/app/src/androidTest/kotlin/app/aios/android/ui/RichAnswerTest.kt`
- Modify: existing Android Markdown/chat renderer and API model only where required
- Reuse: `packages/contracts/src/fixtures/rich-answers.ts` through existing test fixture export mechanism

- [ ] Write Compose tests for supported six types, unsupported chart/slider/kv fallback, invalid block fallback, and choice interaction payload.
- [ ] Run Android focused tests; confirm failures.
- [ ] Implement strict payload dispatch and Compose components using existing theme tokens.
- [ ] Render unsupported/invalid as code block, never empty.
- [ ] Run Android tests and compile.

### Task 7: Verification and cleanup

**Files:**
- Modify generated contract artifacts only through existing generation.
- Modify docs only if verification reveals a contract mismatch.

- [ ] Run affected contract, desktop, roles, and Android tests.
- [ ] Run affected typecheck/build, ESLint, Prettier, and `git diff --check`.
- [ ] Perform manual desktop smoke: streaming open fence skeleton, close fence render, invalid fallback, choice follow-up, old answer readonly.
- [ ] Report environment blockers without weakening tests or claiming unrelated suites pass.
