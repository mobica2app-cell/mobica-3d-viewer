# Mobica – Supabase 3-day model sharing

This version uses **Supabase only** for the sharing backend. Cloudflare R2, Workers KV and Wrangler are not used.

## What happens when staff create a link

1. The editor exports the currently edited scene to a GLB. Hidden meshes are excluded and material/texture edits are baked into the exported GLB.
2. The browser sends the GLB to the `share-model` Supabase Edge Function.
3. The function stores the GLB in a **private** Storage bucket and inserts a record into PostgreSQL with a server-generated UUID and an expiry exactly 2 days after upload.
4. The app creates `/share/<uuid>` on the editor's own domain.
5. The read-only viewer asks the Edge Function for the link. The function checks expiry in PostgreSQL and returns a signed Storage URL that cannot outlive the share expiry.
6. Expired links are denied. The optional scheduled cleanup function deletes expired files and rows hourly.

The viewer supports rotate, zoom and pan only. It does not include editor controls.

## 1. Create/configure Supabase

1. Create a Supabase project.
2. Open **SQL Editor** and run the complete `supabase/setup.sql` file.
   - This creates a private bucket named `mobica-model-shares`.
   - It creates `public.model_shares` and enables RLS with no public table policies.
3. In **Project Settings → API**, copy the Project URL and the publishable/anon key.
4. Copy `.env.example` to `.env` and fill in:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Never put the `service_role` key in a Vite environment variable or browser code.

## 2. Deploy the Edge Functions

Install the Supabase CLI and log in, then link this folder to your project:

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy share-model --no-verify-jwt
npx supabase functions deploy cleanup-shares --no-verify-jwt
```

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. The service-role key stays server-side.

## 3. Deploy the editor

```bash
npm run build
```

Deploy the generated `dist` folder to your static host. Configure SPA fallback so `/share/<id>` serves `index.html`; otherwise direct visits to share URLs may return 404. Set the same two `VITE_SUPABASE_*` variables in the hosting provider's build environment.

## 4. Automatic cleanup (recommended)

The link is blocked at expiry even if cleanup is not enabled. To also delete expired GLB objects automatically:

1. In Supabase Dashboard, enable the `pg_cron`, `pg_net`, and `vault` extensions (Database → Extensions).
2. Generate a long random secret and set it for the cleanup Edge Function:

```bash
npx supabase secrets set SHARE_CLEANUP_SECRET=YOUR_LONG_RANDOM_SECRET
```

3. In SQL Editor, replace the URL and secret below and run the two Vault statements, then run the `cron.schedule` statement from the bottom section of `supabase/setup.sql` (uncomment it first).

The job runs hourly. If cleanup is not configured, expired links still stop working, but their stored GLB files remain until cleanup is run.

## API / security notes

- The Storage bucket is private. Public clients cannot list or download its objects directly.
- Only the Edge Functions use the service-role key.
- Share IDs are unguessable UUIDs; anyone possessing a valid link can view the model until expiry.
- This version does not authenticate staff who create shares. The Edge Function is intentionally callable by the browser, so add Supabase Auth and an authorization check before using it as a production internal-only tool.
- Upload limit is 90 MiB; adjust both `supabase/setup.sql` and `MAX_BYTES` in `share-model/index.ts` together if needed.
- The countdown is a display; the server-side database expiry check is authoritative.
