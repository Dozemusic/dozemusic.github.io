-- Écrin · mise à jour 4 : l'artiste (et l'administrateur) peuvent modifier les paroles et leur
-- synchronisation après publication ; l'administrateur peut supprimer un titre.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.
-- À la fin, Supabase affiche « ta_cle_admin » : garde-la secrète, elle sert à activer le mode administrateur.

-- 1. Clé de modification propre à chaque titre (connue seulement de l'appareil qui l'a publié)
alter table public.tracks add column if not exists edit_key uuid;

-- La clé ne doit jamais être lisible : on n'autorise la lecture que des autres colonnes
revoke select on public.tracks from anon, authenticated;
grant select (id, title, artist, genre, source, suno_id, audio_url, cover_url, plays, likes, reports, hidden,
              created_at, lyrics, ai, made_with) on public.tracks to anon, authenticated;

-- 2. Clé administrateur (toi)
create table if not exists public.app_admin (
  key        uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.app_admin enable row level security;
revoke all on public.app_admin from anon, authenticated;
insert into public.app_admin (key) select gen_random_uuid() where not exists (select 1 from public.app_admin);

create or replace function public.is_admin(p_key uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admin where key = p_key);
$$;

create or replace function public.can_edit(p_id uuid, p_key uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tracks where id = p_id and edit_key is not null and edit_key = p_key)
      or exists (select 1 from app_admin where key = p_key);
$$;

-- 3. Modifier les paroles (texte simple ou format LRC synchronisé)
create or replace function public.update_track_lyrics(p_id uuid, p_key uuid, p_lyrics text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or not can_edit(p_id, p_key) then return false; end if;
  update tracks set lyrics = nullif(left(coalesce(p_lyrics, ''), 8000), '') where id = p_id;
  return found;
end $$;

-- 4. Supprimer un titre (administrateur seulement)
create or replace function public.admin_delete_track(p_id uuid, p_key uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_admin where key = p_key) then return false; end if;
  delete from tracks where id = p_id;
  return found;
end $$;

grant execute on function public.is_admin(uuid) to anon, authenticated;
grant execute on function public.can_edit(uuid, uuid) to anon, authenticated;
grant execute on function public.update_track_lyrics(uuid, uuid, text) to anon, authenticated;
grant execute on function public.admin_delete_track(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- Ta clé administrateur (à garder secrète) :
select key as ta_cle_admin from public.app_admin order by created_at limit 1;
