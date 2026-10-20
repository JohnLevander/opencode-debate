#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
config_root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
plugin_link="$config_root/plugins/opencode-debate"
command_link="$config_root/commands/debate.md"
mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" && "$mode" != "--uninstall" ]]; then
  printf 'Usage: %s [--dry-run | --apply | --uninstall]\n' "$0" >&2
  exit 2
fi
check_target() {
  local target="$1" source="$2"
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ ! -L "$target" || "$(readlink "$target")" != "$source" ]]; then
      printf 'Refusing to overwrite an existing entry: %s\n' "$target" >&2
      exit 1
    fi
  fi
}
check_target "$plugin_link" "$repo"
check_target "$command_link" "$repo/commands/debate.md"
printf 'Plugin: %s -> %s\nCommand: %s -> %s\n' "$plugin_link" "$repo" "$command_link" "$repo/commands/debate.md"
printf 'No opencode.json(c) edits. No agent file. Restart OpenCode/OpenChamber after installation or removal.\n'
if [[ "$mode" == "--dry-run" ]]; then
  printf 'Dry run only. Review these exact external changes and obtain approval before --apply.\n'
elif [[ "$mode" == "--apply" ]]; then
  mkdir -p -- "$config_root/plugins" "$config_root/commands"
  [[ -L "$plugin_link" ]] || ln -s -- "$repo" "$plugin_link"
  [[ -L "$command_link" ]] || ln -s -- "$repo/commands/debate.md" "$command_link"
else
  [[ ! -L "$command_link" ]] || rm -- "$command_link"
  [[ ! -L "$plugin_link" ]] || rm -- "$plugin_link"
fi
