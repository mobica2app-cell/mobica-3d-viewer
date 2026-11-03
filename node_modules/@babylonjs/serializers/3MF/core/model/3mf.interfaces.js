/**
 * XML namespace for the core 3MF model schema.
 * This is the default namespace used by <model> and most standard 3MF elements.
 */
export const ThreeDimModelNamespace = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
/**
 * XML namespace for the TriangleSets extension (2021/07).
 * This extension is used for more advanced triangle/property use cases.
 * Only declare/use it when you actually emit elements/attributes that require it.
 */
export const TriangleSetsNamespace = "http://schemas.microsoft.com/3dmanufacturing/trianglesets/2021/07";
/* eslint-disable @typescript-eslint/naming-convention */
/**
 * 3MF model units.
 * The unit affects interpretation of vertex coordinates (x,y,z).
 * Most pipelines use millimeter, but the writer should match the upstream scene unit expectations.
 */
export var ST_Unit;
(function (ST_Unit) {
    ST_Unit["micron"] = "micron";
    ST_Unit["millimeter"] = "millimeter";
    ST_Unit["centimeter"] = "centimeter";
    ST_Unit["inch"] = "inch";
    ST_Unit["foot"] = "foot";
    ST_Unit["meter"] = "meter";
})(ST_Unit || (ST_Unit = {}));
/**
 * Standard 3MF object type.
 * This is optional in 3MF; if omitted, consumers often treat it as "model".
 */
export var ST_ObjectType;
(function (ST_ObjectType) {
    ST_ObjectType["model"] = "model";
    ST_ObjectType["solidsupport"] = "solidsupport";
    ST_ObjectType["support"] = "support";
    ST_ObjectType["surface"] = "surface";
    ST_ObjectType["other"] = "other";
})(ST_ObjectType || (ST_ObjectType = {}));
//# sourceMappingURL=3mf.interfaces.js.map