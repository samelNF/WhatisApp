-- Leitura por conversa privada para a lista de conversas.
-- O campo mensagens.visualizada continua servindo aos dois checks dentro do chat.
-- A home usa esta leitura por contato para não contar mensagens antigas como "novas".

alter table public.contatos
add column if not exists ultima_leitura timestamp with time zone;

update public.contatos
set ultima_leitura = now()
where ultima_leitura is null;

alter table public.contatos
alter column ultima_leitura set default now();
