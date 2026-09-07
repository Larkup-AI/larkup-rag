# @larkup/cli

## 0.2.32

### Patch Changes

- Updated dependencies [4130731]
  - @larkup/core@0.5.4
  - @larkup/marketplace@0.2.4

## 0.2.31

### Patch Changes

- Updated dependencies [36e524c]
  - @larkup/core@0.5.3
  - @larkup/marketplace@0.2.3

## 0.2.30

### Patch Changes

- f0ae72a: `larkup update`: show bold "Already up to date" banner when CLI is current; use a spinner with black text during npm install; show bold success banner after a successful update.

## 0.2.29

### Patch Changes

- Updated dependencies [2bb75fa]
  - @larkup/core@0.5.2
  - @larkup/marketplace@0.2.2

## 0.2.28

### Patch Changes

- 847b502: Keep global installs and updates quiet and compatible by aligning Apache Arrow with LanceDB's
  supported peer range, shipping the marketplace TypeScript runtime loader, and using the renamed
  Daytona SDK package. Public tarballs also scrub local project state from all traced workspaces.
- Updated dependencies [847b502]
- Updated dependencies [81abfcb]
  - @larkup/marketplace@0.2.1
  - @larkup/vector-stores@0.1.27
  - @larkup/core@0.5.1

## 0.2.27

### Patch Changes

- Avoid blocking CLI startup and help output on the background update checks, fixing Windows command startup.

## 0.2.26

### Patch Changes

- Improve project settings with portable Agent Skills, runtime filtering, current installed-tool manifests, and expanded Video Intelligence configuration. Agent Server deployments now expose tool discovery plus AI SDK and OpenAI-compatible streaming endpoints, grouped separately from Knowledge endpoints in Scalar. Add text streaming helpers, chat-model discovery, and guarded per-request provider/model selection to the JavaScript and Python SDK clients. AI Gateway runtimes list their available language models; direct-provider runtimes remain constrained to their configured provider. Align `larkup chat --model` with the configured provider so a Gateway key is never routed to a direct vendor.
- Updated dependencies [738ba6c]
- Updated dependencies [738ba6c]
- Updated dependencies [738ba6c]
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies [790a298]
- Updated dependencies [b2f4aa2]
- Updated dependencies [bf44a90]
- Updated dependencies
- Updated dependencies [b2f4aa2]
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
  - @larkup/core@0.5.0
  - @larkup/marketplace@0.2.0
  - @larkup/vector-stores@0.1.26

## 0.2.25

### Patch Changes

- Updated dependencies [aa75e4b]
  - @larkup/core@0.4.2
  - @larkup/marketplace@0.1.25

## 0.2.24

### Patch Changes

- c12b4ec: Pin Apache Arrow to the range supported by LanceDB to prevent npm peer-dependency warnings during installation. Include public images in the standalone server bundle so logos and icons load after installing Larkup from npm.
- Updated dependencies [c12b4ec]
  - @larkup/vector-stores@0.1.25
  - @larkup/core@0.4.1
  - @larkup/marketplace@0.1.24

## 0.2.23

### Patch Changes

- Updated dependencies [07e35de]
  - @larkup/core@0.4.0
  - @larkup/marketplace@0.1.23

## 0.2.22

### Patch Changes

- Updated dependencies [57a3be9]
  - @larkup/marketplace@0.1.22

## 0.2.21

### Patch Changes

- Updated dependencies [4398407]
  - @larkup/marketplace@0.1.21

## 0.2.20

### Patch Changes

- Updated dependencies [7601d83]
  - @larkup/marketplace@0.1.20

## 0.2.19

### Patch Changes

- Updated dependencies [d7d293c]
  - @larkup/core@0.3.4
  - @larkup/marketplace@0.1.19

## 0.2.18

### Patch Changes

- Updated dependencies [2d0d490]
- Updated dependencies [e40bbe8]
  - @larkup/marketplace@0.1.18
  - @larkup/core@0.3.3

## 0.2.17

### Patch Changes

- Updated dependencies [aae57aa]
  - @larkup/core@0.3.2
  - @larkup/marketplace@0.1.17

## 0.2.16

### Patch Changes

- Updated dependencies [5da7a99]
  - @larkup/marketplace@0.1.16

## 0.2.15

### Patch Changes

- Updated dependencies [f23cba6]
  - @larkup/marketplace@0.1.15

## 0.2.14

### Patch Changes

- 8b470e7: fix: add missing apache-arrow dependency and silence docker error spam

  - Added `apache-arrow` as an explicit dependency to satisfy the `@lancedb/lancedb` peer requirement. This fixes the "Cannot find module 'apache-arrow'" error during indexing on fresh installs.
  - Removed noisy Docker error logs from the scraper local-runtime. Docker is optional and most curl-install users won't have it, so the console.error spam is unnecessary.

- Updated dependencies [8b470e7]
  - @larkup/vector-stores@0.1.24
  - @larkup/core@0.3.1
  - @larkup/marketplace@0.1.14

## 0.2.13

### Patch Changes

- Updated dependencies [02fbbba]
  - @larkup/core@0.3.0
  - @larkup/marketplace@0.1.13

## 0.2.12

### Patch Changes

- Updated dependencies
  - @larkup/core@0.2.6
  - @larkup/marketplace@0.1.12

## 0.2.11

### Patch Changes

- Updated dependencies [2a0a7e2]
  - @larkup/core@0.2.5
  - @larkup/marketplace@0.1.11

## 0.2.10

### Patch Changes

- Updated dependencies [c1b12cb]
  - @larkup/marketplace@0.1.10

## 0.2.9

### Patch Changes

- Updated dependencies [5ba20af]
  - @larkup/marketplace@0.1.9

## 0.2.8

### Patch Changes

- Updated dependencies [592c637]
  - @larkup/marketplace@0.1.8

## 0.2.7

### Patch Changes

- Updated dependencies [197c629]
  - @larkup/vector-stores@0.1.23
  - @larkup/marketplace@0.1.7
  - @larkup/core@0.2.4

## 0.2.6

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.
- Updated dependencies
  - @larkup/core@0.2.3
  - @larkup/marketplace@0.1.6

## 0.2.5

### Patch Changes

- Updated dependencies [19767f8]
  - @larkup/marketplace@0.1.5

## 0.2.4

### Patch Changes

- Updated dependencies [c769d08]
  - @larkup/marketplace@0.1.4

## 0.2.3

### Patch Changes

- Updated dependencies [6241db2]
  - @larkup/core@0.2.2
  - @larkup/marketplace@0.1.3

## 0.2.2

### Patch Changes

- Updated dependencies [08e7029]
  - @larkup/vector-stores@0.1.22
  - @larkup/marketplace@0.1.2
  - @larkup/core@0.2.1

## 0.2.1

### Patch Changes

- 48922c0: Add `larkup dev` as the guided one-command path for creating and running a local server.

## 0.2.0

### Minor Changes

- efc6810: Add folder and media indexing, corpus management, Marketplace Hub operations, deployment and update commands, browser opening, CLI validation, streaming chat, complete RAG endpoint coverage, bulk SDK indexing progress, and typed Hub discovery.

### Patch Changes

- 5caaf2f: feat: support persistent S3-compatible LanceDB storage for serverless deployments
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- Updated dependencies [4e54939]
- Updated dependencies [efc6810]
- Updated dependencies [5caaf2f]
- Updated dependencies [8042a54]
- Updated dependencies [843ef5c]
- Updated dependencies [b7bc6fe]
  - @larkup/marketplace@0.1.1
  - @larkup/core@0.2.0
  - @larkup/vector-stores@0.1.21
