-- Single-model Mobica share links with persisted Preview settings.
alter table public.model_shares
  add column if not exists display_name text not null default 'Shared model',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.model_shares
  alter column display_name set not null,
  alter column metadata set default '{}'::jsonb;

create index if not exists model_shares_expires_at_idx
  on public.model_shares (expires_at);
