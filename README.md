# Mobica Babylon Corner Cutaway v1.5

This version fixes corner cutaway detection. It identifies two perpendicular planar wall meshes that share an edge, excludes the floor plane, then hides both walls plus meshes whose bounds touch either wall plane and overlap its footprint. Original enabled/disabled states are restored in Room view.

Run `npm install` then `npm run dev`.

Note: accurate wall and attached-object detection requires separate wall/object meshes in the GLB. A single combined mesh cannot be split automatically by visibility toggling.
