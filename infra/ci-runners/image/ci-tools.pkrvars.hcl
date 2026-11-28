# What the shared CI needs on a runner, baked into the image so no job installs it and no boot can fail on it (RRDPLAT-114).
# Same OS as GitHub's `ubuntu-24.04` runners. The base template adds the GitHub runner, Docker, git, jq, unzip, the AWS CLI and
# the CloudWatch agent; these commands add the rest. They run as the SSH user under /bin/sh -e, so keep them POSIX.
custom_shell_commands = [
  # gh (changed-files classifier), build tools for native npm modules, Python for the Python repos, and the shared libraries
  # Playwright's headless Chromium needs (Playwright's own Ubuntu 24.04 dependency list).
  "sudo DEBIAN_FRONTEND=noninteractive apt-get -y install gh xz-utils zip build-essential python3 python3-venv python3-pip fonts-liberation fonts-noto-color-emoji libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2",
  # Latest Node 24 placed where actions/setup-node looks first (the runner tool cache), checksum-verified, so `node-version: 24`
  # resolves without a download. If setup-node resolves a newer 24.x it simply downloads that one.
  "NODE=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith(\"v24.\"))][0].version')",
  "test -n \"$NODE\"",
  "cd \"$(mktemp -d)\"",
  "curl -fsSLO \"https://nodejs.org/dist/$NODE/node-$NODE-linux-x64.tar.xz\"",
  "curl -fsSLO \"https://nodejs.org/dist/$NODE/SHASUMS256.txt\"",
  "grep \" node-$NODE-linux-x64.tar.xz\\$\" SHASUMS256.txt | sha256sum -c -",
  "DEST=\"/opt/hostedtoolcache/node/$${NODE#v}/x64\"",
  "sudo mkdir -p \"$DEST\"",
  "sudo tar -xJf \"node-$NODE-linux-x64.tar.xz\" -C \"$DEST\" --strip-components=1",
  "sudo touch \"$DEST.complete\"",
  "\"$DEST/bin/node\" --version",
  "gh --version",
  "jq --version",
]
