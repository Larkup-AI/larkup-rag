# larkup

## 0.2.12

### Patch Changes

- 36e524c: Keep large spreadsheet query results and tabular follow-up context bounded while preserving full-data aggregations.
- 36e524c: Resolve stale yt-dlp post-processing file paths before storing imported videos.
- Updated dependencies [36e524c]
  - @larkup/core@0.5.3
  - @larkup/marketplace@0.2.3
  - @larkup/tool-doc-editor@0.2.20
  - @larkup/scraper@0.1.42

## 0.2.11

### Patch Changes

- 7cd86a5: Use saved AI Models credentials for Video Intelligence by default, keep managed-cloud usage tied to a stable device identity after uninstall, bound media URL checks, and preserve the selected add-page group during media indexing.

## 0.2.10

### Patch Changes

- 5bab80c: Fix: autoload the API key from the LLM provider for the vision provider in video intelligence when no vision provider is explicitly configured.

## 0.2.9

### Patch Changes

- Fix global installation and updates by publishing resolvable internal dependencies, checking npm's published version, and showing clear update status.

## 0.2.7

### Patch Changes

- 22c1e83: `larkup update`: check version before running npm install — shows bold "Already up to date" banner when current, dim gray text during install, and bold success banner after update. Stops re-running npm install when nothing to upgrade.

## 0.2.6

### Patch Changes

- Updated dependencies [3b3b030]
  - @larkup/tool-doc-editor@0.2.19

## 0.2.5

### Patch Changes

- 275a7ee: fix(ai): improve video intelligence outcome routing and index preservation

## 0.2.4

### Patch Changes

- 2bb75fa: Persist packaged local projects, credentials, uploads, indexes, installed tools, and Video Intelligence runtime data outside the npm installation, with automatic migration from the legacy package-local directory. Keep Video Intelligence available when a Hub catalog is incomplete, and require a fresh visual pass for exhaustive PDF diagram questions.
- Updated dependencies [2bb75fa]
  - @larkup/core@0.5.2
  - @larkup/marketplace@0.2.2
  - @larkup/tool-doc-editor@0.2.18
  - @larkup/scraper@0.1.41

## 0.2.3

### Patch Changes

- 847b502: Keep global installs and updates quiet and compatible by aligning Apache Arrow with LanceDB's
  supported peer range, shipping the marketplace TypeScript runtime loader, and using the renamed
  Daytona SDK package. Public tarballs also scrub local project state from all traced workspaces.
- 81abfcb: Stabilize plain, spreadsheet, PDF, and generated-agent chat by filtering unavailable tools,
  closing UI streams without lifecycle deadlocks, normalizing API messages, preserving accurate
  tabular aggregations, routing the leading source, and recovering friendly responses. Reuse indexed
  PDF descriptions, render image previews reliably, and let additional file uploads join active
  background indexing queues.
- Updated dependencies [847b502]
- Updated dependencies [81abfcb]
  - @larkup/marketplace@0.2.1
  - @larkup/sandbox@0.1.4
  - @larkup/vector-stores@0.1.27
  - @larkup/core@0.5.1
  - @larkup/tool-doc-editor@0.2.17
  - @larkup/scraper@0.1.40

## 0.2.2

### Patch Changes

- Use clear, non-technical wording for the Larkup cache setting.

## 0.2.1

### Patch Changes

- Add safe build-cache size reporting and confirmed cleanup in Settings, wait for the exact npm tarball before release installer smoke tests begin, and document the current Video Intelligence collaboration roadmap.

## 0.2.0

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

- Add the Marketplace v3 extension/runtime/billing contract and the installable cloud-first Video Intelligence tool with automatic device-scoped cloud connections, managed AWS deployment, quota controls, indexing briefs, durable timestamped chat evidence, audio-provider settings, and temporary capacity requests.
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

- b2f4aa2: Video indexing now takes notes instead of describing frames, and a chat question
  that the index cannot settle is answered by re-reading the source directly
  instead of dispatching a re-index.

  **Indexing.** The per-clip reader was instructed to describe only what a clip's
  own pixels showed and never to use on-screen text or speech to identify anyone,
  which produced entries like "a man in a jersey sits on a couch" alongside
  detector class lists ("person, chair, couch"). It now writes notes the way a
  person would if they had to answer questions from them later: what happened and
  what changed, who was involved and what established each identity, and every
  informative piece of on-screen text read exactly and attached to what it labels.
  How much a note carries scales with the requested coverage (fast / balanced /
  thorough), and the indexing hint steers what gets the most detail. Detector class
  lists and low-confidence text no longer enter the searchable notes at all; both
  remain queryable as their own evidence.

  **Answering.** A question the index could not settle previously dispatched a
  bounded re-index: a cold GPU worker, minutes of wall time, and frequently a turn
  that expired before it returned, which reached the user as the video not showing
  something it plainly did. The host now exposes a `reWatch` capability that
  samples the candidate windows off the source and reads them in one multimodal
  request per window, with the windows read together. The dispatched path remains
  as the fallback behind it.

  **Transcription.** Local Whisper ran with voice detection always on. Over
  continuous background noise it discards speech rather than finding silence: on a
  noisy source it kept 2 segments where a second pass without it recovered 66, and
  a whole recording indexed with 5% of its speech. It now measures how much of the
  source the first pass found and re-decodes without voice detection when that is
  implausibly low, keeping whichever pass heard more.

  Also fixes three answering bugs found while testing against a real index:

  - A question settled by a trail of evidence rather than one record returned an
    empty evidence list, so the reply had nothing to cite and reported the source
    as silent.
  - A question about a conclusion spent one of its bounded looks on the opening of
    the source, where the answer cannot be.
  - A question about a whole progression spread its looks evenly across the
    source, landing between the moments it changed instead of on them.

  Also raises the reader's output budget. Current readers spend most of a small
  budget before emitting any content, so the previous interactive ceiling produced
  truncated, unparseable results rather than shorter ones.

  Measured on a 14.6-minute source: indexing 131s (balanced), and a bounded
  re-watch 660ms to sample plus ~14s to read, against minutes for the dispatched
  path.

### Patch Changes

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

- Load installed Marketplace agent actions dynamically in chat, with validated schemas, collision protection, execution context, and workflow metadata. Video Intelligence now owns its bounded evidence-refinement action and declarative chat behavior.
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
- Add provider-neutral public webhook ingress metadata and let local Projects create an ngrok HTTPS tunnel for direct channel integrations. Managed Slack OAuth now registers that tunnel with Larkup Proxy automatically.
- b2f4aa2: Make indexed video answers RAG-first, share one bounded fallback-analysis deadline, animate per-call chat progress, expose matched indexed context with timestamps, automatically paginate broad questions, and remove answer-cache shortcuts.
- fix: restart media indexing elapsed time on retry and show one continuous overall progress bar
- Improve project settings with portable Agent Skills, runtime filtering, current installed-tool manifests, and expanded Video Intelligence configuration. Agent Server deployments now expose tool discovery plus AI SDK and OpenAI-compatible streaming endpoints, grouped separately from Knowledge endpoints in Scalar. Add text streaming helpers, chat-model discovery, and guarded per-request provider/model selection to the JavaScript and Python SDK clients. AI Gateway runtimes list their available language models; direct-provider runtimes remain constrained to their configured provider. Align `larkup chat --model` with the configured provider so a Gateway key is never routed to a direct vendor.
- b2f4aa2: Estimate playlist watch URLs from the selected video when importing a single item, preserve full-playlist estimates when requested, and calibrate Fast coverage to a five-to-six-minute typical range for a one-hour video.
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

- Improve grounded chat retrieval, complete structured tool responses more reliably, and prevent PDF image indexing when no vision model is available.
- Allow deployment requests to create Vercel projects with automatic framework detection, track Vercel lifecycle states for remote runtimes, retain deployment vector-store settings in the Project, and preserve the selected Runtime tab in the URL. Successful deployments now open Cloud deployments automatically, where users can copy a saved endpoint or locally retained API key and remove a deployment record. Deployments can now explicitly inherit or override the AI chat provider, model, and provider key.
- b2f4aa2: Require direct visual verification before answering a final result from a
  paired-value OCR candidate, return long-video timelines from indexed timestamped evidence,
  preserve generic subject-relation-value bindings and reject terminal mappings
  that conflict with independent chronology across any video genre,
  standardize Vercel Gateway credentials on `AI_GATEWAY_API_KEY`, preserve
  local-runtime chat progress, and purge local source/result caches when their
  media or linked knowledge is deleted.
- b2f4aa2: Improve Video Intelligence cloud usage, model verification, and local runtime controls.
- fix: isolate malformed vision and OCR model output so a single frame cannot fail video indexing
- b2f4aa2: Preserve answer-level chronological evidence in video chat, use direct analysis only when the indexed trail is incomplete, and publish source-language cross-scene story notes built from speech and visual evidence. Complete source inventories bypass the answer model's context limit, while bounded re-watches can settle a claim only when they explicitly answer the question.
- Updated dependencies [738ba6c]
- Updated dependencies [738ba6c]
- Updated dependencies [738ba6c]
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies [790a298]
- Updated dependencies [b2f4aa2]
- Updated dependencies [bf44a90]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [5d9b483]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
  - @larkup/connections@0.2.0
  - @larkup/core@0.5.0
  - @larkup/marketplace@0.2.0
  - @larkup/integrations@0.2.1
  - @larkup/vector-stores@0.1.26
  - @larkup/sandbox@0.1.3
  - @larkup/tool-doc-editor@0.2.16
  - @larkup/scraper@0.1.39

## 0.1.76

### Patch Changes

- 514dcd7: Persist generated-server workspace data at the Docker runtime path and discard npm install caches so repeated server launches do not fill Docker storage.

## 0.1.75

### Patch Changes

- ee1db5d: Expose the generated RAG server launched from Settings on Docker port 8080 so its API reference is reachable at `/reference`.

## 0.1.74

### Patch Changes

- 71bf56f: Resolve the Nano ID denial-of-service advisory by requiring a patched Nano ID release.

## 0.1.73

### Patch Changes

- f44fa11: Preserve request validation errors while blocking data ingestion until an embedding provider is configured.

## 0.1.72

### Patch Changes

- aa75e4b: Route native AI providers independently from Vercel AI Gateway, refresh the direct Gemini tool-call catalog, correct Gemini embedding metadata, and prevent ingestion before embeddings are configured.
- Updated dependencies [aa75e4b]
  - @larkup/core@0.4.2
  - @larkup/marketplace@0.1.25
  - @larkup/scraper@0.1.38
  - @larkup/tool-doc-editor@0.2.15
  - @larkup/tool-video-audio@0.5.0

## 0.1.71

### Patch Changes

- 81c7c57: Improve media setup guidance and YouTube URL previews, and preserve ordered-list numbering in chat replies.

## 0.1.70

### Patch Changes

- 66d8dba: Use the Warm Ivory theme by default for new web workspaces while preserving saved theme preferences.

## 0.1.69

### Patch Changes

- 4fb5aba: Fix standalone native runtime bindings for E2E and production.

## 0.1.68

### Patch Changes

- Make the standalone postbuild compatible with Docker release images.

## 0.1.67

### Patch Changes

- c12b4ec: Pin Apache Arrow to the range supported by LanceDB to prevent npm peer-dependency warnings during installation. Include public images in the standalone server bundle so logos and icons load after installing Larkup from npm.
- Updated dependencies [c12b4ec]
  - @larkup/vector-stores@0.1.25
  - @larkup/core@0.4.1
  - @larkup/marketplace@0.1.24
  - @larkup/scraper@0.1.37
  - @larkup/tool-doc-editor@0.2.14
  - @larkup/tool-video-audio@0.5.0

## 0.1.66

### Patch Changes

- be8763c: Fix installer removal leaving files and optimize CI pipeline

## 0.1.65

### Patch Changes

- 5d04242: Add a confirmed `larkup remove` command that removes the global installation and its local data.

## 0.1.64

### Patch Changes

- Keep local workspace data, environment files, and duplicated dependencies out
  of the standalone npm artifact.

## 0.1.63

### Patch Changes

- Updated dependencies [07e35de]
  - @larkup/core@0.4.0
  - @larkup/tool-video-audio@0.5.0
  - @larkup/marketplace@0.1.23
  - @larkup/scraper@0.1.36
  - @larkup/tool-doc-editor@0.2.13

## 0.1.62

### Patch Changes

- 7805168: Align the npm runtime dependency on Next.js with the standalone production build.

## 0.1.61

### Patch Changes

- 81a619b: Ship only the standalone production runtime in the npm package and externalize the SSH runtime dependency during the Next.js build.

## 0.1.60

### Patch Changes

- 9962fb6: Add searchable, type-filtered integration resource selection in the data panel.
- Updated dependencies [561c800]
  - @larkup/integrations@0.2.0

## 0.1.59

### Patch Changes

- e8366d0: Fix PDF uploads in standalone deployments.

## 0.1.58

### Patch Changes

- 9a565c8: Make chat retrieval resilient to partial index runs, reuse successful evidence for clear follow-up questions, and keep retrieval-only responses free of internal implementation details. Media previews are available when supported by retrieved evidence.

## 0.1.57

### Patch Changes

- 57a3be9: Offer a one-click Video & Audio tool update when an older installation asks the user to install yt-dlp manually.
- Updated dependencies [57a3be9]
  - @larkup/marketplace@0.1.22
  - @larkup/tool-video-audio@0.3.6
  - @larkup/tool-doc-editor@0.2.12

## 0.1.56

### Patch Changes

- 4398407: Automatically prepare the official yt-dlp executable for YouTube imports, removing the host installation requirement.
- Updated dependencies [4398407]
  - @larkup/marketplace@0.1.21
  - @larkup/tool-video-audio@0.3.5
  - @larkup/tool-doc-editor@0.2.12

## 0.1.55

### Patch Changes

- 7601d83: Update Video & Audio from the Media page when an installed tool is stale, and prefer the newest marketplace catalog version so packaged ffmpeg helpers load correctly after installation.
- Updated dependencies [7601d83]
  - @larkup/marketplace@0.1.20
  - @larkup/tool-video-audio@0.3.4
  - @larkup/tool-doc-editor@0.2.12

## 0.1.54

### Patch Changes

- d7d293c: Make Chat retrieval-only, reliably parse PDFs in Next deployments, simplify website entry, and prevent stale Video & Audio metadata from requiring a host ffmpeg installation.
- Updated dependencies [d7d293c]
  - @larkup/core@0.3.4
  - @larkup/marketplace@0.1.19
  - @larkup/scraper@0.1.35
  - @larkup/tool-doc-editor@0.2.12
  - @larkup/tool-video-audio@0.3.3

## 0.1.53

### Patch Changes

- bde8141: Allow bundled video and audio files to stage before optional processing is configured.

## 0.1.52

### Patch Changes

- 23cb4ee: Keep video and audio staging responsive when a browser cannot read media metadata, and stabilize media E2E selectors.

## 0.1.51

### Patch Changes

- 426c3e3: Make the chat history control accessible and keep production E2E checks aligned with the configured server port.

## 0.1.50

### Patch Changes

- ebd798e: Search indexed media before web search for named match-result and score questions, so chat answers can use video evidence without requiring users to repeat that the recording was uploaded.
- 2d0d490: Improve AI Gateway rate-limit recovery and make video processing use bundled ffmpeg binaries without a system dependency.
- e40bbe8: Harden installer validation across supported operating systems and align bundled runtime requirements with Node.js 22.
- e40bbe8: Make the built-in crawler available without Docker setup, route native requests through saved proxy settings, and report empty failed crawls accurately.
- 2d0d490: Simplify the knowledge-ingestion experience with background website crawling, unified media entry, and separate Add and Knowledge Base navigation.
- Updated dependencies [0f990fc]
- Updated dependencies [2d0d490]
- Updated dependencies [e40bbe8]
  - @larkup/tool-video-audio@0.3.3
  - @larkup/marketplace@0.1.18
  - @larkup/scraper@0.1.34
  - @larkup/core@0.3.3
  - @larkup/tool-doc-editor@0.2.11

## 0.1.49

### Patch Changes

- 3537604: Keep optional video and audio binaries outside the Next.js server bundle.

## 0.1.48

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.
- Updated dependencies [aae57aa]
  - @larkup/core@0.3.2
  - @larkup/marketplace@0.1.17
  - @larkup/tool-video-audio@0.3.2
  - @larkup/scraper@0.1.33
  - @larkup/tool-doc-editor@0.2.10

## 0.1.47

### Patch Changes

- Updated dependencies [5da7a99]
  - @larkup/tool-video-audio@0.3.1
  - @larkup/marketplace@0.1.16
  - @larkup/tool-doc-editor@0.2.9

## 0.1.46

### Patch Changes

- Updated dependencies [f23cba6]
  - @larkup/marketplace@0.1.15
  - @larkup/tool-doc-editor@0.2.9
  - @larkup/tool-video-audio@0.3.0

## 0.1.45

### Patch Changes

- 8b470e7: fix: add missing apache-arrow dependency and silence docker error spam

  - Added `apache-arrow` as an explicit dependency to satisfy the `@lancedb/lancedb` peer requirement. This fixes the "Cannot find module 'apache-arrow'" error during indexing on fresh installs.
  - Removed noisy Docker error logs from the scraper local-runtime. Docker is optional and most curl-install users won't have it, so the console.error spam is unnecessary.

- Updated dependencies [8b470e7]
  - @larkup/vector-stores@0.1.24
  - @larkup/scraper@0.1.32
  - @larkup/core@0.3.1
  - @larkup/marketplace@0.1.14
  - @larkup/tool-doc-editor@0.2.9
  - @larkup/tool-video-audio@0.3.0

## 0.1.44

### Patch Changes

- Updated dependencies [02fbbba]
  - @larkup/core@0.3.0
  - @larkup/tool-video-audio@0.3.0
  - @larkup/marketplace@0.1.13
  - @larkup/scraper@0.1.31
  - @larkup/tool-doc-editor@0.2.8

## 0.1.43

### Patch Changes

- 80f79b0: Prevent image-description retries from being cancelled by outer request aborts.

## 0.1.42

### Patch Changes

- Improve smart RAG and web fallback, PDF visual retrieval, and resilient video indexing.
- Updated dependencies
  - @larkup/core@0.2.6
  - @larkup/marketplace@0.1.12
  - @larkup/scraper@0.1.30
  - @larkup/tool-doc-editor@0.2.7
  - @larkup/tool-video-audio@0.2.4

## 0.1.41

### Patch Changes

- 0ff7dec: Stabilize native crawl state, prioritise local knowledge retrieval, and improve media-import progress and source-download recovery.
- Updated dependencies [0ff7dec]
  - @larkup/scraper@0.1.29
  - @larkup/tool-video-audio@0.2.4

## 0.1.40

### Patch Changes

- 2a0a7e2: Improve automatic indexing and media processing controls, make settings navigation resilient to slow tool loading, and keep knowledge-base retrieval ahead of web search.
- Updated dependencies [2a0a7e2]
  - @larkup/core@0.2.5
  - @larkup/marketplace@0.1.11
  - @larkup/scraper@0.1.28
  - @larkup/tool-doc-editor@0.2.6
  - @larkup/tool-video-audio@0.2.3

## 0.1.39

### Patch Changes

- Fix TS2448 ReferenceError in data-workspace.tsx caused by docsQuery declaration order

## 0.1.38

### Patch Changes

- Fix 10 production issues: SSE controller-closed error, cleaner system prompt, smarter KB search, one-shot web search, corpus refresh after scrape, minimal KB loading UI, settings sidebar navigation, force-delete processing media, playlist confirmation, image preview in chat, marketplace install progress toast.

## 0.1.37

### Patch Changes

- c1b12cb: Restore reliable no-Docker local crawler search with a resilient public-search fallback, make current-event chat questions use enabled web search, speed up first-party tool installation, and improve media URL progress handling. Simplify settings and prompt UX, and make failed-crawl URL copying reliable.
- Updated dependencies [c1b12cb]
  - @larkup/scraper@0.1.27
  - @larkup/marketplace@0.1.10
  - @larkup/tool-video-audio@0.2.3
  - @larkup/tool-doc-editor@0.2.5

## 0.1.36

### Patch Changes

- 9dd3603: Build workspace tool dependencies before the web app in Docker images.

## 0.1.35

### Patch Changes

- 5ba20af: Make the local crawler work without Docker, make Marketplace installs opt-in and removable, and bound RAG retrieval tool loops and context growth.
- Updated dependencies [5ba20af]
  - @larkup/scraper@0.1.26
  - @larkup/marketplace@0.1.9
  - @larkup/tool-doc-editor@0.2.5
  - @larkup/tool-video-audio@0.2.2

## 0.1.34

### Patch Changes

- c9724ff: Ship Next.js browser assets inside the standalone runtime so curl and npm installations load the UI instead of returning static-asset 404s.

## 0.1.33

### Patch Changes

- f1bb8e2: Wait for the chat page and workspace API to be ready before `larkup dev` opens the browser, avoiding the standalone startup loading screen.

## 0.1.32

### Patch Changes

- 592c637: Fix standalone startup and Docker runtime compatibility, make bundled marketplace tools ready immediately, and improve ingestion, chat retrieval, media preview, and analytics feedback.
- Updated dependencies [592c637]
  - @larkup/marketplace@0.1.8
  - @larkup/tool-doc-editor@0.2.5
  - @larkup/tool-video-audio@0.2.2

## 0.1.31

### Patch Changes

- 197c629: fix: Docker compatibility, AI agent tool priority, and indexing reliability

  - Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
  - Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
  - Speed up Marketplace tool installs in Docker with --prefer-offline
  - Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
  - Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
  - Strengthen webSearch tool description to enforce secondary priority

- Updated dependencies [197c629]
  - @larkup/vector-stores@0.1.23
  - @larkup/tool-video-audio@0.2.2
  - @larkup/marketplace@0.1.7
  - @larkup/core@0.2.4
  - @larkup/tool-doc-editor@0.2.5
  - @larkup/scraper@0.1.25

## 0.1.30

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.
- Updated dependencies
  - @larkup/core@0.2.3
  - @larkup/marketplace@0.1.6
  - @larkup/scraper@0.1.24
  - @larkup/tool-doc-editor@0.2.4
  - @larkup/tool-video-audio@0.2.1

## 0.1.29

### Patch Changes

- 19767f8: Fix isolated Marketplace tool loading in Docker, improve Video & Audio setup guidance, and reliably index PDF images.
- Updated dependencies [19767f8]
  - @larkup/marketplace@0.1.5
  - @larkup/tool-doc-editor@0.2.3
  - @larkup/tool-video-audio@0.2.1

## 0.1.28

### Patch Changes

- c769d08: Retry marketplace installs against the latest published package when a stale catalog version is unavailable, and improve server and analytics UI behavior.
- Updated dependencies [c769d08]
  - @larkup/marketplace@0.1.4
  - @larkup/tool-doc-editor@0.2.3
  - @larkup/tool-video-audio@0.2.1

## 0.1.27

### Patch Changes

- 6241db2: Prevent chat responses from rendering unverified image URLs and clarify the single-port Docker web app launch.
- Updated dependencies [6241db2]
  - @larkup/core@0.2.2
  - @larkup/marketplace@0.1.3
  - @larkup/scraper@0.1.23
  - @larkup/tool-doc-editor@0.2.3
  - @larkup/tool-video-audio@0.2.1

## 0.1.26

### Patch Changes

- 08e7029: Fix LanceDB native-module loading in packaged Larkup installations, align marketplace catalog versions with published tools, and make clearing a knowledge base discoverable.
- Updated dependencies [08e7029]
  - @larkup/vector-stores@0.1.22
  - @larkup/marketplace@0.1.2
  - @larkup/tool-doc-editor@0.2.2
  - @larkup/tool-video-audio@0.2.1
  - @larkup/core@0.2.1
  - @larkup/scraper@0.1.22

## 0.1.25

### Patch Changes

- fix: lazy-import dockerode to prevent Turbopack hash mangling at runtime
- Updated dependencies
  - @larkup/sandbox@0.1.2
  - @larkup/tool-doc-editor@0.2.1

## 0.1.24

### Patch Changes

- f1ed7b1: fix: update install script UX and fix dockerode bundling bug

## 0.1.23

### Patch Changes

- Use `my-larkup` as the initial project name in the web onboarding flow.

## 0.1.22

### Patch Changes

- Make `larkup dev` start and open the main Larkup web application on port 4567.

## 0.1.21

### Patch Changes

- 4e54939: feat: add doc-editor tool and canvas preview
- 8f51b5c: Route image and video-frame analysis through the configured chat provider and model, keeping marketplace audio-provider settings isolated to transcription.
- 8201d67: Replace the Web update notification with a minimal theme-aware banner that copies the correct CLI or Docker update command.
- 5caaf2f: feat: support persistent S3-compatible LanceDB storage for serverless deployments
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- Updated dependencies [4e54939]
- Updated dependencies [efc6810]
- Updated dependencies [5caaf2f]
- Updated dependencies [8042a54]
- Updated dependencies [843ef5c]
- Updated dependencies [b7bc6fe]
  - @larkup/tool-doc-editor@0.2.0
  - @larkup/marketplace@0.1.1
  - @larkup/sandbox@0.1.1
  - @larkup/core@0.2.0
  - @larkup/vector-stores@0.1.21
  - @larkup/tool-video-audio@0.2.0
  - @larkup/scraper@0.1.21
