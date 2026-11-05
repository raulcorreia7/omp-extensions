# Click-to-expand/collapse for transcript blocks — host gap

Clicking a thinking block or tool call does nothing in the ANSI path (any terminal
inside tmux). The toggle channel exists end-to-end only on the native (TSP) path:

- `section { collapsible: true }` nodes are emitted by `AssistantMessageComponent`
  (`#describeMessage`) and `ToolExecutionComponent`, and terminal `toggle` events
  route through `NativeBackend.#routeUiEvent`.
- On the ANSI path the only mouse handler is `InputController.#handleInlineMouse`
  (`packages/coding-agent/src/modes/controllers/input-controller.ts:764-773`),
  which resolves a clicked row to **subagent-focus candidates only**.
- TSP is skipped under a multiplexer (`packages/tui/src/terminal.ts:1776-1783`),
  so inside tmux the ANSI path is the only one live.

What an extension cannot reach to close this gap:

- `InputController.#handleInlineMouse` — a true private field.
- The composer's row→block mapping — `#lastClickSpans` and the
  `topPadding + before.length - drop` shift (`packages/tui/src/prompt/composer.ts:436-472`) are private.
- `TranscriptContainer.getChildStartRow` is documented as *"the last full
  render()"* coordinates (`packages/tui/src/chrome/transcript-container.ts:817-820`),
  not viewport coordinates.

Closing it needs a host patch (a row→block hit-test and a per-block toggle on the
ANSI render path) plus a rebuild — recorded here, not implemented.

## What a monkey-patch can reach

For one block type the gap is closable without a host patch, because three seams
are public at runtime. `expand-refresh` now uses them for tool execution cards:

- `ToolExecutionComponent.getClickFocusAgentIds()` feeds the composer's click
  spans: the composer registers a span for any component that returns ids.
- `InteractiveMode.resolveViewportClickCandidates(index)` routes those ids for
  clicks and for hover.
- A click on a non-agent sentinel id falls through to
  `showStatus("That subagent is gone …")`, which is the click signal; hover
  calls `setClickHoverId` instead.

`expand-refresh` wraps those seams, flips `ToolExecutionComponent.setExpanded`,
and suppresses the sentinel's status line. Clicks need `tui.mouse` on. Thinking
blocks and arbitrary transcript rows still need the host-side hit-test above.
