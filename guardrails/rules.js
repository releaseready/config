// Static rules of releaseready-guardrails. Each rule names the 18 Nov 2026 review findings it prevents; the skill
// (skill/releaseready-code-quality/SKILL.md) explains the fix. Every rule is a pure function of the repo's files.
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { minimatch } from "minimatch";
import { posix } from "node:path";

/**
 * @typedef {object} Finding
 * @property {string} rule
 * @property {string} path repo-relative, forward slashes
 * @property {number} line 1-based; 0 when the finding is about the whole file
 * @property {string} message
 * @property {string} [text] the offending line, used by allowlist `match`
 */

/**
 * @typedef {object} RepoFiles
 * @property {string[]} paths every tracked or unignored file, repo-relative
 * @property {string[]} tracked every path in the git index, repo-relative (not filtered by the working tree)
 * @property {(path: string) => string} read
 */

/** @typedef {import("./index.js").GuardrailsConfig} GuardrailsConfig */

/** @typedef {(repo: RepoFiles, config: GuardrailsConfig) => Finding[]} Rule */

const sourceGlob = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}";
const testGlobs = [
  "**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/{test,tests,__tests__,e2e}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
];

/** Paths no rule scans: dependencies and build output. */
export const alwaysExcluded = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.build/**",
  "**/coverage/**",
  "**/.venv/**",
  "**/__pycache__/**",
];

/** The skill's own text names every marker it forbids; skill-drift checks it instead. */
const skillCopies = [
  "skills/releaseready-code-quality/**",
  ".claude/skills/releaseready-code-quality/**",
];

/**
 * @param {string} path
 * @param {string | string[]} globs
 */
export function matches(path, globs) {
  return (Array.isArray(globs) ? globs : [globs]).some((glob) =>
    minimatch(path, glob, { dot: true }),
  );
}

/**
 * Report each line of every file under `globs` that matches one of `patterns`.
 *
 * @param {RepoFiles} repo
 * @param {string | string[]} globs
 * @param {{ rule: string; pattern: RegExp; message: string }[]} patterns
 * @returns {Finding[]}
 */
function scanLines(repo, globs, patterns) {
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter(
    (p) => matches(p, globs) && !matches(p, skillCopies),
  )) {
    const lines = repo.read(path).split("\n");
    lines.forEach((text, index) => {
      for (const { rule, pattern, message } of patterns) {
        if (pattern.test(text)) {
          findings.push({ rule, path, line: index + 1, message, text });
        }
      }
    });
  }
  return findings;
}

/**
 * @param {RepoFiles} repo
 * @param {string} path
 * @returns {unknown}
 */
function readJsonc(repo, path) {
  /** @type {import("jsonc-parser").ParseError[]} */
  const errors = [];
  const value = /** @type {unknown} */ (
    parseJsonc(repo.read(path), errors, { allowTrailingComma: true })
  );
  if (errors.length > 0) {
    const codes = errors.map((e) => printParseErrorCode(e.error)).join(", ");
    throw new Error(`${path}: cannot parse (${codes})`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Line number of the first line containing `needle`, for findings in JSON files.
 *
 * @param {RepoFiles} repo
 * @param {string} path
 * @param {string} needle
 */
function lineOf(repo, path, needle) {
  const index = repo
    .read(path)
    .split("\n")
    .findIndex((line) => line.includes(needle));
  return index + 1;
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
];

/** Version specs that do not come from a registry. */
const nonRegistrySpec = [
  /^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:)/,
  /^https?:/,
  /^(?:file|link|portal):/,
  /\.(?:tgz|tar\.gz|tar)$/,
  /#[0-9a-f]{7,40}$/,
  /^[\w.-]+\/[\w.-]+(?:#.*)?$/, // GitHub shorthand owner/repo
];

/**
 * @param {unknown} node
 * @param {string[]} trail
 * @returns {Generator<[string[], string]>}
 */
function* specs(node, trail) {
  if (typeof node === "string") {
    yield [trail, node];
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      yield* specs(value, [...trail, key]);
    }
  }
}

/**
 * RR-14, RR-15, FUI-04, TDM-11, TDM-12, UPF-16, RPT-15: dependencies come from the registry, internal ones as `^`.
 *
 * @type {Rule}
 */
function dependencySource(repo) {
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter((p) => matches(p, "**/package.json"))) {
    const pkg = readJsonc(repo, path);
    if (!isRecord(pkg)) continue;
    for (const field of dependencyFields) {
      for (const [trail, spec] of specs(pkg[field], [])) {
        const name = trail.at(-1) ?? "";
        const where = `${field}.${trail.join(".")}`;
        if (nonRegistrySpec.some((re) => re.test(spec))) {
          findings.push({
            rule: "dependency-source",
            path,
            line: lineOf(repo, path, `"${name}"`),
            message: `${where} is "${spec}": depend on a published registry version (^x.y.z), not a git, SHA, tarball or file source`,
            text: `${name}: ${spec}`,
          });
        } else if (
          name.startsWith("@releaseready/") &&
          field !== "overrides" &&
          !spec.startsWith("npm:") &&
          !/^\^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(spec)
        ) {
          findings.push({
            rule: "dependency-source",
            path,
            line: lineOf(repo, path, `"${name}"`),
            message: `${where} is "${spec}": internal packages are depended on as a caret range (^x.y.z)`,
            text: `${name}: ${spec}`,
          });
        }
      }
    }
  }
  for (const path of repo.paths.filter((p) =>
    matches(p, "**/package-lock.json"),
  )) {
    repo
      .read(path)
      .split("\n")
      .forEach((text, index) => {
        if (
          /"resolved":\s*"(?:git\+|git:|file:|https?:\/\/codeload)/.test(text)
        ) {
          findings.push({
            rule: "dependency-source",
            path,
            line: index + 1,
            message:
              "lockfile resolves a package from git or a file: depend on a published registry version",
            text,
          });
        }
      });
  }
  return findings;
}

const internalScope = "@releaseready/";

/** Local folder specs (`../x`, `./x`, `/x`, `~/x`) and specs that point into build output (`…/dist`, `…/build`). */
const localOrBuildSpec = [
  /^(?:\.{1,2}|~)?\//,
  /(?:^|\/)(?:dist|build)(?:\/|$)/,
];

/** Lockfile `resolved` hosts that serve release or source tarballs, not a package registry. */
const tarballHosts =
  /^https:\/\/(?:github\.com|codeload\.github\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com)\//;

/**
 * The package an `npm:` alias installs and the spec it installs it at, or the key and spec themselves.
 *
 * @param {string} name
 * @param {string} spec
 */
function aliasTarget(name, spec) {
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/.exec(spec);
  return alias
    ? { name: alias[1] ?? name, spec: alias[2] ?? "" }
    : { name, spec };
}

/**
 * Whether a lockfile `link: true` target, resolved against the lockfile's own folder, leaves the repository or points
 * into a dist/ or build/ folder. Links to workspace members inside the repository pass.
 *
 * @param {string} lockfilePath repository-relative path of the lockfile
 * @param {string} resolved the entry's `resolved` value
 */
function linkLeavesRepoOrIsBuildOutput(lockfilePath, resolved) {
  if (resolved.startsWith("/") || resolved.startsWith("~")) return true;
  const target = posix.normalize(
    posix.join(posix.dirname(lockfilePath), resolved),
  );
  return (
    target === ".." ||
    target.startsWith("../") ||
    /(?:^|\/)(?:dist|build)(?:\/|$)/.test(target)
  );
}

/**
 * Nov 2026 review: `@releaseready/*` installed from somewhere other than the registry, in the places
 * `dependency-source` does not look: an `npm:` alias, an `overrides` entry, and lockfile entries that link a local or
 * build-output folder or resolve to a release tarball. Specs `dependency-source` reports are not reported twice.
 *
 * @type {Rule}
 */
function unpublishedInternalDependency(repo) {
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter((p) => matches(p, "**/package.json"))) {
    const pkg = readJsonc(repo, path);
    if (!isRecord(pkg)) continue;
    for (const field of dependencyFields) {
      for (const [trail, spec] of specs(pkg[field], [])) {
        // A nested override keyed "." overrides its parent selector, so the parent is the package's identity.
        const leaf = trail.at(-1) ?? "";
        const key = leaf === "." ? (trail.at(-2) ?? "") : leaf;
        const target = aliasTarget(key, spec);
        // Either side of an alias can name the internal package: "@releaseready/a": "npm:external@..." too.
        const internalName = key.startsWith(internalScope) ? key : target.name;
        // dependency-source reports every non-registry spec, and every non-caret @releaseready/* key outside overrides.
        const reportedElsewhere =
          nonRegistrySpec.some((re) => re.test(spec)) ||
          (key.startsWith(internalScope) &&
            field !== "overrides" &&
            !spec.startsWith("npm:"));
        if (
          internalName.startsWith(internalScope) &&
          !reportedElsewhere &&
          [...nonRegistrySpec, ...localOrBuildSpec].some((re) =>
            re.test(target.spec),
          )
        ) {
          findings.push({
            rule: "unpublished-internal-dependency",
            path,
            line: lineOf(repo, path, `"${key}"`),
            message: `${field}.${trail.join(".")} is "${spec}": install ${internalName} from the registry as ^x.y.z, not from git, a tarball, or a local or build-output folder`,
            text: `${key}: ${spec}`,
          });
        }
      }
    }
  }
  for (const path of repo.paths.filter((p) =>
    matches(p, "**/package-lock.json"),
  )) {
    const lock = readJsonc(repo, path);
    const packages = isRecord(lock) ? lock.packages : undefined;
    if (!isRecord(packages)) continue;
    for (const [key, entry] of Object.entries(packages)) {
      if (!/(?:^|\/)node_modules\/@releaseready\/[^/]+$/.test(key)) continue;
      if (!isRecord(entry) || typeof entry.resolved !== "string") continue;
      const resolved = entry.resolved;
      // A link inside the repo is a workspace member; dependency-source already reports git and file: sources.
      const bad =
        entry.link === true
          ? linkLeavesRepoOrIsBuildOutput(path, resolved)
          : !/^(?:git\+|git:|file:|https?:\/\/codeload)/.test(resolved) &&
            (!resolved.startsWith("https://") || tarballHosts.test(resolved));
      if (bad) {
        findings.push({
          rule: "unpublished-internal-dependency",
          path,
          line: lineOf(repo, path, `"${key}"`),
          message: `${key} resolves to "${resolved}": install it from the registry, not a ${entry.link === true ? "linked local folder" : "release tarball or local file"}`,
          text: `${key}: ${resolved}`,
        });
      }
    }
  }
  return findings;
}

const strictFamily = [
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "noImplicitThis",
  "alwaysStrict",
  "useUnknownInCatchVariables",
];

/**
 * RR-14, RPT-08, UPF-14 (paths into private build output) and standard 2 (strictness turned off).
 *
 * @type {Rule}
 */
function tsconfig(repo) {
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter((p) =>
    matches(p, ["**/tsconfig*.json", "**/jsconfig*.json"]),
  )) {
    const config = readJsonc(repo, path);
    const options = isRecord(config) ? config.compilerOptions : undefined;
    if (!isRecord(options)) continue;
    const paths = options.paths;
    if (isRecord(paths)) {
      for (const [alias, targets] of Object.entries(paths)) {
        for (const target of Array.isArray(targets) ? targets : []) {
          if (
            typeof target === "string" &&
            /(?:^|\/)(?:dist|node_modules)(?:\/|$)/.test(target)
          ) {
            findings.push({
              rule: "tsconfig-private-path",
              path,
              line: lineOf(repo, path, `"${alias}"`),
              message: `paths "${alias}" → "${target}": import the package's published export instead of aliasing into dist/ or node_modules`,
              text: `${alias}: ${target}`,
            });
          }
        }
      }
    }
    for (const option of strictFamily) {
      if (options[option] === false) {
        findings.push({
          rule: "tsconfig-not-strict",
          path,
          line: lineOf(repo, path, `"${option}"`),
          message: `${option} is false: fix the type errors instead of turning strictness off`,
          text: option,
        });
      }
    }
  }
  return findings;
}

const buildInNodeModules = [
  /--prefix[= ]\S*node_modules/,
  /\bcd\s+\S*node_modules/,
  /(?:\s-p|--project)[= ]\S*node_modules/,
  /\b(?:tsc|npm\s+run\s+build|npm\s+install)\b[^&|;]*node_modules\/(?!\.bin\/)/,
];

/**
 * TDM-11, RPT-15, TM-21: never build a dependency inside node_modules.
 *
 * @type {Rule}
 */
function buildInDependency(repo) {
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter((p) => matches(p, "**/package.json"))) {
    const pkg = readJsonc(repo, path);
    const scripts = isRecord(pkg) ? pkg.scripts : undefined;
    if (!isRecord(scripts)) continue;
    for (const [name, script] of Object.entries(scripts)) {
      if (
        typeof script === "string" &&
        buildInNodeModules.some((re) => re.test(script))
      ) {
        findings.push({
          rule: "build-in-node-modules",
          path,
          line: lineOf(repo, path, `"${name}"`),
          message: `script "${name}" builds inside node_modules: consume the dependency's published build`,
          text: `${name}: ${script}`,
        });
      }
    }
  }
  return findings;
}

/**
 * True when the repo is test-management or depends on it, so its schema primitives can be imported.
 *
 * @param {RepoFiles} repo
 */
function usesTestManagement(repo) {
  if (!repo.paths.includes("package.json")) return false;
  const pkg = readJsonc(repo, "package.json");
  if (!isRecord(pkg)) return false;
  if (pkg.name === "@releaseready/test-management") return true;
  return dependencyFields.some((field) => {
    const deps = pkg[field];
    return isRecord(deps) && "@releaseready/test-management" in deps;
  });
}

/**
 * TM-06, TM-07, TM-16, TM-18, TDM-06, TDM-07, TDM-21, RPT-11: code that belongs to a shared package.
 *
 * @type {Rule}
 */
function copiedCode(repo) {
  const findings = scanLines(repo, sourceGlob, [
    {
      rule: "copied-schema-primitive",
      pattern: /A-Za-z0-9\]\[A-Za-z0-9\._:-\]/,
      message:
        "re-declared reference regex: import it from @releaseready/test-management/schema/v1",
    },
    {
      rule: "copied-canonical-digest",
      pattern:
        /\b(?:function\s*\*?\s*|(?:const|let|var)\s+)(?:canonical(?:ize|Json|JSON|Stringify|Digest)?|stableStringify|sortedStringify)\b\s*[=(<]/,
      message:
        "local canonical JSON/digest: import @releaseready/test-management/canonical/v1 (or the RFC 8785 `canonicalize` package where test-management is not a dependency)",
    },
    {
      rule: "copied-jwt-verifier",
      pattern:
        /\b(?:jwtVerify|createRemoteJWKSet|createLocalJWKSet)\s*\(|(?:from\s+|require\()\s*["'](?:jsonwebtoken|jwks-rsa)["']|^\s*(?:import|from)\s+jwt\b|\bjwt\.decode\(/,
      message:
        "local JWT verification: use the verifier from @releaseready/test-management/identity/v1",
    },
    {
      rule: "hand-written-archive-parser",
      pattern:
        /\b(?:inflateRaw(?:Sync)?|createInflateRaw)\s*\(|\b0x(?:0?4034b50|0?8074b50|504b0304|504b0708)\b|(?:\\x50\\x4b|PK)\\x03\\x04/i,
      message:
        "hand-written ZIP parsing (raw inflate or a local-file-header signature): use a maintained library such as fflate or yauzl",
    },
    // UUID and digest regexes are generic; they are copies only where the shared primitive is available.
    ...(usesTestManagement(repo)
      ? [
          {
            rule: "copied-schema-primitive",
            pattern: /\[(?:[0-9a-fA-F]|\\d|-){3,10}\]\{8\}-/,
            message:
              "hand-written UUID regex: import the uuid primitive from @releaseready/test-management/schema/v1",
          },
          {
            rule: "copied-schema-primitive",
            pattern: /\[(?:[0-9a-fA-F]|\\d|-){3,10}\]\{64\}/,
            message:
              "hand-written SHA-256 digest regex: import the digest primitive from @releaseready/test-management/schema/v1",
          },
        ]
      : []),
  ]);
  // Hand-written WCAG relative luminance: the sRGB coefficients appear together.
  for (const path of repo.paths.filter((p) => matches(p, sourceGlob))) {
    const lines = repo.read(path).split("\n");
    const joined = lines.join("\n");
    const luminance = /0\.2126/.test(joined) && /0\.7152/.test(joined);
    const linearise =
      /0\.0392[18]|0\.04045/.test(joined) && /2\.4\b/.test(joined);
    if (luminance || linearise) {
      const index = lines.findIndex((l) =>
        luminance ? l.includes("0.2126") : /0\.0392[18]|0\.04045/.test(l),
      );
      findings.push({
        rule: "copied-wcag-contrast",
        path,
        line: index + 1,
        message:
          'hand-written WCAG luminance/contrast maths: use colorjs.io (Color.contrast(a, b, "WCAG21"))',
        text: lines[index] ?? "",
      });
    }
  }
  return findings;
}

const pythonTestGlobs = [
  "**/test_*.py",
  "**/*_test.py",
  "**/{test,tests,task-system-tests}/**/*.py",
];

/**
 * Scanner findings (SonarCloud review of ai-orchestrator, 20 Nov 2026): patterns an agent keeps reintroducing.
 * `assert` vanishes under `python -O` and is not error handling; a literal `/tmp` is a publicly writable directory.
 *
 * @type {Rule}
 */
function scannerPatterns(repo) {
  const notTest = (/** @type {Finding} */ f) =>
    !matches(f.path, testGlobs) && !matches(f.path, pythonTestGlobs);
  return [
    ...scanLines(repo, "**/*.py", [
      {
        rule: "runtime-assert",
        pattern: /^\s*assert\s/,
        message:
          "assert is not a runtime check (removed by python -O): `if not cond: raise SomeError(...)`",
      },
    ]),
    ...scanLines(repo, sourceGlob, [
      {
        rule: "hardcoded-tmp",
        pattern: /["']\/tmp(?:\/[^"']*)?["']/,
        message:
          "literal /tmp is publicly writable: use a private directory from tempfile.mkdtemp / fs.mkdtemp (or /var/empty when nothing is written)",
      },
    ]),
  ].filter(notTest);
}

/**
 * Nov 2026 audit: a suppression or a hand-indexed `process.argv` keeps coming back.
 * A suppression is fine with a reason (`-- why` for ESLint, text after `@ts-expect-error`, or a comment on the line above).
 *
 * @type {Rule}
 */
function suppressionsAndArgv(repo) {
  const jsGlob = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";
  const directive =
    /(?:\/\/|\/\*+)\s*(eslint-disable(?:-next-line|-line)?|@ts-ignore|@ts-expect-error)(?![\w-])(.*)$/;
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter(
    (p) => matches(p, jsGlob) && !matches(p, skillCopies),
  )) {
    const lines = repo.read(path).split("\n");
    lines.forEach((text, index) => {
      const found = directive.exec(text);
      if (found) {
        const rest = (found[2] ?? "").replace(/\*\/.*$/, "");
        const inline = found[1]?.startsWith("eslint")
          ? /--\s+.*[A-Za-z]{3}/.test(rest)
          : /[A-Za-z]{3}/.test(rest);
        const above = (lines[index - 1] ?? "").trim();
        const explained =
          /^(?:\/\/|\/\*|\*)/.test(above) &&
          !directive.test(above) &&
          /[A-Za-z]{3}/.test(above);
        if (!inline && !explained) {
          findings.push({
            rule: "suppression-without-reason",
            path,
            line: index + 1,
            message: `${found[1]} without a reason: fix the code, or say why (\`-- reason\` for eslint-disable, text after @ts-ignore / @ts-expect-error)`,
            text,
          });
        }
      }
      if (/\bprocess\.argv\s*\[\s*\d+\s*\]/.test(text)) {
        findings.push({
          rule: "argv-index",
          path,
          line: index + 1,
          message:
            "process.argv[<n>] indexing: parse arguments with node:util parseArgs (or commander / yargs)",
          text,
        });
      }
    });
  }
  return findings;
}

/**
 * Standard 1: RR-03, RR-04, TM-11, TM-12, UPF-01, UPF-02, FUI-17. Deprecated, legacy and compatibility code.
 *
 * @type {Rule}
 */
function legacyMarkers(repo) {
  return scanLines(repo, sourceGlob, [
    {
      rule: "legacy-marker",
      pattern:
        /@deprecated\b|legacy|\bbackwards?[- _]?compat|\bcompat(?:ibility)?[ _-]?(?:layer|shim|mode|path|alias|code|wrapper|reader)\b|\bshims?\b|\bTODO:?\s*remove\b/i,
      message:
        "legacy/compatibility marker: delete the old code, or name its current consumer in an allowlist entry",
    },
  ]);
}

/**
 * Standard 2: skipped tests hide failures. Focused (.only) tests are caught by ESLint (no-only-tests).
 *
 * @type {Rule}
 */
function skippedTests(repo) {
  return scanLines(repo, testGlobs, [
    {
      rule: "skipped-test",
      pattern:
        /\b(?:describe|it|test|suite|context)\.(?:skip|todo)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(|[{,]\s*(?:skip|todo)\s*:\s*(?:true|["'`])/,
      message:
        "skipped test: fix it or delete it; a conditional skip needs an allowlist entry with the reason",
    },
  ]);
}

/**
 * Standard 2: a rule turned off in the repo's ESLint config needs a comment saying why (UA2-06, UPF-03).
 *
 * @type {Rule}
 */
function eslintConfigOverrides(repo) {
  /** @type {Finding[]} */
  const findings = [];
  const ruleOff =
    /^\s*["']?[@\w/.-]+["']?\s*:\s*(?:["'](?:off|warn)["']|0\b|\[\s*(?:["'](?:off|warn)["']|0\b))/;
  for (const path of repo.paths.filter((p) =>
    matches(p, "**/eslint.config.{js,mjs,cjs,ts,mts,cts}"),
  )) {
    const lines = repo.read(path).split("\n");
    lines.forEach((text, index) => {
      if (!ruleOff.test(text) || /\/\/|\/\*/.test(text)) return;
      // Walk back over the rule lines of the same group to the comment that explains them.
      for (let back = index - 1; back >= 0; back -= 1) {
        const previous = (lines[back] ?? "").trim();
        if (/^(?:\/\/|\/\*|\*)/.test(previous)) return;
        if (!ruleOff.test(lines[back] ?? "") && previous !== "") break;
      }
      findings.push({
        rule: "eslint-rule-off-without-reason",
        path,
        line: index + 1,
        message:
          "a rule is turned off or down without a comment: fix the code, or say why on the line above",
        text,
      });
    });
  }
  return findings;
}

const months =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/**
 * Standard 7: TDM-20, RPT-17, TM-26, OBS-17. READMEs describe the code today; history goes elsewhere.
 *
 * @type {Rule}
 */
function readmeHistory(repo) {
  return scanLines(
    repo,
    ["**/README.md", "**/readme.md"],
    [
      {
        rule: "readme-dated-history",
        pattern: new RegExp(
          `^#{1,6} .*(?:\\b20\\d\\d-\\d\\d-\\d\\d\\b|\\b\\d{1,2} ${months} 20\\d\\d\\b|\\b${months} 20\\d\\d\\b)|^\\s*(?:\\*\\*)?(?:status|as of)\\b[^\\n]{0,60}\\b(?:20\\d\\d-\\d\\d-\\d\\d|\\d{1,2} ${months} 20\\d\\d)`,
          "i",
        ),
        message:
          "dated status or history in a README: move it to CHANGELOG.md or docs/history/",
      },
      {
        rule: "readme-dated-history",
        pattern: /^#{1,6} .*\b(?:RRD[A-Z]*|RRDSCRUM|RRDPLAT|RRDMOBILE)-\d+\b/,
        message:
          "ticket heading in a README: move ticket history to CHANGELOG.md or docs/history/ and name the section for what the code does",
      },
    ],
  );
}

/**
 * macOS rewrites a tracked .DS_Store and dirties every checkout. Checks the git index (`git ls-files`), not the
 * working tree: an ignored or untracked .DS_Store is harmless, a tracked one is the problem.
 *
 * @type {Rule}
 */
function trackedDsStore(repo) {
  return repo.tracked
    .filter((path) => path.split("/").pop() === ".DS_Store")
    .map((path) => ({
      rule: "tracked-ds-store",
      path,
      line: 0,
      message:
        "tracked .DS_Store: run `git rm --cached` on it and add .DS_Store to .gitignore",
    }));
}

const buildOutputDirs = new Set(["dist", "build"]);

/**
 * Nov 2026 review: committed build output goes stale against its source and hides what was really released. One
 * finding per tracked `dist/` or `build/` folder (the outermost one), from the git index like `tracked-ds-store`.
 *
 * @type {Rule}
 */
function trackedBuildOutput(repo) {
  /** @type {Map<string, number>} */
  const folders = new Map();
  for (const path of repo.tracked) {
    const parts = path.split("/");
    const index = parts.findIndex(
      (part, i) => i < parts.length - 1 && buildOutputDirs.has(part),
    );
    if (index === -1 || parts.slice(0, index).includes("node_modules"))
      continue;
    const folder = parts.slice(0, index + 1).join("/");
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  return [...folders].map(([folder, count]) => ({
    rule: "tracked-build-output",
    path: folder,
    line: 0,
    message: `${String(count)} tracked file(s) under ${folder}/: build output comes from the build, so run \`git rm -r --cached ${folder}\` and add it to .gitignore`,
    text: folder,
  }));
}

/** Lines one source file may have when the repo sets no limit; a higher repo limit needs a reason. */
const defaultMaxLines = 1000;

/** Generated sources the line limit never counts; a repo adds its own in `fileLength.generated`, each with a reason. */
const defaultGeneratedGlobs = [
  "**/generated/**",
  "**/__generated__/**",
  "**/generated.*",
  "**/*.generated.*",
  "**/*.gen.*",
  "**/*.min.{js,mjs,cjs}",
];

/**
 * Lines in a source file, counting every line terminator the file's language recognises: CRLF, CR and LF everywhere,
 * plus U+2028 and U+2029 in JavaScript and TypeScript. A final terminator does not start a new line.
 *
 * @param {string} path
 * @param {string} text
 */
function countSourceLines(path, text) {
  if (text === "") return 0;
  const js = /\.[cm]?[jt]sx?$/.test(path);
  const terminator = js ? /\r\n|[\n\r\u2028\u2029]/ : /\r\n|[\n\r]/;
  const trailing = js ? /(?:\r\n|[\n\r\u2028\u2029])$/ : /(?:\r\n|[\n\r])$/;
  return text.replace(trailing, "").split(terminator).length;
}

/**
 * Nov 2026 review: files over ~1,000 lines mix responsibilities and defeat review. Generated files do not count.
 *
 * @type {Rule}
 */
function oversizedSourceFile(repo, config) {
  const maxLines = config.fileLength?.maxLines ?? defaultMaxLines;
  const generated = [
    ...defaultGeneratedGlobs,
    ...(config.fileLength?.generated ?? []).map((entry) => entry.path),
  ];
  /** @type {Finding[]} */
  const findings = [];
  for (const path of repo.paths.filter(
    (p) =>
      matches(p, sourceGlob) &&
      !matches(p, generated) &&
      !matches(p, skillCopies),
  )) {
    const text = repo.read(path);
    const lines = countSourceLines(path, text);
    if (lines > maxLines) {
      findings.push({
        rule: "oversized-source-file",
        path,
        line: maxLines + 1,
        message: `${String(lines)} lines, over the ${String(maxLines)}-line limit: split it by responsibility (a generated file goes in fileLength.generated with a reason)`,
      });
    }
  }
  return findings;
}

/** Every static rule, in report order. */
export const rules = [
  dependencySource,
  unpublishedInternalDependency,
  tsconfig,
  buildInDependency,
  copiedCode,
  legacyMarkers,
  scannerPatterns,
  suppressionsAndArgv,
  skippedTests,
  eslintConfigOverrides,
  readmeHistory,
  trackedDsStore,
  trackedBuildOutput,
  oversizedSourceFile,
];
