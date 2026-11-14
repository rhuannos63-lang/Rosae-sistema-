-- Testes: montagem do portal gravada na obra chega ao cliente pelo portal_montar.
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
create or replace function pg_temp.igual(p_obtido anyelement, p_esperado anyelement, p_motivo text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (obtido %, esperado %)', p_motivo, p_obtido, p_esperado;
  end if;
end $$;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;
insert into t values ('o1', '20000000-0000-0000-0000-000000000001');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- Sem montagem: o portal recebe nulo e segue a sugestão do serviço.
update public.obra set portal_montagem = null where id = (select v::uuid from t where k = 'o1');
insert into t select 'pv', public.portal_previa((select v::uuid from t where k = 'o1'))::text;
select pg_temp.igual((select v::jsonb->'obra'->'montagem' from t where k = 'pv'), 'null'::jsonb, 'sem montagem gravada');

update public.obra set portal_montagem = '{"versao": 1, "perfil": "reforma", "blocos": [{"id": "novidade", "visivel": true}], "abas": {"fotos": false}}'
 where id = (select v::uuid from t where k = 'o1');
insert into t select 'pv2', public.portal_previa((select v::uuid from t where k = 'o1'))::text;
select pg_temp.igual((select v::jsonb->'obra'->'montagem'->'blocos'->0->>'id' from t where k = 'pv2'), 'novidade', 'montagem chega ao portal');
select pg_temp.igual((select v::jsonb->'obra'->'montagem'->'abas'->>'fotos' from t where k = 'pv2'), 'false', 'abas escolhidas chegam ao portal');

-- Só objeto; lista ou texto são recusados.
select pg_temp.deve_falhar($q$update public.obra set portal_montagem = '[1,2]' where id = '20000000-0000-0000-0000-000000000001'$q$, 'montagem precisa ser objeto');

reset role;
