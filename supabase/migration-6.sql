-- DOZE · mise à jour 6 : comptes (publication réservée aux inscrits), consentement newsletter, avis sur l'appli
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.

-- 1. Profils : un par compte, créé automatiquement à l'inscription
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[A-Za-zÀ-ÿ0-9 _.''-]{2,30}$'),
  newsletter    boolean not null default false,
  newsletter_at timestamptz,                       -- date du consentement (preuve), effacée au retrait
  created_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (newsletter) on public.profiles to authenticated;
drop policy if exists "mon profil" on public.profiles;
create policy "mon profil" on public.profiles for select using (auth.uid() = id);
drop policy if exists "modifier mon profil" on public.profiles;
create policy "modifier mon profil" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- La date du consentement suit automatiquement le choix newsletter
create or replace function public.profiles_newsletter_date()
returns trigger language plpgsql as $$
begin
  if new.newsletter and (tg_op = 'INSERT' or not old.newsletter) then new.newsletter_at := now(); end if;
  if not new.newsletter then new.newsletter_at := null; end if;
  return new;
end $$;
drop trigger if exists profiles_newsletter_date on public.profiles;
create trigger profiles_newsletter_date before insert or update on public.profiles
  for each row execute function public.profiles_newsletter_date();

-- Création du profil à l'inscription (pseudo et choix newsletter transmis par l'appli)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 0;
begin
  base := left(regexp_replace(coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)), '[^A-Za-zÀ-ÿ0-9 _.''-]', '', 'g'), 26);
  if length(base) < 2 then base := 'artiste'; end if;
  candidate := base;
  while exists (select 1 from profiles where lower(username) = lower(candidate)) loop
    n := n + 1; candidate := base || n;
  end loop;
  insert into profiles (id, username, newsletter)
  values (new.id, candidate, coalesce((new.raw_user_meta_data->>'newsletter')::boolean, false));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.username_available(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where lower(username) = lower(trim(p_name)));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- 2. Publication réservée aux comptes : chaque titre est rattaché à son auteur
alter table public.tracks add column if not exists user_id uuid references auth.users (id) on delete set null default auth.uid();
grant select (user_id) on public.tracks to anon, authenticated;
revoke insert on public.tracks from anon;
grant insert on public.tracks to authenticated;
drop policy if exists "ajout public" on public.tracks;
drop policy if exists "ajout par un compte" on public.tracks;
create policy "ajout par un compte" on public.tracks for insert to authenticated
  with check (auth.uid() is not null and user_id = auth.uid() and plays = 0 and reports = 0 and likes = 0 and hidden = false);

-- L'auteur connecté peut modifier ses paroles (en plus de la clé d'appareil et de l'administrateur)
create or replace function public.can_edit(p_id uuid, p_key uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tracks where id = p_id and edit_key is not null and edit_key = p_key)
      or exists (select 1 from tracks where id = p_id and user_id is not null and user_id = auth.uid())
      or exists (select 1 from app_admin where key = p_key);
$$;

-- Envoi de fichiers audio : comptes uniquement
drop policy if exists "envoi public" on storage.objects;
drop policy if exists "envoi par un compte" on storage.objects;
create policy "envoi par un compte" on storage.objects for insert to authenticated with check (bucket_id = 'songs');

-- 3. Avis sur l'appli : un par compte, modifiable
create table if not exists public.app_reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  author     text not null,
  rating     smallint not null check (rating between 1 and 5),
  comment    text check (comment is null or char_length(comment) <= 600),
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_reviews enable row level security;
revoke all on public.app_reviews from anon, authenticated;
grant select (id, author, rating, comment, created_at, updated_at, user_id) on public.app_reviews to anon, authenticated;
drop policy if exists "avis visibles" on public.app_reviews;
create policy "avis visibles" on public.app_reviews for select using (not hidden);

create or replace function public.save_review(p_rating int, p_comment text)
returns boolean language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if auth.uid() is null or p_rating not between 1 and 5 then return false; end if;
  select username into who from profiles where id = auth.uid();
  insert into app_reviews (user_id, author, rating, comment)
  values (auth.uid(), coalesce(who, 'Utilisateur'), p_rating, nullif(left(trim(coalesce(p_comment, '')), 600), ''))
  on conflict (user_id) do update set rating = excluded.rating, comment = excluded.comment, author = excluded.author, updated_at = now(), hidden = false;
  return true;
end $$;

create or replace function public.reviews_summary()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('count', count(*), 'avg', round(avg(rating)::numeric, 2),
    'dist', json_build_array(count(*) filter (where rating = 1), count(*) filter (where rating = 2), count(*) filter (where rating = 3), count(*) filter (where rating = 4), count(*) filter (where rating = 5)))
  from app_reviews where not hidden;
$$;

create or replace function public.admin_hide_review(p_id uuid, p_key uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_admin where key = p_key) then return false; end if;
  update app_reviews set hidden = true where id = p_id; return found;
end $$;

grant execute on function public.save_review(int, text) to authenticated;
grant execute on function public.reviews_summary() to anon, authenticated;
grant execute on function public.admin_hide_review(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- Pour exporter plus tard la liste des abonnés à la newsletter (à lancer toi-même, résultat privé) :
-- select u.email, p.username, p.newsletter_at from public.profiles p join auth.users u on u.id = p.id where p.newsletter order by p.newsletter_at;
