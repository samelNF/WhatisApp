-- Ordenação da lista de conversas e contagem de não lidas em grupos.
-- Mantém uma leitura por membro, sem reutilizar mensagens.visualizada,
-- porque em grupo cada participante precisa ter seu próprio estado.

alter table public.grupo_membros
add column if not exists ultima_leitura timestamp with time zone;

update public.grupo_membros
set ultima_leitura = now()
where ultima_leitura is null;

alter table public.grupo_membros
alter column ultima_leitura set default now();

create index if not exists idx_mensagens_grupo_created_at
on public.mensagens (grupo_id, created_at desc)
where grupo_id is not null;

create index if not exists idx_mensagens_privado_nao_lidas
on public.mensagens (destinatario_email, remetente_email, visualizada, created_at desc)
where grupo_id is null;
