import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'mobica-model-shares'
const BATCH_SIZE = 500

Deno.serve(async (req) => {
  const expected = Deno.env.get('SHARE_CLEANUP_SECRET')
  if (!expected || req.headers.get('x-cleanup-secret') !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return Response.json({ error: 'Cleanup is not configured.' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const now = new Date().toISOString()
  const { data: expired, error: queryError } = await admin
    .from('model_shares')
    .select('id, object_path')
    .lte('expires_at', now)
    .order('expires_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (queryError) {
    console.error('Failed to query expired shares:', queryError)
    return Response.json({ error: 'Database cleanup query failed.' }, { status: 500 })
  }

  if (!expired?.length) {
    return Response.json({ checked: 0, filesDeleted: 0, rowsDeleted: 0, failed: [] })
  }

  let filesDeleted = 0
  let rowsDeleted = 0
  const failed: Array<{ id: string; stage: string; error: string }> = []

  // Process each object separately. A single failed deletion must not block
  // cleanup of every other expired share in this batch.
  for (const share of expired) {
    const { error: storageError } = await admin.storage
      .from(BUCKET)
      .remove([share.object_path])

    if (storageError) {
      console.error(`Storage deletion failed for ${share.id}:`, storageError)
      failed.push({ id: share.id, stage: 'storage', error: storageError.message })
      continue // Keep the database row so a later scheduled run can retry.
    }
    filesDeleted++

    const { error: rowError } = await admin
      .from('model_shares')
      .delete()
      .eq('id', share.id)

    if (rowError) {
      console.error(`Database row deletion failed for ${share.id}:`, rowError)
      failed.push({ id: share.id, stage: 'database', error: rowError.message })
      continue // Next run retries; removing an already-absent object is harmless.
    }
    rowsDeleted++
  }

  return Response.json({
    checked: expired.length,
    filesDeleted,
    rowsDeleted,
    failed,
    hasMore: expired.length === BATCH_SIZE,
  })
})
