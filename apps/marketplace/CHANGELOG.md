# @larkup/hub

## 0.2.3

### Patch Changes

- @larkup/marketplace@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [2bb75fa]
  - @larkup/marketplace@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [847b502]
  - @larkup/marketplace@0.2.1

## 0.2.0

### Minor Changes

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

### Patch Changes

- b2f4aa2: Honor a Marketplace tool manifest's public or private distribution setting when it is published.
- b2f4aa2: Improve Video Intelligence cloud usage, model verification, and local runtime controls.
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies
- Updated dependencies [bf44a90]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
- Updated dependencies [b2f4aa2]
  - @larkup/marketplace@0.2.0

## 0.1.1

### Patch Changes

- 2d0d490: Improve AI Gateway rate-limit recovery and make video processing use bundled ffmpeg binaries without a system dependency.
