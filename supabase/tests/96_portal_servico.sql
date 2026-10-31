-- Testes: portal imersivo recebe o tipo de serviço, o tipo do orçamento e os entregáveis (nunca valores).
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
update public.obra set tipo_servico = 'Reforma' where id = (select v::uuid from t where k = 'o1');
insert into t select 'pv', public.portal_previa((select v::uuid from t where k = 'o1'))::text;
select pg_temp.igual((select v::jsonb->'obra'->>'tipo_servico' from t where k = 'pv'), 'Reforma', 'portal recebe o tipo de serviço');
select pg_temp.igual((select jsonb_typeof(v::jsonb->'obra'->'entregaveis') from t where k = 'pv'), 'array', 'entregáveis sempre em lista');
select pg_temp.igual((select v::jsonb ? 'medicoes' from t where k = 'pv'), true, 'medições continuam no portal');

-- Proposta aprovada com orçamento automático: perfil e entregáveis vêm da versão de origem.
reset role;
with pr as (insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', 'Projeto fictício') returning id),
     v as (insert into public.proposta_versao (proposta_id, numero, conteudo, valor_total)
           select id, 1, '{"gerador": {"tipo": "projeto_estrutural"}, "entregaveis": ["Pranchas de formas", "Memorial de cálculo"], "ambientes": []}', 0 from pr returning id)
  insert into t select 'v', id::text from v;
update public.obra set proposta_versao_id = (select v::uuid from t where k = 'v') where id = (select v::uuid from t where k = 'o1');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'pv2', public.portal_previa((select v::uuid from t where k = 'o1'))::text;
select pg_temp.igual((select v::jsonb->'obra'->>'perfil' from t where k = 'pv2'), 'projeto_estrutural', 'perfil do orçamento automático');
select pg_temp.igual((select v::jsonb->'obra'->'entregaveis'->>1 from t where k = 'pv2'), 'Memorial de cálculo', 'entregáveis da proposta');
select pg_temp.igual((select v from t where k = 'pv2') ~ 'valor_total|preco_unitario', false, 'nenhum valor da proposta vai ao portal');

-- Ninguém de fora chama a montagem direto.
select pg_temp.como(null);
select pg_temp.deve_falhar($$select public.portal_montar('20000000-0000-0000-0000-000000000001', null)$$, 'anônimo chamando a montagem');
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.deve_falhar($$select public.portal_montar('20000000-0000-0000-0000-000000000001', null)$$, 'cliente chamando a montagem');
reset role;
