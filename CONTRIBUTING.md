# Contributing

Thanks for looking at this. Two things before you write code:

1. **Read [`AGENTS.md`](AGENTS.md) first.** It is the working protocol for this repository — slice
   discipline, how much context to read, how a change is reported. The rest of this file assumes it.
2. **`pnpm check` is the gate.** If it is not green, the change is not done.

## Set up

```bash
pnpm install          # Node >= 24, pnpm 11 (packageManager pins it)
pnpm check            # typecheck -> test -> build -> all smokes
```

To run the extensions: `pnpm link:ext` installs both into your everyday VS Code as directory
junctions (reload the window afterwards; `pnpm build` + reload to pick up edits). `pnpm devhost` /
`pnpm devhost:pdf` launch a throwaway Extension Development Host. `F5` works from the repository
root only — `.vscode/launch.json` lives there.

You need a model endpoint to see anything real: `Anchor: 配置模型端点` then `Anchor: 设置 API Key`.
The key goes to `SecretStorage`.

## The gate, and why the smokes look the way they do

`pnpm check` runs `typecheck → test → build → smoke → smoke:chain → smoke:fileswitch → smoke:pdf`.

- The **smoke tests read the built artifact** (`packages/*/dist/extension.cjs`), stubbing only the
  `vscode` module. They do not import source. That is deliberate: several real bugs in this project
  were only visible in the artifact (a fake that quietly survived bundling, an asset path that
  resolved in source but not in the bundle).
- **Run `pnpm build` before running a smoke script standalone.** Running a stale artifact produces
  a green run that proves nothing — this has bitten us more than once.
- Tests run straight from `.ts` (`node --test`, Node strips types). No build step for tests.

## Rules that are easy to break accidentally

- **`packages/core` must not import `vscode`.** Neither may `/prompts`, `/orchestrator`, or
  `/adapters`. That is what makes the core testable without a host.
- **Fakes live only at the outermost boundary.** They may appear in `test/` and `scripts/`, never in
  shipped code; a smoke assertion fails if a fake-only literal shows up in the artifact.
- **If you change a type, update `docs/CONTRACTS.md` in the same change.** If you make a decision
  worth arguing about later, append to `docs/DECISIONS.md` (append-only, never rewrite history).
- **`@types/vscode` is pinned exactly** and must equal the lower bound of `engines.vscode`
  (`engines.vscode` itself is a *range*). Don't add a caret to either.
- Line 2 (`extension-anchor-pdf`) is an Apache-2.0 fork. Don't edit `assets/pdf.js/` — the region
  select is an injected overlay precisely so the vendored upstream keeps an upgrade path. Any
  change you do make goes into `MODIFICATIONS.md`.

## Slices, commits, tags

Work lands as slices, each with its own commit and `git tag slice-<id>` (see `docs/SLICES.md`, and
`git tag -l` — there are ~28 of them). Commit messages here are Chinese and usually reference the
decision number (`D87: …`); that is the house style, not an accident. Match it.

## Pull requests

- `pnpm check` green, with the smoke counts if anything moved.
- Docs updated alongside code (`CONTRACTS.md` for types, `DECISIONS.md` for decisions,
  `STATE.md` for "what's next").
- If you changed packaging, run `pnpm package:vsix` — it reads the `.vsix` back and verifies
  structure, required/forbidden files, and that no secret slipped in.
- Say what you *verified*, not what you *believe*. "I ran it and saw X" beats "should work".

## Questions

Open an issue. The decision log is unusually detailed — if something looks arbitrary, the reason is
probably written down in `docs/DECISIONS.md`.
