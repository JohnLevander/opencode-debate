# Install opencode-debate with OpenChamber

This guide uses only `opencode/glm-5.3-flash-free` and `opencode/deepseek-v4.1-flash-free`. No OpenRouter account or API key is needed for this setup. Free-provider availability and JSON adherence vary: a real IEEE 754 debate converged, while a contested debate stopped with partial results after invalid model output.

## Requirements

- OpenChamber connected to OpenCode **2.0.32**. This plugin uses that version's v2 API; other versions are unverified. Do not replace an existing OpenCode installation automatically.
- Node.js **24** and npm; Bash for the link installer. A separate Bun installation is unnecessary.
- macOS or Linux. The automated link/config tests run on macOS; native Windows installation is untested.
- Both free models available in OpenCode's model picker. Choose a model explicitly marked **Free** for the calling chat too. This installer configures debate children; it does not restrict the rest of your OpenCode account to free providers.

## Get the files and check them

Get the source from [JohnLevander/opencode-debate](https://github.com/JohnLevander/opencode-debate). Keep it in a permanent folder: installation links point to it.

For a new installation with Git:

```sh
mkdir -p ~/dev
git clone https://github.com/JohnLevander/opencode-debate.git ~/dev/opencode-debate
cd ~/dev/opencode-debate
node --version
npm ci --ignore-scripts --include=dev --cache .cache/npm
npm run check
npm run setup:free -- --preview
```

If that folder already exists, follow the update instructions below or choose a different permanent folder; do not clone over it.

Without Git, download [opencode-debate-0.1.0.zip](https://github.com/JohnLevander/opencode-debate/releases/download/v0.1.0/opencode-debate-0.1.0.zip) and its [SHA-256 checksum](https://github.com/JohnLevander/opencode-debate/releases/download/v0.1.0/opencode-debate-0.1.0.zip.sha256). Verify the downloaded ZIP from the folder containing both files:

```sh
# macOS
shasum -a 256 -c opencode-debate-0.1.0.zip.sha256
# Linux: sha256sum -c opencode-debate-0.1.0.zip.sha256
```

Unzip into `~/dev/` to create `~/dev/opencode-debate`, then run the commands above starting at `cd ~/dev/opencode-debate`. Release ZIPs include source and the lockfile; dependencies are installed locally. Browse [all releases](https://github.com/JohnLevander/opencode-debate/releases) for future versions.

The preview makes **no changes**. It shows these exact operations, honoring `XDG_CONFIG_HOME` when set:

1. Link `~/.config/opencode/plugins/opencode-debate` to this folder.
2. Link `~/.config/opencode/commands/debate.md` to this folder's command file.
3. Create or merge `~/.config/opencode/debate.config.json`, mode `0600`, with this preset:

```json
{
  "backend": "opencode",
  "readCompatibility": true,
  "models": {
    "glm": {
      "providerID": "opencode",
      "modelID": "glm-5.3-flash-free",
      "variant": "low"
    },
    "deepseek": {
      "providerID": "opencode",
      "modelID": "deepseek-v4.1-flash-free",
      "variant": "low"
    }
  }
}
```

Other existing debate settings are preserved. The script refuses invalid configuration, symlinked config files, or unrelated entries at either link target. It leaves `opencode.json(c)`, credentials, and provider policies alone. No automatic paid fallback exists.

After reviewing the printed paths and JSON, approve those changes by running:

```sh
npm run setup:free -- --apply
```

This explicitly opts into restricted-read compatibility. The debaters can access only the genuine native `read` tool for the plugin's zero-byte `assets/compatibility/empty.txt`; other tools, user files, and directory reads are denied. The plugin refuses changed/symlinked assets and ancestor `AGENTS.md` files that native read might load. If that check fails, use a permanent folder without such instruction files in its ancestry. See the [permission details](../README.md#free-only-compatibility-mode).

## Restart and test

Let active work finish, then use **OpenChamber → Settings → General → Restart OpenCode**. Refresh OpenChamber and open a new chat with a Free calling model selected. Enter:

```text
/debate In IEEE 754 double precision, does 0.1 + 0.2 exactly equal 0.3? Explain.
```

The caller should invoke `debate`. Successful completion returns a final answer, any unresolved points, a contribution winner line with both text-reuse scores, child-session IDs, and a JSON log path. The score estimates retained wording, excludes supplied context, and can miss paraphrased ideas; it does not settle unresolved disagreements. The two participants appear in the parent's Subagents panel. Logs include per-review stop decisions, resolved round limits, validation/repair failures, retries, full turns, and the contribution score. An error result is incomplete, even if its partial answer sounds confident; an empty points array on error does not establish agreement. A genuine run writes a log under `~/.local/share/opencode-debate/debates/` (or your configured log directory); an agent's own review or simulated argument is not a debate result.

For a longer exchange:

```text
/debate Is this code review correct? Use min_rounds=3 and max_rounds=6.
```

This allows at least three turns per side before agreement or stalemate stops the debate, up to six. The opening proposal counts as one turn. Errors, Stop, and deadlines still take precedence. Defaults remain minimum 1, maximum 4; both options accept 1–8, and the minimum must not exceed the maximum.

To debate a review, attach the review text and any evidence you want the participants to consider. The command asks the caller to pass supplied text as context. Debaters cannot inspect your repository themselves, so include the relevant code/evidence as well.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Agent says `search({ query: 'debate' })` finds nothing | This release registers `debate` as a **pinned Code Mode tool**, fixing the earlier direct-only registration. Restart OpenCode after updating; retry `/debate` in a new chat. If still missing, inspect plugin load errors, the project/agent's tool permissions, and whether OpenChamber is connected to the server you restarted. Do not substitute a simulated debate. |
| Agent performs many shell commands before calling debate | The updated command asks for immediate invocation. Preliminary work by the calling build agent is outside the child debaters' restrictions. No debate log means the tool has not started, unless log creation itself reported an error. |
| `Endpoint is unavailable`, HTTP 429 | Free-provider capacity can reject either the calling model or a debater. Stop a caller stuck in repeated UI retries and try again later. The engine's bounded retries apply only after the debate tool starts; they do not control the parent agent's retries. No key is needed to resolve a capacity error. |
| `FreeTierError` before an answer | Verify `readCompatibility: true` in the effective debate config and restart the hosting server. Strict no-tools mode failed with this error on the tested version. |
| `Invalid reply twice` (older logs: `Invalid JSON twice`) | A participant violated the protocol after the single repair attempt. Read the partial answer and open points; the engine has not declared convergence. |
| Different model or backend is used | Project `.opencode/debate.config.json` and `OPENCODE_DEBATE_*` variables in the server's environment override global settings. Review those overrides. |
| Stop shows “Step interrupted” | OpenChamber interrupts the caller too. The plugin retains partial results in the log and interrupts both children. |

If the free models disappear from OpenCode's inventory, this preset cannot restore them. Model availability and successful contested multi-round execution remain limitations, not installation guarantees.

## Update and uninstall

For a Git clone, update in the existing folder when no debate is running:

```sh
cd ~/dev/opencode-debate
git pull --ff-only
npm ci --ignore-scripts --include=dev --cache .cache/npm
npm run check
npm run setup:free -- --preview
```

Review changes and run `npm run setup:free -- --apply` if you want to reapply the free preset, then restart OpenCode. `git pull --ff-only` refuses to merge diverged local work; review your changes before resolving that situation.

For a ZIP install, download a reviewed release from the [releases page](https://github.com/JohnLevander/opencode-debate/releases), verify its checksum, replace source in the existing folder, and rerun dependency installation and checks. Keep local secrets/configuration out of anything you share. Existing links work as long as the folder stays at the same path.

Preview link paths before removing them:

```sh
bash scripts/install.sh --dry-run
bash scripts/install.sh --uninstall
```

Restart OpenCode afterward. Uninstall removes only matching plugin/command links. It retains `debate.config.json`, logs, dependencies, and child sessions. Review and remove retained data manually if you want it deleted. If a link belongs to another checkout, the installer refuses to touch it.

## Share a release

From a clean, committed checkout:

```sh
npm run check
npm run release:zip
```

The release script archives tracked files from the current commit into `dist/` and prints a SHA-256 checksum. It excludes Git history, local configs, dependencies, credentials, logs, caches, and test runtime data. Share the ZIP plus checksum. Friends can install from the [public repository](https://github.com/JohnLevander/opencode-debate) or its [release downloads](https://github.com/JohnLevander/opencode-debate/releases). These local setup/release scripts do not publish anything to GitHub.
