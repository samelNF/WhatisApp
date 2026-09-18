-- Permissões necessárias para o cliente WebRTC atual.
grant select, insert, update on table public.chamadas to anon, authenticated;
grant select, insert, delete on table public.chamada_ice_candidates to anon, authenticated;
grant usage, select on sequence public.chamada_ice_candidates_id_seq to anon, authenticated;
