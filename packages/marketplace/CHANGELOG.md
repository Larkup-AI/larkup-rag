# @larkup/marketplace

## 0.2.4

### Patch Changes

- Updated dependencies [4130731]
  - @larkup/core@0.5.4

## 0.2.3

### Patch Changes

- Updated dependencies [36e524c]
  - @larkup/core@0.5.3

## 0.2.2

### Patch Changes

- 2bb75fa: Persist packaged local projects, credentials, uploads, indexes, installed tools, and Video Intelligence runtime data outside the npm installation, with automatic migration from the legacy package-local directory. Keep Video Intelligence available when a Hub catalog is incomplete, and require a fresh visual pass for exhaustive PDF diagram questions.
- Updated dependencies [2bb75fa]
  - @larkup/core@0.5.2

## 0.2.1

### Patch Changes

- 847b502: Keep global installs and updates quiet and compatible by aligning Apache Arrow with LanceDB's
  supported peer range, shipping the marketplace TypeScript runtime loader, and using the renamed
  Daytona SDK package. Public tarballs also scrub local project state from all traced workspaces.
- Updated dependencies [81abfcb]
  - @larkup/core@0.5.1

## 0.2.0

### Minor Changes

- b2f4aa2: Add a shared agent-planned video indexing pipeline with Fast, Balanced, and
  Thorough modes, timestamp-grounded knowledge synthesis, live ETA progress, and
  independently selectable provider-filtered vision and tool-brain models.
- Add the Marketplace v3 extension/runtime/billing contract and the installable cloud-first Video Intelligence tool with automatic device-scoped cloud connections, managed AWS deployment, quota controls, indexing briefs, durable timestamped chat evidence, audio-provider settings, and temporary capacity requests.
- bf44a90: feat(marketplace): add a durable Postgres catalog

  `apps/marketplace` now stores publisher identity, extension versions, install
  counts, and audit events in Postgres.

  **`@larkup/marketplace`** now includes the Drizzle schema, committed
  migrations, a lazy Postgres client, and typed catalog queries under `src/db`.
  The Hub owns HTTP handling while the Marketplace package owns database access.
  Publishing validates manifests, preserves immutable versions, and enforces
  publisher ownership.

  **Local contributor path, no Neon account needed**:
  `docker compose -f docker/marketplace-db.yml up`, then `pnpm --filter
@larkup/marketplace db:migrate && pnpm --filter @larkup/marketplace db:seed`.

  **`@larkup/hub`**: `/v1/*` stays byte-compatible — every response is
  reconstructed from the stored manifest so `ToolDescriptor`/`ToolListResponse`/
  `ToolDetailResponse` are unchanged field-for-field, and
  `POST /v1/tools/:id/installed` still accepts the body-less request
  `packages/marketplace`'s installer sends today (falls back to an
  `"anonymous"` workspace bucket; a caller sending `workspaceId` gets accurate
  per-workspace install tracking with no Hub change required).

  See [ADR-012](docs/adrs/adr-012-marketplace-hub-on-postgres.md) for the
  schema and authorization design.

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

- Load installed Marketplace agent actions dynamically in chat, with validated schemas, collision protection, execution context, and workflow metadata. Video Intelligence now owns its bounded evidence-refinement action and declarative chat behavior.
- b2f4aa2: Honor a Marketplace tool manifest's public or private distribution setting when it is published.
- b2f4aa2: Make indexed video answers RAG-first, share one bounded fallback-analysis deadline, animate per-call chat progress, expose matched indexed context with timestamps, automatically paginate broad questions, and remove answer-cache shortcuts.
- Improve project settings with portable Agent Skills, runtime filtering, current installed-tool manifests, and expanded Video Intelligence configuration. Agent Server deployments now expose tool discovery plus AI SDK and OpenAI-compatible streaming endpoints, grouped separately from Knowledge endpoints in Scalar. Add text streaming helpers, chat-model discovery, and guarded per-request provider/model selection to the JavaScript and Python SDK clients. AI Gateway runtimes list their available language models; direct-provider runtimes remain constrained to their configured provider. Align `larkup chat --model` with the configured provider so a Gateway key is never routed to a direct vendor.
- b2f4aa2: Add portable runtime selection, a manifest-driven media-indexing confirmation form, cloud allowance support requests, and capped device-trial entitlement controls for Video Intelligence.
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

- b2f4aa2: Improve Video Intelligence cloud usage, model verification, and local runtime controls.
- Updated dependencies [738ba6c]
- Updated dependencies [738ba6c]
- Updated dependencies [738ba6c]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [790a298]
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [5d9b483]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
  - @larkup/core@0.5.0

## 0.1.25

### Patch Changes

- Updated dependencies [aa75e4b]
  - @larkup/core@0.4.2

## 0.1.24

### Patch Changes

- @larkup/core@0.4.1

## 0.1.23

### Patch Changes

- Updated dependencies [07e35de]
  - @larkup/core@0.4.0

## 0.1.22

### Patch Changes

- 57a3be9: Offer a one-click Video & Audio tool update when an older installation asks the user to install yt-dlp manually.

## 0.1.21

### Patch Changes

- 4398407: Automatically prepare the official yt-dlp executable for YouTube imports, removing the host installation requirement.

## 0.1.20

### Patch Changes

- 7601d83: Update Video & Audio from the Media page when an installed tool is stale, and prefer the newest marketplace catalog version so packaged ffmpeg helpers load correctly after installation.

## 0.1.19

### Patch Changes

- d7d293c: Make Chat retrieval-only, reliably parse PDFs in Next deployments, simplify website entry, and prevent stale Video & Audio metadata from requiring a host ffmpeg installation.
- Updated dependencies [d7d293c]
  - @larkup/core@0.3.4

## 0.1.18

### Patch Changes

- 2d0d490: Improve AI Gateway rate-limit recovery and make video processing use bundled ffmpeg binaries without a system dependency.
- Updated dependencies [e40bbe8]
  - @larkup/core@0.3.3

## 0.1.17

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.
- Updated dependencies [aae57aa]
  - @larkup/core@0.3.2

## 0.1.16

### Patch Changes

- 5da7a99: Replace deprecated fluent-ffmpeg with direct child_process.spawn calls. Eliminates npm deprecation warnings for fluent-ffmpeg and node-domexception. Increases auto-install timeout to 5min for large dependencies like ffmpeg.

## 0.1.15

### Patch Changes

- f23cba6: Auto-install missing system dependencies (e.g. ffmpeg) during tool installation using the platform package manager (brew on macOS, apt/dnf/pacman/apk on Linux). Falls back to actionable error messages with the exact install command when auto-install is not possible.

## 0.1.14

### Patch Changes

- @larkup/core@0.3.1

## 0.1.13

### Patch Changes

- Updated dependencies [02fbbba]
  - @larkup/core@0.3.0

## 0.1.12

### Patch Changes

- Updated dependencies
  - @larkup/core@0.2.6

## 0.1.11

### Patch Changes

- Updated dependencies [2a0a7e2]
  - @larkup/core@0.2.5

## 0.1.10

### Patch Changes

- c1b12cb: Restore reliable no-Docker local crawler search with a resilient public-search fallback, make current-event chat questions use enabled web search, speed up first-party tool installation, and improve media URL progress handling. Simplify settings and prompt UX, and make failed-crawl URL copying reliable.

## 0.1.9

### Patch Changes

- 5ba20af: Make the local crawler work without Docker, make Marketplace installs opt-in and removable, and bound RAG retrieval tool loops and context growth.

## 0.1.8

### Patch Changes

- 592c637: Fix standalone startup and Docker runtime compatibility, make bundled marketplace tools ready immediately, and improve ingestion, chat retrieval, media preview, and analytics feedback.

## 0.1.7

### Patch Changes

- 197c629: fix: Docker compatibility, AI agent tool priority, and indexing reliability

  - Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
  - Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
  - Speed up Marketplace tool installs in Docker with --prefer-offline
  - Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
  - Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
  - Strengthen webSearch tool description to enforce secondary priority
  - @larkup/core@0.2.4

## 0.1.6

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.
- Updated dependencies
  - @larkup/core@0.2.3

## 0.1.5

### Patch Changes

- 19767f8: Fix isolated Marketplace tool loading in Docker, improve Video & Audio setup guidance, and reliably index PDF images.

## 0.1.4

### Patch Changes

- c769d08: Retry marketplace installs against the latest published package when a stale catalog version is unavailable, and improve server and analytics UI behavior.

## 0.1.3

### Patch Changes

- Updated dependencies [6241db2]
  - @larkup/core@0.2.2

## 0.1.2

### Patch Changes

- 08e7029: Fix LanceDB native-module loading in packaged Larkup installations, align marketplace catalog versions with published tools, and make clearing a knowledge base discoverable.
  - @larkup/core@0.2.1

## 0.1.1

### Patch Changes

- 4e54939: feat: add doc-editor tool and canvas preview
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- Updated dependencies [efc6810]
- Updated dependencies [5caaf2f]
- Updated dependencies [8042a54]
- Updated dependencies [843ef5c]
- Updated dependencies [b7bc6fe]
  - @larkup/core@0.2.0
