-- A receber nasce no aceite do cliente (2026-11-21).
--  * Quando o cliente aceita um orçamento (ou aditivo), o valor já entra em "a receber",
--    com as parcelas das condições aprovadas. Não depende de gerar contrato: o contrato é opcional.
--  * Por baixo, é a mesma conversão de antes (converter_proposta): a obra/serviço nasce com
--    status 'aprovada', com os serviços, as etapas e o lançamento a receber.
--  * Se algo der errado na conversão, o aceite do cliente continua valendo; fica um registro
--    e o botão de conversão manual segue disponível.
--  * Os orçamentos já aceitos e ainda sem a receber entram agora (retroativo), sem duplicar.

-- 0. A conferência "parcelas somam o total" também roda quando quem aceita é o cliente (sem login).
alter function public.parcelas_somam_total() security definer;
alter function public.parcelas_somam_total() set search_path = public;

-- 1. Núcleo da conversão sem a checagem de usuário (só chamado por dentro do banco).
create or replace function public.converter_proposta_aceite(p_versao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v proposta_versao; p proposta; v_obra uuid; v_amb uuid; v_serv uuid; a jsonb; i jsonb; et jsonb; mt jsonb; pc jsonb;
  v_ordem int := 0; v_total numeric; v_modelo modelo_servico; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cat uuid; v_lanc uuid; v_n int; v_data date; v_novo boolean := false; v_grupo text; v_prazo int;
begin
  select * into v from proposta_versao where id = p_versao;
  select * into p from proposta where id = v.proposta_id for update;
  if p.id is null then raise exception 'Proposta não encontrada.'; end if;
  if p.versao_aprovada_id is distinct from v.id then raise exception 'Só a versão aprovada pelo cliente pode ser convertida.'; end if;

  if p.tipo = 'proposta' then
    select id into v_obra from obra where proposta_versao_id = v.id;
    if v_obra is not null then return v_obra; end if;
    if p.obra_id is not null then
      update obra set proposta_versao_id = v.id where id = p.obra_id and proposta_versao_id is null returning id into v_obra;
      if v_obra is null then raise exception 'A obra ligada a esta proposta já tem outra proposta de origem.'; end if;
    else
      insert into obra (nome, cliente_id, endereco, status, proposta_versao_id, tipo_servico)
      values (p.titulo, p.pessoa_id, nullif(v.conteudo->>'local', ''), 'aprovada', v.id,
              (select m.grupo from jsonb_array_elements(coalesce(v.conteudo->'ambientes', '[]')) aa, jsonb_array_elements(coalesce(aa->'itens', '[]')) ii
               join modelo_servico m on m.id::text = ii->>'modelo_id' limit 1))
      returning id into v_obra;
      update proposta set obra_id = v_obra where id = p.id;
    end if;
    v_novo := true;
  else
    v_obra := p.obra_id;
    if exists (select 1 from servico where origem_versao_id = v.id) then return v_obra; end if;
  end if;

  select coalesce(max(ordem), 0) into v_ordem from servico where obra_id = v_obra;
  v_total := nullif(v.valor_total, 0);
  for a in select * from jsonb_array_elements(coalesce(v.conteudo->'ambientes', '[]')) loop
    v_amb := null;
    if coalesce(trim(a->>'nome'), '') <> '' then
      select id into v_amb from ambiente where obra_id = v_obra and lower(nome) = lower(trim(a->>'nome'));
      if v_amb is null then
        insert into ambiente (obra_id, nome, ordem) values (v_obra, trim(a->>'nome'), (select count(*) from ambiente where obra_id = v_obra))
        returning id into v_amb;
      end if;
    end if;
    for i in select * from jsonb_array_elements(coalesce(a->'itens', '[]')) loop
      v_ordem := v_ordem + 1;
      v_modelo := null;
      select * into v_modelo from modelo_servico where id::text = i->>'modelo_id';
      insert into servico (obra_id, nome, descricao, ordem, quantidade, unidade, modelo_id, peso, origem_versao_id, origem_item_id)
      values (v_obra, coalesce(nullif(trim(i->>'titulo'), ''), 'Serviço'), nullif(i->>'descricao', ''), v_ordem, nullif(i->>'quantidade', '')::numeric, i->>'unidade', v_modelo.id,
              coalesce(round((i->>'total')::numeric * 100 / v_total, 2), 1), v.id, coalesce(i->>'id', gen_random_uuid()::text))
      returning id into v_serv;
      if v_amb is not null then insert into servico_ambiente values (v_serv, v_amb); end if;
      -- Orçamento-base: o vendido vem da proposta; previstos ficam para o Rhuann revisar.
      insert into servico_financeiro (servico_id, valor_vendido) values (v_serv, coalesce((i->>'total')::numeric, 0));
      -- Etapas: as da própria proposta (orçamento automático, com duração), senão as do modelo, senão uma única.
      if jsonb_array_length(coalesce(i->'etapas', '[]')) > 0 then
        v_n := 0;
        for et in select * from jsonb_array_elements(i->'etapas') loop
          v_n := v_n + 1;
          insert into etapa (obra_id, servico_id, nome, descricao, ordem, peso, duracao_dias, criterios)
          values (v_obra, v_serv, et->>'nome', nullif(et->>'descricao', ''), v_n,
                  coalesce(nullif(nullif(et->>'percentual', '')::numeric, 0), 5),
                  nullif(et->>'duracao_dias', '')::int,
                  case when v_n = jsonb_array_length(i->'etapas') and v_modelo.id is not null then v_modelo.criterios else '{}' end);
        end loop;
      elsif v_modelo.id is not null and jsonb_array_length(v_modelo.etapas) > 0 then
        v_n := 0;
        for et in select * from jsonb_array_elements(v_modelo.etapas) loop
          v_n := v_n + 1;
          insert into etapa (obra_id, servico_id, nome, descricao, ordem, peso, criterios)
          values (v_obra, v_serv, et->>'nome', nullif(et->>'descricao', ''), v_n,
                  coalesce(nullif(et->>'percentual', '')::numeric, 1),
                  case when v_n = jsonb_array_length(v_modelo.etapas) then v_modelo.criterios else '{}' end);
        end loop;
      else
        insert into etapa (obra_id, servico_id, nome, ordem) values (v_obra, v_serv, 'Execução', 1);
      end if;
      -- Materiais sugeridos (quantidade a definir; responsável de compra a confirmar).
      if v_modelo.id is not null then
        for mt in select * from jsonb_array_elements(v_modelo.materiais) loop
          insert into material (obra_id, servico_id, ambiente_id, descricao, unidade, quantidade, observacoes)
          values (v_obra, v_serv, v_amb, mt->>'descricao', coalesce(mt->>'unidade', 'un'),
                  case when nullif(mt->>'por_unidade', '') is not null and nullif(i->>'quantidade', '') is not null
                       then round((mt->>'por_unidade')::numeric * (i->>'quantidade')::numeric, 3) end,
                  'Sugerido pela biblioteca: confira quantidade e quem compra.');
        end loop;
      end if;
    end loop;
  end loop;

  -- Financeiro da obra e previsão de recebimentos conforme as condições aprovadas.
  if v_novo then
    insert into obra_financeiro (obra_id, modelo_contratacao, valor_contratado, data_contratacao)
    values (v_obra, 'preco_fechado', v.valor_total, (p.aprovada_em at time zone 'America/Sao_Paulo')::date)
    on conflict (obra_id) do nothing;
  end if;
  v_grupo := (select m.grupo from servico s join modelo_servico m on m.id = s.modelo_id where s.origem_versao_id = v.id limit 1);
  select id into v_cat from categoria where tipo = 'receber' and ativo and natureza = 'receita_servico'
    and nome = case when v_grupo in ('Projetos', 'Diagnóstico') or v_grupo ilike 'projeto%' then 'Honorários de projeto'
                when v_grupo ilike 'gest%' then 'Gestão e acompanhamento' else 'Execução de obra / reforma' end;
  if v_cat is null then select id into v_cat from categoria where tipo = 'receber' and natureza = 'receita_servico' and ativo order by ordem limit 1; end if;
  if v.valor_total > 0 and v_cat is not null
     and not exists (select 1 from lancamento where obra_id = v_obra and tipo = 'receber' and documento_ref = 'proposta:' || v.id::text) then
    insert into lancamento (tipo, descricao, pessoa_id, categoria_id, escopo, obra_id, valor_total, data_competencia, documento_ref, observacoes)
    values ('receber', p.codigo || ' · ' || p.titulo, p.pessoa_id, v_cat, 'obra', v_obra, v.valor_total,
            (p.aprovada_em at time zone 'America/Sao_Paulo')::date, 'proposta:' || v.id::text,
            'Previsão criada a partir das condições da proposta aprovada. Confira as datas de vencimento.')
    returning id into v_lanc;
    v_n := 0;
    -- Parcelas das condições aprovadas; se não somarem o total, uma parcela única (para conferir).
    if jsonb_array_length(coalesce(v.conteudo->'pagamento'->'parcelas', '[]')) > 0
       and (select coalesce(sum(nullif(x->>'valor', '')::numeric), 0) from jsonb_array_elements(v.conteudo->'pagamento'->'parcelas') x) = v.valor_total then
      for pc in select * from jsonb_array_elements(v.conteudo->'pagamento'->'parcelas') loop
        v_data := v_hoje + v_n * 30;
        v_n := v_n + 1;
        insert into parcela (lancamento_id, numero, valor, vencimento) values (v_lanc, v_n, (pc->>'valor')::numeric, v_data);
      end loop;
    else
      insert into parcela (lancamento_id, numero, valor, vencimento) values (v_lanc, 1, v.valor_total, v_hoje);
    end if;
  end if;

  if p.tipo = 'aditivo' then
    v_prazo := nullif(v.conteudo->>'impacto_prazo_dias', '')::int;
    if v_prazo is not null then
      update obra set data_previsao_fim = data_previsao_fim + v_prazo where id = v_obra and data_previsao_fim is not null;
    end if;
    insert into registro (obra_id, tipo, titulo, texto)
    values (v_obra, 'sistema', 'Aditivo incorporado', p.codigo || ' v' || v.numero || ' · ' || p.titulo
            || coalesce(' · impacto no prazo: ' || v_prazo || ' dia(s)', '') || '. O contrato original foi preservado.');
  else
    insert into registro (obra_id, tipo, titulo, texto)
    values (v_obra, 'sistema', 'Obra criada a partir da proposta', p.codigo || ' v' || v.numero || ' aprovada por ' || coalesce(p.aprovada_por_nome, 'cliente') || '.');
  end if;
  return v_obra;
end $$;
revoke execute on function public.converter_proposta_aceite(uuid) from public, anon, authenticated;

-- 2. O botão "Converter" continua igual para a equipe: confere a permissão e usa o núcleo.
create or replace function public.converter_proposta(p_versao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  return converter_proposta_aceite(p_versao);
end $$;
grant execute on function public.converter_proposta(uuid) to authenticated;

-- 3. Já há a receber para este orçamento? Evita duplicar o que foi lançado à mão.
create or replace function public.proposta_ja_tem_receber(p_proposta uuid, p_versao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from lancamento l where l.tipo = 'receber' and l.documento_ref = 'proposta:' || p_versao::text)
      or exists (
        select 1 from proposta p join proposta_versao v on v.id = p_versao
        where p.id = p_proposta and p.tipo = 'proposta' and (
          -- obra já existente ligada à proposta e que já tem a receber
          (p.obra_id is not null and exists (select 1 from lancamento l where l.obra_id = p.obra_id and l.tipo = 'receber' and not l.cancelado))
          -- ou um a receber do mesmo cliente com o mesmo valor (lançado à mão)
          or exists (select 1 from lancamento l where l.tipo = 'receber' and not l.cancelado
                     and l.pessoa_id = p.pessoa_id and l.valor_total = v.valor_total)))
$$;
revoke execute on function public.proposta_ja_tem_receber(uuid, uuid) from public, anon, authenticated;

-- 4. Lança o a receber de uma proposta aprovada, sem nunca derrubar quem chamou.
create or replace function public.lancar_receber_do_aceite(p_proposta uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p proposta; v_obra uuid;
begin
  select * into p from proposta where id = p_proposta;
  if p.id is null or p.versao_aprovada_id is null or p.estado <> 'aprovada' then return null; end if;
  if p.tipo = 'aditivo' and p.obra_id is null then return null; end if;
  if proposta_ja_tem_receber(p.id, p.versao_aprovada_id) then return null; end if;
  if p.tipo = 'proposta' and exists (select 1 from obra where proposta_versao_id = p.versao_aprovada_id) then return null; end if;
  if p.tipo = 'aditivo' and exists (select 1 from servico where origem_versao_id = p.versao_aprovada_id) then return null; end if;
  begin
    v_obra := converter_proposta_aceite(p.versao_aprovada_id);
    -- Confere já (e não no fim da transação) que as parcelas somam o total: se falhar, cai aqui e o aceite segue.
    set constraints public.lancamento_soma, public.parcela_soma immediate;
    set constraints public.lancamento_soma, public.parcela_soma deferred;
  exception when others then
    raise warning 'A receber do aceite da proposta % não foi lançado: %', p.codigo, sqlerrm;
    return null;
  end;
  return v_obra;
end $$;
revoke execute on function public.lancar_receber_do_aceite(uuid) from public, anon, authenticated;

-- 5. Gatilho: no momento do aceite (pelo link do cliente ou registrado no escritório).
create or replace function public.proposta_aceita_lanca_receber()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform lancar_receber_do_aceite(new.id);
  return new;
end $$;
drop trigger if exists proposta_aceita_receber on public.proposta;
create trigger proposta_aceita_receber after update of versao_aprovada_id, estado on public.proposta
  for each row when (new.estado = 'aprovada' and new.versao_aprovada_id is not null
                     and (old.versao_aprovada_id is distinct from new.versao_aprovada_id or old.estado is distinct from new.estado))
  execute function public.proposta_aceita_lanca_receber();

-- 6. Retroativo: orçamentos já aceitos que ainda não viraram a receber (originais antes dos aditivos).
do $$
declare r record;
begin
  for r in select id from proposta where estado = 'aprovada' and versao_aprovada_id is not null
           order by (tipo = 'aditivo'), aprovada_em loop
    perform lancar_receber_do_aceite(r.id);
  end loop;
end $$;
