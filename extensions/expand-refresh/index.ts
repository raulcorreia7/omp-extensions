/**
 * Rewrite retired transcript rows after expansion/visibility gestures, and
 * make tool execution cards expand/collapse on click (single example). Click routing
 * monkey-patches host internals at runtime; no OMP source changes.
 *
 * @author raulcorreia7 <19838093+raulcorreia7@users.noreply.github.com>
 * @version 0.1.0
 * Part of the omp-extensions repo; copy-installed into
 * ~/.omp/agent/extensions/expand-refresh/ by ./install.sh.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

/** Prefix on every diagnostic line this extension emits. */
const LOG_TAG = "[expand-refresh]";

/** A tool result block: the host's ToolExecutionComponent surface we touch. */
interface ToolBlockLike {
   setExpanded(expanded: boolean): void;
   getClickFocusAgentIds(): string[];
}

/** Runtime members of the host's interactive mode that this extension touches. */
interface InteractiveModeLike {
   readonly chatContainer?: {
      resetStableEmission?: () => void;
      children?: readonly unknown[];
   };
   showStatus(message: string, options?: { dim?: boolean }): void;
   ui: { resetDisplay(): void; requestRender(force?: boolean): void };
   resolveViewportClickCandidates?(index: number): string[];
   setClickHoverId?(id: string | undefined): void;
}

type ModeListener = (mode: InteractiveModeLike) => void;

// globalThis slots: survive extension reloads.
const CAPTURED = Symbol.for("expand-refresh.mode.v1");
const LISTENERS = Symbol.for("expand-refresh.listeners.v1");
const PATCHED = Symbol.for("expand-refresh.patched.v1");
const TOOL_PATCHED = Symbol.for("expand-refresh.tool-patched.v1");

/** State slot on globalThis under a registered symbol; survives extension reloads. */
interface Cell<T> {
   get(): T | undefined;
   set(value: T | undefined): void;
}

function symbolCell<T>(key: symbol): Cell<T> {
   // Untyped by necessity: the host passes an untyped live instance; presence
   // is checked by the callers below, never assumed here.
   const table = globalThis as unknown as Record<symbol, T | undefined>;
   return {
      get: () => table[key],
      set: (value) => {
         if (value === undefined) delete table[key];
         else table[key] = value;
      },
   };
}

const captured = symbolCell<InteractiveModeLike>(CAPTURED);
const listeners = symbolCell<Set<ModeListener>>(LISTENERS);

/** Run listener immediately when the mode exists, else on first capture. */
function onInteractiveMode(listener: ModeListener): void {
   const current = captured.get();
   if (current) {
      listener(current);
      return;
   }
   const pending = listeners.get() ?? new Set<ModeListener>();
   pending.add(listener);
   listeners.set(pending);
}

function capture(mode: InteractiveModeLike): void {
   captured.set(mode);
   const pending = listeners.get();
   listeners.set(undefined);
   if (pending) {
      for (const listener of pending) {
         try {
            listener(mode);
         } catch (error) {
            console.warn(`${LOG_TAG} interactive-mode listener failed:`, error);
         }
      }
   }
}

// Host internals; absent target degrades every dependent feature to a warning.
function watchInteractiveMode(pi: ExtensionAPI): void {
   // Untyped at the boundary: the host namespace shape is not part of the
   // extension type contract; validated by the presence check below.
   const host = pi.pi as {
      InteractiveMode?: { prototype?: { init?: (...args: unknown[]) => Promise<unknown> } };
   };
   const prototype = host.InteractiveMode?.prototype;
   const init = prototype?.init;

   if (!init) {
      pi.logger.warn(
         `${LOG_TAG} InteractiveMode.init unavailable; OMP internals may have changed.`,
      );
      return;
   }
   const patchable = prototype as { init?: (...args: unknown[]) => Promise<unknown> };
   // Own bookkeeping flag; the host prototype is untyped at this boundary.
   const flags = patchable as Record<symbol, unknown>;
   if (flags[PATCHED]) return;

   patchable.init = async function (this: InteractiveModeLike, ...args: unknown[]) {
      const result = await init.apply(this, args);
      capture(this);
      return result;
   };
   flags[PATCHED] = true;
}

/** Host status prefix for the ctrl+o gesture (input-controller.ts:2732). The only
 *  signal this gesture emits that an extension can observe. */
const EXPAND_GESTURE = "Tool output expansion: ";

// Installed hooks: object identity membership, added and removed at runtime.
const installed = new WeakSet<object>();

/** Pair every scrollback-clearing replay with the emission-ledger reset, and make
 *  the ctrl+o gesture (which only repaints the viewport) take that path too.
 *  resetStableEmission is documented as the mandatory pair for a clearing
 *  repaint; without it, retired rows keep their committed text or, on a clear,
 *  the stale ledger can freeze a block's emission. Safe to call when the host
 *  already pairs (ctrl+t): the ledger reset is idempotent. */
function installRefresh(mode: InteractiveModeLike): void {
   const ui = mode.ui;
   if (typeof ui?.resetDisplay !== "function" || installed.has(ui)) return;
   installed.add(ui);

   const resetDisplay = ui.resetDisplay.bind(ui);
   ui.resetDisplay = () => {
      mode.chatContainer?.resetStableEmission?.();
      resetDisplay();
   };

   const showStatus = mode.showStatus.bind(mode);
   mode.showStatus = (message, options) => {
      showStatus(message, options);
      if (message.startsWith(EXPAND_GESTURE)) mode.ui.resetDisplay();
   };
}

// ── Click-to-expand, single example: tool execution cards ─────────────────
//
// The host routes clicks through resolveViewportClickCandidates (span ids from
// each block's getClickFocusAgentIds) and treats unknown ids as gone
// subagents, announcing that in showStatus. We register a sentinel id per tool
// block, treat that announcement as the click signal, suppress it, and toggle
// instead. Hover follows resolution with setClickHoverId, which cancels the
// pending toggle. Clicks on every other row pass through untouched.

/** Click sentinel prefix; charset mirrors the host's reserved `@omp:` ids. */
const TOGGLE_SENTINEL = "@omp:toggle-tool:";

/** Tool block prototype members this extension wraps. */
type ToolProto = Record<symbol, unknown> & {
   getClickFocusAgentIds(this: ToolBlockLike): string[];
   setExpanded(this: ToolBlockLike, expanded: boolean): void;
};

const clickIdBy = new WeakMap<object, string>();
let clickIdCounter = 0;

// Shadow copy of each block's expansion state; the host field is private.
const expandedBy = new WeakMap<object, boolean>();

// Block awaiting a toggle: set on click resolution, cleared by hover or tick end.
let pendingToggle: ToolBlockLike | undefined;

const clickInstalled = new WeakSet<object>();

function isToolBlock(value: unknown): value is ToolBlockLike {
   return (
      typeof value === "object" &&
      value !== null &&
      "setExpanded" in value &&
      "getClickFocusAgentIds" in value
   );
}

function toolBlocks(mode: InteractiveModeLike): ToolBlockLike[] {
   const children = mode.chatContainer?.children ?? [];
   return children.filter(isToolBlock);
}

function clickIdFor(block: object): string {
   const existing = clickIdBy.get(block);
   if (existing !== undefined) return existing;
   clickIdCounter += 1;
   const id = `${TOGGLE_SENTINEL}${clickIdCounter}`;
   clickIdBy.set(block, id);
   return id;
}

/** Wrap the tool block prototype once: sentinel ids and expansion shadow state. */
function patchToolPrototype(block: ToolBlockLike): void {
   const proto: ToolProto = Object.getPrototypeOf(block);
   if (proto[TOOL_PATCHED]) return;

   const getIds = proto.getClickFocusAgentIds;
   const setExpanded = proto.setExpanded;

   proto.getClickFocusAgentIds = function (this: ToolBlockLike): string[] {
      const ids = getIds.call(this);
      if (ids.length > 0) return ids;
      return [clickIdFor(this)];
   };
   proto.setExpanded = function (this: ToolBlockLike, expanded: boolean): void {
      expandedBy.set(this, expanded);
      setExpanded.call(this, expanded);
   };
   proto[TOOL_PATCHED] = true;
}

/** Flip one block's expansion and take the refresh path the ctrl+o fix uses. */
function toggleToolBlock(mode: InteractiveModeLike, block: ToolBlockLike): void {
   const expanded = expandedBy.get(block) ?? false;
   block.setExpanded(!expanded);
   mode.ui.resetDisplay();
}

function installClickToExpand(mode: InteractiveModeLike): void {
   for (const block of toolBlocks(mode)) {
      patchToolPrototype(block);
   }
   if (clickInstalled.has(mode)) return;

   const resolve = mode.resolveViewportClickCandidates?.bind(mode);
   const hover = mode.setClickHoverId?.bind(mode);
   if (!resolve || !hover) {
      console.warn(`${LOG_TAG} click-to-expand seams unavailable; OMP internals may have changed`);
      return;
   }
   clickInstalled.add(mode);

   mode.resolveViewportClickCandidates = (index) => {
      const ids = resolve(index);
      const ours = ids.find((id) => id.startsWith(TOGGLE_SENTINEL));
      if (ours !== undefined) {
         pendingToggle = toolBlocks(mode).find((block) => clickIdFor(block) === ours);
         queueMicrotask(() => {
            pendingToggle = undefined;
         });
      }
      return ids;
   };

   mode.setClickHoverId = (id) => {
      pendingToggle = undefined;
      hover(id);
   };

   // The outermost showStatus wrapper: the click signal is the host's gone
   // subagent announcement while a sentinel is pending. installRefresh's
   // wrapper stays innermost, so the ctrl+o gesture path is unchanged.
   const showStatus = mode.showStatus.bind(mode);
   mode.showStatus = (message, options) => {
      const block = pendingToggle;
      if (block) {
         pendingToggle = undefined;
         toggleToolBlock(mode, block);
         return;
      }
      showStatus(message, options);
   };
}

/** Clicks never reach the app while tui.mouse is off; say so once at load. */
function warnIfClicksDisabled(pi: ExtensionAPI): void {
   try {
      const mouse = lookup("tui.mouse");
      // Untyped at the boundary: the settings scope is host-owned and not part
      // of the extension type contract; the catch below covers a shape change.
      const scope = pi.pi as unknown as Parameters<NonNullable<typeof mouse>["get"]>[0];
      if (mouse && mouse.get(scope) === false) {
         pi.logger.warn(
            `${LOG_TAG} tui.mouse is off, so clicks never reach the app; enable it for click-to-expand`,
         );
      }
   } catch {
      // Settings shapes are host-owned; a mismatch degrades to silence.
   }
}

export default function expandRefreshExtension(pi: ExtensionAPI): void {
   pi.setLabel("Expand Refresh");

   warnIfClicksDisabled(pi);

   watchInteractiveMode(pi);
   onInteractiveMode(installRefresh);
   onInteractiveMode(installClickToExpand);
   // Tool blocks appear as tools run; rediscover their prototype cheaply.
   pi.on("tool_call", async () => {
      onInteractiveMode(installClickToExpand);
   });
   pi.on("tool_result", async () => {
      onInteractiveMode(installClickToExpand);
   });
   if (!pi.pi) pi.logger.warn(`${LOG_TAG} pi namespace unavailable; no-op`);
}
