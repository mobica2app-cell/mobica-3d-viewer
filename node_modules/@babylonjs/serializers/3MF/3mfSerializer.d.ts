import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.js";
import { type ThreeMfModelBuilder } from "./core/model/3mf.builder.js";
import { type I3mfModel } from "./core/model/3mf.interfaces.js";
import { AbstractThreeMfSerializer, type IThreeMfSerializerBaseOptions } from "./core/model/3mf.serializer.js";
/**
 * Options controlling how meshes are exported into the 3MF model.
 *
 * Notes:
 * - These flags are kept generic here and are expected to be interpreted by the concrete serializer/model builder.
 * - Defaults are set in AbstractThreeMfSerializer.DEFAULT_3MF_EXPORTER_OPTIONS.
 */
export interface IThreeMfSerializerOptions extends IThreeMfSerializerBaseOptions {
    /**
     * If true, export mesh instances (multiple references to the same geometry) when supported.
     * If false, geometry may be duplicated depending on the concrete implementation.
     */
    exportInstances?: boolean;
}
/**
 * Babylon.js to 3MF serializer.
 *
 * This serializer converts Babylon meshes into a 3MF model, then relies on the base class
 * (AbstractThreeMfSerializer) to package the OPC parts into a zip stream.
 *
 * Design notes:
 * - First pass: export "source" meshes (non-instances) and build an index to map Babylon mesh/submesh to 3MF object id.
 * - Second pass (optional): export instances as additional build items referencing the original object ids.
 * - Submesh export is handled by extracting per-submesh vertex/index buffers so materials/colors can be preserved
 *   by downstream steps that attach per-object properties.
 */
export declare class ThreeMfSerializer extends AbstractThreeMfSerializer<Mesh | InstancedMesh, IThreeMfSerializerOptions> {
    /**
     * Default serialization options: meter units, no instance export.
     */
    static DefaultOptions: IThreeMfSerializerOptions;
    /**
     * Babylon's vertex buffer semantic for positions.
     * Babylon uses string-based "kind" keys for vertex buffers.
     */
    private static _PositionKind;
    /**
     * Cached promise so we only attempt to load fflate once.
     * This prevents multiple concurrent LoadScriptAsync calls.
     */
    private _fflateReadyPromise?;
    /**
     * @param opts serializer options (merged with defaults in base class).
     */
    constructor(opts?: Partial<IThreeMfSerializerOptions>);
    /**
     * Build a 3MF model from Babylon meshes.
     *
     * Important: this method should not allocate huge intermediate data unless needed.
     * Submesh extraction does allocate new position/index arrays for each exported submesh.
     * @param builder
     * @param meshes
     * @returns
     */
    toModel(builder: ThreeMfModelBuilder, ...meshes: Array<Mesh | InstancedMesh>): I3mfModel;
    /**
     * Ensure the zip library (fflate) is available in the current runtime.
     *
     * Host assumptions:
     * - This implementation relies on fflate being exposed on globalThis.fflate.
     * - If it is not present, it loads a script from ThreeMfSerializerGlobalConfiguration.FFLATEUrl using Babylon Tools.LoadScriptAsync.
     * @returns
     */
    ensureZipLibReadyAsync(): Promise<any>;
    /**
     * Extract a single SubMesh into a standalone vertex/index buffer pair.
     *
     * Why:
     * - 3MF mesh objects typically reference a contiguous vertex array and triangle indices.
     * - Babylon SubMesh references a slice of the global index buffer, but shares the vertex buffer.
     * - To serialize each submesh independently, we build a compacted vertex buffer containing only the used vertices
     *   and remap indices accordingly.
     *
     * Complexity:
     * - O(indexCount) time, O(uniqueVerticesInSubmesh) additional memory.
     * @param mesh
     * @param sm
     * @returns
     */
    private _extractSubMesh;
    /**
     * Group items by a computed key.
     * Used to group instances by sourceMesh so the resulting XML is easier to read and debug.
     * @param items
     * @param key
     * @returns
     */
    private _groupBy;
    /**
     * Basis conversion from Babylon coordinate system to the expected 3MF coordinate system.
     *
     * Here we rotate +90 degrees around X:
     * - This is commonly used to convert between Y-up and Z-up conventions.
     * - Verify this matches your pipeline (Babylon is typically left-handed Y-up).
     */
    private static readonly _R_BJS_TO_3MF;
    /**
     * Converts a Babylon.js 4x4 matrix into a 3MF 3x4 transform matrix and writes the result into ref.
     *
     * Babylon.js conventions:
     * - Babylon exposes matrices with logical row/column indexing (M(row, column)).
     * - It stores the 16 coefficients in a contiguous array in row-major order:
     *   [ M00, M01, M02, M03,
     *     M10, M11, M12, M13,
     *     M20, M21, M22, M23,
     *     M30, M31, M32, M33 ]
     *
     * 3MF expectation:
     * - 3MF uses an affine transform represented as a 3x4 matrix (12 values).
     * - The values are taken from the first 3 columns of the 4x4 matrix, across the 4 rows:
     *   m00 m01 m02  m10 m11 m12  m20 m21 m22  m30 m31 m32
     *
     * Steps:
     * 1) Compose Babylon transform with the basis change:
     *    tmp = tBjs * _R_BJS_TO_3MF
     * 2) Extract the 12 coefficients in 3MF order from tmp.m.
     *
     * Interop note:
     * - Do not transpose here. We only reorder values to match the 3MF 3x4 serialization order.
     * - Transposition is only relevant when interfacing with code that assumes column-major storage.
     *
     * @param tBjs Babylon.js 4x4 matrix.
     * @param ref Output 3MF 3x4 matrix container (ref.values assigned).
     * @returns ref, for chaining.
     */
    private _handleBabylonTo3mfMatrixTransformToRef;
}
