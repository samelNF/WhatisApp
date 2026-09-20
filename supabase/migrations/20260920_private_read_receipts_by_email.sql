-- Leitura persistente de conversas privadas por email.
-- Evita depender do campo contatos.contato_usuario, que possui dados antigos
-- salvos tanto como nome de usuário quanto como email.

create table if not exists public.leituras_conversas_privadas (
    usuario_email text not null,
    contato_email text not null,
    ultima_leitura timestamp with time zone not null default now(),
    primary key (usuario_email, contato_email)
);

create index if not exists idx_leituras_privadas_usuario
on public.leituras_conversas_privadas (usuario_email, contato_email);

insert into public.leituras_conversas_privadas (usuario_email, contato_email, ultima_leitura)
select distinct
    origem.email as usuario_email,
    destino.email as contato_email,
    coalesce(c.ultima_leitura, now()) as ultima_leitura
from public.contatos c
join public.usuarios origem
  on lower(c.usuario_origem) = lower(origem.usuario)
  or lower(c.usuario_origem) = lower(origem.email)
join public.usuarios destino
  on lower(c.contato_usuario) = lower(destino.usuario)
  or lower(c.contato_usuario) = lower(destino.email)
where origem.email is not null
  and destino.email is not null
on conflict (usuario_email, contato_email)
do update set ultima_leitura = greatest(
    public.leituras_conversas_privadas.ultima_leitura,
    excluded.ultima_leitura
);
