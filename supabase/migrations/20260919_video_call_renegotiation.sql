-- Renegociação SDP para promover ligação privada de voz para vídeo
-- sem derrubar o RTCPeerConnection existente.
alter table public.chamadas
    add column if not exists negociacao_versao integer not null default 0,
    add column if not exists negociacao_por text,
    add column if not exists answer_versao integer;

alter table public.chamadas
    drop constraint if exists chamadas_negociacao_versao_check;
alter table public.chamadas
    add constraint chamadas_negociacao_versao_check
    check (negociacao_versao >= 0);

alter table public.chamadas
    drop constraint if exists chamadas_answer_versao_check;
alter table public.chamadas
    add constraint chamadas_answer_versao_check
    check (answer_versao is null or answer_versao >= 0);

alter table public.chamadas replica identity full;
