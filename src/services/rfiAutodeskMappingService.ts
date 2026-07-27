import type { AutodeskDrawingReferenceMapping, AutodeskRfiLookupContext } from "./autodeskService";

export interface RfiAutodeskMappingResult {
  rfiId: number;
  drawingNumber?: string;
  drawingIds: number[];
  mapping?: AutodeskDrawingReferenceMapping;
  matchedBy?: string;
}

/**
 * Resolves construction drawing references from an RFI into Autodesk model
 * identifiers.
 *
 * This service is intentionally small for the boilerplate phase. It uses an
 * environment-backed map now, and can later be backed by SQL, Cosmos DB,
 * Autodesk Construction Cloud, Bluebeam metadata, or a project registry.
 */
export class RfiAutodeskMappingService {
  public resolveMapping(rfiContext: AutodeskRfiLookupContext): RfiAutodeskMappingResult {
    const map = this.getDrawingReferenceMap();

    if (rfiContext.sourceUrn) {
      return {
        rfiId: rfiContext.rfiId,
        drawingIds: rfiContext.drawingIds,
        drawingNumber: rfiContext.drawingNumber,
        mapping: {
          sourceUrn: rfiContext.sourceUrn,
          modelViewGuid: rfiContext.modelViewGuid
        },
        matchedBy: "explicitSourceUrn"
      };
    }

    if (!map) {
      return {
        rfiId: rfiContext.rfiId,
        drawingIds: rfiContext.drawingIds,
        drawingNumber: rfiContext.drawingNumber
      };
    }

    if (rfiContext.drawingNumber && map[rfiContext.drawingNumber]) {
      return {
        rfiId: rfiContext.rfiId,
        drawingIds: rfiContext.drawingIds,
        drawingNumber: rfiContext.drawingNumber,
        mapping: map[rfiContext.drawingNumber],
        matchedBy: "drawingNumber"
      };
    }

    for (const drawingId of rfiContext.drawingIds) {
      const drawingIdKey = drawingId.toString();

      if (map[drawingIdKey]) {
        return {
          rfiId: rfiContext.rfiId,
          drawingIds: rfiContext.drawingIds,
          drawingNumber: rfiContext.drawingNumber,
          mapping: map[drawingIdKey],
          matchedBy: "drawingId"
        };
      }
    }

    return {
      rfiId: rfiContext.rfiId,
      drawingIds: rfiContext.drawingIds,
      drawingNumber: rfiContext.drawingNumber
    };
  }

  private getDrawingReferenceMap(): Record<string, AutodeskDrawingReferenceMapping> | undefined {
    const rawMapping = process.env.AUTODESK_RFI_DRAWING_MAP;

    if (!rawMapping) {
      return undefined;
    }

    try {
      return JSON.parse(rawMapping) as Record<string, AutodeskDrawingReferenceMapping>;
    } catch (error) {
      throw new Error(`Invalid AUTODESK_RFI_DRAWING_MAP JSON: ${error}`);
    }
  }
}
