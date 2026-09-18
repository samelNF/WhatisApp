-- Web Push em segundo plano para o WhatisApp
-- As chaves VAPID e o segredo do webhook são inseridos apenas no banco de produção.
-- Não versionar valores privados neste arquivo.

create extension if not exists pg_net with schema extensions;

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

create table if not exists public.push_entregas (
    mensagem_id bigint not null,
    endpoint text not null,
    created_at timestamptz not null default now(),
    primary key (mensagem_id, endpoint)
);

create index if not exists push_entregas_created_at_idx
    on public.push_entregas (created_at);

alter table public.push_entregas enable row level security;

create table if not exists public.push_sessions (
    token_hash text primary key,
    usuario_email text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '90 days')
);

create index if not exists push_sessions_usuario_email_idx
    on public.push_sessions (usuario_email);

alter table public.push_sessions enable row level security;

create table if not exists public.push_config (
    id smallint primary key default 1 check (id = 1),
    vapid_public_key text not null,
    vapid_private_key text not null,
    vapid_subject text not null,
    webhook_secret text not null,
    updated_at timestamptz not null default now()
);

alter table public.push_config enable row level security;

create or replace function public.disparar_push_nova_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    segredo text;
begin
    select webhook_secret
      into segredo
      from public.push_config
     where id = 1;

    if segredo is null then
        return new;
    end if;

    perform net.http_post(
        url := 'https://qlvorxobvnjoovqxnfhp.supabase.co/functions/v1/push',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
            'action', 'notify-message',
            'message_id', new.id,
            'webhook_secret', segredo
        ),
        timeout_milliseconds := 10000
    );

    return new;
exception
    when others then
        raise warning 'Falha ao enfileirar Web Push da mensagem %: %', new.id, sqlerrm;
        return new;
end;
$$;

drop trigger if exists trg_disparar_push_nova_mensagem on public.mensagens;

create trigger trg_disparar_push_nova_mensagem
after insert on public.mensagens
for each row
execute function public.disparar_push_nova_mensagem();
