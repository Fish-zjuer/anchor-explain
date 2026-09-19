# Anchor Explain

Turn a selected piece of text — or a rectangle dragged over a PDF — into an **addressable anchor**,
then have an AI explain it and walk you through it step by step.

> **A screenshot is an anchor with an address, not a bag of pixels.**
> The system captures structured coordinates (file + line range, or PDF page + normalized bbox),
> asks the model to explain, fetches more context by address when the answer is thin, and finally
> renders the explanation as located steps that highlight as you advance.

Prior tools (Code Explainer, Agent CodeWalk, MCP Walkthrough, Contral) can all express
`(file, startLine, endLine)` — **none of them can express a position inside a PDF**. That gap is
what the `Location` union type exists for; see `docs/PRIOR-ART.md`.

- **English** (this file) · [中文 README](README.md)
- License: **Apache-2.0** · Source: <https://github.com/Fish-zjuer/anchor-explain>

## Two extensions, one idea

| | Package | Extension ID | What it does |
|---|---|---|---|
| Line 1 — code | `packages/extension-anchor` | `Fish-zjuer.anchor-explain` | Explains a selection in the editor, highlights each logical point as you step through |
| Line 2 — PDF | `packages/extension-anchor-pdf` | `Fish-zjuer.anchor-pdf` | Lets you drag a rectangle on a PDF; the region becomes an anchor handed to line 1 |

Line 2 is a **fork of [`mathematic-inc/vscode-pdf`](https://github.com/mathematic-inc/vscode-pdf)**
(Apache-2.0). It does **not** hijack your default PDF viewer (`customEditors` uses
`priority: "option"`); every change is itemized in
[`packages/extension-anchor-pdf/MODIFICATIONS.md`](packages/extension-anchor-pdf/MODIFICATIONS.md).

## Quick start (from source)

Requirements: **Node >= 24** and **pnpm 11** (`packageManager` pins it; `corepack enable` helps).

```bash
git clone https://github.com/Fish-zjuer/anchor-explain.git
cd anchor-explain
pnpm install
pnpm link:ext     # install both extensions into your normal VS Code (directory junctions)
```

Then restart VS Code (or run *Developer: Reload Window*). After that, `pnpm build` + reload is
enough to pick up your own changes; `pnpm unlink:ext` removes the junctions (source untouched).

Prefer a throwaway window? `pnpm devhost` (line 1) / `pnpm devhost:pdf` (line 2) build first and
launch a one-off Extension Development Host. Pressing `F5` in VS Code works too — open the
**repository root** as the workspace.

> Don't hand-type `code --extensionDevelopmentPath=<relative path>`: the CLI does not forward CWD
> to an already-running instance, and you silently end up with a window missing one extension.

## Configure once (per machine)

1. Command Palette → **`Anchor: 配置模型端点`** (Configure model endpoint): provider id (`default`
   if you have none), `baseUrl`, model name. It validates and writes into your user settings.
   Or edit `settings.json` yourself:

   ```jsonc
   {
     "anchorExplain.providers": {
       "default": { "baseUrl": "https://api.deepseek.com", "tier1Model": "deepseek-flash" }
     },
     "anchorExplain.activeProvider": "default",
     "anchorExplain.maxFetchRounds": 3
   }
   ```

   **It must be an OpenAI-compatible endpoint** — we call `{baseUrl}/chat/completions`. Some vendors
   expose a second, differently-shaped compatible API (e.g. DeepSeek's Anthropic-compatible
   `https://api.deepseek.com/anthropic`); that one will 404 here. DeepSeek's official base URL is
   `https://api.deepseek.com` (no `/v1` needed). `activeProvider` is a **string**
   (the provider's key), not the provider object.

2. Command Palette → **`Anchor: 设置 API Key`** (Set API key). The key goes into VS Code's
   `SecretStorage` — **never** into `settings.json`, and never into anything we ship.
3. Command Palette → **`Anchor: 显示状态`** (Show state) to confirm endpoint + key are seen.

## Using it

| Action | Default key | Command |
|---|---|---|
| Explain the selection / whole file | `Ctrl+Shift+A` (`Cmd+Shift+A` on macOS) | `Anchor: 讲解这段` |
| Step forward / back | `Alt+]` / `Alt+[` | `Anchor: 下一步` / `上一步` |
| Stop | `Esc` | `Anchor: 停止讲解` |
| Add current selection to the queue | `Ctrl+Shift+Q` | `Anchor: 加入队列` |
| Open the start panel | `Ctrl+Alt+A` | `Anchor: 打开开始界面` |
| Drag a region on a PDF (line 2) | `Ctrl+Alt+S` | `Anchor: 框选区域` |

Everything is also reachable by typing `Anchor` in the Command Palette, and every keybinding can be
remapped in your `keybindings.json`. `Space` is deliberately **not** bound by default — it is a
typing key. **Your files are never modified**: no text is inserted, no editor buffer is touched.

## Repository layout

```
packages/core                  @anchor/core — type contracts, ports, pure functions (zero vscode deps)
packages/extension-anchor      line 1, the code editor extension
packages/extension-anchor-pdf  line 2, the PDF extension (Apache-2.0 fork)
scripts/                       smoke tests, dev-host launcher, packaging, fixture generation
test/fixtures/                 main.c + a 30-page sample PDF
docs/                          the single source of truth (see below)
```

## Commands

```bash
pnpm install
pnpm build        # esbuild bundles both extensions -> packages/*/dist/extension.cjs
pnpm watch        # same, watch mode (this is what F5's preLaunchTask runs)
pnpm typecheck    # tsc --noEmit
pnpm test         # node --test runs .ts directly (Node strips types; no build needed)
pnpm smoke        # artifact smoke: loads the bundle, asserts commands/views/assets are present
pnpm smoke:chain  # end-to-end: one full explanation through the real orchestration loop
pnpm smoke:pdf    # line 2 smoke: no hijack, renaming, region-selection chain
pnpm check        # the gate: typecheck -> test -> build -> all smokes
pnpm package:vsix # build + package .vsix installers into release/ (self-verifying)
pnpm link:ext     # install into your everyday VS Code   |  pnpm unlink:ext to undo
```

`pnpm check` is the acceptance gate; CI runs exactly that (`.github/workflows/check.yml`).

## Documentation (single source of truth)

Read `AGENTS.md` before changing code — it defines the working protocol. The docs have a fixed
order so the context prefix stays stable:

| File | Contents |
|---|---|
| `AGENTS.md` | Working protocol: slice discipline, file-reading budget, report format |
| `docs/STATE.md` | Current slice + **what to do first next session** |
| `docs/SLICES.md` | Slice plan (F1/F2, S1–S8), hard gates, rollback points |
| `docs/CONTRACTS.md` | Interface contracts — change a type, update this file |
| `docs/DECISIONS.md` | Decision log (append-only, D1 … D87) |
| `docs/ARCHITECTURE.md` | Four layers, two-package topology, data flow |
| `docs/PRIOR-ART.md` | Verified findings on the four prior tools |
| `docs/DISTRIBUTION.md` | How to build/install/ship the `.vsix` packages |

The docs are in Chinese and are kept as a genuine engineering log — including the mistakes. They
are part of the project, not an afterthought.

## License

**Apache-2.0** — see [`LICENSE`](LICENSE). Third-party components and derived sources are listed in
[`NOTICE`](NOTICE):

- `packages/extension-anchor-pdf` is a fork of `mathematic-inc/vscode-pdf` (Apache-2.0); upstream
  branding has been removed and every modification is declared.
- `pdfjs-dist` (Mozilla PDF.js, Apache-2.0) is vendored/bundled; required attribution lives in
  [`packages/extension-anchor/THIRD_PARTY_NOTICES.md`](packages/extension-anchor/THIRD_PARTY_NOTICES.md)
  and is asserted by a smoke test, because "bundled someone's code without the notice" is exactly
  the kind of thing nobody notices later.

Neither extension is published to the VS Code Marketplace (the upstream fork's `CONTRIBUTING.md`
asks for a Discussion first); install from source, or grab a `.vsix` from Releases.
