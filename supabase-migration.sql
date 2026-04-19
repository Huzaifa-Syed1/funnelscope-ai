-- ─────────────────────────────────────────────────────────────────
-- FunnelScope — Supabase Schema Migration
-- Run this entire file in your Supabase SQL Editor:
--   https://app.supabase.com → your project → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────

-- 1. Create the funnels table (full schema, safe to run even if it exists)
create table if not exists funnels (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users not null,
  steps       jsonb not null,
  metrics     jsonb,
  insights    text,
  industry    text,
  period      text,
  created_at  timestamptz default now()
);

-- 2. Add columns if the table already exists but is missing them
--    (safe to run multiple times — "if not exists" prevents errors)
alter table funnels add column if not exists insights text;
alter table funnels add column if not exists industry text;
alter table funnels add column if not exists period   text;

-- 3. Enable Row Level Security (users only see their own funnels)
alter table funnels enable row level security;

-- 4. RLS policy — drop first to avoid duplicate errors on re-run
drop policy if exists "Users see own funnels" on funnels;
create policy "Users see own funnels"
  on funnels
  for all
  using (auth.uid() = user_id);

-- 5. Index for fast history queries per user
create index if not exists funnels_user_id_created_at
  on funnels (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────
-- Verification: run this after the migration to confirm structure
-- ─────────────────────────────────────────────────────────────────
-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'funnels'
-- order by ordinal_position;

-- ─────────────────────────────────────────────────────────────────
-- AI CA Chat Usage (optional — for persistent tracking across restarts)
-- The server uses in-memory limits by default.
-- Uncomment and run this if you want persistent usage tracking.
-- ─────────────────────────────────────────────────────────────────
-- create table if not exists chat_usage (
--   id          uuid default gen_random_uuid() primary key,
--   user_id     uuid references auth.users not null,
--   minute_key  text,
--   date_key    text,
--   requests    int default 0,
--   tokens      bigint default 0,
--   updated_at  timestamptz default now()
-- );
-- alter table chat_usage enable row level security;
-- create policy "Users see own usage" on chat_usage
--   for all using (auth.uid() = user_id);
