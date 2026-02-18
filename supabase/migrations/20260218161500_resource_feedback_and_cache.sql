-- User feedback for resource relevance/like signals
create table if not exists public.resource_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  module_id text not null,
  module_title text,
  topic_key text not null,
  resource_url text not null,
  relevant boolean,
  liked boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists resource_feedback_unique_user_resource
  on public.resource_feedback(user_id, roadmap_id, module_id, resource_url);

create index if not exists resource_feedback_user_topic_idx
  on public.resource_feedback(user_id, topic_key, relevant);

alter table public.resource_feedback enable row level security;

create policy "Users can read own resource feedback"
  on public.resource_feedback for select
  using (user_id = auth.uid());

create policy "Users can insert own resource feedback"
  on public.resource_feedback for insert
  with check (user_id = auth.uid());

create policy "Users can update own resource feedback"
  on public.resource_feedback for update
  using (user_id = auth.uid());

create policy "Users can delete own resource feedback"
  on public.resource_feedback for delete
  using (user_id = auth.uid());

drop trigger if exists update_resource_feedback_updated_at on public.resource_feedback;
create trigger update_resource_feedback_updated_at
before update on public.resource_feedback
for each row execute function public.update_updated_at_column();

-- Shared cache for Serper responses
create table if not exists public.resource_search_cache (
  id uuid primary key default gen_random_uuid(),
  query_hash text not null,
  query_text text not null,
  search_type text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists resource_search_cache_hash_type_idx
  on public.resource_search_cache(query_hash, search_type);

create index if not exists resource_search_cache_exp_idx
  on public.resource_search_cache(expires_at);

-- Shared cache for YouTube metadata
create table if not exists public.youtube_metadata_cache (
  video_id text primary key,
  title text not null,
  channel text not null,
  duration_minutes integer not null,
  view_count bigint not null default 0,
  like_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists youtube_metadata_cache_exp_idx
  on public.youtube_metadata_cache(expires_at);

drop trigger if exists update_youtube_metadata_cache_updated_at on public.youtube_metadata_cache;
create trigger update_youtube_metadata_cache_updated_at
before update on public.youtube_metadata_cache
for each row execute function public.update_updated_at_column();
