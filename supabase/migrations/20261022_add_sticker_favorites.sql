alter table public.figurinhas
    add column if not exists favoritada boolean not null default false;

create index if not exists figurinhas_usuario_favorita_criada_idx
    on public.figurinhas (usuario_email, favoritada desc, criada_em desc);
