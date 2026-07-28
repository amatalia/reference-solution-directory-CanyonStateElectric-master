import type { State } from "./states";

/**
 * Procore RFI payload shape used by the ingestion endpoint.
 *
 * Modeled against the real "rfis" resource in Procore's REST API
 * (`Project Management > RFI > rfis`, see `Show RFI` / `Create RFI` in
 * combined_OAS_postman.json) rather than a hand-picked subset, so this type
 * is a faithful contract reference even though the current triage/mapping
 * workflow only reads a handful of these fields (id, subject, status,
 * drawing_ids, drawing_number, questions, cost_code, schedule_impact).
 */
export interface ProcoreRfiDetail {
    id: number;
    project_id?: number;
    subject: string;
    status: string;
    drawing_ids: number[];
    /** Optional drawing number included when available. */
    drawing_number?: string;

    /** Questions attached to the RFI. */
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

    /** Display number/reference shown on the RFI (distinct from `id`). */
    number?: string;
    /** Free-text reference field. */
    reference?: string;
    /** True while the RFI is still a draft, not yet sent. */
    draft?: boolean;
    /** True if the RFI is restricted to private distribution. */
    private?: boolean;
    due_date?: string;
    revision?: string;
    /** Present when this RFI was created from a source/imported RFI header. */
    source_rfi_header_id?: number;

    rfi_manager?: {
        id: number;
        name: string;
    };
    assignees?: Array<{
        id: number;
        name: string;
    }>;
    required_assignees?: Array<{
        id: number;
        name: string;
    }>;
    received_from?: {
        id: number;
        name: string;
    };
    responsible_contractor?: {
        id: number;
        name: string;
    };
    distribution?: Array<{
        id: number;
        name: string;
    }>;
    project_stage?: {
        id: number;
        name: string;
    };
    location?: {
        id: number;
        name: string;
    };
    specification_section?: {
        id: number;
        name: string;
    };
    cost_impact?: {
        status: string;
        value: number;
    };

    /** Ad hoc custom fields configured per company/project (custom_textfield_1, custom_field_{definition_id}, ...). */
    custom_fields?: Record<string, string>;
}

/**
 * Thin event envelope Procore actually POSTs to a webhook `destination_url`.
 *
 * See `Platform - Developer Tools > Webhooks` in combined_OAS_postman.json.
 * This does not carry RFI field data — `RFIIngestion` uses `resource_id` /
 * `project_id` to call the real `Show RFI` endpoint (`ProcoreApiService.getRfi`)
 * and hydrate a full `ProcoreRfiDetail` before queueing enrichment.
 */
export interface ProcoreRfiWebhookEnvelope {
    resource_name: string;
    event_type: string;
    resource_id: number;
    project_id?: number;
    company_id?: number;
    timestamp?: string;
}

/**
 * Queue contract passed from RFI intake to the enrichment worker.
 */
export interface RfiEnrichmentQueueMessage {
    rfiId: number;
    projectId?: number;
    drawingIds: number[];
    drawingNumber?: string;
    receivedAt: string;
    state: State;
    payload: ProcoreRfiDetail;
}
