/**
 * Subagent focus cycling shortcuts.
 *
 * @author raulcorreia7 <19838093+raulcorreia7@users.noreply.github.com>
 * @version 0.1.0
 * Part of the omp-extensions repo; copy-installed into
 * ~/.omp/agent/extensions/agent-cycle/ by ./install.sh.
 */
import type { AgentRef, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const LOG_TAG = "[agent-cycle]";

/** Single rebinding point for every chord this extension registers. */
const SHORTCUTS = {
   forward: "alt+right",
   backward: "alt+left",
   home: "alt+up",
} as const;

type CycleDirection = -1 | 1;

/** Runtime members of the host's interactive mode that this extension touches. */
interface InteractiveModeLike {
   readonly focusedAgentId?: string;
   focusAgentSession(agentId: string): Promise<void>;
   unfocusSession(): Promise<void>;
}

interface AgentRegistryLike {
   global(): { list(): AgentRef[] };
}

// globalThis slots: survive extension reloads.
const MODE = Symbol.for("agent-cycle.mode.v1");
const PATCHED = Symbol.for("agent-cycle.patched.v1");
const modeSlot = globalThis as unknown as Record<symbol, InteractiveModeLike | undefined>;

// Registry refs that can hold the main view: advisors are transcript-only rows,
// the main session is the ambient view, and aborted agents have no live session.
const UNFOCUSABLE_KINDS: Record<string, true> = { advisor: true, main: true };
const UNFOCUSABLE_STATUSES: Record<string, true> = { aborted: true };

/** Wrap-aware neighbor selection; an unfocused view enters from the near edge. */
function neighborAgentId(
   agents: AgentRef[],
   focusedId: string | undefined,
   direction: CycleDirection,
): string {
   const index = focusedId ? agents.findIndex((agent) => agent.id === focusedId) : -1;
   const edge = direction > 0 ? agents[0] : agents[agents.length - 1];
   const picked = index < 0 ? edge : agents[(index + direction + agents.length) % agents.length];

   // Callers filter the roster first; an empty list is the only source of a hole.
   if (!picked) throw new Error("no agents to focus");

   return picked.id;
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
      modeSlot[MODE] = this;
      return result;
   };
   flags[PATCHED] = true;
}

/** Run `work` with the captured mode, or notify when it is unavailable. */
function withInteractiveMode<T>(
   context: ExtensionContext,
   feature: string,
   work: (mode: InteractiveModeLike) => T,
): T | undefined {
   const mode = modeSlot[MODE];
   if (!mode) {
      context.ui.notify(`${feature}: interactive mode is not available.`, "warning");
      return undefined;
   }
   return work(mode);
}

async function focusNeighbor(
   context: ExtensionContext,
   registry: AgentRegistryLike,
   direction: CycleDirection,
): Promise<void> {
   await withInteractiveMode(context, "Agent cycling", async (mode) => {
      // Roster order: spawn time first, id as tiebreaker. A ref with no live
      // session (parked/aborted) cannot be focused, so it never enters the cycle.
      const agents = registry
         .global()
         .list()
         .filter(
            (ref) =>
               ref.session !== null &&
               !UNFOCUSABLE_KINDS[ref.kind] &&
               !UNFOCUSABLE_STATUSES[ref.status],
         )
         .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));

      if (agents.length === 0) {
         context.ui.notify("No subagents in this session.", "info");
         return;
      }

      try {
         await mode.focusAgentSession(neighborAgentId(agents, mode.focusedAgentId, direction));
      } catch (error) {
         context.ui.notify(
            `Agent focus failed: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
         );
      }
   });
}

async function returnToMain(context: ExtensionContext): Promise<void> {
   const mode = modeSlot[MODE];
   if (!mode?.focusedAgentId) return;

   try {
      await mode.unfocusSession();
   } catch (error) {
      context.ui.notify(
         `Return to main failed: ${error instanceof Error ? error.message : String(error)}`,
         "warning",
      );
   }
}

export default function agentCycleExtension(pi: ExtensionAPI): void {
   pi.setLabel("agent-cycle");

   // Outside registration: failure here disables the feature.
   watchInteractiveMode(pi);

   // Host namespace is untyped at the extension boundary; the check below guards the shape.
   const host = pi.pi as { AgentRegistry?: AgentRegistryLike };
   const registry = host.AgentRegistry;
   if (!registry) {
      pi.logger.warn(`${LOG_TAG} AgentRegistry export unavailable; agent cycling disabled.`);
      return;
   }

   pi.registerShortcut(SHORTCUTS.forward, {
      description: "View next subagent",
      handler: (context) => focusNeighbor(context, registry, 1),
   });
   pi.registerShortcut(SHORTCUTS.backward, {
      description: "View previous subagent",
      handler: (context) => focusNeighbor(context, registry, -1),
   });
   pi.registerShortcut(SHORTCUTS.home, {
      description: "Return to main session",
      handler: (context) => returnToMain(context),
   });
}
