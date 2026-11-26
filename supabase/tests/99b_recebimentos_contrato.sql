-- Fechado × recebido: o aceite não lança dinheiro como recebido; o recebimento real é livre
-- (valor e data quaisquer), abate da previsão e o excedente vira recebimento extra. Aditivo rápido.
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
create or replace function pg_temp.contrato(p_proposta text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.contratos_recebimentos()) x where x->>'proposta_id' = p_proposta
$$;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Orçamento de 10.000 (fictício) com 50% no início e 50% na entrega; cliente aceita.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
with x as (insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', 'Reforma de fachada (fictício)') returning id) insert into t select 'p', id::text from x;
insert into t select 'v', public.nova_versao_proposta((select v::uuid from t where k = 'p'))::text;
update public.proposta_versao set valor_total = 10000, conteudo = jsonb_build_object('validade_dias', 15, 'local', 'Rua Fictícia, 30',
  'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Fachada', 'itens', jsonb_build_array(jsonb_build_object('id', 'f1', 'titulo', 'Reforma da fachada', 'unidade', 'vb', 'quantidade', 1, 'total', 10000)))),
  'pagamento', jsonb_build_object('descricao', '50% + 50%', 'parcelas', jsonb_build_array(jsonb_build_object('descricao', 'Entrada', 'valor', 5000), jsonb_build_object('descricao', 'Entrega', 'valor', 5000))))
where id = (select v::uuid from t where k = 'v');
select public.emitir_versao((select v::uuid from t where k = 'v'));
insert into t select 'tok', public.criar_link_proposta((select v::uuid from t where k = 'v'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tok'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.deve_falhar($$select public.contratos_recebimentos()$$, 'anônimo vendo contratos');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.deve_falhar($$select public.contratos_recebimentos()$$, 'administrativo sem financeiro vendo contratos');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');

-- Aceite: aparece como fechado, nada recebido, e nenhum movimento de caixa foi criado.
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'fechado')::numeric, 10000.00, 'fechado = orçamento aceito');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'recebido')::numeric, 0::numeric, 'aceite não conta como recebido');
select pg_temp.igual(pg_temp.contrato((select v from t where k = 'p'))->>'obra_id', null, 'ainda sem obra');
insert into t values ('mov0', (select count(*) from public.movimento)::text);

-- Validações.
select pg_temp.deve_falhar($$select public.registrar_recebimento_contrato((select v::uuid from t where k = 'p'), null, null, 0, current_date, null, 'r0')$$, 'valor zero');
select pg_temp.deve_falhar($$select public.registrar_recebimento_contrato((select v::uuid from t where k = 'p'), null, null, 100, current_date + 5, null, 'r0')$$, 'data no futuro');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.registrar_recebimento_contrato((select v::uuid from t where k = 'p'), null, null, 100, current_date, null, 'r0')$$, 'campo registrando recebimento');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) from public.movimento)::text, (select v from t where k = 'mov0'), 'recusas não criaram movimento');

-- Negociou outra forma: recebeu 3.000 primeiro. O orçamento vira obra e a previsão é abatida.
insert into t select 'r1', public.registrar_recebimento_contrato((select v::uuid from t where k = 'p'), null,
  (select id from public.conta_bancaria where nome = 'Conta principal'), 3000, current_date - 2, 'PIX', 'rec-1')::text;
select pg_temp.igual(((select v from t where k = 'r1')::jsonb->>'obra_criada')::boolean, true, 'obra criada no primeiro recebimento');
insert into t select 'o', (select v from t where k = 'r1')::jsonb->>'obra_id';
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'recebido')::numeric, 3000.00, 'recebido 3.000');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'falta_receber')::numeric, 7000.00, 'falta 7.000');
select pg_temp.igual((select min(saldo) from public.v_parcela where obra_id = (select v::uuid from t where k = 'o') and tipo = 'receber'), 2000.00, 'primeira parcela ficou parcial');

-- Clique duplo / nova tentativa: não duplica.
select pg_temp.igual((public.registrar_recebimento_contrato((select v::uuid from t where k = 'p'), null, null, 3000, current_date - 2, 'PIX', 'rec-1')->>'repetido')::boolean, true, 'repetição reconhecida');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'recebido')::numeric, 3000.00, 'sem duplicar');

-- Recebeu 8.000 de uma vez: fecha as duas parcelas e 1.000 entra como recebimento extra.
insert into t select 'r2', public.registrar_recebimento_contrato(null, (select v::uuid from t where k = 'o'), null, 8000, current_date, 'Transferência', 'rec-2')::text;
select pg_temp.igual(((select v from t where k = 'r2')::jsonb->>'extra')::numeric, 1000.00, 'excedente');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'recebido')::numeric, 11000.00, 'recebido total');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'previsto_aberto')::numeric, 0.00, 'previsão quitada');
select pg_temp.igual((public.resumo_obra((select v::uuid from t where k = 'o'))->>'recebido')::numeric, 11000.00, 'obra mostra o mesmo recebido');

-- Aditivo rápido: um passo, já emitido, pronto para o e-mail; aceito soma no fechado.
select pg_temp.deve_falhar($$select public.criar_aditivo_rapido((select v::uuid from t where k = 'p'), null, 'Pintura', 'Pedido do cliente', null, 0)$$, 'aditivo sem valor');
select pg_temp.deve_falhar($$select public.criar_aditivo_rapido((select v::uuid from t where k = 'p'), null, 'Pintura', ' ', null, 100)$$, 'aditivo sem motivo');
insert into t select 'ad', public.criar_aditivo_rapido((select v::uuid from t where k = 'p'), null, 'Pintura do muro', 'Pedido do cliente', 'Pintura acrílica do muro frontal', 1500, 3, 'À vista na aprovação')::text;
insert into t select 'vad', id::text from public.proposta_versao where proposta_id = (select v::uuid from t where k = 'ad');
select pg_temp.igual((select emitida from public.proposta_versao where id = (select v::uuid from t where k = 'vad')), true, 'aditivo já emitido');
select pg_temp.igual((select valor_total from public.proposta_versao where id = (select v::uuid from t where k = 'vad')), 1500.00, 'valor do aditivo');
select pg_temp.igual((select (conteudo->>'impacto_prazo_dias')::int from public.proposta_versao where id = (select v::uuid from t where k = 'vad')), 3, 'impacto no prazo');
select pg_temp.igual((select obra_id::text from public.proposta where id = (select v::uuid from t where k = 'ad')), (select v from t where k = 'o'), 'aditivo dentro da obra');
insert into t select 'tka', public.criar_link_proposta((select v::uuid from t where k = 'vad'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tka'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'fechado')::numeric, 11500.00, 'fechado com aditivo');
select pg_temp.igual((pg_temp.contrato((select v from t where k = 'p'))->>'aditivos')::numeric, 1500.00, 'aditivos aceitos');

-- Pela obra (rascunho, para revisar antes): usa o orçamento de origem da obra.
insert into t select 'ad2', public.criar_aditivo_rapido(null, (select v::uuid from t where k = 'o'), 'Troca de calha', 'Achado na obra', null, 800, 0, null, false)::text;
select pg_temp.igual((select proposta_origem_id::text from public.proposta where id = (select v::uuid from t where k = 'ad2')), (select v from t where k = 'p'), 'aditivo pela obra liga ao orçamento');
select pg_temp.igual((select emitida from public.proposta_versao where proposta_id = (select v::uuid from t where k = 'ad2')), false, 'rascunho quando pedido');
reset role;
-- Rascunho sem valor, para detalhar os itens no editor.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'ad3', public.criar_aditivo_rapido((select v::uuid from t where k = 'p'), null, 'Itens extras', 'Pedido do cliente', null, 0, 0, null, false)::text;
select pg_temp.igual((select valor_total from public.proposta_versao where proposta_id = (select v::uuid from t where k = 'ad3')), 0.00, 'rascunho sem valor');
reset role;
