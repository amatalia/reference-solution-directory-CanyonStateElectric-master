/**
 * State tracking contracts for workflow objects.
 *
 * These types are storage-neutral. They can be attached to an RFI queue message
 * now and later persisted in Azure Table Storage, Cosmos DB, SQL, or Durable
 * Functions orchestration state.
 */

export type WorkflowStateStatus =
    | "received"
    | "queued"
    | "mapping_resolved"
    | "mapping_missing"
    | "autodesk_deferred"
    | "autodesk_translation_pending"
    | "autodesk_enriched"
    | "ready_for_review"
    | "failed";

export interface StateTransition {
    from?: WorkflowStateStatus;
    to: WorkflowStateStatus;
    reason?: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
}

export interface State {
    status: WorkflowStateStatus;
    createdAt: string;
    updatedAt: string;
    history: StateTransition[];
    metadata?: Record<string, unknown>;
}

export interface StatefulEntity {
    state: State;
}

export function createInitialState(
    status: WorkflowStateStatus,
    metadata?: Record<string, unknown>
): State {
    const now = new Date().toISOString();

    return {
        status,
        createdAt: now,
        updatedAt: now,
        metadata,
        history: [
            {
                to: status,
                occurredAt: now,
                metadata
            }
        ]
    };
}

export function getState<T extends StatefulEntity>(entity: T): State {
    return entity.state;
}

export function getStateStatus<T extends StatefulEntity>(entity: T): WorkflowStateStatus {
    return entity.state.status;
}

export function setState<T extends StatefulEntity>(
    entity: T,
    status: WorkflowStateStatus,
    reason?: string,
    metadata?: Record<string, unknown>
): T {
    const now = new Date().toISOString();
    const previousStatus = entity.state.status;

    return {
        ...entity,
        state: {
            ...entity.state,
            status,
            updatedAt: now,
            metadata: {
                ...entity.state.metadata,
                ...metadata
            },
            history: [
                ...entity.state.history,
                {
                    from: previousStatus,
                    to: status,
                    reason,
                    occurredAt: now,
                    metadata
                }
            ]
        }
    };
}

