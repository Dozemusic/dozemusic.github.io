-- DOZE · mise à jour 8 : DOZE Studio (tableau de bord réservé à l'administrateur)
-- Auditeurs uniques (identifiant d'appareil anonyme, déjà utilisé pour les coups de cœur), statistiques globales,
-- et outils de modération (masquer, rétablir). À coller une seule fois dans Supabase > SQL Editor > New query > Run.
-- Ne supprime aucune chanson. Toutes les fonctions ci-dessous exigent la clé administrateur.

-- 1. Auditeurs uniques : l'appli envoie l'identifiant anonyme de l'appareil avec chaque écoute
alter table public.play_log add column if not exists device uuid;
create index if not exists play_log_played_idx on public.play_log (played_at);

drop function if exists public.count_play(uuid, text);
create or replace function public.count_play(track uuid, p_country text default null, p_device uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update tracks set plays = plays + 1 where id = track;
  if found then
    insert into play_log (track_id, country, device)
    values (track, case when p_country ~ '^[A-Z]{2}$' then p_country end, p_device);
  end if;
end $$;
grant execute on function public.count_play(uuid, text, uuid) to anon, authenticated;

-- 2. Statistiques complètes pour DOZE Studio
create or replace function public.admin_stats(p_key uuid, p_days int default 30)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  d int := least(greatest(coalesce(p_days, 30), 1), 365);
  since timestamptz := now() - make_interval(days => d);
  prev  timestamptz := now() - make_interval(days => 2 * d);
  r json;
begin
  if p_key is null or not exists (select 1 from app_admin where key = p_key) then return null; end if;
  with
  days as (select generate_series(current_date - (d - 1), current_date, interval '1 day')::date as day),
  pl as (select (played_at at time zone 'UTC')::date as day, count(*) as n, count(distinct device) as u
         from play_log where played_at >= current_date - (d - 1) group by 1),
  lk as (select (created_at at time zone 'UTC')::date as day, count(*) as n from likes where created_at >= current_date - (d - 1) group by 1),
  us as (select (created_at at time zone 'UTC')::date as day, count(*) as n from auth.users where created_at >= current_date - (d - 1) group by 1),
  tr as (select (created_at at time zone 'UTC')::date as day, count(*) as n from tracks where created_at >= current_date - (d - 1) group by 1),
  firsts as (select lower(artist) as k, min(artist) as name, min(created_at) as first_at, count(*) as n, sum(plays) as plays
             from tracks where not hidden group by lower(artist))
  select json_build_object(
    'days', d,
    'generated_at', now(),
    'totals', json_build_object(
      'tracks', (select count(*) from tracks where not hidden),
      'hidden', (select count(*) from tracks where hidden),
      'plays', (select coalesce(sum(plays), 0) from tracks),
      'likes', (select count(*) from likes),
      'reports', (select coalesce(sum(reports), 0) from tracks),
      'reported_tracks', (select count(*) from tracks where reports > 0),
      'artists', (select count(*) from firsts),
      'users', (select count(*) from auth.users),
      'newsletter', (select count(*) from profiles where newsletter),
      'playlists', (select count(*) from playlists),
      'reviews', (select count(*) from app_reviews where not hidden),
      'rating', (select round(avg(rating)::numeric, 2) from app_reviews where not hidden),
      'listeners', (select count(distinct device) from play_log where device is not null),
      'like_devices', (select count(distinct device) from likes)
    ),
    'period', json_build_object(
      'plays', (select count(*) from play_log where played_at > since),
      'plays_prev', (select count(*) from play_log where played_at > prev and played_at <= since),
      'listeners', (select count(distinct device) from play_log where played_at > since),
      'listeners_prev', (select count(distinct device) from play_log where played_at > prev and played_at <= since),
      'likes', (select count(*) from likes where created_at > since),
      'likes_prev', (select count(*) from likes where created_at > prev and created_at <= since),
      'users', (select count(*) from auth.users where created_at > since),
      'users_prev', (select count(*) from auth.users where created_at > prev and created_at <= since),
      'tracks', (select count(*) from tracks where created_at > since),
      'tracks_prev', (select count(*) from tracks where created_at > prev and created_at <= since),
      'artists', (select count(*) from firsts where first_at > since),
      'artists_prev', (select count(*) from firsts where first_at > prev and first_at <= since)
    ),
    'daily', (select json_agg(json_build_object('day', days.day, 'plays', coalesce(pl.n, 0), 'listeners', coalesce(pl.u, 0),
                'likes', coalesce(lk.n, 0), 'users', coalesce(us.n, 0), 'tracks', coalesce(tr.n, 0)) order by days.day)
              from days left join pl using (day) left join lk using (day) left join us using (day) left join tr using (day)),
    'top_plays', (select coalesce(json_agg(x), '[]'::json) from (
        select t.id, t.title, t.artist, t.cover_url, t.source, count(*) as n
        from play_log p join tracks t on t.id = p.track_id where p.played_at > since
        group by t.id order by n desc limit 15) x),
    'top_likes', (select coalesce(json_agg(x), '[]'::json) from (
        select t.id, t.title, t.artist, t.cover_url, t.source, count(*) as n
        from likes l join tracks t on t.id = l.track_id where l.created_at > since
        group by t.id order by n desc limit 15) x),
    'top_all', (select coalesce(json_agg(x), '[]'::json) from (
        select id, title, artist, cover_url, source, plays as n, likes from tracks where not hidden order by plays desc limit 15) x),
    'reported', (select coalesce(json_agg(x), '[]'::json) from (
        select id, title, artist, cover_url, source, reports, hidden, created_at from tracks
        where reports > 0 or hidden order by hidden desc, reports desc, created_at desc limit 40) x),
    'new_artists', (select coalesce(json_agg(x), '[]'::json) from (
        select name, first_at, n, plays from firsts where first_at > since order by first_at desc limit 30) x),
    'countries', (select coalesce(json_agg(x), '[]'::json) from (
        select coalesce(country, '??') as country, count(*) as n from play_log where played_at > since group by 1 order by 2 desc limit 15) x),
    'sources', (select coalesce(json_agg(x), '[]'::json) from (
        select source, count(*) as n from tracks where not hidden group by 1 order by 2 desc) x),
    'latest_tracks', (select coalesce(json_agg(x), '[]'::json) from (
        select t.id, t.title, t.artist, t.cover_url, t.source, t.created_at, p.username
        from tracks t left join profiles p on p.id = t.user_id order by t.created_at desc limit 12) x),
    'latest_users', (select coalesce(json_agg(x), '[]'::json) from (
        select p.username, u.created_at, p.newsletter,
               (select count(*) from tracks t where t.user_id = u.id) as tracks
        from auth.users u left join profiles p on p.id = u.id order by u.created_at desc limit 12) x),
    'reviews', (select coalesce(json_agg(x), '[]'::json) from (
        select id, author, rating, comment, created_at, hidden from app_reviews order by created_at desc limit 15) x)
  ) into r;
  return r;
end $$;
grant execute on function public.admin_stats(uuid, int) to anon, authenticated;

-- 3. Modération : masquer ou rétablir un titre (rétablir remet les signalements à zéro)
create or replace function public.admin_set_hidden(p_id uuid, p_key uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_admin where key = p_key) then return false; end if;
  update tracks set hidden = p_hidden, reports = case when p_hidden then reports else 0 end where id = p_id;
  return found;
end $$;
grant execute on function public.admin_set_hidden(uuid, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
