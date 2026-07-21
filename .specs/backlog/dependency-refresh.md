# Dependency refresh (repo-wide drift)

## Idea

A dedicated, separately-scoped dependency-bump pass. Flagged by the dependency-reviewer during
007-response-shape's final review pass (2026-07-21) as pre-existing repo-wide drift — none of it
introduced by, or blocking, feature 007.

## Notes

Snapshot (2026-07-21, direct deps most relevant to the tool surface):

| Package | Pinned | Latest | Gap |
|---|---|---|---|
| xero-node | ^13.3.0 | 19.0.0 | 6 majors |
| typescript | ^5.9.3 | 7.0.2 (6.0.3 stable intermediate) | 1–2 majors |
| zod | `3.25` (bare pin — no caret, no patch digit; unusual, verify intent) | 4.4.3 | 1 major |
| @modelcontextprotocol/sdk | ^1.23.4 | 1.29.0 | minor |
| vitest | ^4.1.7 | 4.1.10 | patch |

Constraints for whoever picks this up:

- **Fork posture governs.** These pins largely mirror upstream `XeroAPI/xero-mcp-server`; solo
  major bumps (especially xero-node, whose models our report envelope and raw-passthrough rows
  depend on) create merge cost on every upstream sync. Prefer riding upstream's own bumps, and
  only diverge deliberately with an exception note (REPO.md § Upstream Sync).
- xero-node majors likely change model typings used by `report-envelope.ts`, `json-response`
  passthrough rows, and many handlers — needs its own test sweep, not a drive-by.
- No CVE scan was performed in the flagging review (version-gap only). CI's Trivy gate covers
  image-level CVEs; run `npm audit` when scoping this.

## Layers

backend (package.json) + ci-cd (gate implications)
