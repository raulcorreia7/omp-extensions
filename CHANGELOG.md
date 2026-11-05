# Changelog

Notable changes to the extensions in this repository.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-11-04

### Changed

- `local-inference` picks its server from `~/.omp/agent/local-inference.yml`: an
  ordered list of candidates, probed at startup, first answer wins. One file now
  works on every machine and network (loopback on the server host, the keyed
  front door elsewhere) with nothing set per machine. The environment variables
  remain as overrides; `LLAMA_SWAP_CONFIG` names another file.

### Added

- `local-inference` registers the llama-swap front door as the provider
  `local-inference` and builds its model list from what the server publishes:
  every model and alias with its context window, output limit, reasoning levels,
  thinking format and modalities. Adding a model in the registry needs no omp
  change. `LLAMA_SWAP_BASE_URL` picks the server (any machine, LAN or tailnet);
  with no setting it uses loopback. `LLAMA_SWAP_API_KEY` (or `AI_API_KEY`) sends a
  Bearer key; `LLAMA_SWAP_DEFAULT_CONTEXT` keeps models whose entry has no
  metadata. Nothing is tied to one machine or domain; `./README.md` has examples.
- `tsconfig.json` and the root `package.json` add the tooling. `bun run
  typecheck` checks every extension at maximal TypeScript strictness, and
  `bun run format` applies the repository style with 3-space indent.
- `AGENTS.md` and this changelog.
- `expand-refresh` makes tool execution cards expand/collapse on click, the
  first clickable example. It monkey-patches host internals, so no OMP source
  change is needed. Enable `tui.mouse` so clicks reach the app.

### Changed

- Each extension is one `index.ts` entry point plus `package.json`. The `src/`
  trees and the per-extension `install.sh` files are gone.
- `install.sh` copies `extensions/<name>/index.ts` into
  `~/.omp/agent/extensions/<name>/` and replaces that directory on every run.
  Sidecar data files stay in this repo, so captured lessons survive reinstalls.
- `OMP_EXT_DIR` names the extensions root, not one extension directory.
- Extension entry points carry a file header with purpose, author, version, and
  install path. Each `package.json` has an `author` field.
- Author addresses use the public GitHub noreply,
  `19838093+raulcorreia7@users.noreply.github.com`.

### Fixed

- `hud-toggles` did not load. `src/shell.ts` imported `getInteractiveMode`, and
  `src/interactive-mode.ts` never exported it. The entry point exports it now.
- `agent-cycle` cycled onto agents with no live session, parked or historical
  rows. `focusAgentSession` threw and the shortcut reported
  "Agent focus failed: ...". The roster filter now requires `ref.session !==
  null`, so cycling skips those agents.
