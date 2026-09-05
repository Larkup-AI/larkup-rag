# @larkup/tool-video-intelligence

## 0.2.6

### Patch Changes

- Updated dependencies [36e524c]
  - @larkup/core@0.5.3

## 0.2.5

### Patch Changes

- 7cd86a5: Use saved AI Models credentials for Video Intelligence by default, keep managed-cloud usage tied to a stable device identity after uninstall, bound media URL checks, and preserve the selected add-page group during media indexing.

## 0.2.4

### Patch Changes

- 275a7ee: fix(ai): improve video intelligence outcome routing and index preservation

## 0.2.3

### Patch Changes

- 2bb75fa: Persist packaged local projects, credentials, uploads, indexes, installed tools, and Video Intelligence runtime data outside the npm installation, with automatic migration from the legacy package-local directory. Keep Video Intelligence available when a Hub catalog is incomplete, and require a fresh visual pass for exhaustive PDF diagram questions.
- Updated dependencies [2bb75fa]
  - @larkup/core@0.5.2

## 0.2.2

### Patch Changes

- Updated dependencies [81abfcb]
  - @larkup/core@0.5.1

## 0.2.1

### Patch Changes

- Add safe build-cache size reporting and confirmed cleanup in Settings, wait for the exact npm tarball before release installer smoke tests begin, and document the current Video Intelligence collaboration roadmap.

## 0.2.0

### Minor Changes

- b2f4aa2: Add a shared agent-planned video indexing pipeline with Fast, Balanced, and
  Thorough modes, timestamp-grounded knowledge synthesis, live ETA progress, and
  independently selectable provider-filtered vision and tool-brain models.
- Add the Marketplace v3 extension/runtime/billing contract and the installable cloud-first Video Intelligence tool with automatic device-scoped cloud connections, managed AWS deployment, quota controls, indexing briefs, durable timestamped chat evidence, audio-provider settings, and temporary capacity requests.
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
- c7556b3: Process bounded cloud inspections from an exact remotely-seeked clip and preserve original source timestamps across transcript, OCR, tracking, scoreboard, and semantic evidence. Ship a dedicated RunPod serverless image that starts its worker directly and disables the incompatible HTTP healthcheck, while preserving the local GPU HTTP runtime.
- b2f4aa2: Speed up video questions by diversifying repeated evidence before trimming, excluding inspection protocol text from retrieval, and resolving corroborated multimodal result scenes without unnecessary live re-analysis.
- b2f4aa2: Make indexed video answers RAG-first, share one bounded fallback-analysis deadline, animate per-call chat progress, expose matched indexed context with timestamps, automatically paginate broad questions, and remove answer-cache shortcuts.
- b2f4aa2: Estimate playlist watch URLs from the selected video when importing a single item, preserve full-playlist estimates when requested, and calibrate Fast coverage to a five-to-six-minute typical range for a one-hour video.
- Remove control-plane quota and concurrency gates for explicitly configured owner testing devices, including full-coverage investigations, while leaving standard device entitlements unchanged.
- b2f4aa2: Add portable runtime selection, a manifest-driven media-indexing confirmation form, cloud allowance support requests, and capped device-trial entitlement controls for Video Intelligence.
- b2f4aa2: Require direct visual verification before answering a final result from a
  paired-value OCR candidate, return long-video timelines from indexed timestamped evidence,
  preserve generic subject-relation-value bindings and reject terminal mappings
  that conflict with independent chronology across any video genre,
  standardize Vercel Gateway credentials on `AI_GATEWAY_API_KEY`, preserve
  local-runtime chat progress, and purge local source/result caches when their
  media or linked knowledge is deleted.
- b2f4aa2: Preserve diagnosable Cloud semantic-evidence failures, avoid rejecting valid partial caption batches, make Fast-mode timing estimates account for normal Cloud startup, keep Fast Cloud overviews from waiting for full transcription, and keep managed Cloud vision credentials isolated from project Gateway keys.
- b2f4aa2: Improve Video Intelligence cloud usage, model verification, and local runtime controls.
- fix: isolate malformed vision and OCR model output so a single frame cannot fail video indexing
- b2f4aa2: Preserve answer-level chronological evidence in video chat, use direct analysis only when the indexed trail is incomplete, and publish source-language cross-scene story notes built from speech and visual evidence. Complete source inventories bypass the answer model's context limit, while bounded re-watches can settle a claim only when they explicitly answer the question.
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
