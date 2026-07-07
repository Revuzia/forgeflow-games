-- 0006_dungeon_forge.sql — Dungeon Forge: shared dungeons + escape leaderboards
-- Applied via Supabase SQL editor / Management API (service role).
--
-- Design: these are PLAYER-GENERATED content tables — anon INSERT is the whole
-- point (players publish dungeons + post times straight from the browser, no
-- auth wall). Size caps + rate discipline live in CHECK constraints; rows are
-- immutable from the client (no UPDATE/DELETE grants to anon/authenticated).

create table if not exists public.df_dungeons (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[A-Z0-9]{4,10}$'),
  name        text not null check (char_length(name) between 1 and 40),
  theme       text not null check (theme in ('fantasy','scifi')),
  difficulty  int  not null default 1 check (difficulty between 1 and 3),
  author      text not null default 'anonymous' check (char_length(author) <= 24),
  data        jsonb not null check (pg_column_size(data) < 262144), -- 256 KB cap
  plays       int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.df_scores (
  id           bigint generated always as identity primary key,
  dungeon_code text not null references public.df_dungeons(code) on delete cascade,
  player       text not null default 'anonymous' check (char_length(player) <= 24),
  time_ms      int  not null check (time_ms > 500 and time_ms < 86400000),
  deaths       int  not null default 0 check (deaths between 0 and 999),
  created_at   timestamptz not null default now()
);

create index if not exists df_scores_by_dungeon on public.df_scores (dungeon_code, time_ms asc);

alter table public.df_dungeons enable row level security;
alter table public.df_scores  enable row level security;

-- public read
drop policy if exists df_dungeons_read on public.df_dungeons;
create policy df_dungeons_read on public.df_dungeons for select using (true);
drop policy if exists df_scores_read on public.df_scores;
create policy df_scores_read on public.df_scores for select using (true);

-- anon insert (player-generated content), no update/delete from clients
drop policy if exists df_dungeons_insert on public.df_dungeons;
create policy df_dungeons_insert on public.df_dungeons for insert with check (true);
drop policy if exists df_scores_insert on public.df_scores;
create policy df_scores_insert on public.df_scores for insert with check (true);
