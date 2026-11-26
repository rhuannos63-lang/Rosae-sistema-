-- Aditivo ligado direto ao orçamento aceito.
-- O aditivo é uma proposta própria (tipo 'aditivo', código ADT-), com itens, valor, motivo e aceite do cliente,
-- e agora aponta para o orçamento original aprovado. A proposta original e o contrato nunca mudam.
-- Antes ele só nascia dentro de uma obra; agora pode nascer do orçamento aceito mesmo antes de a obra existir:
-- quando o orçamento original vira obra, os aditivos ligados passam a pertencer a ela.

alter table public.proposta add column proposta_origem_id uuid
  constraint proposta_origem_fk references public.proposta (id);
create index proposta_origem_idx on public.proposta (proposta_origem_id) where proposta_origem_id is not null;

alter table public.proposta drop constraint aditivo_tem_obra;
alter table public.proposta add constraint aditivo_tem_obra
  check (tipo <> 'aditivo' or obra_id is not null or proposta_origem_id is not null);
alter table public.proposta add constraint origem_so_em_aditivo
  check (proposta_origem_id is null or tipo = 'aditivo');

-- Obra que nasceu de uma proposta (pela versão aprovada) ou que a proposta já aponta.
create or replace function public.obra_da_proposta(p_proposta uuid)
returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select o.id from obra o join proposta_versao v on v.id = o.proposta_versao_id where v.proposta_id = p_proposta limit 1),
    (select obra_id from proposta where id = p_proposta))
$$;

-- Cria o aditivo a partir do orçamento aceito, com a versão 1 já preparada.
create or replace function public.criar_aditivo(p_origem uuid, p_titulo text, p_motivo text default null)
returns uuid language plpgsql set search_path = public as $$
declare o proposta; va proposta_versao; v_id uuid; v_ver uuid; v_n int;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_titulo), '') = '' then raise exception 'Dê um título ao aditivo.'; end if;
  select * into o from proposta where id = p_origem;
  if o.id is null then raise exception 'Orçamento não encontrado.'; end if;
  -- Aditivo de aditivo fica ligado ao orçamento original.
  if o.tipo = 'aditivo' then
    if o.proposta_origem_id is null then raise exception 'Este aditivo não está ligado a um orçamento. Crie o novo aditivo na obra.'; end if;
    select * into o from proposta where id = o.proposta_origem_id;
  end if;
  if o.estado <> 'aprovada' or o.versao_aprovada_id is null then
    raise exception 'Só dá para lançar aditivo em orçamento já aceito pelo cliente.';
  end if;
  select * into va from proposta_versao where id = o.versao_aprovada_id;
  select count(*) + 1 into v_n from proposta where proposta_origem_id = o.id;

  insert into proposta (tipo, oportunidade_id, pessoa_id, obra_id, titulo, proposta_origem_id)
  values ('aditivo', o.oportunidade_id, o.pessoa_id, obra_da_proposta(o.id), trim(p_titulo), o.id)
  returning id into v_id;

  insert into proposta_versao (proposta_id, numero, conteudo, valor_total)
  values (v_id, 1, jsonb_strip_nulls(jsonb_build_object(
    'local', va.conteudo->'local',
    'cor', va.conteudo->'cor',
    'motivo', nullif(trim(coalesce(p_motivo, '')), ''),
    'impacto_prazo_dias', 0,
    'validade_dias', 15,
    'apresentacao', 'Este aditivo nº ' || v_n || ' complementa o orçamento ' || o.codigo || ' (“' || o.titulo || '”), aceito em '
      || to_char((o.aprovada_em at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY')
      || '. Ele acrescenta os serviços descritos abaixo, com preço e condições próprios. O orçamento original continua valendo em todas as demais condições.',
    'aditivo_de', jsonb_build_object('codigo', o.codigo, 'titulo', o.titulo, 'versao', va.numero,
      'aprovada_em', o.aprovada_em, 'valor', va.valor_total, 'numero', v_n),
    'ambientes', '[]'::jsonb,
    'pagamento', jsonb_build_object('descricao', 'Pagamento do aditivo', 'parcelas', '[]'::jsonb))), 0)
  returning id into v_ver;
  return v_id;
end $$;
grant execute on function public.criar_aditivo(uuid, text, text) to authenticated;
grant execute on function public.obra_da_proposta(uuid) to authenticated;

-- Quando o orçamento original vira obra, os aditivos ligados a ele passam a pertencer à obra.
create or replace function public.obra_herda_aditivos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.proposta_versao_id is not null and (tg_op = 'INSERT' or old.proposta_versao_id is distinct from new.proposta_versao_id) then
    update proposta set obra_id = new.id
    where tipo = 'aditivo' and obra_id is null
      and proposta_origem_id = (select proposta_id from proposta_versao where id = new.proposta_versao_id);
  end if;
  return new;
end $$;
create trigger obra_herda_aditivos after insert or update of proposta_versao_id on public.obra
  for each row execute function public.obra_herda_aditivos();

-- Aditivos já existentes criados na obra: liga ao orçamento de origem da obra.
update public.proposta a set proposta_origem_id = v.proposta_id
from public.obra o join public.proposta_versao v on v.id = o.proposta_versao_id
where a.tipo = 'aditivo' and a.obra_id = o.id and a.proposta_origem_id is null;

-- Resumo consolidado do orçamento: original + aditivos (aprovados e em andamento).
create or replace function public.resumo_orcamento(p_proposta uuid)
returns jsonb language sql stable set search_path = public as $$
  with o as (select p.*, v.valor_total as valor_original from proposta p left join proposta_versao v on v.id = p.versao_aprovada_id where p.id = p_proposta),
  a as (
    select p.id, p.codigo, p.titulo, p.estado, p.aprovada_em, p.criado_em,
           coalesce(va.valor_total, u.valor_total, 0) as valor,
           u.numero as versao,
           exists (select 1 from servico s where s.origem_versao_id = p.versao_aprovada_id) as incorporado
    from proposta p
    left join proposta_versao va on va.id = p.versao_aprovada_id
    left join lateral (select numero, valor_total from proposta_versao where proposta_id = p.id order by numero desc limit 1) u on true
    where p.proposta_origem_id = p_proposta and p.estado <> 'arquivada')
  select case when not eh_equipe_adm() then null else jsonb_build_object(
    'valor_original', (select valor_original from o),
    'aditivos_aprovados', coalesce((select sum(valor) from a where estado = 'aprovada'), 0),
    'aditivos_em_aberto', coalesce((select sum(valor) from a where estado in ('rascunho', 'enviada', 'em_negociacao')), 0),
    'total_consolidado', coalesce((select valor_original from o), 0) + coalesce((select sum(valor) from a where estado = 'aprovada'), 0),
    'obra_id', obra_da_proposta(p_proposta),
    'aditivos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'titulo', titulo, 'estado', estado,
        'aprovada_em', aprovada_em, 'valor', valor, 'versao', versao, 'incorporado', incorporado) order by criado_em) from a), '[]'::jsonb)
  ) end
$$;
grant execute on function public.resumo_orcamento(uuid) to authenticated;
