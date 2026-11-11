-- My Life OS — run this once in Supabase: SQL Editor → New query → paste → Run.
-- One table holds every entry (task, note, expense, trip, plan, project, settings) as JSON.
-- Row Level Security makes sure each signed-in person only ever sees their own rows.

create table if not exists public.entries (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.entries enable row level security;

drop policy if exists "read own entries"   on public.entries;
drop policy if exists "insert own entries" on public.entries;
drop policy if exists "update own entries" on public.entries;
drop policy if exists "delete own entries" on public.entries;

create policy "read own entries"   on public.entries for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own entries" on public.entries for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own entries" on public.entries for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own entries" on public.entries for delete to authenticated using (user_id = (select auth.uid()));

-- live updates, so a change on your phone shows up on your laptop
do $$ begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null; end $$;
