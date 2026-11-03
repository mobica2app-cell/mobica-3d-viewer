# Deploy Mobica on Cloudflare Pages (Supabase backend)

This project is a Vite single-page app. Deploy the `mobica-3d-viewer` repository to Cloudflare Pages.

Build settings:
- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`

Set these Pages environment variables for Production (and Preview if needed):
- `VITE_SUPABASE_URL` = `https://vznvhcihottddqyolram.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = your Supabase publishable/anon key

The frontend currently calls the `share-model` Edge Function using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It does not need a Cloudflare Worker, R2 bucket, KV namespace, or Wrangler configuration.

Important:
- Never set `SUPABASE_SERVICE_ROLE_KEY` or the database password as a Pages environment variable.
- Commit only `.env.example`; keep your real `.env` out of Git.
- Cloudflare Pages automatically serves the SPA entry point for unknown paths when there is no `404.html`, so `/share/<uuid>` can fall back to `index.html`.
- After changing Pages environment variables, trigger a new deployment.
