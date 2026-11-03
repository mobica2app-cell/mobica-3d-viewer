import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const expected = Deno.env.get('SHARE_CLEANUP_SECRET')
  if (!expected || req.headers.get('x-cleanup-secret') !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: expired, error } = await admin.from('model_shares')
    .select('id, object_path').lte('expires_at', new Date().toISOString()).limit(500)
  if (error) return new Response('Database cleanup query failed', { status: 500 })
  if (!expired?.length) return Response.json({ deleted: 0 })
  const paths = expired.map((row) => row.object_path)
  const { error: storageError } = await admin.storage.from('mobica-model-shares').remove(paths)
  if (storageError) return new Response('Storage cleanup failed', { status: 500 })
  const { error: deleteError } = await admin.from('model_shares').delete().in('id', expired.map((row) => row.id))
  if (deleteError) return new Response('Database cleanup failed', { status: 500 })
  return Response.json({ deleted: expired.length })
})
