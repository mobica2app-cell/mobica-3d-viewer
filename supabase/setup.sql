-- Run this in Supabase SQL Editor.
-- Private bucket: files can only be accessed by the Edge Functions using service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mobica-model-shares', 'mobica-model-shares', false, 94371840, array['model/gltf-binary', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 94371840;

create table if not exists public.model_shares (
  id uuid primary key,
  object_path text not null unique,
  filename text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists model_shares_expires_at_idx on public.model_shares (expires_at);
alter table public.model_shares enable row level security;
-- No anon/authenticated policies: all table access is performed by Edge Functions with service_role.
revoke all on table public.model_shares from anon, authenticated;

-- Optional automatic cleanup: enable pg_cron and pg_net in Supabase Dashboard first.
-- Add your project URL and a random cleanup secret to Vault, then schedule the request.
-- select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
-- select vault.create_secret('REPLACE_WITH_LONG_RANDOM_SECRET', 'share_cleanup_secret');
-- select cron.schedule(
--   'cleanup-expired-mobica-shares', '0 * * * *',
--   $$ select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cleanup-shares',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'share_cleanup_secret')
--     ),
--     body := '{}'::jsonb
--   ); $$
-- );

-- After enabling pg_cron, pg_net and vault and setting the two secrets:
-- select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
-- select vault.create_secret('YOUR_LONG_RANDOM_SECRET', 'share_cleanup_secret');
-- select cron.schedule(
--   'cleanup-expired-mobica-shares', '0 * * * *',
--   $$ select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cleanup-shares',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret',
--       (select decrypted_secret from vault.decrypted_secrets where name = 'share_cleanup_secret')),
--     body := '{}'::jsonb
--   ); $$
-- );
