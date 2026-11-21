# Changelog

## Unreleased

New error-level rules, so the next release is a major one. Measured with `--static` on `origin/main` of every consumer repo on 21 Nov 2026, after each repo's own allowlist:

- `suppression-without-reason`: 0 everywhere (the ESLint comments plugin already enforces it for `eslint-disable`; this also covers `@ts-ignore` / `@ts-expect-error`).
- `argv-index`: ReleaseReady 42, frontend-ui 13, universal-api-framework 5, releaseready-product-tests 4, test-data-management 3, test-management 3, universal-playwright-framework 3, universal-appium2-framework 1, the rest 0.

- `releaseready-guardrails` (RRDSCRUM-436): new rule `suppression-without-reason` fails on `eslint-disable*`, `@ts-ignore` or `@ts-expect-error` with no reason (`-- reason` for ESLint, text after the TS directive, or an explaining comment on the line above). New rule `argv-index` fails on `process.argv[<n>]`; use `node:util` `parseArgs`. Both can be allowlisted with a reason.

## 3.0.0 (2026-11-21)

Major release: it adds error-level rules, so a repo moving from 2.x can fail `releaseready-guardrails` until it fixes or allowlists the new findings. Measured with `--static` on `origin/main` of every consumer repo on 21 Nov 2026, after each repo's own allowlist:

- `oversized-source-file`: ReleaseReady 27, ai-orchestrator 18, test-management 4, universal-playwright-framework 3, frontend-ui 2, code-quality 1, universal-api-framework 1, the rest 0.
- `hand-written-archive-parser`: code-quality 3, ReleaseReady 1 (`apps/portal-tests/code-quality-fixture.ts`), ai-orchestrator 1, the rest 0.
- `hardcoded-tmp`: ReleaseReady 2 (container tmpfs paths, now allowlistable), the rest 0.
- `unpublished-internal-dependency`, `tracked-build-output`: 0 everywhere.

- `releaseready-guardrails` (RRDSCRUM-390): `hardcoded-tmp` can now be allowlisted with a reason like every other rule (for example a `/tmp` path inside a container). The rule is unchanged: still on by default, still an error, same matching; only recording a reviewed exception is new.
- `releaseready-guardrails` (RRDSCRUM-435): new rule `oversized-source-file` fails on a non-generated JS/TS/Python source file over 1,000 lines. The limit is `fileLength.maxLines` (a higher limit needs a `reason`). Generated files are excluded by default globs plus `fileLength.generated` entries, each with a reason. Rules now receive the repo's config (`findAll(root, config?)`). This is a new error-level rule, so a major release. Counts on `origin/main` are at the top of this release.
- `releaseready-guardrails` (RRDSCRUM-434): new rules `unpublished-internal-dependency` (`@releaseready/*` from git, a tarball, or a local or `dist/` folder where `dependency-source` does not look: `npm:` aliases, `overrides`, lockfile links outside the repo and release-tarball `resolved` URLs) and `tracked-build-output` (a tracked `dist/` or `build/` folder). `tracked-ds-store` can now be allowlisted with a reason like every other rule. New error-level rules, so a major release.
- `releaseready-guardrails`: new rule `hand-written-archive-parser` (raw inflate from `node:zlib` or a ZIP local-file-header signature in source), the permanent guard for RR-08. A new error-level rule, so a major release. The RR-08 reader was removed by ReleaseReady PR 369; counts on `origin/main` are at the top of this release.
- Licensed under Apache-2.0 (`LICENSE`, `package.json`); previously `UNLICENSED`. Owner decision, 20 Nov 2026.

## 2.3.0 (2026-11-20)

- `releaseready-guardrails`: new rules `runtime-assert` (a Python `assert` outside tests) and `hardcoded-tmp` (a literal `"/tmp"` in non-test source), from the SonarCloud findings on ai-orchestrator. Measured against `origin/main` of every consumer repo: 0 findings.
- `releaseready-code-quality` skill: new rule 9, "every finding gets a permanent guard" (a lint or guardrail rule, then a test, then a skill row, in the same PR as the fix), with the known scanner patterns and four new smell rows. SonarCloud stays on its Free plan for the repos it already covers (main branch only, scope reduced under 50k private lines); semgrep in `security-scan` is the shared scanner for every repo.

## 2.2.4 (2026-11-20)

- Renovate preset, to keep CI minutes low (owner: "keep the cost to minimum"): every non-major update, of any dependency type, now goes into one weekly PR per repo; major updates wait on the Dependency Dashboard for the owner's approval; at most 2 Renovate PRs are open at once. Security alerts still open immediately.

## 2.2.3 (2026-11-20)

- `releaseready-guardrails`: new rule `tracked-ds-store` fails when any `.DS_Store` is in the git index (`git ls-files`, any depth); untracked or ignored ones pass. macOS rewrites a tracked `.DS_Store` and dirties every checkout. Released as a patch on the owner's instruction. Measured against `origin/main` of every consumer repo: 0 findings except ReleaseReady and observability (1 each, being removed in their own PRs) and this repo (1, removed in its own PR).

## 2.2.2 (2026-11-19)

- Renovate preset: Mend-hosted Renovate can read the private `@releaseready/*` packages (`npmrc` scope registry plus an `npm.pkg.github.com` host rule using the `GH_PACKAGES_TOKEN` Mend org secret). `@releaseready/*` updates are grouped and never automerged.

## 2.2.1 (2026-11-19)

- `security-scan`: scanner downloads retry (curl `--retry 5 --retry-all-errors`); a flaky `curl: (18) partial file` failed PR checks on the self-hosted runner.

## 2.2.0 (2026-11-19)

- `security-scan` action also runs on macOS arm64 (self-hosted runner): darwin-arm64 gitleaks, trivy and zizmor with their own pinned SHA-256s,
  chosen by `runner.os` and `runner.arch`; any other platform fails clearly. Linux x64 behaviour is unchanged. The runner needs python3 (semgrep venv).

- Skill: the repo `universal-appium2-framework` is now `universal-appium-framework` (UA2-22). Consumers get the new text on the next release and `releaseready-guardrails sync`.

## 2.1.0 (2026-11-19)

- New composite action `.github/actions/security-scan`: gitleaks, trivy fs, semgrep and zizmor, each version pinned
  (binaries are checksum-verified; the org allows only GitHub-owned actions). `pr.yml` runs it in every repo.
  Baselines live in the consumer repo (see README "Security scanners").

## 2.0.1 (2026-11-19)

- Skill: merge only when `pr.yml` is green; says where GitHub branch protection enforces it and where the local
  merge hook does (free-plan private repos).

## 2.0.0 (2026-11-19)

Breaking: new error-level rules, so consumers fix or explicitly allow each finding when they upgrade.

- ESLint: every `eslint-disable*` comment needs `-- reason` and names its rules
  (`@eslint-community/eslint-comments`); `@ts-ignore` and `@ts-nocheck` are banned and `@ts-expect-error` needs a
  description (`@typescript-eslint/ban-ts-comment`, on JS files too); focused `.only` tests fail (`no-only-tests`).
- New `releaseready-guardrails` bin: dependency sources, tsconfig private paths and strictness, builds inside
  `node_modules`, copied shared code, legacy markers, skipped tests, unexplained rule overrides, README history, skill
  drift, knip and jscpd. Allowlist with reasons and ratchet counts in `releaseready-guardrails.json`.
- Ships the `releaseready-code-quality` skill; `releaseready-guardrails sync` installs it in a repo.
- Removed the default export of `@releaseready/config/eslint`; import `{ releaseready }` (every consumer already does).

## 1.0.0 (2026-11-18)

First release: ESLint flat config (typescript-eslint strict-type-checked and stylistic-type-checked; React presets
@eslint-react, react-hooks and jsx-a11y-x), Prettier config, strict tsconfig base and Renovate preset.
