#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "$0")/.." && pwd)
version=$(jq -er '.version' "$project_dir/src/manifest.json")
artifact_path="$project_dir/builds/quickarchiver-$version.xpi"
linter_path="$project_dir/node_modules/.bin/webext-linter"

if [[ ! -x "$linter_path" ]]; then
    printf 'Thunderbird webext-linter is not installed. Run npm install first.\n' >&2
    exit 2
fi

if [[ ! -f "$artifact_path" ]]; then
    printf 'Build artifact not found: %s\n' "$artifact_path" >&2
    exit 2
fi

"$linter_path" "$artifact_path" --allow-experiments --eslint "$@"
