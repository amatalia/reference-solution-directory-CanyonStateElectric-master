import {
  Job,
  JobPayload,
  MatchIdType,
  ModelDerivativeClient,
  OutputType,
  SpecificPropertiesPayload,
  SpecifyReferences,
  SpecifyReferencesPayload,
  View
} from "@aps_sdk/model-derivative";
import { config } from "dotenv";

/**
 * Autodesk service implementation plan
 *
 * Purpose:
 * This file will become the single service boundary between our RFI triage
 * workflow and Autodesk Platform Services. The first Autodesk API we are
 * targeting is the Model Derivative API because it lets us translate Revit
 * source designs into SVF2/viewable derivatives and query extracted metadata.
 *
 * Why this service exists:
 * - RFIIngestion should not know Autodesk REST endpoints or SDK details.
 * - The rest of the app should call clear internal methods such as
 *   getManifest, listModelViews, getObjectTree, and getAllProperties.
 * - We do not have third-party API/subscription access yet, so this service
 *   must start as typed boilerplate with stubs/mocks before real SDK calls.
 *
 * Current Autodesk scope:
 * - Model Derivative API first.
 * - Revit API / Design Automation can be a separate service later if we need
 *   to actually open, modify, or automate Revit models.
 *
 * Model Derivative concepts we need to represent:
 * - Source design:
 *   The original design file, such as a Revit model, identified by a
 *   URL-safe source URN.
 *
 * - Translation job:
 *   An asynchronous job submitted with POST /job. A successful response only
 *   means the job was accepted. The job continues in the background.
 *
 * - Derivatives:
 *   Output files created from the source design, such as SVF2, thumbnails,
 *   OBJ, STL, or other supported output formats.
 *
 * - Manifest:
 *   The status and inventory document for all derivatives of one source
 *   design. We use GET /{urn}/manifest to check whether translation is still
 *   pending, in progress, complete, or failed.
 *
 * - Model views:
 *   Viewables inside the design. Revit can have multiple model views, such as
 *   a 3D scene and 2D sheets like "Sheet: A101". We should not assume one
 *   view per source design.
 *
 * - Object tree:
 *   The hierarchy of model objects inside a selected model view.
 *
 * - Object properties:
 *   The extracted property data for model objects. This can be large, so the
 *   real implementation should prefer specific property queries when possible.
 *
 * - objectid / dbid:
 *   Per-translation object identifiers. These are useful for Viewer and
 *   Model Derivative operations, but they are not stable across model versions
 *   or translations.
 *
 * - externalId:
 *   A more persistent source-model identifier. For Revit, this maps closer to
 *   Revit's unique IDs. We should prefer externalId for anything we store.
 *
 * SDK we plan to use:
 * - Package: @aps_sdk/model-derivative
 * - Client: ModelDerivativeClient
 *
 * SDK methods we expect to wrap:
 * - startJob
 *   REST: POST /job
 *   Purpose: submit a translation job.
 *
 * - specifyReferences
 *   REST: POST /{urn}/references
 *   Purpose: define references needed by a source design.
 *
 * - getManifest
 *   REST: GET /{urn}/manifest
 *   Purpose: check translation status and derivative inventory.
 *
 * - getModelViews
 *   REST: GET /{urn}/metadata
 *   Purpose: list 2D and 3D model views available after translation.
 *
 * - getObjectTree
 *   REST: GET /{urn}/metadata/{modelGuid}
 *   Purpose: fetch the hierarchy of objects for a model view.
 *
 * - getAllProperties
 *   REST: GET /{urn}/metadata/{modelGuid}/properties
 *   Purpose: fetch all object properties for a model view.
 *
 * - fetchSpecificProperties
 *   REST: POST /{urn}/metadata/{modelGuid}/properties:query
 *   Purpose: fetch selected properties or selected object IDs.
 *
 * - getThumbnail
 *   REST: GET /{urn}/thumbnail
 *   Purpose: fetch a thumbnail for the translated source design.
 *
 * - getDerivativeUrl
 *   REST: GET /{urn}/manifest/{derivativeUrn}/signedcookies
 *   Purpose: fetch a download URL for a derivative resource.
 *
 * Build order for this file:
 * 1. Define TypeScript interfaces for manifests, derivatives, model views,
 *    object trees, and object properties.
 * 2. Create an AutodeskModelDerivativeService class skeleton with method
 *    signatures only.
 * 3. Add stubbed return values so the rest of the app can compile and the RFI
 *    workflow can be mocked without Autodesk access.
 * 4. Add environment-variable configuration for Autodesk credentials and
 *    source URN mapping.
 * 5. Install and import @aps_sdk/model-derivative.
 * 6. Add authentication/token handling.
 * 7. Replace stubs with real SDK calls.
 * 8. Add webhook handling for derivative extraction.finished and
 *    extraction.updated events.
 * 9. Wire RFIIngestion to this service only after the mock service flow works.
 *
 * Expected low-level service methods:
 * - submitTranslationJob(sourceUrn)
 * - specifyReferences(sourceUrn, references)
 * - getManifest(sourceUrn)
 * - isTranslationComplete(manifest)
 * - listModelViews(sourceUrn)
 * - getObjectTree(sourceUrn, modelViewGuid)
 * - getAllProperties(sourceUrn, modelViewGuid)
 * - fetchSpecificProperties(sourceUrn, modelViewGuid, query)
 * - getThumbnail(sourceUrn)
 *
 * Expected later RFI-specific method:
 * - getAutodeskContextForRfi(rfiContext)
 *
 * RFI mapping notes:
 * - Procore drawing_ids and drawing_number do not directly equal Autodesk
 *   object IDs.
 * - We will need a mapping step from RFI drawing references to Autodesk source
 *   design URNs and model view GUIDs.
 * - The higher-level RFI enrichment service should decide which model view or
 *   sheet to inspect. The low-level Autodesk service should stay generic.
 */

/**
 * Manifest returned by APS for one source design URN.
 *
 * The manifest is the status and inventory document for every derivative
 * produced from a source design.
 */
export interface AutodeskManifest {
  urn: string;
  type: string;
  status: string;
  progress: string;
  region?: string;
  version?: string;
  hasThumbnail?: string;
  derivatives?: AutodeskDerivative[];
}

/**
 * Top-level derivative entry inside a manifest.
 */
export interface AutodeskDerivative {
  name?: string;
  outputType?: string;
  status?: string;
  progress?: string;
  hasThumbnail?: string;
  children?: AutodeskDerivativeChild[];
  messages?: AutodeskDerivativeMessage[];
}

/**
 * Nested derivative resource or viewable entry.
 */
export interface AutodeskDerivativeChild {
  guid?: string;
  type?: string;
  role?: string;
  mime?: string;
  urn?: string;
  status?: string;
  progress?: string;
  name?: string;
  resolution?: number[];
  children?: AutodeskDerivativeChild[];
  messages?: AutodeskDerivativeMessage[];
}

export interface AutodeskDerivativeMessage {
  type?: string;
  code?: string;
  message?: string;
}

/**
 * Response shape returned when listing viewables for a translated model.
 */
export interface AutodeskModelViewsResponse {
  data: {
    type: string;
    metadata: AutodeskModelView[];
  };
}

/**
 * A single model view or sheet available for metadata queries.
 */
export interface AutodeskModelView {
  name: string;
  role: string;
  guid: string;
}

/**
 * Hierarchical object tree for a selected model view.
 */
export interface AutodeskObjectTreeResponse {
  data: {
    type: string;
    objects: AutodeskObjectNode[];
  };
}

/**
 * Node in the Autodesk object hierarchy.
 */
export interface AutodeskObjectNode {
  objectid: number;
  name: string;
  objects?: AutodeskObjectNode[];
}

/**
 * Flat property collection returned by metadata property endpoints.
 */
export interface AutodeskPropertiesResponse {
  data: {
    type: string;
    collection: AutodeskObjectProperties[];
  };
}

/**
 * Properties for one object in a model view.
 *
 * Store externalId when persisting references. Autodesk objectid/dbid values
 * are useful for a translation/viewer session but are not stable identifiers.
 */
export interface AutodeskObjectProperties {
  objectid: number;
  name: string;
  externalId?: string;
  properties?: AutodeskPropertyGroups;
}

export interface AutodeskPropertyGroups {
  [groupName: string]: AutodeskPropertyGroup | string | number | boolean | null;
}

export interface AutodeskPropertyGroup {
  [propertyName: string]: string | number | boolean | null;
}

/**
 * RFI-specific lookup context passed into the Autodesk enrichment layer.
 *
 * Procore drawing IDs and drawing numbers are not Autodesk IDs. sourceUrn and
 * modelViewGuid are optional here because a future mapping layer should resolve
 * them from Procore, Bluebeam, SQL, or another project data source.
 */
export interface AutodeskRfiLookupContext {
  rfiId: number;
  drawingIds: number[];
  drawingNumber?: string;
  sourceUrn?: string;
  modelViewGuid?: string;
}

/**
 * Mapping from an external drawing reference to Autodesk model identifiers.
 *
 * In production this will likely come from SQL, Cosmos DB, Autodesk
 * Construction Cloud, or another project data source. The environment-backed
 * map keeps this boilerplate usable before that persistence layer exists.
 */
export interface AutodeskDrawingReferenceMapping {
  sourceUrn: string;
  modelViewGuid?: string;
}

export interface AutodeskDrawingReferenceMap {
  [drawingReference: string]: AutodeskDrawingReferenceMapping;
}

/**
 * Autodesk context selected for an RFI triage workflow.
 */
export interface AutodeskRfiEnrichmentResult {
  rfiId: number;
  sourceUrn?: string;
  modelViewGuid?: string;
  manifestStatus?: string;
  matchedModelView?: AutodeskModelView;
  matchedObjects: AutodeskObjectProperties[];
}

/**
 * Internal result returned when APS accepts a translation job.
 */
export interface AutodeskTranslationJobResult {
  status: "accepted" | "failed";
  message: string;
  sourceUrn: string;
  job?: Job;
}

/**
 * Application-level query shape for selected object properties.
 *
 * This hides the APS SpecificPropertiesPayload structure from function and
 * orchestration code.
 */
export interface AutodeskSpecificPropertiesQuery {
  objectIds?: number[];
  externalIds?: string[];
  propertyNames?: string[];
  nameContains?: string;
}

/**
 * Summary returned after registering source-design references.
 */
export interface AutodeskSpecifyReferencesResult {
  sourceUrn: string;
  referenceCount: number;
  response: SpecifyReferences;
}

/**
 * OAuth token response returned by APS authentication.
 */
export interface AutodeskAccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Application-facing wrapper around the APS Model Derivative SDK.
 *
 * Azure Functions and orchestration workers should call this class instead of
 * importing ModelDerivativeClient directly.
 */
export class AutodeskModelDerivativeService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private modelDerivativeClient: ModelDerivativeClient;

  constructor(accessToken?: string) {
    this.accessToken = accessToken ?? process.env.AUTODESK_ACCESS_TOKEN ?? null;
    this.modelDerivativeClient = new ModelDerivativeClient();
  }

  /**
   * Returns a usable APS access token.
   *
   * Token priority:
   * 1. Token passed into the constructor.
   * 2. AUTODESK_ACCESS_TOKEN from the environment.
   * 3. Client credentials flow using AUTODESK_CLIENT_ID and AUTODESK_CLIENT_SECRET.
   */
  public async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    if (this.accessToken && this.accessTokenExpiresAt === 0) {
      return this.accessToken;
    }

    const clientId = process.env.AUTODESK_CLIENT_ID;
    const clientSecret = process.env.AUTODESK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing Autodesk credentials. Set AUTODESK_ACCESS_TOKEN or set AUTODESK_CLIENT_ID and AUTODESK_CLIENT_SECRET."
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "data:read data:write data:create bucket:read bucket:create"
    });

    const response = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Autodesk token request failed with status ${response.status}: ${responseBody}`);
    }

    const token = (await response.json()) as AutodeskAccessTokenResponse;
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(token.expires_in - 60, 0) * 1000;

    return this.accessToken;
  }

  /**
   * Starts an asynchronous SVF2 + thumbnail translation job.
   */
  public async submitTranslationJob(sourceUrn: string): Promise<AutodeskTranslationJobResult> {
    console.log(`[Autodesk] Submitting SVF2 translation job for URN: ${sourceUrn}`);

    const payload = this.createSvf2TranslationPayload(sourceUrn);
    const job = await this.modelDerivativeClient.startJob(payload, {
      accessToken: await this.getAccessToken()
    });

    return {
      status: "accepted",
      message: "Translation job submitted to Autodesk Model Derivative.",
      sourceUrn,
      job
    };
  }

  /**
   * Registers referenced files required by a source design before translation.
   */
  public async specifyReferences(
    sourceUrn: string,
    references: string[]
  ): Promise<AutodeskSpecifyReferencesResult> {
    console.log(`[Autodesk] Specifying ${references.length} references for URN: ${sourceUrn}`);

    const payload: SpecifyReferencesPayload = {
      references: references.map((referenceUrn) => ({
        urn: referenceUrn
      }))
    };
    const response = await this.modelDerivativeClient.specifyReferences(sourceUrn, payload, {
      accessToken: await this.getAccessToken()
    });

    return {
      sourceUrn,
      referenceCount: references.length,
      response
    };
  }

  /**
   * Example references payload for future mocks/tests.
   *
   * {
   *   references: [
   *     {
   *       urn: "URL_SAFE_URN_OF_LINKED_MODEL",
   *       relativePath: "./linked-model.rvt",
   *       filename: "linked-model.rvt"
   *     }
   *   ]
   * }
   */

  /**
   * Fetches the status and derivative inventory manifest for a source URN.
   */
  public async getManifest(sourceUrn: string): Promise<AutodeskManifest> {
    console.log(`[Autodesk] Fetching manifest for URN: ${sourceUrn}`);

    const manifest = await this.modelDerivativeClient.getManifest(sourceUrn, {
      accessToken: await this.getAccessToken()
    });

    return manifest as AutodeskManifest;
  }

  /**
   * Example manifest shapes for future mocks/tests.
   *
   * Completed translation:
   * {
   *   urn: "URL_SAFE_URN_OF_SOURCE_FILE",
   *   type: "manifest",
   *   status: "success",
   *   progress: "complete",
   *   hasThumbnail: "true",
   *   derivatives: [{
   *     name: "model.rvt",
   *     outputType: "svf2",
   *     status: "success",
   *     progress: "complete",
   *     children: [
   *       { guid: "3d-view-guid", type: "geometry", role: "3d", name: "Scene" },
   *       { guid: "sheet-view-guid", type: "geometry", role: "2d", name: "Sheet: A101" }
   *     ]
   *   }]
   * }
   *
   * In-progress translation:
   * {
   *   urn: "URL_SAFE_URN_OF_SOURCE_FILE",
   *   type: "manifest",
   *   status: "inprogress",
   *   progress: "50% complete",
   *   hasThumbnail: "false",
   *   derivatives: [{
   *     name: "model.rvt",
   *     outputType: "svf2",
   *     status: "inprogress",
   *     progress: "50% complete"
   *   }]
   * }
   */

  public isTranslationComplete(manifest: AutodeskManifest): boolean {
    return manifest.status === "success" && manifest.progress === "complete";
  }

  /**
   * Lists model views and sheets available after SVF/SVF2 translation.
   */
  public async listModelViews(sourceUrn: string): Promise<AutodeskModelViewsResponse> {
    console.log(`[Autodesk] Listing model views for URN: ${sourceUrn}`);

    const modelViews = await this.modelDerivativeClient.getModelViews(sourceUrn, {
      accessToken: await this.getAccessToken()
    });

    return modelViews as AutodeskModelViewsResponse;
  }

  /**
   * Example model views response for future mocks/tests.
   *
   * {
   *   data: {
   *     type: "metadata",
   *     metadata: [
   *       {
   *         name: "Scene",
   *         role: "3d",
   *         guid: "4f981e94-8241-4eaf-b08b-cd337c6b8b1f"
   *       },
   *       {
   *         name: "Sheet: A101",
   *         role: "2d",
   *         guid: "8e7c6bca-cfd1-290e-4b16-f3670169bb71"
   *       }
   *     ]
   *   }
   * }
   */

  /**
   * Fetches the hierarchical object tree for one model view.
   */
  public async getObjectTree(
    sourceUrn: string,
    modelViewGuid: string
  ): Promise<AutodeskObjectTreeResponse> {
    console.log(`[Autodesk] Fetching object tree for URN: ${sourceUrn}, view: ${modelViewGuid}`);

    const objectTree = await this.modelDerivativeClient.getObjectTree(sourceUrn, modelViewGuid, {
      accessToken: await this.getAccessToken()
    });

    return objectTree as AutodeskObjectTreeResponse;
  }

  /**
   * Example object tree response for future mocks/tests.
   *
   * {
   *   data: {
   *     type: "objects",
   *     objects: [{
   *       objectid: 1,
   *       name: "Model",
   *       objects: [{
   *         objectid: 1045,
   *         name: "Main Switchgear - 4000A"
   *       }]
   *     }]
   *   }
   * }
   */

  /**
   * Fetches all extracted properties for one model view.
   */
  public async getAllProperties(
    sourceUrn: string,
    modelViewGuid: string
  ): Promise<AutodeskPropertiesResponse> {
    console.log(`[Autodesk] Fetching all properties for URN: ${sourceUrn}, view: ${modelViewGuid}`);

    const properties = await this.modelDerivativeClient.getAllProperties(sourceUrn, modelViewGuid, {
      accessToken: await this.getAccessToken()
    });

    return properties as AutodeskPropertiesResponse;
  }

  /**
   * Example properties response for future mocks/tests.
   *
   * {
   *   data: {
   *     type: "properties",
   *     collection: [{
   *       objectid: 1045,
   *       name: "Main Switchgear - 4000A",
   *       externalId: "revit-uuid-1234-5678",
   *       properties: {
   *         Electrical: {
   *           Voltage: 480,
   *           "Clearance Required": "4ft"
   *         },
   *         Identity: {
   *           Mark: "SWGR-1",
   *           Level: "Level 1"
   *         }
   *       }
   *     }]
   *   }
   * }
   */

  /**
   * Fetches selected properties or selected objects from one model view.
   */
  public async fetchSpecificProperties(
    sourceUrn: string,
    modelViewGuid: string,
    query: AutodeskSpecificPropertiesQuery
  ): Promise<AutodeskPropertiesResponse> {
    console.log(
      `[Autodesk] Fetching specific properties for URN: ${sourceUrn}, view: ${modelViewGuid}, query: ${JSON.stringify(query)}`
    );

    const payload = this.createSpecificPropertiesPayload(query);
    const properties = await this.modelDerivativeClient.fetchSpecificProperties(sourceUrn, modelViewGuid, payload, {
      accessToken: await this.getAccessToken()
    });

    return properties as AutodeskPropertiesResponse;
  }

  /**
   * Example specific-properties request/response for future mocks/tests.
   *
   * Request:
   * {
   *   query: { "$in": ["externalId", "revit-uuid-1234-5678"] },
   *   fields: {
   *     "properties.Identity.Mark": true,
   *     "properties.Electrical.Voltage": true
   *   },
   *   pagination: { offset: 0, limit: 100 }
   * }
   *
   * Response:
   * {
   *   data: {
   *     type: "properties",
   *     collection: [{
   *       objectid: 1045,
   *       name: "Main Switchgear - 4000A",
   *       externalId: "revit-uuid-1234-5678",
   *       properties: { Identity: { Mark: "SWGR-1" } }
   *     }]
   *   }
   * }
   */

  /**
   * Fetches the thumbnail generated for a translated source design.
   */
  public async getThumbnail(sourceUrn: string): Promise<string> {
    console.log(`[Autodesk] Fetching thumbnail for URN: ${sourceUrn}`);

    return this.modelDerivativeClient.getThumbnail(sourceUrn, {
      accessToken: await this.getAccessToken()
    });
  }

  /**
   * Example thumbnail behavior for future mocks/tests.
   *
   * The SDK returns the thumbnail response as a string. In a production endpoint,
   * callers should decide whether to pass that through directly, store it, or
   * wrap it with HTTP response headers such as Content-Type: image/png.
   */

  /**
   * RFI-oriented Autodesk enrichment entry point.
   *
   * This is the method the orchestration layer should call after RFI drawing
   * references have been mapped to Autodesk source/view identifiers.
   */
  public async getAutodeskContextForRfi(
    rfiContext: AutodeskRfiLookupContext
  ): Promise<AutodeskRfiEnrichmentResult> {
    console.log(`[AutodeskMock] Orchestrating context retrieval for RFI ${rfiContext.rfiId}`);

    const drawingMapping = this.resolveDrawingReferenceMapping(rfiContext);
    const sourceUrn = this.resolveSourceUrnForRfi(rfiContext, drawingMapping);
    const manifest = await this.getManifest(sourceUrn);
    const modelViews = await this.listModelViews(sourceUrn);

    /**
     * Enrich the original RFI lookup context before selecting a model view.
     *
     * The object spread keeps all original RFI fields intact, then overlays the
     * best modelViewGuid we know about. Priority order:
     * 1. Explicit rfiContext.modelViewGuid supplied by the caller.
     * 2. modelViewGuid resolved from AUTODESK_RFI_DRAWING_MAP.
     * 3. resolveModelViewForRfi fallback logic, which tries drawingNumber and
     *    then falls back to a 3D model view.
     */
    const matchedModelView = this.resolveModelViewForRfi(
      {
        ...rfiContext,
        modelViewGuid: rfiContext.modelViewGuid ?? drawingMapping?.modelViewGuid
      },
      modelViews.data.metadata
    );
    const properties = await this.fetchSpecificProperties(sourceUrn, matchedModelView.guid, {
      propertyNames: ["Mark", "Level", "Voltage", "Clearance Required"]
    });

    return {
      rfiId: rfiContext.rfiId,
      sourceUrn,
      modelViewGuid: matchedModelView.guid,
      manifestStatus: manifest.status,
      matchedModelView,
      matchedObjects: properties.data.collection
    };
  }

  private resolveSourceUrnForRfi(
    rfiContext: AutodeskRfiLookupContext,
    drawingMapping?: AutodeskDrawingReferenceMapping
  ): string {
    /**
     * Source URN priority:
     * 1. Explicit sourceUrn supplied by the caller.
     * 2. sourceUrn resolved from AUTODESK_RFI_DRAWING_MAP.
     * 3. Fallback URN derived from drawingNumber or the first drawingId.
     */
    if (rfiContext.sourceUrn) {
      return rfiContext.sourceUrn;
    }

    if (drawingMapping?.sourceUrn) {
      return drawingMapping.sourceUrn;
    }

    const drawingReference = rfiContext.drawingNumber ?? rfiContext.drawingIds[0]?.toString() ?? "unknown";

    return `urn:adsk.objects:os.object:cse-rfi-triage/model-${drawingReference}.rvt`;
  }

  private createSvf2TranslationPayload(sourceUrn: string): JobPayload {
    return {
      input: {
        urn: sourceUrn,
        compressedUrn: false
      },
      output: {
        formats: [
          {
            type: OutputType.Svf2,
            views: [View._2d, View._3d]
          },
          {
            type: OutputType.Thumbnail
          }
        ]
      }
    };
  }

  private createSpecificPropertiesPayload(query: AutodeskSpecificPropertiesQuery): SpecificPropertiesPayload {
    /**
     * Convert the app-friendly query shape into APS SpecificPropertiesPayload.
     *
     * Query priority:
     * 1. objectIds when caller already knows Autodesk session object IDs.
     * 2. externalIds when caller has stable source-model identifiers.
     * 3. nameContains as a broad fallback for discovery-style lookups.
     */
    const fields = this.createSpecificPropertiesFields(query.propertyNames);

    if (query.objectIds?.length) {
      return {
        query: {
          $in: [MatchIdType.ObjectId, ...query.objectIds]
        },
        fields,
        pagination: {
          offset: 0,
          limit: 100
        }
      };
    }

    if (query.externalIds?.length) {
      return {
        query: {
          $in: [MatchIdType.ExternalId, ...query.externalIds]
        },
        fields,
        pagination: {
          offset: 0,
          limit: 100
        }
      };
    }

    return {
      query: {
        $contains: ["name", query.nameContains ?? ""]
      },
      fields,
      pagination: {
        offset: 0,
        limit: 100
      }
    };
  }

  private createSpecificPropertiesFields(propertyNames?: string[]): object | undefined {
    /**
     * APS fields let us request only selected property paths.
     *
     * properties.*.{name} searches for the property name under any property
     * group, which is useful because Revit metadata groups can vary by model
     * authoring standards and export settings.
     */
    if (!propertyNames?.length) {
      return undefined;
    }

    return propertyNames.reduce((fields, propertyName) => {
      fields[`properties.*.${propertyName}`] = true;
      return fields;
    }, {} as { [fieldName: string]: boolean });
  }

  private resolveDrawingReferenceMapping(
    rfiContext: AutodeskRfiLookupContext
  ): AutodeskDrawingReferenceMapping | undefined {
    /**
     * Resolve Procore drawing references into Autodesk identifiers.
     *
     * The environment map is a temporary translation layer until this project
     * has a durable mapping source such as SQL, Cosmos DB, ACC metadata, or a
     * drawing registry service.
     *
     * Lookup priority:
     * 1. drawingNumber, because sheet numbers such as A101 are human-readable
     *    and often align with model view names.
     * 2. drawingIds, because Procore may provide only numeric drawing IDs.
     * 3. undefined, allowing the caller to use fallback behavior.
     */
    const mapping = this.getDrawingReferenceMap();

    if (!mapping) {
      return undefined;
    }

    if (rfiContext.drawingNumber && mapping[rfiContext.drawingNumber]) {
      return mapping[rfiContext.drawingNumber];
    }

    for (const drawingId of rfiContext.drawingIds) {
      const mappedDrawing = mapping[drawingId.toString()];

      if (mappedDrawing) {
        return mappedDrawing;
      }
    }

    return undefined;
  }

  private getDrawingReferenceMap(): AutodeskDrawingReferenceMap | undefined {
    /**
     * Reads AUTODESK_RFI_DRAWING_MAP from environment configuration.
     *
     * Expected JSON shape:
     * {
     *   "A101": {
     *     "sourceUrn": "URL_SAFE_URN_OF_SOURCE_MODEL",
     *     "modelViewGuid": "OPTIONAL_VIEW_OR_SHEET_GUID"
     *   }
     * }
     */
    const rawMapping = process.env.AUTODESK_RFI_DRAWING_MAP;

    if (!rawMapping) {
      return undefined;
    }

    try {
      return JSON.parse(rawMapping) as AutodeskDrawingReferenceMap;
    } catch (error) {
      throw new Error(`Invalid AUTODESK_RFI_DRAWING_MAP JSON: ${error}`);
    }
  }

  private requireAccessToken(): string {
    if (!this.accessToken) {
      throw new Error(
        "Missing Autodesk access token. Set AUTODESK_ACCESS_TOKEN or pass one to AutodeskModelDerivativeService."
      );
    }

    return this.accessToken;
  }

  private resolveModelViewForRfi(
    rfiContext: AutodeskRfiLookupContext,
    modelViews: AutodeskModelView[]
  ): AutodeskModelView {
    if (rfiContext.modelViewGuid) {
      const explicitMatch = modelViews.find((modelView) => modelView.guid === rfiContext.modelViewGuid);

      if (explicitMatch) {
        return explicitMatch;
      }
    }

    if (rfiContext.drawingNumber) {
      const drawingMatch = modelViews.find((modelView) =>
        modelView.name.toLowerCase().includes(rfiContext.drawingNumber!.toLowerCase())
      );

      if (drawingMatch) {
        return drawingMatch;
      }
    }

    return modelViews.find((modelView) => modelView.role === "3d") ?? modelViews[0];
  }
}
