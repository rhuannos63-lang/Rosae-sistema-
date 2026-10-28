-- Testes: medições com aprovação do cliente pelo portal e assinatura do contrato pelo link.
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

-- Obra própria do teste, com contrato de R$ 10.000 e duas etapas visíveis.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into public.obra (id, nome, cliente_id, data_inicio) values ('80000000-0000-0000-0000-000000000001', 'Obra Medição (fictícia)', '10000000-0000-0000-0000-000000000001', '2026-10-01');
insert into public.obra_financeiro (obra_id, modelo_contratacao, valor_contratado, data_contratacao) values ('80000000-0000-0000-0000-000000000001', 'preco_fechado', 10000.00, '2026-10-01');
insert into t values ('o', '80000000-0000-0000-0000-000000000001'), ('s', '81000000-0000-0000-0000-000000000001');
insert into public.servico (id, obra_id, nome) values ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'Reforço de viga');
with x as (insert into public.etapa (obra_id, servico_id, nome, peso, percentual, estado) values
  ('80000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Escoramento', 1, 100, 'executado') returning id)
  insert into t select 'e1', id::text from x;
with x as (insert into public.etapa (obra_id, servico_id, nome, peso, percentual, estado) values
  ('80000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Concretagem', 1, 0, 'nao_iniciado') returning id)
  insert into t select 'e2', id::text from x;
insert into t select 'tk', public.portal_criar_acesso('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 30);

-- ---------------------------------------------------------------------
-- Medições
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.criar_medicao('80000000-0000-0000-0000-000000000001')$$, 'campo gerando medição');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'm1', public.criar_medicao('80000000-0000-0000-0000-000000000001', '2026-10-20', 'Primeira medição')::text;
select pg_temp.igual((select percentual_atual from public.medicao where id = (select v::uuid from t where k = 'm1')), 50.0, 'avanço ponderado da obra');
select pg_temp.igual((select valor_medido from public.medicoes_valores('80000000-0000-0000-0000-000000000001')), 5000.00, 'valor medido = contratado × avanço do período');
select pg_temp.deve_falhar($$select public.criar_medicao('80000000-0000-0000-0000-000000000001')$$, 'duas medições em aberto');

-- Rascunho não aparece ao cliente
select pg_temp.como(null);
select pg_temp.igual(jsonb_array_length(public.portal_dados((select v from t where k = 'tk'))->'medicoes'), 0, 'rascunho fora do portal');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select public.enviar_medicao((select v::uuid from t where k = 'm1'));
select pg_temp.deve_falhar($$update public.medicao set percentual_atual = 99 where id = (select v::uuid from t where k = 'm1')$$, 'medição enviada não muda');

-- O escritório sem financeiro não lê o valor medido
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.deve_falhar($$select valor_medido from public.medicao$$, 'coluna de valor protegida');
select pg_temp.igual((select count(*) from public.medicoes_valores('80000000-0000-0000-0000-000000000001')), 0::bigint, 'sem financeiro não vê valores');
select pg_temp.igual((select count(*) from public.medicao where obra_id = '80000000-0000-0000-0000-000000000001'), 1::bigint, 'escritório vê a medição');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.medicao), 0::bigint, 'campo não vê medições');

-- Cliente vê sem valores e responde
select pg_temp.como(null);
insert into t select 'pd', public.portal_dados((select v from t where k = 'tk'))::text;
select pg_temp.igual(jsonb_array_length((select v::jsonb from t where k = 'pd')->'medicoes'), 1, 'medição enviada no portal');
select pg_temp.igual(position('valor' in (select v::jsonb->'medicoes' from t where k = 'pd')::text) = 0 and position('5000.00' in (select v from t where k = 'pd')) = 0, true, 'portal sem valores da medição');
select pg_temp.deve_falhar($$select public.portal_responder_medicao((select v from t where k = 'tk'), (select v::uuid from t where k = 'm1'), 'hash-velho', 'aprovar', 'Cliente Fictício')$$, 'versão diferente da lida');
select pg_temp.deve_falhar($$select public.portal_responder_medicao((select v from t where k = 'tk'), (select v::uuid from t where k = 'm1'),
  ((select v::jsonb from t where k = 'pd')->'medicoes'->0->>'hash'), 'contestar', 'Cliente Fictício', '')$$, 'contestar sem dizer o motivo');
select pg_temp.deve_falhar($$select public.portal_responder_medicao('token-inventado', (select v::uuid from t where k = 'm1'), 'x', 'aprovar', 'Alguém')$$, 'token inválido');
select (public.portal_responder_medicao((select v from t where k = 'tk'), (select v::uuid from t where k = 'm1'),
  ((select v::jsonb from t where k = 'pd')->'medicoes'->0->>'hash'), 'aprovar', 'Cliente Fictício', null, 'teste'))->>'ok';
select pg_temp.deve_falhar($$select public.portal_responder_medicao((select v from t where k = 'tk'), (select v::uuid from t where k = 'm1'),
  ((select v::jsonb from t where k = 'pd')->'medicoes'->0->>'hash'), 'contestar', 'Cliente Fictício', 'mudei de ideia')$$, 'responder duas vezes');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select estado from public.medicao where id = (select v::uuid from t where k = 'm1')), 'aprovada', 'medição aprovada');
select pg_temp.igual((select count(*) from public.central_pendencias() where chave like 'medicao:%' and titulo like 'Medição aprovada%'), 1::bigint, 'pendência de lançar a cobrança');
select pg_temp.deve_falhar($$select public.cancelar_medicao((select v::uuid from t where k = 'm1'), 'erro')$$, 'cancelar medição aprovada');

-- Segunda medição parte da aprovada
update public.etapa set percentual = 100, estado = 'executado' where id = (select v::uuid from t where k = 'e2');
insert into t select 'm2', public.criar_medicao('80000000-0000-0000-0000-000000000001')::text;
select pg_temp.igual((select percentual_anterior from public.medicao where id = (select v::uuid from t where k = 'm2')), 50.0, 'anterior = última aprovada');
select pg_temp.igual((select numero from public.medicao where id = (select v::uuid from t where k = 'm2')), 2, 'numeração por obra');
select pg_temp.igual((select valor_medido from public.medicoes_valores('80000000-0000-0000-0000-000000000001') where id = (select v::uuid from t where k = 'm2')), 5000.00, 'só o avanço do período');
select public.cancelar_medicao((select v::uuid from t where k = 'm2'), 'Teste de cancelamento');
select pg_temp.deve_falhar($$delete from public.medicao where id = (select v::uuid from t where k = 'm2')$$, 'medição não se apaga');

-- ---------------------------------------------------------------------
-- Contrato assinado pelo link
-- ---------------------------------------------------------------------
with x as (insert into public.contrato (obra_id, modelo, valor_total, conteudo)
  values ('80000000-0000-0000-0000-000000000001', 'preco_fechado', 10000,
          jsonb_build_object('clausulas', jsonb_build_array(jsonb_build_object('codigo', 'objeto', 'titulo', 'Objeto', 'texto', 'Reforço de viga.', 'versao', 1, 'revisao_juridica', 'pendente'))))
  returning id) insert into t select 'c', id::text from x;
select pg_temp.deve_falhar($$select public.criar_link_contrato((select v::uuid from t where k = 'c'))$$, 'link de contrato em rascunho');
select public.emitir_contrato((select v::uuid from t where k = 'c'));
insert into t select 'ct', public.criar_link_contrato((select v::uuid from t where k = 'c'), 10);
select pg_temp.deve_falhar($$select token_hash from public.contrato_link$$, 'hash do link não é legível');

select pg_temp.como(null);
insert into t select 'cp', public.contrato_publico((select v from t where k = 'ct'))::text;
select pg_temp.igual((select v::jsonb from t where k = 'cp')->>'estado', 'emitido', 'contrato aberto pelo link');
select pg_temp.igual(public.contrato_publico('token-inventado') ? 'erro', true, 'link inválido não abre');
select pg_temp.deve_falhar($$select public.contrato_assinar((select v from t where k = 'ct'), 'Cliente Fictício', '123', null, (select v::jsonb->>'hash' from t where k = 'cp'), true)$$, 'documento inválido');
select pg_temp.deve_falhar($$select public.contrato_assinar((select v from t where k = 'ct'), 'Cliente Fictício', '123.456.789-09', null, (select v::jsonb->>'hash' from t where k = 'cp'), false)$$, 'sem concordar');
select pg_temp.deve_falhar($$select public.contrato_assinar((select v from t where k = 'ct'), 'Cliente Fictício', '123.456.789-09', null, 'outro-hash', true)$$, 'versão diferente');
select (public.contrato_assinar((select v from t where k = 'ct'), 'Cliente Fictício', '123.456.789-09', 'c@x.local', (select v::jsonb->>'hash' from t where k = 'cp'), true, 'teste'))->>'ok';
select pg_temp.deve_falhar($$select public.contrato_assinar((select v from t where k = 'ct'), 'Outra Pessoa', '12345678909', null, (select v::jsonb->>'hash' from t where k = 'cp'), true)$$, 'link usado é desativado');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select estado from public.contrato where id = (select v::uuid from t where k = 'c')), 'assinado', 'contrato assinado');
select pg_temp.igual((select documento from public.contrato_aceite where contrato_id = (select v::uuid from t where k = 'c')), '12345678909', 'aceite guardado');
select pg_temp.igual((select status from public.obra where id = '80000000-0000-0000-0000-000000000001') in ('contratada', 'em_execucao'), true, 'obra formalizada');
select pg_temp.deve_falhar($$update public.contrato_aceite set nome = 'x'$$, 'aceite imutável');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.contrato_aceite), 0::bigint, 'campo não vê aceites');
reset role;
