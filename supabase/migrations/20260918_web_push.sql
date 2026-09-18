-- Web Push real para WhatisApp
-- Execute esta migration no Supabase antes de publicar a Edge Function "push".

create table if not exists public.push_subscriptions (
    endpoint text primary key,
    usuario_email text not null,
    p256dh text not null,
    auth text not null,
    expiration_time bigint null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_usuario_email_idx
    on public.push_subscriptions (usuario_email);

alter table public.push_subscriptions enable row level security;

-- Não criamos políticas públicas: somente a Edge Function, usando service_role,
-- deve ler/gravar as assinaturas.

create table if not exists public.push_entregas (
    mensagem_id bigint not null,
    endpoint text not null,
    created_at timestamptz not null default now(),
    primary key (mensagem_id, endpoint)
);

create index if not exists push_entregas_created_at_idx
    on public.push_entregas (created_at);

alter table public.push_entregas enable row level security;
