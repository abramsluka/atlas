-- Mentor chat history: conversations + messages. The mentor thread used to be
-- localStorage-only; now every exchange persists so past chats are browsable.
-- API routes use the service client; RLS matches the other per-user tables.

create table if not exists mentor_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mentor_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references mentor_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists mentor_messages_conversation_idx on mentor_messages(conversation_id, created_at);
create index if not exists mentor_conversations_user_idx on mentor_conversations(user_id, updated_at desc);

alter table mentor_conversations enable row level security;
alter table mentor_messages enable row level security;

create policy "own conversations" on mentor_conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own messages" on mentor_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
