-- Iniciar, entregar e encerrar em um passo; entrega de documentos por link próprio e pelo portal.
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
grant all on t to anon, authenticated, service_role;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Projeto estrutural de 4.321 (fictício), 2 etapas, aceito pelo link: vira obra com etapas datadas.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
with x as (insert into public.pessoa (nome, eh_cliente, telefone) values ('Cliente Entrega (fictício)', true, '21999990000') returning id) insert into t select 'cli', id::text from x;
with x as (insert into public.proposta (pessoa_id, titulo) values ((select v::uuid from t where k = 'cli'), 'Projeto estrutural casa (fictício)') returning id) insert into t select 'p', id::text from x;
insert into t select 'v', public.nova_versao_proposta((select v::uuid from t where k = 'p'))::text;
update public.proposta_versao set valor_total = 4321, conteudo = jsonb_build_object('validade_dias', 15, 'prazo_total_dias', 10,
  'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Geral', 'itens', jsonb_build_array(jsonb_build_object('id', 'i1', 'titulo', 'Projeto', 'unidade', 'vb', 'quantidade', 1, 'total', 4321,
    'etapas', jsonb_build_array(jsonb_build_object('nome', 'Cálculo', 'duracao_dias', 6, 'percentual', 50), jsonb_build_object('nome', 'Detalhamento', 'duracao_dias', 4, 'percentual', 50)))))))
where id = (select v::uuid from t where k = 'v');
select public.emitir_versao((select v::uuid from t where k = 'v'));
insert into t select 'tok', public.criar_link_proposta((select v::uuid from t where k = 'v'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tok'), 'aceitar', 'Cliente Entrega', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'o', id::text from public.obra where proposta_versao_id = (select v::uuid from t where k = 'v');
select pg_temp.igual((select v from t where k = 'o') is not null, true, 'aceite criou a obra');
select pg_temp.igual((select count(*) from public.etapa where obra_id = (select v::uuid from t where k = 'o')), 2::bigint, 'duas etapas');
select pg_temp.igual((select count(*) from public.etapa where obra_id = (select v::uuid from t where k = 'o') and inicio_previsto is null), 0::bigint, 'etapas do aceite já têm datas da agenda');
select pg_temp.igual(public.obra_falta_receber((select v::uuid from t where k = 'o')), 4321.00, 'falta receber tudo');

-- Permissões.
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.iniciar_obra((select v::uuid from t where k = 'o'))$$, 'campo iniciando obra');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select public.entregar_obra((select v::uuid from t where k = 'o'))$$, 'anônimo entregando');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.deve_falhar($$select public.entregar_obra((select v::uuid from t where k = 'o'), current_date + 3)$$, 'entrega no futuro');

-- Iniciar há 2 dias: em execução, início gravado e a primeira etapa começa.
select public.iniciar_obra((select v::uuid from t where k = 'o'), current_date - 2, true);
select pg_temp.igual((select status from public.obra where id = (select v::uuid from t where k = 'o')), 'em_execucao', 'iniciada');
select pg_temp.igual((select data_inicio from public.obra where id = (select v::uuid from t where k = 'o')), current_date - 2, 'data de início');
select pg_temp.igual((select count(*) from public.etapa where obra_id = (select v::uuid from t where k = 'o') and estado = 'em_execucao' and inicio_real = current_date - 2), 1::bigint, 'primeira etapa em andamento');
select pg_temp.deve_falhar($$select public.iniciar_obra((select v::uuid from t where k = 'o'))$$, 'iniciar duas vezes');

-- Entregar hoje com 4.321 a receber: concluída, etapas fechadas, ainda não encerrada.
select pg_temp.igual((public.entregar_obra((select v::uuid from t where k = 'o'), current_date, true)->>'status'), 'concluida_fisicamente', 'entregue com saldo');
select pg_temp.igual((select count(*) from public.etapa where obra_id = (select v::uuid from t where k = 'o') and estado <> 'executado'), 0::bigint, 'etapas concluídas na entrega');
select pg_temp.igual((select entregue_em from public.obra where id = (select v::uuid from t where k = 'o')), current_date, 'data da entrega');

-- Recebe tudo e encerra; reabrir volta para em execução.
select public.registrar_recebimento_contrato((select v::uuid from t where k = 'p'), null, null, 4321, current_date, 'PIX', 'entrega-rec-1');
select pg_temp.igual(public.obra_falta_receber((select v::uuid from t where k = 'o')), 0.00, 'quitada');
select public.encerrar_obra((select v::uuid from t where k = 'o'));
select pg_temp.igual((select status from public.obra where id = (select v::uuid from t where k = 'o')), 'encerrada_financeiramente', 'encerrada');
select public.reabrir_obra((select v::uuid from t where k = 'o'), 'Faltou uma prancha');
select pg_temp.igual((select status from public.obra where id = (select v::uuid from t where k = 'o')), 'em_execucao', 'reaberta');
-- Entrega de obra quitada: encerra de uma vez.
select pg_temp.igual((public.entregar_obra((select v::uuid from t where k = 'o'), current_date, true)->>'status'), 'encerrada_financeiramente', 'quitada encerra na entrega');

-- Entrega de documentos.
select pg_temp.deve_falhar($$select public.entrega_criar((select v::uuid from t where k = 'o'), 'Projeto', '', true, '[]'::jsonb)$$, 'entrega sem arquivo');
select pg_temp.deve_falhar($$select public.entrega_criar((select v::uuid from t where k = 'o'), 'Projeto', '', true, jsonb_build_array(jsonb_build_object('caminho', 'financeiro/x.pdf', 'nome', 'x.pdf')))$$, 'arquivo fora da pasta');
insert into t select 'e', public.entrega_criar((select v::uuid from t where k = 'o'), 'Projeto estrutural · pranchas', 'Seguem as pranchas.', true,
  jsonb_build_array(jsonb_build_object('caminho', 'obras/' || (select v from t where k = 'o') || '/entregas/a/Pranchas.pdf', 'nome', 'Pranchas.pdf', 'mime', 'application/pdf', 'tamanho', 1234)))::text;
insert into t select 'et', public.entrega_link_novo((select v::uuid from t where k = 'e'), 'whatsapp');
insert into t select 'arq', id::text from public.entrega_arquivo where entrega_id = (select v::uuid from t where k = 'e');
select public.entrega_marcar_envio((select v::uuid from t where k = 'e'), 'whatsapp');
select pg_temp.igual((select whatsapp_em is not null from public.entrega where id = (select v::uuid from t where k = 'e')), true, 'whatsapp marcado');

select pg_temp.como(null);
select pg_temp.igual((public.entrega_publica((select v from t where k = 'et'))->>'titulo'), 'Projeto estrutural · pranchas', 'cliente abre pelo link');
select pg_temp.igual((public.entrega_publica('token-errado') ? 'erro'), true, 'token errado');
select pg_temp.igual(jsonb_array_length(public.entrega_publica((select v from t where k = 'et'))->'arquivos'), 1, 'arquivos da entrega');
select pg_temp.deve_falhar($$select public.entrega_arquivo_permitido((select v from t where k = 'et'), null, (select v::uuid from t where k = 'arq'))$$, 'anônimo pegando caminho direto');
select pg_temp.deve_falhar($$select * from public.entrega$$, 'anônimo lendo entregas');
reset role;
set role service_role;
select pg_temp.igual((public.entrega_arquivo_permitido((select v from t where k = 'et'), null, (select v::uuid from t where k = 'arq'))->>'nome'), 'Pranchas.pdf', 'download pelo link');
select pg_temp.igual(public.entrega_arquivo_permitido('outro', null, (select v::uuid from t where k = 'arq')), null, 'download com token errado');
reset role;

-- Pelo portal do cliente.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'pt', public.portal_criar_acesso((select v::uuid from t where k = 'o'), (select v::uuid from t where k = 'cli'), 30);
select pg_temp.como(null);
select pg_temp.igual(jsonb_array_length(public.portal_entregas((select v from t where k = 'pt'))), 1, 'entrega aparece no portal');
reset role;
set role service_role;
select pg_temp.igual((public.entrega_arquivo_permitido(null, (select v from t where k = 'pt'), (select v::uuid from t where k = 'arq'))->>'nome'), 'Pranchas.pdf', 'download pelo portal');
reset role;
update public.entrega set no_portal = false where id = (select v::uuid from t where k = 'e');
select pg_temp.como(null);
select pg_temp.igual(jsonb_array_length(public.portal_entregas((select v from t where k = 'pt'))), 0, 'fora do portal quando desligado');
reset role;
