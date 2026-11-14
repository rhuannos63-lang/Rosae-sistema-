-- Comparativo orçado × fechado: só quem tem financeiro lê e grava; campo e cliente não veem custos.
create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.deve_falhar(p_sql text, p_motivo text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU: deveria ter sido recusado: %', p_motivo;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

insert into public.obra (id, nome) values ('00000000-0000-0000-0000-0000000c0e01', 'Obra do comparativo');

select pg_temp.como('00000000-0000-0000-0000-00000000000c');
insert into public.obra_comparativo (obra_id, dados) values ('00000000-0000-0000-0000-0000000c0e01', '{"linhas": {"item:1:mo": {"valor": 150000, "fornecedor": "João"}}}');
update public.obra_comparativo set dados = dados || '{"pacotes": {}}' where obra_id = '00000000-0000-0000-0000-0000000c0e01';
do $$ begin
  if (select dados->'linhas'->'item:1:mo'->>'valor' from public.obra_comparativo where obra_id = '00000000-0000-0000-0000-0000000c0e01') <> '150000' then
    raise exception 'FALHOU: quem tem financeiro deveria gravar e ler o comparativo';
  end if;
end $$;
select pg_temp.deve_falhar($$ insert into public.obra_comparativo (obra_id, dados) values ('00000000-0000-0000-0000-0000000c0e01', '[]') $$, 'dados precisam ser um objeto');

select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.obra_comparativo) then raise exception 'FALHOU: administrativo sem financeiro não pode ver custos'; end if;
end $$;
select pg_temp.deve_falhar($$ insert into public.obra_comparativo (obra_id) values ('00000000-0000-0000-0000-0000000c0e01') $$, 'sem financeiro não grava');

select pg_temp.como('00000000-0000-0000-0000-00000000000d');
do $$ begin
  if exists (select 1 from public.obra_comparativo) then raise exception 'FALHOU: campo não pode ver custos'; end if;
end $$;
select pg_temp.como(null);
select pg_temp.deve_falhar($$ select * from public.obra_comparativo $$, 'visitante não lê');
reset role;
