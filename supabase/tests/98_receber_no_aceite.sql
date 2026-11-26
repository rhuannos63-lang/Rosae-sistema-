-- A receber nasce no aceite do cliente, sem depender de contrato; retroativo sem duplicar.
create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
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

insert into public.pessoa (id, nome, eh_cliente) values
  ('10000000-0000-0000-0000-000000000098', 'Cliente Aceite (fictício)', true),
  ('10000000-0000-0000-0000-000000000099', 'Cliente Antigo (fictício)', true);

-- Monta e emite uma proposta com 2 parcelas; devolve o token do link.
create or replace function pg_temp.proposta(p_chave text, p_pessoa uuid, p_total numeric, p_parcelas jsonb) returns void language plpgsql as $$
declare v_p uuid; v_v uuid;
begin
  insert into public.proposta (pessoa_id, titulo) values (p_pessoa, 'Laudo ' || p_chave || ' (fictício)') returning id into v_p;
  v_v := public.nova_versao_proposta(v_p);
  update public.proposta_versao set valor_total = p_total, conteudo = jsonb_build_object('validade_dias', 15,
    'ambientes', jsonb_build_array(jsonb_build_object('nome', '', 'itens', jsonb_build_array(jsonb_build_object('id', 'i1', 'titulo', 'Laudo técnico', 'quantidade', 1, 'unidade', 'vb', 'total', p_total)))),
    'pagamento', jsonb_build_object('parcelas', p_parcelas)) where id = v_v;
  perform public.emitir_versao(v_v);
  insert into t values (p_chave || ':p', v_p::text), (p_chave || ':v', v_v::text), (p_chave || ':tok', public.criar_link_proposta(v_v, 30));
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- 1. Cliente aceita pelo link (sem login): já vira a receber, com as parcelas, sem contrato.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.proposta('a', '10000000-0000-0000-0000-000000000098', 3000, '[{"descricao":"Sinal","valor":1500},{"descricao":"Entrega","valor":1500}]');
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'a:tok'), 'aceitar', 'Cliente Aceite', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) from public.lancamento where tipo = 'receber' and documento_ref = 'proposta:' || (select v from t where k = 'a:v')), 1::bigint, 'aceite cria o a receber');
select pg_temp.igual((select valor_total from public.lancamento where documento_ref = 'proposta:' || (select v from t where k = 'a:v')), 3000.00, 'a receber com o valor aceito');
select pg_temp.igual((select count(*) from public.parcela p join public.lancamento l on l.id = p.lancamento_id where l.documento_ref = 'proposta:' || (select v from t where k = 'a:v')), 2::bigint, 'parcelas das condições aceitas');
select pg_temp.igual((select count(*) from public.contrato c join public.obra o on o.id = c.obra_id where o.proposta_versao_id = (select v::uuid from t where k = 'a:v')), 0::bigint, 'sem contrato');
select pg_temp.igual((select status from public.obra where proposta_versao_id = (select v::uuid from t where k = 'a:v')), 'aprovada', 'serviço nasce aprovado');
-- Converter à mão depois não duplica.
select public.converter_proposta((select v::uuid from t where k = 'a:v'));
select pg_temp.igual((select count(*) from public.lancamento where tipo = 'receber' and documento_ref = 'proposta:' || (select v from t where k = 'a:v')), 1::bigint, 'converter depois não duplica');

-- 2. Retroativo: aceitos antes desta mudança entram uma vez; o que já foi lançado à mão não duplica.
reset role;
alter table public.proposta disable trigger proposta_aceita_receber;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.proposta('c', '10000000-0000-0000-0000-000000000099', 5500, '[{"descricao":"Sinal","valor":2750},{"descricao":"Entrega","valor":2750}]');
select pg_temp.proposta('d', '10000000-0000-0000-0000-000000000099', 4200, '[]');
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'c:tok'), 'aceitar', 'Cliente Antigo', null, null, null);
select public.proposta_responder((select v from t where k = 'd:tok'), 'aceitar', 'Cliente Antigo', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- 'd' já tinha um a receber lançado à mão, do mesmo cliente e valor.
select public.salvar_lancamento(jsonb_build_object('tipo', 'receber', 'descricao', 'Laudo d (à mão)', 'pessoa_id', '10000000-0000-0000-0000-000000000099',
  'categoria_id', (select id from public.categoria where tipo = 'receber' and natureza = 'receita_servico' order by ordem limit 1),
  'escopo', 'empresa', 'valor_total', 4200, 'data_competencia', '2026-11-01',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 4200, 'vencimento', '2026-12-01'))));
reset role;
alter table public.proposta enable trigger proposta_aceita_receber;
select public.lancar_receber_do_aceite(id) from public.proposta where estado = 'aprovada' order by aprovada_em;
select public.lancar_receber_do_aceite(id) from public.proposta where estado = 'aprovada' order by aprovada_em;
select pg_temp.igual((select count(*) from public.lancamento where tipo = 'receber' and documento_ref = 'proposta:' || (select v from t where k = 'c:v')), 1::bigint, 'retroativo lança uma vez');
select pg_temp.igual((select count(*) from public.lancamento where tipo = 'receber' and not cancelado and pessoa_id = '10000000-0000-0000-0000-000000000099' and valor_total = 4200), 1::bigint, 'lançado à mão não duplica');
select pg_temp.igual((select count(*) from public.lancamento where tipo = 'receber' and documento_ref = 'proposta:' || (select v from t where k = 'a:v')), 1::bigint, 'aceite novo não duplica no retroativo');
