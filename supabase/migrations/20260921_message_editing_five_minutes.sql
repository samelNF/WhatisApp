alter table public.mensagens
    add column if not exists editada_em timestamp with time zone;

create or replace function public.validar_edicao_mensagem()
returns trigger
language plpgsql
as $$
begin
    if new.texto is distinct from old.texto then
        if now() > old.created_at + interval '5 minutes' then
            raise exception 'O prazo de 5 minutos para editar esta mensagem terminou.';
        end if;

        if coalesce(old.tipo, 'texto') <> 'texto'
           or old.chamada_id is not null
           or coalesce(old.texto, '') ~ '^\[(FOTO|IMAGEM|VIDEO|AUDIO|CHAMADA|CHAMADA_GRUPO)\]' then
            raise exception 'Somente mensagens de texto podem ser editadas.';
        end if;

        if nullif(btrim(coalesce(new.texto, '')), '') is null then
            raise exception 'A mensagem editada não pode ficar vazia.';
        end if;

        new.editada_em := now();
    elsif new.editada_em is distinct from old.editada_em then
        new.editada_em := old.editada_em;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_validar_edicao_mensagem on public.mensagens;

create trigger trg_validar_edicao_mensagem
before update on public.mensagens
for each row
execute function public.validar_edicao_mensagem();
