import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

/**
 * Minimal APS Model Derivative webhook callback payload.
 *
 * APS event payloads can vary by event type, so this contract keeps known
 * fields explicit while allowing additional callback metadata.
 */
interface AutodeskDerivativeWebhookPayload {
    hook?: {
        event?: string;
        system?: string;
    };
    payload?: {
        urn?: string;
        status?: string;
        progress?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Receives Model Derivative webhook callbacks such as extraction.finished and
 * extraction.updated.
 *
 * This endpoint is intentionally lightweight for now. The next implementation
 * step is to correlate the callback URN to queued/orchestrated RFI work and
 * resume enrichment once translation is complete.
 */
export async function AutodeskDerivativeWebhook(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const callback = (await request.json()) as AutodeskDerivativeWebhookPayload;
    const eventName = callback.hook?.event;
    const sourceUrn = callback.payload?.urn;

    context.log(`Received Autodesk derivative webhook event ${eventName} for URN ${sourceUrn}`);

    return {
        status: 202,
        jsonBody: {
            message: "Autodesk derivative webhook accepted",
            event: eventName,
            urn: sourceUrn
        }
    };
}

app.http('AutodeskDerivativeWebhook', {
    methods: ['POST'],
    authLevel: 'function',
    handler: AutodeskDerivativeWebhook
});
