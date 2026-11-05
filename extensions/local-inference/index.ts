/**
 * local-inference: registers a llama-swap server as an omp provider, with the model catalog read
 * from the server itself.
 *
 * llama-swap publishes every model and alias at GET /v1/models. When an entry carries `metadata`
 * (context window, output limit, reasoning levels, thinking format, modalities), this extension
 * turns it into an omp model, so adding or retuning a model is a server-side edit and never an omp
 * edit.
 *
 * Which server: `~/.omp/agent/local-inference.yml` lists candidate servers in order. At startup all
 * are probed at once and the first, in list order, that answers is registered. So one file serves
 * every machine: the server's own host answers on loopback, every other machine reaches the keyed
 * front door from the LAN, work or away. With no file, loopback is the only candidate. Entries
 * without a context window are skipped and named in the log unless `defaultContext` is set, since a
 * missing limit mis-plans compaction in silence. Environment overrides: LLAMA_SWAP_BASE_URL (one
 * server, no probing), LLAMA_SWAP_API_KEY, LLAMA_SWAP_DEFAULT_CONTEXT, LLAMA_SWAP_CONFIG (file path).
 * ./README.md has the file format.
 *
 * @author raulcorreia7 <19838093+raulcorreia7@users.noreply.github.com>
 * @version 0.2.0
 * Part of the omp-extensions repo; copy-installed into
 * ~/.omp/agent/extensions/local-inference/ by ./install.sh.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

/** omp runs extensions on Bun; this is the one Bun API used here, so @types/bun is not needed. */
declare const Bun: { YAML: { parse(text: string): unknown } };

const PROVIDER = "local-inference";
const LOOPBACK_URL = "http://127.0.0.1:9000";
const CONFIG_PATH = join(homedir(), ".omp", "agent", "local-inference.yml");
const FETCH_TIMEOUT_MS = 15_000;
/** All candidates are probed at once, so this bounds how long a start can wait. */
const PROBE_TIMEOUT_MS = 3_000;
const LOG_TAG = "[local-inference]";

/** Reasoning levels omp knows, taken from the model config it will be handed to. */
type CatalogEffort =
   NonNullable<ProviderModelConfig["thinking"]> extends { efforts?: readonly (infer E)[] }
      ? E
      : never;

/** Registry values outside omp's levels are ignored rather than guessed at. */
const EFFORT_NAMES = ["minimal", "low", "medium", "high", "xhigh", "max"];

const THINKING_FORMATS = ["openai", "openrouter", "qwen", "qwen-chat-template", "zai"] as const;

/** Levels the Qwen engines take, for entries that do not name their own. */
const DEFAULT_EFFORT_MAP: Record<string, string> = { minimal: "low", high: "xhigh", max: "xhigh" };

/** Request behaviour shared by every engine behind llama-swap. */
const ENGINE_COMPAT = {
   supportsReasoningEffort: true,
   reasoningContentField: "reasoning_content",
   requiresReasoningContentForToolCalls: true,
   supportsStrictMode: false,
   supportsDeveloperRole: true,
   supportsStore: false,
   supportsReasoningParams: true,
} as const;

/** One entry of llama-swap's GET /v1/models. */
interface PublishedModel {
   id?: unknown;
   name?: unknown;
   meta?: { llamaswap?: RegistryMetadata } | undefined;
   metadata?: RegistryMetadata | undefined;
}

/** metadata of a registry entry, echoed by llama-swap for aliases too. */
interface RegistryMetadata {
   context?: unknown;
   output?: unknown;
   efforts?: unknown;
   effort?: unknown;
   input?: unknown;
   thinkingFormat?: unknown;
   qwenTemplateReasoningEffort?: unknown;
   reasoningEffortMap?: unknown;
   supportsDeveloperRole?: unknown;
}

/** One candidate: its API URL and the environment variable that holds its Bearer key. */
interface Server {
   baseUrl: string;
   apiKeyEnv: string;
}

/** A server root or an explicit path; a root is completed to `/v1`. */
function apiUrl(value: string, source: string): string {
   try {
      const url = new URL(value.trim());
      url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
      return url.origin + url.pathname;
   } catch {
      throw new Error(`${LOG_TAG}: ${source} is not a URL: ${value}`);
   }
}

/** A `servers` entry: a URL, or `{ url, apiKeyEnv }`. The key defaults to LLAMA_SWAP_API_KEY, then AI_API_KEY. */
function toServer(entry: unknown, source: string): Server {
   const fallbackKey = process.env["LLAMA_SWAP_API_KEY"] ? "LLAMA_SWAP_API_KEY" : "AI_API_KEY";
   if (typeof entry === "string") return { baseUrl: apiUrl(entry, source), apiKeyEnv: fallbackKey };
   if (
      typeof entry === "object" &&
      entry !== null &&
      "url" in entry &&
      typeof entry.url === "string"
   ) {
      const keyEnv =
         "apiKeyEnv" in entry && typeof entry.apiKeyEnv === "string" ? entry.apiKeyEnv : undefined;
      return { baseUrl: apiUrl(entry.url, source), apiKeyEnv: keyEnv ?? fallbackKey };
   }
   throw new Error(`${LOG_TAG}: ${source} must be a URL or { url, apiKeyEnv }`);
}

/** The config file as a mapping; an absent file is empty, a malformed one throws. */
function readConfig(path: string): Record<string, unknown> {
   let text: string;
   try {
      text = readFileSync(path, "utf8");
   } catch {
      return {};
   }
   const parsed: unknown = Bun.YAML.parse(text);
   if (parsed === null || parsed === undefined) return {};
   if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${LOG_TAG}: ${path} must be a mapping`);
   }
   return parsed as Record<string, unknown>;
}

/** Candidates, strongest first: LLAMA_SWAP_BASE_URL, else the file's `servers`, else loopback. */
function settings(): { servers: Server[]; defaultContext: number | undefined } {
   const path = process.env["LLAMA_SWAP_CONFIG"]?.trim() || CONFIG_PATH;
   const config = readConfig(path);
   const defaultContext =
      positiveInt(Number(process.env["LLAMA_SWAP_DEFAULT_CONTEXT"])) ??
      positiveInt(config["defaultContext"]);

   const pinned = process.env["LLAMA_SWAP_BASE_URL"]?.trim();
   if (pinned) return { servers: [toServer(pinned, "LLAMA_SWAP_BASE_URL")], defaultContext };

   const listed = config["servers"] ?? [];
   if (!Array.isArray(listed)) throw new Error(`${LOG_TAG}: ${path}: servers must be a list`);
   const servers = listed.map((entry, index) => toServer(entry, `${path}: servers[${index}]`));
   return {
      servers: servers.length > 0 ? servers : [toServer(LOOPBACK_URL, "loopback")],
      defaultContext,
   };
}

function requestHeaders(apiKey: string | undefined): Record<string, string> {
   return { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

async function answers(server: Server): Promise<boolean> {
   try {
      const response = await fetch(`${server.baseUrl}/models`, {
         headers: requestHeaders(process.env[server.apiKeyEnv]),
         signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return response.ok;
   } catch {
      return false;
   }
}

/** The first candidate in list order that answers; when none does, the first, so omp keeps its cached catalog. */
async function chooseServer(logger: ExtensionAPI["logger"], servers: Server[]): Promise<Server> {
   const first = servers[0];
   if (!first) throw new Error(`${LOG_TAG}: no server configured`);
   if (servers.length === 1) return first;
   const results = await Promise.all(servers.map(answers));
   const chosen = servers[results.indexOf(true)];
   if (chosen) return chosen;
   logger.warn(
      `${LOG_TAG} no server answered (${servers.map((s) => s.baseUrl).join(", ")}); using ${first.baseUrl}`,
   );
   return first;
}

function isStringArray(value: unknown): value is string[] {
   return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function onlyEfforts(value: unknown): CatalogEffort[] {
   if (!isStringArray(value)) return [];
   return value.filter((item): item is CatalogEffort => EFFORT_NAMES.includes(item));
}

function effortMap(value: unknown): Record<string, string> {
   if (typeof value !== "object" || value === null) return DEFAULT_EFFORT_MAP;
   const entries: [string, string][] = [];
   for (const [level, target] of Object.entries(value)) {
      if (typeof target === "string") entries.push([level, target]);
   }
   return entries.length > 0 ? Object.fromEntries(entries) : DEFAULT_EFFORT_MAP;
}

function positiveInt(value: unknown): number | undefined {
   return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function modalities(value: unknown): ("text" | "image")[] {
   if (!isStringArray(value)) return ["text"];
   const allowed = value.filter(
      (item): item is "text" | "image" => item === "text" || item === "image",
   );
   return allowed.length > 0 ? allowed : ["text"];
}

/** Model config from one published entry, or undefined when it cannot be described safely. */
function toModel(
   entry: PublishedModel,
   defaultContext: number | undefined,
): ProviderModelConfig | undefined {
   const id = typeof entry.id === "string" ? entry.id : undefined;
   const meta = entry.meta?.llamaswap ?? entry.metadata;
   if (!id) return undefined;
   const contextWindow = positiveInt(meta?.context) ?? defaultContext;
   if (!contextWindow) return undefined;

   const efforts = onlyEfforts(meta?.efforts);
   const topEffort = efforts.at(-1);
   const preferred = onlyEfforts(typeof meta?.effort === "string" ? [meta.effort] : []).at(-1);
   // -instant is the registry's thinking-off alias: llama-swap turns thinking off for it, so omp
   // must not offer or send a level.
   const thinkingOff = id.endsWith("-instant");
   const reasoning = topEffort !== undefined && !thinkingOff;
   const format = THINKING_FORMATS.find((name) => name === meta?.thinkingFormat);

   return {
      id,
      name: typeof entry.name === "string" && entry.name ? entry.name : id,
      reasoning,
      ...(reasoning && topEffort
         ? {
              thinking: {
                 mode: "effort" as const,
                 efforts,
                 defaultLevel: preferred ?? topEffort,
                 requiresEffort: false,
              },
           }
         : {}),
      input: modalities(meta?.input),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: positiveInt(meta?.output) ?? contextWindow,
      compat: {
         ...ENGINE_COMPAT,
         reasoningEffortMap: effortMap(meta?.reasoningEffortMap),
         ...(format ? { thinkingFormat: format } : {}),
         ...(meta?.supportsDeveloperRole === false ? { supportsDeveloperRole: false } : {}),
         ...(meta?.qwenTemplateReasoningEffort === true
            ? { qwenTemplateReasoningEffort: true }
            : {}),
      },
   };
}

async function fetchModels(
   logger: ExtensionAPI["logger"],
   base: string,
   apiKey: string | undefined,
   defaultContext: number | undefined,
) {
   const response = await fetch(`${base}/models`, {
      headers: requestHeaders(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
   });
   if (!response.ok) throw new Error(`GET ${base}/models answered ${response.status}`);
   const body = (await response.json()) as { data?: unknown };
   if (!Array.isArray(body.data)) throw new Error(`GET ${base}/models returned no data array`);

   const models: ProviderModelConfig[] = [];
   for (const entry of body.data as PublishedModel[]) {
      const model = toModel(entry, defaultContext);
      if (model) models.push(model);
      else {
         logger.warn(
            `${LOG_TAG} skipped ${String(entry.id)}: no metadata.context (set defaultContext to keep such models)`,
         );
      }
   }
   return models;
}

export default async function localInference(pi: ExtensionAPI): Promise<void> {
   const { servers, defaultContext } = settings();
   const server = await chooseServer(pi.logger, servers);
   pi.registerProvider(PROVIDER, {
      baseUrl: server.baseUrl,
      apiKey: server.apiKeyEnv,
      authHeader: true,
      api: "openai-completions",
      // A failed fetch is left to throw: llama-swap being down then keeps the cached catalog
      // instead of replacing it with an empty one, and omp still starts.
      fetchDynamicModels: (apiKey) =>
         fetchModels(pi.logger, server.baseUrl, apiKey, defaultContext),
   });
}
