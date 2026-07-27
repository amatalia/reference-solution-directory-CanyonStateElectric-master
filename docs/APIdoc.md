# API Documentation

This document summarizes the external APIs represented in the current codebase and how they fit into the RFI triage workflow.

## Procore RFI Intake

The Azure Function in `src/functions/RFIIngestion.ts` represents the webhook intake boundary for Procore RFI events.

### Current Payload Fields

```ts
interface ProcoreRfiDetail {
  id: number;
  subject: string;
  status: string;
  drawing_ids: number[];
  drawing_number?: string;
  questions: Array<{
    id: number;
    plain_text_body: string;
    created_by: string;
  }>;
  cost_code?: {
    id: number;
    name: string;
  };
  schedule_impact?: {
    status: string;
    value: number;
  };
}
```

### Role In The Architecture

The Procore webhook tells the system that a new RFI exists and provides the first set of triage signals:

- RFI ID
- project/drawing references
- question text
- status
- cost code
- schedule impact

The ingestion function does not perform vendor-specific enrichment directly. It validates the event, returns `202 Accepted`, and queues a normalized message for `RFIEnrichmentWorker`.

### Queue Message

```ts
interface RfiEnrichmentQueueMessage {
  rfiId: number;
  drawingIds: number[];
  drawingNumber?: string;
  receivedAt: string;
  payload: ProcoreRfiDetail;
}
```

## Autodesk Platform Services Model Derivative

The Autodesk integration lives in `src/services/autodeskService.ts` and uses:

```text
@aps_sdk/model-derivative
```

The service wraps the SDK so the rest of the app does not depend directly on Autodesk payload shapes.

### Operations Used

| Service Method | SDK Method | REST Concept | Purpose |
| --- | --- | --- | --- |
| `submitTranslationJob` | `startJob` | `POST /job` | Submit SVF2 and thumbnail translation jobs. |
| `specifyReferences` | `specifyReferences` | `POST /{urn}/references` | Register linked source-design dependencies. |
| `getManifest` | `getManifest` | `GET /{urn}/manifest` | Check translation status and derivative inventory. |
| `listModelViews` | `getModelViews` | `GET /{urn}/metadata` | List available 2D sheets and 3D views. |
| `getObjectTree` | `getObjectTree` | `GET /{urn}/metadata/{modelGuid}` | Fetch object hierarchy for a model view. |
| `getAllProperties` | `getAllProperties` | `GET /{urn}/metadata/{modelGuid}/properties` | Fetch all model properties for a view. |
| `fetchSpecificProperties` | `fetchSpecificProperties` | `POST /{urn}/metadata/{modelGuid}/properties:query` | Fetch selected object/property metadata. |
| `getThumbnail` | `getThumbnail` | `GET /{urn}/thumbnail` | Fetch translated model thumbnail. |

### Translation Flow

```text
sourceUrn
  -> submitTranslationJob
  -> getManifest until status is success/progress is complete
  -> listModelViews
  -> getObjectTree or fetchSpecificProperties
```

### Webhook Events

The codebase includes `src/functions/AutodeskDerivativeWebhook.ts` as the callback endpoint for Model Derivative webhooks.

Planned events:

| Event | Meaning |
| --- | --- |
| `derivative.extraction.updated` | Translation is in progress. |
| `derivative.extraction.finished` | Translation completed and metadata can be queried. |

The current endpoint acknowledges callbacks and logs the event/URN. The next step is correlating the callback URN to queued RFI enrichment work.

### Identifier Notes

Autodesk metadata includes both `objectid` and `externalId`.

- `objectid` is useful for a translated view/session but should not be treated as stable across model versions.
- `externalId` is more appropriate for persisted references because it maps closer to the source model object identity.

## Mapping Gap

Procore drawing references do not equal Autodesk model identifiers.

The production system needs a mapping layer:

```text
Procore drawing_ids / drawing_number
  -> Autodesk sourceUrn
  -> Autodesk modelViewGuid
```

That mapping can be implemented using a database, Autodesk Construction Cloud metadata, Bluebeam sheet metadata, or another project-specific source.

## References

- Autodesk Model Derivative API overview: https://aps.autodesk.com/en/docs/model-derivative/v2/developers_guide/overview/
- Autodesk Model Derivative TypeScript SDK: https://aps.autodesk.com/en/docs/model-derivative/v2/reference/typescript-sdk/
- APS SDK source: https://github.com/autodesk-platform-services/aps-sdk-node
