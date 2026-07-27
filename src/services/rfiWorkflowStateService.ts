import { TableClient, TableServiceClient } from "@azure/data-tables";
import type { State } from "../types/states";

export interface RfiWorkflowStateRecord {
    rfiId: number;
    state: State;
    sourceUrn?: string;
    modelViewGuid?: string;
}

interface RfiWorkflowStateEntity {
    partitionKey: string;
    rowKey: string;
    rfiId: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    stateJson: string;
    sourceUrn?: string;
    modelViewGuid?: string;
}

/**
 * Persists RFI workflow state in Azure Table Storage.
 *
 * The service uses AzureWebJobsStorage by default so local Azurite and deployed
 * Azure Functions share the same configuration convention.
 */
export class RfiWorkflowStateService {
    private readonly tableName: string;
    private readonly connectionString: string;
    private tableClient?: TableClient;

    constructor(
        connectionString = process.env.AzureWebJobsStorage,
        tableName = process.env.RFI_WORKFLOW_STATE_TABLE_NAME ?? "RfiWorkflowState"
    ) {
        if (!connectionString) {
            throw new Error("Missing AzureWebJobsStorage connection string for RFI workflow state.");
        }

        this.connectionString = connectionString;
        this.tableName = tableName;
    }

    public async saveState(record: RfiWorkflowStateRecord): Promise<void> {
        const tableClient = await this.getTableClient();
        const entity = this.toEntity(record);

        await tableClient.upsertEntity(entity, "Replace");
    }

    public async getState(rfiId: number): Promise<RfiWorkflowStateRecord | undefined> {
        const tableClient = await this.getTableClient();

        try {
            const entity = await tableClient.getEntity<RfiWorkflowStateEntity>(
                this.getPartitionKey(rfiId),
                this.getRowKey(rfiId)
            );

            return this.fromEntity(entity);
        } catch (error) {
            if (this.isNotFoundError(error)) {
                return undefined;
            }

            throw error;
        }
    }

    private async getTableClient(): Promise<TableClient> {
        if (this.tableClient) {
            return this.tableClient;
        }

        const serviceClient = TableServiceClient.fromConnectionString(this.connectionString);
        await serviceClient.createTable(this.tableName).catch((error) => {
            if (error.statusCode !== 409) {
                throw error;
            }
        });

        this.tableClient = TableClient.fromConnectionString(this.connectionString, this.tableName);
        return this.tableClient;
    }

    private toEntity(record: RfiWorkflowStateRecord): RfiWorkflowStateEntity {
        return {
            partitionKey: this.getPartitionKey(record.rfiId),
            rowKey: this.getRowKey(record.rfiId),
            rfiId: record.rfiId,
            status: record.state.status,
            createdAt: record.state.createdAt,
            updatedAt: record.state.updatedAt,
            stateJson: JSON.stringify(record.state),
            sourceUrn: record.sourceUrn,
            modelViewGuid: record.modelViewGuid
        };
    }

    private fromEntity(entity: RfiWorkflowStateEntity): RfiWorkflowStateRecord {
        return {
            rfiId: entity.rfiId,
            state: JSON.parse(entity.stateJson) as State,
            sourceUrn: entity.sourceUrn,
            modelViewGuid: entity.modelViewGuid
        };
    }

    private getPartitionKey(rfiId: number): string {
        return `rfi-${rfiId}`;
    }

    private getRowKey(rfiId: number): string {
        return rfiId.toString();
    }

    private isNotFoundError(error: unknown): boolean {
        return typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            (error as { statusCode?: number }).statusCode === 404;
    }
}
