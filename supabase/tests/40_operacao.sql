-- Testes da Etapa 4: conversão proposta → obra, contrato, aditivo, cronograma, materiais, fichas e registros.
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

-- ---------------------------------------------------------------------
-- Proposta aprovada (fictícia) com 2 itens em 2 ambientes
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
with x as (insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', 'Reforma conversão (fictícia)') returning id) insert into t select 'p', id::text from x;
insert into t select 'v', public.nova_versao_proposta((select v::uuid from t where k = 'p'))::text;
update public.proposta_versao set valor_total = 3000, conteudo = jsonb_build_object(
  'validade_dias', 15, 'local', 'Rua Fictícia, 10',
  'ambientes', jsonb_build_array(
    jsonb_build_object('nome', 'Cozinha', 'itens', jsonb_build_array(jsonb_build_object('id', 'i1', 'titulo', 'Reforma da cozinha', 'unidade', 'm2', 'quantidade', 10, 'total', 2000,
      'modelo_id', (select id from public.modelo_servico where nome = 'Reforma')))),
    jsonb_build_object('nome', 'Banheiro', 'itens', jsonb_build_array(jsonb_build_object('id', 'i2', 'titulo', 'Pintura do banheiro', 'unidade', 'vb', 'quantidade', 1, 'total', 1000)))),
  'pagamento', jsonb_build_object('parcelas', jsonb_build_array(jsonb_build_object('descricao', 'Entrada', 'valor', 1500), jsonb_build_object('descricao', 'Final', 'valor', 1500))))
where id = (select v::uuid from t where k = 'v');
select pg_temp.deve_falhar($$select public.converter_proposta((select v::uuid from t where k = 'v'))$$, 'converter proposta não aprovada');
select public.emitir_versao((select v::uuid from t where k = 'v'));
insert into t select 'tok', public.criar_link_proposta((select v::uuid from t where k = 'v'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tok'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.deve_falhar($$select public.converter_proposta((select v::uuid from t where k = 'v'))$$, 'anônimo convertendo');

select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.converter_proposta((select v::uuid from t where k = 'v'))$$, 'campo convertendo');

-- Conversão (duas vezes: não duplica).
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'o', public.converter_proposta((select v::uuid from t where k = 'v'))::text;
select pg_temp.igual(public.converter_proposta((select v::uuid from t where k = 'v'))::text, (select v from t where k = 'o'), 'conversão repetida devolve a mesma obra');
select pg_temp.igual((select count(*) from public.obra where proposta_versao_id = (select v::uuid from t where k = 'v')), 1::bigint, 'uma obra só');
select pg_temp.igual((select count(*) from public.servico where obra_id = (select v::uuid from t where k = 'o')), 2::bigint, 'serviços importados uma vez');
select pg_temp.igual((select count(*) from public.ambiente where obra_id = (select v::uuid from t where k = 'o')), 2::bigint, 'ambientes importados');
select pg_temp.igual((select status from public.obra where id = (select v::uuid from t where k = 'o')), 'aprovada', 'obra nasce como aprovada (não liberada)');
select pg_temp.igual((select sum(valor_vendido) from public.servico_financeiro sf join public.servico s on s.id = sf.servico_id where s.obra_id = (select v::uuid from t where k = 'o')), 3000.00, 'orçamento-base com o vendido');
select pg_temp.igual((select count(*) from public.lancamento where obra_id = (select v::uuid from t where k = 'o') and tipo = 'receber'), 1::bigint, 'previsão de recebimento criada uma vez');
select pg_temp.igual((select count(*) from public.parcela p join public.lancamento l on l.id = p.lancamento_id where l.obra_id = (select v::uuid from t where k = 'o')), 2::bigint, 'parcelas conforme condições');
select pg_temp.igual((select count(*) > 3 from public.etapa where obra_id = (select v::uuid from t where k = 'o')), true, 'etapas sugeridas pelo modelo');
select pg_temp.igual((select count(*) > 0 from public.material where obra_id = (select v::uuid from t where k = 'o')), true, 'materiais sugeridos');
select pg_temp.igual((select peso from public.servico where obra_id = (select v::uuid from t where k = 'o') and origem_item_id = 'i1'), 66.67, 'peso técnico pelo valor do item');
insert into t select 's1', id::text from public.servico where obra_id = (select v::uuid from t where k = 'o') and origem_item_id = 'i1';
insert into t select 's2', id::text from public.servico where obra_id = (select v::uuid from t where k = 'o') and origem_item_id = 'i2';

-- ---------------------------------------------------------------------
-- Contrato: rascunho → emitido (congelado) → assinado (obra formalizada)
-- ---------------------------------------------------------------------
with x as (insert into public.contrato (obra_id, proposta_versao_id, modelo, valor_total, conteudo)
  values ((select v::uuid from t where k = 'o'), (select v::uuid from t where k = 'v'), 'preco_fechado', 3000,
          jsonb_build_object('clausulas', (select jsonb_agg(jsonb_build_object('codigo', codigo, 'titulo', titulo, 'texto', texto, 'versao', versao, 'revisao_juridica', revisao_juridica)) from public.clausula)))
  returning id) insert into t select 'c', id::text from x;
select pg_temp.deve_falhar($$insert into public.contrato (obra_id, modelo) values ((select v::uuid from t where k = 'o'), 'gestao')$$, 'dois contratos ativos na mesma obra');
select pg_temp.deve_falhar($$update public.contrato set estado = 'assinado' where id = (select v::uuid from t where k = 'c')$$, 'assinar sem emitir');
select length(public.emitir_contrato((select v::uuid from t where k = 'c'))) = 64;
select pg_temp.igual((select minuta from public.contrato where id = (select v::uuid from t where k = 'c')), true, 'cláusulas sem revisão = minuta');
select pg_temp.deve_falhar($$update public.contrato set valor_total = 1 where id = (select v::uuid from t where k = 'c')$$, 'contrato emitido não muda');
select pg_temp.deve_falhar($$delete from public.contrato where id = (select v::uuid from t where k = 'c')$$, 'contrato não se apaga');
select pg_temp.deve_falhar($$select public.registrar_assinatura_contrato((select v::uuid from t where k = 'c'), '2026-10-22', '')$$, 'assinatura sem registro');
select public.registrar_assinatura_contrato((select v::uuid from t where k = 'c'), '2026-10-22', 'Assinatura digital (gov.br)');
select pg_temp.igual((select status from public.obra where id = (select v::uuid from t where k = 'o')), 'contratada', 'contrato assinado formaliza a obra');
select public.liberar_obra((select v::uuid from t where k = 'o'));
select pg_temp.igual((select status from public.obra where id = (select v::uuid from t where k = 'o')), 'em_execucao', 'obra liberada');

-- Cláusula: mudar texto cria versão nova e volta a minuta; revisada exige quem e quando.
select pg_temp.deve_falhar($$update public.clausula set revisao_juridica = 'revisada' where codigo = 'foro'$$, 'revisada sem responsável');
update public.clausula set revisao_juridica = 'revisada', revisado_por = 'Advogado fictício', revisado_em = '2026-10-22' where codigo = 'objeto';
update public.clausula set texto = texto || ' (ajuste)' where codigo = 'objeto';
select pg_temp.igual((select versao || revisao_juridica from public.clausula where codigo = 'objeto'), '2minuta', 'texto novo = versão 2 em minuta');
select pg_temp.igual((select count(*) from public.clausula_versao where clausula_id = (select id from public.clausula where codigo = 'objeto')), 1::bigint, 'versão anterior guardada');

-- ---------------------------------------------------------------------
-- Aditivo: preserva o contrato, entra como serviço novo, exige motivo
-- ---------------------------------------------------------------------
with x as (insert into public.proposta (tipo, pessoa_id, obra_id, titulo)
  values ('aditivo', '10000000-0000-0000-0000-000000000001', (select v::uuid from t where k = 'o'), 'Troca de tomadas (fictício)') returning id) insert into t select 'pa', id::text from x;
insert into t select 'va', public.nova_versao_proposta((select v::uuid from t where k = 'pa'))::text;
update public.proposta_versao set valor_total = 400, conteudo = '{"validade_dias":15,"impacto_prazo_dias":3,"ambientes":[{"nome":"Cozinha","itens":[{"id":"a1","titulo":"Troca de tomadas","unidade":"un","quantidade":8,"total":400}]}]}'
where id = (select v::uuid from t where k = 'va');
select pg_temp.deve_falhar($$select public.emitir_versao((select v::uuid from t where k = 'va'))$$, 'aditivo sem motivo');
update public.proposta_versao set conteudo = conteudo || '{"motivo":"Pedido do cliente durante a obra"}' where id = (select v::uuid from t where k = 'va');
select public.emitir_versao((select v::uuid from t where k = 'va'));
insert into t select 'toka', public.criar_link_proposta((select v::uuid from t where k = 'va'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'toka'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select public.converter_proposta((select v::uuid from t where k = 'va'));
select public.converter_proposta((select v::uuid from t where k = 'va'));
select pg_temp.igual((select count(*) from public.servico where obra_id = (select v::uuid from t where k = 'o')), 3::bigint, 'aditivo incorporado uma vez');
select pg_temp.igual((select valor_total from public.contrato where id = (select v::uuid from t where k = 'c')), 3000.00, 'contrato original preservado');
select pg_temp.igual((select valor_contratado from public.obra_financeiro where obra_id = (select v::uuid from t where k = 'o')), 3000.00, 'contratado original preservado');
select pg_temp.igual((public.resumo_obra((select v::uuid from t where k = 'o'))->>'aditivos')::numeric, 400.00, 'aditivo aparece à parte');
select pg_temp.igual((select count(*) from public.ambiente where obra_id = (select v::uuid from t where k = 'o')), 2::bigint, 'ambiente existente reaproveitado');

-- ---------------------------------------------------------------------
-- Cronograma e progresso físico
-- ---------------------------------------------------------------------
delete from public.etapa where obra_id = (select v::uuid from t where k = 'o');
insert into public.etapa (id, obra_id, servico_id, nome, peso, inicio_previsto, fim_previsto) values
  ('71000000-0000-0000-0000-000000000001', (select v::uuid from t where k = 'o'), (select v::uuid from t where k = 's1'), 'Demolição', 1, '2026-10-20', '2026-10-21'),
  ('71000000-0000-0000-0000-000000000002', (select v::uuid from t where k = 'o'), (select v::uuid from t where k = 's1'), 'Assentamento', 3, '2026-10-22', '2026-10-25'),
  ('71000000-0000-0000-0000-000000000003', (select v::uuid from t where k = 'o'), (select v::uuid from t where k = 's2'), 'Pintura', 1, '2026-10-26', '2026-10-27');
select pg_temp.igual((public.progresso_obra((select v::uuid from t where k = 'o'))->>'executado')::numeric, 0.0, 'progresso inicial zero');

-- Material comprado e entregue não muda o progresso.
with x as (insert into public.material (obra_id, servico_id, etapa_id, descricao, unidade, quantidade)
  values ((select v::uuid from t where k = 'o'), (select v::uuid from t where k = 's1'), '71000000-0000-0000-0000-000000000002', 'Porcelanato 60x60 (fictício)', 'm2', 12) returning id) insert into t select 'm', id::text from x;
select pg_temp.deve_falhar($$insert into public.material_evento (material_id, tipo, quantidade) values ((select v::uuid from t where k = 'm'), 'entrega', 1)$$, 'entrega antes da compra');
insert into public.material_evento (material_id, tipo, quantidade) values ((select v::uuid from t where k = 'm'), 'compra', 12);
select pg_temp.igual((select situacao from public.v_material where id = (select v::uuid from t where k = 'm')), 'comprado', 'comprado, aguardando entrega');
insert into public.material_evento (material_id, tipo, quantidade, local) values ((select v::uuid from t where k = 'm'), 'entrega', 5, 'Depósito da obra');
select pg_temp.igual((select situacao from public.v_material where id = (select v::uuid from t where k = 'm')), 'parcial', 'entrega parcial não é completa');
select pg_temp.igual((select localizacao from public.material where id = (select v::uuid from t where k = 'm')), 'Depósito da obra', 'localização atualizada');
select pg_temp.igual((select count(*) from public.alertas_materiais((select v::uuid from t where k = 'o')) where material_id = (select v::uuid from t where k = 'm')), 1::bigint, 'alerta de material faltando para etapa próxima');
select pg_temp.deve_falhar($$insert into public.material_evento (material_id, tipo, quantidade) values ((select v::uuid from t where k = 'm'), 'devolucao', 6)$$, 'devolução maior que o entregue');
select pg_temp.deve_falhar($$update public.material_evento set quantidade = 1$$, 'evento de material não se altera');
select pg_temp.igual((public.progresso_obra((select v::uuid from t where k = 'o'))->>'executado')::numeric, 0.0, 'compra não aumenta avanço físico');

-- Material do cliente: aparece na operação, nunca como despesa.
with x as (insert into public.material (obra_id, descricao, unidade, quantidade, responsavel_compra)
  values ((select v::uuid from t where k = 'o'), 'Louças (compra do cliente)', 'un', 2, 'cliente') returning id) insert into t select 'mc', id::text from x;
select pg_temp.igual((select situacao from public.v_material where id = (select v::uuid from t where k = 'mc')), 'aguardando_cliente', 'material do cliente aguardando');
insert into public.material_evento (material_id, tipo, quantidade) values ((select v::uuid from t where k = 'mc'), 'entrega', 2);
select pg_temp.deve_falhar($$insert into public.material_evento (material_id, tipo, quantidade, lancamento_id) values ((select v::uuid from t where k = 'mc'), 'compra', 2, (select id from public.lancamento limit 1))$$, 'material do cliente virando despesa');
select pg_temp.igual((public.resumo_obra((select v::uuid from t where k = 'o'))->>'custo_lancado')::numeric, 0.00, 'material do cliente não é custo da ROSAE');

-- Execução: Demolição concluída (peso 1 de 4 no serviço 1, que pesa 66,67 de 100 sem o aditivo).
update public.etapa set estado = 'executado' where id = '71000000-0000-0000-0000-000000000001';
select pg_temp.igual((select percentual from public.etapa where id = '71000000-0000-0000-0000-000000000001'), 100.00, 'executado = 100%');
select pg_temp.igual((select (x->>'executado')::numeric from jsonb_array_elements(public.progresso_obra((select v::uuid from t where k = 'o'))->'servicos') x where x->>'id' = (select v from t where k = 's1')), 25.0, 'progresso do serviço por peso');
select pg_temp.igual((public.progresso_obra((select v::uuid from t where k = 'o'))->>'conferido')::numeric, 0.0, 'execução não é conferência');
update public.etapa set estado = 'conferido' where id = '71000000-0000-0000-0000-000000000001';
select pg_temp.igual((select conferido_por from public.etapa where id = '71000000-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-00000000000a'::uuid, 'conferência registra quem');
select pg_temp.deve_falhar($$update public.etapa set estado = 'conferido' where id = '71000000-0000-0000-0000-000000000003'$$, 'conferir sem executar');
-- Medição por quantidade.
update public.etapa set quantidade_prevista = 12, quantidade_executada = 3, estado = 'em_execucao' where id = '71000000-0000-0000-0000-000000000002';
select pg_temp.igual((select percentual from public.etapa where id = '71000000-0000-0000-0000-000000000002'), 25.00, 'percentual por quantidade');
-- Cancelar etapa tira da base e fica contado à parte.
update public.etapa set estado = 'cancelado' where id = '71000000-0000-0000-0000-000000000003';
select pg_temp.igual((public.progresso_obra((select v::uuid from t where k = 'o'))->>'canceladas')::int, 1, 'cancelada contada à parte');

-- Linha de base: mudança de prazo exige motivo e preserva o original.
select pg_temp.igual(public.definir_linha_base((select v::uuid from t where k = 'o')), 2, 'base definida para etapas ativas');
select pg_temp.deve_falhar($$update public.etapa set fim_previsto = '2026-10-28' where id = '71000000-0000-0000-0000-000000000002'$$, 'mudar prazo sem motivo');
update public.etapa set fim_previsto = '2026-10-28', motivo_alteracao = 'Chuva e falta de material' where id = '71000000-0000-0000-0000-000000000002';
select pg_temp.igual((select fim_base from public.etapa where id = '71000000-0000-0000-0000-000000000002'), '2026-10-25'::date, 'base original preservada');
select pg_temp.igual((select motivo from public.etapa_historico where etapa_id = '71000000-0000-0000-0000-000000000002' and campo = 'prazo' order by em desc limit 1), 'Chuva e falta de material', 'motivo no histórico');

-- ---------------------------------------------------------------------
-- Campo: só obras atribuídas e só andamento
-- ---------------------------------------------------------------------
reset role;
insert into public.membro_obra (obra_id, usuario_id, papel) values ((select v::uuid from t where k = 'o'), '00000000-0000-0000-0000-00000000000d', 'campo');
insert into public.ficha (obra_id, servico_id, revisao, conteudo) values ((select v::uuid from t where k = 'o'), (select v::uuid from t where k = 's1'), 1, '{"atividades":["Proteger o ambiente"]}');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.etapa where obra_id = (select v::uuid from t where k = 'o')), 3::bigint, 'campo vê etapas da obra atribuída');
select pg_temp.igual((select count(*) from public.etapa where obra_id = '50000000-0000-0000-0000-000000000001'), 0::bigint, 'campo não vê outra obra');
update public.etapa set quantidade_executada = 6 where id = '71000000-0000-0000-0000-000000000002';
select pg_temp.igual((select percentual from public.etapa where id = '71000000-0000-0000-0000-000000000002'), 50.00, 'campo registra avanço');
select pg_temp.deve_falhar($$update public.etapa set peso = 10 where id = '71000000-0000-0000-0000-000000000002'$$, 'campo mudando peso');
update public.etapa set estado = 'executado' where id = '71000000-0000-0000-0000-000000000002';
select pg_temp.deve_falhar($$update public.etapa set estado = 'conferido' where id = '71000000-0000-0000-0000-000000000002'$$, 'campo conferindo');
insert into public.material_evento (material_id, tipo, quantidade) values ((select v::uuid from t where k = 'm'), 'entrega', 7);
select pg_temp.deve_falhar($$insert into public.material_evento (material_id, tipo, quantidade) values ((select v::uuid from t where k = 'm'), 'compra', 1)$$, 'campo registrando compra');
select pg_temp.igual((select situacao from public.v_material where id = (select v::uuid from t where k = 'm')), 'na_obra', 'entrega completa');
insert into public.registro (obra_id, tipo, texto) values ((select v::uuid from t where k = 'o'), 'andamento', 'Assentamento concluído na cozinha.');
select pg_temp.deve_falhar($$insert into public.registro (obra_id, tipo, texto) values ('50000000-0000-0000-0000-000000000001', 'andamento', 'x')$$, 'campo registrando em outra obra');
select pg_temp.deve_falhar($$insert into public.registro (obra_id, tipo, texto) values ((select v::uuid from t where k = 'o'), 'sistema', 'x')$$, 'registro de sistema pela tela');
insert into public.pendencia (obra_id, titulo, tipo, responsavel) values ((select v::uuid from t where k = 'o'), 'Cliente escolher rejunte', 'decisao_cliente', 'cliente');
select pg_temp.igual((select count(*) from public.ficha where obra_id = (select v::uuid from t where k = 'o')), 0::bigint, 'campo não vê ficha em rascunho');
select pg_temp.deve_falhar($$select public.liberar_ficha((select id from public.ficha limit 1))$$, 'campo liberando ficha');
select pg_temp.igual((select count(*) from public.contrato), 0::bigint, 'campo não vê contratos');
select pg_temp.igual((select count(*) from public.v_material where obra_id = '50000000-0000-0000-0000-000000000001'), 0::bigint, 'campo não vê materiais de outra obra');
select pg_temp.igual((select count(*) from public.material_pagamentos((select v::uuid from t where k = 'o'))), 0::bigint, 'campo não vê pagamentos de material');
select pg_temp.deve_falhar($$insert into storage.objects (bucket_id, name) values ('documentos', 'obras/50000000-0000-0000-0000-000000000001/fotos/x.jpg')$$, 'campo enviando foto de outra obra');
insert into storage.objects (bucket_id, name) values ('documentos', 'obras/' || (select v from t where k = 'o') || '/fotos/x.jpg');
select pg_temp.deve_falhar($$insert into storage.objects (bucket_id, name) values ('documentos', 'obras/' || (select v from t where k = 'o') || '/notas/x.pdf')$$, 'campo enviando fora da pasta de fotos');
insert into public.foto (obra_id, caminho, momento) values ((select v::uuid from t where k = 'o'), 'obras/' || (select v from t where k = 'o') || '/fotos/x.jpg', 'depois');

-- ---------------------------------------------------------------------
-- Fichas: liberação pelo escritório, revisão congelada
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select public.liberar_ficha((select id from public.ficha where servico_id = (select v::uuid from t where k = 's1') and revisao = 1));
select pg_temp.deve_falhar($$update public.ficha set conteudo = '{}' where revisao = 1 and servico_id = (select v::uuid from t where k = 's1')$$, 'ficha liberada não muda');
insert into t select 'f2', public.nova_revisao_ficha((select v::uuid from t where k = 's1'))::text;
select pg_temp.igual((select revisao from public.ficha where id = (select v::uuid from t where k = 'f2')), 2, 'nova revisão');
select public.liberar_ficha((select v::uuid from t where k = 'f2'));
select pg_temp.igual((select estado from public.ficha where servico_id = (select v::uuid from t where k = 's1') and revisao = 1), 'substituida', 'revisão anterior substituída');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select revisao from public.ficha where servico_id = (select v::uuid from t where k = 's1')), 2, 'campo vê só a revisão vigente');

-- Administrativo sem financeiro vê operação, mas não pagamento de material.
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual((select count(*) > 0 from public.v_material where obra_id = (select v::uuid from t where k = 'o')), true, 'administrativo vê materiais');
select pg_temp.igual((select count(*) from public.material_pagamentos((select v::uuid from t where k = 'o'))), 0::bigint, 'sem financeiro não vê pagamentos');

-- Cliente: nada pelas tabelas.
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.igual((select count(*) from public.etapa) + (select count(*) from public.registro) + (select count(*) from public.foto) + (select count(*) from public.material) + (select count(*) from public.pendencia), 0::bigint, 'cliente não lê tabelas internas');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select count(*) from public.etapa$$, 'anônimo lendo etapas');
reset role;
