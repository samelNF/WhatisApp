alter table public.figurinhas
    alter column favoritada set default true;

update public.figurinhas
set favoritada = true
where storage_path is not null
  and favoritada is distinct from true;
