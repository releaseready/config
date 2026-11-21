import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import {
  applyAllowlist,
  baseline,
  findAll,
  loadConfig,
} from "../guardrails/index.js";
import { syncSkill } from "../guardrails/skill.js";

const cli = join(import.meta.dirname, "..", "guardrails", "cli.js");

/**
 * A throwaway git repo holding `files`, with the skill synced unless `skill` is false.
 *
 * @param {Record<string, string>} files
 * @param {{ skill?: boolean }} [options]
 */
async function repo(files, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "guardrails-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const all = {
    "AGENTS.md": "Read skills/releaseready-code-quality/SKILL.md.\n",
    "CLAUDE.md": "Read skills/releaseready-code-quality/SKILL.md.\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (options.skill !== false) await syncSkill(root);
  return root;
}

/** @param {Record<string, string>} files */
async function rulesHit(files) {
  return (await findAll(await repo(files))).map(
    (f) => `${f.rule} ${f.path}:${String(f.line)}`,
  );
}

describe("releaseready-guardrails rules", () => {
  test("a clean repo has no findings", async () => {
    assert.deepEqual(
      await rulesHit({
        "package.json": JSON.stringify({
          dependencies: { "@releaseready/ui-web": "^0.9.0", ajv: "8.20.0" },
        }),
        "src/a.ts": "export const a = 1;\n",
      }),
      [],
    );
  });

  test("dependency-source: git, SHA, tarball, file: and non-caret internal versions", async () => {
    const hits = await rulesHit({
      "package.json": JSON.stringify(
        {
          dependencies: {
            a: "github:releaseready/a#1e5a21f",
            b: "git+ssh://git@github.com/releaseready/b.git",
            c: "file:../c",
            d: "./vendor/d-1.0.0.tgz",
            e: "releaseready/e",
            "@releaseready/tokens": "0.2.0",
          },
          overrides: { f: { g: "https://example.com/g.tgz" } },
        },
        null,
        2,
      ),
      "package-lock.json":
        '{\n  "resolved": "git+ssh://git@github.com/x/y.git#abc1234"\n}\n',
    });
    assert.equal(
      hits.filter((h) => h.startsWith("dependency-source")).length,
      8,
    );
  });

  test("unpublished-internal-dependency: @releaseready/* from a local or build-output folder, a link or a tarball", async () => {
    const hits = await rulesHit({
      "package.json": JSON.stringify(
        {
          dependencies: {
            "@releaseready/a": "../a/dist",
            "@releaseready/v": "npm:@releaseready/v@../v",
            "rr-d": "npm:@releaseready/d@../d/dist",
            "rr-e": "npm:@releaseready/e@github:releaseready/e",
            "@releaseready/ok": "^1.2.0",
            "rr-ok": "npm:@releaseready/ok@^1.2.0",
          },
          overrides: { "@releaseready/f": "../f/dist" },
        },
        null,
        2,
      ),
      "package-lock.json": JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "node_modules/@releaseready/g": {
              resolved: "../g/dist",
              link: true,
            },
            "node_modules/@releaseready/h": {
              resolved:
                "https://github.com/releaseready/h/releases/download/v1.0.0/h-1.0.0.tgz",
            },
            "node_modules/@releaseready/ws": {
              resolved: "packages/ws",
              link: true,
            },
            "node_modules/@releaseready/reg": {
              resolved:
                "https://npm.pkg.github.com/download/@releaseready/reg/1.0.0/abc",
            },
            "node_modules/@releaseready/git": {
              resolved: "git+ssh://git@github.com/releaseready/git.git#abc1234",
            },
          },
        },
        null,
        2,
      ),
    });
    assert.deepEqual(
      hits.filter((h) => h.startsWith("unpublished-internal-dependency")),
      [
        "unpublished-internal-dependency package.json:4",
        "unpublished-internal-dependency package.json:5",
        "unpublished-internal-dependency package.json:6",
        "unpublished-internal-dependency package.json:11",
        "unpublished-internal-dependency package-lock.json:4",
        "unpublished-internal-dependency package-lock.json:8",
      ],
    );
    // A direct non-caret @releaseready/* spec and git sources stay dependency-source's, so nothing is reported twice.
    assert.deepEqual(
      hits.filter((h) => h.startsWith("dependency-source")),
      [
        "dependency-source package.json:3",
        "dependency-source package-lock.json:19",
      ],
    );
  });

  test("unpublished-internal-dependency: registry versions and workspace links pass", async () => {
    const hits = await rulesHit({
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        dependencies: { "@releaseready/ui-web": "^0.9.0" },
      }),
      "package-lock.json": JSON.stringify({
        packages: {
          "node_modules/@releaseready/ui-web": {
            resolved:
              "https://npm.pkg.github.com/download/@releaseready/ui-web/0.9.0/abc",
          },
          "node_modules/@releaseready/ws": {
            resolved: "packages/ws",
            link: true,
          },
        },
      }),
    });
    assert.deepEqual(hits, []);
  });

  test("unpublished-internal-dependency: nested '.' overrides and internal alias keys are not missed (Copilot review, PR #20)", async () => {
    const hits = await rulesHit({
      "package.json": JSON.stringify(
        {
          dependencies: { "@releaseready/k": "npm:external@../external/dist" },
          overrides: { "@releaseready/n": { ".": "../n/dist" } },
        },
        null,
        2,
      ),
    });
    assert.deepEqual(
      hits.filter((h) => h.startsWith("unpublished-internal-dependency")),
      [
        "unpublished-internal-dependency package.json:3",
        "unpublished-internal-dependency package.json:6",
      ],
    );
  });

  test("unpublished-internal-dependency: lockfile links resolve from the lockfile's folder (Copilot review, PR #20)", async () => {
    const hits = await rulesHit({
      // A nested lockfile linking a sibling workspace member stays inside the repository and passes.
      "packages/a/package-lock.json": JSON.stringify({
        packages: {
          "node_modules/@releaseready/b": { resolved: "../b", link: true },
        },
      }),
      // A root lockfile link that normalises outside the repository is reported.
      "package-lock.json": JSON.stringify(
        {
          packages: {
            "node_modules/@releaseready/out": {
              resolved: "packages/../../outside",
              link: true,
            },
          },
        },
        null,
        2,
      ),
    });
    assert.deepEqual(
      hits.filter((h) => h.startsWith("unpublished-internal-dependency")),
      ["unpublished-internal-dependency package-lock.json:3"],
    );
  });

  test("tsconfig: paths into dist or node_modules, strictness turned off", async () => {
    const hits = await rulesHit({
      "tsconfig.json": `{
  // comments are allowed
  "compilerOptions": {
    "strict": false,
    "paths": { "@x/y": ["node_modules/@x/y/dist/src/index.d.ts"], "@ok/*": ["src/*"] },
  },
}`,
    });
    assert.deepEqual(hits.sort(), [
      "tsconfig-not-strict tsconfig.json:4",
      "tsconfig-private-path tsconfig.json:5",
    ]);
  });

  test("build-in-node-modules", async () => {
    const hits = await rulesHit({
      "package.json": JSON.stringify(
        {
          scripts: {
            a: "npm run build:recipes --prefix node_modules/@releaseready/test-data-management",
            b: "tsc -p node_modules/x/tsconfig.json",
            c: "node_modules/.bin/tsc -p tsconfig.json",
          },
        },
        null,
        2,
      ),
    });
    assert.deepEqual(hits, [
      "build-in-node-modules package.json:3",
      "build-in-node-modules package.json:4",
    ]);
  });

  test("copied code: reference regex, canonical(), JWT verification and WCAG luminance", async () => {
    const hits = await rulesHit({
      "src/ref.ts":
        "export const ref = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;\n",
      "src/canonical.ts":
        "export function canonical(value: unknown) { return value; }\n",
      "src/jwt.ts":
        'import { jwtVerify } from "jose";\nawait jwtVerify(token, key);\n',
      "src/contrast.ts": "const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;\n",
      "src/fine.ts": "const canonicalPath = realpathSync(p);\n",
      "src/zip.ts":
        'import { inflateRawSync } from "node:zlib";\nconst data = inflateRawSync(raw);\nconst sig = 0x04034b50;\nconst hex = "\\x50\\x4b\\x03\\x04";\nconst pk = b"PK\\x03\\x04";\nconst be = buf.readUInt32BE(0) === 0x504b0304;\n',
      "src/gzip.ts": "const out = gunzipSync(buf);\n",
    });
    assert.deepEqual(hits.sort(), [
      "copied-canonical-digest src/canonical.ts:1",
      "copied-jwt-verifier src/jwt.ts:2",
      "copied-schema-primitive src/ref.ts:1",
      "copied-wcag-contrast src/contrast.ts:1",
      "hand-written-archive-parser src/zip.ts:2",
      "hand-written-archive-parser src/zip.ts:3",
      "hand-written-archive-parser src/zip.ts:4",
      "hand-written-archive-parser src/zip.ts:5",
      "hand-written-archive-parser src/zip.ts:6",
    ]);
  });

  test("UUID and digest regexes count only where test-management is a dependency", async () => {
    const source = {
      "src/ids.ts":
        "export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;\nexport const sha = /^[a-f0-9]{64}$/;\n",
    };
    assert.deepEqual(await rulesHit(source), []);
    const hits = await rulesHit({
      ...source,
      "package.json": JSON.stringify({
        dependencies: { "@releaseready/test-management": "^0.2.0" },
      }),
    });
    assert.deepEqual(hits, [
      "copied-schema-primitive src/ids.ts:1",
      "copied-schema-primitive src/ids.ts:2",
    ]);
  });

  test("legacy markers, skipped tests and unexplained rule overrides", async () => {
    const hits = await rulesHit({
      "src/old.ts":
        "/** @deprecated use next */\nexport const readLegacyRows = 1;\n// backwards-compatible alias\nexport const fine = 2;\n",
      "tests/a.test.ts":
        'test.skip("broken", () => {});\ntest("fine", { skip: true }, () => {});\n',
      "eslint.config.js": `export default [{ rules: {
  "no-console": "off",
  // Generated clients use any by design.
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "eqeqeq": ["off"], // inline reason
} }];
`,
    });
    assert.deepEqual(hits.sort(), [
      "eslint-rule-off-without-reason eslint.config.js:2",
      "legacy-marker src/old.ts:1",
      "legacy-marker src/old.ts:2",
      "legacy-marker src/old.ts:3",
      "skipped-test tests/a.test.ts:1",
      "skipped-test tests/a.test.ts:2",
    ]);
  });

  test("suppressions need a reason; process.argv indexing fails", async () => {
    const hits = await rulesHit({
      "src/a.ts": [
        "// eslint-disable-next-line no-console",
        "// eslint-disable-next-line no-console -- CLI prints results",
        "// eslint-disable-next-line no-console -- a CLI prints results",
        "// @ts-ignore",
        "// @ts-expect-error vendor typings are wrong",
        "// Vendor typings omit this field.",
        "// @ts-ignore",
        "/* eslint-disable no-console */",
        "const file = process.argv[2];",
        "const rest = process.argv.slice(2);",
        "",
      ].join("\n"),
    });
    assert.deepEqual(hits.sort(), [
      "argv-index src/a.ts:9",
      "suppression-without-reason src/a.ts:1",
      "suppression-without-reason src/a.ts:4",
      "suppression-without-reason src/a.ts:8",
    ]);
  });

  test("suppression-without-reason and argv-index: an allow entry needs a reason", async () => {
    for (const rule of ["suppression-without-reason", "argv-index"]) {
      const noReason = await repo({
        "releaseready-guardrails.json": JSON.stringify({
          allow: [{ rule, path: "src/a.ts" }],
        }),
      });
      assert.throws(() => loadConfig(noReason), /reason/);
    }
  });

  test("scanner patterns: runtime assert and literal /tmp outside tests", async () => {
    const hits = await rulesHit({
      "control/run.py":
        'import os\nassert os.path.isabs(p), "bad"\nenv = {"TMPDIR": "/tmp"}\nok = os.environ.get("A", "/var/empty")\n',
      "control/test_run.py": "assert 1 == 1\nx = '/tmp/x'\n",
      "src/tmp.ts": 'export const dir = "/tmp/cache";\n',
      "tests/tmp.test.ts": 'export const dir = "/tmp/cache";\n',
    });
    assert.deepEqual(hits.sort(), [
      "hardcoded-tmp control/run.py:3",
      "hardcoded-tmp src/tmp.ts:1",
      "runtime-assert control/run.py:2",
    ]);
  });

  test("hardcoded-tmp: an allow entry with a reason suppresses exactly that path, a stale entry is unused-allow", async () => {
    const files = {
      "src/container.ts": 'export const tmpfs = "/tmp";\n',
      "src/other.ts": 'export const dir = "/tmp/cache";\n',
    };
    const entry = {
      rule: "hardcoded-tmp",
      path: "src/container.ts",
      reason: "Container path: the tmpfs mounted inside the Docker container",
    };
    const unallowed = await repo(files);
    assert.deepEqual(
      applyAllowlist(
        await findAll(unallowed),
        loadConfig(unallowed).allow ?? [],
      )
        .reported.map((f) => `${f.rule} ${f.path}`)
        .sort(),
      ["hardcoded-tmp src/container.ts", "hardcoded-tmp src/other.ts"],
    );

    const noReason = await repo({
      "releaseready-guardrails.json": JSON.stringify({
        allow: [{ rule: "hardcoded-tmp", path: "src/container.ts" }],
      }),
    });
    assert.throws(() => loadConfig(noReason), /reason/);

    const allowed = await repo({
      ...files,
      "releaseready-guardrails.json": JSON.stringify({ allow: [entry] }),
    });
    const { reported, allowed: count } = applyAllowlist(
      await findAll(allowed),
      loadConfig(allowed).allow ?? [],
    );
    assert.deepEqual(
      reported.map((f) => `${f.rule} ${f.path}`),
      ["hardcoded-tmp src/other.ts"],
    );
    assert.equal(count, 1);

    const stale = await repo({
      "src/other.ts": files["src/other.ts"],
      "releaseready-guardrails.json": JSON.stringify({ allow: [entry] }),
    });
    assert.deepEqual(
      applyAllowlist(await findAll(stale), loadConfig(stale).allow ?? [])
        .reported.map((f) => `${f.rule} ${f.path}`)
        .sort(),
      [
        "hardcoded-tmp src/other.ts",
        "unused-allow releaseready-guardrails.json",
      ],
    );
  });

  test("readme-dated-history: dated headings, status lines and ticket headings", async () => {
    const hits = await rulesHit({
      "README.md":
        "# RRDPLAT-34 local stack\n\n## Usage\n\n## Migration status — 15 November 2026\n\nStatus as of 2026-11-12: green\n\n## Install\n",
    });
    assert.deepEqual(hits, [
      "readme-dated-history README.md:1",
      "readme-dated-history README.md:5",
      "readme-dated-history README.md:7",
    ]);
  });

  test("tracked-ds-store: fails on a tracked .DS_Store at any depth, not on an untracked or ignored one", async () => {
    const root = await repo({
      ".gitignore": "ignored/.DS_Store\n",
      ".DS_Store": "x",
      "docs/.DS_Store": "x",
      "docs/a.md": "a\n",
      "ignored/.DS_Store": "x",
      "untracked/.DS_Store": "x",
    });
    execFileSync("git", ["add", "-f", ".gitignore", ".DS_Store", "docs"], {
      cwd: root,
    });
    const hits = (await findAll(root))
      .filter((f) => f.rule === "tracked-ds-store")
      .map((f) => f.path);
    assert.deepEqual(hits, [".DS_Store", "docs/.DS_Store"]);

    execFileSync(
      "git",
      ["rm", "--cached", "-q", ".DS_Store", "docs/.DS_Store"],
      {
        cwd: root,
      },
    );
    assert.deepEqual(
      (await findAll(root)).filter((f) => f.rule === "tracked-ds-store"),
      [],
    );
  });

  test("tracked-build-output: one finding per tracked dist/ or build/ folder, not for untracked ones", async () => {
    const root = await repo({
      "dist/index.js": "x",
      "dist/types/index.d.ts": "x",
      "packages/x/build/a.js": "x",
      "src/builder.ts": "export const b = 1;\n",
      "docs/build.md": "build\n",
      "untracked/dist/a.js": "x",
    });
    execFileSync("git", ["add", "dist", "packages", "src", "docs"], {
      cwd: root,
    });
    const hits = (await findAll(root))
      .filter((f) => f.rule === "tracked-build-output")
      .map((f) => `${f.path} ${f.message.split(":")[0] ?? ""}`);
    assert.deepEqual(hits, [
      "dist 2 tracked file(s) under dist/",
      "packages/x/build 1 tracked file(s) under packages/x/build/",
    ]);

    execFileSync("git", ["rm", "-r", "--cached", "-q", "dist", "packages"], {
      cwd: root,
    });
    assert.deepEqual(
      (await findAll(root)).filter((f) => f.rule === "tracked-build-output"),
      [],
    );
  });

  test("oversized-source-file: 1,000 lines pass, 1,001 fail; generated files and configured globs are excluded", async () => {
    const lines = (/** @type {number} */ n) => "x;\n".repeat(n);
    const hits = await rulesHit({
      "src/under.ts": lines(1000),
      "src/over.ts": lines(1001),
      "src/over.py": lines(1001),
      "src/no-final-newline.ts": lines(1000).slice(0, -1),
      "README.md": lines(5000),
      "apps/shared/generated/central-api.d.ts": lines(5000),
      "src/api.generated.ts": lines(5000),
      "src/vendor/big.ts": lines(5000),
      "releaseready-guardrails.json": JSON.stringify({
        fileLength: {
          generated: [
            {
              path: "src/vendor/**",
              reason: "Written by scripts/vendor.mts from the upstream schema",
            },
          ],
        },
      }),
    });
    assert.deepEqual(hits.sort(), [
      "oversized-source-file src/over.py:1001",
      "oversized-source-file src/over.ts:1001",
    ]);
  });

  test("oversized-source-file: CR, CRLF, U+2028 and U+2029 count as line breaks (Copilot review, PR #21)", async () => {
    const lines = (/** @type {number} */ n, /** @type {string} */ eol) =>
      `x;${eol}`.repeat(n);
    const hits = await rulesHit({
      "src/cr.js": lines(1001, "\r"),
      "src/crlf.ts": lines(1001, "\r\n"),
      "src/ls.js": lines(1001, "\u2028"),
      "src/ps.mjs": lines(1001, "\u2029"),
      "src/cr.py": lines(1001, "\r"),
      "src/crlf-ok.ts": lines(1000, "\r\n"),
      // U+2028 is not a line break in Python, so this file is one long line.
      "src/ls.py": lines(1001, "\u2028"),
    });
    assert.deepEqual(hits.sort(), [
      "oversized-source-file src/cr.js:1001",
      "oversized-source-file src/cr.py:1001",
      "oversized-source-file src/crlf.ts:1001",
      "oversized-source-file src/ls.js:1001",
      "oversized-source-file src/ps.mjs:1001",
    ]);
  });

  test("oversized-source-file: the limit is configurable", async () => {
    const hits = await rulesHit({
      "src/a.ts": "x;\n".repeat(51),
      "src/b.ts": "x;\n".repeat(50),
      "releaseready-guardrails.json": JSON.stringify({
        fileLength: { maxLines: 50 },
      }),
    });
    assert.deepEqual(hits, ["oversized-source-file src/a.ts:51"]);
  });

  test("skill-drift: missing copy, edited copy, extra file and AGENTS.md without the pointer", async () => {
    const root = await repo(
      { "AGENTS.md": "No pointer here.\n" },
      { skill: false },
    );
    const missing = (await findAll(root)).filter(
      (f) => f.rule === "skill-drift",
    );
    assert.ok(missing.some((f) => f.path === "AGENTS.md"));
    assert.ok(
      missing.some(
        (f) => f.path === "skills/releaseready-code-quality/SKILL.md",
      ),
    );
    await syncSkill(root);
    writeFileSync(
      join(root, "skills/releaseready-code-quality/SKILL.md"),
      "edited",
    );
    writeFileSync(
      join(root, "skills/releaseready-code-quality/extra.md"),
      "extra",
    );
    const drift = (await findAll(root))
      .filter((f) => f.rule === "skill-drift")
      .map((f) => f.path)
      .sort();
    assert.deepEqual(drift, [
      "AGENTS.md",
      "skills/releaseready-code-quality/SKILL.md",
      "skills/releaseready-code-quality/extra.md",
    ]);
  });
});

describe("allowlist", () => {
  const finding = (/** @type {string} */ path, /** @type {string} */ text) => ({
    rule: "legacy-marker",
    path,
    line: 1,
    message: "m",
    text,
  });

  test("allows by rule, glob and match; reports entries that match nothing", () => {
    const { reported, allowed } = applyAllowlist(
      [finding("src/a.ts", "legacyRows"), finding("src/b.ts", "legacyRows")],
      [
        {
          rule: "legacy-marker",
          path: "src/a.ts",
          match: "legacyRows",
          reason: "consumer: x",
        },
        { rule: "legacy-marker", path: "src/c.ts", reason: "consumer: y" },
      ],
    );
    assert.equal(allowed, 1);
    assert.deepEqual(
      reported.map((f) => `${f.rule} ${f.path}`),
      ["legacy-marker src/b.ts", "unused-allow releaseready-guardrails.json"],
    );
  });

  test("max is a ratchet: more findings fail, fewer ask for a lower max", () => {
    const entry = {
      rule: "legacy-marker",
      path: "src/**",
      max: 2,
      reason: "r",
    };
    const three = applyAllowlist(
      [
        finding("src/a.ts", "x"),
        finding("src/a.ts", "y"),
        finding("src/b.ts", "z"),
      ],
      [entry],
    );
    assert.deepEqual(
      three.reported.map((f) => f.path),
      ["src/b.ts"],
    );
    const one = applyAllowlist([finding("src/a.ts", "x")], [entry]);
    assert.match(one.reported[0]?.message ?? "", /lower max to 1/);
  });

  test("baseline groups findings per rule and file with empty reasons", () => {
    assert.deepEqual(
      baseline([finding("src/a.ts", "x"), finding("src/a.ts", "y")]),
      [{ rule: "legacy-marker", path: "src/a.ts", max: 2, reason: "" }],
    );
  });

  test("config validation rejects missing or placeholder reasons and unexplained thresholds", async () => {
    for (const config of [
      { allow: [{ rule: "legacy-marker", path: "a.ts", reason: "" }] },
      {
        allow: [
          {
            rule: "legacy-marker",
            path: "a.ts",
            reason: "TODO write the reason later",
          },
        ],
      },
      {
        allow: [
          {
            rule: "no-such-rule",
            path: "a.ts",
            reason: "a long enough reason here",
          },
        ],
      },
      {
        allow: [
          { rule: "unpublished-internal-dependency", path: "package.json" },
        ],
      },
      { allow: [{ rule: "tracked-build-output", path: "dist", reason: "" }] },
      { allow: [{ rule: "tracked-ds-store", path: ".DS_Store" }] },
      { allow: [{ rule: "hardcoded-tmp", path: "src/tmp.ts" }] },
      { allow: [{ rule: "hardcoded-tmp", path: "src/tmp.ts", reason: "" }] },
      { allow: [{ rule: "oversized-source-file", path: "src/big.ts" }] },
      { fileLength: { maxLines: 1500 } },
      { fileLength: { generated: [{ path: "src/gen/**" }] } },
      {
        fileLength: {
          generated: [{ path: "src/gen/**", reason: "TODO say why later" }],
        },
      },
      { jscpd: { threshold: 9 } },
      { knip: { enabled: false } },
    ]) {
      const root = await repo({
        "releaseready-guardrails.json": JSON.stringify(config),
      });
      assert.throws(
        () => loadConfig(root),
        /releaseready-guardrails\.json/,
        JSON.stringify(config),
      );
    }
  });
  test("the new rules can be allowed with a reason", async () => {
    const root = await repo({
      "releaseready-guardrails.json": JSON.stringify({
        allow: [
          {
            rule: "unpublished-internal-dependency",
            path: "package.json",
            reason:
              "Example entry: the consumer and the removal ticket go here",
          },
          {
            rule: "tracked-build-output",
            path: "dist",
            reason:
              "Example entry: the consumer and the removal ticket go here",
          },
        ],
      }),
    });
    assert.equal(loadConfig(root).allow?.length, 2);
  });

  test("an oversized file can be allowed with a reason, and a higher limit with a reason", async () => {
    const root = await repo({
      "src/big.ts": "x;\n".repeat(1001),
      "releaseready-guardrails.json": JSON.stringify({
        allow: [
          {
            rule: "oversized-source-file",
            path: "src/big.ts",
            reason: "Being split by RRDSCRUM-999; the count may only fall",
          },
        ],
      }),
    });
    const { reported } = applyAllowlist(
      await findAll(root),
      loadConfig(root).allow ?? [],
    );
    assert.deepEqual(reported, []);
    const raised = await repo({
      "releaseready-guardrails.json": JSON.stringify({
        fileLength: {
          maxLines: 1200,
          reason: "Measured 1,180 lines in the parser on 20 Nov 2026",
        },
      }),
    });
    assert.equal(loadConfig(raised).fileLength?.maxLines, 1200);
  });
});

describe("CLI", () => {
  test("exits 1 on findings and 0 once they are allowed with a reason", async () => {
    const root = await repo({ "src/old.ts": "export const legacyRows = 1;\n" });
    const failing = spawnSync(process.execPath, [cli, "--static"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(failing.status, 1, failing.stdout);
    assert.match(failing.stdout, /src\/old\.ts:1 {2}legacy-marker/);
    writeFileSync(
      join(root, "releaseready-guardrails.json"),
      JSON.stringify({
        allow: [
          {
            rule: "legacy-marker",
            path: "src/old.ts",
            max: 1,
            reason: "Read by the Dev seed in ReleaseReady apps/dev/inputs.ts",
          },
        ],
      }),
    );
    const passing = spawnSync(process.execPath, [cli, "--static"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(passing.status, 0, passing.stdout);
  });
});
