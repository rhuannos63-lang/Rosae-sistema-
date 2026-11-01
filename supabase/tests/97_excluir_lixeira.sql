-- Testes: exclusão com lixeira (só administrador, mostra o que vai junto, restaura tudo).
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

-- Fotografia do banco antes, para comparar depois da restauração.
reset role;
create temp table antes as
  select c.relname::text as tabela, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::int as n
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not in ('auditoria', 'lixeira', 'contador');
grant all on antes to anon, authenticated;
insert into t values ('obra', (select id::text from public.obra order by criado_em limit 1));
insert into t values ('lanc', (select l.id::text from public.lancamento l where exists (select 1 from public.parcela p join public.movimento m on m.parcela_id = p.id where p.lancamento_id = l.id) limit 1));
select pg_temp.igual((select v is not null from t where k = 'lanc'), true, 'há lançamento com pagamento para testar');

-- Só o administrador exclui.
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.deve_falhar(format('select public.excluir_registro(%L, %L)', 'obra', (select v from t where k = 'obra')), 'quem não é administrador não exclui');
select pg_temp.igual((select count(*) from public.lixeira)::int, 0, 'lixeira não aparece para quem não é administrador');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.deve_falhar('select public.excluir_registro(''usuario'', ''00000000-0000-0000-0000-00000000000a'', true)', 'usuário não se exclui por aqui');

-- Simulação mostra tudo o que vai junto e não apaga nada.
insert into t select 'sim', public.excluir_registro('obra', (select v from t where k = 'obra'))::text;
select pg_temp.igual(((select v::jsonb from t where k = 'sim') -> 'resumo' ->> 'obra')::int, 1, 'simulação conta a obra');
select pg_temp.igual(((select v::jsonb from t where k = 'sim') ->> 'total')::int > 1, true, 'simulação inclui o que depende da obra');
select pg_temp.igual((select count(*) from public.obra where id::text = (select v from t where k = 'obra'))::int, 1, 'simulação não apaga');

-- Exclusão confirmada: sai tudo e vai para a lixeira.
insert into t select 'exc', public.excluir_registro('obra', (select v from t where k = 'obra'), true, 'Obra de teste')::text;
select pg_temp.igual((select count(*) from public.obra where id::text = (select v from t where k = 'obra'))::int, 0, 'obra excluída');
select pg_temp.igual((select count(*) from public.lixeira)::int >= 1, true, 'lixeira guarda a exclusão');

-- Restauração devolve tudo como era.
select public.restaurar_lixeira(((select v::jsonb from t where k = 'exc') ->> 'lixeira_id')::uuid);
select pg_temp.igual((select count(*) from public.obra where id::text = (select v from t where k = 'obra'))::int, 1, 'obra restaurada');
select pg_temp.deve_falhar(format('select public.restaurar_lixeira(%L)', (select v::jsonb from t where k = 'exc') ->> 'lixeira_id'), 'não restaura duas vezes');

-- Lançamento já pago (com movimento na conta) também pode sair e voltar.
insert into t select 'exl', public.excluir_registro('lancamento', (select v from t where k = 'lanc'), true)::text;
select pg_temp.igual((select count(*) from public.lancamento where id::text = (select v from t where k = 'lanc'))::int, 0, 'lançamento pago excluído');
select public.restaurar_lixeira(((select v::jsonb from t where k = 'exl') ->> 'lixeira_id')::uuid);

-- Cliente com propostas emitidas, obras e financeiro: sai tudo junto e volta tudo.
insert into t values ('pes', (select p.id::text from public.pessoa p where exists (select 1 from public.proposta pr join public.proposta_versao v on v.proposta_id = pr.id and v.emitida where pr.pessoa_id = p.id) limit 1));
insert into t select 'exp', public.excluir_registro('pessoa', (select v from t where k = 'pes'), true)::text where (select v from t where k = 'pes') is not null;
select pg_temp.igual((select count(*) from public.pessoa where id::text = (select v from t where k = 'pes'))::int, 0, 'cliente excluído') where (select v from t where k = 'pes') is not null;
select public.restaurar_lixeira(((select v::jsonb from t where k = 'exp') ->> 'lixeira_id')::uuid) where exists (select 1 from t where k = 'exp');

-- Todas as tabelas voltam ao mesmo número de linhas.
reset role;
select pg_temp.igual(
  (select string_agg(a.tabela || ':' || a.n || '→' || d.n, ', ') from antes a
     cross join lateral (select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', a.tabela), false, true, '')))[1]::text::int as n) d
   where d.n <> a.n),
  null, 'restauração devolve todas as linhas');

-- As travas de histórico continuam valendo no uso normal.
select pg_temp.deve_falhar('delete from public.movimento where id = (select id from public.movimento limit 1)', 'movimento continua imutável');
