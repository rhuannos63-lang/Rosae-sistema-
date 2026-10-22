-- Testes da Etapa 3: contratação de parceiros, rateio e resultado por serviço.
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
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
create or replace function pg_temp.cat(p_nat text) returns uuid language sql as $$ select id from public.categoria where natureza = p_nat and ativo order by ordem limit 1 $$;
create or replace function pg_temp.conta() returns uuid language sql as $$ select id from public.conta_bancaria where ativa order by ordem limit 1 $$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- Obra fictícia preço fechado: R$ 2.000 em dois serviços.
insert into public.obra (id, nome, data_inicio) values ('50000000-0000-0000-0000-000000000001', 'Obra Resultado (fictícia)', '2026-10-01');
insert into public.obra_financeiro (obra_id, modelo_contratacao, valor_contratado, data_contratacao)
values ('50000000-0000-0000-0000-000000000001', 'preco_fechado', 2000, '2026-10-01');
insert into public.servico (id, obra_id, nome) values
  ('51000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'Assentamento de piso'),
  ('51000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000001', 'Material do piso');
insert into public.servico_financeiro (servico_id, valor_vendido, previsto_mao_obra, previsto_material) values
  ('51000000-0000-0000-0000-00000000000a', 1500, 700, 0),
  ('51000000-0000-0000-0000-00000000000b', 500, 0, 150);

-- Contratação do parceiro: R$ 750 de mão de obra no serviço A.
insert into public.contratacao (id, obra_id, servico_id, pessoa_id, descricao, valor_contratado)
values ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a',
        '10000000-0000-0000-0000-000000000002', 'Assentamento de piso por empreitada', 750);
select pg_temp.igual((select codigo from public.contratacao where id = '52000000-0000-0000-0000-000000000001'), 'CT-00001', 'código da contratação');
select pg_temp.deve_falhar($$insert into public.contratacao (obra_id, servico_id, pessoa_id, descricao, valor_contratado)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'x', 1)$$, 'serviço de outra obra');

-- Pagamento parcial de R$ 300 ao parceiro (lançamento ligado à contratação).
insert into t select 'l1', public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Parceiro piso etapa 1', 'categoria_id', pg_temp.cat('custo_mao_obra'), 'escopo', 'obra',
  'obra_id', '50000000-0000-0000-0000-000000000001', 'servico_id', '51000000-0000-0000-0000-00000000000a',
  'pessoa_id', '10000000-0000-0000-0000-000000000002', 'contratacao_id', '52000000-0000-0000-0000-000000000001',
  'valor_total', 300, 'data_competencia', '2026-10-10',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 300, 'vencimento', '2026-10-10'))))::text;
select public.registrar_liquidacao((select id from public.parcela where lancamento_id = (select v::uuid from t where k = 'l1')), pg_temp.conta(), 300, '2026-10-10', null, 'ct-pag-1');
select pg_temp.deve_falhar($$select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'receber', 'descricao', 'x', 'categoria_id', pg_temp.cat('receita_servico'), 'escopo', 'obra', 'obra_id', '50000000-0000-0000-0000-000000000001',
  'contratacao_id', '52000000-0000-0000-0000-000000000001', 'valor_total', 1, 'data_competencia', '2026-10-10',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1, 'vencimento', '2026-10-10'))))$$, 'conta a receber ligada a contratação');

select pg_temp.igual((select saldo_a_pagar from public.v_contratacao where id = '52000000-0000-0000-0000-000000000001'), 450.00, 'contratado não pago continua como obrigação');
select pg_temp.igual((select a_lancar from public.v_contratacao where id = '52000000-0000-0000-0000-000000000001'), 450.00, 'falta lançar');

-- Compra de material R$ 100 no serviço B.
select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Porcelanato', 'categoria_id', pg_temp.cat('custo_material'), 'escopo', 'obra',
  'obra_id', '50000000-0000-0000-0000-000000000001', 'servico_id', '51000000-0000-0000-0000-00000000000b',
  'valor_total', 100, 'data_competencia', '2026-10-11',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 100, 'vencimento', '2026-10-20'))));

-- Compra rateada: R$ 90 = R$ 60 na obra de resultado (serviço B) + R$ 30 na Obra Um.
select pg_temp.deve_falhar($$select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Argamassa (rateio errado)', 'categoria_id', pg_temp.cat('custo_material'), 'escopo', 'obra',
  'obra_id', '50000000-0000-0000-0000-000000000001', 'valor_total', 90, 'data_competencia', '2026-10-12',
  'rateio', jsonb_build_array(jsonb_build_object('obra_id', '50000000-0000-0000-0000-000000000001', 'servico_id', '51000000-0000-0000-0000-00000000000b', 'valor', 60),
                              jsonb_build_object('obra_id', '20000000-0000-0000-0000-000000000001', 'valor', 20)),
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 90, 'vencimento', '2026-10-12'))))$$, 'rateio que não soma o total');
insert into t select 'l3', public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Argamassa (rateada)', 'categoria_id', pg_temp.cat('custo_material'), 'escopo', 'obra',
  'obra_id', '50000000-0000-0000-0000-000000000001', 'valor_total', 90, 'data_competencia', '2026-10-12',
  'rateio', jsonb_build_array(jsonb_build_object('obra_id', '50000000-0000-0000-0000-000000000001', 'servico_id', '51000000-0000-0000-0000-00000000000b', 'valor', 60),
                              jsonb_build_object('obra_id', '20000000-0000-0000-0000-000000000001', 'valor', 30)),
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 90, 'vencimento', '2026-10-12'))))::text;
select public.registrar_liquidacao((select id from public.parcela where lancamento_id = (select v::uuid from t where k = 'l3')), pg_temp.conta(), 90, '2026-10-12', null, 'rateio-pag-1');
select pg_temp.igual((select sum(valor) from public.v_alocacao where lancamento_id = (select v::uuid from t where k = 'l3')), 90.00, 'rateio mantém o total');
select pg_temp.igual((select sum(pago) from public.v_alocacao where lancamento_id = (select v::uuid from t where k = 'l3')), 90.00, 'pagamento distribuído pelo rateio');
begin;
set constraints all immediate;
select pg_temp.deve_falhar($$update public.lancamento_rateio set valor = 10 where lancamento_id = (select v::uuid from t where k = 'l3') and valor = 30$$, 'editar linha do rateio sem fechar a soma');
commit;

-- Recebimento de R$ 1.000 do cliente no serviço A.
insert into t select 'l4', public.salvar_lancamento(jsonb_build_object(
  'tipo', 'receber', 'descricao', 'Entrada do cliente', 'categoria_id', pg_temp.cat('receita_servico'), 'escopo', 'obra',
  'obra_id', '50000000-0000-0000-0000-000000000001', 'servico_id', '51000000-0000-0000-0000-00000000000a',
  'valor_total', 1000, 'data_competencia', '2026-10-05',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1000, 'vencimento', '2026-10-05'))))::text;
select public.registrar_liquidacao((select id from public.parcela where lancamento_id = (select v::uuid from t where k = 'l4')), pg_temp.conta(), 1000, '2026-10-05', null, 'receb-1');

insert into t select 'r', public.resultado_obra_servicos('50000000-0000-0000-0000-000000000001')::text;
create or replace function pg_temp.serv(p_nome text, p_campo text) returns numeric language sql as $$
  select (s->>p_campo)::numeric from jsonb_array_elements((select v::jsonb->'servicos' from t where k = 'r')) s where s->>'nome' = p_nome $$;
create or replace function pg_temp.tot(p_campo text) returns numeric language sql as $$ select (v::jsonb->'total'->>p_campo)::numeric from t where k = 'r' $$;
grant execute on all functions in schema pg_temp to authenticated;
-- Serviço A: vendido 1.500, mão de obra contratada 750 → diferença estimada 750 (não é lucro líquido).
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'contratado'), 750.00, 'A contratado');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'pago'), 300.00, 'A pago');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'a_pagar'), 450.00, 'A a pagar');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'custo_estimado'), 750.00, 'A custo estimado');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'diferenca_estimada'), 750.00, 'A diferença estimada');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'variacao_previsto'), -50.00, 'A acima do previsto');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'recebido'), 1000.00, 'A recebido');
select pg_temp.igual(pg_temp.serv('Assentamento de piso', 'saldo_caixa'), 700.00, 'A saldo de caixa');
-- Serviço B: vendido 500, material 100 + 60 do rateio.
select pg_temp.igual(pg_temp.serv('Material do piso', 'lancado_material'), 160.00, 'B material lançado');
select pg_temp.igual(pg_temp.serv('Material do piso', 'diferenca_estimada'), 340.00, 'B diferença estimada');
select pg_temp.igual(pg_temp.serv('Material do piso', 'a_pagar'), 100.00, 'B a pagar');
select pg_temp.igual(pg_temp.tot('custo_estimado'), 910.00, 'custo estimado total');
select pg_temp.igual(pg_temp.tot('diferenca_estimada'), 1090.00, 'diferença estimada da obra');
select pg_temp.igual(pg_temp.tot('a_receber'), 0.00, 'nada a receber lançado');

-- Aditivo e cancelamento da contratação.
insert into public.contratacao_aditivo (contratacao_id, descricao, valor, motivo) values ('52000000-0000-0000-0000-000000000001', 'Rodapé', 120, 'Pedido do cliente');
select pg_temp.igual((select valor_total from public.v_contratacao where id = '52000000-0000-0000-0000-000000000001'), 870.00, 'aditivo soma ao contratado');
select pg_temp.igual((select valor_contratado from public.contratacao where id = '52000000-0000-0000-0000-000000000001'), 750.00, 'valor original preservado');
select pg_temp.deve_falhar($$update public.contratacao_aditivo set valor = 1$$, 'editar aditivo');
select pg_temp.deve_falhar($$update public.contratacao set estado = 'cancelada' where id = '52000000-0000-0000-0000-000000000001'$$, 'cancelar sem motivo');
update public.contratacao set estado = 'cancelada', motivo_cancelamento = 'Parceiro atrasou' where id = '52000000-0000-0000-0000-000000000001';
select pg_temp.igual((select saldo_a_pagar from public.v_contratacao where id = '52000000-0000-0000-0000-000000000001'), 0.00, 'cancelada: só o já lançado conta');
select pg_temp.deve_falhar($$update public.contratacao set estado = 'ativa' where id = '52000000-0000-0000-0000-000000000001'$$, 'reativar cancelada');
select pg_temp.igual((public.resultado_obra_servicos('50000000-0000-0000-0000-000000000001')->'total'->>'contratado')::numeric, 460.00, 'contratado após cancelamento');

-- Planejador
update public.empresa set provisao_impostos_pct = 6, reserva_minima = 500, pro_labore_planejado = 0;
select pg_temp.igual((public.planejador_destinacao()->>'configurado')::boolean, true, 'planejador configurado');
select pg_temp.igual((public.planejador_destinacao()->>'disponivel')::numeric,
  (public.planejador_destinacao()->>'saldo_contas')::numeric - (public.planejador_destinacao()->>'obrigacoes_obras')::numeric
  - (public.planejador_destinacao()->>'contratado_nao_lancado')::numeric - (public.planejador_destinacao()->>'despesas_empresa')::numeric
  - coalesce((public.planejador_destinacao()->>'provisao_tributos')::numeric, 0) - 500, 'disponível = saldo − compromissos');
reset role;

-- Sem financeiro e campo não veem nada disso.
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.deve_falhar($$select public.resultado_obra_servicos('50000000-0000-0000-0000-000000000001')$$, 'sem financeiro: resultado');
select pg_temp.deve_falhar($$select public.planejador_destinacao()$$, 'sem financeiro: planejador');
select pg_temp.igual((select count(*) from public.v_contratacao), 0::bigint, 'sem financeiro: contratações');
select pg_temp.igual((select count(*) from public.servico_financeiro), 0::bigint, 'sem financeiro: valores dos serviços');
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.contratacao), 0::bigint, 'campo: contratações');
select pg_temp.igual((select count(*) from public.lancamento_rateio), 0::bigint, 'campo: rateio');
reset role;
select pg_temp.como(null);
select pg_temp.deve_falhar($$select * from public.v_alocacao$$, 'anônimo: alocação');
reset role;
