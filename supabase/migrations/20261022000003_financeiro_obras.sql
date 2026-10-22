-- Etapa 3: financeiro completo por obra e serviço.
-- Rateio de lançamentos, contratação de parceiros, orçamento-base por serviço,
-- resultado por obra/serviço e planejador de destinação dos recursos.

alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Orçamento-base por serviço (valores: só financeiro)
-- ---------------------------------------------------------------------
create table public.servico_financeiro (
  servico_id uuid primary key references public.servico (id) on delete cascade,
  valor_vendido numeric(14,2) not null default 0 check (valor_vendido >= 0),
  previsto_material numeric(14,2) not null default 0 check (previsto_material >= 0),
  previsto_mao_obra numeric(14,2) not null default 0 check (previsto_mao_obra >= 0),
  previsto_outros numeric(14,2) not null default 0 check (previsto_outros >= 0),
  observacoes text,
  atualizado_em timestamptz not null default now()
);
create trigger servico_financeiro_atualizado before update on public.servico_financeiro
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Contratação de parceiros (mão de obra e serviços de terceiros)
-- ---------------------------------------------------------------------
create table public.contratacao (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  obra_id uuid not null references public.obra (id),
  servico_id uuid references public.servico (id),
  pessoa_id uuid not null references public.pessoa (id),
  descricao text not null check (length(trim(descricao)) > 0),
  modalidade text not null default 'empreitada' check (modalidade in ('empreitada', 'diaria', 'medicao', 'outro')),
  natureza text not null default 'mao_obra' check (natureza in ('mao_obra', 'material', 'outros')),
  quantidade numeric(12,2) check (quantidade is null or quantidade > 0),
  valor_unitario numeric(14,2) check (valor_unitario is null or valor_unitario >= 0),
  valor_contratado numeric(14,2) not null check (valor_contratado >= 0),
  data_contratacao date not null default (now() at time zone 'America/Sao_Paulo')::date,
  prazo_inicio date,
  prazo_fim date,
  condicoes_pagamento text,
  estado text not null default 'ativa' check (estado in ('ativa', 'concluida', 'cancelada')),
  motivo_cancelamento text,
  concluida_em date,
  avaliacao_qualidade smallint check (avaliacao_qualidade between 1 and 5),
  avaliacao_prazo smallint check (avaliacao_prazo between 1 and 5),
  avaliacao_texto text,
  observacoes text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint contratacao_cancelamento check (estado <> 'cancelada' or length(trim(coalesce(motivo_cancelamento, ''))) > 0)
);
create index contratacao_obra_idx on public.contratacao (obra_id);
create index contratacao_pessoa_idx on public.contratacao (pessoa_id);
create trigger contratacao_atualizado before update on public.contratacao
  for each row execute function public.tocar_atualizado_em();

create or replace function public.contratacao_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.codigo is null then
    new.codigo := 'CT-' || lpad(proximo_numero('contratacao')::text, 5, '0');
  end if;
  if new.servico_id is not null and not exists (select 1 from servico where id = new.servico_id and obra_id = new.obra_id) then
    raise exception 'O serviço escolhido não pertence a esta obra.';
  end if;
  if tg_op = 'UPDATE' and old.estado = 'cancelada' and new.estado <> 'cancelada' then
    raise exception 'Contratação cancelada não pode ser reativada. Crie uma nova.';
  end if;
  if new.estado = 'concluida' and new.concluida_em is null then
    new.concluida_em := (now() at time zone 'America/Sao_Paulo')::date;
  end if;
  return new;
end $$;
create trigger contratacao_antes before insert or update on public.contratacao
  for each row execute function public.contratacao_antes();

-- Adicionais e descontos combinados depois (o valor original não muda).
create table public.contratacao_aditivo (
  id uuid primary key default gen_random_uuid(),
  contratacao_id uuid not null references public.contratacao (id),
  descricao text not null check (length(trim(descricao)) > 0),
  valor numeric(14,2) not null check (valor <> 0),
  motivo text,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index contratacao_aditivo_idx on public.contratacao_aditivo (contratacao_id);

-- Lançamento pode pertencer a uma contratação (pagamentos ao parceiro).
alter table public.lancamento add column contratacao_id uuid references public.contratacao (id);
create index lancamento_contratacao_idx on public.lancamento (contratacao_id);

-- ---------------------------------------------------------------------
-- Rateio: um lançamento dividido entre obras e serviços
-- ---------------------------------------------------------------------
create table public.lancamento_rateio (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.lancamento (id) on delete cascade,
  obra_id uuid not null references public.obra (id),
  servico_id uuid references public.servico (id),
  valor numeric(14,2) not null check (valor > 0),
  descricao text
);
create index lancamento_rateio_idx on public.lancamento_rateio (lancamento_id);
create index lancamento_rateio_obra_idx on public.lancamento_rateio (obra_id);

create or replace function public.rateio_validar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.servico_id is not null and not exists (select 1 from servico where id = new.servico_id and obra_id = new.obra_id) then
    raise exception 'Serviço do rateio não pertence à obra indicada.';
  end if;
  return new;
end $$;
create trigger rateio_validar before insert or update on public.lancamento_rateio
  for each row execute function public.rateio_validar();

-- Soma do rateio = total do lançamento (conferido no fim da transação).
create or replace function public.rateio_soma()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lanc uuid := coalesce(to_jsonb(new)->>'lancamento_id', to_jsonb(old)->>'lancamento_id', to_jsonb(new)->>'id')::uuid;
        v_total numeric; v_soma numeric; v_qtd int;
begin
  select valor_total into v_total from lancamento where id = v_lanc;
  select count(*), coalesce(sum(valor), 0) into v_qtd, v_soma from lancamento_rateio where lancamento_id = v_lanc;
  if v_total is not null and v_qtd > 0 and v_soma <> v_total then
    raise exception 'O rateio (%) precisa somar o total do lançamento (%).', v_soma, v_total;
  end if;
  return null;
end $$;
create constraint trigger rateio_soma after insert or update or delete on public.lancamento_rateio
  deferrable initially deferred for each row execute function public.rateio_soma();
create constraint trigger rateio_soma_lancamento after update of valor_total on public.lancamento
  deferrable initially deferred for each row execute function public.rateio_soma();

-- salvar_lancamento passa a aceitar contratação e rateio.
create or replace function public.salvar_lancamento(p jsonb, p_id uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare v_id uuid; v_parc jsonb; v_ct contratacao; v_soma numeric;
begin
  if not tem_financeiro() then
    raise exception 'Sem permissão para o financeiro.';
  end if;
  if nullif(p->>'contratacao_id', '') is not null then
    select * into v_ct from contratacao where id = (p->>'contratacao_id')::uuid;
    if v_ct.id is null then raise exception 'Contratação não encontrada.'; end if;
    if v_ct.estado = 'cancelada' then raise exception 'Contratação cancelada não recebe novos lançamentos.'; end if;
    if (p->>'tipo') <> 'pagar' or nullif(p->>'obra_id', '')::uuid is distinct from v_ct.obra_id then
      raise exception 'Pagamento de contratação precisa ser uma conta a pagar da mesma obra.';
    end if;
  end if;
  if p_id is null then
    insert into lancamento (tipo, descricao, pessoa_id, categoria_id, escopo, obra_id, servico_id,
                            valor_total, data_competencia, documento_ref, observacoes, contratacao_id)
    values ((p->>'tipo')::tipo_conta, p->>'descricao', nullif(p->>'pessoa_id', '')::uuid,
            (p->>'categoria_id')::uuid, (p->>'escopo')::escopo_financeiro,
            nullif(p->>'obra_id', '')::uuid, nullif(p->>'servico_id', '')::uuid,
            (p->>'valor_total')::numeric, (p->>'data_competencia')::date,
            p->>'documento_ref', p->>'observacoes', nullif(p->>'contratacao_id', '')::uuid)
    returning id into v_id;
  else
    update lancamento set
      descricao = p->>'descricao',
      pessoa_id = nullif(p->>'pessoa_id', '')::uuid,
      categoria_id = (p->>'categoria_id')::uuid,
      escopo = (p->>'escopo')::escopo_financeiro,
      obra_id = nullif(p->>'obra_id', '')::uuid,
      servico_id = nullif(p->>'servico_id', '')::uuid,
      valor_total = (p->>'valor_total')::numeric,
      data_competencia = (p->>'data_competencia')::date,
      documento_ref = p->>'documento_ref',
      observacoes = p->>'observacoes',
      contratacao_id = case when p ? 'contratacao_id' then nullif(p->>'contratacao_id', '')::uuid else contratacao_id end
    where id = p_id and not cancelado
    returning id into v_id;
    if v_id is null then
      raise exception 'Lançamento não encontrado ou cancelado.';
    end if;
  end if;

  if p ? 'rateio' then
    delete from lancamento_rateio where lancamento_id = v_id;
    if jsonb_array_length(p->'rateio') > 0 then
      if (p->>'escopo') <> 'obra' then raise exception 'Só valores de obra podem ser rateados.'; end if;
      select sum((r->>'valor')::numeric) into v_soma from jsonb_array_elements(p->'rateio') r;
      if v_soma <> (p->>'valor_total')::numeric then
        raise exception 'O rateio (%) precisa somar o total do lançamento (%).', v_soma, (p->>'valor_total')::numeric;
      end if;
      insert into lancamento_rateio (lancamento_id, obra_id, servico_id, valor, descricao)
      select v_id, (r->>'obra_id')::uuid, nullif(r->>'servico_id', '')::uuid, (r->>'valor')::numeric, r->>'descricao'
      from jsonb_array_elements(p->'rateio') r;
    end if;
  end if;

  if p ? 'parcelas' then
    if p_id is not null then
      if exists (select 1 from movimento m join parcela pa on pa.id = m.parcela_id where pa.lancamento_id = v_id) then
        for v_parc in select * from jsonb_array_elements(p->'parcelas') loop
          update parcela set vencimento = (v_parc->>'vencimento')::date
          where lancamento_id = v_id and numero = (v_parc->>'numero')::int;
        end loop;
        return v_id;
      end if;
      delete from parcela where lancamento_id = v_id;
    end if;
    insert into parcela (lancamento_id, numero, valor, vencimento)
    select v_id, (e->>'numero')::int, (e->>'valor')::numeric, (e->>'vencimento')::date
    from jsonb_array_elements(p->'parcelas') e;
  end if;
  if (select coalesce(sum(valor), 0) from parcela where lancamento_id = v_id)
     <> (select valor_total from lancamento where id = v_id) then
    raise exception 'A soma das parcelas precisa ser igual ao valor total.';
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Visões de apoio (seguem as permissões das tabelas de origem)
-- ---------------------------------------------------------------------
-- Quanto já foi liquidado de cada lançamento (estornos descontados).
create view public.v_lancamento_pago with (security_invoker = true) as
  select l.id as lancamento_id, coalesce(sum(p.pago), 0) as pago
  from public.lancamento l
  left join public.v_parcela p on p.lancamento_id = l.id
  group by l.id;

-- Alocação de cada lançamento em obra/serviço (rateio quando existir; senão o próprio vínculo).
create view public.v_alocacao with (security_invoker = true) as
  select l.id as lancamento_id, l.tipo, l.cancelado, l.contratacao_id, l.data_competencia, c.natureza as categoria_natureza,
         coalesce(r.obra_id, l.obra_id) as obra_id,
         case when r.id is null then l.servico_id else r.servico_id end as servico_id,
         coalesce(r.valor, l.valor_total) as valor,
         round(lp.pago * coalesce(r.valor, l.valor_total) / l.valor_total, 2) as pago
  from public.lancamento l
  join public.categoria c on c.id = l.categoria_id
  join public.v_lancamento_pago lp on lp.lancamento_id = l.id
  left join public.lancamento_rateio r on r.lancamento_id = l.id
  where r.id is not null or l.obra_id is not null;

create view public.v_contratacao with (security_invoker = true) as
  select ct.*, pe.nome as pessoa_nome, s.nome as servico_nome, o.codigo as obra_codigo, o.nome as obra_nome,
         coalesce(ad.total, 0) as aditivos,
         ct.valor_contratado + coalesce(ad.total, 0) as valor_total,
         coalesce(lc.lancado, 0) as lancado,
         coalesce(lc.pago, 0) as pago,
         case when ct.estado = 'cancelada' then coalesce(lc.lancado, 0) else ct.valor_contratado + coalesce(ad.total, 0) end as compromisso,
         case when ct.estado = 'cancelada' then coalesce(lc.lancado, 0) - coalesce(lc.pago, 0)
              else ct.valor_contratado + coalesce(ad.total, 0) - coalesce(lc.pago, 0) end as saldo_a_pagar,
         case when ct.estado = 'cancelada' then 0
              else greatest(ct.valor_contratado + coalesce(ad.total, 0) - coalesce(lc.lancado, 0), 0) end as a_lancar
  from public.contratacao ct
  join public.pessoa pe on pe.id = ct.pessoa_id
  join public.obra o on o.id = ct.obra_id
  left join public.servico s on s.id = ct.servico_id
  left join lateral (select sum(valor) as total from public.contratacao_aditivo where contratacao_id = ct.id) ad on true
  left join lateral (
    select sum(l.valor_total) as lancado, sum(lp.pago) as pago
    from public.lancamento l join public.v_lancamento_pago lp on lp.lancamento_id = l.id
    where l.contratacao_id = ct.id and not l.cancelado) lc on true;

-- ---------------------------------------------------------------------
-- Resultado por obra e serviço
-- ---------------------------------------------------------------------
-- Nomes (sem chamar de lucro):
--   previsto: orçamento-base do serviço; contratado: contratações + compras lançadas;
--   lançado: obrigações registradas; pago: liquidado; a pagar: contratado - pago;
--   ainda a contratar: previsto - contratado (se positivo); custo estimado na conclusão: contratado + ainda a contratar;
--   diferença estimada: vendido - custo estimado (antes de tributos e despesas da empresa).
create or replace function public.resultado_obra_servicos(p_obra uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare r jsonb; v_modelo text; v_vendido_obra numeric;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  select modelo_contratacao, valor_contratado into v_modelo, v_vendido_obra from obra_financeiro where obra_id = p_obra;
  with
  servs as (
    select s.id, s.nome, s.ordem, coalesce(f.valor_vendido, 0) as vendido,
           coalesce(f.previsto_material, 0) as prev_mat, coalesce(f.previsto_mao_obra, 0) as prev_mo, coalesce(f.previsto_outros, 0) as prev_out
    from servico s left join servico_financeiro f on f.servico_id = s.id
    where s.obra_id = p_obra and not s.arquivado
    union all
    select null, 'Sem serviço definido', 9999, 0, 0, 0, 0
  ),
  aloc as (
    select a.*, case a.categoria_natureza when 'custo_material' then 'material' when 'custo_mao_obra' then 'mao_obra' else 'outros' end as grupo
    from v_alocacao a where a.obra_id = p_obra and not a.cancelado
  ),
  custos as (
    select servico_id,
      sum(valor) filter (where grupo = 'material') as lanc_mat,
      sum(valor) filter (where grupo = 'mao_obra') as lanc_mo,
      sum(valor) filter (where grupo = 'outros') as lanc_out,
      sum(valor) as lancado, sum(pago) as pago,
      sum(valor) filter (where contratacao_id is null) as compras
    from aloc where tipo = 'pagar' and categoria_natureza in ('custo_material', 'custo_mao_obra', 'custo_outros')
    group by servico_id
  ),
  receitas as (
    select servico_id, sum(valor) as faturado, sum(pago) as recebido
    from aloc where tipo = 'receber' group by servico_id
  ),
  contr as (
    select servico_id, sum(compromisso) as compromisso, sum(lancado) as lancado_ct
    from v_contratacao where obra_id = p_obra group by servico_id
  ),
  linhas as (
    select s.id, s.nome, s.ordem, s.vendido,
      s.prev_mat + s.prev_mo + s.prev_out as previsto, s.prev_mat, s.prev_mo, s.prev_out,
      coalesce(c.lanc_mat, 0) as lanc_mat, coalesce(c.lanc_mo, 0) as lanc_mo, coalesce(c.lanc_out, 0) as lanc_out,
      coalesce(c.lancado, 0) as lancado, coalesce(c.pago, 0) as pago,
      -- contratado = compras lançadas fora de contratação + compromisso das contratações
      coalesce(c.compras, 0) + coalesce(ct.compromisso, 0) as contratado,
      coalesce(rc.faturado, 0) as faturado, coalesce(rc.recebido, 0) as recebido
    from servs s
    left join custos c on c.servico_id is not distinct from s.id
    left join contr ct on ct.servico_id is not distinct from s.id
    left join receitas rc on rc.servico_id is not distinct from s.id
  ),
  calc as (
    select l.*,
      l.contratado - l.pago as a_pagar,
      greatest(l.previsto - l.contratado, 0) as a_contratar,
      l.contratado + greatest(l.previsto - l.contratado, 0) as custo_estimado,
      l.faturado - l.recebido as a_receber,
      l.recebido - l.pago as saldo_caixa
    from linhas l
    where l.id is not null or l.lancado <> 0 or l.contratado <> 0 or l.faturado <> 0
  )
  select jsonb_build_object(
    'modelo', v_modelo,
    'vendido_obra', coalesce(v_vendido_obra, 0),
    'servicos', coalesce(jsonb_agg(jsonb_build_object(
        'servico_id', id, 'nome', nome, 'vendido', vendido, 'previsto', previsto,
        'previsto_material', prev_mat, 'previsto_mao_obra', prev_mo, 'previsto_outros', prev_out,
        'lancado_material', lanc_mat, 'lancado_mao_obra', lanc_mo, 'lancado_outros', lanc_out,
        'lancado', lancado, 'contratado', contratado, 'pago', pago, 'a_pagar', a_pagar, 'a_contratar', a_contratar,
        'custo_estimado', custo_estimado, 'variacao_previsto', previsto - custo_estimado,
        'diferenca_estimada', vendido - custo_estimado, 'faturado', faturado, 'recebido', recebido, 'a_receber', a_receber,
        'saldo_caixa', saldo_caixa) order by ordem, nome), '[]'::jsonb),
    'total', jsonb_build_object(
        'vendido_servicos', coalesce(sum(vendido), 0), 'previsto', coalesce(sum(previsto), 0),
        'lancado_material', coalesce(sum(lanc_mat), 0), 'lancado_mao_obra', coalesce(sum(lanc_mo), 0), 'lancado_outros', coalesce(sum(lanc_out), 0),
        'lancado', coalesce(sum(lancado), 0), 'contratado', coalesce(sum(contratado), 0), 'pago', coalesce(sum(pago), 0),
        'a_pagar', coalesce(sum(a_pagar), 0), 'a_contratar', coalesce(sum(a_contratar), 0), 'custo_estimado', coalesce(sum(custo_estimado), 0),
        'faturado', coalesce(sum(faturado), 0), 'recebido', coalesce(sum(recebido), 0), 'a_receber', coalesce(sum(a_receber), 0),
        'saldo_caixa', coalesce(sum(saldo_caixa), 0),
        'diferenca_estimada', coalesce(v_vendido_obra, 0) - coalesce(sum(custo_estimado), 0))
  ) into r from calc;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Planejador de destinação (gerencial; não é apuração contábil)
-- ---------------------------------------------------------------------
alter table public.empresa
  add column reserva_minima numeric(14,2) check (reserva_minima is null or reserva_minima >= 0),
  add column pro_labore_planejado numeric(14,2) check (pro_labore_planejado is null or pro_labore_planejado >= 0),
  add column horizonte_despesas_dias integer not null default 30 check (horizonte_despesas_dias between 1 and 120);

create or replace function public.planejador_destinacao()
returns jsonb language plpgsql stable set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  e empresa;
  v_saldo numeric; v_obras numeric; v_contr numeric; v_desp numeric; v_receb_mes numeric; v_trib_pagos numeric;
  v_trib numeric; v_reserva numeric; v_pro numeric; v_disp numeric; v_receber_obras numeric;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  select * into e from empresa limit 1;
  select coalesce(sum(saldo), 0) into v_saldo from v_saldo_conta where ativa;
  -- O que as obras ainda devem pagar (lançado e não pago).
  select coalesce(sum(saldo), 0) into v_obras from v_parcela where tipo = 'pagar' and escopo = 'obra' and situacao in ('aberta', 'parcial', 'vencida');
  -- Contratado com parceiros e ainda não lançado como conta a pagar.
  select coalesce(sum(a_lancar), 0) into v_contr from v_contratacao where estado <> 'cancelada';
  select coalesce(sum(saldo), 0) into v_desp from v_parcela
    where tipo = 'pagar' and escopo = 'empresa' and situacao in ('aberta', 'parcial', 'vencida') and vencimento <= hoje + e.horizonte_despesas_dias;
  select coalesce(sum(valor_assinado), 0) into v_receb_mes from v_movimento
    where categoria_natureza in ('receita_servico', 'reembolso_cliente') and date_trunc('month', data) = date_trunc('month', hoje);
  select coalesce(-sum(valor_assinado), 0) into v_trib_pagos from v_movimento
    where categoria_natureza = 'tributo' and date_trunc('month', data) = date_trunc('month', hoje);
  select coalesce(sum(saldo), 0) into v_receber_obras from v_parcela where tipo = 'receber' and situacao in ('aberta', 'parcial', 'vencida');
  v_trib := case when e.provisao_impostos_pct is null then null else greatest(round(v_receb_mes * e.provisao_impostos_pct / 100, 2) - v_trib_pagos, 0) end;
  v_reserva := greatest(coalesce(e.reserva_minima, 0), 0);
  v_pro := coalesce(e.pro_labore_planejado, 0);
  v_disp := v_saldo - v_obras - v_contr - v_desp - coalesce(v_trib, 0) - v_reserva - v_pro;
  return jsonb_build_object(
    'saldo_contas', v_saldo,
    'obrigacoes_obras', v_obras,
    'contratado_nao_lancado', v_contr,
    'despesas_empresa', v_desp,
    'horizonte_dias', e.horizonte_despesas_dias,
    'recebido_mes', v_receb_mes,
    'provisao_pct', e.provisao_impostos_pct,
    'tributos_pagos_mes', v_trib_pagos,
    'provisao_tributos', v_trib,
    'reserva_minima', v_reserva,
    'pro_labore', v_pro,
    'disponivel', v_disp,
    'a_receber', v_receber_obras,
    'configurado', e.provisao_impostos_pct is not null and e.reserva_minima is not null);
end $$;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['servico_financeiro', 'contratacao', 'contratacao_aditivo', 'lancamento_rateio'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (tem_financeiro()) with check (tem_financeiro())', t || '_fin', t);
  end loop;
end $$;
grant delete on public.lancamento_rateio, public.servico_financeiro to authenticated;
grant select on public.v_lancamento_pago, public.v_alocacao, public.v_contratacao to authenticated;
revoke all on public.v_lancamento_pago, public.v_alocacao, public.v_contratacao from anon;

grant execute on function
  public.salvar_lancamento(jsonb, uuid), public.resultado_obra_servicos(uuid), public.planejador_destinacao()
to authenticated;
-- Aditivo de contratação não se edita: corrige-se com outro aditivo.
revoke update on public.contratacao_aditivo from authenticated;

-- Resumo da obra passa a respeitar o rateio (cada obra vê só a parte que lhe cabe).
create or replace function public.resumo_obra(p_obra uuid)
returns jsonb language sql stable set search_path = public as $$
  with a as (select * from v_alocacao where obra_id = p_obra and not cancelado),
  t as (select
    (select valor_contratado from obra_financeiro where obra_id = p_obra) as valor_contratado,
    coalesce((select sum(valor) from a where tipo = 'receber'), 0) as a_receber_total,
    coalesce((select sum(pago) from a where tipo = 'receber' and categoria_natureza in ('receita_servico', 'reembolso_cliente')), 0) as recebido,
    coalesce((select sum(valor) from a where tipo = 'pagar'), 0) as custo_lancado,
    coalesce((select sum(pago) from a where tipo = 'pagar' and categoria_natureza like 'custo_%'), 0) as pago,
    coalesce((select sum(case when tipo = 'receber' then pago else -pago end) from a), 0) as saldo_caixa)
  select case when not tem_financeiro() then null else jsonb_build_object(
    'valor_contratado', valor_contratado, 'a_receber_total', a_receber_total, 'recebido', recebido,
    'custo_lancado', custo_lancado, 'pago', pago, 'saldo_caixa', saldo_caixa) end
  from t
$$;
