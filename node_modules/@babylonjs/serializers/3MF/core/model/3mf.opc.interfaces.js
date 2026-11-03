export const OpenXmlContentTypesNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
export const OpenXmlRelationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
export var KnownI3mfContentType;
(function (KnownI3mfContentType) {
    // OPC core
    KnownI3mfContentType["Relationships"] = "application/vnd.openxmlformats-package.relationships+xml";
    // 3MF core
    KnownI3mfContentType["Model"] = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
    // Extensions officielles
    KnownI3mfContentType["Materials"] = "application/vnd.ms-package.3dmanufacturing-material+xml";
    KnownI3mfContentType["Colors"] = "application/vnd.ms-package.3dmanufacturing-colors+xml";
    KnownI3mfContentType["Texture"] = "application/vnd.ms-package.3dmanufacturing-texture+xml";
    KnownI3mfContentType["Texture2D"] = "application/vnd.ms-package.3dmanufacturing-texture2d+xml";
    KnownI3mfContentType["Production"] = "application/vnd.ms-package.3dmanufacturing-production+xml";
    KnownI3mfContentType["Slice"] = "application/vnd.ms-package.3dmanufacturing-slice+xml";
    KnownI3mfContentType["BeamLattice"] = "application/vnd.ms-package.3dmanufacturing-beamlattice+xml";
    KnownI3mfContentType["SecureContent"] = "application/vnd.ms-package.3dmanufacturing-securecontent+xml";
    // Assets
    KnownI3mfContentType["Png"] = "image/png";
    KnownI3mfContentType["Jpeg"] = "image/jpeg";
    KnownI3mfContentType["Tiff"] = "image/tiff";
    KnownI3mfContentType["Xml"] = "application/xml";
})(KnownI3mfContentType || (KnownI3mfContentType = {}));
export const RelationshipDirName = "_rels/";
export const Object3dDirName = "3D/";
export const ModelFileName = `3dmodel.model`;
export const RelationshipFileName = `.rels`;
export const ContentTypeFileName = "[Content_Types].xml";
/**
 * Common OPC and 3MF relationship Type URIs.
 */
export class Known3mfRelationshipTypes {
    /**
     * Test if the relationship Type is one of the common known URIs above
     * @param type
     * @returns true if the relationship Type is one of the common known URIs above
     */
    static IsKnown(type) {
        return Known3mfRelationshipTypes.Known.has(type);
    }
    /**
     * test if the relationship Type is the main 3MF model entry point
     * @param type
     * @returns  true if the relationship Type is the main 3MF model entry point
     */
    static IsThreeDimModel(type) {
        return type === Known3mfRelationshipTypes.ThreeDimModel;
    }
}
/**
 * 3MF core: points to the main .model part of the package
 */
Known3mfRelationshipTypes.ThreeDimModel = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
/**
 * OPC core: points to a package thumbnail (often used by 3MF packages)
 */
Known3mfRelationshipTypes.Thumbnail = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";
/**
 * 3MF (print ticket): optional printing settings part (rarely used by slicers)
 */
Known3mfRelationshipTypes.PrintTicket = "http://schemas.microsoft.com/3dmanufacturing/2013/01/printticket";
/**
 * OPC core: indicates parts that must be preserved when editing the package
 */
Known3mfRelationshipTypes.MustPreserve = "http://schemas.openxmlformats.org/package/2006/relationships/mustpreserve";
/**
 * Convenience set for quick checks
 */
Known3mfRelationshipTypes.Known = new Set([
    Known3mfRelationshipTypes.ThreeDimModel,
    Known3mfRelationshipTypes.Thumbnail,
    Known3mfRelationshipTypes.PrintTicket,
    Known3mfRelationshipTypes.MustPreserve,
]);
//# sourceMappingURL=3mf.opc.interfaces.js.map