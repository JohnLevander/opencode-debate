# From a new computer to your first debate

OpenChamber is the interface; OpenCode runs the models and this plugin. Install them and the plugin under the same OS user. Windows users following the WSL route should keep OpenCode, Node, OpenChamber CLI, and the plugin inside the same WSL distribution.

This guide targets **OpenCode 2.0.32** and **OpenChamber 2.4.0**. The locally exercised combination is macOS Desktop; Linux and Windows/WSL instructions below are based on upstream documentation and have not been executed on those platforms. Other OpenCode versions are unverified. Free models can be unavailable or rate-limited.

## Choose your route

| Computer | Terminal for commands | OpenChamber interface |
| --- | --- | --- |
| macOS | Terminal | Desktop app, or optional CLI/browser |
| Linux | Bash terminal | Desktop app, or optional CLI/browser |
| Windows | Ubuntu in WSL 2 | Browser on Windows; optional Windows Desktop connected to the WSL instance |

The plugin installer uses Bash and symlinks. Native PowerShell/Git Bash installation is not supported by this guide. Windows Desktop itself exists, but installing the plugin into its native Windows backend is unverified.

## macOS

1. Install **Node.js 24** from the [official Node download page](https://nodejs.org/en/download). For the optional web/CLI route, use **24.14 or newer within the 24.x series**. Open a new Terminal afterward.
2. Install Git if missing. Apple's Command Line Tools provide it:

   ```sh
   xcode-select --install
   ```

   Finish the installer, then check:

   ```sh
   git --version
   node --version
   npm --version
   ```

   See [Git's macOS installation instructions](https://git-scm.com/install/mac).
3. Download OpenChamber **2.4.0**: [Apple silicon DMG](https://github.com/openchamber/openchamber/releases/download/v2.4.0/OpenChamber-2.4.0-mac-arm64.dmg) or [Intel DMG](https://github.com/openchamber/openchamber/releases/download/v2.4.0/OpenChamber-2.4.0-mac-x64.dmg). Check **Apple menu → About This Mac** to identify the chip. Open the DMG, place OpenChamber in Applications, and launch it.
4. Desktop includes OpenCode and manages its connection automatically. You do not need a separate OpenCode CLI for this route. On a standard Applications install, you can check the bundled version with:

   ```sh
   /Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode --version
   ```

   The tested version is `2.0.32`. Continue to [sign-in](#sign-in-and-select-the-free-models).

Desktop bundling is documented in [OpenChamber Install](https://docs.openchamber.dev/install/). If you prefer a browser interface, use the [CLI/browser route](#get-opencode-and-openchamber-for-the-clibrowser-route) below instead.

## Linux

1. Install Git, curl, and certificates with your distribution's package manager. On Ubuntu/Debian:

   ```sh
   sudo apt update
   sudo apt install -y git curl ca-certificates
   ```

2. Install [Node.js 24](#nodejs-24-for-linux-and-wsl), then check `node --version`, `npm --version`, and `git --version`.
3. Download a matching desktop asset from [OpenChamber 2.4.0](https://github.com/openchamber/openchamber/releases/tag/v2.4.0): `.deb` for Debian/Ubuntu, `.rpm` for RPM-based systems, or AppImage. Select x86_64/amd64 for Intel/AMD or arm64/aarch64 for ARM.
4. Install the package with your distribution's package installer. For an Intel/AMD AppImage, run these commands in the folder where you downloaded it:

   ```sh
   chmod +x OpenChamber-2.4.0-linux-x86_64.AppImage
   ./OpenChamber-2.4.0-linux-x86_64.AppImage
   ```

   ARM users substitute the `linux-arm64.AppImage` filename. If FUSE is unavailable, upstream documents this alternative:

   ```sh
   APPIMAGE_EXTRACT_AND_RUN=1 ./OpenChamber-2.4.0-linux-x86_64.AppImage
   ```

Desktop includes OpenCode; let it start its managed server, then continue to [sign-in](#sign-in-and-select-the-free-models). For a browser interface or an explicitly pinned terminal OpenCode, use the [CLI/browser route](#get-opencode-and-openchamber-for-the-clibrowser-route). See the [upstream desktop instructions](https://github.com/openchamber/openchamber/tree/v2.4.0#quick-start).

## Windows with WSL 2

1. Open **PowerShell as Administrator** and install Ubuntu:

   ```powershell
   wsl --install -d Ubuntu
   ```

   Restart Windows if requested, open Ubuntu, and create the Linux username/password it asks for. These are your WSL user credentials, separate from an OpenCode account.
2. In PowerShell, check that Ubuntu uses WSL 2:

   ```powershell
   wsl --list --verbose
   ```

   If an existing Ubuntu installation shows version 1, convert it with `wsl --set-version Ubuntu 2`. See [Microsoft's WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install).
3. Run the remaining shell commands **inside Ubuntu**, not PowerShell:

   ```sh
   sudo apt update
   sudo apt install -y git curl ca-certificates
   ```

4. Install [Node.js 24 inside WSL](#nodejs-24-for-linux-and-wsl), then use the [CLI/browser route](#get-opencode-and-openchamber-for-the-clibrowser-route). Keep the plugin checkout at Linux `~/dev/opencode-debate`, rather than a Windows drive such as `/mnt/c/`. Verify `command -v node` and `command -v opencode` resolve inside Linux, rather than to Windows executables. [Microsoft explains Node/WSL environment separation](https://learn.microsoft.com/en-us/windows/dev-environment/javascript/nodejs-on-wsl).
5. Open the OpenChamber URL in your Windows browser, normally `http://localhost:3000`. Windows browsers can access WSL-hosted apps through localhost; see [Microsoft's networking guide](https://learn.microsoft.com/en-us/windows/wsl/networking). Keep WSL running while using it.

Optional native window: download the matching [Windows x64](https://github.com/openchamber/openchamber/releases/download/v2.4.0/OpenChamber-2.4.0-win-x64.exe) or [Windows ARM64](https://github.com/openchamber/openchamber/releases/download/v2.4.0/OpenChamber-2.4.0-win-arm64.exe) OpenChamber installer. To use the WSL backend, generate a connection link **inside WSL** after its OpenChamber server is running:

```sh
openchamber connect-url --port 3000 --server http://localhost:3000
```

In Windows Desktop, use **Settings → Remote Instances → Other OpenChamber servers → Import Link** (some releases label the group Direct Instances), import the link, and select that instance. This connects to the WSL **OpenChamber** server, not directly to an OpenCode port. Keep pairing links private. This optional pairing route is described by [OpenChamber Remote Instances](https://docs.openchamber.dev/remote-instances/); it has not been tested here. Using the Windows app's own local backend will not load the plugin installed inside WSL.

## Node.js 24 for Linux and WSL

If an appropriate Node 24 installation is already available, keep it. Otherwise, one per-user option is [nvm's official installer](https://github.com/nvm-sh/nvm#installing-and-updating):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

This installs nvm and updates your shell startup file. Close and reopen the Linux/WSL terminal, then run:

```sh
nvm install 24
nvm use 24
nvm alias default 24
node --version
npm --version
```

Use Node **24.14+** for OpenChamber CLI 2.4.0. With a per-user Node install, global npm packages should not need `sudo`. If npm reports permission errors, check the Node installation rather than changing ownership of system directories. The [official Node downloads](https://nodejs.org/en/download) provide an alternative.

## Get OpenCode and OpenChamber for the CLI/browser route

Use this section on Linux/WSL, or optionally macOS. Skip it when using Desktop's bundled OpenCode.

Install the published versions matching this guide:

```sh
npm install -g @opencode/cli@2.0.32
opencode --version
npm install -g @openchamber/web@2.4.0
```

OpenCode should print `2.0.32`. The OpenCode npm package needs its native-binary installation script: do **not** add `--ignore-scripts` to that global installation. That flag is used later only for this plugin's dependency installation. See [OpenCode v2 installation](https://opencode.ai/v2/docs/) and the [OpenChamber 2.4.0 package metadata](https://github.com/openchamber/openchamber/blob/v2.4.0/packages/web/package.json).

Start OpenChamber, replacing the example UI password with your own:

```sh
openchamber --port 3000 --ui-password 'choose-your-own-local-password'
```

Open the URL it prints, normally `http://localhost:3000`, and enter that UI password. The password protects this local interface; it is not an API key. OpenChamber normally starts/manages OpenCode automatically. This is the documented [web quickstart](https://docs.openchamber.dev/quickstart/).

If startup fails, inspect `openchamber status` and `openchamber logs`. A native dependency build error may require your Linux distribution's compiler/Python packages, for example `sudo apt install -y build-essential python3` on Ubuntu. Do not substitute a different OpenCode major version to resolve a missing executable.

## How OpenChamber connects to OpenCode

For Desktop, use its bundled server. For the CLI/browser route, keep `opencode` on the launching shell's PATH and let OpenChamber manage it. Seeing the session list and sending a short message with a Free model is the initial connection check.

If you already run your own OpenCode server, the documented address selection is:

```sh
OPENCODE_HOST=http://localhost:4096 OPENCODE_SKIP_START=true openchamber --port 3000
```

This selects an **already running** server; it does not start it or provision authentication. Use its actual address/port and authentication setup. The OpenCode URL must include a port and have no trailing path. A 401/403 at the connection stage needs the server's connection credentials, not an OpenRouter model key. Follow [OpenChamber's existing-server guide](https://docs.openchamber.dev/opencode-server/) and [connection troubleshooting](https://docs.openchamber.dev/troubleshooting/opencode-connection/). For a first installation, use the automatic route instead.

Install the plugin where that server runs. Installing it on a laptop does not install it on a remote server, in WSL, or under another OS user.

## Sign in and select the free models

Prefer signing in through the OpenChamber instance you will actually use:

1. Open **Settings → Providers**, then **Add provider**.
2. Choose **OpenCode Console** / **OpenCode**, and the browser/device sign-in method (called **OpenCode Console account** on the tested OpenCode version).
3. Open the displayed browser link, create or sign in to your account, enter the displayed short code if asked, and approve the connection. If WSL cannot open the browser automatically, copy the link into your Windows browser. Return to OpenChamber and wait for connection completion.
4. In the chat model picker, choose **GLM 5.3 Flash Free** or **DeepSeek V4.1 Flash Free** under provider **opencode**. Verify both are available for the debate. Try a short ordinary message first.

These steps follow [OpenChamber provider setup](https://docs.openchamber.dev/providers/). The integration/method labels are verified against [OpenCode 2.0.32's Console implementation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/plugin/provider/opencode.ts). If the free models already work, there is no need to add another provider connection.

Terminal alternative, using the same user/environment as the server:

```sh
opencode auth login opencode --method device
opencode auth list
```

Or launch `opencode` and use `/connect`, then `/models`. See [OpenCode sign-in instructions](https://opencode.ai/v2/docs/cli/providers/). A terminal connected to another server or WSL distribution may manage a different credential store; signing in inside the actual OpenChamber UI avoids that confusion.

No OpenRouter key or paid subscription is required by this plugin's free preset. A public GitHub clone needs no GitHub login. Free access still depends on OpenCode's current model offerings/account rules; this installer cannot provision it. If those exact Free models are unavailable or the page only offers a paid plan, stop and check availability rather than choosing a paid substitute.

## Install the plugin, restart, and test

In macOS Terminal, Linux Bash, or **Ubuntu Bash for WSL**:

```sh
mkdir -p ~/dev
git clone https://github.com/JohnLevander/opencode-debate.git ~/dev/opencode-debate
cd ~/dev/opencode-debate
npm ci --ignore-scripts --include=dev --cache .cache/npm
npm run check
npm run setup:free -- --preview
```

If the checkout already exists, follow the [update instructions](INSTALL.md#update-and-uninstall). Review the exact global paths and JSON in the preview, then approve them:

```sh
npm run setup:free -- --apply
```

This enables the tested single-empty-file compatibility mode and selects the two Free models. See [installation details](INSTALL.md) for the permission scope, overrides, download-without-Git option, and uninstall.

After active work finishes, restart the hosting OpenCode through OpenChamber **Settings → General → Restart OpenCode**. For a CLI-managed instance, `openchamber restart` is the upstream restart command. If using an external server, restart that server as well so it reloads the plugin. Refresh OpenChamber and start a new chat with a **Free** calling model:

```text
/debate In IEEE 754 double precision, does 0.1 + 0.2 exactly equal 0.3? Use min_rounds=2 and max_rounds=4.
```

A genuine debate returns its status, current/final answer, contribution estimate, unresolved points if present, child-session IDs, and a log path. Errors remain incomplete; they are not agreement. The [troubleshooting table](INSTALL.md#troubleshooting) covers missing tools, free-provider capacity errors, and malformed replies. The free preset configures the debate participants; keep the calling chat on a Free model too.
