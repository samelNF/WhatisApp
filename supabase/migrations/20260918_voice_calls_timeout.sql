-- Expira ligações não atendidas mesmo se o chamador fechar o app.
create extension if not exists pg_cron;

create or replace function public.expirar_chamadas_sem_resposta()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.chamadas
       set status = 'missed',
           ended_at = now()
     where status = 'ringing'
       and created_at < now() - interval '70 seconds';
end;
$$;

do $$
declare
    job_record record;
begin
    for job_record in
        select jobid from cron.job where jobname = 'whatisapp_expirar_chamadas'
    loop
        perform cron.unschedule(job_record.jobid);
    end loop;
end
$$;

select cron.schedule(
    'whatisapp_expirar_chamadas',
    '* * * * *',
    'select public.expirar_chamadas_sem_resposta();'
);
