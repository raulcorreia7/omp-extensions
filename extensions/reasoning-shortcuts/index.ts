/**
 * Reasoning effort cycling shortcuts.
 *
 * @author raulcorreia7 <19838093+raulcorreia7@users.noreply.github.com>
 * @version 0.1.0
 * Part of the omp-extensions repo; copy-installed into
 * ~/.omp/agent/extensions/reasoning-shortcuts/ by ./install.sh.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Single rebinding point for every chord this extension registers. */
const SHORTCUTS = {
   decrease: "alt+,",
   increase: "alt+.",
} as const;

/** Turns "alt+t" into "Alt+T" for descriptions and help text. */
function label(chord: string): string {
   return chord
      .split("+")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("+");
}

type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ThinkingLevel = "off" | ReasoningLevel;
type Direction = -1 | 1;

const REASONING_LEVELS: readonly ReasoningLevel[] = [
   "minimal",
   "low",
   "medium",
   "high",
   "xhigh",
   "max",
];
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", ...REASONING_LEVELS];

function isReasoningLevel(value: unknown): value is ReasoningLevel {
   if (typeof value !== "string") return false;

   return (REASONING_LEVELS as readonly string[]).includes(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
   return value === "off" || isReasoningLevel(value);
}

function supportedEfforts(thinking: unknown): ReasoningLevel[] {
   let efforts: unknown;
   if (typeof thinking === "object" && thinking !== null && "efforts" in thinking) {
      efforts = thinking.efforts;
   }
   const values = Array.isArray(thinking) ? thinking : Array.isArray(efforts) ? efforts : [];
   return values.filter(isReasoningLevel);
}

/** Levels the live model advertises, "off" first; empty when it has no knob. */
function modelThinkingLevels(model: { thinking?: unknown } | undefined): readonly ThinkingLevel[] {
   const levels = supportedEfforts(model?.thinking);
   return levels.length === 0 ? [] : ["off", ...levels];
}

/**
 * Step one supported level in `direction`, clamped at the ends (no wrap through
 * "off"). A current level outside the advertised set (e.g. the host's "auto")
 * ranks by the canonical order so the step lands on a real level.
 */
function nextThinkingLevel(
   current: unknown,
   levels: readonly ThinkingLevel[],
   direction: Direction,
): ThinkingLevel | undefined {
   if (levels.length === 0) return undefined;

   const currentLevel = isThinkingLevel(current) ? current : "off";
   const currentIndex = levels.indexOf(currentLevel);
   if (currentIndex >= 0) {
      // Clamp at the ends; no wrap through "off".
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), levels.length - 1);
      return levels[nextIndex];
   }

   const currentRank = THINKING_LEVELS.indexOf(currentLevel);
   if (direction > 0) {
      for (const level of levels) {
         if (THINKING_LEVELS.indexOf(level) > currentRank) return level;
      }
      return levels[levels.length - 1];
   }

   for (let index = levels.length - 1; index >= 0; index -= 1) {
      const level = levels[index];
      if (level === undefined) continue;
      if (THINKING_LEVELS.indexOf(level) < currentRank) return level;
   }
   return levels[0];
}

/** Build a shortcut handler that steps the thinking level one notch. */
function cycleHandler(pi: ExtensionAPI, direction: Direction) {
   return (context: ExtensionContext): void => {
      const model = context.models.current();
      const current = pi.getThinkingLevel();
      const next = nextThinkingLevel(current, modelThinkingLevels(model), direction);

      if (next === undefined) {
         context.ui.notify("This model does not support configurable reasoning.", "info");
         return;
      }
      if (next === current) {
         context.ui.notify(`Reasoning: ${next} (${direction > 0 ? "max" : "min"})`, "info");
         return;
      }

      // Host models levels as a string const-enum; values match our vocabulary.
      pi.setThinkingLevel(next as Parameters<typeof pi.setThinkingLevel>[0]);
      context.ui.notify(`Reasoning: ${next}`, "info");
   };
}

export default function reasoningShortcutsExtension(pi: ExtensionAPI): void {
   pi.setLabel("reasoning-shortcuts");

   pi.registerShortcut(SHORTCUTS.decrease, {
      description: `Decrease reasoning effort (${label(SHORTCUTS.decrease)})`,
      handler: cycleHandler(pi, -1),
   });
   pi.registerShortcut(SHORTCUTS.increase, {
      description: `Increase reasoning effort (${label(SHORTCUTS.increase)})`,
      handler: cycleHandler(pi, 1),
   });
}
