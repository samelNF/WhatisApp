alter table public.mensagens
    add column if not exists apagada_em timestamp with time zone;

create or replace function public.validar_edicao_mensagem()
returns trigger
language plpgsql
as $$
begin
    -- Apagar para todos não é edição: pode acontecer a qualquer momento
    -- e também pode substituir foto, vídeo, áudio ou registro de chamada.
    if new.apagada_em is distinct from old.apagada_em
       and new.apagada_em is not null then
        new.apagada_em := coalesce(old.apagada_em, now());
        new.texto := '[MENSAGEM_APAGADA]';
        new.tipo := 'texto';
        new.audio_url := null;
        new.audio_duracao := null;
        new.audio_ondas := null;
        new.mensagem_respondida_id := null;
        new.chamada_id := null;
        new.editada_em := null;
        return new;
    end if;

    -- Depois de apagada, o conteúdo não pode reaparecer em outro UPDATE.
    -- Campos como visualizada ainda podem ser atualizados normalmente.
    if old.apagada_em is not null then
        new.apagada_em := old.apagada_em;
        new.texto := old.texto;
        new.tipo := old.tipo;
        new.audio_url := old.audio_url;
        new.audio_duracao := old.audio_duracao;
        new.audio_ondas := old.audio_ondas;
        new.mensagem_respondida_id := old.mensagem_respondida_id;
        new.chamada_id := old.chamada_id;
        new.editada_em := old.editada_em;
        return new;
    end if;

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
