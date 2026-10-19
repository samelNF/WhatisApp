alter table public.grupos
    add column if not exists criacao_chave text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.grupos'::regclass
          and conname = 'grupos_criacao_chave_key'
    ) then
        alter table public.grupos
            add constraint grupos_criacao_chave_key unique (criacao_chave);
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.grupo_membros'::regclass
          and conname = 'grupo_membros_grupo_usuario_key'
    ) then
        alter table public.grupo_membros
            add constraint grupo_membros_grupo_usuario_key
            unique (grupo_id, usuario_email);
    end if;
end
$$;

create or replace function public.criar_grupo_whatisapp(
    p_criacao_chave text,
    p_nome text,
    p_foto_url text,
    p_cor text,
    p_criado_por text,
    p_criador_nome text,
    p_membros jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_grupo_id uuid;
begin
    if nullif(trim(p_criacao_chave), '') is null then
        raise exception 'Chave de criação ausente';
    end if;

    if nullif(trim(p_nome), '') is null then
        raise exception 'Nome do grupo ausente';
    end if;

    if nullif(trim(p_criado_por), '') is null then
        raise exception 'Criador do grupo ausente';
    end if;

    insert into public.grupos (
        nome, foto_url, cor, criado_por, criacao_chave
    )
    values (
        trim(p_nome),
        nullif(trim(coalesce(p_foto_url, '')), ''),
        coalesce(nullif(trim(p_cor), ''), '#482133'),
        trim(p_criado_por),
        trim(p_criacao_chave)
    )
    on conflict (criacao_chave)
    do update set criacao_chave = excluded.criacao_chave
    returning id into v_grupo_id;

    insert into public.grupo_membros (
        grupo_id, usuario_email, usuario_nome, cargo
    )
    values (
        v_grupo_id,
        trim(p_criado_por),
        nullif(trim(coalesce(p_criador_nome, '')), ''),
        'dono'
    )
    on conflict (grupo_id, usuario_email)
    do update set
        usuario_nome = coalesce(excluded.usuario_nome, grupo_membros.usuario_nome),
        cargo = 'dono';

    insert into public.grupo_membros (
        grupo_id, usuario_email, usuario_nome, cargo
    )
    select
        v_grupo_id,
        trim(m.email),
        nullif(trim(coalesce(m.nome, '')), ''),
        'membro'
    from jsonb_to_recordset(coalesce(p_membros, '[]'::jsonb))
        as m(email text, nome text)
    where nullif(trim(m.email), '') is not null
      and lower(trim(m.email)) <> lower(trim(p_criado_por))
    on conflict (grupo_id, usuario_email)
    do update set
        usuario_nome = coalesce(excluded.usuario_nome, grupo_membros.usuario_nome);

    return v_grupo_id;
end;
$$;

grant execute on function public.criar_grupo_whatisapp(
    text, text, text, text, text, text, jsonb
) to anon, authenticated;
