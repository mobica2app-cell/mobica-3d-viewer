-- Repair Mobica sharing schema.
-- The previously recorded 20261103114157 migration was empty.
-- This forward migration creates the schema expected by share-model and cleanup-shares.

create table if not exists public.model_shares (
  id uuid primary key,
  object_path text not null unique,
  filename text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint model_shares_object_path_not_empty check (length(trim(object_path)) > 0),
  constraint model_shares_filename_not_empty check (length(trim(filename)) > 0)
);

create index if not exists model_shares_expires_at_idx
  on public.model_shares (expires_at);

alter table public.model_shares enable row level security;

revoke all on table public.model_shares from anon, authenticated;
grant all on table public.model_shares to service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'mobica-model-shares',
  'mobica-model-shares',
  false,
  94371840,
  array['model/gltf-binary', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
