-- Conector de Fudo para claude.ai: códigos y tokens OAuth.
-- Solo se guarda el hash de cada token. RLS activado y sin políticas: únicamente
-- el servidor (service role) puede leer o escribir esta tabla.
create table if not exists public.mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  kind text not null check (kind in ('code', 'access', 'refresh')),
  family_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null,
  redirect_uri text,
  code_challenge text,
  scope text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_oauth_tokens_family_idx on public.mcp_oauth_tokens (family_id);
create index if not exists mcp_oauth_tokens_expires_idx on public.mcp_oauth_tokens (expires_at);
alter table public.mcp_oauth_tokens enable row level security;
comment on table public.mcp_oauth_tokens is 'Conector MCP de Fudo: códigos y tokens OAuth (solo hashes). Para desconectar a alguien: poner revoked_at en sus filas.';
