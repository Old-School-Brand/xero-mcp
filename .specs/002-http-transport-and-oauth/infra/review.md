# Review: Deployment Artefacts + Redis Token Persistence
**Layer:** infra
**Feature:** 002-http-transport-and-oauth
**Date:** 2026-05-27
**Iteration:** iteration 2 (final pass)
**Status:** PASSED_WITH_WARNINGS (only deferred dependency-currency + README nits remain; all must-fix/should-fix resolved)
**Baseline:** `git merge-base HEAD main` (+ uncommitted infra working tree)

## Reviewer Selection (iteration 1)

Ran:     dependency-reviewer, duplication-reviewer, maintainability-reviewer, performance-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: documentation-reviewer — `iterations:[final], default:skip`; iteration 1 is not the final pass

## staff-reviewer Review
**Result:** SHOULD_FIX

### Findings

- [x] should-fix — Four token-store methods instead of two (design-review refinement not applied) — `src/clients/xero-client.ts`
      The build kept `resolveRefreshToken` (sync) + `resolveRefreshTokenAsync` (async dispatcher) and `persistRefreshToken` (sync) + `persistRefreshTokenAsync` (async dispatcher) — four private methods where two suffice. The pre-build design-review refinement asked to convert the two existing methods directly to async with an inline file/redis branch and drop the `*Async` wrappers. The sync methods now have no callers except the async dispatchers (file branch) and the pre-existing tests. Shallow-wrapper pattern; contained (all private, public surface unchanged) but adds an extra delegation hop.
      Recommendation: convert `resolveRefreshToken`/`persistRefreshToken` to async with inline branching; update the Section 2/4 tests to call the async path. Low-risk, no public API impact.
      Resolved: Collapsed to two async methods with inline file/redis branching; extracted `envSeedOrThrow()` helper; tests updated to await the async methods; design.md A1 updated.

## security-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — `.xero-mcp/` token directory not excluded from `.dockerignore` or `.gitignore` — `.dockerignore`, `.gitignore`
      `compose.override.yml` bind-mounts `./.xero-mcp:/app/.xero-mcp`; in file mode a local `docker compose up` creates `./.xero-mcp/refresh_token` on the host. Neither ignore file excludes it: (1) it's sent to the Docker daemon in the build context, (2) a `git add -A` after local compose usage would stage a live Xero refresh token.
      Recommendation: add `.xero-mcp/` to both `.dockerignore` and `.gitignore`.
      Resolved: Added `.xero-mcp/` to `.dockerignore` and `.gitignore`.

- [x] should-fix — `ENV XERO_TOKEN_FILE` trips BuildKit `SecretsUsedInArgOrEnv` lint — `Dockerfile`
      BuildKit flags any ENV/ARG whose name contains `token`/`secret`/`password`/`key`. `XERO_TOKEN_FILE` is a filesystem path, not a secret — a genuine false positive — but it will break a `ci-cd`-layer lint-as-errors step.
      Recommendation: add a `# check=skip=SecretsUsedInArgOrEnv` directive (BuildKit) near the top of the Dockerfile, preserving the existing `XERO_TOKEN_FILE` env-var contract (do not rename — `xero-client.ts` reads it).
      Resolved: Added `# check=skip=SecretsUsedInArgOrEnv` directive at top of Dockerfile with explanatory comment.

- [x] should-fix — Local Valkey has no authentication — `compose.yml`
      Port 6379 is not published and the network is the default bridge, so it's internal-only — acceptable for local dev (matches ADR-0003 posture). But unauthenticated containers on the same compose network could read/overwrite `xero:refresh_token`.
      Recommendation: add a comment documenting Valkey is intentionally unauthenticated + internal-only (port not published). Optional `--requirepass` only if shared environments arise. (Document; no behavioural change required.)
      Resolved: Added YAML comment on the valkey service documenting intentional unauthenticated/internal-only posture and mention of `--requirepass` for shared environments.

- [x] nit — Ingress always renders `secretName: ""` — `charts/xero-mcp/templates/ingress.yaml`
      Intentional for Tailscale (manages its own cert), but a non-Tailscale controller would try to look up a Secret named `""`.
      Recommendation: guard the line — `{{- if .Values.ingress.tls.secretName }}secretName: ...{{- end }}`.
      Resolved: Added guard so `secretName:` is only emitted when `.Values.ingress.tls.secretName` is non-empty.

- [x] nit — No `imagePullSecrets` passthrough — `charts/xero-mcp/templates/deployment.yaml`, `values.yaml`
      Image is in private ACR (`oldschoolbrand.azurecr.io`); a cluster without a pre-bound pull credential gets `ErrImagePull` and must fork the chart.
      Recommendation: add `imagePullSecrets: []` to values.yaml and a `{{- with .Values.imagePullSecrets }}` block to the pod spec.
      Resolved: Added `imagePullSecrets: []` to `values.yaml` and `{{- with .Values.imagePullSecrets }}` block to pod spec in `deployment.yaml`.

## maintainability-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — Helm env-block ordering makes `MCP_SERVER_URL`/`ENTRA_REQUIRED_SCOPES` overridable contrary to the comment — `charts/xero-mcp/templates/deployment.yaml`
      `MCP_SERVER_URL` and `ENTRA_REQUIRED_SCOPES` (from `.Values.auth.*`) are emitted *before* the free-form `.Values.env` range; `XERO_TOKEN_STORE` is emitted *after*. Kubernetes resolves duplicate env names by last occurrence, so a `.Values.env` duplicate would override the two auth keys (opposite of the "chart-managed keys win" comment). Only `XERO_TOKEN_STORE` is correctly positioned.
      Recommendation: move the `MCP_SERVER_URL`/`ENTRA_REQUIRED_SCOPES` conditional blocks to after the `.Values.env` range (consistent with cin7-mcp, where all managed keys follow the range). Update the comment.
      Resolved: Moved `MCP_SERVER_URL` and `ENTRA_REQUIRED_SCOPES` blocks to after the `.Values.env` range; updated comment to "all chart-managed keys below always win".

- [x] nit — `design.md` § B2 still documents the dead `!package.json` line — `.specs/002-http-transport-and-oauth/infra/design.md`
      The built `.dockerignore` correctly omits `!package.json` (it's dead — no exclusion matches package.json). design.md still shows it.
      Recommendation: remove `!package.json` from design.md § B2 so spec matches artefact.
      Resolved: Removed `!package.json` line from design.md § B2.

- [x] nit — `vi.useFakeTimers()`/`useRealTimers()` inline in Section 8 without an `afterEach` safety net — `src/__tests__/clients/xero-client.test.ts`
      If a Section 8 test throws before the inline `useRealTimers()`, later tests run with fake timers.
      Recommendation: add `afterEach(() => vi.useRealTimers())` to the Section 8 describe block.
      Resolved: Added `afterEach(() => vi.useRealTimers())` to Section 8 describe block; inline `vi.useRealTimers()` calls within tests remain for clarity but are now superseded by the afterEach.

## performance-reviewer Review
**Result:** PASSED

No findings. All documented performance considerations implemented: lazy create-once Redis client, dynamic import (file mode loads no redis module), no per-request token I/O (startup + ~25-min timer only), multi-stage build with `npm prune --omit=dev`, sane resource requests/limits and probe timings.

## duplication-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — Env-seed fallback + "No refresh token found" message duplicated between file and redis resolve paths — `src/clients/xero-client.ts`
      The `process.env.XERO_REFRESH_TOKEN` check and the 90-char guidance message are identical in `resolveRefreshToken()` (file) and the redis resolve path.
      Recommendation: extract a private helper (e.g. `envSeedOrThrow()`) or at least a message constant. (Fold into the two-methods refactor from staff's finding.)
      Resolved: Extracted `private envSeedOrThrow(): string` helper used by both the file and redis branches of `resolveRefreshToken()`.

- [x] info — Redis `createClient`+`connect` pattern shared with `src/http/server.ts` — accept
      Resolved: design explicitly addresses Redis client isolation; sharing would break the module-load import contract for the stdio entry. Accepted.

- [x] info — Healthcheck one-liner duplicated between Dockerfile and compose.yml — accept
      Resolved: Compose `healthcheck.test` overrides (does not inherit) the Dockerfile HEALTHCHECK; both must exist for their respective consumers. Accepted.

- [x] info — Redis mock `beforeEach` setup duplicated across two test sections — accept
      Resolved: standard self-contained test-fixture duplication; extracting would reduce readability. Accepted.

## test-quality-reviewer Review
**Result:** PASSED_WITH_WARNINGS

Test integrity clean: 17 baseline file-mode tests intact and unmodified; 10 new redis-mode tests added (27 total in this file; 75 across the suite). 0 removed/weakened, 0 assertion regressions. Coverage: 11/11 design examples, 5/5 Part-A ACs. Part B verification-only confirmed appropriate; all static verification commands pass.

### Findings

- [x] nit — `.dockerignore` missing `!package.json` vs design.md — `.dockerignore`
      Resolution direction: the line is dead; update design.md to drop it (do NOT add the dead line). Tracked under maintainability's design.md nit.
      Resolved: design.md § B2 `!package.json` line removed (see maintainability nit above).

- [x] nit — Redis mock sets `isReady: true` but the implementation uses a null check, not `isReady` — `src/__tests__/clients/xero-client.test.ts`
      Harmless; the null-check create-once approach is correct. Recommendation: remove the unused `mockRedisClient.isReady = true` to avoid implying the impl checks it.
      Resolved: Removed `isReady: true` from the `mockRedisClient` hoisted object definition and from all `beforeEach` reassignments. `ensureRedisClient()` uses a null check, not `.isReady`.

## dependency-reviewer Review
**Result:** PASSED_WITH_WARNINGS

Confirmed: the infra layer added **zero** new npm dependencies (`git diff HEAD -- package.json` empty; lock churn is the `xero-mcp-http` bin record + optional dev transitives). No Helm sub-chart deps. `Chart.yaml` `0.0.0` placeholders are intentional (FR-12). `node:22-bookworm-slim` is the correct active-LTS base.

### Findings

- [ ] should-fix — `valkey/valkey:9.0.4` is one minor behind (9.1.0, published 2026-05-19) — `compose.yml`
      9.0.4 is the latest 9.0.x patch, not behind on patches; 9.1 is the active minor. Pin is intentional ("matches cin7-mcp").
      **Decision: DEFER.** Bumping only xero-mcp breaks the deliberate cin7-mcp parity. Bump both sibling repos together in a separate pass.

- [ ] nit — `node:22-bookworm-slim` floating tag, not digest-pinned — `Dockerfile`
      Currently resolves to the latest patch; concern is reproducibility, not a version gap.
      **Decision: DEFER** to the `ci-cd` layer (where image build/scan/pin policy lives), consistent with cin7-mcp.

## Summary

Strong first pass — no must-fix. Part A (the conditional Redis token store in the already-fork-owned `xero-client.ts`) is well-contained, file-mode behaviour is genuinely preserved (17 baseline tests intact), and 10 new redis-mode tests cover all 5 Part-A ACs. Part B artefacts mirror cin7-mcp faithfully, drop what doesn't apply (cache/rateLimit/PVC/FASTMCP_HOME), and pass all static verification (`docker build`, `helm lint`, `helm template` ×variants, no PVC, ingress toggle+guard). Performance PASSED clean.

Iteration-2 fix set (should-fix + cheap correctness nits):
1. Collapse the four token-store methods to two async methods (staff) and extract the shared env-seed fallback/message (duplication) — one refactor.
2. Add `.xero-mcp/` to `.dockerignore` and `.gitignore` (security — live-token leak risk).
3. Suppress the `SecretsUsedInArgOrEnv` BuildKit check on the Dockerfile (security — CI false positive).
4. Reorder the Helm env block so `MCP_SERVER_URL`/`ENTRA_REQUIRED_SCOPES` follow the `.Values.env` range (maintainability — operator-override correctness).
5. Cheap chart correctness: `imagePullSecrets: []` passthrough (private ACR) + guard the ingress TLS `secretName`.
6. Document Valkey's unauthenticated/internal-only posture in `compose.yml` (security).
7. Spec/test tidy: drop `!package.json` from design.md § B2; add Section-8 `afterEach(useRealTimers)`; remove the unused mock `isReady`.

Deferred (documented above): Valkey 9.0.4→9.1.0 (cin7 parity — bump both repos together) and the node base-image digest pin (ci-cd layer).

---

## Reviewer Selection (iteration 2 — FINAL PASS, $IS_FINAL=true)

Ran:     documentation-reviewer (final-only; never run before)
Skipped: staff, security, maintainability, performance, duplication, test-quality — `skip-when-clean`: all iteration-1 findings resolved in the iteration-2 fix (test gate re-verified green: 75 tests, build, lint, helm lint/template). dependency-reviewer — its only open findings are the two deferred items below (Valkey 9.1.0, node digest-pin); nothing dependency-related changed in iteration 2, so its iteration-1 findings stand unchanged.

## documentation-reviewer Review (iteration 2 — final pass)
**Result:** FAILED → resolved

The iteration-2 two-method refactor was only partially propagated to design.md; several spec surfaces were stale. All resolved by the orchestrator (doc-only edits, no code change):

- [x] must-fix — design.md Architecture narrative + mermaid named non-existent `*Async` methods (~14 refs) — `design.md`
      Resolved: bulk-renamed `resolveRefreshTokenAsync`→`resolveRefreshToken`, `persistRefreshTokenAsync`→`persistRefreshToken`; rewrote the Architecture paragraph to describe the two-method inline-branch design + `envSeedOrThrow` helper; redrew the mermaid to drop the dispatcher layer and show inline file/redis branching.
- [x] must-fix — design.md Examples (9 of 11) referenced non-existent `*Async` methods — `design.md`
      Resolved: covered by the same rename.
- [x] must-fix — REPO.md Active Spec Layers claimed infra "no files yet — folder is reserved" — `.specs/REPO.md`
      Resolved: infra row now lists Dockerfile, compose stack, Helm chart, and the `XERO_TOKEN_STORE` token store.
- [x] should-fix — design.md B2 `.dockerignore` block missing `.xero-mcp/` — `design.md`
      Resolved: added `.xero-mcp/` to the B2 block with an explanatory note.
- [x] should-fix — design.md B8/B11 didn't document `imagePullSecrets` — `design.md`
      Resolved: added `imagePullSecrets: []` to the B11 values block and an `imagePullSecrets` bullet + pinned-RollingUpdate note to B8.
- [x] should-fix — REPO.md Tech Stack / layout comment / Refresh Token mode paragraph described file-only persistence — `.specs/REPO.md`
      Resolved: all three now reference the token store (file default or redis via `XERO_TOKEN_STORE`); the Refresh Token paragraph notes stdio defaults to file and needs no Redis.
- [x] should-fix — ADR-0001 decision point 3 described file-only persistence — `.specs/adr/0001-refresh-token-auth-mode.md`
      Resolved: appended an "Amendment (2026-05-27)" note documenting the file-or-redis extension (not a supersession), pointing to the infra design.md for rationale.
- [x] should-fix — todo.md status — handled by the mill at the Done step (set to Complete on convergence).
      Resolved: mill marks Complete.
- [ ] nit — README.md has no HTTP/Docker/deploy section — `README.md`
      **Deferred.** README is upstream-tracked and PRD §5 warns against rewriting it; `.specs/REPO.md` already documents HTTP + Docker mode for developers. Revisit if/when a user-facing deploy guide is wanted (candidate for the ci-cd layer or a docs feature).

## dependency-reviewer (final pass — carried forward from iteration 1, unchanged)

- [ ] should-fix — `valkey/valkey:9.0.4` one minor behind 9.1.0 — **DEFERRED** (intentional cin7-mcp parity; bump both sibling repos together).
- [ ] nit — `node:22-bookworm-slim` floating tag not digest-pinned — **DEFERRED** (ci-cd-layer image-pin policy).

## Summary (iteration 2 — final pass)

Converged. All actionable findings from iteration 1 (7 should-fix + cheap correctness nits) were resolved in the iteration-2 fix and re-verified green (75 tests, build, lint, helm lint/template, no PVC, ingress toggle+guard, imagePullSecrets passthrough, env ordering). The final-pass documentation review caught stale spec surfaces from the two-method refactor; all were corrected (doc-only). The only remaining open items are two explicitly-deferred dependency-currency items (Valkey minor bump kept at cin7-mcp parity; node base-image digest pin deferred to ci-cd) and one deferred README nit (upstream-tracked file). No must-fix remains. Feature is ready for commit.
