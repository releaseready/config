# Ephemeral AWS spot runners for the shared CI (RRDPLAT-114). Scales to zero: a queued job starts one instance, which
# takes that one job and is terminated. Cost controls, all enforced here:
#   - at most var.max_runners instances at once (2) and a spot price cap of US$0.05 an hour each
#   - a hard monthly budget action (budget.tf): at the ceiling, new launches are denied
#   - spot only, ephemeral (one job per instance), no idle runners
#   - the default VPC's public subnets with no inbound rules: no NAT gateway, which is the usual hidden monthly cost
#   - 7-day log retention
# Private org repos only: the shared CI never routes fork PRs or public repos here (see reusable-ci.yml).

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# The module and its lambda zips must stay on the same release (the test checks all three pins).
module "lambdas" {
  source = "github.com/github-aws-runners/terraform-aws-github-runner//modules/download-lambda?ref=v7.9.0"
  lambdas = [
    { name = "webhook", tag = "v7.9.0" },
    { name = "runners", tag = "v7.9.0" },
    { name = "runner-binaries-syncer", tag = "v7.9.0" },
  ]
}

module "runners" {
  source = "github.com/github-aws-runners/terraform-aws-github-runner?ref=v7.9.0"

  aws_region = var.aws_region
  vpc_id     = data.aws_vpc.default.id
  subnet_ids = data.aws_subnets.default.ids
  prefix     = var.prefix

  github_app = var.github_app

  webhook_lambda_zip                = module.lambdas.files[0]
  runners_lambda_zip                = module.lambdas.files[1]
  runner_binaries_syncer_lambda_zip = module.lambdas.files[2]

  enable_organization_runners   = true
  enable_ephemeral_runners      = true
  enable_job_queued_check       = true
  runner_disable_default_labels = true
  runner_extra_labels           = [var.runner_label]

  instance_target_capacity_type = "spot"
  instance_allocation_strategy  = "price-capacity-optimized"
  instance_types                = var.instance_types
  instance_max_spot_price       = "0.05"
  runners_maximum_count         = var.max_runners

  # The shared CI uses `gh` (changed-files classifier), `jq` and, for browser tests, Chromium's shared libraries; GitHub-hosted images and the Mac have them, the bare Amazon
  # Linux 2023 image does not (first spot run failed with exit 127). gh comes from GitHub's own signed dnf repository.
  # A subshell keeps strict mode from leaking into the module's own user-data script, which is pasted around this snippet.
  userdata_post_install = <<-EOT
    (
      set -euo pipefail
      dnf install -y --setopt=install_weak_deps=False jq dnf-plugins-core
      dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
      dnf install -y --setopt=install_weak_deps=False gh
      gh --version
      # Shared libraries Playwright's headless Chromium needs (the list is Playwright's own Ubuntu 24.04 dependency list mapped to
      # Amazon Linux 2023 package names). `playwright install --with-deps` only supports apt, so it cannot add them. One package at
      # a time, so a renamed package is logged and skipped instead of failing the whole install.
      for pkg in alsa-lib atk at-spi2-atk cairo cups-libs dbus-libs glib2 libdrm libX11 libxcb libXcomposite libXdamage libXext \
        libXfixes libxkbcommon libXrandr mesa-libgbm nspr nss pango fontconfig liberation-fonts; do
        dnf install -y --setopt=install_weak_deps=False "$pkg" || echo "WARN: $pkg is not available"
      done
    )
  EOT
  # -1 removes reserved concurrency: a new AWS account allows only 10 concurrent Lambda executions, and AWS requires 5 to stay
  # unreserved, so the module default of 1 reserved fails to apply. The 2-instance cap is runners_maximum_count above.
  scale_up_reserved_concurrent_executions = -1

  associate_public_ipv4_address   = true
  create_service_linked_role_spot = true
  enable_ssm_on_runners           = false
  logging_retention_in_days       = 7

  tags = {
    Project = "buildproveship-ci"
  }
}
