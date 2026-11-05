# omp-extensions

Small, self-contained extensions for [omp (oh-my-pi)](https://github.com/can1357/oh-my-pi).
Each one is a single `index.ts` under `extensions/`.

## Extensions

| Extension | What it does | Keys and commands |
| --- | --- | --- |
| `agent-cycle` | Moves focus between subagents. | `Alt+Right` next, `Alt+Left` previous, `Alt+Up` back to the main agent |
| `reasoning-shortcuts` | Steps the reasoning effort down or up. | `Alt+,` lower, `Alt+.` higher |
| `hud-toggles` | Shows or hides the TODO and Subagents panels (hidden at start). | `Alt+T` TODO, `Alt+S` Subagents, `Alt+H` both; `/hud [todo\|agents\|all] [toggle\|show\|hide]` |
| `expand-refresh` | Redraws the transcript after expand or collapse, and expands or collapses a tool card on click. Needs `tui.mouse` on. It patches omp internals at runtime, so an omp update can break it. | click a tool card |
| `local-inference` | Adds a [llama-swap](https://github.com/mostlygeek/llama-swap) server as the provider `local-inference`, with its model list read from the server. | see [its README](extensions/local-inference/README.md) |

## Install

Requires omp. Clone the repo anywhere, then install:

```sh
git clone https://github.com/raulcorreia7/omp-extensions.git
cd omp-extensions
./install.sh
```

`install.sh` copies each `extensions/<name>/index.ts` to `~/.omp/agent/extensions/<name>/`,
replacing what was there, so re-running it is safe. Set `OMP_EXT_DIR` to install somewhere else.
Restart omp: running sessions do not pick up new extensions.

To update, `git pull` and run `./install.sh` again. To remove one, delete its directory under
`~/.omp/agent/extensions/`.

## Configure

- **Keys:** each extension keeps its chords in a `SHORTCUTS` object near the top of its `index.ts`.
  Change it there, then re-run `./install.sh`.
- **local-inference:** an optional `~/.omp/agent/local-inference.yml` lists your servers;
  environment variables override it. [Its README](extensions/local-inference/README.md) has the
  format. Keys stay in environment variables; the file names the variable, never the key.

## Develop

```sh
bun install
bun run typecheck   # strict TypeScript over every extension
bun run format      # Biome, 3-space indent
```

To add an extension, create `extensions/<name>/index.ts` (default-export the factory) and a
`package.json` with `pi.extensions: ["./index.ts"]`. `AGENTS.md` has the conventions.
Notable changes go in `CHANGELOG.md`.

Clicking other transcript blocks needs an omp change; `docs/click-disclosure-gap.md` explains why.

## License

[MIT](LICENSE)
