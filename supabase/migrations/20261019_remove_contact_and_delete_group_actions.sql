-- Remove um contato apenas da agenda do usuário, sem apagar mensagens.
create or replace function public.remover_contato_whatisapp(
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
    v_total integer := 0;
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

    delete from public.contatos c
     where lower(trim(c.usuario_origem)) = lower(trim(p_usuario_origem))
       and (
            lower(trim(c.contato_usuario)) = lower(trim(p_contato_email))
            or (
                v_usuario_alvo is not null
                and lower(trim(c.contato_usuario)) = lower(trim(v_usuario_alvo))
            )
       );

    get diagnostics v_total = row_count;
    return v_total > 0;
end;
$$;

grant execute on function public.remover_contato_whatisapp(text, text)
to anon, authenticated;

-- Exclui o grupo inteiro somente quando o e-mail informado é o criador atual.
create or replace function public.excluir_grupo_whatisapp(
    p_grupo_id uuid,
    p_email text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_criador text;
begin
    if p_grupo_id is null or nullif(trim(p_email), '') is null then
        return false;
    end if;

    select lower(trim(coalesce(g.criado_por, '')))
      into v_criador
      from public.grupos g
     where g.id = p_grupo_id
     for update;

    if not found
       or v_criador <> lower(trim(p_email)) then
        return false;
    end if;

    delete from public.mensagens
     where grupo_id = p_grupo_id;

    delete from public.grupos
     where id = p_grupo_id;

    return true;
end;
$$;

grant execute on function public.excluir_grupo_whatisapp(uuid, text)
to anon, authenticated;
