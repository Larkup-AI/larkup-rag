# @larkup/scraper

## 0.1.43

### Patch Changes

- 4130731: Prefer the local Playwright crawler when Docker is available so JavaScript-protected pages can be scraped. Start it in the background with visible readiness and fallback status, retain the native fallback, and reject Anubis challenge pages.
- Updated dependencies [4130731]
  - @larkup/core@0.5.4

## 0.1.42

### Patch Changes

- Updated dependencies [36e524c]
  - @larkup/core@0.5.3

## 0.1.41

### Patch Changes

- Updated dependencies [2bb75fa]
  - @larkup/core@0.5.2

## 0.1.40

### Patch Changes

- Updated dependencies [81abfcb]
  - @larkup/core@0.5.1

## 0.1.39

### Patch Changes

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

## 0.1.38

### Patch Changes

- Updated dependencies [aa75e4b]
  - @larkup/core@0.4.2

## 0.1.37

### Patch Changes

- @larkup/core@0.4.1

## 0.1.36

### Patch Changes

- Updated dependencies [07e35de]
  - @larkup/core@0.4.0

## 0.1.35

### Patch Changes

- Updated dependencies [d7d293c]
  - @larkup/core@0.3.4

## 0.1.34

### Patch Changes

- e40bbe8: Make the built-in crawler available without Docker setup, route native requests through saved proxy settings, and report empty failed crawls accurately.
- Updated dependencies [e40bbe8]
  - @larkup/core@0.3.3

## 0.1.33

### Patch Changes

- Updated dependencies [aae57aa]
  - @larkup/core@0.3.2

## 0.1.32

### Patch Changes

- 8b470e7: fix: add missing apache-arrow dependency and silence docker error spam

  - Added `apache-arrow` as an explicit dependency to satisfy the `@lancedb/lancedb` peer requirement. This fixes the "Cannot find module 'apache-arrow'" error during indexing on fresh installs.
  - Removed noisy Docker error logs from the scraper local-runtime. Docker is optional and most curl-install users won't have it, so the console.error spam is unnecessary.
  - @larkup/core@0.3.1

## 0.1.31

### Patch Changes

- Updated dependencies [02fbbba]
  - @larkup/core@0.3.0

## 0.1.30

### Patch Changes

- Updated dependencies
  - @larkup/core@0.2.6

## 0.1.29

### Patch Changes

- 0ff7dec: Stabilize native crawl state, prioritise local knowledge retrieval, and improve media-import progress and source-download recovery.

## 0.1.28

### Patch Changes

- Updated dependencies [2a0a7e2]
  - @larkup/core@0.2.5

## 0.1.27

### Patch Changes

- c1b12cb: Restore reliable no-Docker local crawler search with a resilient public-search fallback, make current-event chat questions use enabled web search, speed up first-party tool installation, and improve media URL progress handling. Simplify settings and prompt UX, and make failed-crawl URL copying reliable.

## 0.1.26

### Patch Changes

- 5ba20af: Make the local crawler work without Docker, make Marketplace installs opt-in and removable, and bound RAG retrieval tool loops and context growth.

## 0.1.25

### Patch Changes

- @larkup/core@0.2.4

## 0.1.24

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.
- Updated dependencies
  - @larkup/core@0.2.3

## 0.1.23

### Patch Changes

- Updated dependencies [6241db2]
  - @larkup/core@0.2.2

## 0.1.22

### Patch Changes

- @larkup/core@0.2.1

## 0.1.21

### Patch Changes

- Updated dependencies [efc6810]
- Updated dependencies [5caaf2f]
- Updated dependencies [8042a54]
- Updated dependencies [843ef5c]
- Updated dependencies [b7bc6fe]
  - @larkup/core@0.2.0
