# Mobica 3D Viewer

React + TypeScript + Vite + Babylon.js furniture/model editor with read-only 3-day GLB sharing.

## Frontend hosting
Use **Cloudflare Pages**, not Workers. See [README-CLOUDFLARE-PAGES.md](README-CLOUDFLARE-PAGES.md).

## Sharing backend
Supabase provides PostgreSQL metadata, private Storage, and Edge Functions. See [README-SHARING.md](README-SHARING.md).

## Local setup
```powershell
npm install
Copy-Item .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
npm run dev
```

Production build:
```powershell
npm run build
```
