#!/usr/bin/env bash
# Release Please reads squash-merge commit messages (the PR title) to decide
# the next version: feat → minor, fix → patch, a "!" → major.
set -euo pipefail

TITLE="${1:?usage: check-pr-title.sh \"<title>\"}"
PATTERN='^(feat|fix|perf|revert|docs|style|refactor|test|build|ci|chore)(\([a-z0-9._/-]+\))?!?: .+'

if [[ "$TITLE" =~ $PATTERN ]]; then
  echo "PR title follows Conventional Commits."
else
  echo "::error::PR title \"$TITLE\" must look like \"fix: …\", \"feat: …\" or \"chore(scope): …\" so Release Please can pick the next version."
  exit 1
fi
