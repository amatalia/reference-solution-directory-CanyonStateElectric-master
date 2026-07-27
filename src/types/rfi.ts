import type { State } from "./states";

/**
 * Minimal Procore RFI payload shape used by the ingestion endpoint.
 *
 * This interface intentionally captures only the fields our Azure Functions
 * need to validate and forward the event into the downstream triage workflow.
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
