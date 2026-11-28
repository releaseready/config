# Changelog

## Unreleased

Fewer false positives in the 7.0.0 guardrails (RRDSCRUM-437).

- `hand-written-xml-parser` skips regexes over HTML element names (`<script>`, `<style>`, `<table>`, `<button>` and so on) and the `<think>` tag: those scan HTML or model text, not XML. Measured on `origin/main` of 11 repos: 0 hits after this change (16 before, all HTML scanners).
- `legacy-path-name` no longer matches an upstream version number such as `osv-schema-v1.9.2.json`. The remaining hits are versioned contract files (list their folders in `contractPaths`) and one brand-asset folder.

## 7.0.0 (2026-11-28)

Breaking: the shared tools drop the ReleaseReady name. No aliases are kept; every consumer updates in the same rollout.

- Commands: `releaseready-guardrails` is now `buildproveship-guardrails`, `releaseready-hooks` is now `buildproveship-hooks`.
- Config file: `releaseready-guardrails.json` is now `buildproveship-guardrails.json`.
- ESLint: the `releaseready()` helper is now `buildproveship()` and its config names use the `buildproveship/` prefix.
- The duplicate `releaseready-code-quality` skill copy is removed; `buildproveship-code-quality` is the only one.
- Includes the two guardrails below (RRDSCRUM-437).

Two guardrails for the Nov 2026 defect classes (RRDSCRUM-437).

- `hand-written-xml-parser`: a regex over tag text (`<tag[^>]*>(.*?)</tag>`, in a literal or a `RegExp` string) in source. Use a maintained XML parser. Allowlistable with a reason.
- `legacy-path-name`: a tracked file or folder named `v1`, `legacy` or `compat` (whole word). Generated sources and the new `contractPaths` setting (published contract folders such as `schema/v1`, each with a reason) are exempt.
- Both are error-level rules; the release that ships them is a minor or major per the release policy. No existing rule changes.

## 6.7.0 (2026-11-28)

Cheapest-runner routing for the shared CI (RRDPLAT-114).

- `reusable-ci.yml` gains a short `route` job. With the new default `runner: auto` it sends `ci` to GitHub-hosted `ubuntu-24.04` for public repos and fork PRs, otherwise to the self-hosted `rr-local` runner when it is online and idle, otherwise to the new `spot-runner` label if the caller sets one, otherwise to `ubuntu-24.04`. GitHub does not fall back between labels, so the job asks the API first. Any other `runner` value is used as given. `ci / ci` keeps its name; drafts still skip it.
- Runner status is read with a short-lived token from a read-only GitHub App (new optional secrets `runner-router-client-id` and `runner-router-private-key`, passed by the caller template). Without them the Mac is skipped, never guessed. No repo or organisation name is written in the workflow.
- Behaviour change for consumers: the default is no longer a fixed `rr-local`; a consumer that passed `runner:` explicitly is unchanged. The spot runner itself (AWS) is set up separately and only used when `spot-runner` is set.
- `infra/ci-runners/` holds the Terraform config for the spot runner (github-aws-runners module, pinned): at most 2 instances, spot only, ephemeral, no NAT gateway. Not applied by CI; the account owner applies it. A budget action (`budget.tf`) is the hard ceiling: US$20 a month, then new launches are denied, and an EventBridge schedule lifts the block at 00:05 UTC on the 1st of each month.
- The scale-up Lambda reserves no concurrency (`scale_up_reserved_concurrent_executions = -1`): a new AWS account allows 10 concurrent executions and requires 5 unreserved, so reserving 1 failed the first apply. The 2-instance cap stays in `runners_maximum_count`.
- The spot runner image gets `gh` and `jq` at boot (`userdata_post_install`): the first spot run failed with exit 127 because Amazon Linux does not ship `gh`, which the changed-files classifier uses. `gh` comes from GitHub's signed dnf repository.
- The spot runners boot a prebaked Ubuntu 24.04 image instead of installing tools at boot on Amazon Linux (`infra/ci-runners/image/`, built with Packer from the module's own template at the pinned release): the first two spot runs failed on a missing `gh`, then on Chromium's libraries. The image has the runner, gh, jq, Node 24 in the tool cache and Chromium's libraries; it costs roughly US$0.50-1 a month to keep and is rebuilt monthly.
- No ESLint or guardrails rule changes.

## 6.6.0 (2026-11-27)

Merge-queue ready CI (RRDPLAT-114).

- The caller template `templates/workflows/pr.yml` also triggers on `merge_group` (`checks_requested`), so the required `ci` check reports on a merge queue's temporary branch. Before, a queue would wait forever for `ci`. A consumer adds the same three lines to its own `pr.yml` when it turns the queue on.
- `reusable-ci.yml` still cancels a superseded run on a new push, but only for `pull_request` events; a `merge_group` run is never cancelled, because that ejects the PR from the queue. Config's own `pr.yml` gets the same trigger and rule. No rule changes for consumers.

## 6.5.0 (2026-11-27)

Pre-commit no longer fails on ignored generated files (RRDTM-141).

- The shared lint-staged command runs `eslint --max-warnings 0 --no-warn-ignored --fix`. Before, staging a file the repo's ESLint config ignores (for example generated OpenAPI types) made ESLint report "File ignored because of a matching ignore pattern" as a warning, and `--max-warnings 0` failed the commit, so such files could not be committed without bypassing the hook. Ignored files are still formatted by Prettier; files ESLint checks are linted as before. Consumers with their own root `lint-staged.config.mjs` that forwards `@buildproveship/config/lint-staged` get it on upgrade; a consumer-owned command needs the flag added by hand. No rule changes.

## 6.4.0 (2026-11-27)

Keep apps on the design system (RRDSCRUM-682).

- Renovate preset: `@buildproveship/ui-web` and `@buildproveship/tokens` updates open at any time (not Monday), skip the 3-day release age, group as "design system", and automerge when `ci` is green. Before, the weekly group never automerged, so apps sat on an old palette. Consumers pick it up with no change (they extend `github>buildproveship/config`).
- The skill's smell table, the AGENTS.md and CLAUDE.md templates and this repo's own copies say it: no literal colour, no re-declared palette variable and no local copy of a ui-web component; list the app's source globs in `designSystem.paths` (the `literal-colour` and `local-ui-component` guardrails from 6.3.0). Consumers get the text with `npx releaseready-guardrails sync`.

## 6.3.1 (2026-11-26)

- The skill's design row now says to start from Design Studio, not the retired Design Library hub (owner ruling, 26 Nov 2026). No rule or guard changes. A consumer's `skill-drift` check fails until it upgrades and runs `npx releaseready-guardrails sync`.

## 6.3.0 (2026-11-26)

- New opt-in guardrails `local-ui-component` and `literal-colour` (design-lint rule 10, owner decision 26 Nov 2026). A repo lists `designSystem.paths` in `releaseready-guardrails.json`; matching `.ts`, `.tsx` and `.css` files (not tests) fail when they declare a component with a `@buildproveship/ui-web` name (`Button`, `Notice`, `StateMessage` and the rest of the v8 set) or type a literal colour (`#hex`, `rgb()`, `hsl()`, `oklch()`) instead of a `@buildproveship/tokens` variable. Repos that do not opt in see no change, so this is a minor release. Measured on buildproveship `apps/web/src` on 26 Nov 2026: 132 findings (65 in the local copy `ui/`, 32 in `style.css`), which that repo allow-lists with a `max` and a removal reason until the local copy is deleted.
- The caller template no longer triggers on `push` to `main`. `main` requires an up-to-date branch and the `ci` check, so the PR run already checked the tree that merges; the second run after every merge only burned minutes (RRDPLAT-114). `npm run check:workflow-cost` now fails a workflow that has both `pull_request` and `push`. Consumers drop the two `push:` lines from `pr.yml` (the rollout does it on its next run).

## 6.2.0 (2026-11-25)

All repos run on the self-hosted Mac runner (owner decision, "All savings, CI on your Mac", 25 Nov 2026, RRDPLAT-114).

- `reusable-ci.yml` and `reusable-nightly.yml`: the `runner` input now defaults to `rr-local` (was `ubuntu-24.04`), so no repo needs a runner rule of its own. Fork PRs still always run on `ubuntu-24.04`. A consumer that pins 6.2.0 needs the `rr-local` runner registered for its repo or org; one that must stay hosted passes `runner: ubuntu-24.04`.
- The rollout no longer has a per-repo `selfHosted` field and renders no `runner:` input; every repo is on `rr-local`, so a GitHub-hosted job in any repo is flagged as a runner migration.
- Push-once rule (RRDPLAT-114): the delivery rules in `AGENTS.md` and `templates/AGENTS.md` tell agents to keep a pull request a draft until the full local check passes, then push and mark it ready in the same turn. `npm run check:workflow-cost` also fails a hosted job on `pull_request` that does not skip drafts.

## 6.1.0 (2026-11-25)

Actions budget guardrails (RRDPLAT-114). The org's US$10/month Actions budget was spent on 25 Nov 2026.

- `reusable-ci.yml` runs as one job, `ci`, instead of three (classify, checks, report). Every hosted job bills at least one minute, so each run bills about two fewer minutes. The required check is still `ci / ci`; a docs-only PR still reports success and logs that checks were not run. The classifier script is identical to `classify-changes.yml` (a test fails if they differ); that workflow stays for non-Node consumers. Callers must grant `pull-requests: read`, as before.
- New `npm run check:workflow-cost` (`scripts/check-workflow-cost.js`, part of `npm run check`): fails on hosted macOS, Windows or larger runners, jobs without `timeout-minutes`, `push` triggers without a branch or tag filter, and schedules that run more than weekly. Consumers can run it against their own `.github/workflows`.
- The nightly caller template runs weekly instead of daily. Consumers that copied it keep their own cron; run `check:workflow-cost` to find daily hosted schedules.
- `docs/ci-budget-bypass.md`: the temporary `ci / ci` bypass runbook (local checks plus PR evidence) and how to switch it off at the billing reset.

## 6.0.0 (2026-11-25)

Breaking: code duplication is capped at 1% in every repo (owner decision, 25 Nov 2026, RRDSCRUM-662).

- jscpd fails above 1% when a repo sets no threshold (was 3%). `jscpd.threshold` may only be lowered: the schema rejects any value above 1, so the old "higher threshold with a reason" escape is gone, and so are `jscpd.reason` and `jscpd.ignore`.
- jscpd skips the same generated sources as the line limit: the built-in `generated/`, `generated.*`, `*.generated.*`, `*.gen.*` and `*.min.js` globs, plus each repo's `fileLength.generated` entries (every one with a reason). Hand-written code always counts.
- Measured on main on 25 Nov 2026 with these settings: buildproveship 3.84%, test-management 3.89%, test-data-management 1.33% (generated OpenAPI client not counted), universal-playwright-framework 1.78%, buildproveship-product-tests 1.22%, frontend-ui 1.09%; universal-api-framework 0.75%, config 0.46%, observability and universal-appium-framework 0%. A repo moves to `^6.0.0` once its main is at or under 1%: delete `jscpd.threshold`, `jscpd.reason` and `jscpd.ignore` from `releaseready-guardrails.json` and run `npx releaseready-guardrails sync`.

## 5.2.0 (2026-11-25)

GitHub Team follow-up (BPS-105). This release also ships the RRDPLAT-111 fixes merged since 5.1.0 (#43 to #57), including the fail-closed docs-only classifier that `reusable-ci.yml` calls with the `$/` self-repository reference.

- `reusable-ci.yml` and `reusable-nightly.yml`: the `runner` input defaults to GitHub-hosted `ubuntu-24.04` instead of the self-hosted `rr-local` (owner decision, 25 Nov 2026, BPS-105). frontend-ui stays on `rr-local` (`selfHosted: true` in `rollout-repos.json`, so the rollout renders `runner: rr-local` for it). Consumers that relied on the old default move to hosted runners when they bump their pin.
- The rollout's AGENTS.md note and PR body name the runner each repo uses. The runner-migration review now flags a hosted job only in a self-hosted repo.
- Skill rule 7, the checks reference and the rollout's AGENTS.md note: agents may merge their own PR once `ci` is green (owner decision, 25 Nov 2026).
- `buildproveship-code-quality` skill (rule 7 and the checks reference): the buildproveship org is on GitHub Team, so org rulesets now require `ci` on an up-to-date branch in buildproveship, frontend-ui, test-management and test-data-management, with auto-merge on. Removed the text saying those repos are on the free plan and that a local Claude Code hook blocks `gh pr merge`. Consumers pick it up with `npx releaseready-guardrails sync` after the next release.

## 5.1.0 (2026-11-23)

BuildProveShip rebrand of docs, metadata and the shared skill (BPS-92).

- The skill is now `buildproveship-code-quality` (source `skill/buildproveship-code-quality/`, repo copy `skills/buildproveship-code-quality/`). The old name `releaseready-code-quality` keeps loading: `releaseready-guardrails sync` writes an alias stub at `.claude/skills/releaseready-code-quality/SKILL.md`, deletes the old `skills/releaseready-code-quality/` copy, and `skill-drift` reports an old copy left behind. Consumers: bump to `^5.1.0`, run `npx releaseready-guardrails sync`, and point AGENTS.md and CLAUDE.md at `skills/buildproveship-code-quality/SKILL.md`.
- New rule `old-brand`: new "ReleaseReady" in Markdown outside history fails. History paths (`CHANGELOG.md`, `LICENSE*`, `docs/history/`, `docs/decisions/`, `docs/findings/`, `docs/design/approvals.*`, `docs/design/*-record.md`, `_review/`) and lines saying "formerly", "renamed", "rebrand", "(history)" or "previously" are exempt. Inline code, fenced code blocks and URLs are not scanned (they quote identifiers, paths and links that code changes and org-reference PRs rename). Lowercase tool names (`releaseready-guardrails`, `releaseready-hooks`, the `releaseready()` ESLint helper) are kept and are not the brand. Allowlist with a reason like any other rule.
- Docs, templates, workflow comments and package description name BuildProveShip. The `releaseready-guardrails` and `releaseready-hooks` bins and `releaseready-guardrails.json` keep their names (renaming them breaks every consumer's scripts and allowlist).

## 5.0.1 (2026-11-23)

- `reusable-ci.yml` checks out with `fetch-depth: 0`, so `origin/main` exists in the job. Before, a check-command that compared against the merge target (test-data-management's `openapi:check`, `git ls-tree origin/main`) failed with exit 128 on every non-docs PR. Callers pick this up by pinning the new commit.

## 5.0.0 (2026-11-23)

Breaking: the package is now `@buildproveship/config` (BPS npm scope migration). The GitHub org was renamed to `buildproveship` and GitHub Packages scopes must match the org.

- Consumers change every `@releaseready/config` import, `package.json` dependency and `.npmrc` line to `@buildproveship/...` (`@buildproveship:registry=https://npm.pkg.github.com`), and install `^5.0.0`.
- Renovate preset, rollout script, templates, workflows' `scope:` and the guardrails' internal-package check use the new scope. The `releaseready-guardrails` bin and `releaseready-code-quality` skill names are unchanged.
- New test `test/scope.test.js` fails on any tracked `@releaseready` reference outside `CHANGELOG.md` and `docs/history/`.
- `@releaseready/config` stays on the registry for history; it is deprecated once all consumers have moved.

## 4.2.1 (2026-11-23)

Skill text only, no change to exports (RRDSCRUM-484):

- `releaseready-code-quality` smell → fix table: new row for linking or building from a design copy, an old Library or memory. The Design Library hub is the design source of truth, and the hub wins over code, repo records and Confluence (owner ruling, 23 Nov 2026).

## 4.2.0 (2026-11-22)

New, no change to existing exports (RRDPLAT-104):

- `releaseready-hooks` bin and `hooks/` (RRDPLAT-104): `install` (Husky), `pre-commit` (lint-staged and `gitleaks git --staged`), `commit-msg` (Jira key), `pre-push` (blocks `main`, requires a branch rebased on a freshly fetched `origin/main`, type-check, affected tests), `verify`. Adds `husky` and `lint-staged` as dependencies and raises `engines.node` to `^22.22.1 || >=24.0.0` (lint-staged's minimum). New action `.github/actions/install-gitleaks`.
- Reusable workflows `reusable-ci.yml` and `reusable-nightly.yml`, caller templates under `templates/workflows/`, and `templates/copilot-setup-steps.yml`. The runner is an input defaulting to `rr-local`; fork PRs always run hosted. The Copilot rules template says agents never use `--no-verify`.

## 4.1.0 (2026-11-22)

New, no change to existing exports:

- `releaseready-guardrails`: `runtime-assert` is now in the config schema's `allow[].rule` list, so a reviewed `assert` can be allowlisted with a reason like every other rule. Before, such an entry failed config validation, so a repo could neither fix nor allow a `runtime-assert` finding in a frozen snapshot. A test now fails when a rule the scanners emit is missing from that list.

- `@releaseready/config/dotenv` (`loadEnv`), `@releaseready/config/allure` (`allureReporter`) and `@releaseready/config/templates/*` (AGENTS.md, CLAUDE.md, copilot-instructions.md). Adds `dotenv` as a dependency (RRDSCRUM-420).
- `security-scan`: new step fails when tracked TypeScript uses `satisfies` as an identifier. Semgrep 1.186.0 still skips such lines (PartialParsing) without failing `--error`. Consumers can delete their own copy of this check (RRDSCRUM-395).

## 4.0.0 (2026-11-22)

New error-level rules, major release: a repo moving from 3.x can fail `releaseready-guardrails` until it fixes or allowlists the new findings. Measured with `--static` on `origin/main` of every consumer repo on 21 Nov 2026, after each repo's own allowlist:

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
