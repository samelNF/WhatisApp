-- Cor própria para grupos sem foto.
alter table public.grupos
add column if not exists cor text;

update public.grupos
set cor = case (get_byte(decode(md5(id::text), 'hex'), 0) % 9)
    when 0 then '#ff5722'
    when 1 then '#e91e63'
    when 2 then '#9c27b0'
    when 3 then '#673ab7'
    when 4 then '#3f51b5'
    when 5 then '#2196f3'
    when 6 then '#009688'
    when 7 then '#4caf50'
    else '#ff9800'
end
where cor is null or btrim(cor) = '';
