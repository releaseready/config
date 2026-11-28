#!/usr/bin/env bash
# Builds the spot-runner image (Ubuntu 24.04 with the GitHub runner, gh, jq, Node 24, Chromium's libraries) in the owner's AWS
# account and prints its AMI id. Needs packer (https://developer.hashicorp.com/packer, `brew install packer`) and AWS
# credentials, e.g. `AWS_PROFILE=bps-admin infra/ci-runners/image/build.sh`. The build runs one t3.medium for about 10-15
# minutes (a few US cents); the image's snapshot costs roughly US$0.50-1 a month. Rebuild monthly so the runner and
# packages stay current, then run `terraform apply` (the launch template picks the newest image by name).
# TMPDIR decides where the module checkout goes; set it to a disk with space (the checkout is small).
set -euo pipefail

# Must equal the module pin in main.tf (a test enforces it).
MODULE_TAG="v7.9.0"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "${work:?}"' EXIT

# The base template reads scripts from the module checkout by relative path, so it is built from inside a pinned checkout.
git clone --quiet --depth 1 --branch "$MODULE_TAG" https://github.com/github-aws-runners/terraform-aws-github-runner.git "$work/module"
mkdir -p "$work/module/images/ubuntu-noble"
cp "$here/github_agent.ubuntu-noble.pkr.hcl" "$work/module/images/ubuntu-noble/"
cd "$work/module/images/ubuntu-noble"

packer init .
packer build -var-file="$here/ci-tools.pkrvars.hcl" "$@" .
echo "Built: $(jq -r '.builds[-1].artifact_id' manifest.json)"
