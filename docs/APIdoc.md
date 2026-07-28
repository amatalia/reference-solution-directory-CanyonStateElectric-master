# API Documentation

This document summarizes the external APIs represented in the current codebase and how they fit into the RFI triage workflow.

## Procore RFI Intake

The Azure Function in `src/functions/RFIIngestion.ts` represents the webhook intake boundary for Procore RFI events.

### Current Payload Fields

`ProcoreRfiDetail` (`src/types/rfi.ts`) is modeled against the real `rfis` resource
documented in `combined_OAS_postman.json`
(`Project Management > RFI > rfis > Show RFI` / `Create RFI`), not a hand-picked
subset. Most fields below are carried for contract fidelity; the current
triage/mapping workflow only reads `id`, `subject`, `status`, `drawing_ids`,
`drawing_number`, `questions`, `cost_code`, and `schedule_impact`.

```ts
interface ProcoreRfiDetail {
  id: number;
  project_id?: number;
  subject: string;
  status: string;
  drawing_ids: number[];
  drawing_number?: string;
  questions: Array<{
    id: number;
    plain_text_body: string;
    created_by: string;
  }>;
  cost_code?: { id: number; name: string };
  schedule_impact?: { status: string; value: number };

  // Carried for contract fidelity with the real Procore RFI resource;
  // not yet read by the triage/mapping workflow.
  number?: string;
  reference?: string;
  draft?: boolean;
  private?: boolean;
  due_date?: string;
  revision?: string;
  source_rfi_header_id?: number;
  rfi_manager?: { id: number; name: string };
  assignees?: Array<{ id: number; name: string }>;
  required_assignees?: Array<{ id: number; name: string }>;
  received_from?: { id: number; name: string };
  responsible_contractor?: { id: number; name: string };
  distribution?: Array<{ id: number; name: string }>;
  project_stage?: { id: number; name: string };
  location?: { id: number; name: string };
  specification_section?: { id: number; name: string };
  cost_impact?: { status: string; value: number };
  custom_fields?: Record<string, string>;
}
```

### Real Procore RFI Endpoints

For reference, the REST endpoints backing this resource
(`Project Management > RFI > rfis` in `combined_OAS_postman.json`):

| Endpoint | Method | Path |
| --- | --- | --- |
| List RFIs | GET | `/rest/v1.0/projects/{project_id}/rfis` |
| Show RFI | GET | `/rest/v1.0/projects/{project_id}/rfis/{id}` |
| Create RFI | POST | `/rest/v1.0/projects/{project_id}/rfis` |
| Update RFI | PATCH | `/rest/v1.0/projects/{project_id}/rfis/{id}` |
| Update Advance Ball in Court | PATCH | `/rest/v1.0/projects/{project_id}/rfis/{id}/advance_ball_in_court` |
| Recycle RFI | PATCH | `/rest/v1.0/projects/{project_id}/rfis/{id}/recycle` |
| List RFI Replies | GET | `/rest/v1.0/projects/{project_id}/rfis/{rfi_id}/replies` |
| Create RFI Reply | POST | `/rest/v1.0/projects/{project_id}/rfis/{rfi_id}/replies` |

All require a `Procore-Company-Id` header. `src/services/procoreService.ts`
(`ProcoreApiService.getRfi`) wraps **Show RFI** — the only one of these calls
made by this codebase today, used to hydrate a webhook envelope (below). The
rest are documented for reference only; nothing here calls them.

### Webhooks (Real Procore Behavior)

Procore's webhook system (`Platform - Developer Tools > Webhooks` in
`combined_OAS_postman.json`) is a separate resource hierarchy from the RFI
API itself:

- **Resources** (`GET /rest/v2.0/companies/{company_id}/webhooks/resources`) —
  lists subscribable resource names (e.g. `Rfis`) and their available
  `event_type`s, versioned by a `payload_version` query param.
- **Triggers** (`POST /rest/v2.0/companies/{company_id}/webhooks/hooks/{hook_id}/triggers`)
  — subscribes a hook to a `{ resource_name, event_type }` pair.
- **Hooks** (`POST /rest/v1.0/webhooks/hooks`) — registers a
  `destination_url` (+ optional `destination_headers`) that Procore will POST
  deliveries to.
- **Deliveries** (`GET /rest/v1.0/webhooks/hooks/{hook_id}/deliveries`) — an
  audit log of past delivery attempts, filterable by status
  (`successful` / `failing` / `discarded`).

#### Webhook Delivery Payload: Envelope, Then Hydration

The Postman collection has no response/delivery body examples (all
`response` arrays are empty), but per Procore's webhook model the body
Procore actually POSTs to a hook's `destination_url` is a **thin event
envelope**:

```ts
interface ProcoreRfiWebhookEnvelope {
  resource_name: string;   // e.g. "Rfis"
  event_type: string;      // e.g. "RFI.create"
  resource_id: number;     // the RFI id
  project_id?: number;
  company_id?: number;
  timestamp?: string;
}
```

`RFIIngestion.ts` (`TriggerFunc`) now handles this correctly:

1. `isWebhookEnvelope()` inspects the parsed body. If it looks like the
   envelope (`resource_name`/`event_type`/`resource_id` present, no
   `subject`), it's treated as a real webhook.
2. Non-RFI `resource_name` values are logged and acknowledged with `202`
   without further processing (a hook can be subscribed to more than one
   resource).
3. `ProcoreApiService.getRfi(project_id, resource_id, company_id)` calls the
   real `Show RFI` endpoint to hydrate a full `ProcoreRfiDetail`.
4. From there, the flow is unchanged: validate required fields, build the
   `RfiEnrichmentQueueMessage`, save state, enqueue for
   `RFIEnrichmentWorker`.

If the body does *not* look like an envelope (no `resource_name`/
`event_type`/`resource_id`, or it has `subject`), it's treated as an
already-hydrated `ProcoreRfiDetail` directly — this is what
`mock-rfi.json` exercises, so local testing doesn't require Procore
credentials. `mock-rfi-webhook-envelope.json` is the fixture for the real
envelope path (requires `PROCORE_CLIENT_ID`/`PROCORE_CLIENT_SECRET` or
`PROCORE_ACCESS_TOKEN`, plus `PROCORE_COMPANY_ID` or an envelope with
`company_id` set).

Auth follows the same token-priority pattern as `autodeskService.ts`:
constructor-supplied token → `PROCORE_ACCESS_TOKEN` → client-credentials
grant (`POST /oauth/token`, `grant_type: client_credentials`) using
`PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET`. See
`Platform - Developer Tools > Authentication > Get or Refresh an Access
Token` in `combined_OAS_postman.json`.

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

- Procore REST API documentation (RFI + Webhooks endpoints used above): `combined_OAS_postman.json` (repo root)
- Autodesk Model Derivative API overview: https://aps.autodesk.com/en/docs/model-derivative/v2/developers_guide/overview/
- Autodesk Model Derivative TypeScript SDK: https://aps.autodesk.com/en/docs/model-derivative/v2/reference/typescript-sdk/
- APS SDK source: https://github.com/autodesk-platform-services/aps-sdk-node
