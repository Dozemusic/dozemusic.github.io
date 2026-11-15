-- Écrin · mise à jour 2 : coups de cœur publics, statistiques, paroles, playlists
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run.
-- Sans risque : ne supprime aucune chanson.

-- 1. Nouvelles colonnes sur les chansons
alter table public.tracks add column if not exists likes integer not null default 0;
alter table public.tracks add column if not exists lyrics text;
alter table public.tracks drop constraint if exists lyrics_len;
alter table public.tracks add constraint lyrics_len check (lyrics is null or char_length(lyrics) <= 8000);

drop policy if exists "ajout public" on public.tracks;
create policy "ajout public" on public.tracks
  for insert with check (plays = 0 and reports = 0 and likes = 0 and hidden = false);

-- 2. Coups de cœur : un par appareil et par chanson, modifiables seulement par les fonctions ci-dessous
create table if not exists public.likes (
  track_id   uuid not null references public.tracks(id) on delete cascade,
  device     uuid not null,
  created_at timestamptz not null default now(),
  primary key (track_id, device)
);
alter table public.likes enable row level security;
revoke all on public.likes from anon, authenticated;
create index if not exists likes_created_idx on public.likes (created_at desc);

create or replace function public.like_track(p_track uuid, p_device uuid, p_on boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_on then
    insert into likes (track_id, device) values (p_track, p_device) on conflict do nothing;
  else
    delete from likes where track_id = p_track and device = p_device;
  end if;
  select count(*) into n from likes where track_id = p_track;
  update tracks set likes = n where id = p_track;
  return n;
end $$;

-- Classement « Coups de cœur de la semaine »
create or replace function public.top_week(p_limit integer default 20)
returns table (track_id uuid, n bigint) language sql stable security definer set search_path = public as $$
  select l.track_id, count(*) as n
  from likes l join tracks t on t.id = l.track_id and not t.hidden
  where l.created_at > now() - interval '7 days'
  group by l.track_id order by n desc, max(l.created_at) desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- 3. Journal des écoutes (pour les statistiques), jamais lisible directement
create table if not exists public.play_log (
  id        bigint generated always as identity primary key,
  track_id  uuid not null references public.tracks(id) on delete cascade,
  played_at timestamptz not null default now(),
  country   text check (country is null or country ~ '^[A-Z]{2}$')
);
alter table public.play_log enable row level security;
revoke all on public.play_log from anon, authenticated;
create index if not exists play_log_track_idx on public.play_log (track_id, played_at);

drop function if exists public.count_play(uuid);
create or replace function public.count_play(track uuid, p_country text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update tracks set plays = plays + 1 where id = track;
  if found then
    insert into play_log (track_id, country)
    values (track, case when p_country ~ '^[A-Z]{2}$' then p_country end);
  end if;
end $$;

-- Statistiques d'un artiste : écoutes par jour (30 jours) et pays (chiffres agrégés uniquement)
create or replace function public.artist_stats(p_artist text)
returns json language sql stable security definer set search_path = public as $$
  with tr as (select id from tracks where lower(artist) = lower(p_artist) and not hidden),
  d as (
    select (played_at at time zone 'UTC')::date as day, count(*) as n
    from play_log where track_id in (select id from tr) and played_at > now() - interval '30 days'
    group by 1
  ),
  c as (
    select coalesce(country, '??') as country, count(*) as n
    from play_log where track_id in (select id from tr)
    group by 1 order by 2 desc limit 12
  )
  select json_build_object(
    'days', coalesce((select json_agg(d order by day) from d), '[]'::json),
    'countries', coalesce((select json_agg(c order by n desc) from c), '[]'::json),
    'week', (select count(*) from play_log where track_id in (select id from tr) and played_at > now() - interval '7 days'),
    'month', (select count(*) from play_log where track_id in (select id from tr) and played_at > now() - interval '30 days')
  );
$$;

-- 4. Playlists partageables : lisibles par tous, modifiables seulement avec la clé gardée par leur créateur
create table if not exists public.playlists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  tracks     uuid[] not null default '{}' check (cardinality(tracks) <= 500),
  edit_key   uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.playlists enable row level security;
revoke all on public.playlists from anon, authenticated;

create or replace function public.get_playlist(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'name', name, 'tracks', tracks, 'updated_at', updated_at)
  from playlists where id = p_id;
$$;

create or replace function public.save_playlist(p_id uuid, p_key uuid, p_name text, p_tracks uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if p_id is null then
    insert into playlists (name, tracks, edit_key) values (p_name, coalesce(p_tracks, '{}'), p_key) returning id into rid;
  else
    update playlists set name = p_name, tracks = coalesce(p_tracks, '{}'), updated_at = now()
    where id = p_id and edit_key = p_key returning id into rid;
    if rid is null then raise exception 'not_owner'; end if;
  end if;
  return rid;
end $$;

create or replace function public.delete_playlist(p_id uuid, p_key uuid)
returns void language sql security definer set search_path = public as $$
  delete from playlists where id = p_id and edit_key = p_key;
$$;

-- 5. Droits d'appel des fonctions
grant execute on function public.like_track(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.top_week(integer) to anon, authenticated;
grant execute on function public.count_play(uuid, text) to anon, authenticated;
grant execute on function public.artist_stats(text) to anon, authenticated;
grant execute on function public.get_playlist(uuid) to anon, authenticated;
grant execute on function public.save_playlist(uuid, uuid, text, uuid[]) to anon, authenticated;
grant execute on function public.delete_playlist(uuid, uuid) to anon, authenticated;

-- Recharge le schéma de l'API pour que les nouvelles fonctions soient visibles tout de suite
notify pgrst, 'reload schema';
