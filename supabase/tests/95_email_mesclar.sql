-- Testes: registro de envio de e-mail (só o servidor grava) e mesclagem de cadastros duplicados.
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
-- E-mail: a tela só lê; a situação é gravada pela função do servidor.
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
with x as (insert into public.pessoa (nome, email, eh_cliente) values ('Cliente E-mail (fictício)', 'cliente@exemplo.com', true) returning id)
  insert into t select 'pe', id::text from x;
with x as (insert into public.proposta (pessoa_id, titulo) values ((select v::uuid from t where k = 'pe'), 'Proposta e-mail (fictícia)') returning id)
  insert into t select 'pr', id::text from x;
insert into t select 'ver', public.nova_versao_proposta((select v::uuid from t where k = 'pr'))::text;
select pg_temp.deve_falhar($$insert into public.envio_email (proposta_id, versao_id, destinatario, assunto, mensagem, chave, estado)
  values ((select v::uuid from t where k = 'pr'), (select v::uuid from t where k = 'ver'), 'cliente@exemplo.com', 'Proposta', 'Olá', 'chave-da-tela-0000000001', 'enviado')$$,
  'tela marcando e-mail como enviado');
reset role;
insert into public.envio_email (proposta_id, versao_id, destinatario, assunto, mensagem, chave, estado, provedor_id)
  values ((select v::uuid from t where k = 'pr'), (select v::uuid from t where k = 'ver'), 'cliente@exemplo.com', 'Proposta', 'Olá', 'chave-do-servidor-000001', 'enviado', 're_123');
select pg_temp.deve_falhar($$insert into public.envio_email (proposta_id, versao_id, destinatario, assunto, mensagem, chave)
  values ((select v::uuid from t where k = 'pr'), (select v::uuid from t where k = 'ver'), 'cliente@exemplo.com', 'Proposta', 'Olá', 'chave-do-servidor-000001')$$,
  'mesma chave não gera segundo envio');
select pg_temp.deve_falhar($$insert into public.envio_email (proposta_id, versao_id, destinatario, assunto, mensagem, chave)
  values ((select v::uuid from t where k = 'pr'), (select v::uuid from t where k = 'ver'), 'sem-arroba', 'Proposta', 'Olá', 'chave-do-servidor-000002')$$,
  'destinatário inválido');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual((select count(*) from public.envio_email), 1::bigint, 'administrativo vê o histórico');
select pg_temp.deve_falhar($$update public.envio_email set estado = 'entregue'$$, 'tela mudando a situação');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.envio_email), 0::bigint, 'campo não vê e-mails');
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.igual((select count(*) from public.envio_email), 0::bigint, 'cliente não vê e-mails');
reset role;
select pg_temp.igual((select estado from public.envio_email), 'enviado', 'tela não muda a situação');

-- ---------------------------------------------------------------------
-- Mesclar cadastros
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
with x as (insert into public.pessoa (nome, telefone, eh_cliente) values ('João Duplicado (fictício)', '(21) 98888-1234', true) returning id)
  insert into t select 'p1', id::text from x;
with x as (insert into public.pessoa (nome, telefone, email, documento) values ('João D. pelo site (fictício)', '+55 21 98888-1234', 'joao@exemplo.com', '123.456.789-09') returning id)
  insert into t select 'p2', id::text from x;
insert into public.oportunidade (pessoa_id, titulo, estado_id) values ((select v::uuid from t where k = 'p2'), 'Pedido pelo site (fictício)', public.estado_funil_id('Novo contato'));
select pg_temp.igual((select count(*) from public.pessoas_duplicadas() d where d.a = (select v::uuid from t where k = 'p1') and d.b = (select v::uuid from t where k = 'p2')), 1::bigint, 'encontra duplicado pelo telefone');

select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.deve_falhar($$select public.mesclar_pessoas((select v::uuid from t where k = 'p1'), (select v::uuid from t where k = 'p2'))$$, 'administrativo mesclando');
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.deve_falhar($$select public.mesclar_pessoas((select v::uuid from t where k = 'p1'), (select v::uuid from t where k = 'p2'))$$, 'cliente mesclando');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.deve_falhar($$select public.mesclar_pessoas((select v::uuid from t where k = 'p1'), (select v::uuid from t where k = 'p1'))$$, 'mesclar consigo mesmo');
insert into t select 'r', public.mesclar_pessoas((select v::uuid from t where k = 'p1'), (select v::uuid from t where k = 'p2'))::text;
select pg_temp.igual(((select v from t where k = 'r')::jsonb->>'oportunidades')::int, 1, 'oportunidade passa para o cadastro mantido');
select pg_temp.igual((select count(*) from public.pessoa where id = (select v::uuid from t where k = 'p2')), 0::bigint, 'duplicado apagado');
select pg_temp.igual((select email || ' ' || documento from public.pessoa where id = (select v::uuid from t where k = 'p1')), 'joao@exemplo.com 123.456.789-09', 'dados vazios completados');
select pg_temp.igual((select telefone from public.pessoa where id = (select v::uuid from t where k = 'p1')), '(21) 98888-1234', 'dado existente mantido');
select pg_temp.igual((select count(*) from public.oportunidade where pessoa_id = (select v::uuid from t where k = 'p1')), 1::bigint, 'oportunidade ligada ao mantido');

-- Documentos diferentes e quem usa o portal não mesclam.
with x as (insert into public.pessoa (nome, documento) values ('Outro João (fictício)', '987.654.321-00') returning id)
  insert into t select 'p3', id::text from x;
select pg_temp.deve_falhar($$select public.mesclar_pessoas((select v::uuid from t where k = 'p1'), (select v::uuid from t where k = 'p3'))$$, 'CPFs diferentes');
select pg_temp.deve_falhar($$select public.mesclar_pessoas((select v::uuid from t where k = 'p1'), '10000000-0000-0000-0000-000000000001')$$, 'cliente com portal sendo apagado');

-- Nota lida por foto/PDF entra como rascunho com origem própria.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into public.nota_fiscal (origem, numero, emitente_nome, valor_produtos, valor_total) values ('leitura', '991', 'Depósito (fictício)', 100, 100);
select pg_temp.igual((select estado from public.nota_fiscal where numero = '991'), 'rascunho', 'nota lida entra como rascunho');
select pg_temp.deve_falhar($$insert into public.nota_fiscal (origem, valor_total) values ('foto', 1)$$, 'origem desconhecida');

-- Anonimizar a pedido: dados pessoais saem do cadastro e da auditoria; registros ficam.
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.deve_falhar($$select public.anonimizar_pessoa((select v::uuid from t where k = 'p1'))$$, 'administrativo anonimizando');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select public.anonimizar_pessoa((select v::uuid from t where k = 'p1'));
select pg_temp.igual((select nome like 'Cadastro anonimizado%' and email is null and documento is null and telefone is null from public.pessoa where id = (select v::uuid from t where k = 'p1')), true, 'cadastro sem dados pessoais');
select pg_temp.igual((select count(*) from public.oportunidade where pessoa_id = (select v::uuid from t where k = 'p1')), 1::bigint, 'oportunidade continua');
reset role;
select pg_temp.igual((select count(*) from public.auditoria where tabela = 'pessoa' and (coalesce(antes::text, '') || coalesce(depois::text, '')) ~ 'joao@exemplo|98888-1234|123\.456'), 0::bigint, 'auditoria sem dados pessoais, inclusive do cadastro mesclado');
select pg_temp.deve_falhar($$update public.auditoria set antes = null where id = (select min(id) from public.auditoria)$$, 'auditoria continua imutável fora da anonimização');
