create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key,
  email text unique not null,
  full_name text,
  created_at timestamptz default now()
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chat_shares (
  chat_id uuid primary key references chats(id) on delete cascade,
  owner_user_id uuid not null,
  share_token text unique not null default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chat_members (
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  primary key (chat_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text not null,
  file_url text,
  mime_type text,
  extracted_text text,
  summary text,
  created_at timestamptz default now()
);

create table if not exists document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid,
  chunk_index int not null,
  content text not null,
  embedding vector(384) not null,
  created_at timestamptz default now()
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  document_id uuid references documents(id) on delete set null,
  title text not null,
  payload jsonb not null,
  created_at timestamptz default now()
);

create or replace function match_document_chunks(
  query_embedding vector(384),
  match_count int default 6,
  filter_user_id uuid default null,
  filter_document_ids uuid[] default null
)
returns table (
  id bigint,
  document_id uuid,
  document_title text,
  content text,
  similarity float
)
language sql
as $$
  select
    dc.id,
    dc.document_id,
    d.title as document_title,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where (filter_user_id is null or dc.user_id = filter_user_id)
    and (filter_document_ids is null or dc.document_id = any(filter_document_ids))
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

create index if not exists idx_messages_chat_id on messages(chat_id);
create index if not exists idx_chats_user_id on chats(user_id);
create index if not exists idx_chat_shares_token on chat_shares(share_token);
create index if not exists idx_chat_members_user_id on chat_members(user_id);
create index if not exists idx_documents_user_id on documents(user_id);

create index if not exists idx_document_chunks_embedding
on document_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);
