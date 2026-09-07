# @larkup/core

## 0.5.4

### Patch Changes

- 4130731: Prefer the local Playwright crawler when Docker is available so JavaScript-protected pages can be scraped. Start it in the background with visible readiness and fallback status, retain the native fallback, and reject Anubis challenge pages.

## 0.5.3

### Patch Changes

- 36e524c: Keep large spreadsheet query results and tabular follow-up context bounded while preserving full-data aggregations.

## 0.5.2

### Patch Changes

- 2bb75fa: Persist packaged local projects, credentials, uploads, indexes, installed tools, and Video Intelligence runtime data outside the npm installation, with automatic migration from the legacy package-local directory. Keep Video Intelligence available when a Hub catalog is incomplete, and require a fresh visual pass for exhaustive PDF diagram questions.

## 0.5.1

### Patch Changes

- 81abfcb: Stabilize plain, spreadsheet, PDF, and generated-agent chat by filtering unavailable tools,
  closing UI streams without lifecycle deadlocks, normalizing API messages, preserving accurate
  tabular aggregations, routing the leading source, and recovering friendly responses. Reuse indexed
  PDF descriptions, render image previews reliably, and let additional file uploads join active
  background indexing queues.
- Updated dependencies [847b502]
  - @larkup/vector-stores@0.1.27

## 0.5.0

### Minor Changes

- 738ba6c: feat(agent): channels, execution environments, and the deployable Agent Runtime bundle (TASK 06–08)

  **Channels (TASK 06).** New `@larkup/connections` with the shared dispatch
  pipeline — verify → parse → de-duplicate → run → deliver with retries — plus
  Webhook (HMAC-SHA256, replay window) and Telegram (secret token, message
  splitting, `setWebhook`) adapters. Inbound route, channel management API,
  provider health checks, and a dashboard panel. Channel conversations get a
  bounded server-side session store so a Telegram thread remembers its context.

  **Execution environments (TASK 07).** Every target now carries explicit resource
  limits, a `worker` profile sized for media work, and `admitTool()` returning a
  visible decision instead of silently skipping a tool. Refusals surface in
  `/api/agents/:id/health` with the reason.

  **Agent Runtime bundle (TASK 08).** `GET /api/agents/:id/bundle` generates a
  portable container carrying one immutable release: one Dockerfile for every
  target, Cloud Run and Compose configuration, the widget, and a runbook. Every
  credential is stripped from the image and injected at run time. Structured JSON
  events with correlation ids and credential scrubbing.

  **Fixes**

  - Publishing a release now activates it. Previously a first publish left the
    agent answering "no active release — publish one first".
  - `POST /api/agents` no longer drops `joinCode` and `channels`.
  - The operator agent API no longer returns retrieval keys, join codes, or
    channel tokens in the clear; a redaction sentinel keeps edit round-trips safe.

  See [ADR-010](docs/adrs/adr-010-channels-execution-and-deployment.md).

- 738ba6c: feat(agent-runtime): rate limiting on browser-facing Agent endpoints (plan §8.5)

  Closes the one remaining launch blocker in TASK 08: the `allowedOrigins`
  allow-list answered _who_ may call an agent, not _how much_ — an
  allow-listed page with a loop, or a scraped snippet replayed from a headless
  browser, could spend the operator's model budget with nothing to stop it.

  **New in `@larkup/agent-contracts`**: `rate-limit.ts` — a `RateLimiter`
  interface plus `MemoryRateLimiter`, a token-bucket implementation (mirroring
  `IdempotencyStore`'s in-memory-by-default shape from `@larkup/connections`).
  Backs three limits:

  - **Requests/minute per visitor** (`hash(agentId + IP + UA)`, burst 5,
    sustains 20/min) — checked in `authorizeAgentRequest`, immediately after
    the origin check, so it covers every browser-facing agent endpoint.
  - **Messages/session** (50, no refill within a session).
  - **Daily token ceiling per agent** — operator-set, off by default. A raw
    token count rather than a dollar figure: there is no per-model pricing
    table in the codebase yet, so this reports what the runtime actually
    knows (`usage.totalTokens` from `onFinish`) rather than inventing a
    pricing model. Configurable in the dashboard's agent Connect dialog.

  Denials are `429` with `Retry-After` and `X-RateLimit-Remaining`, carrying
  CORS headers so a blocked browser reports the reason instead of an opaque
  `Failed to fetch`.

  `@larkup/core`'s `streamAgentChatResponse` gains an optional `onUsage`
  callback so `apps/web` can charge the daily ceiling without `packages/core`
  depending on anything in `apps/web`. The generated Agent Runtime bundle
  (`agent-runtime-server.ts` → `server.mjs`) mirrors the same three checks in
  plain JavaScript, extending the existing origin-matcher/wire-protocol
  duplication rather than inventing a new seam.

  `@larkup/agent-widget` maps a `429` from `/chat` to a fixed message, "Too
  many messages — try again in a minute," regardless of which of the three
  limits tripped.

  See [ADR-011](docs/adrs/adr-011-agent-rate-limiting.md) for the full design
  and the identity/trust-boundary reasoning (`X-Forwarded-For`'s last hop
  only, no cookie or fingerprint).

- Add the Marketplace v3 extension/runtime/billing contract and the installable cloud-first Video Intelligence tool with automatic device-scoped cloud connections, managed AWS deployment, quota controls, indexing briefs, durable timestamped chat evidence, audio-provider settings, and temporary capacity requests.
- Add Direct and Proxy MCP connection types, with redacted proxy credentials and proxy-aware transport routing.
- Fix a budget-policy mismatch that silently skipped the bounded re-inspection needed to answer outcome questions ("who won") on standard installs, by dispatching it as sequential chunks instead of one oversized request. Ground named-person questions ("what was X wearing") to a transcript mention of that name instead of describing the scene generically. Replace the always-on "Supporting clip" video embed and the raw internal progress text with a collapsed-by-default citation card rendered through the same generic chat-result UI contract every marketplace tool uses, an inline chat progress bar for any long-running tool call, and a GPU-cold-start indicator that only shows while a worker is still waking up.
- b2f4aa2: Make indexed video evidence findable and answerable.

  Retrieval now ranks the evidence at its own timestamps using the workspace
  embedding model, so a question asked in one language locates a moment recorded
  in another; the corpus only ever matched chapter-sized documents, and lexical
  scoring matched nothing at all across languages. Every timestamped signal is
  fused into a short ranked list of windows, which both aims bounded source
  inspection and gives the model a compact map to navigate by, replacing offsets
  computed from the recording's length.

  A conclusion, a count, and a comparison are settled by reading across records
  rather than by finding one that states the answer. Requiring a single record
  made those questions report the source as silent even when its closing state was
  plainly indexed; they are now answered from a chronological trail, with the
  answering rule stating how far that trail goes.

  Also fixes: the chapter/scene hierarchy was scoped to one revision, so a single
  refinement replaced the whole map of a source; the loader served a workspace
  tool's stale build until the host restarted; and a live analysis showed a
  completed progress bar for the minutes of work that follow the worker's own pass.

- b2f4aa2: Make video indexing and retrieval work the same for any kind of video, and
  make an indexing job's progress reflect the work it is doing.

  Indexing and retrieval both carried rules written for one kind of footage: a
  question planner that branched on sport vocabulary in English and Arabic, an
  OCR pass that only kept paired numbers under 30, and prompts that told the
  reader how to interpret a two-sided display. Those rules answered a narrow set
  of questions on a narrow set of videos and quietly distorted everything else.
  They are replaced by signals that mean the same thing in any recording: which
  short on-screen text persists and when it changes, whether a question wants one
  fact or the whole source, and whether a state sequence is consistent with
  itself over time.

  The retrieval agent now runs one gap-driven loop rather than a set of
  per-question-type rules: it retrieves, decides what the evidence still lacks,
  watches the moments the index pointed at, and re-checks. Independent moments are
  watched together instead of one after another, which cuts a multi-range turn to
  roughly the cost of its slowest look, and a runtime that admits one job at a
  time is handled by falling back to one at a time rather than failing the turn.
  An answer a question was watched for is now recognised by what produced it,
  rather than by the reader repeating the question back.

  Progress is budgeted by how long each phase actually takes and advances between
  milestones, so the bar moves the whole way through rather than sitting still and
  then jumping. The runtime reports how far through its current stage it is, so a
  host rendering one bar per step no longer keeps its own copy of that budget.

  The three coverage modes now have non-overlapping budgets, so Fast can no longer
  plan more work than Balanced.

  The index's own reconciled account is now published as retrievable evidence.
  The runtime already cross-checks every reading of a moment against the rest of
  the timeline, but only the raw readings reached retrieval, so chat could answer
  from a reading the index had already set aside. Evidence that reconciles other
  evidence now leads the answer.

  The managed cloud worker's bulk reader moves to a stronger model. Measured on
  the same GPU and source, the previous one misread a two-sided on-screen display
  and produced a wrong index while also finishing slower, because a weaker reader
  costs more retries than it saves.

### Patch Changes

- 738ba6c: feat(agent-widget): embeddable website widget with origin allow-listing (TASK 05)

  Adds the Website Widget channel — the first entry in the channel delivery order.

  **New package `@larkup/agent-widget`**: a single self-contained IIFE bundle
  (~69 kB gzipped) that mounts a floating chat bubble into a Shadow DOM on any
  website. Installed with one script tag:

  ```html
  <script async src="https://your-host/api/widget.js" data-agent="support-bot"></script>
  ```

  It renders only the allow-listed output-block protocol (ADR-005), carries no
  secret beyond the public Agent ID (ADR-004), and parses the UI Message Stream
  directly so it is not coupled to the server's AI SDK version.

  **`@larkup/agent-contracts`**: new `origin` module (shared allow-list matcher and
  CORS header policy) and `protocol` module (normalizes flat `{ role, content }`
  messages and AI SDK `UIMessage` parts into one runtime shape).

  **Agent API**: `POST /api/agents/:id/chat` now enforces the agent's
  `allowedOrigins` list and answers CORS preflights; new
  `GET /api/agents/:id/public` serves a redacted agent view for browsers; new
  `GET /api/widget.js` serves the widget bundle. `authMode: "join-code"` is
  enforced; `"api-key"` fails closed with 501 until the scoped key store exists.

  **Dashboard**: Settings → Agents → **Connect** gives copy-pasteable install
  snippets, an allowed-origins editor with a wildcard warning, and widget styling.

  See [ADR-009](docs/adrs/adr-009-widget-isolation-and-origins.md) for the
  isolation and origin-policy decisions.

- b2f4aa2: Export the Core stores and video-knowledge modules consumed by application packages.
- b2f4aa2: Speed up video questions by diversifying repeated evidence before trimming, excluding inspection protocol text from retrieval, and resolving corroborated multimodal result scenes without unnecessary live re-analysis.
- 790a298: fix: define the missing `persistApiKey` helper and clear the two standing `tsc` errors (TASK 01 tail)

  `apps/web/components/server/deploy-sheet.tsx` called `persistApiKey(sid, apiKey)`
  on the SSH deploy path, but the function was never defined — a `ReferenceError`
  waiting to happen and a standing `tsc` error. It's now a small helper that
  `POST`s to `/api/config/credentials`, awaited before the deploy payload is
  built so the deploy request can no longer race the credential write.

  `StoredCredentials.serverApiKey` is a single flat value for the workspace, not
  keyed per server, matching what the Vercel deploy path already does — the
  helper takes just the key, not a server id, rather than implying per-server
  support the store doesn't have.

  Also fixes:
  - `server-section.tsx`: an interval ref typed via
    `ReturnType<typeof window.setInterval>` resolved to `NodeJS.Timeout` (from
    `@types/node`'s merged overload) instead of the `number` the DOM call
    actually returns. Typed directly as `number`.
  - `generate-agent-runtime.ts`: the bundle's file list was typed as
    `GeneratedFile[]` before the `language` field was attached by the trailing
    `.map()`, so every literal failed the type check. Typed the pre-`map` array
    as `Pick<GeneratedFile, 'path' | 'contents'>[]` instead.
  - `e2e/tests/web-ui/04-server.spec.ts`: the "cloud deployments link directly
    to their API reference" test seeded the legacy `rag_server_api_key`
    localStorage key, which `server-section.tsx` no longer reads — it loads the
    key from `/api/config/credentials`. The test now seeds through that same
    endpoint.
  - `e2e/tests/sdk/js-sdk.spec.ts`: reverted an in-flight edit that imported
    `LarkupClient` from the `apps/sdk/js-sdk` package directory (unsupported for
    a relative import under Node ESM) back to the working `src/index` import.
    This was blocking Playwright's test collection for the entire suite, not
    just the SDK tests.

  `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` is clean, `pnpm turbo
type-check build` is green, and the full E2E suite passes.

- b2f4aa2: Keep media indexing visibly active without pretending that unmeasured work is complete. URL downloads publish heartbeats plus measured byte, speed, percentage, and ETA telemetry; worker stage updates retain tenths; and the UI smoothly interpolates sparse updates while fresh worker activity is present, stopping when telemetry is stale or paused and never claiming completion.
- Bundle locally linked Marketplace tools into generated remote Agent runtimes, so deployment does not depend on an unpublished npm release.
- fix: restart media indexing elapsed time on retry and show one continuous overall progress bar
- Add a Docker-free local runtime for trusted Python and JavaScript analysis, alongside hardened provider verification and reusable remote snapshots.
- Improve project settings with portable Agent Skills, runtime filtering, current installed-tool manifests, and expanded Video Intelligence configuration. Agent Server deployments now expose tool discovery plus AI SDK and OpenAI-compatible streaming endpoints, grouped separately from Knowledge endpoints in Scalar. Add text streaming helpers, chat-model discovery, and guarded per-request provider/model selection to the JavaScript and Python SDK clients. AI Gateway runtimes list their available language models; direct-provider runtimes remain constrained to their configured provider. Align `larkup chat --model` with the configured provider so a Gateway key is never routed to a direct vendor.
- 5d9b483: feat(channels): Slack channel adapter (plan §9, third after Webhook and Telegram)

  `packages/connections/src/adapters/slack.ts` — `verify`/`parse`/`send`/`health`
  against the shared `ChannelAdapter` contract, no changes to the contract
  itself:

  - `verify`: Slack's `X-Slack-Signature: v0=<hex>` over `v0:{timestamp}:{rawBody}`,
    HMAC-SHA256, timing-safe compare, 5-minute replay window — the same shape
    as the generic webhook channel's scheme.
  - `parse`: normalizes a `message` event, ignoring anything with a `subtype`
    (edits, deletes, bot relays) or a `bot_id` (never answer another bot — two
    bots would loop forever). Keys idempotency on Slack's `event_id`, which is
    stable across the retries a slow reply causes.
  - `send`: `chat.postMessage`, checking the JSON body's `ok` field rather than
    the HTTP status — Slack's Web API answers 200 even on failure.
  - `health`: `auth.test`, reporting the connected bot's identity.
  - No `registerWebhook` — Slack has no API to set the Events API Request URL;
    an operator pastes it into the Slack app dashboard by hand.

  New: `slackUrlVerificationChallenge()`, the one-time handshake Slack fires
  when that URL is saved. Handled at the inbound route
  (`apps/web/app/api/agents/[agentId]/channels/[channelId]/route.ts`) and
  mirrored in the generated bare-Node server, both _after_ the same signature
  check `dispatchInbound` would run and _before_ calling it — `{ challenge }`
  doesn't fit the dispatcher's fixed `{ ok, error?, detail? }` result, and this
  isn't a message to dispatch. See
  [ADR-014](docs/adrs/adr-014-slack-channel.md) for why this stayed a
  route-level special case instead of a change to `ChannelAdapter`, and the
  precedent it sets for WhatsApp and Discord.

  Also fixes a real bug this work surfaced: a stray backtick inside a plain-JS
  comment in `agent-runtime-server.ts` (the generated `server.mjs`'s source,
  a giant `String.raw` template literal) silently closed the template early,
  breaking every generated bundle — invisible to `tsc` (the literal is just a
  string to TypeScript) and to the existing bundle tests (substring checks
  only, nothing ever parsed the output). Fixed, and
  `e2e/tests/api/agent-runtime-bundle.spec.ts` now has a test that actually
  runs `node --check` against the generated `server.mjs`.

  No dashboard changes needed — the channel list, settings form, and health
  card are all driven by `listChannels()`/`getChannel()`, so Slack appears
  automatically once registered.

- b2f4aa2: Require direct visual verification before answering a final result from a
  paired-value OCR candidate, return long-video timelines from indexed timestamped evidence,
  preserve generic subject-relation-value bindings and reject terminal mappings
  that conflict with independent chronology across any video genre,
  standardize Vercel Gateway credentials on `AI_GATEWAY_API_KEY`, preserve
  local-runtime chat progress, and purge local source/result caches when their
  media or linked knowledge is deleted.
- Updated dependencies
  - @larkup/vector-stores@0.1.26

## 0.4.2

### Patch Changes

- aa75e4b: Route native AI providers independently from Vercel AI Gateway, refresh the direct Gemini tool-call catalog, correct Gemini embedding metadata, and prevent ingestion before embeddings are configured.

## 0.4.1

### Patch Changes

- Updated dependencies [c12b4ec]
  - @larkup/vector-stores@0.1.25

## 0.4.0

### Minor Changes

- 07e35de: Add the evidence-first Video Knowledge Engine foundation: durable revisions and
  jobs, bounded media inspection, source-grounded citations, and public video
  knowledge citation types.

## 0.3.4

### Patch Changes

- d7d293c: Make Chat retrieval-only, reliably parse PDFs in Next deployments, simplify website entry, and prevent stale Video & Audio metadata from requiring a host ffmpeg installation.

## 0.3.3

### Patch Changes

- e40bbe8: Make the built-in crawler available without Docker setup, route native requests through saved proxy settings, and report empty failed crawls accurately.

## 0.3.2

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.

## 0.3.1

### Patch Changes

- Updated dependencies [8b470e7]
  - @larkup/vector-stores@0.1.24

## 0.3.0

### Minor Changes

- 02fbbba: Added smart video indexing capabilities:
  - `@larkup/core`: Added `indexingInstructions` and `indexingQuality` to `MediaAsset`.
  - `@larkup/tool-video-audio`: Implemented running state carry-forward and cumulative state extraction for multimodal segments.

## 0.2.6

### Patch Changes

- Improve smart RAG and web fallback, PDF visual retrieval, and resilient video indexing.

## 0.2.5

### Patch Changes

- 2a0a7e2: Improve automatic indexing and media processing controls, make settings navigation resilient to slow tool loading, and keep knowledge-base retrieval ahead of web search.

## 0.2.4

### Patch Changes

- Updated dependencies [197c629]
  - @larkup/vector-stores@0.1.23

## 0.2.3

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.

## 0.2.2

### Patch Changes

- 6241db2: Prevent chat responses from rendering unverified image URLs and clarify the single-port Docker web app launch.

## 0.2.1

### Patch Changes

- Updated dependencies [08e7029]
  - @larkup/vector-stores@0.1.22

## 0.2.0

### Minor Changes

- efc6810: Add folder and media indexing, corpus management, Marketplace Hub operations, deployment and update commands, browser opening, CLI validation, streaming chat, complete RAG endpoint coverage, bulk SDK indexing progress, and typed Hub discovery.
- 843ef5c: Add caption-first YouTube indexing, bounded long-form audio transcription, scene-aware video indexing, outcome-aware ending retrieval, media processing analytics, and timestamped chat citations.

### Patch Changes

- 5caaf2f: feat: support persistent S3-compatible LanceDB storage for serverless deployments
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- b7bc6fe: Pin generated server AI SDK provider packages to compatible major versions so embedding and query endpoints do not mix incompatible model specifications.
- Updated dependencies [5caaf2f]
  - @larkup/vector-stores@0.1.21
