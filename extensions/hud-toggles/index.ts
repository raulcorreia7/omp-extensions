/**
 * TODO and Subagents HUD visibility toggles.
 *
 * @author raulcorreia7 <19838093+raulcorreia7@users.noreply.github.com>
 * @version 0.1.0
 * Part of the omp-extensions repo; copy-installed into
 * ~/.omp/agent/extensions/hud-toggles/ by ./install.sh.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Single rebinding point for every chord this extension registers. */
const SHORTCUTS = {
   toggleTodo: "alt+t",
   toggleSubagents: "alt+s",
   toggleAll: "alt+h",
} as const;

/** Turns "alt+t" into "Alt+T" for descriptions and help text. */
function label(chord: string): string {
   return chord
      .split("+")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("+");
}

/** Values you may retune without touching logic. */
const CONFIG = {
   /** Prefix on every diagnostic line this extension emits. */
   logTag: "[hud-toggles]",
   /** HUD visibility right after load. */
   hud: { todoVisible: false, agentsVisible: false },
} as const;

const HUD_USAGE = "Usage: /hud [todo|agents|all] [toggle|show|hide]";

type HudTarget = "todo" | "agents" | "all";
type HudAction = "toggle" | "show" | "hide";

interface HudState {
   todoVisible: boolean;
   agentsVisible: boolean;
}

/** Runtime members of the host's interactive mode that this extension touches. */
interface InteractiveModeLike {
   chatContainer: unknown;
   pendingMessagesContainer: unknown;
   todoContainer: unknown;
   subagentContainer: unknown;
   btwContainer: unknown;
   omfgContainer: unknown;
   cleanseContainer: unknown;
   errorBannerContainer: unknown;
   modelCycleContainer: unknown;
   deferredCommandContainer: unknown;
   statusContainer: unknown;
   attachmentChipsContainer: unknown;
   hookWidgetContainerAbove: unknown;
   editorContainer: unknown;
   hookWidgetContainerBelow: unknown;
   composer?: { setRuntimeChildren(children: unknown[]): void };
   ui: { requestRender(force?: boolean): void };
}

type ModeListener = (mode: InteractiveModeLike) => void;

// globalThis slots: survive extension reloads.
const CAPTURED = Symbol.for("hud-toggles.mode.v1");
const LISTENERS = Symbol.for("hud-toggles.listeners.v1");
const PATCHED = Symbol.for("hud-toggles.patched.v1");
const MOUNT_WARNED = Symbol.for("hud-toggles.mount-warned.v1");
const STATE = Symbol.for("hud-toggles.state.v1");

/** State slot on globalThis under a registered symbol; survives extension reloads. */
interface Cell<T> {
   get(): T | undefined;
   set(value: T | undefined): void;
   /** Return the existing value, or create and store it on first access. */
   init(create: () => T): T;
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
      init: (create) => {
         const existing = table[key];
         if (existing !== undefined) return existing;
         const created = create();
         table[key] = created;
         return created;
      },
   };
}

const captured = symbolCell<InteractiveModeLike>(CAPTURED);
const listeners = symbolCell<Set<ModeListener>>(LISTENERS);
const mountWarned = symbolCell<boolean>(MOUNT_WARNED);
const hudState = symbolCell<HudState>(STATE);

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
            console.warn(`${CONFIG.logTag} interactive-mode listener failed:`, error);
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
         `${CONFIG.logTag} InteractiveMode.init unavailable; OMP internals may have changed.`,
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

/** Re-mount composer children, omitting HUDs marked invisible. No-op + warning when the host lacks the API. */
function mountComposer(
   mode: InteractiveModeLike,
   visible: { todo: boolean; agents: boolean },
): void {
   const setChildren = mode.composer?.setRuntimeChildren;
   if (typeof setChildren !== "function") {
      if (!mountWarned.get()) {
         mountWarned.set(true);
         console.warn(
            `${CONFIG.logTag} composer.setRuntimeChildren unavailable; HUD toggles disabled.`,
         );
      }
      return;
   }

   // Host-defined child order; absent members drop out.
   setChildren.call(
      mode.composer,
      [
         mode.chatContainer,
         mode.pendingMessagesContainer,
         ...(visible.todo ? [mode.todoContainer] : []),
         ...(visible.agents ? [mode.subagentContainer] : []),
         mode.btwContainer,
         mode.omfgContainer,
         mode.cleanseContainer,
         mode.errorBannerContainer,
         mode.modelCycleContainer,
         mode.deferredCommandContainer,
         mode.statusContainer,
         mode.attachmentChipsContainer,
         mode.hookWidgetContainerAbove,
         mode.editorContainer,
         mode.hookWidgetContainerBelow,
      ].filter(Boolean),
   );
   mode.ui.requestRender(true);
}

/** Run `work` with the captured mode, or notify when it is unavailable. */
function withInteractiveMode<T>(
   context: ExtensionContext,
   feature: string,
   work: (mode: InteractiveModeLike) => T,
): T | undefined {
   const mode = captured.get();
   if (!mode) {
      context.ui.notify(`${feature}: interactive mode is not available.`, "warning");
      return undefined;
   }
   return work(mode);
}

const FIXED_VISIBILITY: Partial<Record<HudAction, boolean>> = { show: true, hide: false };

/** Apply one (target, action) to a state, returning the next state. */
function reduceHudState(state: HudState, target: HudTarget, action: HudAction): HudState {
   if (target === "todo") {
      return { ...state, todoVisible: FIXED_VISIBILITY[action] ?? !state.todoVisible };
   }
   if (target === "agents") {
      return { ...state, agentsVisible: FIXED_VISIBILITY[action] ?? !state.agentsVisible };
   }
   if (action === "toggle") {
      // "all" toggle is one master switch: if both visible, hide; otherwise show both.
      const visible = !(state.todoVisible && state.agentsVisible);
      return { todoVisible: visible, agentsVisible: visible };
   }
   const visible = action === "show";
   return { todoVisible: visible, agentsVisible: visible };
}

function hudStateText(state: HudState): string {
   return `HUD: TODO ${state.todoVisible ? "shown" : "hidden"} · Subagents ${state.agentsVisible ? "shown" : "hidden"}`;
}

const TARGET_ALIASES: Record<string, HudTarget> = {
   todo: "todo",
   todos: "todo",
   agent: "agents",
   agents: "agents",
   subagent: "agents",
   subagents: "agents",
   all: "all",
   both: "all",
};

const ACTION_ALIASES: Record<string, HudAction> = {
   toggle: "toggle",
   show: "show",
   on: "show",
   hide: "hide",
   off: "hide",
};

interface HudArgs {
   target?: HudTarget | undefined;
   action?: HudAction | undefined;
}

function parseHudArgs(args: string): HudArgs {
   const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
   if (parts.length === 0) return {};

   return {
      target: TARGET_ALIASES[parts[0] ?? ""],
      action: parts[1] ? ACTION_ALIASES[parts[1]] : "toggle",
   };
}

/** Push current visibility into the host composer. */
function applyHudState(mode: InteractiveModeLike): void {
   const state = hudState.init(() => ({ ...CONFIG.hud }));
   mountComposer(mode, { todo: state.todoVisible, agents: state.agentsVisible });
}

function applyAndNotify(context: ExtensionContext, target: HudTarget, action: HudAction): void {
   withInteractiveMode(context, "HUD toggle", (mode) => {
      const next = reduceHudState(
         hudState.init(() => ({ ...CONFIG.hud })),
         target,
         action,
      );
      hudState.set(next);
      applyHudState(mode);
      context.ui.notify(hudStateText(next), "info");
   });
}

function registerHudToggle(pi: ExtensionAPI): void {
   pi.setLabel("HUD Toggle");

   // Apply visibility once the live mode exists (immediately if already captured).
   onInteractiveMode(applyHudState);

   pi.registerShortcut(SHORTCUTS.toggleTodo, {
      description: "Toggle TODO HUD",
      handler: (context) => applyAndNotify(context, "todo", "toggle"),
   });
   pi.registerShortcut(SHORTCUTS.toggleSubagents, {
      description: "Toggle Subagents HUD",
      handler: (context) => applyAndNotify(context, "agents", "toggle"),
   });
   pi.registerShortcut(SHORTCUTS.toggleAll, {
      description: "Toggle TODO + Subagents HUDs",
      handler: (context) => applyAndNotify(context, "all", "toggle"),
   });

   pi.registerCommand("hud", {
      description: "Show/hide TODO and Subagents HUDs",
      handler: async (args, context) => {
         const parsed = parseHudArgs(args);
         if (!parsed.target) {
            const help = `${label(SHORTCUTS.toggleTodo)} TODO · ${label(SHORTCUTS.toggleSubagents)} Subagents · ${label(SHORTCUTS.toggleAll)} both`;
            const current = hudStateText(hudState.init(() => ({ ...CONFIG.hud })));
            context.ui.notify(args.trim() ? HUD_USAGE : `${current}\n${help}`, "warning");
            return;
         }
         if (!parsed.action) {
            context.ui.notify(HUD_USAGE, "warning");
            return;
         }
         applyAndNotify(context, parsed.target, parsed.action);
      },
   });
}

export default function hudTogglesExtension(pi: ExtensionAPI): void {
   pi.setLabel("hud-toggles");

   // Outside registration: failure here disables the feature.
   watchInteractiveMode(pi);

   // One feature in isolation: a throwing registration logs a warning and the
   // remaining registrations still load.
   try {
      registerHudToggle(pi);
   } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pi.logger.warn(`${CONFIG.logTag}: feature registration failed: ${message}`);
   }
}
