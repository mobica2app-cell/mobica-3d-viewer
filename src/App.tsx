import { useEffect, useRef, useState } from 'react'
import { Engine, Scene, ArcRotateCamera, Vector3, Quaternion, Color3, Color4, HemisphericLight, DirectionalLight, CubeTexture, AbstractMesh, Mesh, TransformNode, VertexBuffer, VertexData, PBRMaterial, StandardMaterial, Texture, Material, HighlightLayer, BoundingInfo, Node, Matrix, PointerEventTypes, MeshBuilder, LinesMesh } from '@babylonjs/core'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF'
import { GLTF2Export } from '@babylonjs/serializers/glTF'
import { Upload, Eye, EyeOff, Trash2, Download, Layers, Paintbrush, RotateCcw, Box, ChevronRight, ChevronDown, Share2, Copy, Clock, ExternalLink, Search, X, Undo2, Redo2, Scissors, Pencil } from 'lucide-react'
import './styles.css'

type Item = { id: number; name: string; depth: number; visible: boolean; hasMesh: boolean; parentId: number | null }
type CutawayWall = { name: string; root: Node; meshes: AbstractMesh[]; center: Vector3; direction: Vector3 }
type CutawayMaterial = { mesh: AbstractMesh; original: Material; faded: Material; baseAlpha: number }
const cutawayBaseVisibility = new WeakMap<AbstractMesh, boolean>()
type Editor = { scene: Scene; camera: ArcRotateCamera; highlight: HighlightLayer; nodes: Map<number, Node>; rootNodes: Node[]; cutawayWalls: CutawayWall[]; cutawayMaterials: Map<number, CutawayMaterial>; cutawayEnabled: boolean; activeCutawaySignature: string; cutawayCenter: Vector3; cutawaySize: Vector3 }
type ModelSnapshot = { hiddenIds: Set<number>; deletedIds: Set<number>; activeGeneratedIds: Set<number> }

function childrenOf(node: Node): Node[] { return node.getChildren(undefined, true) }
function descendants(node: Node): Node[] { return [node, ...node.getDescendants(false)] }
function setNodeVisible(node: Node, visible: boolean) {
  for (const n of descendants(node)) if (n instanceof AbstractMesh) n.setEnabled(visible)
}
function cloneMaterial(mesh: AbstractMesh) {
  if (!mesh.material) return null
  const cloned = mesh.material.clone(`${mesh.material.name}_mobica_${mesh.uniqueId}`)
  if (cloned) mesh.material = cloned
  return cloned
}
function findMeshes(node: Node): AbstractMesh[] { return descendants(node).filter((n): n is AbstractMesh => n instanceof AbstractMesh) }

// Split a mesh's triangles along a local-space axis plane. Both resulting meshes retain
// their original material, UVs, vertex colors and interpolated normals.
function splitMeshByPlane(source: Mesh, planePoint: Vector3, planeNormal: Vector3, scene: Scene): [Mesh, Mesh] | null {
  const positions = source.getVerticesData(VertexBuffer.PositionKind)
  const indices = source.getIndices()
  if (!positions || !indices || indices.length < 3) return null
  const normals = source.getVerticesData(VertexBuffer.NormalKind)
  const uvs = source.getVerticesData(VertexBuffer.UVKind)
  const colors = source.getVerticesData(VertexBuffer.ColorKind)
  const vertexCount = positions.length / 3
  const colorSize = colors ? colors.length / vertexCount : 0
  const n = planeNormal.normalize()
  type V = { p: number[]; n?: number[]; uv?: number[]; c?: number[] }
  const read = (i: number): V => ({
    p: Array.from(positions.slice(i * 3, i * 3 + 3)),
    ...(normals ? { n: Array.from(normals.slice(i * 3, i * 3 + 3)) } : {}),
    ...(uvs ? { uv: Array.from(uvs.slice(i * 2, i * 2 + 2)) } : {}),
    ...(colors ? { c: Array.from(colors.slice(i * colorSize, i * colorSize + colorSize)) } : {}),
  })
  const distance = (v: V) => (v.p[0] - planePoint.x) * n.x + (v.p[1] - planePoint.y) * n.y + (v.p[2] - planePoint.z) * n.z
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)
  const intersection = (a: V, b: V): V => {
    const da = distance(a), db = distance(b), t = da / (da - db)
    return {
      p: mix(a.p, b.p, t),
      ...(a.n && b.n ? { n: mix(a.n, b.n, t) } : {}),
      ...(a.uv && b.uv ? { uv: mix(a.uv, b.uv, t) } : {}),
      ...(a.c && b.c ? { c: mix(a.c, b.c, t) } : {}),
    }
  }
  const clip = (poly: V[], keepPositive: boolean): V[] => {
    const out: V[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const da = distance(a), db = distance(b)
      const aIn = keepPositive ? da >= -1e-7 : da <= 1e-7
      const bIn = keepPositive ? db >= -1e-7 : db <= 1e-7
      if (aIn && bIn) out.push(b)
      else if (aIn && !bIn) out.push(intersection(a, b))
      else if (!aIn && bIn) out.push(intersection(a, b), b)
    }
    return out
  }
  const build = (positive: boolean, suffix: string): Mesh | null => {
    const outPos: number[] = [], outNorm: number[] = [], outUv: number[] = [], outColor: number[] = [], outIdx: number[] = []
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [read(indices[i]), read(indices[i + 1]), read(indices[i + 2])]
      // A triangle lying exactly on the cut plane belongs to only one half.
      // Duplicating it into both meshes creates coplanar overlap and visible z-fighting.
      if (!positive && triangle.every(vertex => Math.abs(distance(vertex)) < 1e-7)) continue
      const poly = clip(triangle, positive)
      if (poly.length < 3) continue
      const base = outPos.length / 3
      for (const v of poly) {
        outPos.push(...v.p)
        if (v.n) {
          const normal = new Vector3(v.n[0], v.n[1], v.n[2]).normalize()
          outNorm.push(normal.x, normal.y, normal.z)
        }
        if (v.uv) outUv.push(...v.uv)
        if (v.c) outColor.push(...v.c)
      }
      for (let j = 1; j < poly.length - 1; j++) outIdx.push(base, base + j, base + j + 1)
    }
    if (!outIdx.length) return null
    const part = new Mesh(`${source.name || 'Mesh'} ${suffix}`, scene)
    const data = new VertexData()
    data.positions = outPos; data.indices = outIdx
    if (outNorm.length) data.normals = outNorm
    else { VertexData.ComputeNormals(outPos, outIdx, outNorm); data.normals = outNorm }
    if (outUv.length) data.uvs = outUv
    if (outColor.length) data.colors = outColor
    data.applyToMesh(part, true)
    part.material = source.material
    part.renderingGroupId = source.renderingGroupId
    part.isPickable = source.isPickable
    part.parent = source.parent
    part.position.copyFrom(source.position)
    part.scaling.copyFrom(source.scaling)
    part.rotation.copyFrom(source.rotation)
    if (source.rotationQuaternion) part.rotationQuaternion = source.rotationQuaternion.clone()
    part.setEnabled(true)
    return part
  }
  const a = build(false, 'Cut A'), b = build(true, 'Cut B')
  if (!a || !b) { a?.dispose(); b?.dispose(); return null }
  return [a, b]
}

function collectCutawayWalls(nodes: Node[]): CutawayWall[] {
  const all = nodes.flatMap(node => descendants(node))
  const wallPattern = /(^|[ _.-])(wall|walls|mur|partition)([ _.-]|$)/i
  const wallNodes = all.filter(node => wallPattern.test(node.name || ''))
  const topWallNodes = wallNodes.filter(node => {
    let parent = node.parent
    while (parent) {
      if (wallNodes.includes(parent)) return false
      parent = parent.parent
    }
    return true
  })
  const candidates: CutawayWall[] = []
  for (const node of topWallNodes) {
    const meshes = findMeshes(node).filter(mesh => mesh.getTotalVertices() > 0)
    if (!meshes.length) continue
    // Cache every descendant's initial visibility once; the complete wall group is toggled from this stored list.
    for (const mesh of meshes) if (!cutawayBaseVisibility.has(mesh)) cutawayBaseVisibility.set(mesh, mesh.isVisible)
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true)
      const box = mesh.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, box.minimumWorld)
      max = Vector3.Maximize(max, box.maximumWorld)
    }
    const center = min.add(max).scale(0.5)
    candidates.push({ name: node.name || 'Wall', root: node, meshes, center, direction: Vector3.Zero() })
  }
  return candidates
}

function updateAutomaticCutaway(ed: Editor, modelCenter: Vector3, _modelSize: Vector3) {
  // Wall membership and mesh references are collected once when the GLB loads.
  // During camera movement we only compare the four wall groups; meshes are
  // touched only when the set of hidden walls actually changes.
  const cameraPosition = ed.camera.position
  const cameraDirection = new Vector3(cameraPosition.x - modelCenter.x, 0, cameraPosition.z - modelCenter.z)
  if (cameraDirection.lengthSquared() > 1e-6) cameraDirection.normalize()
  const selectedSides = ed.cutawayWalls
    .map(wall => {
      const offset = new Vector3(wall.center.x - modelCenter.x, 0, wall.center.z - modelCenter.z)
      const score = offset.lengthSquared() > 1e-6 ? Vector3.Dot(offset.normalize(), cameraDirection) : -1
      return { wall, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(item => item.wall)
  const hidden = new Set(selectedSides)
  const signature = selectedSides.map(wall => String(wall.root.uniqueId)).sort().join('|')
  if (signature === ed.activeCutawaySignature) return
  ed.activeCutawaySignature = signature

  // Apply the visibility change to every mesh in a wall group in the same JS
  // task. No per-frame material cloning/fading and no parent/transform changes.
  for (const wall of ed.cutawayWalls) {
    const hideWall = hidden.has(wall)
    for (const mesh of wall.meshes) {
      const nextVisible = hideWall ? false : (cutawayBaseVisibility.get(mesh) ?? true)
      if (mesh.isVisible !== nextVisible) mesh.isVisible = nextVisible
    }
  }
}

function EditorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const modelRef = useRef<{ roots: Node[]; fileName: string; hiddenIds: Set<number>; deletedIds: Set<number>; generatedIds: Set<number>; activeGeneratedIds: Set<number> } | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set()) // sidebar checkbox selection for actions
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set()) // 3D/layer focus selection only
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveTargetId, setMoveTargetId] = useState('')
  const [moveLayerQuery, setMoveLayerQuery] = useState('')
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const selectedIdsRef = useRef<Set<number>>(new Set())
  const highlightedIdsRef = useRef<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [layerSearch, setLayerSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportSizes, setExportSizes] = useState<Record<string, number> | null>(null)
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false)
  const invalidateExportSizes = () => { setExportSizes(null); setExportDropdownOpen(false) }
  const [status, setStatus] = useState('Upload a GLB model to begin')
  const [filename, setFilename] = useState('')
  const [exposure, setExposure] = useState(1)
  const [environment, setEnvironment] = useState(0.32)
  const [quality, setQuality] = useState(75)
  const [autoCutaway, setAutoCutaway] = useState(true)
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    ed.cutawayEnabled = autoCutaway
    ed.activeCutawaySignature = ''
    if (!autoCutaway) for (const wall of ed.cutawayWalls) for (const mesh of wall.meshes) { const visible = cutawayBaseVisibility.get(mesh) ?? true; if (mesh.isVisible !== visible) mesh.isVisible = visible }
  }, [autoCutaway])
  const [color, setColor] = useState('#ffffff')
  const [roughness, setRoughness] = useState(0.75)
  const [metallic, setMetallic] = useState(0)
  const [opacity, setOpacity] = useState(1)
  const [cutDrawMode, setCutDrawMode] = useState(false)
  const cutDrawModeRef = useRef(false)
  const cutGestureRef = useRef<{ mesh: Mesh; start: Vector3 } | null>(null)
  const cutTargetRef = useRef<Mesh | null>(null)
  const cutLineRef = useRef<LinesMesh | null>(null)
  const performDrawCutRef = useRef<((mesh: Mesh, start: Vector3, end: Vector3) => void) | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [shareExpiry, setShareExpiry] = useState<number | null>(null)
  const [shareRemaining, setShareRemaining] = useState('')
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)
  const undoStackRef = useRef<ModelSnapshot[]>([])
  const redoStackRef = useRef<ModelSnapshot[]>([])
  



  const commitRename = (id: number) => {
    const ed = editorRef.current
    const node = ed?.nodes.get(id)
    const nextName = renameValue.trim()
    if (node && nextName) {
      node.name = nextName
      refresh()
      setStatus(`Renamed layer to "${nextName}"`)
    }
    setRenamingId(null)
  }

  // Alt + left-drag marquee selection. Normal left-drag remains reserved for orbiting.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let start: { x: number; y: number } | null = null
    let current: { x: number; y: number } | null = null
    const localPoint = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || cutDrawModeRef.current || !modelRef.current) return
      if (event.altKey || !event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      start = current = localPoint(event)
      canvas.setPointerCapture(event.pointerId)
      setMarquee({ x: start.x, y: start.y, width: 0, height: 0 })
    }
    const move = (event: PointerEvent) => {
      if (!start) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      current = localPoint(event)
      setMarquee({
        x: Math.min(start.x, current.x), y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y),
      })
    }
    const up = (event: PointerEvent) => {
      if (!start || !current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const a = start, b = current
      start = current = null
      setMarquee(null)
      if (Math.abs(b.x - a.x) < 5 || Math.abs(b.y - a.y) < 5) return
      const ed = editorRef.current
      const engine = engineRef.current
      if (!ed || !engine) return
      const rect = canvas.getBoundingClientRect()
      const sx = Math.min(a.x, b.x), sy = Math.min(a.y, b.y)
      const ex = Math.max(a.x, b.x), ey = Math.max(a.y, b.y)
      const viewport = ed.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
      const selectedNodes = new Set<number>()
      for (const mesh of ed.scene.meshes) {
        if (!(mesh instanceof AbstractMesh) || !mesh.isEnabled() || mesh.getTotalVertices() === 0) continue
        mesh.computeWorldMatrix(true)
        const bounds = mesh.getBoundingInfo().boundingBox
        const corners = [
          new Vector3(bounds.minimumWorld.x, bounds.minimumWorld.y, bounds.minimumWorld.z),
          new Vector3(bounds.minimumWorld.x, bounds.minimumWorld.y, bounds.maximumWorld.z),
          new Vector3(bounds.minimumWorld.x, bounds.maximumWorld.y, bounds.minimumWorld.z),
          new Vector3(bounds.minimumWorld.x, bounds.maximumWorld.y, bounds.maximumWorld.z),
          new Vector3(bounds.maximumWorld.x, bounds.minimumWorld.y, bounds.minimumWorld.z),
          new Vector3(bounds.maximumWorld.x, bounds.minimumWorld.y, bounds.maximumWorld.z),
          new Vector3(bounds.maximumWorld.x, bounds.maximumWorld.y, bounds.minimumWorld.z),
          new Vector3(bounds.maximumWorld.x, bounds.maximumWorld.y, bounds.maximumWorld.z),
        ]
        const projected = corners.map(point => Vector3.Project(point, Matrix.Identity(), ed.scene.getTransformMatrix(), viewport))
        const screenX = projected.map(p => p.x * rect.width / engine.getRenderWidth())
        const screenY = projected.map(p => p.y * rect.height / engine.getRenderHeight())
        const minX = Math.min(...screenX), maxX = Math.max(...screenX)
        const minY = Math.min(...screenY), maxY = Math.max(...screenY)
        if (maxX < sx || minX > ex || maxY < sy || minY > ey) continue
        let node: Node | null = mesh
        while (node && !ed.nodes.has(node.uniqueId)) node = node.parent
        if (node) selectedNodes.add(node.uniqueId)
      }
      const ids = [...selectedNodes]
      if (ids.length) {
        select(ids[0], false)
        for (const id of ids.slice(1)) select(id, true)
        setStatus(`Selected ${ids.length} layer${ids.length === 1 ? '' : 's'}`)
      }
    }
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('pointermove', move, true)
    canvas.addEventListener('pointerup', up, true)
    canvas.addEventListener('pointercancel', up, true)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('pointermove', move, true)
      canvas.removeEventListener('pointerup', up, true)
      canvas.removeEventListener('pointercancel', up, true)
    }
  }, [items])

  const captureSnapshot = (): ModelSnapshot => ({
    hiddenIds: new Set(modelRef.current?.hiddenIds ?? []),
    deletedIds: new Set(modelRef.current?.deletedIds ?? []),
    activeGeneratedIds: new Set(modelRef.current?.activeGeneratedIds ?? []),
  })
  const syncHistoryCounts = () => {
    setUndoCount(undoStackRef.current.length)
    setRedoCount(redoStackRef.current.length)
  }
  const pushHistory = () => {
    if (!modelRef.current) return
    invalidateExportSizes()
    undoStackRef.current.push(captureSnapshot())
    if (undoStackRef.current.length > 10) undoStackRef.current.shift()
    redoStackRef.current = []
    syncHistoryCounts()
  }
  const applyModelState = () => {
    const model = modelRef.current
    if (!model) return
    const all: Node[] = []
    model.roots.forEach(root => all.push(...descendants(root)))
    all.forEach(node => { if (node instanceof AbstractMesh) node.setEnabled(true) })
    for (const id of model.hiddenIds) {
      const node = all.find(n => n.uniqueId === id)
      if (node) setNodeVisible(node, false)
    }
    for (const id of model.deletedIds) {
      const node = all.find(n => n.uniqueId === id)
      if (node) setNodeVisible(node, false)
    }
  }
  const applySnapshot = (snapshot: ModelSnapshot) => {
    if (!modelRef.current) return
    invalidateExportSizes()
    modelRef.current.hiddenIds = new Set(snapshot.hiddenIds)
    modelRef.current.deletedIds = new Set(snapshot.deletedIds)
    modelRef.current.activeGeneratedIds = new Set(snapshot.activeGeneratedIds)
    applyModelState()
    refresh()
    select(null)
  }
  const undo = () => {
    if (!undoStackRef.current.length) return
    redoStackRef.current.push(captureSnapshot())
    const previous = undoStackRef.current.pop()!
    applySnapshot(previous)
    syncHistoryCounts()
    setStatus('Undo')
  }
  const redo = () => {
    if (!redoStackRef.current.length) return
    undoStackRef.current.push(captureSnapshot())
    if (undoStackRef.current.length > 10) undoStackRef.current.shift()
    const next = redoStackRef.current.pop()!
    applySnapshot(next)
    syncHistoryCounts()
    setStatus('Redo')
  }

  // Case-insensitive, accent-insensitive, multi-term layer search.
  const normalizeLayerText = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  const searchTerms = normalizeLayerText(layerSearch).split(/\s+/).filter(Boolean)
  const matchingLayerIds = new Set(
    searchTerms.length
      ? items.filter(item => {
          const name = normalizeLayerText(item.name)
          return searchTerms.every(term => name.includes(term))
        }).map(item => item.id)
      : items.map(item => item.id)
  )
  const displayedLayerIds = new Set(matchingLayerIds)
  if (searchTerms.length) {
    for (const item of items) {
      if (!matchingLayerIds.has(item.id)) continue
      let parentId = item.parentId
      while (parentId != null) {
        displayedLayerIds.add(parentId)
        parentId = items.find(candidate => candidate.id === parentId)?.parentId ?? null
      }
    }
  }
  const hideMatchingLayers = () => {
    const ed = editorRef.current
    if (!ed || !searchTerms.length || matchingLayerIds.size === 0) return
    pushHistory()
    for (const id of matchingLayerIds) {
      const node = ed.nodes.get(id)
      if (node) modelRef.current?.hiddenIds.add(id)
    }
    applyModelState()
    refresh()
    setStatus(`Hidden ${matchingLayerIds.size} matching layer${matchingLayerIds.size === 1 ? '' : 's'}`)
  }

  const unhideMatchingLayers = () => {
    const ed = editorRef.current
    if (!ed || !searchTerms.length || matchingLayerIds.size === 0) return
    pushHistory()
    for (const id of matchingLayerIds) modelRef.current?.hiddenIds.delete(id)
    applyModelState()
    refresh()
    setStatus(`Unhidden ${matchingLayerIds.size} matching layer${matchingLayerIds.size === 1 ? '' : 's'}`)
  }

  const refresh = () => {
    const ed = editorRef.current
    if (!ed) return
    const output: Item[] = []
    ed.nodes.clear()
    const walk = (node: Node, depth: number, parentId: number | null) => {
      ed.nodes.set(node.uniqueId, node)
      if (modelRef.current?.deletedIds.has(node.uniqueId)) return
      output.push({ id: node.uniqueId, name: node.name || `Layer ${node.uniqueId}`, depth, visible: findMeshes(node).some(mesh => mesh.isEnabled()), hasMesh: node instanceof AbstractMesh, parentId })
      childrenOf(node).forEach(child => walk(child, depth + 1, node.uniqueId))
    }
    modelRef.current?.roots.forEach(root => walk(root, 0, null))
    setItems(output)
  }
  const select = (id: number | null, additive = false) => {
    const targetIds = id == null ? [] : [id]
    const current = highlightedIdsRef.current
    const next = additive && id != null
      ? targetIds.reduce((set, targetId) => { set.has(targetId) ? set.delete(targetId) : set.add(targetId); return set }, new Set(current))
      : id == null ? new Set<number>() : new Set(targetIds)
    highlightedIdsRef.current = next
    setHighlightedIds(next)
    const primary = id != null && next.has(id) ? id : (next.values().next().value ?? null)
    setSelected(primary)
    const ed = editorRef.current
    if (!ed) return
    ed.highlight.removeAllMeshes()
    for (const selectedId of next) {
      const selectedNode = ed.nodes.get(selectedId)
      if (selectedNode) for (const mesh of findMeshes(selectedNode)) if (mesh instanceof Mesh && mesh.isEnabled()) ed.highlight.addMesh(mesh, new Color3(0.1, 0.75, 0.95))
    }
    const node = primary == null ? null : ed.nodes.get(primary)
    if (!node) return
    const mat = findMeshes(node).find(m => m.material)?.material
    if (mat instanceof PBRMaterial) {
      setColor(mat.albedoColor.toHexString()); setRoughness(mat.roughness ?? 0.75)
      setMetallic(mat.metallic ?? 0); setOpacity(mat.alpha ?? 1)
    }
    else if (mat instanceof StandardMaterial) { setColor(mat.diffuseColor.toHexString()); setOpacity(mat.alpha ?? 1) }
  }
  const focusLayer = (id: number | null) => {
    setSelected(id)
    const nextHighlight = id == null ? new Set<number>() : new Set([id])
    highlightedIdsRef.current = nextHighlight
    setHighlightedIds(nextHighlight)
    const ed = editorRef.current
    if (!ed) return
    ed.highlight.removeAllMeshes()
    if (id == null) return
    const node = ed.nodes.get(id)
    if (!node) return
    for (const mesh of findMeshes(node)) if (mesh instanceof Mesh && mesh.isEnabled()) ed.highlight.addMesh(mesh, new Color3(0.1, 0.75, 0.95))
    const mat = findMeshes(node).find(m => m.material)?.material
    if (mat instanceof PBRMaterial) {
      setColor(mat.albedoColor.toHexString()); setRoughness(mat.roughness ?? 0.75)
      setMetallic(mat.metallic ?? 0); setOpacity(mat.alpha ?? 1)
    } else if (mat instanceof StandardMaterial) { setColor(mat.diffuseColor.toHexString()); setOpacity(mat.alpha ?? 1) }
  }
  const toggleManualSelection = (id: number, checked: boolean) => {
    const next = new Set(selectedIdsRef.current)
    if (checked) next.add(id); else next.delete(id)
    selectedIdsRef.current = next
    setSelectedIds(next)
  }
  const expandSelectionOneLevel = () => {
    const ed = editorRef.current
    if (!ed || selected == null) return
    const currentNode = ed.nodes.get(selected)
    const parent = currentNode?.parent
    if (!parent || !ed.nodes.has(parent.uniqueId)) return
    const ids = descendants(parent).filter(node => ed.nodes.has(node.uniqueId)).map(node => node.uniqueId)
    if (!ids.length) return
    // Shift expands only the 3D highlight/focus selection. It never checks
    // sidebar action checkboxes.
    const next = new Set(highlightedIdsRef.current)
    ids.forEach(id => next.add(id))
    next.add(parent.uniqueId)
    highlightedIdsRef.current = next
    setHighlightedIds(next)
    setSelected(parent.uniqueId)
    ed.highlight.removeAllMeshes()
    for (const id of next) {
      const node = ed.nodes.get(id)
      if (node) for (const mesh of findMeshes(node)) if (mesh instanceof Mesh && mesh.isEnabled()) ed.highlight.addMesh(mesh, new Color3(0.1, 0.75, 0.95))
    }
    setStatus(`Highlighted ${ids.length + 1} layers from ${parent.name || 'Unnamed group'} · ${next.size} highlighted`)
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Shift' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return
      expandSelectionOneLevel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, items, highlightedIds])

  useEffect(() => {
    if (!canvasRef.current) return
    const engine = new Engine(canvasRef.current, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true })
    engineRef.current = engine
    const scene = new Scene(engine)
    scene.clearColor = new Color4(1, 1, 1, 1)
    scene.useRightHandedSystem = true
    scene.imageProcessingConfiguration.toneMappingEnabled = false // preserve base colors without ACES highlight shifts
    scene.imageProcessingConfiguration.exposure = 1
    scene.imageProcessingConfiguration.contrast = 1
    const camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 2.7, 8, Vector3.Zero(), scene)
    camera.attachControl(canvasRef.current, false)
    camera.wheelPrecision = 55
    camera.wheelDeltaPercentage = 0.01
    // Keep wheel gestures inside the 3D viewport; never zoom/scroll the page.
    const preventPageWheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation() }
    canvasRef.current.addEventListener('wheel', preventPageWheel, { passive: false })
    camera.lowerRadiusLimit = 0.08
    camera.minZ = 0.01
    camera.panningSensibility = 180
    const hemi = new HemisphericLight('soft-fill', new Vector3(0, 1, 0), scene)
    hemi.intensity = 0.38
    const sun = new DirectionalLight('soft-key', new Vector3(-0.6, -1.5, -0.7), scene)
    sun.intensity = 0.55
    const env = CubeTexture.CreateFromPrefilteredData('https://assets.babylonjs.com/environments/environmentSpecular.env', scene)
    scene.environmentTexture = env
    scene.environmentIntensity = 0.32
    const highlight = new HighlightLayer('selection', scene)
    const ed: Editor = { scene, camera, highlight, nodes: new Map(), rootNodes: [], cutawayWalls: [], cutawayMaterials: new Map(), cutawayEnabled: true, activeCutawaySignature: '', cutawayCenter: Vector3.Zero(), cutawaySize: Vector3.One() }
    editorRef.current = ed
    scene.onPointerObservable.add(info => {
      if (cutDrawModeRef.current) {
        if (info.type === PointerEventTypes.POINTERDOWN) {
          const mesh = info.pickInfo?.pickedMesh
          const point = info.pickInfo?.pickedPoint
          if (mesh instanceof Mesh && mesh === cutTargetRef.current && point) {
            cutGestureRef.current = { mesh, start: point.clone() }
            cutLineRef.current?.dispose()
            cutLineRef.current = null
          }
          return
        }
        if (info.type === PointerEventTypes.POINTERMOVE && cutGestureRef.current) {
          const pick = scene.pick(scene.pointerX, scene.pointerY, m => m === cutGestureRef.current?.mesh)
          if (pick?.hit && pick.pickedPoint) {
            const start = cutGestureRef.current.start
            if (cutLineRef.current) cutLineRef.current.dispose()
            cutLineRef.current = MeshBuilder.CreateLines('cut-preview', { points: [start, pick.pickedPoint], updatable: false }, scene)
            cutLineRef.current.color = new Color3(1, 0.25, 0.12)
            cutLineRef.current.isPickable = false
          }
          return
        }
        if ((info.type === PointerEventTypes.POINTERUP || info.type === PointerEventTypes.POINTERDOUBLETAP) && cutGestureRef.current) {
          const gesture = cutGestureRef.current
          const pick = scene.pick(scene.pointerX, scene.pointerY, m => m === gesture.mesh)
          cutGestureRef.current = null
          cutLineRef.current?.dispose(); cutLineRef.current = null
          if (pick?.hit && pick.pickedPoint) performDrawCutRef.current?.(gesture.mesh, gesture.start, pick.pickedPoint)
          else setStatus('Draw the cut from one point to another on the same mesh.')
          return
        }
        return
      }
      if (info.type !== PointerEventTypes.POINTERDOWN) return
      const picked = info.pickInfo?.pickedMesh
      if (!picked || !modelRef.current) return
      let current: Node | null = picked
      while (current && !ed.nodes.has(current.uniqueId)) current = current.parent
      const pointerEvent = info.event as PointerEvent | undefined
      if (current) {
        if (pointerEvent?.ctrlKey || pointerEvent?.metaKey) select(current.uniqueId, true)
        else focusLayer(current.uniqueId)
      }
    })
    engine.runRenderLoop(() => {
      if (ed.cutawayEnabled && ed.cutawayWalls.length) updateAutomaticCutaway(ed, ed.cutawayCenter, ed.cutawaySize)
      scene.render()
    })
    const resize = () => engine.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); canvasRef.current?.removeEventListener('wheel', preventPageWheel); editorRef.current = null; engineRef.current = null; engine.dispose() }
  }, [])
  const load = async (file: File) => {
    const ed = editorRef.current
    if (!ed) return
    invalidateExportSizes()
    setBusy(true); setStatus('Loading model…')
    const url = URL.createObjectURL(file)
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', url, ed.scene, undefined, '.glb')
      modelRef.current?.roots.forEach(root => root.dispose(false, true))
      const imported = [...result.transformNodes, ...result.meshes]
      const ids = new Set(imported.map(n => n.uniqueId))
      const roots = imported.filter(n => !n.parent || !ids.has(n.parent.uniqueId))
      modelRef.current = { roots, fileName: file.name, hiddenIds: new Set(), deletedIds: new Set(), generatedIds: new Set(), activeGeneratedIds: new Set() }
      undoStackRef.current = []; redoStackRef.current = []; syncHistoryCounts()
      selectedIdsRef.current = new Set()
      setSelectedIds(new Set())
      highlightedIdsRef.current = new Set()
      setHighlightedIds(new Set())
      setSelected(null)
      ed.rootNodes = roots
      ed.cutawayWalls = collectCutawayWalls(roots)
      ed.cutawayMaterials.clear()
      ed.activeCutawaySignature = ''
      for (const wall of ed.cutawayWalls) for (const mesh of wall.meshes) {
        if (!mesh.material) continue
        const original = mesh.material
        ed.cutawayMaterials.set(mesh.uniqueId, { mesh, original, faded: original, baseAlpha: original.alpha })
      }
      ed.cutawayEnabled = autoCutaway
      const boxMeshes = result.meshes.filter(m => m.getTotalVertices() > 0)
      if (boxMeshes.length) {
        let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const mesh of boxMeshes) {
          mesh.computeWorldMatrix(true)
          const box: BoundingInfo = mesh.getBoundingInfo()
          min = Vector3.Minimize(min, box.boundingBox.minimumWorld)
          max = Vector3.Maximize(max, box.boundingBox.maximumWorld)
        }
        const size = max.subtract(min)
        const center = min.add(max).scale(0.5)
        ed.cutawayCenter.copyFrom(center)
        ed.cutawaySize.copyFrom(size)
        const radius = Math.max(size.length() * 0.75, 0.5)
        ed.camera.setTarget(center)
        ed.camera.radius = radius
        ed.camera.maxZ = Math.max(radius * 100, 100)
        ed.camera.wheelPrecision = Math.max(10, radius * 8)
      }
      setFilename(file.name)
      setExpanded(new Set(roots.map(r => r.uniqueId)))
      select(null)
      refresh()
      setStatus(ed.cutawayWalls.length ? `${result.meshes.length} meshes loaded · ${ed.cutawayWalls.length} cutaway groups detected` : `${result.meshes.length} meshes loaded · no wall groups detected — group objects under components named WALL_FRONT, WALL_BACK, WALL_LEFT or WALL_RIGHT`)
    } catch (err) { setStatus(`Load error: ${String(err)}`); console.error(err) }
    finally { URL.revokeObjectURL(url); setBusy(false) }
  }
  const chosen = () => selected == null ? null : editorRef.current?.nodes.get(selected) || null
  const setAllVisible = (visible: boolean) => {
    const ed = editorRef.current
    if (!ed || !modelRef.current) return
    if (visible) {
      if (!modelRef.current.hiddenIds.size) return
      pushHistory()
      modelRef.current.hiddenIds.clear()
      applyModelState()
    }
    refresh()
    setStatus(visible ? 'All layers are visible' : 'All layers hidden')
  }
  const toggleSelectedVisibility = (visible: boolean) => {
    const ed = editorRef.current
    if (!ed) return
    const ids = selectedIds.size ? [...selectedIds] : selected == null ? [] : [selected]
    if (!ids.length) return
    pushHistory()
    ids.forEach(id => visible ? modelRef.current?.hiddenIds.delete(id) : modelRef.current?.hiddenIds.add(id))
    applyModelState()
    refresh()
    select(selected)
  }

  const moveSelectedToLayer = () => {
    const ed = editorRef.current
    const targetId = Number(moveTargetId)
    if (!ed || !selectedIdsRef.current.size || !moveTargetId) return
    const target = ed.nodes.get(targetId)
    if (!(target instanceof TransformNode)) return

    const selectedNodes = [...selectedIdsRef.current]
      .map(id => ed.nodes.get(id))
      .filter((node): node is TransformNode => node instanceof TransformNode)
    // If both a parent and its child are selected, move only the parent.
    // This avoids moving the child twice and preserves the selected subtree.
    const moving = selectedNodes.filter(node => {
      let parent = node.parent
      while (parent) {
        if (selectedIdsRef.current.has(parent.uniqueId)) return false
        parent = parent.parent
      }
      return true
    })
    if (!moving.length) {
      setStatus('Select at least one movable layer (group or mesh) first.')
      return
    }
    if (moving.some(node => node === target || descendants(node).includes(target))) {
      setStatus('Choose a destination outside the selected layer hierarchy.')
      return
    }

    moving.forEach(node => {
      node.computeWorldMatrix(true)
      const world = node.getWorldMatrix().clone()
      target.computeWorldMatrix(true)
      const parentInverse = target.getWorldMatrix().clone().invert()
      const local = world.multiply(parentInverse)
      const scaling = Vector3.One()
      const rotation = new Quaternion()
      const position = Vector3.Zero()
      local.decompose(scaling, rotation, position)
      node.parent = target
      node.scaling.copyFrom(scaling)
      node.rotationQuaternion = rotation
      node.position.copyFrom(position)
    })
    setMoveTargetId('')
    setMoveLayerQuery('')
    setMovePickerOpen(false)
    refresh()
    invalidateExportSizes()
    setStatus(`Moved ${moving.length} layer${moving.length === 1 ? '' : 's'} into ${target.name || 'the target layer'}`)
  }

  const splitFromDrawnLine = (source: Mesh, worldStart: Vector3, worldEnd: Vector3) => {
    const ed = editorRef.current, model = modelRef.current
    if (!ed || !model) return
    if (Vector3.Distance(worldStart, worldEnd) < 0.01) {
      setStatus('The cut line is too short. Drag a longer line across the mesh.')
      return
    }
    source.computeWorldMatrix(true)
    const inverse = source.getWorldMatrix().clone().invert()
    const localStart = Vector3.TransformCoordinates(worldStart, inverse)
    const localEnd = Vector3.TransformCoordinates(worldEnd, inverse)
    const worldView = ed.camera.getForwardRay().direction
    const localView = Vector3.TransformNormal(worldView, inverse).normalize()
    const localLine = localEnd.subtract(localStart).normalize()
    const normal = Vector3.Cross(localLine, localView).normalize()
    if (normal.lengthSquared() < 1e-8) {
      setStatus('Could not determine the cut plane. Draw the line from a different viewing angle.')
      return
    }
    const parts = splitMeshByPlane(source, localStart, normal, ed.scene)
    if (!parts) {
      setStatus('The drawn line did not divide this mesh into two pieces. Try another line or viewing angle.')
      return
    }
    pushHistory()
    model.deletedIds.add(source.uniqueId)
    model.hiddenIds.delete(source.uniqueId)
    for (const part of parts) {
      model.generatedIds.add(part.uniqueId)
      model.activeGeneratedIds.add(part.uniqueId)
    }
    const wallGroup = ed.cutawayWalls.find(wall => wall.meshes.includes(source))
    const sourceCutawayMaterial = ed.cutawayMaterials.get(source.uniqueId)
    if (wallGroup && sourceCutawayMaterial) {
      wallGroup.meshes = wallGroup.meshes.filter(mesh => mesh !== source)
      for (const part of parts) {
        wallGroup.meshes.push(part)
        cutawayBaseVisibility.set(part, part.isVisible)
        const original = part.material || sourceCutawayMaterial.original
        part.material = original
        ed.cutawayMaterials.set(part.uniqueId, { mesh: part, original, faded: original, baseAlpha: original.alpha })
      }
    }
    source.setEnabled(false)
    ed.rootNodes = model.roots
    applyModelState()
    refresh()
    cutDrawModeRef.current = false
    if (canvasRef.current) editorRef.current?.camera.attachControl(canvasRef.current, true)
    setCutDrawMode(false)
    cutTargetRef.current = null
    select(parts[0].uniqueId)
    setStatus(`Cut "${source.name}" into two pieces along your drawn line.`)
  }
  performDrawCutRef.current = splitFromDrawnLine

  const startDrawCut = () => {
    const node = chosen()
    if (!node) { setStatus('Select the combined wall mesh first.'); return }
    const candidates = findMeshes(node).filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0)
    if (candidates.length !== 1) {
      setStatus('Select the individual combined wall mesh, not its parent collection.')
      return
    }
    cutTargetRef.current = candidates[0]
    editorRef.current?.camera.detachControl()
    cutDrawModeRef.current = true
    setCutDrawMode(true)
    setStatus('Draw a line across the selected wall: click and drag from one edge to the opposite edge.')
  }
  const cancelDrawCut = () => {
    cutDrawModeRef.current = false
    if (canvasRef.current) editorRef.current?.camera.attachControl(canvasRef.current, true)
    cutGestureRef.current = null
    cutTargetRef.current = null
    cutLineRef.current?.dispose()
    cutLineRef.current = null
    setCutDrawMode(false)
    setStatus('Cut drawing cancelled.')
  }

  const updateQuality = (value: number) => {
    setQuality(value)
    const engine = engineRef.current
    const scene = editorRef.current?.scene
    if (!engine || !scene) return
    // Higher quality renders at a denser internal resolution and uses stronger texture filtering.
    const scaling = 1.75 - (value / 100) * 1.25
    engine.setHardwareScalingLevel(scaling)
    const anisotropy = Math.max(1, Math.round((value / 100) * 16))
    for (const texture of scene.textures) texture.anisotropicFilteringLevel = anisotropy
  }
  const toggleVisibility = (id: number) => {
    const node = editorRef.current?.nodes.get(id)
    if (!node) return
    const model = modelRef.current
    if (!model) return
    const next = model.hiddenIds.has(id)
    pushHistory()
    if (next) model.hiddenIds.delete(id); else model.hiddenIds.add(id)
    applyModelState()
    refresh(); select(selected)
  }
  const deleteLayers = (ids: number[]) => {
    const model = modelRef.current
    const validIds = ids.filter(id => model && editorRef.current?.nodes.has(id) && !model.deletedIds.has(id))
    if (!model || !validIds.length) return
    pushHistory()
    validIds.forEach(id => {
      model.deletedIds.add(id)
      model.hiddenIds.delete(id)
    })
    applyModelState()
    select(null)
    refresh()
    setStatus(`Deleted ${validIds.length} layer${validIds.length === 1 ? '' : 's'} · available in Undo`)
  }
  const remove = () => {
    const ids = selectedIds.size ? [...selectedIds] : selected == null ? [] : [selected]
    deleteLayers(ids)
  }
  const deleteLayer = (id: number) => deleteLayers([id])
  const deleteMatchingLayers = () => {
    if (!searchTerms.length || matchingLayerIds.size === 0) return
    deleteLayers([...matchingLayerIds])
  }
  const updateMetallic = (value: number) => {
    setMetallic(value)
    const node = chosen()
    if (!node) return
    for (const mesh of findMeshes(node)) {
      const mat = cloneMaterial(mesh)
      if (mat instanceof PBRMaterial) mat.metallic = value
    }
  }
  const updateOpacity = (value: number) => {
    setOpacity(value)
    const node = chosen()
    if (!node) return
    for (const mesh of findMeshes(node)) {
      const mat = cloneMaterial(mesh)
      if (mat) { mat.alpha = value; mat.transparencyMode = value < 1 ? 2 : 0 }
    }
  }

  const updateColor = (value: string) => {
    setColor(value)
    const node = chosen(); if (!node) return
    for (const mesh of findMeshes(node)) {
      const mat = cloneMaterial(mesh)
      if (mat instanceof PBRMaterial) mat.albedoColor = Color3.FromHexString(value)
      else if (mat instanceof StandardMaterial) mat.diffuseColor = Color3.FromHexString(value)
    }
  }
  const updateRoughness = (value: number) => {
    setRoughness(value)
    const node = chosen(); if (!node) return
    for (const mesh of findMeshes(node)) {
      const mat = mesh.material
      if (mat instanceof PBRMaterial) { const clone = cloneMaterial(mesh); if (clone instanceof PBRMaterial) clone.roughness = value }
    }
  }
  const updateTexture = (file: File) => {
    const ed = editorRef.current, node = chosen(); if (!ed || !node) return
    const url = URL.createObjectURL(file)
    const tex = new Texture(url, ed.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE, () => URL.revokeObjectURL(url), () => URL.revokeObjectURL(url))
    for (const mesh of findMeshes(node)) {
      const mat = cloneMaterial(mesh)
      if (mat instanceof PBRMaterial) { mat.albedoTexture = tex; mat.albedoColor = Color3.White() }
      else if (mat instanceof StandardMaterial) { mat.diffuseTexture = tex; mat.diffuseColor = Color3.White() }
    }
    setColor('#ffffff'); setStatus(`Texture applied: ${file.name}`)
  }
  const exportSceneBlob = async (name: string): Promise<Blob> => {
    const ed = editorRef.current
    const model = modelRef.current
    if (!ed || !model) throw new Error('No model loaded')
    const allowed = new Set<number>()
    const walk = (node: Node) => {
      if (model.deletedIds.has(node.uniqueId)) return
      allowed.add(node.uniqueId)
      childrenOf(node).forEach(walk)
    }
    model.roots.forEach(walk)
    const glb = await GLTF2Export.GLBAsync(ed.scene, name, {
      shouldExportNode: node => allowed.has(node.uniqueId) && (!(node instanceof AbstractMesh) || node.isEnabled()),
      meshCompressionMethod: 'Draco'
    })
    const blob = Object.values(glb.glTFFiles).find((value): value is Blob => value instanceof Blob && value.size > 0)
    if (!blob) throw new Error('Babylon did not return a GLB file')
    return blob
  }

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  const gzipBlob = async (blob: Blob): Promise<Blob> => {
    if (!('CompressionStream' in window)) throw new Error('Gzip compression is not supported by this browser')
    return await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
  }

  const getExportMeshes = () => {
    const model = modelRef.current
    if (!model) throw new Error('No model loaded')
    const allowed = new Set<number>()
    const walk = (node: Node) => {
      if (model.deletedIds.has(node.uniqueId)) return
      allowed.add(node.uniqueId)
      childrenOf(node).forEach(walk)
    }
    model.roots.forEach(walk)
    const hasExcludedAncestor = (node: Node) => {
      let parent = node.parent
      while (parent) {
        if (model.deletedIds.has(parent.uniqueId) || model.hiddenIds.has(parent.uniqueId)) return true
        parent = parent.parent
      }
      return false
    }
    return [...(editorRef.current?.scene.meshes ?? [])].filter(mesh =>
      allowed.has(mesh.uniqueId) && mesh.isEnabled() && mesh.getTotalVertices() > 0 &&
      !hasExcludedAncestor(mesh)
    )
  }

  const exportOBJ = async () => {
    const meshes = getExportMeshes()
    let vertexOffset = 1
    const lines = ['# Mobica compressed OBJ export']
    for (const mesh of meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
      if (!positions) continue
      mesh.computeWorldMatrix(true)
      const world = mesh.getWorldMatrix()
      lines.push(`o ${(mesh.name || 'Mesh').replace(/[\r\n]/g, '_').replace(/\s+/g, '_')}`)
      for (let i = 0; i < positions.length; i += 3) {
        const point = Vector3.TransformCoordinates(new Vector3(positions[i], positions[i + 1], positions[i + 2]), world)
        lines.push(`v ${point.x} ${point.y} ${point.z}`)
      }
      const indices = mesh.getIndices()
      if (indices) {
        for (let i = 0; i + 2 < indices.length; i += 3) lines.push(`f ${indices[i] + vertexOffset} ${indices[i + 1] + vertexOffset} ${indices[i + 2] + vertexOffset}`)
      } else {
        for (let i = 0; i + 2 < positions.length / 3; i += 3) lines.push(`f ${vertexOffset + i} ${vertexOffset + i + 1} ${vertexOffset + i + 2}`)
      }
      vertexOffset += positions.length / 3
    }
    if (vertexOffset === 1) throw new Error('No visible geometry to export')
    const raw = new Blob([lines.join('\n')], { type: 'text/plain' })
    const compressed = await gzipBlob(raw)
    return { raw: raw.size, compressed }
  }

  const exportSTL = async () => {
    const meshes = getExportMeshes()
    const triangles: Array<[Vector3, Vector3, Vector3]> = []
    for (const mesh of meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
      if (!positions) continue
      mesh.computeWorldMatrix(true)
      const world = mesh.getWorldMatrix()
      const indices = mesh.getIndices()
      const count = indices ? indices.length : positions.length / 3
      for (let i = 0; i + 2 < count; i += 3) {
        const getPoint = (index: number) => {
          const offset = (indices ? indices[index] : index) * 3
          return Vector3.TransformCoordinates(new Vector3(positions[offset], positions[offset + 1], positions[offset + 2]), world)
        }
        triangles.push([getPoint(i), getPoint(i + 1), getPoint(i + 2)])
      }
    }
    if (!triangles.length) throw new Error('No visible triangles to export')
    const raw = new ArrayBuffer(84 + triangles.length * 50)
    const view = new DataView(raw)
    const header = new TextEncoder().encode('Mobica binary STL - compressed geometry')
    new Uint8Array(raw, 0, header.length).set(header)
    view.setUint32(80, triangles.length, true)
    let offset = 84
    for (const [a, b, c] of triangles) {
      const normal = Vector3.Cross(b.subtract(a), c.subtract(a)).normalize()
      for (const value of [normal.x, normal.y, normal.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]) {
        view.setFloat32(offset, value, true); offset += 4
      }
      view.setUint16(offset, 0, true); offset += 2
    }
    const blob = new Blob([raw], { type: 'model/stl' })
    const compressed = await gzipBlob(blob)
    return { raw: blob.size, compressed }
  }

  const exportGLTF = async () => {
    const ed = editorRef.current
    const model = modelRef.current
    if (!ed || !model) throw new Error('No model loaded')
    const allowed = new Set<number>()
    const walk = (node: Node) => {
      if (model.deletedIds.has(node.uniqueId)) return
      allowed.add(node.uniqueId)
      childrenOf(node).forEach(walk)
    }
    model.roots.forEach(walk)
    const result = await GLTF2Export.GLTFAsync(ed.scene, 'mobica-edited', {
      shouldExportNode: node => allowed.has(node.uniqueId) && (!(node instanceof AbstractMesh) || node.isEnabled()),
      meshCompressionMethod: 'Draco'
    })
    const entries = Object.entries(result.glTFFiles)
    if (!entries.length) throw new Error('Babylon did not return glTF files')
    return entries.map(([name, value]) => ({
      name: name.split('/').pop() || name,
      blob: value instanceof Blob ? value : new Blob([value], { type: name.endsWith('.gltf') ? 'model/gltf+json' : 'application/octet-stream' })
    }))
  }

  const prepareExportSizes = async () => {
    if (!editorRef.current || !modelRef.current) return
    setExportSizes(null)
    setExportDropdownOpen(true)
    setBusy(true)
    setStatus('Calculating compressed sizes for all export formats…')
    try {
      const sizes: Record<string, number> = {}
      const glb = await exportSceneBlob('mobica-edited')
      sizes.glb = glb.size
      const gltfFiles = await exportGLTF()
      sizes.gltf = gltfFiles.reduce((sum, file) => sum + file.blob.size, 0)
      const obj = await exportOBJ()
      sizes.obj = obj.compressed.size
      const stl = await exportSTL()
      sizes.stl = stl.compressed.size
      setExportSizes(sizes)
      setExportDropdownOpen(true)
      setStatus('Export sizes calculated')
    } catch (err) {
      setStatus(`Could not calculate export sizes: ${String(err)}`)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const exportModel = async (format: 'glb' | 'gltf' | 'obj' | 'stl' = 'glb') => {
    if (!editorRef.current || !modelRef.current) return
    setBusy(true)
    try {
      if (format === 'glb') {
        setStatus('Exporting Draco-compressed GLB…')
        const blob = await exportSceneBlob('mobica-edited')
        downloadBlob(blob, 'mobica-edited.glb')
        setStatus(`Draco-compressed GLB exported · ${(blob.size / 1024 / 1024).toFixed(2)} MB`)
      } else if (format === 'gltf') {
        setStatus('Exporting Draco-compressed glTF assets…')
        const files = await exportGLTF()
        files.forEach(file => downloadBlob(file.blob, file.name))
        setStatus('Draco-compressed glTF exported · keep all downloaded files together')
      } else if (format === 'obj') {
        setStatus('Compressing OBJ geometry with gzip…')
        const result = await exportOBJ()
        downloadBlob(result.compressed, 'mobica-edited.obj.gz')
        setStatus(`OBJ exported · ${(result.compressed.size / 1024 / 1024).toFixed(2)} MB gzip (from ${(result.raw / 1024 / 1024).toFixed(2)} MB)`)
      } else {
        setStatus('Creating and compressing binary STL…')
        const result = await exportSTL()
        downloadBlob(result.compressed, 'mobica-edited.stl.gz')
        setStatus(`Binary STL exported · ${(result.compressed.size / 1024 / 1024).toFixed(2)} MB gzip (from ${(result.raw / 1024 / 1024).toFixed(2)} MB)`)
      }
    } catch (err) {
      setStatus(`Export error: ${String(err)}`)
      console.error(err)
    } finally { setBusy(false) }
  }

  const createShareLink = async () => {
    const ed = editorRef.current
    const model = modelRef.current
    if (!ed || !model) { setStatus('Upload a model before creating a share link'); return }
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) { setStatus('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'); return }
    setBusy(true); setStatus('Preparing two model versions for sharing…')
    const originalHidden = new Set(model.hiddenIds)
    try {
      // Version 1: all non-deleted layers, including layers currently hidden in the editor.
      model.hiddenIds.clear()
      applyModelState()
      setStatus('Compressing full model with Draco…')
      const fullBlob = await exportSceneBlob('mobica-full')

      // Version 2: only currently visible layers; deleted and hidden layers are omitted.
      model.hiddenIds = new Set(originalHidden)
      applyModelState()
      setStatus('Compressing visible-only model with Draco…')
      const visibleBlob = await exportSceneBlob('mobica-visible')

      const upload = async (blob: Blob, suffix: string) => {
        const form = new FormData()
        const baseName = model.fileName.replace(/\.glb$/i, '')
        form.append('model', blob, `${baseName}-${suffix}.glb`)
        form.append('filename', `${baseName}-${suffix}.glb`)
        const response = await fetch(`${supabaseUrl}/functions/v1/share-model`, {
          method: 'POST', headers: { apikey: supabaseKey }, body: form
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `Share upload failed (${response.status})`)
        return data
      }

      setStatus('Uploading full model…')
      const fullShare = await upload(fullBlob, 'full')
      setStatus('Uploading visible-only model…')
      const visibleShare = await upload(visibleBlob, 'visible')
      const url = new URL(`/share/${visibleShare.id}?full=${encodeURIComponent(fullShare.id)}`, window.location.origin).toString()
      const expiresAt = Math.min(Number(fullShare.expiresAt), Number(visibleShare.expiresAt))
      setShareUrl(url); setShareExpiry(expiresAt); setStatus('Two-version share link created · expires in 3 days')
      try { await navigator.clipboard.writeText(url) } catch { /* user can copy from the dialog */ }
    } catch (err) {
      setStatus(`Share error: ${String(err)}`)
      console.error(err)
    } finally {
      model.hiddenIds = originalHidden
      applyModelState()
      refresh()
      setBusy(false)
    }
  }

  const renderItem = (item: Item) => {
    const hasChildren = items.some(n => n.parentId === item.id)
    let p = item.parentId, shown = true
    if (searchTerms.length) {
      shown = displayedLayerIds.has(item.id)
    } else {
      while (p != null) { if (!expanded.has(p)) { shown = false; break }; p = items.find(n => n.id === p)?.parentId ?? null }
    }
    if (!shown) return null
    return <div className={`layer ${selectedIds.has(item.id) ? 'active' : ''} ${highlightedIds.has(item.id) || selected === item.id ? 'focused' : ''}`} key={item.id} style={{ paddingLeft: 12 + item.depth * 17 }}>
      <button className="chevron" onClick={() => { setExpanded(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n }) }}>
        {hasChildren ? expanded.has(item.id) ? <ChevronDown size={14}/> : <ChevronRight size={14}/> : <span style={{width:14}}/>}
      </button>
      <input className="layerSelectCheckbox" type="checkbox" aria-label={`Select ${item.name}`} checked={selectedIds.has(item.id)} onChange={e => toggleManualSelection(item.id, e.target.checked)} />
      {renamingId === item.id
        ? <input className="layerRenameInput" autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onClick={e => e.stopPropagation()} onBlur={() => commitRename(item.id)} onKeyDown={e => { if (e.key === 'Enter') commitRename(item.id); if (e.key === 'Escape') setRenamingId(null) }} />
        : <button className="layerName" onClick={() => focusLayer(item.id)} title={`${item.name} · Click to highlight in the drawing; use the checkbox to select for actions`}>{item.name}</button>}
      <button className="iconBtn" title={`Rename ${item.name}`} aria-label={`Rename ${item.name}`} onClick={() => { setRenameValue(item.name); setRenamingId(item.id) }}><Pencil size={13}/></button>
      <button className="iconBtn" title="Hide/show" aria-label={`Hide or show ${item.name}`} onClick={() => toggleVisibility(item.id)}>{item.visible ? <Eye size={15}/> : <EyeOff size={15}/>}</button>
      <button className="iconBtn layerDeleteBtn" title={`Delete ${item.name}`} aria-label={`Delete ${item.name}`} onClick={() => deleteLayer(item.id)}><Trash2 size={14}/></button>
    </div>
  }
  useEffect(() => {
    if (!shareExpiry) { setShareRemaining(''); return }
    const update = () => {
      const seconds = Math.max(0, Math.floor((shareExpiry - Date.now()) / 1000))
      const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), mins = Math.floor((seconds % 3600) / 60), secs = seconds % 60
      setShareRemaining(seconds <= 0 ? 'Expired' : `${days}d ${hours}h ${mins}m ${secs}s`)
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [shareExpiry])

  useEffect(() => {
    const handleWelcomeMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'MOBICA_UPLOAD_MODEL') return
      const input = document.querySelector<HTMLInputElement>('.toolbar input[type="file"]')
      input?.click()
    }
    window.addEventListener('message', handleWelcomeMessage)
    return () => window.removeEventListener('message', handleWelcomeMessage)
  }, [])

  return <div className="app">
    <header className="topbar"><div className="brand"><div><strong>MOBICA</strong><small>3D MATERIAL STUDIO</small></div></div>
      <div className="toolbar"><button className="btn historyBtn" onClick={undo} disabled={!undoCount || busy} title="Undo (last 10 hide/delete actions)"><Undo2 size={15}/> Undo</button><button className="btn historyBtn" onClick={redo} disabled={!redoCount || busy} title="Redo"><Redo2 size={15}/> Redo</button><label className="btn primary"><Upload size={16}/> Upload GLB<input type="file" accept=".glb" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }}/></label><div className="exportDropdown"><div className="exportMainActions"><button className="btn primary" onClick={() => void exportModel('glb')} disabled={!filename || busy}><Download size={16}/> Download GLB</button><button className="btn exportChevron" aria-label="Show all export formats and sizes" title="Calculate all export sizes" onClick={() => { if (exportDropdownOpen) setExportDropdownOpen(false); else if (exportSizes) setExportDropdownOpen(true); else void prepareExportSizes() }} disabled={!filename || busy}><ChevronDown size={16}/></button></div>{exportDropdownOpen && <div className="exportDropdownMenu"><div className="exportDropdownTitle">Export formats <small>Compressed file sizes</small></div>{(['glb','gltf','obj','stl'] as const).map(format => <div className="exportDropdownRow" key={format}><div className="exportFormatInfo"><strong>{format.toUpperCase()}{format === 'glb' ? ' · Main' : ''}</strong><span>{exportSizes ? `${(exportSizes[format] / 1024 / 1024).toFixed(2)} MB` : 'Calculating…'}</span></div><button className="btn exportRowDownload" onClick={() => { setExportDropdownOpen(false); void exportModel(format) }} disabled={!exportSizes || busy}><Download size={14}/> Download</button></div>)}</div>}</div><button className="btn primary" onClick={createShareLink} disabled={!filename || busy}><Share2 size={16}/> Create 3-day link</button></div></header>
    <main className="layout"><aside className="sidebar"><div className="panelTitle"><Layers size={16}/> Scene layers <span>{items.length}</span></div><div className="layerBulk"><button className="btn" onClick={() => setAllVisible(true)} disabled={!items.length}><Eye size={14}/> Show all</button><button className="btn" onClick={() => toggleSelectedVisibility(false)} disabled={!selectedIds.size}><EyeOff size={14}/> Hide selected</button></div><div className="layerMoveControls"><div className="movePicker"><input aria-label="Find destination layer" value={moveLayerQuery} onFocus={() => setMovePickerOpen(true)} onChange={e => { setMoveLayerQuery(e.target.value); setMovePickerOpen(true); setMoveTargetId('') }} placeholder={selectedIds.size ? `Find destination for ${selectedIds.size} selected…` : 'Select layers first'} disabled={!selectedIds.size}/>{moveTargetId && <button className="moveTargetClear" title="Clear destination" onClick={() => { setMoveTargetId(''); setMoveLayerQuery('') }}>×</button>}{movePickerOpen && selectedIds.size > 0 && <div className="movePickerResults">{items.filter(item => {
        if (selectedIds.has(item.id)) return false
        const node = editorRef.current?.nodes.get(item.id)
        if (!(node instanceof TransformNode)) return false
        const selectedNodes = [...selectedIds].map(id => editorRef.current?.nodes.get(id)).filter((n): n is Node => !!n)
        if (selectedNodes.some(selectedNode => selectedNode === node || descendants(selectedNode).includes(node))) return false
        const path: string[] = [item.name]; let parentId = item.parentId
        while (parentId != null) { const parentItem = items.find(candidate => candidate.id === parentId); if (parentItem) path.unshift(parentItem.name); parentId = parentItem?.parentId ?? null }
        const label = path.join(' / ')
        return !moveLayerQuery.trim() || normalizeLayerText(label).includes(normalizeLayerText(moveLayerQuery))
      }).slice(0, 80).map(item => {
        const path: string[] = [item.name]; let parentId = item.parentId
        while (parentId != null) { const parentItem = items.find(candidate => candidate.id === parentId); if (parentItem) path.unshift(parentItem.name); parentId = parentItem?.parentId ?? null }
        return <button type="button" className={`movePickerOption ${moveTargetId === String(item.id) ? 'chosen' : ''}`} key={item.id} onClick={() => { setMoveTargetId(String(item.id)); setMoveLayerQuery(path.join(' / ')); setMovePickerOpen(false) }}><strong>{item.name}</strong><small>{path.join(' / ')}</small></button>
      })}{items.filter(item => !selectedIds.has(item.id)).length === 0 && <div className="movePickerEmpty">No valid destination layers</div>}</div>}</div><button className="btn" onClick={moveSelectedToLayer} disabled={!selectedIds.size || !moveTargetId}>Move here</button></div>
      <div className="cutawayControl"><label><input type="checkbox" checked={autoCutaway} onChange={e => setAutoCutaway(e.target.checked)} /> <span>Automatic room cutaway</span></label><small>Hides the two camera-facing wall groups together with every nested mesh. Keep all objects that should disappear with a wall inside that wall group.</small></div>
      <div className="layerSearch">
        <Search size={15}/>
        <input aria-label="Search layers" type="search" value={layerSearch} onChange={e => setLayerSearch(e.target.value)} placeholder="Search layers…" />
        {layerSearch && <button className="searchClear" aria-label="Clear layer search" title="Clear search" onClick={() => setLayerSearch('')}><X size={14}/></button>}
      </div>
      {searchTerms.length > 0 && <div className="searchSummary"><span>{matchingLayerIds.size} matching layer{matchingLayerIds.size === 1 ? '' : 's'}</span>{matchingLayerIds.size > 0 && <div className="searchActions"><button className="btn searchHide" onClick={hideMatchingLayers}><EyeOff size={13}/> Hide matches</button><button className="btn searchShow" onClick={unhideMatchingLayers}><Eye size={13}/> Unhide matches</button><button className="btn danger searchDelete" onClick={deleteMatchingLayers}><Trash2 size={13}/> Delete matches</button></div>}</div>}
      <p className="hint">Use the checkboxes to select layers for bulk actions. Click a layer name or an object in the drawing to highlight it.</p><p className="hint">Click a cabinet door in the model or select its layer here. Hide it to reveal the interior.</p><div className="layers">{items.length ? (searchTerms.length && matchingLayerIds.size === 0 ? <div className="empty">No layers match “{layerSearch}”</div> : items.map(renderItem)) : <div className="empty">No model loaded</div>}</div></aside>
      <section className="viewport"><canvas ref={canvasRef}/>{!filename && <iframe className="brandExperienceFrame" src="/brand-experience.html" title="Interactive Mobica 3D brand experience" />}{filename && <div className="viewportBadge">BABYLON.JS · PBR RENDERER</div>}{(filename || busy) && <div className="status">{busy ? 'Working… ' : ''}{status}</div>}</section>
      <aside className="inspector"><div className="panelTitle"><Paintbrush size={16}/> Inspector</div>{selected != null && chosen() ? <><div className="selectedLabel">{selectedIds.size > 1 ? `${selectedIds.size} layers selected · editing primary: ${chosen()?.name}` : chosen()?.name}</div><div className="actions"><button className="btn" onClick={() => toggleSelectedVisibility(false)}><EyeOff size={15}/> Hide selected</button><button className="btn" onClick={() => toggleSelectedVisibility(true)}><Eye size={15}/> Show selected</button><button className="btn danger" onClick={remove}><Trash2 size={15}/> Delete</button></div>
      <div className="editorSection"><div className="editorSectionTitle">Material</div><label className="field">Base color<input type="color" value={color} onChange={e => updateColor(e.target.value)}/></label><label className="field">Roughness <span>{roughness.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={roughness} onChange={e => updateRoughness(Number(e.target.value))}/></label><label className="field">Metallic <span>{metallic.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={metallic} onChange={e => updateMetallic(Number(e.target.value))}/></label><label className="field">Opacity <span>{Math.round(opacity * 100)}%</span><input type="range" min="0.1" max="1" step="0.01" value={opacity} onChange={e => updateOpacity(Number(e.target.value))}/></label><label className="btn full"><Upload size={15}/> Replace base-color texture<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) updateTexture(f); e.target.value = '' }}/></label><p className="hint">Texture placement uses the selected mesh's original UV coordinates.</p></div><div className="editorSection"><div className="editorSectionTitle"><Scissors size={14}/> Interactive mesh cut</div><p className="hint">Select the combined wall mesh, start drawing, then drag a line across the model from one edge to the opposite edge. The line defines the cutting plane from your current camera view.</p>{!cutDrawMode ? <button className="btn full" onClick={startDrawCut} disabled={!chosen()}><Scissors size={14}/> Draw cut on model</button> : <><div className="cutModeNotice">Cut mode active — drag across the selected mesh</div><button className="btn full" onClick={cancelDrawCut}><X size={14}/> Cancel cut</button></>}<p className="hint">Repeat on each new piece to separate all four walls. The cut creates two independently selectable mesh surfaces; it does not add closed caps.</p></div></> : <p className="hint">Select a layer or click any visible part of the model.</p>}
      <div className="separator"/><div className="panelTitle">Lighting & quality</div><label className="field">Brightness <span>{exposure.toFixed(2)}×</span><input aria-label="Brightness" type="range" min="0.35" max="1.8" step="0.05" value={exposure} onChange={e => { const n = Number(e.target.value); setExposure(n); if (editorRef.current) editorRef.current.scene.imageProcessingConfiguration.exposure = n }}/></label><label className="field">Environment light <span>{environment.toFixed(2)}</span><input aria-label="Environment light" type="range" min="0" max="1.2" step="0.02" value={environment} onChange={e => { const n = Number(e.target.value); setEnvironment(n); if (editorRef.current) editorRef.current.scene.environmentIntensity = n }}/></label><label className="field">Render quality <span>{quality}%</span><input aria-label="Render quality" type="range" min="25" max="100" step="5" value={quality} onChange={e => updateQuality(Number(e.target.value))}/></label><p className="hint">Higher quality increases internal render resolution and texture filtering. It may use more GPU memory and reduce frame rate on slower devices.</p><button className="btn full" onClick={() => { setExposure(1); setEnvironment(0.32); updateQuality(75); if (editorRef.current) { editorRef.current.scene.imageProcessingConfiguration.exposure = 1; editorRef.current.scene.environmentIntensity = 0.32 } }}><RotateCcw size={14}/> Reset lighting & quality</button><p className="hint">Adjust brightness independently from environment reflections and render quality.</p></aside></main>
    {shareUrl && <div className="shareOverlay"><div className="shareDialog"><button className="shareClose" onClick={() => setShareUrl('')}>×</button><div className="shareIcon"><Share2 size={22}/></div><h2>Share model</h2><p>Two versions are included: the full model (with hidden layers restored, but deleted layers removed) and the visible-only model. Editing is disabled.</p><div className="shareUrl">{shareUrl}<button className="iconBtn" title="Copy link" onClick={() => void navigator.clipboard.writeText(shareUrl)}><Copy size={16}/></button></div><div className="shareExpiry"><Clock size={15}/> Link expires in <strong>{shareRemaining || '3d 0h 0m 0s'}</strong></div><div className="shareActions"><button className="btn primary" onClick={() => void navigator.clipboard.writeText(shareUrl)}><Copy size={15}/> Copy link</button><button className="btn" onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={15}/> Preview</button></div></div></div>}

  </div>
}


type ShareInfo = { filename: string; expiresAt: number; visibleUrl: string; fullUrl: string }
type SharedModelVariant = {
  roots: Node[]
  walls: CutawayWall[]
  materials: Map<number, CutawayMaterial>
  center: Vector3
  size: Vector3
}
type SharedModelVariants = { visible: SharedModelVariant; all: SharedModelVariant }

function SharedModelViewer({ id, fullId }: { id: string; fullId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState('')
  const [activeTab, setActiveTab] = useState<'visible' | 'all'>('visible')
  const [previewReady, setPreviewReady] = useState(false)
  const [previewProgress, setPreviewProgress] = useState('Preparing model preview…')
  const cameraRef = useRef<ArcRotateCamera | null>(null)
  const sharedEditorRef = useRef<Editor | null>(null)
  const sharedVariantsRef = useRef<SharedModelVariants | null>(null)

  useEffect(() => {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) { setError('This viewer is not configured.'); return }
    let cancelled = false
    setPreviewReady(false)
    setError('')
    setPreviewProgress('Checking share links…')
    const fetchShare = async (shareId: string) => {
      const response = await fetch(`${supabaseUrl}/functions/v1/share-model?id=${encodeURIComponent(shareId)}`, { headers: { apikey: supabaseKey } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'This share link is unavailable or has expired.')
      return data
    }
    Promise.all([fetchShare(id), fetchShare(fullId || id)]).then(([visible, full]) => {
      if (!cancelled) setInfo({
        filename: visible.filename,
        expiresAt: Math.min(Number(visible.expiresAt), Number(full.expiresAt)),
        visibleUrl: visible.signedUrl,
        fullUrl: full.signedUrl,
      })
    }).catch(err => { if (!cancelled) setError(String(err.message || err)) })
    return () => { cancelled = true }
  }, [id, fullId])

  useEffect(() => {
    if (!info) return
    const update = () => {
      const sec = Math.max(0, Math.floor((info.expiresAt - Date.now()) / 1000))
      setRemaining(sec <= 0 ? 'Expired' : `${Math.floor(sec / 86400)}d ${Math.floor(sec % 86400 / 3600)}h ${Math.floor(sec % 3600 / 60)}m ${sec % 60}s`)
      if (sec <= 0) setError('This share link has expired.')
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [info])

  // Both shared tabs use the same live camera-driven cutaway. They differ only
  // in which exported model variant is enabled: visible excludes manually hidden
  // layers, while all includes them.
  useEffect(() => {
    if (!info || !canvasRef.current) return
    const canvas = canvasRef.current
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true })
    const scene = new Scene(engine)
    scene.clearColor = new Color4(1, 1, 1, 1)
    scene.useRightHandedSystem = true
    scene.imageProcessingConfiguration.toneMappingEnabled = false
    scene.imageProcessingConfiguration.exposure = 1
    scene.imageProcessingConfiguration.contrast = 1
    const camera = new ArcRotateCamera('shared-camera', -Math.PI / 3, Math.PI / 2.7, 8, Vector3.Zero(), scene)
    camera.attachControl(canvas, false)
    camera.wheelPrecision = 55
    camera.wheelDeltaPercentage = 0.01
    camera.lowerRadiusLimit = 0.08
    camera.minZ = 0.01
    camera.panningSensibility = 180
    cameraRef.current = camera
    const hemi = new HemisphericLight('soft-fill', new Vector3(0, 1, 0), scene)
    hemi.intensity = 0.38
    const sun = new DirectionalLight('soft-key', new Vector3(-0.6, -1.5, -0.7), scene)
    sun.intensity = 0.55
    scene.environmentTexture = CubeTexture.CreateFromPrefilteredData('https://assets.babylonjs.com/environments/environmentSpecular.env', scene)
    scene.environmentIntensity = 0.32
    const highlight = new HighlightLayer('shared-selection', scene)
    const sharedEd: Editor = {
      scene, camera, highlight, nodes: new Map(), rootNodes: [], cutawayWalls: [],
      cutawayMaterials: new Map(), cutawayEnabled: true, activeCutawaySignature: '',
      cutawayCenter: Vector3.Zero(), cutawaySize: Vector3.One()
    }
    sharedEditorRef.current = sharedEd
    sharedVariantsRef.current = null
    let disposed = false

    const loadVariant = async (url: string) => {
      const result = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, '.glb')
      const imported: Node[] = [...result.transformNodes, ...result.meshes]
      const importedIds = new Set(imported.map(node => node.uniqueId))
      const roots = imported.filter(node => !node.parent || !importedIds.has(node.parent.uniqueId))
      const walls = collectCutawayWalls(roots)
      const materials = new Map<number, CutawayMaterial>()
      for (const wall of walls) {
        for (const mesh of wall.meshes) {
          if (!mesh.material) continue
          const original = mesh.material
          materials.set(mesh.uniqueId, { mesh, original, faded: original, baseAlpha: original.alpha })
        }
      }
      const geometry = result.meshes.filter(mesh => mesh.getTotalVertices() > 0)
      let min = new Vector3(Infinity, Infinity, Infinity)
      let max = new Vector3(-Infinity, -Infinity, -Infinity)
      for (const mesh of geometry) {
        mesh.computeWorldMatrix(true)
        const bounds = mesh.getBoundingInfo().boundingBox
        min = Vector3.Minimize(min, bounds.minimumWorld)
        max = Vector3.Maximize(max, bounds.maximumWorld)
      }
      const center = geometry.length ? min.add(max).scale(0.5) : Vector3.Zero()
      const size = geometry.length ? max.subtract(min) : Vector3.One()
      return { roots, walls, materials, center, size }
    }

    const activateVariant = (variant: SharedModelVariant) => {
      const variants = sharedVariantsRef.current
      if (!variants) return
      for (const root of [...variants.visible.roots, ...variants.all.roots]) root.setEnabled(false)
      for (const root of variant.roots) root.setEnabled(true)
      sharedEd.rootNodes = variant.roots
      sharedEd.cutawayWalls = variant.walls
      sharedEd.cutawayMaterials = variant.materials
      sharedEd.cutawayCenter.copyFrom(variant.center)
      sharedEd.cutawaySize.copyFrom(variant.size)
      sharedEd.cutawayEnabled = true
      sharedEd.activeCutawaySignature = ''
    }

    const loadModels = async () => {
      try {
        setPreviewReady(false)
        setPreviewProgress('Loading both shared model versions…')
        const [visible, all] = await Promise.all([
          loadVariant(info.visibleUrl),
          loadVariant(info.fullUrl)
        ])
        if (disposed) return
        sharedVariantsRef.current = { visible, all }
        camera.setTarget(visible.center)
        camera.radius = Math.max(visible.size.length() * 0.75, 0.5)
        camera.maxZ = Math.max(camera.radius * 100, 100)
        camera.wheelPrecision = Math.max(10, camera.radius * 8)
        activateVariant(activeTab === 'all' ? all : visible)
        const activeWalls = visible.walls
        setPreviewProgress(activeWalls.length ? 'Studio cutaway ready' : 'Model loaded · no wall groups detected for automatic cutaway.')
        setPreviewReady(true)
      } catch (err) {
        if (!disposed) setError(`Could not load shared model: ${String(err)}`)
      }
    }

    void loadModels()
    engine.runRenderLoop(() => {
      if (sharedEd.cutawayEnabled && sharedEd.cutawayWalls.length) {
        updateAutomaticCutaway(sharedEd, sharedEd.cutawayCenter, sharedEd.cutawaySize)
      }
      scene.render()
    })
    const resize = () => engine.resize()
    window.addEventListener('resize', resize)
    return () => {
      disposed = true
      sharedEditorRef.current = null
      sharedVariantsRef.current = null
      cameraRef.current = null
      window.removeEventListener('resize', resize)
      engine.dispose()
    }
  }, [info])

  useEffect(() => {
    const variants = sharedVariantsRef.current
    const sharedEd = sharedEditorRef.current
    if (!variants || !sharedEd || !previewReady) return
    const variant = activeTab === 'all' ? variants.all : variants.visible
    for (const root of [...variants.visible.roots, ...variants.all.roots]) root.setEnabled(false)
    for (const root of variant.roots) root.setEnabled(true)
    sharedEd.rootNodes = variant.roots
    sharedEd.cutawayWalls = variant.walls
    sharedEd.cutawayMaterials = variant.materials
    sharedEd.cutawayCenter.copyFrom(variant.center)
    sharedEd.cutawaySize.copyFrom(variant.size)
    sharedEd.cutawayEnabled = true
    sharedEd.activeCutawaySignature = ''
  }, [activeTab, previewReady])

  return <div className="sharedPage">
    <header className="sharedHeader">
      <div className="brand"><div><strong>MOBICA</strong><small>3D MODEL PREVIEW</small></div></div>
      <div className="sharedTabs">
        <button className={activeTab === 'visible' ? 'active' : ''} onClick={() => setActiveTab('visible')} disabled={!previewReady}>Hidden layers off</button>
        <button className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')} disabled={!previewReady}>Hidden layers on</button>
      </div>
      <div className="sharedMeta"><span><Clock size={14}/> {remaining || 'Checking expiry…'}</span><span className="readOnlyTag">READ ONLY</span></div>
    </header>
    <main className={`sharedViewport ${!previewReady ? 'previewLoading' : ''}`}>
      <canvas ref={canvasRef}/>
      {!previewReady && !error && <div className="sharedMessage previewLoadingMessage"><div className="previewSpinner"/><h2>Preparing your 3D model</h2><p>{previewProgress}</p><small>Please wait while the shared model loads.</small></div>}
      {error && <div className="sharedMessage errorMessage"><h2>Link unavailable</h2><p>{error}</p></div>}
      {previewReady && !error && <><div className="sharedFileName">{info?.filename}</div><div className="sharedHint">Drag to rotate · Scroll to zoom · Right-click drag to pan</div></>}
    </main>
  </div>
}

export default function App() {
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/)
  const fullId = new URLSearchParams(window.location.search).get('full') || undefined
  return match ? <SharedModelViewer id={decodeURIComponent(match[1])} fullId={fullId}/> : <EditorApp/>
}
