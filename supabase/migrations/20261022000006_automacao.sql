-- Etapa 6: automação e acabamento.
-- Notas fiscais (importação do XML da NF-e com conferência e distribuição de
-- frete/desconto), central de pendências com avisos dispensáveis e pontos de
-- melhoria do relatório da obra.

alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Notas fiscais
-- Nota = documento da compra; conta a pagar = obrigação; comprovante =
-- evidência da liquidação; movimento = pagamento. A nota confirmada gera
-- (ou se liga a) UMA conta a pagar: o gasto nunca entra duas vezes.
-- ---------------------------------------------------------------------
create table public.nota_fiscal (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'xml' check (origem in ('xml', 'manual')),
  chave text check (chave ~ '^[0-9]{44}$'),
  modelo text,
  numero text,
  serie text,
  emitente_documento text,
  emitente_nome text,
  fornecedor_id uuid references public.pessoa (id),
  data_emissao date,
  valor_produtos numeric(14,2) not null default 0 check (valor_produtos >= 0),
  valor_frete numeric(14,2) not null default 0 check (valor_frete >= 0),
  valor_desconto numeric(14,2) not null default 0 check (valor_desconto >= 0),
  valor_outros numeric(14,2) not null default 0 check (valor_outros >= 0),
  valor_total numeric(14,2) not null check (valor_total > 0),
  criterio_rateio text not null default 'proporcional' check (criterio_rateio in ('proporcional', 'informado_no_xml')),
  duplicatas jsonb not null default '[]', -- [{numero, vencimento, valor}]
  avisos jsonb not null default '[]',      -- pontos incertos apontados na leitura
  estado text not null default 'rascunho' check (estado in ('rascunho', 'confirmada', 'descartada')),
  descarte_motivo text,
  lancamento_id uuid references public.lancamento (id),
  arquivo_caminho text check (arquivo_caminho is null or arquivo_caminho like 'financeiro/notas/%'),
  confirmada_em timestamptz,
  confirmada_por uuid,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint nota_confirmada check (estado <> 'confirmada' or lancamento_id is not null),
  constraint nota_descarte check (estado <> 'descartada' or length(trim(coalesce(descarte_motivo, ''))) > 0)
);
create unique index nota_chave_unica on public.nota_fiscal (chave) where chave is not null and estado <> 'descartada';
create unique index nota_numero_unico on public.nota_fiscal (emitente_documento, serie, numero)
  where emitente_documento is not null and numero is not null and estado <> 'descartada';
create unique index nota_lancamento_unico on public.nota_fiscal (lancamento_id) where lancamento_id is not null;
create trigger nota_atualizado before update on public.nota_fiscal
  for each row execute function public.tocar_atualizado_em();

create table public.nota_item (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.nota_fiscal (id) on delete cascade,
  numero integer not null,
  codigo text,
  descricao text not null,
  ncm text,
  unidade text,
  quantidade numeric(14,4) not null default 1 check (quantidade > 0),
  valor_bruto numeric(14,2) not null check (valor_bruto >= 0),
  frete numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  outros numeric(14,2) not null default 0,
  valor_final numeric(14,2) generated always as (valor_bruto + frete + outros - desconto) stored,
  obra_id uuid references public.obra (id),
  servico_id uuid references public.servico (id),
  material_id uuid references public.material (id),
  unique (nota_id, numero),
  constraint item_servico_obra check (servico_id is null or obra_id is not null),
  constraint item_material_obra check (material_id is null or obra_id is not null)
);
create index nota_item_nota_idx on public.nota_item (nota_id);

-- Nota confirmada ou descartada não muda mais (exceto ligar o arquivo).
create or replace function public.nota_antes()
returns trigger language plpgsql as $$
begin
  if old.estado <> 'rascunho' and (new.estado, new.valor_total, new.lancamento_id, new.chave, new.numero)
       is distinct from (old.estado, old.valor_total, old.lancamento_id, old.chave, old.numero) then
    raise exception 'Nota confirmada ou descartada não pode ser alterada.';
  end if;
  if new.estado = 'confirmada' and old.estado <> 'confirmada' and coalesce(current_setting('rosae.confirmando_nota', true), '') <> 'sim' then
    raise exception 'Confirme a nota pelo botão Confirmar (ele confere a soma e gera a conta a pagar).';
  end if;
  return new;
end $$;
create trigger nota_antes before update on public.nota_fiscal for each row execute function public.nota_antes();

create or replace function public.nota_item_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  select estado into v_estado from nota_fiscal where id = coalesce(new.nota_id, old.nota_id);
  if v_estado <> 'rascunho' then raise exception 'Itens de nota confirmada não podem ser alterados.'; end if;
  if tg_op <> 'DELETE' then
    if new.servico_id is not null and not exists (select 1 from servico where id = new.servico_id and obra_id = new.obra_id) then
      raise exception 'O serviço precisa ser da obra escolhida.';
    end if;
    if new.material_id is not null and not exists (select 1 from material where id = new.material_id and obra_id = new.obra_id) then
      raise exception 'O material precisa ser da obra escolhida.';
    end if;
    return new;
  end if;
  return old;
end $$;
create trigger nota_item_antes before insert or update or delete on public.nota_item
  for each row execute function public.nota_item_antes();

-- Possíveis duplicidades: mesma chave, mesmo emitente+série+número, ou conta a pagar com a chave/numero no documento.
create or replace function public.notas_semelhantes(p_chave text, p_emitente text, p_numero text, p_serie text, p_total numeric, p_data date)
returns table (tipo text, id uuid, descricao text, motivo text)
language sql stable set search_path = public as $$
  select 'nota', n.id, coalesce(n.emitente_nome, '') || ' nº ' || coalesce(n.numero, '?'),
         case when n.chave = p_chave then 'mesma chave de acesso' else 'mesmo emitente, série e número' end
  from nota_fiscal n
  where n.estado <> 'descartada'
    and ((p_chave is not null and n.chave = p_chave)
      or (p_emitente is not null and p_numero is not null and n.emitente_documento = p_emitente and n.numero = p_numero
          and coalesce(n.serie, '') = coalesce(p_serie, '')))
  union all
  select 'lancamento', l.id, l.codigo || ' · ' || l.descricao,
         case when p_chave is not null and l.documento_ref like '%' || p_chave || '%' then 'conta a pagar com a mesma chave'
              else 'conta a pagar com mesmo valor e data próxima' end
  from lancamento l
  where l.tipo = 'pagar' and not l.cancelado
    and not exists (select 1 from nota_fiscal n where n.lancamento_id = l.id)
    and ((p_chave is not null and l.documento_ref like '%' || p_chave || '%')
      or (p_total is not null and l.valor_total = p_total and p_data is not null and abs(l.data_competencia - p_data) <= 5))
$$;

-- Confirma a nota: confere a soma, gera a conta a pagar (ou liga a uma existente),
-- rateia entre obras/serviços e registra a compra dos materiais ligados.
create or replace function public.confirmar_nota(p_nota uuid, p_categoria uuid, p_lancamento uuid default null, p_vencimento date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare n nota_fiscal; v_soma numeric; v_sem int; v_obras int; v_obra uuid; v_lanc uuid; v_l lancamento;
        v_rateio jsonb; v_parcelas jsonb; v_desc text; v_doc text; i record;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  select * into n from nota_fiscal where id = p_nota for update;
  if not found then raise exception 'Nota não encontrada.'; end if;
  if n.estado <> 'rascunho' then raise exception 'A nota já foi confirmada ou descartada.'; end if;
  select coalesce(sum(valor_final), 0), count(*) filter (where obra_id is null), count(distinct obra_id)
    into v_soma, v_sem, v_obras from nota_item where nota_id = p_nota;
  if v_soma <> n.valor_total then
    raise exception 'A soma dos itens (%) não fecha com o total da nota (%). Ajuste antes de confirmar.', v_soma, n.valor_total;
  end if;
  if v_sem > 0 and v_obras > 0 then
    raise exception 'Itens com e sem obra na mesma nota: classifique todos numa obra ou todos como despesa da empresa.';
  end if;
  v_doc := concat_ws(' ', 'NF-e', n.numero, case when n.serie is not null then 'série ' || n.serie end, case when n.chave is not null then 'chave ' || n.chave end);
  v_desc := left('Nota ' || coalesce(n.numero, 's/n') || ' · ' || coalesce(n.emitente_nome, 'fornecedor'), 200);

  if p_lancamento is not null then
    -- Nota de uma conta a pagar já lançada: só liga, sem criar outra despesa.
    select * into v_l from lancamento where id = p_lancamento;
    if v_l.id is null or v_l.tipo <> 'pagar' or v_l.cancelado then raise exception 'Conta a pagar não encontrada.'; end if;
    if v_l.valor_total <> n.valor_total then
      raise exception 'A conta a pagar (%) tem valor diferente da nota (%).', v_l.valor_total, n.valor_total;
    end if;
    if exists (select 1 from nota_fiscal where lancamento_id = p_lancamento) then raise exception 'Essa conta a pagar já tem nota ligada.'; end if;
    v_lanc := p_lancamento;
    update lancamento set documento_ref = coalesce(nullif(documento_ref, ''), v_doc) where id = v_lanc;
  else
    if p_categoria is null then raise exception 'Escolha a categoria da despesa.'; end if;
    if v_obras = 1 then select obra_id into v_obra from nota_item where nota_id = p_nota and obra_id is not null limit 1; end if;
    select coalesce(jsonb_agg(jsonb_build_object('obra_id', obra_id, 'servico_id', servico_id, 'valor', valor, 'descricao', 'Itens da nota')), '[]')
      into v_rateio
      from (select obra_id, servico_id, sum(valor_final) as valor from nota_item where nota_id = p_nota and obra_id is not null
            group by obra_id, servico_id) x;
    if jsonb_array_length(coalesce(nullif(n.duplicatas, 'null'::jsonb), '[]')) > 0
       and (select sum((d->>'valor')::numeric) from jsonb_array_elements(n.duplicatas) d) = n.valor_total then
      select jsonb_agg(jsonb_build_object('numero', ord, 'valor', (d->>'valor')::numeric, 'vencimento', d->>'vencimento') order by ord)
        into v_parcelas from jsonb_array_elements(n.duplicatas) with ordinality as e(d, ord);
    else
      v_parcelas := jsonb_build_array(jsonb_build_object('numero', 1, 'valor', n.valor_total,
                      'vencimento', coalesce(p_vencimento, n.data_emissao, (now() at time zone 'America/Sao_Paulo')::date)));
    end if;
    v_lanc := salvar_lancamento(jsonb_build_object(
      'tipo', 'pagar', 'descricao', v_desc, 'pessoa_id', n.fornecedor_id, 'categoria_id', p_categoria,
      'escopo', case when v_obras > 0 then 'obra' else 'empresa' end,
      'obra_id', case when v_obras = 1 then v_obra else (select obra_id from nota_item where nota_id = p_nota and obra_id is not null
                                                          group by obra_id order by sum(valor_final) desc limit 1) end,
      'servico_id', case when v_obras = 1 and (select count(distinct coalesce(servico_id::text, '-')) from nota_item where nota_id = p_nota) = 1
                         then (select servico_id from nota_item where nota_id = p_nota limit 1) end,
      'valor_total', n.valor_total, 'data_competencia', coalesce(n.data_emissao, (now() at time zone 'America/Sao_Paulo')::date),
      'documento_ref', v_doc, 'observacoes', 'Gerado a partir da nota importada.',
      'rateio', case when v_obras > 1 or jsonb_array_length(v_rateio) > 1 then v_rateio else '[]'::jsonb end,
      'parcelas', v_parcelas));
  end if;

  -- Compra dos materiais ligados (quantidade da nota), apontando para a mesma conta a pagar.
  for i in select * from nota_item where nota_id = p_nota and material_id is not null loop
    insert into material_evento (material_id, tipo, quantidade, data, documento, lancamento_id)
    values (i.material_id, 'compra', i.quantidade, coalesce(n.data_emissao, (now() at time zone 'America/Sao_Paulo')::date), v_doc, v_lanc);
  end loop;

  perform set_config('rosae.confirmando_nota', 'sim', true);
  update nota_fiscal set estado = 'confirmada', lancamento_id = v_lanc, confirmada_em = now(), confirmada_por = auth.uid() where id = p_nota;
  perform set_config('rosae.confirmando_nota', '', true);
  return v_lanc;
end $$;

-- ---------------------------------------------------------------------
-- Central de pendências: o que precisa de ação, com vínculo ao registro.
-- Roda com as permissões de quem pergunta (cada fonte respeita a RLS).
-- ---------------------------------------------------------------------
create table public.aviso_dispensado (
  usuario_id uuid not null default auth.uid() references public.usuario (id) on delete cascade,
  chave text not null,
  ate date,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, chave)
);

create or replace function public.central_pendencias()
returns table (chave text, tipo text, prioridade int, titulo text, detalhe text, link text, data date, obra text)
language sql stable set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  itens (chave, tipo, prioridade, titulo, detalhe, link, data, obra) as (
    -- Propostas enviadas sem resposta
    select 'proposta:' || p.id, 'proposta', 2, 'Proposta aguardando resposta', p.codigo || ' · ' || p.titulo,
           '/propostas/' || p.id, (p.atualizado_em at time zone 'America/Sao_Paulo')::date, null::text
    from proposta p where p.estado in ('enviada', 'em_negociacao')
    union all
    -- Oportunidades com próxima ação vencida
    select 'oportunidade:' || o.id, 'comercial', case when o.proxima_acao_data < (select d from hoje) then 1 else 2 end,
           'Próxima ação comercial', coalesce(o.proxima_acao, 'Ação') || ' · ' || o.titulo, '/comercial/' || o.id, o.proxima_acao_data, null
    from oportunidade o where not o.arquivado and o.proxima_acao_data <= (select d from hoje) + 1
    union all
    -- Notas importadas sem confirmar
    select 'nota:' || n.id, 'nota', 2, 'Nota sem classificação', coalesce(n.emitente_nome, 'Nota') || ' nº ' || coalesce(n.numero, '?'),
           '/notas/' || n.id, n.data_emissao, null
    from nota_fiscal n where n.estado = 'rascunho'
    union all
    -- Pagamentos vencidos ou vencendo em 7 dias; recebimentos vencidos
    select 'parcela:' || v.id, case when v.tipo = 'pagar' then 'pagamento' else 'recebimento' end,
           case when v.situacao = 'vencida' then 1 else 2 end,
           case when v.tipo = 'pagar' then (case when v.situacao = 'vencida' then 'Pagamento vencido' else 'Pagamento vencendo' end)
                else 'Recebimento vencido' end,
           v.codigo || ' · ' || v.descricao, '/financeiro/' || v.lancamento_id, v.vencimento, v.obra_nome
    from v_parcela v
    where not v.cancelado and v.saldo > 0
      and ((v.tipo = 'pagar' and v.vencimento <= (select d from hoje) + 7) or (v.tipo = 'receber' and v.situacao = 'vencida'))
    union all
    -- Materiais que travam etapas próximas
    select 'material:' || a.material_id || ':' || a.etapa_id, 'material', 1, 'Material para etapa próxima',
           a.material || ' · ' || a.etapa_nome, '/obras/' || a.obra_id || '?aba=materiais', a.inicio, a.obra_nome
    from alertas_materiais(null) a
    union all
    -- Serviço em execução sem atualização há 7 dias
    select 'sem_atualizacao:' || e.id, 'obra', 2, 'Etapa sem atualização há mais de 7 dias', e.nome, '/obras/' || e.obra_id || '?aba=cronograma',
           (e.atualizado_em at time zone 'America/Sao_Paulo')::date, o.nome
    from etapa e join obra o on o.id = e.obra_id
    where e.estado = 'em_execucao' and e.atualizado_em < now() - interval '7 days'
      and not exists (select 1 from registro r where r.etapa_id = e.id and r.criado_em > now() - interval '7 days')
    union all
    -- Pendências de obra abertas (decisão do cliente em destaque)
    select 'pendencia:' || p.id, case when p.tipo = 'decisao_cliente' then 'decisao' else 'pendencia' end,
           case when p.prioridade = 'alta' or p.prazo < (select d from hoje) then 1 when p.tipo = 'decisao_cliente' then 2 else 3 end,
           case when p.tipo = 'decisao_cliente' then 'Decisão aguardando cliente' else 'Pendência de obra' end,
           p.titulo, '/obras/' || p.obra_id || '?aba=diario', p.prazo, o.nome
    from pendencia p join obra o on o.id = p.obra_id where p.estado = 'aberta'
    union all
    -- Mensagens do portal sem resposta
    select 'portal:' || c.id, 'portal', 2, 'Mensagem do cliente sem resposta', left(c.texto, 90), '/obras/' || c.obra_id || '?aba=portal',
           (c.criado_em at time zone 'America/Sao_Paulo')::date, o.nome
    from portal_comentario c join obra o on o.id = c.obra_id where c.estado = 'aberto'
    union all
    -- Contrato em rascunho com dados faltando
    select 'contrato:' || k.id, 'documento', 2, 'Contrato em rascunho', k.codigo || coalesce(' · faltam ' || jsonb_array_length(k.conteudo->'faltando') || ' dados', ''),
           '/obras/' || k.obra_id || '?aba=contrato', (k.criado_em at time zone 'America/Sao_Paulo')::date, o.nome
    from contrato k join obra o on o.id = k.obra_id where k.estado = 'rascunho'
    union all
    -- Ficha aguardando liberação
    select 'ficha:' || f.id, 'documento', 3, 'Ficha de execução aguardando liberação', s.nome || ' · revisão ' || f.revisao,
           '/obras/' || f.obra_id || '?aba=fichas', (f.criado_em at time zone 'America/Sao_Paulo')::date, o.nome
    from ficha f join servico s on s.id = f.servico_id join obra o on o.id = f.obra_id where f.estado = 'rascunho'
    union all
    -- Dados da empresa para documentos oficiais
    select 'empresa:registro', 'documento', 3, 'Conferir o registro profissional', coalesce(e.registro_profissional, 'CREA') || ' ainda não conferido',
           '/configuracoes', null::date, null
    from empresa e where not e.registro_conferido and eh_admin()
    union all
    select 'empresa:cnpj', 'documento', 3, 'Completar CNPJ e endereço da empresa', 'Aparecem como “[a definir]” em contratos', '/configuracoes', null::date, null
    from empresa e where (e.cnpj is null or e.endereco is null) and eh_admin()
  )
  select i.* from itens i
  where not exists (select 1 from aviso_dispensado a where a.usuario_id = auth.uid() and a.chave = i.chave
                    and (a.ate is null or a.ate >= (select d from hoje)))
  order by i.prioridade, i.data nulls last
$$;

-- ---------------------------------------------------------------------
-- Relatório da obra
-- ---------------------------------------------------------------------
alter table public.obra add column pontos_melhoria text;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['nota_fiscal', 'nota_item'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
  end loop;
  foreach t in array array['nota_fiscal', 'nota_item', 'aviso_dispensado'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Notas: só quem tem financeiro (dados fiscais nunca vão ao cliente nem ao campo).
grant select, insert, update on public.nota_fiscal to authenticated;
grant select, insert, update, delete on public.nota_item to authenticated;
create policy nota_ler on public.nota_fiscal for select to authenticated using (tem_financeiro());
create policy nota_incluir on public.nota_fiscal for insert to authenticated with check (tem_financeiro() and estado = 'rascunho' and lancamento_id is null);
create policy nota_editar on public.nota_fiscal for update to authenticated using (tem_financeiro())
  with check (tem_financeiro() and (estado <> 'confirmada' or lancamento_id is not null));
create policy nota_item_tudo on public.nota_item for all to authenticated using (tem_financeiro()) with check (tem_financeiro());
grant select, insert, update, delete on public.aviso_dispensado to authenticated;
create policy aviso_proprio on public.aviso_dispensado for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

grant execute on function
  public.notas_semelhantes(text, text, text, text, numeric, date), public.confirmar_nota(uuid, uuid, uuid, date),
  public.central_pendencias()
to authenticated;
