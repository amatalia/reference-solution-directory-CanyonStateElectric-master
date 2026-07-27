import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";
import { RfiWorkflowStateService } from "../services/rfiWorkflowStateService";
import type { ProcoreRfiDetail, RfiEnrichmentQueueMessage } from "../types/rfi";
import { createInitialState, setState } from "../types/states";

const rfiEnrichmentQueue = output.storageQueue({
    queueName: process.env.RFI_ENRICHMENT_QUEUE_NAME ?? 'rfi-enrichment-queue',
    connection: 'AzureWebJobsStorage'
});

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
        const payload = (await request.json()) as ProcoreRfiDetail;

        const { id, project_id, subject, status, drawing_ids, drawing_number } = payload;

        context.log(`Received RFI Payload: ${JSON.stringify(payload)}`);

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
            body: 'Internal Server Error'
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
