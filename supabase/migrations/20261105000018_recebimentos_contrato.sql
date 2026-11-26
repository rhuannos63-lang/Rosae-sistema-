-- Fechado × recebido por contrato, recebimento livre e aditivo rápido.
--
-- O aceite da proposta nunca lança dinheiro como recebido: ele só cria a PREVISÃO (contas a receber
-- com as parcelas da proposta). Recebido é sempre um movimento real, registrado por quem recebeu.
-- Como na negociação a forma de pagamento muda, o recebimento aqui é livre: valor e data quaisquer.
-- O sistema abate das parcelas previstas em aberto, da mais antiga para a mais nova; o que passar
-- do previsto vira um recebimento extra do mesmo contrato (o caixa nunca fica errado).

-- Lista de contratos: orçamentos aceitos (com ou sem obra) e obras lançadas sem proposta.
create or replace function public.contratos_recebimentos()
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'data_fechamento') desc nulls last, x->>'codigo') from (
    select jsonb_build_object(
      'proposta_id', p.id, 'codigo', p.codigo, 'titulo', p.titulo, 'cliente', pe.nome,
      'obra_id', ob.id, 'obra_codigo', o.codigo, 'obra_nome', o.nome,
      'data_fechamento', (p.aprovada_em at time zone 'America/Sao_Paulo')::date,
      'valor_orcamento', v.valor_total,
      'aditivos', coalesce(ad.total, 0),
      'fechado', v.valor_total + coalesce(ad.total, 0),
      'recebido', coalesce(r.recebido, 0),
      'falta_receber', greatest(v.valor_total + coalesce(ad.total, 0) - coalesce(r.recebido, 0), 0),
      'previsto_aberto', coalesce(r.saldo, 0),
      'previsto_vencido', coalesce(r.vencido, 0),
      'ultimo_recebimento', r.ultimo) as x
    from proposta p
    join proposta_versao v on v.id = p.versao_aprovada_id
    left join pessoa pe on pe.id = p.pessoa_id
    left join lateral (select obra_da_proposta(p.id) as id) ob on true
    left join obra o on o.id = ob.id
    left join lateral (
      select sum(va.valor_total) as total from proposta a join proposta_versao va on va.id = a.versao_aprovada_id
      where a.estado = 'aprovada' and a.tipo = 'aditivo' and (a.proposta_origem_id = p.id)) ad on true
    left join lateral (
      select sum(pago) as recebido, sum(saldo) as saldo, sum(saldo) filter (where situacao = 'vencida') as vencido, max(ultima_liquidacao) as ultimo
      from v_parcela where ob.id is not null and obra_id = ob.id and tipo = 'receber' and not cancelado) r on true
    where p.tipo = 'proposta' and p.estado = 'aprovada' and (o.id is null or o.status <> 'cancelada')
    union all
    select jsonb_build_object(
      'proposta_id', null, 'codigo', o.codigo, 'titulo', o.nome, 'cliente', pe.nome,
      'obra_id', o.id, 'obra_codigo', o.codigo, 'obra_nome', o.nome,
      'data_fechamento', f.data_contratacao,
      'valor_orcamento', f.valor_contratado,
      'aditivos', coalesce(ad.total, 0),
      'fechado', coalesce(f.valor_contratado, 0) + coalesce(ad.total, 0),
      'recebido', coalesce(r.recebido, 0),
      'falta_receber', greatest(coalesce(f.valor_contratado, 0) + coalesce(ad.total, 0) - coalesce(r.recebido, 0), 0),
      'previsto_aberto', coalesce(r.saldo, 0),
      'previsto_vencido', coalesce(r.vencido, 0),
      'ultimo_recebimento', r.ultimo)
    from obra o
    join obra_financeiro f on f.obra_id = o.id
    left join pessoa pe on pe.id = o.cliente_id
    left join lateral (
      select sum(va.valor_total) as total from proposta a join proposta_versao va on va.id = a.versao_aprovada_id
      where a.estado = 'aprovada' and a.tipo = 'aditivo' and a.obra_id = o.id) ad on true
    left join lateral (
      select sum(pago) as recebido, sum(saldo) as saldo, sum(saldo) filter (where situacao = 'vencida') as vencido, max(ultima_liquidacao) as ultimo
      from v_parcela where obra_id = o.id and tipo = 'receber' and not cancelado) r on true
    where o.proposta_versao_id is null and o.status <> 'cancelada' and coalesce(f.valor_contratado, 0) > 0
      and not exists (select 1 from proposta x where x.obra_id = o.id and x.tipo = 'proposta' and x.estado = 'aprovada')
  ) s), '[]'::jsonb);
end $$;
grant execute on function public.contratos_recebimentos() to authenticated;

-- Registra o que de fato entrou de um contrato, com valor e data livres.
-- p_proposta: orçamento aceito (se ainda não virou obra, vira agora, com os aditivos aceitos);
-- p_obra: obra (para obras sem proposta). A chave evita duplicar em clique duplo ou nova tentativa.
create or replace function public.registrar_recebimento_contrato(
  p_proposta uuid, p_obra uuid, p_conta uuid, p_valor numeric, p_data date, p_descricao text, p_chave text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_obra uuid; v_conta uuid; v_rest numeric(14,2); v_parte numeric(14,2); v_n int := 0; v_criou boolean := false;
  v_vid uuid; v_cat uuid; v_lanc uuid; v_extra numeric(14,2) := 0; v_desc text := nullif(trim(coalesce(p_descricao, '')), '');
  o obra; pc record; a record;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor recebido.'; end if;
  if p_data is null then raise exception 'Informe a data em que o dinheiro entrou.'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data do recebimento não pode ser no futuro. Para o que ainda vai entrar, use a previsão.'; end if;
  if coalesce(trim(p_chave), '') = '' then raise exception 'Envio sem chave. Recarregue a página e tente de novo.'; end if;

  -- Repetição do mesmo envio: não duplica.
  select pa.lancamento_id into v_lanc from movimento m join parcela pa on pa.id = m.parcela_id
  where left(m.chave_idempotencia, length(p_chave) + 1) = p_chave || ':' limit 1;
  if v_lanc is not null then
    return jsonb_build_object('repetido', true, 'obra_id', (select obra_id from lancamento where id = v_lanc));
  end if;

  v_obra := coalesce(p_obra, case when p_proposta is not null then obra_da_proposta(p_proposta) end);
  if v_obra is null then
    if p_proposta is null then raise exception 'Escolha o contrato.'; end if;
    select versao_aprovada_id into v_vid from proposta where id = p_proposta and tipo = 'proposta' and estado = 'aprovada';
    if v_vid is null then raise exception 'Só orçamento aceito pelo cliente recebe pagamento.'; end if;
    -- O dinheiro fica guardado na obra: o orçamento aceito vira obra agora, com os aditivos aceitos.
    v_obra := converter_proposta(v_vid);
    for a in select versao_aprovada_id from proposta where proposta_origem_id = p_proposta and estado = 'aprovada' and versao_aprovada_id is not null loop
      perform converter_proposta(a.versao_aprovada_id);
    end loop;
    v_criou := true;
  end if;
  select * into o from obra where id = v_obra;
  if o.id is null then raise exception 'Obra não encontrada.'; end if;

  v_conta := coalesce(p_conta, (select id from conta_bancaria where ativa order by ordem, nome limit 1));
  if v_conta is null then raise exception 'Cadastre uma conta bancária em Financeiro → Contas bancárias.'; end if;

  -- Abate das parcelas previstas em aberto, da mais antiga para a mais nova.
  v_rest := round(p_valor, 2);
  for pc in
    select vp.id, vp.saldo from v_parcela vp
    where vp.obra_id = v_obra and vp.tipo = 'receber' and not vp.cancelado and vp.saldo > 0
    order by vp.vencimento, vp.numero
  loop
    exit when v_rest <= 0;
    v_parte := least(v_rest, pc.saldo);
    v_n := v_n + 1;
    insert into movimento (conta_bancaria_id, natureza, valor, data, parcela_id, descricao, chave_idempotencia)
    values (v_conta, 'entrada', v_parte, p_data, pc.id, v_desc, p_chave || ':' || v_n);
    v_rest := v_rest - v_parte;
  end loop;

  -- Recebeu mais do que estava previsto: entra como recebimento extra do mesmo contrato.
  if v_rest > 0 then
    v_extra := v_rest;
    select id into v_cat from categoria where tipo = 'receber' and ativo and natureza = 'receita_servico' order by ordem limit 1;
    if v_cat is null then raise exception 'Falta uma categoria de receita de serviço ativa.'; end if;
    insert into lancamento (tipo, descricao, pessoa_id, categoria_id, escopo, obra_id, valor_total, data_competencia, documento_ref, observacoes)
    values ('receber', 'Recebimento além do previsto · ' || o.nome, o.cliente_id, v_cat, 'obra', v_obra, v_extra, p_data,
            'recebimento:' || p_chave, 'Valor recebido acima das parcelas previstas deste contrato.')
    returning id into v_lanc;
    insert into parcela (lancamento_id, numero, valor, vencimento) values (v_lanc, 1, v_extra, p_data);
    v_n := v_n + 1;
    insert into movimento (conta_bancaria_id, natureza, valor, data, parcela_id, descricao, chave_idempotencia)
    values (v_conta, 'entrada', v_extra, p_data, (select id from parcela where lancamento_id = v_lanc), v_desc, p_chave || ':' || v_n);
  end if;

  return jsonb_build_object('obra_id', v_obra, 'partes', v_n, 'extra', v_extra, 'obra_criada', v_criou);
end $$;
grant execute on function public.registrar_recebimento_contrato(uuid, uuid, uuid, numeric, date, text, text) to authenticated;

-- Aditivo rápido: título, valor, prazo e pagamento num passo só. Pode já sair emitido,
-- pronto para ir ao cliente por e-mail (o aceite pelo link formaliza).
-- p_origem: orçamento aceito; ou p_obra: obra (usa o orçamento de origem dela quando houver).
create or replace function public.criar_aditivo_rapido(
  p_origem uuid, p_obra uuid, p_titulo text, p_motivo text, p_descricao text, p_valor numeric,
  p_prazo_dias int default 0, p_pagamento text default null, p_emitir boolean default true)
returns uuid language plpgsql set search_path = public as $$
declare
  v_id uuid; v_ver uuid; v_origem uuid := p_origem; o obra; v_valor numeric(14,2) := round(coalesce(p_valor, 0), 2);
  v_prazo int := coalesce(p_prazo_dias, 0); v_pag text := nullif(trim(coalesce(p_pagamento, '')), '');
  v_item text := 'i' || replace(gen_random_uuid()::text, '-', '');
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_titulo), '') = '' then raise exception 'Diga o que está sendo acrescentado.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do aditivo.'; end if;
  if v_valor < 0 or (v_valor = 0 and p_emitir) then raise exception 'Informe o valor do aditivo.'; end if;
  if v_prazo < 0 then raise exception 'O acréscimo de prazo não pode ser negativo.'; end if;

  if v_origem is null and p_obra is not null then
    select * into o from obra where id = p_obra;
    if o.id is null then raise exception 'Obra não encontrada.'; end if;
    v_origem := (select proposta_id from proposta_versao where id = o.proposta_versao_id);
  end if;

  if v_origem is not null then
    v_id := criar_aditivo(v_origem, p_titulo, p_motivo);
  else
    if o.id is null then raise exception 'Escolha o orçamento aceito ou a obra.'; end if;
    if o.cliente_id is null then raise exception 'Defina o cliente da obra antes de criar um aditivo.'; end if;
    insert into proposta (tipo, pessoa_id, obra_id, titulo) values ('aditivo', o.cliente_id, o.id, trim(p_titulo)) returning id into v_id;
    insert into proposta_versao (proposta_id, numero, conteudo, valor_total)
    values (v_id, 1, jsonb_build_object('local', o.endereco, 'validade_dias', 15,
      'apresentacao', 'Este aditivo complementa o contrato da obra ' || o.nome || '. Ele acrescenta os serviços descritos abaixo, com preço e condições próprios. O contrato original continua valendo em todas as demais condições.'), 0);
  end if;

  select id into v_ver from proposta_versao where proposta_id = v_id order by numero desc limit 1;
  -- Sem valor (rascunho para detalhar os itens no editor): guarda só motivo e prazo.
  if v_valor = 0 then
    update proposta_versao set conteudo = conteudo || jsonb_build_object('motivo', trim(p_motivo), 'impacto_prazo_dias', v_prazo,
      'prazo_texto', case when v_prazo > 0 then 'Acrescenta ' || v_prazo || ' dia(s) ao prazo da obra.' else 'Executado dentro do prazo atual da obra.' end)
    where id = v_ver;
    return v_id;
  end if;
  update proposta_versao set valor_total = v_valor, conteudo = conteudo || jsonb_build_object(
      'motivo', trim(p_motivo),
      'impacto_prazo_dias', v_prazo,
      'prazo_texto', case when v_prazo > 0 then 'Acrescenta ' || v_prazo || ' dia(s) ao prazo da obra.' else 'Executado dentro do prazo atual da obra.' end,
      'ambientes', jsonb_build_array(jsonb_build_object('id', 'a' || substr(v_item, 2, 12), 'nome', 'Aditivo', 'itens', jsonb_build_array(jsonb_build_object(
        'id', v_item, 'titulo', trim(p_titulo), 'descricao', nullif(trim(coalesce(p_descricao, '')), ''),
        'unidade', 'vb', 'quantidade', 1, 'preco_unitario', v_valor, 'fator', 1, 'total', v_valor)))),
      'inclusoes', case when nullif(trim(coalesce(p_descricao, '')), '') is null then '[]'::jsonb else jsonb_build_array(trim(p_descricao)) end,
      'pagamento', jsonb_build_object('descricao', coalesce(v_pag, 'Pagamento do aditivo'),
        'parcelas', jsonb_build_array(jsonb_build_object('descricao', coalesce(v_pag, 'Na aprovação do aditivo'), 'valor', v_valor))))
  where id = v_ver;

  if p_emitir then perform emitir_versao(v_ver); end if;
  return v_id;
end $$;
grant execute on function public.criar_aditivo_rapido(uuid, uuid, text, text, text, numeric, int, text, boolean) to authenticated;
