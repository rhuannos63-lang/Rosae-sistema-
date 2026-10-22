-- Testes da Etapa 1: permissões por perfil e regras financeiras.
-- Cada bloco falha com exceção se a regra não for respeitada.

create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

create or replace function pg_temp.deve_falhar(p_sql text, p_motivo text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FALHOU: deveria ter sido recusado: %', p_motivo;
end $$;

create or replace function pg_temp.igual(p_obtido anyelement, p_esperado anyelement, p_motivo text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (obtido %, esperado %)', p_motivo, p_obtido, p_esperado;
  end if;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- Contas de teste no "auth"
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste.local'),
  ('00000000-0000-0000-0000-00000000000b', 'adm-sem-fin@teste.local'),
  ('00000000-0000-0000-0000-00000000000c', 'adm-com-fin@teste.local'),
  ('00000000-0000-0000-0000-00000000000d', 'campo@teste.local'),
  ('00000000-0000-0000-0000-00000000000e', 'cliente@teste.local');

-- 1. Primeiro acesso vira administrador; o segundo não consegue.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select public.reivindicar_administrador('Administrador Teste');
select pg_temp.igual(public.eh_admin(), true, 'primeiro usuário vira administrador');
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.deve_falhar($$select public.reivindicar_administrador('Intruso')$$, 'segundo administrador');
reset role;

-- 2. Administrador cadastra equipe, pessoas e obras.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into public.usuario (id, nome, papel, acesso_financeiro) values
  ('00000000-0000-0000-0000-00000000000b', 'Adm sem financeiro', 'administrativo', false),
  ('00000000-0000-0000-0000-00000000000c', 'Adm com financeiro', 'administrativo', true),
  ('00000000-0000-0000-0000-00000000000d', 'Campo', 'campo', false),
  ('00000000-0000-0000-0000-00000000000e', 'Cliente', 'cliente', false);

insert into public.pessoa (id, nome, email, telefone, eh_cliente) values
  ('10000000-0000-0000-0000-000000000001', 'Cliente Fictício', 'cliente@ficticio.local', '(21) 99999-0001', true);
insert into public.pessoa (id, nome, eh_prestador) values
  ('10000000-0000-0000-0000-000000000002', 'Parceiro Fictício', true);
select pg_temp.igual((select codigo from public.pessoa where id = '10000000-0000-0000-0000-000000000001'), 'PES-00001', 'código de pessoa');
select pg_temp.igual((select count(*) from public.pessoas_semelhantes(null, '21 99999-0001', null)), 1::bigint, 'duplicado por telefone');

insert into public.obra (id, nome, cliente_id, data_inicio) values
  ('20000000-0000-0000-0000-000000000001', 'Obra Um (fictícia)', '10000000-0000-0000-0000-000000000001', '2026-10-01'),
  ('20000000-0000-0000-0000-000000000002', 'Obra Dois (fictícia)', null, '2026-10-05');
select pg_temp.igual((select codigo from public.obra where id = '20000000-0000-0000-0000-000000000002'), 'OBR-2026-002', 'código de obra');
insert into public.obra_financeiro (obra_id, modelo_contratacao, valor_contratado, data_contratacao) values
  ('20000000-0000-0000-0000-000000000001', 'preco_fechado', 12000.00, '2026-10-10');
insert into public.membro_obra (obra_id, usuario_id, papel) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'campo'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'cliente');
insert into public.servico (id, obra_id, nome) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Reforço de viga');
insert into public.ambiente (id, obra_id, nome) values
  ('31000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Cozinha'),
  ('31000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Sala');
insert into public.servico_ambiente values ('30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001');
select pg_temp.deve_falhar($$insert into public.servico_ambiente values ('30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002')$$,
  'serviço ligado a ambiente de outra obra');

-- 3. Conta a receber em 3 parcelas (soma exata).
select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'receber', 'descricao', 'Contrato obra um', 'pessoa_id', '10000000-0000-0000-0000-000000000001',
  'categoria_id', (select id from public.categoria where nome = 'Execução de obra / reforma'),
  'escopo', 'obra', 'obra_id', '20000000-0000-0000-0000-000000000001',
  'servico_id', '30000000-0000-0000-0000-000000000001',
  'valor_total', '1000.00', 'data_competencia', '2026-10-10',
  'parcelas', jsonb_build_array(
    jsonb_build_object('numero', 1, 'valor', '333.34', 'vencimento', '2026-10-15'),
    jsonb_build_object('numero', 2, 'valor', '333.33', 'vencimento', '2026-11-15'),
    jsonb_build_object('numero', 3, 'valor', '333.33', 'vencimento', '2099-12-15'))));
select pg_temp.igual((select codigo from public.lancamento where descricao = 'Contrato obra um'), 'CR-000001', 'código CR');
select pg_temp.igual((select sum(valor) from public.parcela), 1000.00::numeric, 'soma das parcelas');

-- Soma errada é recusada.
select pg_temp.deve_falhar($$select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Errado', 'categoria_id', (select id from public.categoria where nome = 'Material de obra'),
  'escopo', 'empresa', 'valor_total', '100.00', 'data_competencia', '2026-10-10',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', '99.99', 'vencimento', '2026-10-15'))))$$,
  'parcelas que não somam o total');
-- Categoria de tipo errado é recusada.
select pg_temp.deve_falhar($$select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Errado', 'categoria_id', (select id from public.categoria where nome = 'Honorários de projeto'),
  'escopo', 'empresa', 'valor_total', '100.00', 'data_competencia', '2026-10-10',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', '100.00', 'vencimento', '2026-10-15'))))$$,
  'categoria de receita em conta a pagar');
-- Escopo obra sem obra é recusado.
select pg_temp.deve_falhar($$select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Errado', 'categoria_id', (select id from public.categoria where nome = 'Material de obra'),
  'escopo', 'obra', 'valor_total', '100.00', 'data_competencia', '2026-10-10',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', '100.00', 'vencimento', '2026-10-15'))))$$,
  'escopo obra sem obra');

-- Conta a pagar da obra e despesa da empresa.
select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Parceiro etapa 1', 'pessoa_id', '10000000-0000-0000-0000-000000000002',
  'categoria_id', (select id from public.categoria where nome = 'Parceiro / prestador'),
  'escopo', 'obra', 'obra_id', '20000000-0000-0000-0000-000000000001',
  'valor_total', '400.00', 'data_competencia', '2026-10-12',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', '400.00', 'vencimento', (now() at time zone 'America/Sao_Paulo')::date + 3))));
select public.salvar_lancamento(jsonb_build_object(
  'tipo', 'pagar', 'descricao', 'Licença de software', 'categoria_id', (select id from public.categoria where nome = 'Software e assinaturas'),
  'escopo', 'empresa', 'valor_total', '150.00', 'data_competencia', '2026-10-01',
  'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', '150.00', 'vencimento', '2026-10-05'))));

-- 4. Recebimento parcial, idempotência e limite do saldo.
select public.registrar_liquidacao(
  (select id from public.parcela where numero = 1 and valor = 333.34),
  (select id from public.conta_bancaria where nome = 'Conta principal'), 200.00, '2026-10-15', 'PIX', 'chave-1');
select public.registrar_liquidacao(
  (select id from public.parcela where numero = 1 and valor = 333.34),
  (select id from public.conta_bancaria where nome = 'Conta principal'), 200.00, '2026-10-15', 'PIX', 'chave-1');
select pg_temp.igual((select count(*) from public.movimento), 1::bigint, 'mesma chave não duplica');
select pg_temp.igual((select situacao from public.v_parcela where numero = 1 and valor = 333.34), 'vencida', 'parcial vencida continua cobrando');
select pg_temp.deve_falhar($$select public.registrar_liquidacao(
  (select id from public.parcela where numero = 1 and valor = 333.34),
  (select id from public.conta_bancaria where nome = 'Conta principal'), 200.00, '2026-10-16', 'PIX', 'chave-2')$$,
  'receber mais que o saldo da parcela');
select public.registrar_liquidacao(
  (select id from public.parcela where numero = 1 and valor = 333.34),
  (select id from public.conta_bancaria where nome = 'Conta principal'), 133.34, '2026-10-16', 'PIX', 'chave-3');
select pg_temp.igual((select situacao from public.v_parcela where numero = 1 and valor = 333.34), 'liquidada', 'parcela liquidada');

-- Pagamento da despesa da empresa.
select public.registrar_liquidacao(
  (select p.id from public.parcela p join public.lancamento l on l.id = p.lancamento_id where l.descricao = 'Licença de software'),
  (select id from public.conta_bancaria where nome = 'Conta principal'), 150.00, '2026-10-05', 'Cartão', 'chave-4');

-- 5. Movimento não se altera nem se apaga; estorno desfaz.
select pg_temp.deve_falhar($$update public.movimento set valor = 1 where chave_idempotencia = 'chave-3'$$, 'alterar movimento');
select pg_temp.deve_falhar($$delete from public.movimento where chave_idempotencia = 'chave-3'$$, 'apagar movimento');
select public.estornar_movimento((select id from public.movimento where chave_idempotencia = 'chave-3'), '2026-10-17', 'valor lançado errado');
select public.estornar_movimento((select id from public.movimento where chave_idempotencia = 'chave-3'), '2026-10-17', 'repetido');
select pg_temp.igual((select count(*) from public.movimento where estorno_de is not null), 1::bigint, 'estorno não duplica');
select pg_temp.igual((select saldo from public.v_parcela where numero = 1 and valor = 333.34), 133.34::numeric, 'saldo volta após estorno');
select pg_temp.deve_falhar($$select public.estornar_movimento((select id from public.movimento where estorno_de is not null), '2026-10-17', 'estorno do estorno')$$,
  'estornar um estorno');

-- Cancelamento só sem valores liquidados.
select pg_temp.deve_falhar($$select public.cancelar_lancamento((select id from public.lancamento where descricao = 'Contrato obra um'), 'teste')$$,
  'cancelar com valor recebido');
select pg_temp.deve_falhar($$update public.parcela set valor = 300 where numero = 1 and valor = 333.34$$, 'mudar valor de parcela liquidada');

-- 6. Transferência entre contas próprias: não é receita nem despesa.
select public.registrar_transferencia(
  (select id from public.conta_bancaria where nome = 'Conta principal'),
  (select id from public.conta_bancaria where nome = 'Cofrinho Reserva'), 20.00, '2026-10-18', 'Reserva', 'transf-1');
select public.registrar_transferencia(
  (select id from public.conta_bancaria where nome = 'Conta principal'),
  (select id from public.conta_bancaria where nome = 'Cofrinho Reserva'), 20.00, '2026-10-18', 'Reserva', 'transf-1');
select pg_temp.igual((select count(*) from public.movimento where transferencia_id is not null), 2::bigint, 'transferência não duplica');
select pg_temp.igual((select saldo from public.v_saldo_conta where nome = 'Cofrinho Reserva'), 20.00::numeric, 'saldo do cofrinho');
select pg_temp.igual((select sum(saldo) from public.v_saldo_conta), 200.00 - 150.00, 'transferência não muda o total');

-- 7. Painel: cada número com sua regra.
do $$
declare r jsonb := public.painel_indicadores('2026-10-01', '2026-10-31');
begin
  perform pg_temp.igual((r->>'vendido')::numeric, 12000.00, 'vendido = contratos do período');
  perform pg_temp.igual((r->>'recebido')::numeric, 200.00, 'recebido líquido de estorno');
  perform pg_temp.igual((r->>'pago_empresa')::numeric, 150.00, 'pago da empresa');
  perform pg_temp.igual((r->>'a_receber')::numeric, 800.00, 'a receber em aberto');
  perform pg_temp.igual((r->>'a_receber_vencido')::numeric, 133.34, 'a receber vencido');
  perform pg_temp.igual((r->>'a_pagar_7_dias')::numeric, 400.00, 'a pagar em 7 dias');
  perform pg_temp.igual((r->>'meta_recebimentos')::numeric, 4000.00, 'meta padrão');
  perform pg_temp.igual((r->>'gerencial')::boolean, true, 'sem regra de reconhecimento = gerencial');
  perform pg_temp.igual((r->>'obras_ativas')::int, 2, 'obras ativas');
end $$;

-- 8. Registro profissional alterado volta a "não conferido".
update public.empresa set registro_conferido = true;
select pg_temp.igual((select registro_conferido_por from public.empresa), '00000000-0000-0000-0000-00000000000a'::uuid, 'quem conferiu');
update public.empresa set registro_profissional = 'CREA-RJ 0000000000';
select pg_temp.igual((select registro_conferido from public.empresa), false, 'alterar registro exige nova conferência');
update public.empresa set registro_profissional = 'CREA-RJ 2025104534';

select pg_temp.igual((select count(*) > 10 from public.auditoria), true, 'auditoria gravada');
select pg_temp.deve_falhar($$update public.auditoria set acao = 'x'$$, 'alterar auditoria');
reset role;
select pg_temp.deve_falhar($$truncate public.auditoria$$, 'esvaziar auditoria (mesmo como dono)');
select pg_temp.deve_falhar($$truncate public.movimento cascade$$, 'esvaziar movimentos (mesmo como dono)');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
reset role;

-- 9. Administrativo sem concessão: vê obras e pessoas, não vê financeiro.
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual((select count(*) from public.obra), 2::bigint, 'administrativo vê obras');
select pg_temp.igual((select count(*) from public.pessoa), 2::bigint, 'administrativo vê pessoas');
select pg_temp.igual((select count(*) from public.lancamento), 0::bigint, 'sem financeiro: lançamentos');
select pg_temp.igual((select count(*) from public.v_parcela), 0::bigint, 'sem financeiro: parcelas');
select pg_temp.igual((select count(*) from public.v_movimento), 0::bigint, 'sem financeiro: movimentos');
select pg_temp.igual((select count(*) from public.obra_financeiro), 0::bigint, 'sem financeiro: valor da obra');
select pg_temp.igual((select count(*) from public.auditoria), 0::bigint, 'só admin lê auditoria');
select pg_temp.igual((public.painel_indicadores('2026-10-01', '2026-10-31')->>'sem_permissao')::boolean, true, 'painel sem números');
select pg_temp.igual(public.resumo_obra('20000000-0000-0000-0000-000000000001'), null::jsonb, 'resumo financeiro da obra oculto');
select pg_temp.deve_falhar($$select public.registrar_liquidacao((select id from public.parcela limit 1), (select id from public.conta_bancaria limit 1), 1, '2026-10-20', 'x', 'k-b')$$,
  'registrar pagamento sem financeiro');
select pg_temp.deve_falhar($$insert into public.usuario (id, nome, papel) values ('00000000-0000-0000-0000-00000000000f', 'X', 'administrador')$$,
  'administrativo criar administrador');
update public.usuario set acesso_financeiro = true where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.igual(public.tem_financeiro(), false, 'não concede financeiro a si mesmo');
select pg_temp.deve_falhar($$insert into storage.objects (bucket_id, name) values ('documentos', 'financeiro/x/comprovante.pdf')$$,
  'enviar comprovante sem financeiro');
select pg_temp.deve_falhar($$select public.proximo_numero('obra-2026')$$, 'função interna de contador');
reset role;

-- 10. Administrativo com concessão financeira.
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.igual((select count(*) from public.lancamento), 3::bigint, 'com financeiro vê lançamentos');
insert into storage.objects (bucket_id, name) values ('documentos', 'financeiro/x/comprovante.pdf');
select pg_temp.igual((select count(*) from public.usuario), 1::bigint, 'não-admin vê só o próprio usuário');
reset role;

-- 11. Campo: só a obra atribuída, nada de pessoas ou financeiro.
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.obra), 1::bigint, 'campo vê só a obra atribuída');
select pg_temp.igual((select count(*) from public.obra where id = '20000000-0000-0000-0000-000000000002'), 0::bigint, 'campo não lê outra obra pelo id');
select pg_temp.igual((select count(*) from public.servico), 1::bigint, 'campo vê serviços da obra atribuída');
select pg_temp.igual((select count(*) from public.ambiente), 1::bigint, 'campo vê só ambientes da obra atribuída');
select pg_temp.igual((select count(*) from public.pessoa), 0::bigint, 'campo não vê cadastro de pessoas');
select pg_temp.igual((select count(*) from public.lancamento), 0::bigint, 'campo não vê financeiro');
select pg_temp.igual((select count(*) from public.obra_financeiro), 0::bigint, 'campo não vê valores');
with t as (update public.obra set nome = 'invadido' returning 1) select pg_temp.igual((select count(*) from t), 0::bigint, 'campo não edita obra');
reset role;

-- 12. Cliente: nenhuma tabela, nem a da própria obra (o portal usará funções portal_* na Etapa 5).
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.igual((select count(*) from public.obra), 0::bigint, 'cliente não lê tabela de obras');
select pg_temp.igual((select count(*) from public.empresa), 0::bigint, 'cliente não lê empresa');
select pg_temp.igual((select count(*) from public.pessoa), 0::bigint, 'cliente não lê pessoas');
select pg_temp.igual((select count(*) from public.v_parcela), 0::bigint, 'cliente não lê financeiro');
select pg_temp.igual((select count(*) from public.servico), 0::bigint, 'cliente não lê serviços');
select pg_temp.deve_falhar($$insert into public.obra (nome) values ('x')$$, 'cliente criar obra');
reset role;

-- 13. Visitante sem login: acesso negado até para ler.
select pg_temp.como(null);
select pg_temp.deve_falhar($$select count(*) from public.empresa$$, 'anônimo ler empresa');
select pg_temp.deve_falhar($$select count(*) from public.v_parcela$$, 'anônimo ler parcelas');
select pg_temp.deve_falhar($$select public.painel_indicadores('2026-10-01', '2026-10-31')$$, 'anônimo chamar painel');
reset role;

-- 14. Usuário desativado perde o acesso.
update public.usuario set ativo = false where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.igual((select count(*) from public.lancamento), 0::bigint, 'desativado não vê nada');
reset role;

select 'ok' as permissoes_financeiro;
