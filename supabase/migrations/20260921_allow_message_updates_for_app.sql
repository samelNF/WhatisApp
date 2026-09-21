drop policy if exists "Permitir atualização de mensagens" on public.mensagens;

create policy "Permitir atualização de mensagens"
on public.mensagens
for update
to anon, authenticated
using (true)
with check (true);
