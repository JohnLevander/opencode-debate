#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd -- "$repo"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  printf 'Commit or remove pending repository changes before packaging.\n' >&2
  exit 1
fi
version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]]; then
  printf 'Invalid release version\n' >&2
  exit 1
fi
mkdir -p dist
archive="$repo/dist/opencode-debate-$version.zip"
git archive --format=zip --prefix=opencode-debate/ --output="$archive" HEAD
node --input-type=module - "$archive" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
const file = process.argv[2];
const checksum = `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}\n`;
writeFileSync(`${file}.sha256`, checksum);
console.log(`Archive: ${file}\n${checksum}`);
JS
