-- Mensagens de áudio / voice notes
alter table public.mensagens
    add column if not exists tipo text not null default 'texto',
    add column if not exists audio_url text,
    add column if not exists audio_duracao integer,
    add column if not exists audio_ondas jsonb;
