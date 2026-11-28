// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: the cost-cap settings in the CI spot-runner Terraform, read as text; it does not run Terraform or touch AWS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (/** @type {string} */ file) =>
  readFileSync(new URL(`../infra/ci-runners/${file}`, import.meta.url), "utf8");
const main = read("main.tf");
const variables = read("variables.tf");

test("the runner count is capped at 2 and the cap cannot be raised by a variable", () => {
  assert.match(main, /runners_maximum_count\s*=\s*var\.max_runners/);
  assert.match(variables, /default\s*=\s*2\b/);
  assert.match(variables, /var\.max_runners <= 2/);
});

test("the scale-up lambda reserves no concurrency, which a new AWS account cannot spare", () => {
  assert.match(main, /scale_up_reserved_concurrent_executions\s*=\s*-1\b/);
});

test("the runner image gets gh and jq, which the shared CI uses and Amazon Linux does not ship", () => {
  assert.match(main, /userdata_post_install\s*=\s*<<-EOT/);
  assert.match(main, /dnf install -y[^\n]*\bjq\b/);
  assert.match(main, /dnf install -y[^\n]*\bgh\b/);
  // Playwright's headless Chromium failed on the bare image with "libatk-1.0.so.0: cannot open shared object file".
  assert.match(
    main,
    /for pkg in [^\n]*\batk\b[\s\S]*?\bmesa-libgbm\b[\s\S]*?\bnss\b/,
  );
  assert.match(main, /\(\s*\n\s*set -euo pipefail[\s\S]*?\n\s*\)\s*\n\s*EOT/);
});

test("runners are spot, ephemeral and idle-free", () => {
  assert.match(main, /instance_target_capacity_type\s*=\s*"spot"/);
  assert.match(main, /enable_ephemeral_runners\s*=\s*true/);
  assert.doesNotMatch(main, /idle_config/);
});

test("no NAT gateway or private-subnet network is created", () => {
  assert.doesNotMatch(main, /nat_gateway|private_subnets|enable_nat/);
  assert.match(main, /data "aws_vpc" "default"/);
});

test("the module and its lambda zips are pinned to one release", () => {
  const pins = [
    ...main.matchAll(/\?ref=(v[\d.]+)/g),
    ...main.matchAll(/tag\s*=\s*"(v[\d.]+)"/g),
  ].map((m) => m[1]);
  assert.equal(pins.length, 5);
  assert.equal(new Set(pins).size, 1);
});

test("the only trivy exception is the runner egress finding, and it carries a reason", () => {
  const lines = readFileSync(
    new URL("../.trivyignore", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((line) => line.trim() !== "");
  assert.deepEqual(
    lines.filter((line) => !line.startsWith("#")),
    ["AWS-0104"],
  );
  assert.ok(
    lines
      .filter((line) => line.startsWith("#"))
      .join(" ")
      .includes("Reason:"),
  );
});

test("a hard budget ceiling of at most 20 USD stops new launches", () => {
  const budget = readFileSync(
    new URL("../infra/ci-runners/budget.tf", import.meta.url),
    "utf8",
  );
  assert.match(budget, /default\s*=\s*20\b/);
  assert.match(budget, /var\.monthly_ceiling_usd <= 20/);
  assert.match(budget, /action_type\s*=\s*"APPLY_IAM_POLICY"/);
  assert.match(budget, /approval_model\s*=\s*"AUTOMATIC"/);
  assert.match(budget, /action_threshold_value\s*=\s*100/);
  assert.match(budget, /"ec2:RunInstances", "ec2:CreateFleet"/);
  assert.match(main, /instance_max_spot_price\s*=\s*"0\.05"/);
});

test("the IAM attach permission is scoped to one role and one policy, and the semgrep exception names its rules and a reason", () => {
  const budget = readFileSync(
    new URL("../infra/ci-runners/budget.tf", import.meta.url),
    "utf8",
  );
  const lines = budget.split("\n");
  const at = lines.findIndex((l) => l.includes('"iam:AttachRolePolicy"'));
  assert.ok(at > 0);
  const comment = lines[at - 1];
  assert.match(
    comment,
    /nosemgrep: .*no-iam-priv-esc-funcs.*no-iam-resource-exposure.* -- \S/,
  );
  assert.equal((budget.match(/nosemgrep/g) ?? []).length, 2);
  assert.match(
    budget,
    /Resource\s*=\s*module\.runners\.runners\.role_scale_up\.arn/,
  );
  assert.match(
    budget,
    /"iam:PolicyARN"\s*=\s*aws_iam_policy\.stop_launches\.arn/,
  );
});

test("budget alerts take a list of addresses and no address is committed", () => {
  const budget = readFileSync(
    new URL("../infra/ci-runners/budget.tf", import.meta.url),
    "utf8",
  );
  assert.match(
    budget,
    /variable "alert_emails"[\s\S]*?type\s*=\s*list\(string\)/,
  );
  assert.match(budget, /subscriber_email_addresses\s*=\s*var\.alert_emails/);
  assert.match(budget, /for_each\s*=\s*var\.alert_emails/);
  assert.doesNotMatch(budget, /[\w.+-]+@[\w-]+\.\w+/);
});

test("the deny-launch policy is detached on the 1st of each month by a schedule limited to that role and policy", () => {
  const budget = readFileSync(
    new URL("../infra/ci-runners/budget.tf", import.meta.url),
    "utf8",
  );
  assert.match(budget, /schedule_expression\s*=\s*"cron\(5 0 1 \* \? \*\)"/);
  assert.match(budget, /aws-sdk:iam:detachRolePolicy/);
  assert.match(budget, /maximum_retry_attempts\s*=\s*0/);
  assert.match(budget, /Action\s*=\s*"iam:DetachRolePolicy"/);
  assert.match(
    budget,
    /Principal = \{ Service = "scheduler\.amazonaws\.com" \}/,
  );
  assert.match(
    budget,
    /nosemgrep: terraform\.lang\.security\.iam\.no-iam-resource-exposure\.no-iam-resource-exposure -- \S[^\n]*\n\s*Action\s*=\s*"iam:DetachRolePolicy"/,
  );
});
