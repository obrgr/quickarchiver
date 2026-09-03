#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "$0")" && pwd)
manifest_path="$project_dir/src/manifest.json"
version=$(jq -er '.version' "$manifest_path")
artifact_path="$project_dir/builds/quickarchiver-$version.xpi"

mkdir -p "$project_dir/builds"
rm -f "$artifact_path"

(
    cd "$project_dir/src"
    zip -X -r "$artifact_path" . -x '.DS_Store' '*/.DS_Store'
)

unzip -t "$artifact_path"
printf 'Built %s\n' "$artifact_path"
