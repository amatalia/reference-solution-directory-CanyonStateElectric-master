import { app, InvocationContext } from "@azure/functions";
import { AutodeskModelDerivativeService } from "../services/autodeskService";
import { RfiAutodeskMappingService } from "../services/rfiAutodeskMappingService";
import { RfiWorkflowStateService } from "../services/rfiWorkflowStateService";
import type { RfiEnrichmentQueueMessage } from "../types/rfi";
import { setState } from "../types/states";

/**
 * Queue worker that enriches accepted RFIs with Autodesk Model Derivative data.
 *
 * The HTTP ingestion function only validates and enqueues work. This worker owns
 * the slower Autodesk calls so webhook intake stays fast and retries can happen
 * through Azure Queue Storage semantics.
 */
export async function RFIEnrichmentWorker(
    message: RfiEnrichmentQueueMessage,
    context: InvocationContext
): Promise<void> {
    context.log(`Starting Autodesk enrichment for RFI ${message.rfiId}`);

    const workflowStateService = new RfiWorkflowStateService();
    const mappingService = new RfiAutodeskMappingService();
    const mappingResult = mappingService.resolveMapping({
        rfiId: message.rfiId,
        drawingIds: message.drawingIds,
        drawingNumber: message.drawingNumber
    });

    if (!mappingResult.mapping) {
        const updatedMessage = setState(
            message,
            "mapping_missing",
            "No Autodesk source URN/model view mapping found for this RFI",
            {
                drawingNumber: message.drawingNumber,
                drawingIds: message.drawingIds
            }
        );

        await workflowStateService.saveState({
            rfiId: updatedMessage.rfiId,
            state: updatedMessage.state
        });

        context.log(`No Autodesk mapping found for RFI ${message.rfiId}. Enrichment deferred.`);
        context.log(`Updated state: ${JSON.stringify(updatedMessage.state)}`);
        context.log(`Mapping result: ${JSON.stringify(mappingResult)}`);
        return;
    }

    const mappedMessage = setState(
        message,
        "mapping_resolved",
        "Autodesk drawing reference mapping resolved",
        {
            matchedBy: mappingResult.matchedBy,
            sourceUrn: mappingResult.mapping.sourceUrn,
            modelViewGuid: mappingResult.mapping.modelViewGuid
        }
    );

    await workflowStateService.saveState({
        rfiId: mappedMessage.rfiId,
        state: mappedMessage.state,
        sourceUrn: mappingResult.mapping.sourceUrn,
        modelViewGuid: mappingResult.mapping.modelViewGuid
    });

    if (!hasAutodeskCredentials()) {
        const deferredMessage = setState(
            mappedMessage,
            "autodesk_deferred",
            "Autodesk credentials are not configured",
            {
                sourceUrn: mappingResult.mapping.sourceUrn,
                modelViewGuid: mappingResult.mapping.modelViewGuid
            }
        );

        await workflowStateService.saveState({
            rfiId: deferredMessage.rfiId,
            state: deferredMessage.state,
            sourceUrn: mappingResult.mapping.sourceUrn,
            modelViewGuid: mappingResult.mapping.modelViewGuid
        });

        context.log(`Autodesk mapping resolved for RFI ${message.rfiId}, but APS credentials are not configured.`);
        context.log(`Updated state: ${JSON.stringify(deferredMessage.state)}`);
        context.log(`Autodesk API call skipped. Mapping result: ${JSON.stringify(mappingResult)}`);
        return;
    }

    const autodeskService = new AutodeskModelDerivativeService();
    const autodeskContext = await autodeskService.getAutodeskContextForRfi({
        rfiId: message.rfiId,
        drawingIds: message.drawingIds,
        drawingNumber: message.drawingNumber,
        sourceUrn: mappingResult.mapping.sourceUrn,
        modelViewGuid: mappingResult.mapping.modelViewGuid
    });

    context.log(`Autodesk enrichment completed for RFI ${message.rfiId}: ${JSON.stringify(autodeskContext)}`);
    const enrichedMessage = setState(
        mappedMessage,
        "autodesk_enriched",
        "Autodesk Model Derivative context retrieved",
        {
            sourceUrn: autodeskContext.sourceUrn,
            modelViewGuid: autodeskContext.modelViewGuid,
            manifestStatus: autodeskContext.manifestStatus,
            matchedObjectCount: autodeskContext.matchedObjects.length
        }
    );

    context.log(`Updated state: ${JSON.stringify(enrichedMessage.state)}`);
    await workflowStateService.saveState({
        rfiId: enrichedMessage.rfiId,
        state: enrichedMessage.state,
        sourceUrn: autodeskContext.sourceUrn,
        modelViewGuid: autodeskContext.modelViewGuid
    });

    /**
     * Next persistence step:
     * Store autodeskContext in Cosmos DB, SQL, or the orchestration state store
     * before routing the enriched RFI to the review/agent workflow.
     */
}

app.storageQueue('RFIEnrichmentWorker', {
    queueName: process.env.RFI_ENRICHMENT_QUEUE_NAME ?? 'rfi-enrichment-queue',
    connection: 'AzureWebJobsStorage',
    handler: RFIEnrichmentWorker
});

function hasAutodeskCredentials(): boolean {
    return Boolean(
        process.env.AUTODESK_ACCESS_TOKEN ||
        (process.env.AUTODESK_CLIENT_ID && process.env.AUTODESK_CLIENT_SECRET)
    );
}
