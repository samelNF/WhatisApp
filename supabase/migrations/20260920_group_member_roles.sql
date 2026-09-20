-- Cargos de participantes do grupo.
-- dono: proprietário atual do grupo
-- admin: administrador promovido
-- membro: participante comum

alter table public.grupo_membros
add column if not exists cargo text not null default 'membro';

update public.grupo_membros gm
set cargo = 'dono'
from public.grupos g
where gm.grupo_id = g.id
  and lower(coalesce(gm.usuario_email, '')) = lower(coalesce(g.criado_por, ''));

update public.grupo_membros
set cargo = 'membro'
where cargo is null or btrim(cargo) = '';

create index if not exists idx_grupo_membros_cargo
on public.grupo_membros (grupo_id, cargo);
