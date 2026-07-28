# CLAUDE.md

Azure Functions (TypeScript, v4 programming model) reference solution: ingests Procore RFI
webhooks and enriches them with Autodesk Platform Services Model Derivative context.

This repo is a **reference pattern**, not a production service. Its value is the shape —
thin webhook intake, vendor SDKs behind service boundaries, heavily commented contracts.
Preserve that when changing things.

## Commands

```bash
npm install
npm run build      # tsc -> dist/
npm run watch      # tsc -w
npm start          # prestart cleans + builds, then `func start`
npm test           # placeholder, no tests exist yet
```

Local runs need **Azurite** (queue + table) because `AzureWebJobsStorage` is
`UseDevelopmentStorage=true`. Start it before `npm start` or the ingestion function throws on
`RfiWorkflowStateService` construction.

Copy `local.settings.example.json` -> `local.settings.json` (gitignored) before first run.

## Architecture

```
Procore webhook (thin envelope: resource_name/event_type/resource_id/project_id)
  -> RFIIngestion.ts        HTTP POST, authLevel 'function'.
       -> procoreService     Show RFI call to hydrate the envelope into a full ProcoreRfiDetail
                              (skipped if the body already looks like a full detail, e.g. mock-rfi.json)
                             Validates, writes state, enqueues.
                             Never calls Autodesk directly — this is the whole point.
  -> storage queue          RFI_ENRICHMENT_QUEUE_NAME (default 'rfi-enrichment-queue')
  -> RFIEnrichmentWorker.ts Queue trigger. Owns the slow Autodesk work + retry semantics.
       -> rfiAutodeskMappingService   Procore drawing refs -> Autodesk sourceUrn / modelViewGuid
       -> autodeskService             APS Model Derivative SDK boundary
       -> rfiWorkflowStateService     Azure Table Storage state snapshots

AutodeskDerivativeWebhook.ts  APS callback (extraction.finished / extraction.updated).
                              Currently logs + 202s; does not yet resume queued work.
```

`src/index.ts` only calls `app.setup({ enableHttpStream: true })`. Functions self-register via
`app.http(...)` / `app.storageQueue(...)` at module load; `package.json` `main` globs
`dist/src/{index.js,functions/*.js}`, so **a new function file under `src/functions/` is picked
up automatically** — no registration list to update.

## Conventions

- **Vendor SDKs stay in `src/services/`.** Function files must not import
  `ModelDerivativeClient` or `@azure/data-tables` directly.
- **State transitions go through `src/types/states.ts`** (`createInitialState` / `setState`).
  `setState` is immutable — it returns a new entity and appends to `state.history`. Never mutate
  `state.status` by hand.
- Status values are a closed union (`WorkflowStateStatus`): `received`, `queued`,
  `mapping_resolved`, `mapping_missing`, `autodesk_deferred`, `autodesk_translation_pending`,
  `autodesk_enriched`, `ready_for_review`, `failed`. Add to the union, don't stringly-type.
- **Persist `externalId`, not `objectid`/`dbid`.** Autodesk object IDs are per-translation and
  unstable across model versions.
- The long doc comments and `Example ... for future mocks/tests` blocks in `autodeskService.ts`
  are intentional onboarding material. Don't strip them as "dead comments".
- New docs go in `docs/` and get linked from `README.md`.

## Config

All via env / `local.settings.json` Values:

| Var | Notes |
|---|---|
| `AzureWebJobsStorage` | queue + table connection; required |
| `RFI_ENRICHMENT_QUEUE_NAME` | defaults to `rfi-enrichment-queue` |
| `RFI_WORKFLOW_STATE_TABLE_NAME` | defaults to `RfiWorkflowState` |
| `AUTODESK_ACCESS_TOKEN` | takes priority over client credentials |
| `AUTODESK_CLIENT_ID` / `AUTODESK_CLIENT_SECRET` | client-credentials fallback |
| `AUTODESK_RFI_DRAWING_MAP` | JSON string: `{"A101":{"sourceUrn":"...","modelViewGuid":"..."}}` |
| `PROCORE_API_BASE_URL` | defaults to `https://api.procore.com`; use `https://sandbox.procore.com` for testing |
| `PROCORE_ACCESS_TOKEN` | takes priority over client credentials |
| `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET` | client-credentials fallback (`POST /oauth/token`) |
| `PROCORE_COMPANY_ID` | required for `Procore-Company-Id` header if the webhook envelope omits `company_id` |

Without APS credentials the worker resolves mapping, records `autodesk_deferred`, and returns
cleanly. That is the expected no-credentials path, not a bug.

Without Procore credentials, `RFIIngestion.ts` still works for full-detail bodies (`mock-rfi.json`)
but throws (500, with the real error message) if it receives a real webhook envelope
(`mock-rfi-webhook-envelope.json`), since hydrating requires `Show RFI`.

## Known rough edges

Flag these rather than silently working around them:

- `AUTODESK_RFI_DRAWING_MAP` is parsed in **two** places — `rfiAutodeskMappingService` and
  `autodeskService.resolveDrawingReferenceMapping`. The worker path only uses the former; the
  latter is a leftover from before the mapping service was split out.
- `autodeskService.requireAccessToken()` is unused, and `config` from `dotenv` is imported but
  never invoked.
- `getAutodeskContextForRfi` still logs the `[AutodeskMock]` prefix, but it now makes real SDK
  calls.
- `tsconfig.json` has `strict: false`, so the compiler will not catch null/undefined mistakes.
  Be conservative with optional fields.
- No test harness exists. `mock-rfi.json` (full-detail body) and `mock-rfi-webhook-envelope.json`
  (real thin envelope, requires Procore credentials) are the manual fixtures for POSTing at the
  ingestion endpoint.
- `RFIIngestion.ts` detects the real thin webhook envelope shape (`resource_name`/`event_type`/
  `resource_id`) vs. a full-detail body via `isWebhookEnvelope()` and calls `procoreService.getRfi`
  (`Show RFI`) to hydrate the envelope. Non-RFI `resource_name` values are acknowledged and
  ignored. There is no `differences`/replay handling, and the caller-supplied
  `company_id` on the envelope is trusted as-is (no verification against `PROCORE_COMPANY_ID`) —
  fine for a reference repo, worth hardening before production use.
