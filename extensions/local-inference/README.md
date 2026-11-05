# local-inference

Registers one llama-swap server as the omp provider `local-inference`. The model list is read
from the server: every model and alias it publishes. Where an entry has `metadata` (context
window, output limit, reasoning levels, thinking format, modalities) it is used as given. Adding a
model on the server side is enough; there is nothing to configure per model here.

## Choosing the server

`~/.omp/agent/local-inference.yml` lists candidate servers in order. At startup every candidate is
probed at once (3 s at most) and the first, in list order, that answers `GET /v1/models` is used.
One file therefore works on every machine and network: the server's own host answers on loopback,
and other machines fall through to the next entry. With no file, loopback is the only candidate.

```yaml
servers:
  - http://127.0.0.1:9000                 # llama-swap on this machine
  - url: https://models.example.com       # anywhere else
    apiKeyEnv: AI_API_KEY                 # variable holding the Bearer key
defaultContext: 32768                     # optional: keeps entries without metadata.context
```

An entry is a server root (completed to `/v1`) or an explicit `/v1` path. `apiKeyEnv` defaults to
`LLAMA_SWAP_API_KEY` when that is set, else `AI_API_KEY`. When no candidate answers, the first is
kept and the last fetched catalog stays in use.

## Environment overrides

| Variable | Effect |
| --- | --- |
| `LLAMA_SWAP_BASE_URL` | use this one server; the file's list and probing are skipped |
| `LLAMA_SWAP_API_KEY` | the default key variable for entries without `apiKeyEnv` |
| `LLAMA_SWAP_DEFAULT_CONTEXT` | overrides `defaultContext` |
| `LLAMA_SWAP_CONFIG` | read another file instead of `~/.omp/agent/local-inference.yml` |

## Checking it

```bash
omp models local-inference          # the catalog the extension built
omp -p --model local-inference/<id> "hello"
```

With the server down, omp still starts: the last fetched catalog comes from omp's model cache and
the failure is logged. Models without a context window are skipped and named in the log, since a
missing limit breaks compaction planning quietly.

## Metadata keys

Per model in the llama-swap config: `context`, `output`, `efforts`, `effort`, `input`,
`thinkingFormat`, `qwenTemplateReasoningEffort`, `reasoningEffortMap`, `supportsDeveloperRole`.
An id ending in `-instant` is treated as thinking-off and offers no reasoning level. Change the
config and reload llama-swap; omp picks it up when the catalog refreshes.
