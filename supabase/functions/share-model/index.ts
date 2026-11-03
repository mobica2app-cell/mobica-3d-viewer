import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
const BUCKET = 'mobica-model-shares'
const MAX_BYTES = 90 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(req.url)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    if (req.method === 'POST') {
      const form = await req.formData()
      const model = form.get('model')
      const originalName = String(form.get('filename') || 'model.glb').slice(0, 240)
      if (!(model instanceof File)) return json({ error: 'Missing GLB model file.' }, 400)
      if (model.size <= 0 || model.size > MAX_BYTES) return json({ error: 'Model must be between 1 byte and 90 MB.' }, 413)
      if (!model.name.toLowerCase().endsWith('.glb')) return json({ error: 'Only GLB files are supported.' }, 400)

      const id = crypto.randomUUID()
      const objectPath = `${id}.glb`
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, model, {
        contentType: 'model/gltf-binary', upsert: false,
      })
      if (uploadError) throw uploadError

      const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      const { error: insertError } = await admin.from('model_shares').insert({
        id, object_path: objectPath, filename: originalName, expires_at: expiresAt,
      })
      if (insertError) {
        await admin.storage.from(BUCKET).remove([objectPath])
        throw insertError
      }
      return json({ id, filename: originalName, expiresAt: new Date(expiresAt).getTime() })
    }

    if (req.method === 'GET') {
      const id = url.searchParams.get('id')
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid share link.' }, 400)
      const { data: share, error } = await admin.from('model_shares')
        .select('id, filename, object_path, expires_at').eq('id', id).maybeSingle()
      if (error) throw error
      if (!share) return json({ error: 'This share link does not exist.' }, 404)
      const expiresMs = new Date(share.expires_at).getTime()
      const remainingSeconds = Math.floor((expiresMs - Date.now()) / 1000)
      if (remainingSeconds <= 0) {
        await admin.storage.from(BUCKET).remove([share.object_path])
        await admin.from('model_shares').delete().eq('id', id)
        return json({ error: 'This share link has expired.' }, 410)
      }
      const { data: signed, error: signError } = await admin.storage.from(BUCKET)
        .createSignedUrl(share.object_path, remainingSeconds, { download: false })
      if (signError) throw signError
      return json({ id: share.id, filename: share.filename, expiresAt: expiresMs, signedUrl: signed.signedUrl })
    }
    return json({ error: 'Method not allowed.' }, 405)
  } catch (error) {
    console.error(error)
    return json({ error: 'Unable to process this share request.' }, 500)
  }
})
