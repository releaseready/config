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

data "aws_caller_identity" "current" {}

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

  # Prebaked image (infra/ci-runners/image): Ubuntu 24.04 like GitHub's own runners, with the runner, gh, jq, Node 24 and
  # Chromium's libraries already on it. Nothing is installed at boot, so a runner starts in seconds and cannot fail on a package.
  # Build the image first (image/build.sh); this looks up the newest one by name in this account.
  enable_userdata               = false
  enable_runner_binaries_syncer = false
  runner_run_as                 = "ubuntu"
  ami = {
    filter = { name = ["github-runner-ubuntu-noble-amd64-*"], state = ["available"] }
    owners = [data.aws_caller_identity.current.account_id]
  }
  block_device_mappings = [{
    device_name = "/dev/sda1"
    volume_size = 40
  }]
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
