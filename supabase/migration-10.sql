-- DOZE · mise à jour 10 : profils Suno suivis, mis à jour automatiquement chaque matin
-- Quand un artiste importe son profil Suno et coche « Mettre à jour chaque matin », DOZE retient ce profil.
-- Chaque jour à 6 h (heure d'Abidjan), le robot « suno-sync » ajoute ses nouvelles chansons publiques.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.
-- Prérequis : la fonction « suno-sync » doit être créée dans Edge Functions (voir le guide).

-- 1. Les profils suivis (un par compte et par pseudo Suno)
create table if not exists public.suno_follows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  handle      text not null check (handle ~ '^[a-z0-9_.-]{1,40}$'),
  artist      text not null check (char_length(artist) between 1 and 80),
  genre       text check (genre is null or char_length(genre) <= 40),
  made_with   text not null default 'Suno' check (char_length(made_with) <= 40),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  last_sync   timestamptz,
  last_added  integer not null default 0,
  unique (user_id, handle)
);
alter table public.suno_follows enable row level security;
revoke all on public.suno_follows from anon, authenticated;
grant select, insert, update, delete on public.suno_follows to authenticated;
drop policy if exists "mes profils suivis" on public.suno_follows;
create policy "mes profils suivis" on public.suno_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Programmation du passage quotidien (6 h UTC = 6 h à Abidjan)
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule('doze-suno-sync') where exists (select 1 from cron.job where jobname = 'doze-suno-sync');
select cron.schedule('doze-suno-sync', '0 6 * * *', $$
  select net.http_post(
    url := 'https://rvliweduwftcmfqailem.supabase.co/functions/v1/suno-sync',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_9aoOKGob8Yj10JUW1RKtPw_d1Jh0j-l","Authorization":"Bearer sb_publishable_9aoOKGob8Yj10JUW1RKtPw_d1Jh0j-l"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

notify pgrst, 'reload schema';

-- Pour vérifier plus tard que le passage du matin a bien eu lieu :
-- select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
