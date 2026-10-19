create table if not exists public.figurinhas (
    id bigint generated always as identity primary key,
    usuario_email text not null,
    nome text,
    url text not null,
    storage_path text,
    animada boolean not null default false,
    largura integer not null,
    altura integer not null,
    criada_em timestamptz not null default now()
);

create index if not exists figurinhas_usuario_email_criada_em_idx
    on public.figurinhas (usuario_email, criada_em desc);

comment on table public.figurinhas is
'Biblioteca pessoal de figurinhas criadas no WhatisApp.';
