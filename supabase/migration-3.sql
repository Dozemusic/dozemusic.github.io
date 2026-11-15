-- Écrin · mise à jour 3 : ouvert à tous les artistes, nouvelles sources (SoundCloud, YouTube),
-- mention « créé avec l'IA » facultative et outil de création.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run. Ne supprime aucune chanson.

alter table public.tracks add column if not exists ai boolean;
alter table public.tracks add column if not exists made_with text;
alter table public.tracks drop constraint if exists made_with_len;
alter table public.tracks add constraint made_with_len check (made_with is null or char_length(made_with) <= 40);

-- Sources acceptées
alter table public.tracks drop constraint if exists tracks_source_check;
alter table public.tracks add constraint tracks_source_check
  check (source in ('suno', 'upload', 'soundcloud', 'youtube'));

-- Origine du son : Suno, notre stockage, ou une page SoundCloud / YouTube lue avec leur lecteur officiel
alter table public.tracks drop constraint if exists audio_origin;
alter table public.tracks add constraint audio_origin check (
  audio_url like 'https://cdn1.suno.ai/%'
  or audio_url like '%/storage/v1/object/public/songs/%'
  or audio_url ~ '^https://soundcloud\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?$'
  or audio_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'
);

-- Une même vidéo YouTube ou page SoundCloud ne peut être publiée qu'une fois
create unique index if not exists tracks_external_unique on public.tracks (audio_url)
  where source in ('soundcloud', 'youtube');

-- Les chansons Suno déjà publiées sont des créations IA
update public.tracks set ai = true where source = 'suno' and ai is null;

notify pgrst, 'reload schema';
