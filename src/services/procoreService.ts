import type { ProcoreRfiDetail } from "../types/rfi";

/**
 * OAuth token response returned by Procore's `/oauth/token` endpoint.
 *
 * See `Platform - Developer Tools > Authentication > Get or Refresh an
 * Access Token` in combined_OAS_postman.json.
 */
export interface ProcoreAccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Application-facing wrapper around the Procore REST API.
 *
 * Function files must not call `fetch` against Procore endpoints directly —
 * this mirrors the AutodeskModelDerivativeService pattern in
 * `autodeskService.ts`, keeping vendor REST/auth details out of
 * `RFIIngestion.ts`.
 *
 * Today this only wraps `Show RFI`, which is the one call the ingestion
 * function needs to hydrate a real Procore webhook's thin event envelope
 * (`resource_id`/`project_id`) into a full `ProcoreRfiDetail`.
 */
export class ProcoreApiService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private readonly baseUrl: string;

  constructor(accessToken?: string, baseUrl?: string) {
    this.accessToken = accessToken ?? process.env.PROCORE_ACCESS_TOKEN ?? null;
    this.baseUrl = baseUrl ?? process.env.PROCORE_API_BASE_URL ?? "https://api.procore.com";
  }

  /**
   * Returns a usable Procore access token.
   *
   * Token priority:
   * 1. Token passed into the constructor.
   * 2. PROCORE_ACCESS_TOKEN from the environment.
   * 3. Client credentials grant using PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET.
   */
  public async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    if (this.accessToken && this.accessTokenExpiresAt === 0) {
      return this.accessToken;
    }

    const clientId = process.env.PROCORE_CLIENT_ID;
    const clientSecret = process.env.PROCORE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing Procore credentials. Set PROCORE_ACCESS_TOKEN or set PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET."
      );
    }

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Procore token request failed with status ${response.status}: ${responseBody}`);
    }

    const token = (await response.json()) as ProcoreAccessTokenResponse;
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(token.expires_in - 60, 0) * 1000;

    return this.accessToken;
  }

  /**
   * Fetches full RFI detail for one project/RFI pair.
   *
   * REST: GET /rest/v1.0/projects/{project_id}/rfis/{id}
   * (`Project Management > RFI > rfis > Show RFI` in combined_OAS_postman.json)
   */
  public async getRfi(projectId: number, rfiId: number, companyId?: number): Promise<ProcoreRfiDetail> {
    console.log(`[Procore] Fetching RFI ${rfiId} for project ${projectId}`);

    const resolvedCompanyId = companyId ?? this.requireCompanyId();
    const response = await fetch(`${this.baseUrl}/rest/v1.0/projects/${projectId}/rfis/${rfiId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        "Procore-Company-Id": resolvedCompanyId.toString()
      }
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `Procore Show RFI request failed with status ${response.status} for project ${projectId}, RFI ${rfiId}: ${responseBody}`
      );
    }

    return (await response.json()) as ProcoreRfiDetail;
  }

  private requireCompanyId(): number {
    const companyId = process.env.PROCORE_COMPANY_ID;

    if (!companyId) {
      throw new Error(
        "Missing Procore-Company-Id. Pass companyId explicitly (from the webhook envelope) or set PROCORE_COMPANY_ID."
      );
    }

    return Number(companyId);
  }
}
