-- DOZE · mise à jour 7 : analyse IA du son partagée (style détecté, tempo, correction tonale)
-- L'analyse d'un titre est faite une seule fois par le premier auditeur, puis réutilisée par tous.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.

alter table public.tracks add column if not exists analysis jsonb;
grant select (analysis) on public.tracks to anon, authenticated;

-- N'enregistre une analyse que si le titre n'en a pas encore, avec un contenu court et au bon format.
create or replace function public.set_track_analysis(p_id uuid, p_analysis jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' or pg_column_size(p_analysis) > 1500
     or (p_analysis->>'v') is distinct from '1'
     or jsonb_typeof(p_analysis->'corr') <> 'array' or jsonb_array_length(p_analysis->'corr') <> 10
     or (p_analysis->>'fam') !~ '^[a-z]{2,12}$' then return false; end if;
  update tracks set analysis = p_analysis where id = p_id and analysis is null;
  return found;
end $$;

grant execute on function public.set_track_analysis(uuid, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
