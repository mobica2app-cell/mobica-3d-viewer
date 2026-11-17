-- Store the customer-facing model name and preview configuration with each single-model share.
alter table public.model_shares
  add column if not exists display_name text not null default '',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.model_shares
set display_name = regexp_replace(filename, '\.glb$', '', 'i')
where coalesce(display_name, '') = '';

alter table public.model_shares
  alter column display_name set not null,
  alter column metadata set default '{}'::jsonb;

create index if not exists model_shares_expires_at_idx
  on public.model_shares (expires_at);
