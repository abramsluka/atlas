-- MCP server: OAuth clients, single-use auth codes, access/refresh tokens.
-- Only ever touched via createServiceClient() — RLS enabled for hygiene, no policies.

-- OAuth clients (dynamic client registration; public clients, PKCE-only)
create table if not exists mcp_clients (
  client_id     uuid primary key default gen_random_uuid(),
  client_name   text,
  redirect_uris jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

-- Single-use authorization codes
create table if not exists mcp_auth_codes (
  code_hash      text primary key,             -- sha256 hex of the code
  client_id      uuid not null references mcp_clients(client_id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,                -- PKCE, S256 only
  expires_at     timestamptz not null,         -- now() + 10 min
  used_at        timestamptz
);

-- Access + refresh tokens (store hashes, never raw tokens)
create table if not exists mcp_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  uuid references mcp_clients(client_id) on delete cascade,
  kind       text not null check (kind in ('access','refresh')),
  token_hash text not null unique,             -- sha256 hex
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_user on mcp_tokens (user_id, created_at desc);

alter table mcp_clients enable row level security;
alter table mcp_auth_codes enable row level security;
alter table mcp_tokens enable row level security;
