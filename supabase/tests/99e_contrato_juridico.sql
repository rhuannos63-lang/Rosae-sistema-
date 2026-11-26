-- Contrato jurídico por tipo de serviço: cláusulas com base legal (sem marca de minuta),
-- específicas por serviço (tags "s:"), destaque e o estado de revisão ao editar.
create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
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

select pg_temp.igual((select count(*) from public.clausula where texto like '[Minuta%'), 0::bigint, 'rescisão e foro não são mais minuta');
select pg_temp.igual((select count(*) from public.clausula where revisao_juridica = 'minuta'), 0::bigint, 'cláusulas iniciais com base legal');
select pg_temp.igual((select texto like '%art. 101, I%' from public.clausula where codigo = 'foro'), true, 'foro do domicílio do consumidor');
select pg_temp.igual((select texto like '%2% (dois por cento)%' from public.clausula where codigo = 'pagamento_mora'), true, 'multa de mora de 2% (CDC 52)');
select pg_temp.igual((select destaque from public.clausula where codigo = 'rescisao'), true, 'rescisão em destaque');
select pg_temp.igual((select aplicavel from public.clausula where codigo = 'projeto_autoria'), '{s:projeto,s:arquitetura}'::text[], 'autoria só nos projetos');
select pg_temp.igual((select count(distinct a) from public.clausula, unnest(aplicavel) a where a like 's:%'), 8::bigint, 'todos os 8 tipos de serviço têm cláusulas próprias');

-- Editar na biblioteca: fundamentada continua fundamentada; nova versão guardada.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
update public.clausula set texto = texto || ' Texto ajustado.' where codigo = 'lgpd';
select pg_temp.igual((select revisao_juridica || ' v' || versao from public.clausula where codigo = 'lgpd'), 'fundamentada v2', 'editar mantém a base legal');
update public.clausula set revisao_juridica = 'revisada', revisado_por = 'Dra. Fictícia', revisado_em = '2026-11-10' where codigo = 'lgpd';
update public.clausula set texto = texto || ' Mais.' where codigo = 'lgpd';
select pg_temp.igual((select revisao_juridica from public.clausula where codigo = 'lgpd'), 'fundamentada', 'revisada editada deixa de ser revisada');

-- Contrato com cláusulas fundamentadas sai sem marca de minuta; com uma minuta, sai minuta.
with x as (insert into public.obra (nome) values ('Obra contrato jurídico (fictícia)') returning id) insert into t select 'o', id::text from x;
with x as (insert into public.contrato (obra_id, modelo, valor_total, conteudo)
  values ((select v::uuid from t where k = 'o'), 'projeto', 1000,
          jsonb_build_object('clausulas', (select jsonb_agg(jsonb_build_object('codigo', codigo, 'titulo', titulo, 'texto', texto, 'versao', versao, 'revisao_juridica', revisao_juridica)) from public.clausula where 's:projeto' = any(aplicavel) or 'todos' = any(aplicavel))))
  returning id) insert into t select 'c', id::text from x;
select length(public.emitir_contrato((select v::uuid from t where k = 'c'))) = 64;
select pg_temp.igual((select minuta from public.contrato where id = (select v::uuid from t where k = 'c')), false, 'base legal = sem marca de minuta');
