create or replace function public.adicionar_contato_whatisapp(
    p_usuario_origem text,
    p_contato_email text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_usuario_alvo text;
begin
    if nullif(trim(p_usuario_origem), '') is null
       or nullif(trim(p_contato_email), '') is null then
        return false;
    end if;

    select u.usuario
      into v_usuario_alvo
      from public.usuarios u
     where lower(trim(u.email)) = lower(trim(p_contato_email))
     limit 1;

    if nullif(trim(coalesce(v_usuario_alvo, '')), '') is null then
        return false;
    end if;

    insert into public.contatos (
        usuario_origem,
        contato_usuario
    )
    values (
        trim(p_usuario_origem),
        trim(v_usuario_alvo)
    )
    on conflict (usuario_origem, contato_usuario)
    do nothing;

    return true;
end;
$$;

grant execute on function public.adicionar_contato_whatisapp(text, text)
to anon, authenticated;

create or replace function public.ocultar_conversa_privada_whatisapp(
    p_usuario_email text,
    p_outro_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total integer := 0;
begin
    if nullif(trim(p_usuario_email), '') is null
       or nullif(trim(p_outro_email), '') is null then
        return 0;
    end if;

    insert into public.mensagens_ocultas (
        usuario_email,
        mensagem_id
    )
    select
        lower(trim(p_usuario_email)),
        m.id
    from public.mensagens m
    where m.grupo_id is null
      and (
        (
            lower(trim(coalesce(m.remetente_email, ''))) = lower(trim(p_usuario_email))
            and lower(trim(coalesce(m.destinatario_email, ''))) = lower(trim(p_outro_email))
        )
        or
        (
            lower(trim(coalesce(m.remetente_email, ''))) = lower(trim(p_outro_email))
            and lower(trim(coalesce(m.destinatario_email, ''))) = lower(trim(p_usuario_email))
        )
      )
    on conflict (usuario_email, mensagem_id)
    do nothing;

    get diagnostics v_total = row_count;
    return v_total;
end;
$$;

grant execute on function public.ocultar_conversa_privada_whatisapp(text, text)
to anon, authenticated;
