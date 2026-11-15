-- DOZE · mise à jour 5 : formes d'onde partagées
-- La forme d'onde d'un titre est calculée une seule fois par le premier auditeur, puis réutilisée par tous.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.

alter table public.tracks add column if not exists peaks smallint[];
grant select (peaks) on public.tracks to anon, authenticated;

-- N'enregistre une forme d'onde que si le titre n'en a pas encore, avec des valeurs valides (0 à 100).
create or replace function public.set_track_peaks(p_id uuid, p_peaks smallint[])
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_peaks is null or cardinality(p_peaks) not between 60 and 300
     or not (0 <= all (p_peaks)) or not (100 >= all (p_peaks)) then return false; end if;
  update tracks set peaks = p_peaks where id = p_id and peaks is null;
  return found;
end $$;

grant execute on function public.set_track_peaks(uuid, smallint[]) to anon, authenticated;
notify pgrst, 'reload schema';
