# AGENTS.md

Conventions for this repository. They come from explicit requests only.

## Layout

- One extension per directory under `extensions/`, with as few files as
  possible: a single `index.ts` entry point plus `package.json` for metadata.
  Do not add `src/` trees or per-extension install scripts. Sidecar data files
  (`*.md`) sit beside `index.ts` when an extension owns runtime-editable data.
- `index.ts` exports the extension factory as `default`.

## File headers

- Every extension entry point starts with a comment block that holds its
  purpose, `@author`, `@version`, and the path `./install.sh` installs it to.
  Update the block when the extension changes.
- `package.json` holds `name`, `version`, `description`, and `author`.

## Tooling

- Format with `bun run format` (`biome.json`: 3-space indent, double quotes).
- Type-check with `bun run typecheck` (`tsconfig.json`: maximal strictness).

## Install

- The root `./install.sh` copies `extensions/<name>/index.ts` into
  `~/.omp/agent/extensions/<name>/` and replaces that directory on every run, so
  files deleted from this repo never linger in the installed copy. Sidecar
  `*.md` files install as symlinks to their repo copies, so runtime edits land
  in this repo and survive reinstalls.
- After an install, compare the installed file with the repo file and load one
  session to confirm the extension starts without errors.

## Changelog

- Record every notable change in `CHANGELOG.md` under Added, Changed, or Fixed.

## Commits

- Start the subject with `omp-extensions: `.
- One concern per commit, and state what changed and why. Focus on what
  changed, not on how it is implemented.
