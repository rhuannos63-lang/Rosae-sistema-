-- Situação real de cada proposta, a mesma regra das telas (src/core/situacaoProposta.ts):
-- rascunho (nunca emitida), aguardando, ajuste (cliente pediu ajuste), revisando (nova versão
-- em preparo depois de enviada), vencida, aprovada, recusada (ou negócio perdido), arquivada.
-- O resumo comercial (painel e assistente) passa a contar por ela, sem contar aditivos.

create or replace function public.situacao_proposta(p public.proposta)
returns text language sql stable set search_path = public as $$
  with ve as (
    select max(numero) filter (where emitida) as ultima_emitida, max(numero) as ultima
    from proposta_versao where proposta_id = p.id
  ), val as (
    select v.validade from proposta_versao v, ve where v.proposta_id = p.id and v.numero = ve.ultima_emitida
  )
  select case
    when p.estado = 'arquivada' then 'arquivada'
    when p.estado = 'aprovada' then 'aprovada'
    when p.estado = 'recusada' or exists (
      select 1 from oportunidade o join estado_funil e on e.id = o.estado_id where o.id = p.oportunidade_id and e.tipo = 'perdido'
    ) then 'recusada'
    when (select ultima_emitida from ve) is null then 'rascunho'
    when (select ultima from ve) > (select ultima_emitida from ve) then 'revisando'
    when p.estado = 'em_negociacao' then 'ajuste'
    when (select validade from val) < (now() at time zone 'America/Sao_Paulo')::date then 'vencida'
    else 'aguardando'
  end
$$;

create or replace function public.resumo_comercial(p_inicio date, p_fim date)
returns jsonb language sql stable set search_path = public as $$
  with s as (select situacao_proposta(p) as situacao from proposta p where p.tipo = 'proposta')
  select case when not eh_equipe_adm() then null else jsonb_build_object(
    -- "enviadas" = aguardando resposta dentro da validade; "em_negociacao" = pediu ajuste ou nova versão em preparo.
    'enviadas', (select count(*) from s where situacao = 'aguardando'),
    'em_negociacao', (select count(*) from s where situacao in ('ajuste', 'revisando')),
    'vencidas', (select count(*) from s where situacao = 'vencida'),
    'com_cliente', (select count(*) from s where situacao in ('aguardando', 'ajuste', 'revisando', 'vencida')),
    'aprovadas_periodo', (select count(*) from proposta where tipo = 'proposta' and estado = 'aprovada' and (aprovada_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'recusadas_periodo', (select count(*) from proposta p where tipo = 'proposta' and estado = 'recusada' and (atualizado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'rascunhos', (select count(*) from s where situacao = 'rascunho'),
    'oportunidades_abertas', (select count(*) from oportunidade o join estado_funil e on e.id = o.estado_id where e.tipo = 'aberto' and not o.arquivado),
    'acoes_atrasadas', (select count(*) from oportunidade o join estado_funil e on e.id = o.estado_id
                        where e.tipo = 'aberto' and not o.arquivado and o.proxima_acao_data < (now() at time zone 'America/Sao_Paulo')::date),
    'cliques_whatsapp', (select count(*) from evento_site where tipo = 'clique_whatsapp' and (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'formularios', (select count(*) from evento_site where tipo = 'formulario' and (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim)
  ) end
$$;

grant execute on function public.situacao_proposta(public.proposta) to authenticated;
