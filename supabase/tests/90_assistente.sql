-- Testes do assistente de IA: vínculo do WhatsApp por código, conversa e ações só da própria pessoa.
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
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated, service_role;

update public.usuario set ativo = true where id in ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d');

-- 1. Configuração: equipe lê, só administrador muda.
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.igual((select provedor from public.assistente_config), 'claude', 'equipe lê a configuração');
update public.assistente_config set modelo = 'outro';
reset role;
select pg_temp.igual((select modelo from public.assistente_config), 'claude-opus-5-5', 'administrativo não muda a configuração');
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.igual((select count(*) from public.assistente_config), 0::bigint, 'cliente não lê a configuração');
select pg_temp.deve_falhar($$select public.assistente_gerar_codigo()$$, 'cliente gerando código');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select public.assistente_gerar_codigo()$$, 'anônimo gerando código');
select pg_temp.deve_falhar($$select * from public.assistente_usuario_por_telefone('5521999990000')$$, 'anônimo descobrindo dono do número');

-- 2. Vínculo por código
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
insert into t values ('codigo', public.assistente_gerar_codigo());
select pg_temp.igual((select v from t where k = 'codigo') ~ '^[0-9]{6}$', true, 'código de 6 dígitos');
select pg_temp.deve_falhar($$select public.assistente_confirmar_vinculo('5521999990000', (select v from t where k = 'codigo'))$$,
  'usuário confirmando vínculo direto (só o servidor do WhatsApp)');
select pg_temp.deve_falhar($$update public.assistente_vinculo set telefone = '5521999990000'$$, 'gravar número sem código');
reset role;
set role service_role;
select pg_temp.igual(public.assistente_confirmar_vinculo('+55 (21) 99999-0000', '000000x'), null::uuid, 'código errado não vincula');
select pg_temp.igual(public.assistente_confirmar_vinculo('+55 (21) 99999-0000', (select v from t where k = 'codigo')),
  '00000000-0000-0000-0000-00000000000c'::uuid, 'código certo vincula');
select pg_temp.igual(public.assistente_confirmar_vinculo('5521999990000', (select v from t where k = 'codigo')), null::uuid, 'código vale uma vez');
select pg_temp.igual((select nome from public.assistente_usuario_por_telefone('5521999990000')), 'Adm com financeiro', 'número leva ao usuário');
select pg_temp.igual((select email from public.assistente_usuario_por_telefone('5521999990000')), 'adm-com-fin@teste.local', 'e-mail do login');
insert into public.whatsapp_recebida (id) values ('wamid.1');
select pg_temp.deve_falhar($$insert into public.whatsapp_recebida (id) values ('wamid.1')$$, 'mensagem repetida');
reset role;

-- Código vencido não vale.
update public.assistente_vinculo set codigo = '123456', codigo_expira = now() - interval '1 minute'
where usuario_id = '00000000-0000-0000-0000-00000000000c';
set role service_role;
select pg_temp.igual(public.assistente_confirmar_vinculo('5521988880000', '123456'), null::uuid, 'código vencido');
reset role;

-- Usuário desativado não é atendido pelo número.
update public.usuario set ativo = false where id = '00000000-0000-0000-0000-00000000000c';
set role service_role;
select pg_temp.igual((select count(*) from public.assistente_usuario_por_telefone('5521999990000')), 0::bigint, 'usuário inativo não atende');
reset role;
update public.usuario set ativo = true where id = '00000000-0000-0000-0000-00000000000c';

-- 3. Conversa e ações: cada um só vê as suas.
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
insert into public.assistente_mensagem (canal, papel, texto) values ('sistema', 'usuario', 'Oi');
insert into public.assistente_acao (canal, tipo, dados, resumo) values ('sistema', 'criar_pendencia', '{}', 'Criar pendência');
select pg_temp.deve_falhar($$insert into public.assistente_acao (canal, tipo, dados, resumo, estado) values ('sistema', 'criar_pendencia', '{}', 'x', 'executada')$$,
  'ação já nascendo executada');
select pg_temp.deve_falhar($$insert into public.assistente_mensagem (usuario_id, canal, papel, texto) values ('00000000-0000-0000-0000-00000000000d', 'sistema', 'usuario', 'x')$$,
  'mensagem em nome de outro');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.assistente_mensagem), 0::bigint, 'não vê conversa de outro');
select pg_temp.igual((select count(*) from public.assistente_acao), 0::bigint, 'não vê ações de outro');
select pg_temp.igual((select count(*) from public.assistente_vinculo), 0::bigint, 'não vê vínculo de outro');
select pg_temp.deve_falhar($$select * from public.whatsapp_recebida$$, 'usuário lendo mensagens recebidas');
select public.assistente_desvincular();
reset role;
select pg_temp.igual((select telefone from public.assistente_vinculo where usuario_id = '00000000-0000-0000-0000-00000000000c'),
  '5521999990000', 'desvincular só mexe no próprio');
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select public.assistente_desvincular();
reset role;
select pg_temp.igual((select telefone from public.assistente_vinculo where usuario_id = '00000000-0000-0000-0000-00000000000c'),
  null::text, 'desvincula o próprio número');
