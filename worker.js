export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || '*'
    const allowedOrigin = env.ALLOWED_ORIGIN || '*'
    const corsOrigin = allowedOrigin === '*' || allowedOrigin === origin ? origin : allowedOrigin
    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    }
    const respond = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...cors, ...headers } })
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    if (request.method === 'POST' && url.pathname === '/api/shares') {
      let form
      try { form = await request.formData() } catch { return respond(JSON.stringify({ error: 'Expected multipart form data.' }), 400, { 'Content-Type': 'application/json' }) }
      const file = form.get('model')
      const filename = String(form.get('filename') || 'Furniture model.glb').slice(0, 180)
      if (!(file instanceof File) || file.size === 0) return respond(JSON.stringify({ error: 'A non-empty GLB model is required.' }), 400, { 'Content-Type': 'application/json' })
      const maxBytes = Number(env.MAX_MODEL_BYTES || 90 * 1024 * 1024)
      if (file.size > maxBytes) return respond(JSON.stringify({ error: `Model exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit.` }), 413, { 'Content-Type': 'application/json' })
      const id = crypto.randomUUID().replaceAll('-', '').slice(0, 20)
      const expiresAt = Date.now() + 3 * 24 * 60 * 60 * 1000
      const key = `shares/${id}/model.glb`
      await env.MODELS.put(key, file.stream(), { httpMetadata: { contentType: 'model/gltf-binary', cacheControl: 'private, max-age=60' }, customMetadata: { originalFilename: filename, expiresAt: String(expiresAt) } })
      await env.SHARES.put(id, JSON.stringify({ id, key, filename, expiresAt }), { expirationTtl: 3 * 24 * 60 * 60 + 3600 })
      return respond(JSON.stringify({ id, expiresAt, sharePath: `/share/${id}` }), 201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    }

    const match = url.pathname.match(/^\/api\/shares\/([a-zA-Z0-9]+)(\/model)?$/)
    if (request.method === 'GET' && match) {
      const id = match[1]
      const record = await env.SHARES.get(id, 'json')
      if (!record || Date.now() >= record.expiresAt) {
        if (record) { await env.SHARES.delete(id); await env.MODELS.delete(record.key) }
        return respond(JSON.stringify({ error: 'This share link has expired or does not exist.' }), 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      }
      if (!match[2]) return respond(JSON.stringify({ id, filename: record.filename, expiresAt: record.expiresAt }), 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      const object = await env.MODELS.get(record.key)
      if (!object) return respond(JSON.stringify({ error: 'The model file is missing.' }), 404, { 'Content-Type': 'application/json' })
      const headers = new Headers(cors)
      object.writeHttpMetadata(headers)
      headers.set('Content-Type', 'model/gltf-binary')
      headers.set('Content-Disposition', `inline; filename="${id}.glb"`)
      headers.set('Cache-Control', 'private, max-age=60')
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type')
      return new Response(object.body, { headers })
    }
    return respond('Not found', 404)
  },

  // Hourly cleanup ensures expired GLB files are removed even if nobody opens their links again.
  async scheduled(controller, env, ctx) {
    const now = Date.now()
    let cursor
    do {
      const page = await env.MODELS.list({ prefix: 'shares/', cursor, limit: 1000 })
      for (const object of page.objects) {
        const expiresAt = Number(object.customMetadata?.expiresAt || 0)
        if (expiresAt && now >= expiresAt) {
          await env.MODELS.delete(object.key)
          const id = object.key.split('/')[1]
          if (id) await env.SHARES.delete(id)
        }
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}
