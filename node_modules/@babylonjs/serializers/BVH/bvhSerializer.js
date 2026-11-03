import { AnimationRange } from "@babylonjs/core/Animations/animationRange.js";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Tools } from "@babylonjs/core/Misc/tools.js";
import { Epsilon } from "@babylonjs/core/Maths/math.constants.js";
export class BVHExporter {
    static Export(skeleton, animationNames = [], frameRate) {
        // Validate skeleton
        if (!skeleton || skeleton.bones.length === 0) {
            throw new Error("Invalid or empty skeleton provided");
        }
        // If no animation names provided, use all available animations
        let animationsToExport = animationNames;
        if (!animationNames || animationNames.length === 0) {
            animationsToExport = skeleton.animations.map((anim) => anim.name);
        }
        // Calculate overall animation range from all specified animations
        let overallRange = null;
        for (const animName of animationsToExport) {
            const range = skeleton.getAnimationRange(animName);
            if (range) {
                overallRange = overallRange ? new AnimationRange("animation-range", Math.min(overallRange.from, range.from), Math.max(overallRange.to, range.to)) : range;
            }
        }
        if (!overallRange) {
            // If no animation range found, try to get from any animation
            if (skeleton.animations.length > 0) {
                overallRange = skeleton.getAnimationRange(skeleton.animations[0].name);
            }
            if (!overallRange) {
                throw new Error("No animation range found in skeleton");
            }
        }
        // Calculate frame rate from animation data if not provided
        const actualFrameRate = frameRate || 1 / (skeleton.animations[0]?.framePerSecond || 30);
        // Build bone hierarchy and collect animation data
        const boneHierarchy = this._BuildBoneHierarchy(skeleton, animationsToExport);
        // Calculate frame count from actual animation keyframes
        let frameCount = 0;
        for (const boneData of boneHierarchy) {
            if (boneData.positionKeys.length > 0) {
                frameCount = Math.max(frameCount, boneData.positionKeys.length);
            }
            if (boneData.rotationKeys.length > 0) {
                frameCount = Math.max(frameCount, boneData.rotationKeys.length);
            }
        }
        // Fallback: if no keyframes found, calculate from time range
        if (frameCount === 0) {
            frameCount = Math.floor((overallRange.to - overallRange.from) / actualFrameRate) + 1;
        }
        let exportString = "";
        exportString += `HIERARCHY\n`;
        // Export hierarchy recursively
        exportString += this._ExportHierarchy(boneHierarchy, 0);
        // Export motion data
        exportString += `MOTION\n`;
        exportString += `Frames: ${frameCount}\n`;
        exportString += `Frame Time: ${actualFrameRate.toFixed(6)}\n`;
        // Export frame data
        exportString += this._ExportMotionData(boneHierarchy, frameCount, 0, animationsToExport);
        return exportString;
    }
    static _BuildBoneHierarchy(skeleton, animationNames) {
        const boneMap = new Map();
        const rootBones = [];
        // First pass: create bone data objects
        for (const bone of skeleton.bones) {
            const boneData = {
                bone,
                children: [],
                hasPositionChannels: false,
                hasRotationChannels: false,
                positionKeys: [],
                rotationKeys: [],
            };
            boneMap.set(bone, boneData);
        }
        // Second pass: build hierarchy and collect animation data
        for (const bone of skeleton.bones) {
            const boneData = boneMap.get(bone);
            // Check if bone has animations from the specified animation names
            if (bone.animations.length > 0) {
                for (const animation of bone.animations) {
                    // Only include animations that are in the specified animation names
                    if (animationNames.includes(animation.name)) {
                        if (animation.targetProperty === "position") {
                            boneData.hasPositionChannels = true;
                            boneData.positionKeys.push(...animation.getKeys());
                        }
                        else if (animation.targetProperty === "rotationQuaternion") {
                            boneData.hasRotationChannels = true;
                            boneData.rotationKeys.push(...animation.getKeys());
                        }
                    }
                }
            }
            // Build hierarchy
            if (bone.getParent()) {
                const parentData = boneMap.get(bone.getParent());
                if (parentData) {
                    parentData.children.push(boneData);
                }
            }
            else {
                rootBones.push(boneData);
            }
        }
        return rootBones;
    }
    static _ExportHierarchy(boneData, indentLevel) {
        let result = "";
        const indent = "    ".repeat(indentLevel);
        for (const data of boneData) {
            const bone = data.bone;
            const isEndSite = this._IsEndSite(data);
            if (isEndSite) {
                result += `${indent}End Site\n`;
                result += `${indent}{\n`;
                const offset = this._GetBoneOffset(bone);
                result += `${indent}    OFFSET ${offset.x.toFixed(6)} ${offset.y.toFixed(6)} ${offset.z.toFixed(6)}\n`;
                result += `${indent}}\n`;
            }
            else {
                result += `${indentLevel === 0 ? "ROOT" : `${indent}JOINT`} ${bone.name}\n`;
                result += `${indent}{\n`;
                const offset = this._GetBoneOffset(bone);
                result += `${indent}    OFFSET ${offset.x.toFixed(6)} ${offset.y.toFixed(6)} ${offset.z.toFixed(6)}\n`;
                // Determine channels
                const channels = [];
                if (data.hasPositionChannels) {
                    channels.push("Xposition", "Yposition", "Zposition");
                }
                if (data.hasRotationChannels) {
                    // BVH typically uses ZXY rotation order
                    channels.push("Zrotation", "Xrotation", "Yrotation");
                }
                if (channels.length > 0) {
                    result += `${indent}    CHANNELS ${channels.length} ${channels.join(" ")}\n`;
                }
                // Export children recursively
                if (data.children.length > 0) {
                    result += this._ExportHierarchy(data.children, indentLevel + 1);
                }
                result += `${indent}}\n`;
            }
        }
        return result;
    }
    static _IsEndSite(data) {
        // An end site is a bone with no children (regardless of animation channels)
        return data.children.length === 0;
    }
    static _GetBoneOffset(bone) {
        // Use the bone's rest matrix or local matrix for correct offset
        try {
            if (!bone.getParent()) {
                // Root bone - use rest matrix translation
                return bone.getRestMatrix().getTranslation();
            }
            // For child bones, use local matrix translation
            const localMatrix = bone.getLocalMatrix();
            return localMatrix.getTranslation();
        }
        catch (error) {
            // Fallback to zero offset if matrix operations fail
            return Vector3.Zero();
        }
    }
    static _ExportMotionData(boneData, frameCount, startFrame, animationNames) {
        let result = "";
        for (let frame = 0; frame < frameCount; frame++) {
            const frameValues = [];
            // Collect values for all bones in hierarchy order
            this._CollectFrameValues(boneData, frame + startFrame, frameValues, animationNames);
            result += frameValues.map((v) => v.toFixed(6)).join(" ") + "\n";
        }
        return result;
    }
    static _CollectFrameValues(boneData, frameIndex, values, animationNames) {
        for (const data of boneData) {
            // Skip end sites
            if (this._IsEndSite(data)) {
                continue;
            }
            // Add position values if available
            if (data.hasPositionChannels) {
                const position = this._GetPositionAtFrameIndex(data.positionKeys, frameIndex);
                values.push(position.x, position.y, position.z);
            }
            // Add rotation values if available
            if (data.hasRotationChannels) {
                const rotation = this._GetRotationAtFrameIndex(data.rotationKeys, frameIndex);
                // Convert to Euler angles in ZXY order
                const euler = this._QuaternionToEuler(rotation);
                values.push(euler.z, euler.x, euler.y);
            }
            // Process children recursively
            if (data.children.length > 0) {
                this._CollectFrameValues(data.children, frameIndex, values, animationNames);
            }
        }
    }
    static _GetPositionAtFrameIndex(keys, frameIndex) {
        if (keys.length === 0) {
            return Vector3.Zero();
        }
        // Clamp frame index to valid range
        const clampedIndex = Math.max(0, Math.min(frameIndex, keys.length - 1));
        return keys[clampedIndex].value.clone();
    }
    static _GetRotationAtFrameIndex(keys, frameIndex) {
        if (keys.length === 0) {
            return Quaternion.Identity();
        }
        // Clamp frame index to valid range
        const clampedIndex = Math.max(0, Math.min(frameIndex, keys.length - 1));
        return keys[clampedIndex].value.clone();
    }
    static _QuaternionToEuler(quaternion) {
        // Convert quaternion to Euler angles in ZXY order for BVH
        const matrix = new Matrix();
        quaternion.toRotationMatrix(matrix);
        const m = matrix.m;
        let x, y, z;
        // ZXY rotation order extraction
        const sy = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
        if (sy > Epsilon) {
            x = Math.atan2(m[6], m[10]);
            y = Math.atan2(-m[2], sy);
            z = Math.atan2(m[1], m[0]);
        }
        else {
            x = Math.atan2(-m[9], m[5]);
            y = Math.atan2(-m[2], sy);
            z = 0;
        }
        return new Vector3(Tools.ToDegrees(x), Tools.ToDegrees(y), Tools.ToDegrees(z));
    }
}
//# sourceMappingURL=bvhSerializer.js.map