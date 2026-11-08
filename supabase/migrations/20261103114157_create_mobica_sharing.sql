-- Mobica 3-day GLB sharing schema
-- Matches the deployed share-model and cleanup-shares Edge Functions.

-- 1) Share metadata. Only trusted Edge Functions (service role) should access this table.
create table if not exists public.model_shares (
  id uuid primary key,
  object_path text not null unique,
  filename text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint model_shares_object_path_not_empty check (length(trim(object_path)) > 0),
  constraint model_shares_filename_not_empty check (length(trim(filename)) > 0)
);

create index if not exists model_shares_expires_at_idx
  on public.model_shares (expires_at);

alter table public.model_shares enable row level security;

-- No anon/authenticated policies are created: access is through the Edge Functions.
revoke all on table public.model_shares from anon, authenticated;
grant all on table public.model_shares to service_role;

-- 2) Private Storage bucket for exported GLB files.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'mobica-model-shares',
  'mobica-model-shares',
  false,
  94371840,
  array['model/gltf-binary']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally do not add storage.objects policies for anon/authenticated.
-- The Edge Functions use SUPABASE_SERVICE_ROLE_KEY to upload, sign, and delete objects.

