-- RECALL sync: additive only. Tombstones so delta pulls see deletes, indexes for delta cursors, realtime for instant multi-device updates.
alter table public.reminders add column if not exists deleted_at timestamptz;
alter table public.recurrence_rules add column if not exists deleted_at timestamptz;
alter table public.daily_priorities add column if not exists updated_at timestamptz not null default now();
alter table public.recurrence_exceptions add column if not exists updated_at timestamptz not null default now();

create index if not exists tasks_ws_updated_idx on public.tasks (workspace_id, updated_at);
create index if not exists reminders_ws_updated_idx on public.reminders (workspace_id, updated_at);
create index if not exists recurrence_rules_ws_updated_idx on public.recurrence_rules (workspace_id, updated_at);
create index if not exists recurrence_exceptions_ws_updated_idx on public.recurrence_exceptions (workspace_id, updated_at);
create index if not exists workspace_people_ws_updated_idx on public.workspace_people (workspace_id, updated_at);
create index if not exists daily_context_ws_updated_idx on public.daily_context (workspace_id, updated_at);
create index if not exists work_sessions_ws_updated_idx on public.work_sessions (workspace_id, updated_at);
create index if not exists wsct_ws_updated_idx on public.work_session_clickup_tasks (workspace_id, updated_at);
create index if not exists clickup_tasks_ws_synced_idx on public.clickup_tasks (workspace_id, synced_at);

create trigger recurrence_exceptions_updated_at before update on public.recurrence_exceptions
  for each row execute function public.set_updated_at();
create trigger daily_priorities_updated_at before update on public.daily_priorities
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['tasks','reminders','recurrence_rules','recurrence_exceptions','workspace_people','daily_context','app_preferences','work_sessions','work_session_clickup_tasks','daily_priorities','game_progress','daily_scores','user_achievements','boss_rewards'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
