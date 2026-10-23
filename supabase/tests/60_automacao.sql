-- Testes da Etapa 6: notas fiscais (sem gasto em dobro, soma conferida, rateio) e central de pendências.
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
insert into t values ('o1', '20000000-0000-0000-0000-000000000001'), ('o2', '20000000-0000-0000-0000-000000000002'),
  ('s1', '30000000-0000-0000-0000-000000000001'), ('chave', '33261012345678000199550010000012341000012345');
insert into t select 'cat', id::text from public.categoria where nome = 'Material de obra';

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- Nota com 2 itens em 2 obras, frete distribuído e 2 duplicatas.
with x as (insert into public.nota_fiscal (chave, numero, serie, emitente_documento, emitente_nome, data_emissao, valor_produtos, valor_frete, valor_desconto, valor_total, duplicatas)
           values ((select v from t where k = 'chave'), '1234', '1', '12345678000199', 'Loja Fictícia', '2026-10-15', 900, 20, 10, 910,
                   '[{"numero": "001", "vencimento": "2026-11-15", "valor": 455}, {"numero": "002", "vencimento": "2026-12-15", "valor": 455}]') returning id)
  insert into t select 'n1', id::text from x;
insert into public.nota_item (nota_id, numero, descricao, quantidade, valor_bruto, frete, desconto, obra_id, servico_id) values
  ((select v::uuid from t where k = 'n1'), 1, 'Cimento CP-II 50 kg', 10, 600, 13.32, 6.67, (select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 's1')),
  ((select v::uuid from t where k = 'n1'), 2, 'Areia média', 2, 300, 6.67, 3.33, (select v::uuid from t where k = 'o2'), null);
select pg_temp.deve_falhar($$select public.confirmar_nota((select v::uuid from t where k = 'n1'), (select v::uuid from t where k = 'cat'))$$, 'soma dos itens diferente do total');
update public.nota_item set frete = 13.33 where nota_id = (select v::uuid from t where k = 'n1') and numero = 1;
select pg_temp.deve_falhar($$update public.nota_fiscal set estado = 'confirmada', lancamento_id = (select id from public.lancamento limit 1) where id = (select v::uuid from t where k = 'n1')$$, 'confirmar por fora do botão');
select pg_temp.deve_falhar($$insert into public.nota_fiscal (chave, valor_total) values ((select v from t where k = 'chave'), 1)$$, 'mesma chave duas vezes');
select pg_temp.igual((select count(*) from public.notas_semelhantes((select v from t where k = 'chave'), null, null, null, null, null)), 1::bigint, 'duplicidade pela chave');
select pg_temp.igual((select count(*) from public.notas_semelhantes(null, '12345678000199', '1234', '1', null, null)), 1::bigint, 'duplicidade por emitente, série e número');
select pg_temp.deve_falhar($$insert into public.nota_item (nota_id, numero, descricao, valor_bruto, obra_id, servico_id) values ((select v::uuid from t where k = 'n1'), 9, 'x', 1, (select v::uuid from t where k = 'o2'), (select v::uuid from t where k = 's1'))$$, 'serviço de outra obra no item');

insert into t select 'nl', (select count(*) from public.lancamento)::text;
insert into t select 'l1', public.confirmar_nota((select v::uuid from t where k = 'n1'), (select v::uuid from t where k = 'cat'))::text;
select pg_temp.igual((select count(*) from public.lancamento)::text, ((select v::int from t where k = 'nl') + 1)::text, 'uma conta a pagar criada');
select pg_temp.igual((select valor_total from public.lancamento where id = (select v::uuid from t where k = 'l1')), 910.00, 'conta com o total da nota');
select pg_temp.igual((select escopo::text from public.lancamento where id = (select v::uuid from t where k = 'l1')), 'obra', 'nota de obra vira custo de obra');
select pg_temp.igual((select sum(valor) from public.lancamento_rateio where lancamento_id = (select v::uuid from t where k = 'l1')), 910.00, 'rateio fecha o total');
select pg_temp.igual((select valor from public.lancamento_rateio where lancamento_id = (select v::uuid from t where k = 'l1') and obra_id = (select v::uuid from t where k = 'o2')), 303.34, 'parte da segunda obra');
select pg_temp.igual((select count(*) from public.parcela where lancamento_id = (select v::uuid from t where k = 'l1')), 2::bigint, 'parcelas pelas duplicatas');
select pg_temp.igual((select estado from public.nota_fiscal where id = (select v::uuid from t where k = 'n1')), 'confirmada', 'nota confirmada');
select pg_temp.deve_falhar($$select public.confirmar_nota((select v::uuid from t where k = 'n1'), (select v::uuid from t where k = 'cat'))$$, 'confirmar de novo');
select pg_temp.deve_falhar($$update public.nota_item set valor_bruto = 1 where nota_id = (select v::uuid from t where k = 'n1')$$, 'mexer em item de nota confirmada');
select pg_temp.igual((select count(*) from public.notas_semelhantes(null, null, null, null, 910, '2026-10-15')), 0::bigint, 'conta já ligada à nota não aparece como duplicada');

-- Nota de uma conta a pagar já lançada: liga sem criar outra despesa.
insert into t select 'l2', public.salvar_lancamento(jsonb_build_object('tipo', 'pagar', 'descricao', 'Compra de tinta', 'categoria_id', (select v from t where k = 'cat'),
  'escopo', 'obra', 'obra_id', (select v from t where k = 'o1'), 'valor_total', 250, 'data_competencia', '2026-10-16',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 250, 'vencimento', '2026-10-30'))))::text;
with x as (insert into public.nota_fiscal (numero, emitente_documento, emitente_nome, data_emissao, valor_produtos, valor_total) values ('77', '99888777000166', 'Tintas Fictícias', '2026-10-16', 250, 250) returning id)
  insert into t select 'n2', id::text from x;
select pg_temp.igual((select count(*) from public.notas_semelhantes(null, '99888777000166', '77', null, 250, '2026-10-16') where tipo = 'lancamento'), 1::bigint, 'sugere a conta a pagar existente');
with x as (insert into public.material (obra_id, descricao, quantidade, responsavel_compra) values ((select v::uuid from t where k = 'o1'), 'Tinta acrílica 18 L', 2, 'rosae') returning id)
  insert into t select 'm1', id::text from x;
insert into public.nota_item (nota_id, numero, descricao, quantidade, valor_bruto, obra_id, material_id) values
  ((select v::uuid from t where k = 'n2'), 1, 'Tinta acrílica 18 L', 2, 250, (select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 'm1'));
insert into t select 'nl2', (select count(*) from public.lancamento)::text;
select public.confirmar_nota((select v::uuid from t where k = 'n2'), null, (select v::uuid from t where k = 'l2'));
select pg_temp.igual((select count(*) from public.lancamento)::text, (select v from t where k = 'nl2'), 'nenhuma despesa nova');
select pg_temp.igual((select lancamento_id from public.nota_fiscal where id = (select v::uuid from t where k = 'n2')), (select v::uuid from t where k = 'l2'), 'nota ligada à conta existente');
select pg_temp.igual((select count(*) from public.material_evento where material_id = (select v::uuid from t where k = 'm1') and tipo = 'compra' and lancamento_id = (select v::uuid from t where k = 'l2')), 1::bigint, 'compra do material registrada pela nota');

-- Itens com e sem obra na mesma nota: recusado.
with x as (insert into public.nota_fiscal (numero, valor_total) values ('88', 30) returning id) insert into t select 'n3', id::text from x;
insert into public.nota_item (nota_id, numero, descricao, valor_bruto, obra_id) values
  ((select v::uuid from t where k = 'n3'), 1, 'Item da obra', 20, (select v::uuid from t where k = 'o1')), ((select v::uuid from t where k = 'n3'), 2, 'Item da empresa', 10, null);
select pg_temp.deve_falhar($$select public.confirmar_nota((select v::uuid from t where k = 'n3'), (select v::uuid from t where k = 'cat'))$$, 'itens com e sem obra');

-- Permissões: campo e adm sem financeiro não veem notas.
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.nota_fiscal), 0::bigint, 'campo não vê notas');
select pg_temp.deve_falhar($$insert into public.nota_fiscal (valor_total) values (10)$$, 'campo criando nota');
select pg_temp.igual((select count(*) from public.central_pendencias() where tipo in ('pagamento', 'recebimento', 'nota')), 0::bigint, 'campo não vê pendências financeiras');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual((select count(*) from public.nota_fiscal), 0::bigint, 'adm sem financeiro não vê notas');
select pg_temp.deve_falhar($$select public.confirmar_nota((select v::uuid from t where k = 'n3'), null)$$, 'adm sem financeiro confirmando');

-- Central de pendências e aviso dispensado.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) from public.central_pendencias() where chave = 'nota:' || (select v from t where k = 'n3')), 1::bigint, 'nota em rascunho na central');
select pg_temp.igual((select count(*) > 0 from public.central_pendencias() where tipo = 'pagamento'), true, 'pagamentos próximos na central');
insert into public.aviso_dispensado (chave, ate) values ('nota:' || (select v from t where k = 'n3'), '2099-01-01');
select pg_temp.igual((select count(*) from public.central_pendencias() where chave = 'nota:' || (select v from t where k = 'n3')), 0::bigint, 'aviso dispensado some');
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.igual((select count(*) from public.central_pendencias() where chave = 'nota:' || (select v from t where k = 'n3')), 1::bigint, 'dispensar vale só para quem dispensou');
select pg_temp.igual((select count(*) from public.aviso_dispensado), 0::bigint, 'não lê avisos de outro usuário');
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.igual((select count(*) from public.central_pendencias()), 0::bigint, 'perfil cliente sem pendências internas');
reset role;
