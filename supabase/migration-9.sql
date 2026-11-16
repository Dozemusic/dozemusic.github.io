-- DOZE · mise à jour 9 : alerte de modération quotidienne
-- Donne seulement deux nombres (aucun titre, aucune donnée personnelle) au contrôle automatique :
-- les titres signalés encore visibles, et ceux masqués automatiquement (5 signalements) qui attendent ta décision.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.

create or replace function public.moderation_pending()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'reported_visible', (select count(*) from tracks where not hidden and reports > 0),
    'auto_hidden', (select count(*) from tracks where hidden and reports >= 5)
  );
$$;
grant execute on function public.moderation_pending() to anon, authenticated;

-- Quand tu masques un titre toi-même depuis le Studio, il est considéré comme traité (signalements remis à zéro).
-- « Rétablir » remettait déjà les signalements à zéro.
create or replace function public.admin_set_hidden(p_id uuid, p_key uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_admin where key = p_key) then return false; end if;
  update tracks set hidden = p_hidden, reports = 0 where id = p_id;
  return found;
end $$;

notify pgrst, 'reload schema';
