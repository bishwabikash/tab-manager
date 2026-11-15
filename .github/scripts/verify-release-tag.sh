#!/usr/bin/env bash
# Fails unless the pushed tag is v<manifest.json version> and its commit is on main.
set -euo pipefail

TAG="${GITHUB_REF_NAME:?GITHUB_REF_NAME is not set}"
VERSION=$(node -p "require('./manifest.json').version")

if [ "$TAG" != "v$VERSION" ]; then
  echo "::error::Tag $TAG does not match manifest.json version $VERSION (expected v$VERSION)."
  exit 1
fi

git fetch --quiet --no-tags origin main
if ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
  echo "::error::Tag $TAG points to a commit that is not on main."
  exit 1
fi

echo "Release tag $TAG matches manifest.json and is on main."
