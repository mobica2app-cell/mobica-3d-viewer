import { useEffect, useRef, useState } from 'react'
import { Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, CubeTexture, AbstractMesh, Mesh, PBRMaterial, StandardMaterial, Texture, HighlightLayer, BoundingInfo, Node, PointerEventTypes } from '@babylonjs/core'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF'
import { GLTF2Export } from '@babylonjs/serializers/glTF'
import { Upload, Eye, EyeOff, Trash2, Download, Layers, Paintbrush, RotateCcw, Box, ChevronRight, ChevronDown, Share2, Copy, Clock, ExternalLink, Search, X, Undo2, Redo2 } from 'lucide-react'
import './styles.css'

type Item = { id: number; name: string; depth: number; visible: boolean; hasMesh: boolean; parentId: number | null }
type Editor = { scene: Scene; camera: ArcRotateCamera; highlight: HighlightLayer; nodes: Map<number, Node>; rootNodes: Node[] }
type ModelSnapshot = { hiddenIds: Set<number>; deletedIds: Set<number> }

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

function EditorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const modelRef = useRef<{ roots: Node[]; fileName: string; hiddenIds: Set<number>; deletedIds: Set<number> } | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const selectedIdsRef = useRef<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [layerSearch, setLayerSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Upload a GLB model to begin')
  const [filename, setFilename] = useState('')
  const [exposure, setExposure] = useState(1)
  const [environment, setEnvironment] = useState(0.32)
  const [quality, setQuality] = useState(75)
  const [color, setColor] = useState('#ffffff')
  const [roughness, setRoughness] = useState(0.75)
  const [shareUrl, setShareUrl] = useState('')
  const [shareExpiry, setShareExpiry] = useState<number | null>(null)
  const [shareRemaining, setShareRemaining] = useState('')
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)
  const undoStackRef = useRef<ModelSnapshot[]>([])
  const redoStackRef = useRef<ModelSnapshot[]>([])
  


  const captureSnapshot = (): ModelSnapshot => ({
    hiddenIds: new Set(modelRef.current?.hiddenIds ?? []),
    deletedIds: new Set(modelRef.current?.deletedIds ?? []),
  })
  const syncHistoryCounts = () => {
    setUndoCount(undoStackRef.current.length)
    setRedoCount(redoStackRef.current.length)
  }
  const pushHistory = () => {
    if (!modelRef.current) return
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
    modelRef.current.hiddenIds = new Set(snapshot.hiddenIds)
    modelRef.current.deletedIds = new Set(snapshot.deletedIds)
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
    const current = selectedIdsRef.current
    const next = additive && id != null
      ? current.has(id) ? new Set([...current].filter(x => x !== id)) : new Set([...current, id])
      : id == null ? new Set<number>() : new Set([id])
    selectedIdsRef.current = next
    setSelectedIds(next)
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
    if (mat instanceof PBRMaterial) { setColor(mat.albedoColor.toHexString()); setRoughness(mat.roughness ?? 0.75) }
    else if (mat instanceof StandardMaterial) setColor(mat.diffuseColor.toHexString())
  }
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
    const ed: Editor = { scene, camera, highlight, nodes: new Map(), rootNodes: [] }
    editorRef.current = ed
    scene.onPointerObservable.add(info => {
      if (info.type !== PointerEventTypes.POINTERDOWN) return
      const picked = info.pickInfo?.pickedMesh
      if (!picked || !modelRef.current) return
      let current: Node | null = picked
      while (current && !ed.nodes.has(current.uniqueId)) current = current.parent
      const pointerEvent = info.event as PointerEvent | undefined
      if (current) select(current.uniqueId, !!(pointerEvent?.ctrlKey || pointerEvent?.metaKey || pointerEvent?.shiftKey))
    })
    engine.runRenderLoop(() => scene.render())
    const resize = () => engine.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); canvasRef.current?.removeEventListener('wheel', preventPageWheel); editorRef.current = null; engineRef.current = null; engine.dispose() }
  }, [])
  const load = async (file: File) => {
    const ed = editorRef.current
    if (!ed) return
    setBusy(true); setStatus('Loading model…')
    const url = URL.createObjectURL(file)
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', url, ed.scene, undefined, '.glb')
      modelRef.current?.roots.forEach(root => root.dispose(false, true))
      const imported = [...result.transformNodes, ...result.meshes]
      const ids = new Set(imported.map(n => n.uniqueId))
      const roots = imported.filter(n => !n.parent || !ids.has(n.parent.uniqueId))
      modelRef.current = { roots, fileName: file.name, hiddenIds: new Set(), deletedIds: new Set() }
      undoStackRef.current = []; redoStackRef.current = []; syncHistoryCounts()
      selectedIdsRef.current = new Set()
      setSelectedIds(new Set())
      setSelected(null)
      ed.rootNodes = roots
      const boxMeshes = result.meshes.filter(m => m.getTotalVertices() > 0)
      if (boxMeshes.length) {
        let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const mesh of boxMeshes) {
          mesh.computeWorldMatrix(true)
          const box: BoundingInfo = mesh.getBoundingInfo()
          min = Vector3.Minimize(min, box.boundingBox.minimumWorld)
          max = Vector3.Maximize(max, box.boundingBox.maximumWorld)
        }
        const center = min.add(max).scale(0.5)
        const radius = Math.max(max.subtract(min).length() * 0.75, 0.5)
        ed.camera.setTarget(center)
        ed.camera.radius = radius
        ed.camera.maxZ = Math.max(radius * 100, 100)
        ed.camera.wheelPrecision = Math.max(10, radius * 8)
      }
      setFilename(file.name)
      setExpanded(new Set(roots.map(r => r.uniqueId)))
      select(null)
      refresh()
      setStatus(`${result.meshes.length} meshes loaded`)
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
  const remove = () => {
    const model = modelRef.current
    const ids = selectedIds.size ? [...selectedIds] : selected == null ? [] : [selected]
    if (!model || !ids.length) return
    pushHistory()
    ids.forEach(id => {
      model.deletedIds.add(id)
      model.hiddenIds.delete(id)
    })
    applyModelState()
    select(null); refresh(); setStatus(`Deleted ${ids.length} layer${ids.length === 1 ? '' : 's'} · available in Undo`)
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

  const exportGLB = async () => {
    if (!editorRef.current || !modelRef.current) return
    setBusy(true); setStatus('Exporting visible model…')
    try {
      const blob = await exportSceneBlob('mobica-edited')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'mobica-edited.glb'; a.click()
      URL.revokeObjectURL(url)
      setStatus(`Compressed GLB exported · ${(blob.size / 1024 / 1024).toFixed(2)} MB`)
    } catch (err) { setStatus(`Export error: ${String(err)}`); console.error(err) }
    finally { setBusy(false) }
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
    return <div className={`layer ${selectedIds.has(item.id) ? 'active' : ''}`} key={item.id} style={{ paddingLeft: 12 + item.depth * 17 }}>
      <button className="chevron" onClick={() => { setExpanded(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n }) }}>
        {hasChildren ? expanded.has(item.id) ? <ChevronDown size={14}/> : <ChevronRight size={14}/> : <span style={{width:14}}/>}
      </button>
      <button className="layerName" onClick={(e) => select(item.id, e.ctrlKey || e.metaKey || e.shiftKey)} title={`${item.name} · Ctrl/Cmd-click to multi-select`}>{item.name}</button>
      <button className="iconBtn" title="Hide/show" onClick={() => toggleVisibility(item.id)}>{item.visible ? <Eye size={15}/> : <EyeOff size={15}/>}</button>
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

  return <div className="app">
    <header className="topbar"><div className="brand"><span className="logo"><Box size={21}/></span><div><strong>MOBICA</strong><small>3D MATERIAL STUDIO</small></div></div>
      <div className="toolbar"><button className="btn historyBtn" onClick={undo} disabled={!undoCount || busy} title="Undo (last 10 hide/delete actions)"><Undo2 size={15}/> Undo</button><button className="btn historyBtn" onClick={redo} disabled={!redoCount || busy} title="Redo"><Redo2 size={15}/> Redo</button><label className="btn primary"><Upload size={16}/> Upload GLB<input type="file" accept=".glb" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }}/></label><button className="btn" onClick={exportGLB} disabled={!filename || busy}><Download size={16}/> Export GLB</button><button className="btn primary" onClick={createShareLink} disabled={!filename || busy}><Share2 size={16}/> Create 3-day link</button></div></header>
    <main className="layout"><aside className="sidebar"><div className="panelTitle"><Layers size={16}/> Scene layers <span>{items.length}</span></div><div className="layerBulk"><button className="btn" onClick={() => setAllVisible(true)} disabled={!items.length}><Eye size={14}/> Show all</button><button className="btn" onClick={() => toggleSelectedVisibility(false)} disabled={!selectedIds.size}><EyeOff size={14}/> Hide selected</button></div>
      <div className="layerSearch">
        <Search size={15}/>
        <input aria-label="Search layers" type="search" value={layerSearch} onChange={e => setLayerSearch(e.target.value)} placeholder="Search layers…" />
        {layerSearch && <button className="searchClear" aria-label="Clear layer search" title="Clear search" onClick={() => setLayerSearch('')}><X size={14}/></button>}
      </div>
      {searchTerms.length > 0 && <div className="searchSummary"><span>{matchingLayerIds.size} matching layer{matchingLayerIds.size === 1 ? '' : 's'}</span>{matchingLayerIds.size > 0 && <div className="searchActions"><button className="btn searchHide" onClick={hideMatchingLayers}><EyeOff size={13}/> Hide matches</button><button className="btn searchShow" onClick={unhideMatchingLayers}><Eye size={13}/> Unhide matches</button></div>}</div>}
      <p className="hint">Ctrl/Cmd-click layers to select multiple. Use Show all to restore every hidden object.</p><p className="hint">Click a cabinet door in the model or select its layer here. Hide it to reveal the interior.</p><div className="layers">{items.length ? (searchTerms.length && matchingLayerIds.size === 0 ? <div className="empty">No layers match “{layerSearch}”</div> : items.map(renderItem)) : <div className="empty">No model loaded</div>}</div></aside>
      <section className="viewport"><canvas ref={canvasRef}/><div className="viewportBadge">BABYLON.JS · PBR RENDERER</div>{!filename && <div className="welcome"><Box size={42}/><h2>Furniture model viewer</h2><p>Upload a GLB to inspect materials and hide cabinet doors, shelves or drawers.</p><label className="btn primary"><Upload size={16}/> Open model<input type="file" accept=".glb" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void load(f) }}/></label></div>}<div className="status">{busy ? 'Working… ' : ''}{status}</div></section>
      <aside className="inspector"><div className="panelTitle"><Paintbrush size={16}/> Inspector</div>{selected != null && chosen() ? <><div className="selectedLabel">{selectedIds.size > 1 ? `${selectedIds.size} layers selected · editing primary: ${chosen()?.name}` : chosen()?.name}</div><div className="actions"><button className="btn" onClick={() => toggleSelectedVisibility(false)}><EyeOff size={15}/> Hide selected</button><button className="btn" onClick={() => toggleSelectedVisibility(true)}><Eye size={15}/> Show selected</button><button className="btn danger" onClick={remove}><Trash2 size={15}/> Delete</button></div><label className="field">Base color<input type="color" value={color} onChange={e => updateColor(e.target.value)}/></label><label className="field">Roughness <span>{roughness.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={roughness} onChange={e => updateRoughness(Number(e.target.value))}/></label><label className="btn full"><Upload size={15}/> Replace base-color texture<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) updateTexture(f); e.target.value = '' }}/></label><p className="hint">Texture placement uses the selected mesh's original UV coordinates.</p></> : <p className="hint">Select a layer or click any visible part of the model.</p>}
      <div className="separator"/><div className="panelTitle">Lighting & quality</div><label className="field">Brightness <span>{exposure.toFixed(2)}×</span><input aria-label="Brightness" type="range" min="0.35" max="1.8" step="0.05" value={exposure} onChange={e => { const n = Number(e.target.value); setExposure(n); if (editorRef.current) editorRef.current.scene.imageProcessingConfiguration.exposure = n }}/></label><label className="field">Environment light <span>{environment.toFixed(2)}</span><input aria-label="Environment light" type="range" min="0" max="1.2" step="0.02" value={environment} onChange={e => { const n = Number(e.target.value); setEnvironment(n); if (editorRef.current) editorRef.current.scene.environmentIntensity = n }}/></label><label className="field">Render quality <span>{quality}%</span><input aria-label="Render quality" type="range" min="25" max="100" step="5" value={quality} onChange={e => updateQuality(Number(e.target.value))}/></label><p className="hint">Higher quality increases internal render resolution and texture filtering. It may use more GPU memory and reduce frame rate on slower devices.</p><button className="btn full" onClick={() => { setExposure(1); setEnvironment(0.32); updateQuality(75); if (editorRef.current) { editorRef.current.scene.imageProcessingConfiguration.exposure = 1; editorRef.current.scene.environmentIntensity = 0.32 } }}><RotateCcw size={14}/> Reset lighting & quality</button><p className="hint">Adjust brightness independently from environment reflections and render quality.</p></aside></main>
    {shareUrl && <div className="shareOverlay"><div className="shareDialog"><button className="shareClose" onClick={() => setShareUrl('')}>×</button><div className="shareIcon"><Share2 size={22}/></div><h2>Share model</h2><p>Two versions are included: the full model (with hidden layers restored, but deleted layers removed) and the visible-only model. Editing is disabled.</p><div className="shareUrl">{shareUrl}<button className="iconBtn" title="Copy link" onClick={() => void navigator.clipboard.writeText(shareUrl)}><Copy size={16}/></button></div><div className="shareExpiry"><Clock size={15}/> Link expires in <strong>{shareRemaining || '3d 0h 0m 0s'}</strong></div><div className="shareActions"><button className="btn primary" onClick={() => void navigator.clipboard.writeText(shareUrl)}><Copy size={15}/> Copy link</button><button className="btn" onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={15}/> Preview</button></div></div></div>}
  </div>
}


type ShareInfo = { filename: string; expiresAt: number; visibleUrl: string; fullUrl: string }
function SharedModelViewer({ id, fullId }: { id: string; fullId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState('')
  const [activeTab, setActiveTab] = useState<'full' | 'visible'>('full')
  useEffect(() => {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) { setError('This viewer is not configured.'); return }
    let cancelled = false
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
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer)
  }, [info])
  useEffect(() => {
    if (!info || !canvasRef.current) return
    const canvas = canvasRef.current
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true })
    const scene = new Scene(engine); scene.clearColor = new Color4(1, 1, 1, 1); scene.useRightHandedSystem = true
    scene.imageProcessingConfiguration.toneMappingEnabled = false
    const camera = new ArcRotateCamera('shared-camera', -Math.PI / 3, Math.PI / 2.7, 8, Vector3.Zero(), scene)
    camera.attachControl(canvas, false); camera.lowerRadiusLimit = 0.08; camera.wheelPrecision = 55; camera.panningSensibility = 180
    const hemi = new HemisphericLight('shared-fill', new Vector3(0, 1, 0), scene); hemi.intensity = 0.55
    const sun = new DirectionalLight('shared-key', new Vector3(-0.6, -1.5, -0.7), scene); sun.intensity = 0.65
    scene.environmentTexture = CubeTexture.CreateFromPrefilteredData('https://assets.babylonjs.com/environments/environmentSpecular.env', scene)
    scene.environmentIntensity = 0.45
    let disposed = false
    const loadModel = async () => {
      try {
        const result = await SceneLoader.ImportMeshAsync('', '', activeTab === 'full' ? info.fullUrl : info.visibleUrl, scene, undefined, '.glb')
        if (disposed) return
        const meshes = result.meshes.filter(m => m.getTotalVertices() > 0)
        if (meshes.length) {
          let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
          for (const mesh of meshes) { mesh.computeWorldMatrix(true); const b = mesh.getBoundingInfo().boundingBox; min = Vector3.Minimize(min, b.minimumWorld); max = Vector3.Maximize(max, b.maximumWorld) }
          camera.setTarget(min.add(max).scale(0.5)); camera.radius = Math.max(max.subtract(min).length() * 0.85, 0.5)
        }
      } catch (err) { if (!disposed) setError(`Could not load model: ${String(err)}`) }
    }
    void loadModel()
    engine.runRenderLoop(() => scene.render())
    const resize = () => engine.resize(); window.addEventListener('resize', resize)
    return () => { disposed = true; window.removeEventListener('resize', resize); engine.dispose() }
  }, [info, activeTab])
  return <div className="sharedPage"><header className="sharedHeader"><div className="brand"><span className="logo"><Box size={21}/></span><div><strong>MOBICA</strong><small>3D MODEL PREVIEW</small></div></div><div className="sharedTabs"><button className={activeTab === 'full' ? 'active' : ''} onClick={() => setActiveTab('full')}>Full model</button><button className={activeTab === 'visible' ? 'active' : ''} onClick={() => setActiveTab('visible')}>Visible only</button></div><div className="sharedMeta"><span><Clock size={14}/> {remaining || 'Checking expiry…'}</span><span className="readOnlyTag">READ ONLY</span></div></header><main className="sharedViewport"><canvas ref={canvasRef}/>{!info && !error && <div className="sharedMessage">Loading shared model…</div>}{error && <div className="sharedMessage errorMessage"><h2>Link unavailable</h2><p>{error}</p></div>}{info && !error && <div className="sharedFileName">{info.filename}</div>}<div className="sharedHint">Drag to rotate · Scroll to zoom · Right-click drag to pan</div></main></div>
}

export default function App() {
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/)
  const fullId = new URLSearchParams(window.location.search).get('full') || undefined
  return match ? <SharedModelViewer id={decodeURIComponent(match[1])} fullId={fullId}/> : <EditorApp/>
}
