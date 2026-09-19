-- Chamadas de vídeo privadas e em grupo, com conversão dinâmica voz <-> vídeo.
-- Em grupo, uma chamada de voz só vira vídeo quando todos os participantes
-- atualmente conectados aprovam o pedido.

alter table public.chamadas
    add column if not exists modo text not null default 'voz',
    add column if not exists video_pedido_id uuid,
    add column if not exists video_pedido_por text,
    add column if not exists video_pedido_status text,
    add column if not exists chamador_camera_ativa boolean not null default false,
    add column if not exists receptor_camera_ativa boolean not null default false;

alter table public.chamadas
    drop constraint if exists chamadas_modo_check;
alter table public.chamadas
    add constraint chamadas_modo_check
    check (modo in ('voz','video'));

alter table public.chamadas
    drop constraint if exists chamadas_video_pedido_status_check;
alter table public.chamadas
    add constraint chamadas_video_pedido_status_check
    check (
        video_pedido_status is null or
        video_pedido_status in ('pending','approved','rejected')
    );

alter table public.chamadas_grupo
    add column if not exists modo text not null default 'voz';

alter table public.chamadas_grupo
    drop constraint if exists chamadas_grupo_modo_check;
alter table public.chamadas_grupo
    add constraint chamadas_grupo_modo_check
    check (modo in ('voz','video'));

alter table public.chamadas_grupo_participantes
    add column if not exists camera_ativa boolean not null default false;

create table if not exists public.chamadas_grupo_video_pedidos (
    id uuid primary key default gen_random_uuid(),
    chamada_id uuid not null references public.chamadas_grupo(id) on delete cascade,
    solicitado_por text not null,
    status text not null default 'pending'
        check (status in ('pending','approved','rejected')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

create unique index if not exists chamadas_grupo_video_um_pendente_idx
    on public.chamadas_grupo_video_pedidos (chamada_id)
    where status = 'pending';

create table if not exists public.chamadas_grupo_video_respostas (
    pedido_id uuid not null references public.chamadas_grupo_video_pedidos(id) on delete cascade,
    usuario_email text not null,
    resposta text not null default 'pending'
        check (resposta in ('pending','accepted','rejected','left')),
    updated_at timestamptz not null default now(),
    primary key (pedido_id, usuario_email)
);

alter table public.chamadas_grupo_video_pedidos enable row level security;
alter table public.chamadas_grupo_video_respostas enable row level security;

drop policy if exists "whatisapp_group_video_requests_select"
on public.chamadas_grupo_video_pedidos;
drop policy if exists "whatisapp_group_video_requests_insert"
on public.chamadas_grupo_video_pedidos;
drop policy if exists "whatisapp_group_video_requests_update"
on public.chamadas_grupo_video_pedidos;

create policy "whatisapp_group_video_requests_select"
on public.chamadas_grupo_video_pedidos for select
to anon, authenticated using (true);

create policy "whatisapp_group_video_requests_insert"
on public.chamadas_grupo_video_pedidos for insert
to anon, authenticated with check (true);

create policy "whatisapp_group_video_requests_update"
on public.chamadas_grupo_video_pedidos for update
to anon, authenticated using (true) with check (true);

drop policy if exists "whatisapp_group_video_answers_select"
on public.chamadas_grupo_video_respostas;
drop policy if exists "whatisapp_group_video_answers_insert"
on public.chamadas_grupo_video_respostas;
drop policy if exists "whatisapp_group_video_answers_update"
on public.chamadas_grupo_video_respostas;

create policy "whatisapp_group_video_answers_select"
on public.chamadas_grupo_video_respostas for select
to anon, authenticated using (true);

create policy "whatisapp_group_video_answers_insert"
on public.chamadas_grupo_video_respostas for insert
to anon, authenticated with check (true);

create policy "whatisapp_group_video_answers_update"
on public.chamadas_grupo_video_respostas for update
to anon, authenticated using (true) with check (true);

grant select, insert, update
on public.chamadas_grupo_video_pedidos
to anon, authenticated;

grant select, insert, update
on public.chamadas_grupo_video_respostas
to anon, authenticated;

create or replace function public.preparar_pedido_video_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status text;
begin
    select status into v_status
    from public.chamadas_grupo
    where id = new.chamada_id;

    if v_status is distinct from 'active' then
        raise exception 'Ligação de grupo não está ativa';
    end if;

    if not exists (
        select 1
        from public.chamadas_grupo_participantes p
        where p.chamada_id = new.chamada_id
          and lower(p.usuario_email) = lower(new.solicitado_por)
          and p.status = 'joined'
    ) then
        raise exception 'Somente participante ativo pode pedir vídeo';
    end if;

    if exists (
        select 1
        from public.chamadas_grupo_video_pedidos p
        where p.chamada_id = new.chamada_id
          and p.status = 'pending'
    ) then
        raise exception 'Já existe um pedido de vídeo pendente';
    end if;

    new.status := 'pending';
    new.resolved_at := null;
    return new;
end;
$$;

drop trigger if exists trg_preparar_pedido_video_grupo
on public.chamadas_grupo_video_pedidos;

create trigger trg_preparar_pedido_video_grupo
before insert on public.chamadas_grupo_video_pedidos
for each row execute function public.preparar_pedido_video_grupo();

create or replace function public.criar_respostas_pedido_video_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pendentes integer;
begin
    insert into public.chamadas_grupo_video_respostas (
        pedido_id,
        usuario_email,
        resposta,
        updated_at
    )
    select
        new.id,
        p.usuario_email,
        case
            when lower(p.usuario_email) = lower(new.solicitado_por)
                then 'accepted'
            else 'pending'
        end,
        now()
    from public.chamadas_grupo_participantes p
    where p.chamada_id = new.chamada_id
      and p.status = 'joined'
    on conflict (pedido_id, usuario_email) do nothing;

    select count(*)
      into v_pendentes
      from public.chamadas_grupo_video_respostas r
     where r.pedido_id = new.id
       and r.resposta = 'pending';

    if v_pendentes = 0 then
        update public.chamadas_grupo_video_pedidos
           set status = 'approved',
               resolved_at = now()
         where id = new.id
           and status = 'pending';

        update public.chamadas_grupo
           set modo = 'video'
         where id = new.chamada_id
           and status = 'active';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_criar_respostas_pedido_video_grupo
on public.chamadas_grupo_video_pedidos;

create trigger trg_criar_respostas_pedido_video_grupo
after insert on public.chamadas_grupo_video_pedidos
for each row execute function public.criar_respostas_pedido_video_grupo();

create or replace function public.preparar_resposta_video_grupo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_preparar_resposta_video_grupo
on public.chamadas_grupo_video_respostas;

create trigger trg_preparar_resposta_video_grupo
before update on public.chamadas_grupo_video_respostas
for each row execute function public.preparar_resposta_video_grupo();

create or replace function public.recalcular_pedido_video_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_chamada_id uuid;
    v_rejeitados integer;
    v_pendentes integer;
begin
    select p.chamada_id into v_chamada_id
    from public.chamadas_grupo_video_pedidos p
    where p.id = new.pedido_id;

    if v_chamada_id is null then
        return new;
    end if;

    select
        count(*) filter (where r.resposta = 'rejected'),
        count(*) filter (where r.resposta = 'pending')
    into v_rejeitados, v_pendentes
    from public.chamadas_grupo_video_respostas r
    where r.pedido_id = new.pedido_id;

    if v_rejeitados > 0 then
        update public.chamadas_grupo_video_pedidos
           set status = 'rejected',
               resolved_at = now()
         where id = new.pedido_id
           and status = 'pending';
    elsif v_pendentes = 0 then
        update public.chamadas_grupo_video_pedidos
           set status = 'approved',
               resolved_at = now()
         where id = new.pedido_id
           and status = 'pending';

        update public.chamadas_grupo
           set modo = 'video'
         where id = v_chamada_id
           and status = 'active';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_recalcular_pedido_video_grupo
on public.chamadas_grupo_video_respostas;

create trigger trg_recalcular_pedido_video_grupo
after update on public.chamadas_grupo_video_respostas
for each row
when (old.resposta is distinct from new.resposta)
execute function public.recalcular_pedido_video_grupo();

create or replace function public.sincronizar_saida_com_pedido_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.status = 'joined' and new.status <> 'joined' then
        update public.chamadas_grupo_video_respostas r
           set resposta = 'left',
               updated_at = now()
          from public.chamadas_grupo_video_pedidos p
         where r.pedido_id = p.id
           and p.chamada_id = new.chamada_id
           and p.status = 'pending'
           and lower(r.usuario_email) = lower(new.usuario_email)
           and r.resposta = 'pending';
    end if;

    if new.status <> 'joined' then
        new.camera_ativa := false;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_sincronizar_saida_com_pedido_video
on public.chamadas_grupo_participantes;

create trigger trg_sincronizar_saida_com_pedido_video
before update on public.chamadas_grupo_participantes
for each row execute function public.sincronizar_saida_com_pedido_video();

create or replace function public.criar_mensagem_da_chamada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.mensagens (
        remetente_email,
        destinatario_email,
        texto,
        tipo,
        chamada_id,
        meta
    ) values (
        new.chamador_email,
        new.receptor_email,
        '[CHAMADA]',
        'chamada',
        new.id,
        jsonb_build_object(
            'tipo_chamada', new.tipo,
            'modo', new.modo,
            'status', new.status,
            'duracao_segundos', coalesce(new.duracao_segundos, 0),
            'chamador_email', new.chamador_email,
            'receptor_email', new.receptor_email
        )
    );

    return new;
end;
$$;

create or replace function public.sincronizar_mensagem_da_chamada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.mensagens
       set meta = jsonb_build_object(
            'tipo_chamada', new.tipo,
            'modo', new.modo,
            'status', new.status,
            'duracao_segundos', coalesce(new.duracao_segundos, 0),
            'chamador_email', new.chamador_email,
            'receptor_email', new.receptor_email
       )
     where chamada_id = new.id
       and tipo = 'chamada';

    return new;
end;
$$;

drop trigger if exists trg_sincronizar_mensagem_da_chamada
on public.chamadas;

create trigger trg_sincronizar_mensagem_da_chamada
after update on public.chamadas
for each row
when (
    old.status is distinct from new.status or
    old.duracao_segundos is distinct from new.duracao_segundos or
    old.tipo is distinct from new.tipo or
    old.modo is distinct from new.modo
)
execute function public.sincronizar_mensagem_da_chamada();

create or replace function public.criar_mensagem_chamada_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.mensagens (
        remetente_email,
        destinatario_email,
        texto,
        tipo,
        grupo_id,
        chamada_id,
        meta
    ) values (
        new.criado_por,
        null,
        '[CHAMADA_GRUPO]',
        'chamada_grupo',
        new.grupo_id,
        new.id,
        jsonb_build_object(
            'tipo_chamada',
            case when new.modo = 'video' then 'video_grupo' else 'voz_grupo' end,
            'modo', new.modo,
            'status', new.status,
            'criado_por', new.criado_por
        )
    );

    return new;
end;
$$;

create or replace function public.sincronizar_mensagem_chamada_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.mensagens
       set meta = jsonb_build_object(
            'tipo_chamada',
            case when new.modo = 'video' then 'video_grupo' else 'voz_grupo' end,
            'modo', new.modo,
            'status', new.status,
            'criado_por', new.criado_por
       )
     where chamada_id = new.id
       and tipo = 'chamada_grupo';

    return new;
end;
$$;

drop trigger if exists trg_sincronizar_mensagem_chamada_grupo
on public.chamadas_grupo;

create trigger trg_sincronizar_mensagem_chamada_grupo
after update on public.chamadas_grupo
for each row
when (
    old.status is distinct from new.status or
    old.modo is distinct from new.modo
)
execute function public.sincronizar_mensagem_chamada_grupo();

alter table public.chamadas replica identity full;
alter table public.chamadas_grupo replica identity full;
alter table public.chamadas_grupo_participantes replica identity full;
alter table public.chamadas_grupo_video_pedidos replica identity full;
alter table public.chamadas_grupo_video_respostas replica identity full;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'chamadas_grupo_video_pedidos'
    ) then
        alter publication supabase_realtime
            add table public.chamadas_grupo_video_pedidos;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'chamadas_grupo_video_respostas'
    ) then
        alter publication supabase_realtime
            add table public.chamadas_grupo_video_respostas;
    end if;
end $$;

revoke execute on function public.preparar_pedido_video_grupo()
from public, anon, authenticated;
revoke execute on function public.criar_respostas_pedido_video_grupo()
from public, anon, authenticated;
revoke execute on function public.preparar_resposta_video_grupo()
from public, anon, authenticated;
revoke execute on function public.recalcular_pedido_video_grupo()
from public, anon, authenticated;
revoke execute on function public.sincronizar_saida_com_pedido_video()
from public, anon, authenticated;
