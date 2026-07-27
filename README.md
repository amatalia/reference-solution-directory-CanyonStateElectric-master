# CSE Reference Solution Directory

> Azure Functions boilerplate for ingesting Procore RFI events and enriching them with Autodesk Platform Services Model Derivative context. The goal is to establish a reusable project pattern for construction workflow integrations: keep webhook ingestion thin, isolate vendor SDKs behind service boundaries, and document the architecture clearly enough for future projects to extend.

![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)
![Azure Functions](https://img.shields.io/badge/Azure%20Functions-v4-0062AD?logo=azurefunctions&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Autodesk APS](https://img.shields.io/badge/Autodesk%20APS-Model%20Derivative-0696D7)
![Procore](https://img.shields.io/badge/Procore-RFI%20Intake-F47B20)

![Canyon State Electric](assets/logo.png)

## Current Scope

- Accept a Procore-style RFI payload through an Azure HTTP-triggered function.
- Validate the core RFI fields needed by the triage workflow.
- Queue Autodesk enrichment work so webhook intake stays fast.
- Provide an Autodesk Model Derivative service boundary backed by the official TypeScript SDK.
- Translate source models to SVF2 and thumbnails.
- Read manifests, model views, object trees, and model properties.
- Preserve mock/example payloads in comments for local testing and future onboarding.

## Repository Map

```text
src/
  functions/
    RFIIngestion.ts          Procore RFI webhook entry point
    RFIEnrichmentWorker.ts   Queue worker for Autodesk enrichment
    AutodeskDerivativeWebhook.ts APS Model Derivative webhook callback endpoint
  services/
    autodeskService.ts       Autodesk Model Derivative SDK boundary
    rfiAutodeskMappingService.ts Maps RFI drawing references to Autodesk identifiers
    rfiWorkflowStateService.ts Persists RFI workflow state in Azure Table Storage
  types/
    rfi.ts                   Shared RFI payload and queue-message contracts
    states.ts                Reusable workflow state contracts and helpers
docs/
  APIdoc.md                  Procore and Autodesk API notes
  architectureDeepDive.md    Architecture walkthrough for the RFI triage design
assets/
  logo.png                   CSE logo used by this README
  image.png                  Architecture diagram
```

## Documentation

- [API Documentation](docs/APIdoc.md)
- [Architecture Deep Dive](docs/architectureDeepDive.md)

Future documentation can be added under `docs/` and linked here as the system grows.

## Local Development

Install dependencies:

```bash
npm install
```

Build TypeScript:

```bash
npm run build
```

Start Azure Functions locally:

```bash
npm start
```

## Configuration

The Autodesk service currently expects an APS access token through either:

```text
AUTODESK_ACCESS_TOKEN
```

or APS client credentials:

```text
AUTODESK_CLIENT_ID
AUTODESK_CLIENT_SECRET
```

For local setup, copy the shape from:

```text
local.settings.example.json
```

Key settings:

```text
AzureWebJobsStorage
FUNCTIONS_WORKER_RUNTIME
RFI_ENRICHMENT_QUEUE_NAME
RFI_WORKFLOW_STATE_TABLE_NAME
AUTODESK_CLIENT_ID
AUTODESK_CLIENT_SECRET
AUTODESK_ACCESS_TOKEN
AUTODESK_RFI_DRAWING_MAP
```

You can also pass a token directly into:

```ts
new AutodeskModelDerivativeService(accessToken)
```

`AUTODESK_RFI_DRAWING_MAP` maps Procore drawing references to Autodesk source/model view identifiers:

```json
{
  "A101": {
    "sourceUrn": "URL_SAFE_URN_OF_SOURCE_MODEL",
    "modelViewGuid": "MODEL_VIEW_OR_SHEET_GUID"
  }
}
```

## Integration Boundary

`RFIIngestion.ts` remains a webhook intake boundary. It validates and queues RFI context, but does not call Autodesk endpoints directly.

`RFIEnrichmentWorker.ts` owns the asynchronous Autodesk enrichment call. This is the scalable path for retries, queue depth autoscaling, and future orchestration.

`AutodeskDerivativeWebhook.ts` is the callback entry point for APS Model Derivative events such as `extraction.finished` and `extraction.updated`.

`autodeskService.ts` owns Autodesk-specific concepts:

- source URNs
- translation jobs
- manifests
- model views
- object trees
- object properties
- thumbnails

`rfiAutodeskMappingService.ts` owns the current mapping step:

```text
Procore drawing_ids / drawing_number -> Autodesk sourceUrn / modelViewGuid
```

Today this can be driven by `AUTODESK_RFI_DRAWING_MAP`. Later the same service boundary can be backed by SQL, Cosmos DB, Autodesk Construction Cloud, Bluebeam metadata, or another project-specific system of record.

`rfiWorkflowStateService.ts` persists workflow state snapshots to Azure Table Storage using `AzureWebJobsStorage`. This gives the sample a durable record of where each RFI is in the pipeline, such as `queued`, `mapping_missing`, `autodesk_deferred`, or `autodesk_enriched`.
