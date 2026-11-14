-- Segurança e guarda: verificação em 2 etapas no banco, auditoria só do que mudou,
-- arquivo frio (quem pode ler, o que sai do Supabase) e medidor só para o administrador.
create or replace function pg_temp.como(p_usuario uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_usuario, 'aal', p_aal)::text, false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.deve_falhar(p_sql text, p_motivo text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU: deveria ter sido recusado: %', p_motivo;
end $$;
create or replace function pg_temp.igual(p_obtido anyelement, p_esperado anyelement, p_motivo text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then raise exception 'FALHOU: % (obtido %, esperado %)', p_motivo, p_obtido, p_esperado; end if;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ---------------- Verificação em 2 etapas ----------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual(public.eh_admin(), true, 'admin sem código ativado entra como antes');
reset role;
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000a', 'unverified');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual(public.eh_admin(), true, 'fator não confirmado não exige código');
reset role;
update auth.mfa_factors set status = 'verified' where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'aal1');
select pg_temp.igual(public.eh_admin(), false, 'com código ativado, sessão sem código não é admin');
select pg_temp.igual(public.tem_financeiro(), false, 'sessão sem código não vê financeiro');
select pg_temp.igual(public.meu_papel()::text, null::text, 'sessão sem código não tem papel');
select pg_temp.igual((select count(*) from public.lancamento), 0::bigint, 'sessão sem código não lê lançamentos');
select pg_temp.igual((select count(*) from public.usuario where id = '00000000-0000-0000-0000-00000000000a'), 1::bigint, 'ainda lê o próprio cadastro (para a tela pedir o código)');
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'aal2');
select pg_temp.igual(public.eh_admin(), true, 'depois do código volta a ser admin');
select pg_temp.igual(public.tem_financeiro(), true, 'depois do código vê o financeiro');
select pg_temp.como('00000000-0000-0000-0000-00000000000c', 'aal1');
select pg_temp.igual(public.tem_financeiro(), true, 'quem não ativou o código não é afetado');
reset role;
delete from auth.mfa_factors;

-- ---------------- Auditoria só do que mudou ----------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into public.pessoa (id, nome, telefone) values ('00000000-0000-0000-0000-0000000099e1', 'Teste auditoria', '21 90000-0000');
update public.pessoa set telefone = '21 91111-1111' where id = '00000000-0000-0000-0000-0000000099e1';
reset role;
do $$
declare a record; n integer;
begin
  select * into a from public.auditoria where tabela = 'pessoa' and registro_id = '00000000-0000-0000-0000-0000000099e1' and acao = 'update' order by id desc limit 1;
  if (a.antes - 'atualizado_em') is distinct from '{"telefone": "21 90000-0000"}'::jsonb then raise exception 'FALHOU: antes deveria ter só o telefone antigo: %', a.antes; end if;
  if a.depois->>'telefone' <> '21 91111-1111' or a.depois->>'id' is null or a.depois ? 'nome' then raise exception 'FALHOU: depois deveria ter o telefone novo e o id: %', a.depois; end if;
  select count(*) into n from public.auditoria where tabela = 'pessoa' and registro_id = '00000000-0000-0000-0000-0000000099e1';
  update public.pessoa set telefone = '21 91111-1111' where id = '00000000-0000-0000-0000-0000000099e1';
  if (select count(*) from public.auditoria where tabela = 'pessoa' and registro_id = '00000000-0000-0000-0000-0000000099e1') <> n then
    raise exception 'FALHOU: alteração sem mudança não deveria gravar auditoria';
  end if;
  if not exists (select 1 from public.auditoria where tabela = 'pessoa' and registro_id = '00000000-0000-0000-0000-0000000099e1' and acao = 'insert' and depois->>'nome' = 'Teste auditoria') then
    raise exception 'FALHOU: inclusão deveria guardar o registro inteiro';
  end if;
end $$;

-- ---------------- Quem pode ler cada arquivo ----------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual(public.pode_ler_arquivo('financeiro/x/nota.pdf'), true, 'admin lê financeiro');
select pg_temp.igual(public.pode_ler_arquivo('obras/x/../financeiro/a.pdf'), false, 'caminho com .. é recusado');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual(public.pode_ler_arquivo('financeiro/x/nota.pdf'), false, 'administrativo sem financeiro não lê financeiro');
select pg_temp.igual(public.pode_ler_arquivo('obras/00000000-0000-0000-0000-000000000001/fotos/a.jpg'), true, 'administrativo lê obras');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual(public.pode_ler_arquivo('financeiro/x/nota.pdf'), false, 'campo não lê financeiro');
select pg_temp.igual(public.pode_ler_arquivo('obras/00000000-0000-0000-0000-0000000000ff/fotos/a.jpg'), false, 'campo não lê obra que não é dele');

-- ---------------- Medidor e configuração ----------------
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.deve_falhar($$ select public.uso_armazenamento() $$, 'só o administrador vê o uso');
update public.armazenamento_config set limite_arquivos_mb = 5;
select pg_temp.deve_falhar($$ select * from public.arquivo_frio $$, 'tela não lê a lista do arquivo frio');
select pg_temp.deve_falhar($$ select * from public.arquivos_sem_copia(10) $$, 'tela não chama operações do backup');
select pg_temp.deve_falhar($$ select public.marcar_arquivados(array['x']) $$, 'tela não marca arquivado');
select pg_temp.deve_falhar($$ select public.registrar_backup('diario', 'r2', 1) $$, 'tela não registra backup');
select pg_temp.como(null);
select pg_temp.deve_falhar($$ select public.arquivos_frios_permitidos(array['x']) $$, 'visitante não pede arquivo frio');
reset role;
select pg_temp.igual((select limite_arquivos_mb from public.armazenamento_config), 1024, 'administrativo não muda a configuração');

-- ---------------- Arquivo frio: copiar, escolher e arquivar ----------------
-- Limite de 1 MB: arquiva acima de 70% (734 KB) até voltar a 55% (563 KB).
update public.armazenamento_config set limite_arquivos_mb = 1;
delete from storage.objects;
insert into storage.objects (bucket_id, name, metadata, created_at) values
  ('documentos', 'obras/00000000-0000-0000-0000-000000000001/fotos/1.jpg', '{"size": 200000}', now() - interval '3 years'),
  ('documentos', 'obras/00000000-0000-0000-0000-000000000001/fotos/2.jpg', '{"size": 200000}', now() - interval '2 years'),
  ('documentos', 'obras/00000000-0000-0000-0000-000000000001/fotos/3.jpg', '{"size": 200000}', now() - interval '1 year'),
  ('documentos', 'financeiro/l1/recente.pdf', '{"size": 300000}', now() - interval '1 day');
select pg_temp.igual((select count(*) from public.arquivos_sem_copia(100)), 4::bigint, 'quatro arquivos sem cópia');
select pg_temp.igual((select count(*) from public.arquivos_para_arquivar()), 0::bigint, 'sem cópia no R2 nada sai do Supabase');
select public.marcar_copiados((select jsonb_agg(jsonb_build_object('caminho', caminho, 'bytes', bytes)) from public.arquivos_sem_copia(100)));
select pg_temp.igual((select count(*) from public.arquivos_sem_copia(100)), 0::bigint, 'tudo copiado');
-- Total 900 KB; precisa liberar 900000 - 576716 = 323284 bytes: as duas fotos mais antigas.
select pg_temp.igual((select array_agg(caminho order by caminho) from public.arquivos_para_arquivar()),
  array['obras/00000000-0000-0000-0000-000000000001/fotos/1.jpg', 'obras/00000000-0000-0000-0000-000000000001/fotos/2.jpg'],
  'escolhe as mais antigas até voltar ao alvo, nunca as recentes');
select public.marcar_arquivados(array(select caminho from public.arquivos_para_arquivar()));
delete from storage.objects where name in ('obras/00000000-0000-0000-0000-000000000001/fotos/1.jpg', 'obras/00000000-0000-0000-0000-000000000001/fotos/2.jpg');
select pg_temp.igual((select count(*) from public.arquivos_para_arquivar()), 0::bigint, 'abaixo do limite não arquiva mais');

select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual(public.arquivos_frios_permitidos(array['obras/00000000-0000-0000-0000-000000000001/fotos/1.jpg', 'obras/00000000-0000-0000-0000-000000000001/fotos/3.jpg']),
  array['obras/00000000-0000-0000-0000-000000000001/fotos/1.jpg'], 'devolve só o que saiu do Supabase e a pessoa pode ler');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual(public.arquivos_frios_permitidos(array['obras/00000000-0000-0000-0000-000000000001/fotos/1.jpg']), '{}'::text[], 'campo sem a obra não recebe');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
do $$
declare u jsonb;
begin
  u := public.uso_armazenamento();
  if (u->'arquivos'->>'bytes')::bigint <> 500000 then raise exception 'FALHOU: arquivos no Supabase: %', u->'arquivos'; end if;
  if (u->'frio'->>'bytes')::bigint <> 400000 or (u->'frio'->>'quantidade')::int <> 2 then raise exception 'FALHOU: arquivo frio: %', u->'frio'; end if;
  if (u->'banco'->>'bytes')::bigint <= 0 or jsonb_array_length(u->'mensal') <> 12 then raise exception 'FALHOU: banco e série mensal: %', u; end if;
end $$;
reset role;
select public.registrar_backup('diario', 'r2', 12345, 2, 2, true, 'teste');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) from public.backup_registro), 1::bigint, 'admin vê os backups');
reset role;
delete from storage.objects; delete from public.arquivo_frio; delete from public.backup_registro;
update public.armazenamento_config set limite_arquivos_mb = 1024;
