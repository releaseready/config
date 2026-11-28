# CI spot runners

Ephemeral AWS spot runners that the shared CI uses when the Mac runner is offline or busy and the caller sets
`spot-runner: ci-spot`. Built on [github-aws-runners/terraform-aws-github-runner](https://github.com/github-aws-runners/terraform-aws-github-runner)
(Apache-2.0, pinned to a release); this folder only configures it. Nothing here is applied automatically.

Cost controls, tightest first:

- **Hard ceiling: US$20 a month** (`budget.tf`). At 100% of the budget an AWS Budgets action attaches a deny-launch policy to the
  scale-up role, so no new instance starts; alerts go to `alert_emails` at US$5, 10 and 15. Budget data refreshes a few times
  a day, so the worst case is about US$22 (the ceiling plus under half a day of two capped instances), plus roughly US$0.25 of
  fixed cost. The policy is detached automatically at 00:05 UTC on the 1st of each month (a free EventBridge schedule); to resume sooner, detach the `*-budget-stop-launches` policy from the scale-up role.
- At most 2 instances at once (`max_runners`, validated; the scale-up Lambda reserves no concurrency because a new AWS account cannot spare it, so a burst of jobs could briefly start one extra instance, still inside the budget ceiling), a spot price cap of US$0.05 an hour each, cheapest 2 vCPU types
  first, one job per instance, no idle runners, 20-minute job timeout in the shared CI.
- No NAT gateway (public subnets of the default VPC, no inbound rules), 7-day logs.

Expected: about US$1-2 a month for 100 CI runs, about US$0.10-0.25 idle.

## Runner image (build before the first apply, then monthly)

Runners boot a prebaked Ubuntu 24.04 image (the same OS as GitHub's `ubuntu-24.04`) from `image/`, so nothing is installed at
boot: the GitHub runner, Docker, git, jq, unzip, the AWS CLI, gh, build tools, Python, the shared libraries Chromium needs and
Node 24 (in the runner tool cache, where `actions/setup-node` looks first) are already on it. `image/build.sh` builds it with
Packer from the module's own template at the pinned release (`brew install packer`, then
`AWS_PROFILE=bps-admin infra/ci-runners/image/build.sh`): one t3.medium for about 10-15 minutes (a few US cents). The image's
snapshot costs roughly US$0.50-1 a month. Rebuild monthly so the runner and packages stay current, then `terraform apply`: the
launch template picks the newest image named `github-runner-ubuntu-noble-amd64-*` in this account. Playwright's browser
downloads and each repo's own tools are not baked in: they depend on the versions each repo pins.

## Apply (once, by the account owner, with the `bps-admin` profile)

0. Build the image (above); `terraform plan` fails until at least one exists.

1. Create a GitHub App for runner registration (separate from the read-only router App): organisation permission
   "Self-hosted runners: read and write", repository permissions "Actions: read", "Metadata: read" and "Checks: read" as
   listed in the module's setup docs; subscribe to the "Workflow job" event; generate a webhook secret and a private key.
2. `export TF_VAR_alert_emails='["<email 1>","<email 2>"]'` and `export TF_VAR_github_app='{"id":"<app id>","key_base64":"<base64 of the .pem>","webhook_secret":"<secret>"}'`
3. `terraform init`, then `terraform apply -target=module.lambdas` (downloads the three lambda zips from the module's release; a plan needs them to exist), then `terraform plan`, read the plan, then `terraform apply`. A fresh-checkout plan reports about 99 resources, none of them a NAT gateway, load balancer or KMS key.
4. Put the `webhook_endpoint` output into the App's webhook URL, install the App on the org's private repos.
5. Callers set `spot-runner: ci-spot` in their `pr.yml` (or the org does it once in the template).

The budget covers the whole account until `budget_tag_active` is set to true, which you do about a day after the first apply once the `Project` cost allocation tag is active in Billing. State is local by default; keep it outside the repo (it holds the webhook secret). Never commit `*.tfvars` or state.
