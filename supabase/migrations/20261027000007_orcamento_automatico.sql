-- Orçamento automático (2026-10-27)
-- 1. Tabela de preços do orçamento automático, por tipo de serviço (equipe administrativa).
--    Custos de referência ficam juntos porque entram no preço (custo × BDI); a análise de margem
--    só aparece na tela para quem tem financeiro.
-- 2. Perícia entra na biblioteca de serviços (laudo já existia).
-- 3. Converter proposta em obra passa a usar as etapas e durações da própria proposta,
--    para o cronograma nascer pronto para programar.

create table public.orcamento_parametro (
  tipo text primary key check (tipo in ('projeto_estrutural', 'reforco', 'reforma', 'construcao', 'laudo', 'pericia')),
  valores jsonb not null default '{}' check (jsonb_typeof(valores) = 'object'),
  atualizado_em timestamptz not null default now()
);
insert into public.orcamento_parametro (tipo) values ('projeto_estrutural'), ('reforco'), ('reforma'), ('construcao'), ('laudo'), ('pericia');

create trigger orcamento_parametro_atualizado before update on public.orcamento_parametro
  for each row execute function public.tocar_atualizado_em();
create trigger orcamento_parametro_auditoria after insert or update or delete on public.orcamento_parametro
  for each row execute function public.auditar();

alter table public.orcamento_parametro enable row level security;
alter table public.orcamento_parametro force row level security;
revoke all on public.orcamento_parametro from anon, authenticated;
grant select, update on public.orcamento_parametro to authenticated;
create policy op_ler on public.orcamento_parametro for select to authenticated using (eh_equipe_adm());
create policy op_editar on public.orcamento_parametro for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

insert into public.modelo_servico (ordem, nome, grupo, unidade, modelo_preco, palavras_chave, descricao_cliente, inclusoes, exclusoes, responsabilidades, etapas, perguntas, premissas, pontos_conferir) values
(35, 'Perícia técnica de engenharia', 'Diagnóstico', 'vb', 'fixo',
 array['perícia','pericia','perito','assistente técnico','assistente tecnico','processo','quesitos','vício construtivo','vicio construtivo','danos de vizinhança'],
 'Perícia de engenharia judicial ou extrajudicial, ou assistência técnica a uma das partes, com análise de documentos, vistorias, resposta a quesitos e laudo ou parecer conforme a ABNT NBR 13752.',
 array['Análise dos autos e documentos','Vistorias técnicas com registro','Resposta aos quesitos','Laudo ou parecer técnico','ART'],
 array['Ensaios de laboratório','Custas processuais','Horas além das estimadas (com aviso prévio)'],
 '[{"parte":"ROSAE","itens":["Atuar com técnica, ética e sigilo","Cumprir os prazos combinados"]},{"parte":"Cliente","itens":["Fornecer cópia integral dos autos","Garantir acesso ao local nas diligências"]}]',
 '[{"nome":"Análise documental","descricao":"Leitura dos autos e plano de trabalho","percentual":20},{"nome":"Diligências","descricao":"Vistorias técnicas","percentual":30},{"nome":"Laudo / parecer","descricao":"Análise, quesitos e entrega","percentual":50}]',
 '[{"texto":"Qual o número do processo e a vara?"},{"texto":"Quantos quesitos e quais os prazos?"},{"texto":"Atuação como perito do juízo ou assistente de qual parte?"}]',
 array['Acesso integral aos autos'], array['Conferir impedimentos e conflito de interesse'])
on conflict (nome) do nothing;

create or replace function public.converter_proposta(p_versao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v proposta_versao; p proposta; v_obra uuid; v_amb uuid; v_serv uuid; a jsonb; i jsonb; et jsonb; mt jsonb; pc jsonb;
  v_ordem int := 0; v_total numeric; v_modelo modelo_servico; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cat uuid; v_lanc uuid; v_n int; v_data date; v_novo boolean := false; v_grupo text; v_prazo int;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
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
      values (v_obra, i->>'titulo', nullif(i->>'descricao', ''), v_ordem, nullif(i->>'quantidade', '')::numeric, i->>'unidade', v_modelo.id,
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
    if jsonb_array_length(coalesce(v.conteudo->'pagamento'->'parcelas', '[]')) > 0 then
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
