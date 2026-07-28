import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";
import { ProcoreApiService } from "../services/procoreService";
import { RfiWorkflowStateService } from "../services/rfiWorkflowStateService";
import type { ProcoreRfiDetail, ProcoreRfiWebhookEnvelope, RfiEnrichmentQueueMessage } from "../types/rfi";
import { createInitialState, setState } from "../types/states";

const rfiEnrichmentQueue = output.storageQueue({
    queueName: process.env.RFI_ENRICHMENT_QUEUE_NAME ?? 'rfi-enrichment-queue',
    connection: 'AzureWebJobsStorage'
});

/**
 * True when the request body is Procore's real thin webhook envelope
 * (resource_name/event_type/resource_id) rather than a full RFI detail body.
 *
 * A real Procore webhook always sends the envelope shape. The full-detail
 * shape is kept for `mock-rfi.json`-style local testing without Procore
 * credentials, per CLAUDE.md's documented "Known rough edges".
 */
function isWebhookEnvelope(body: unknown): body is ProcoreRfiWebhookEnvelope {
    return (
        typeof body === 'object' &&
        body !== null &&
        'resource_name' in body &&
        'event_type' in body &&
        'resource_id' in body &&
        !('subject' in body)
    );
}

/**
 * HTTP entry point for Procore RFI webhook ingestion.
 *
 * The function validates the incoming RFI payload and acknowledges receipt.
 * Autodesk enrichment is queued for an async worker so the Procore webhook
 * response is not blocked by APS token generation, translation status checks,
 * metadata queries, or downstream retries.
 */
export async function TriggerFunc(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {

    try {
        const body = (await request.json()) as ProcoreRfiWebhookEnvelope | ProcoreRfiDetail;

        let payload: ProcoreRfiDetail;

        if (isWebhookEnvelope(body)) {
            context.log(`Received Procore webhook envelope: ${JSON.stringify(body)}`);

            if (!body.resource_name.toLowerCase().includes('rfi')) {
                context.log(`Ignoring webhook for non-RFI resource: ${body.resource_name}`);
                return {
                    status: 202,
                    jsonBody: {
                        message: `Ignored webhook for resource_name "${body.resource_name}"`
                    }
                };
            }

            if (!body.project_id) {
                context.log('Webhook envelope is missing project_id, required to hydrate the RFI');
                return {
                    status: 400,
                    body: 'Webhook envelope is missing project_id'
                };
            }

            context.log(`Hydrating RFI ${body.resource_id} (project ${body.project_id}) via Procore Show RFI`);

            payload = await new ProcoreApiService().getRfi(body.project_id, body.resource_id, body.company_id);
        } else {
            payload = body as ProcoreRfiDetail;
            context.log(`Received RFI Payload: ${JSON.stringify(payload)}`);
        }

        const { id, project_id, subject, status, drawing_ids, drawing_number } = payload;

        if (!id || !subject || !status || !drawing_ids) {
            context.log('Missing required fields in the payload');
            return {
                status: 400,
                body: 'Missing required fields in the payload'
            };
        }

        context.log(`Processing RFI ID: ${id} | Subject: "${subject}" | Status: ${status} | Drawings: [${drawing_ids.join(', ')}]`);

        const initialQueueMessage: RfiEnrichmentQueueMessage = {
            rfiId: id,
            projectId: project_id,
            drawingIds: drawing_ids,
            drawingNumber: drawing_number,
            receivedAt: new Date().toISOString(),
            state: createInitialState("received", {
                source: "procore",
                functionName: "RFIIngestion"
            }),
            payload
        };
        const queueMessage = setState(
            initialQueueMessage,
            "queued",
            "RFI accepted and queued for enrichment",
            {
                queueName: process.env.RFI_ENRICHMENT_QUEUE_NAME ?? 'rfi-enrichment-queue'
            }
        );

        await new RfiWorkflowStateService().saveState({
            rfiId: queueMessage.rfiId,
            state: queueMessage.state
        });

        context.extraOutputs.set(rfiEnrichmentQueue, queueMessage);

        return {
            status: 202,
            jsonBody: {
                message: 'RFI accepted for enrichment',
                nextStep: "Queued for Autodesk Model Derivative enrichment.",
                receivedData: payload,
                queueName: process.env.RFI_ENRICHMENT_QUEUE_NAME ?? 'rfi-enrichment-queue'
            }
        };

    } catch (error) {
        context.log(`Error processing RFI: ${error}`);
        return {
            status: 500,
            body: `Internal Server Error: ${error instanceof Error ? error.message : error}`
        };
    }


};

/**
 * Registers the POST-only Azure Function used by the RFI event intake flow.
 */
app.http('TriggerFunc', {
    methods: ['POST'],
    authLevel: 'function',
    extraOutputs: [rfiEnrichmentQueue],
    handler: TriggerFunc
});
