# Mobica 3D Viewer — Cloudflare Pages + Supabase

This is a **Vite static website**. Deploy it with **Cloudflare Pages → Connect to Git**.
Do not deploy it as a Cloudflare Worker and do not configure R2 or KV.

## Cloudflare Pages build settings

- Framework preset: Vite
- Production branch: `main`
- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`

## Pages environment variables

Set these for Production (and Preview if you use preview deployments):

- `VITE_SUPABASE_URL` = `https://YOUR_PROJECT_REF.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = your Supabase publishable key (or legacy anon key)

The frontend calls:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/share-model`

No `VITE_SHARE_API_BASE` variable is required by this code.

Never put `SUPABASE_SERVICE_ROLE_KEY`, your database password, or `SHARE_CLEANUP_SECRET` in Cloudflare Pages variables. Those are server-side secrets only.

## Important: no Cloudflare Worker bindings

This project intentionally contains no `wrangler.toml`, `wrangler.jsonc`, Worker entrypoint, R2 binding, or KV binding. Do not create a Worker for the website.

Cloudflare Pages builds the React/Vite app and publishes `dist`. Supabase handles the database, private GLB storage, and share API.

## Deploy from GitHub

1. Push this project to your GitHub repository.
2. In Cloudflare Dashboard, open **Workers & Pages → Create application → Pages → Connect to Git**.
3. Select the repository.
4. Use the build settings above and add the two environment variables.
5. Deploy.

After each push to `main`, Pages automatically rebuilds and deploys.

## Local development

```powershell
npm install
Copy-Item .env.example .env
# Edit .env with your Supabase URL and publishable/anon key
npm run dev
```

## Local production build

```powershell
npm run build
```

The output is written to `dist/`.
