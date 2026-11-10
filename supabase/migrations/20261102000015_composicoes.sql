-- Composição de custos (2026-11-02): base própria de insumos (material, mão de obra e
-- equipamento) e composições de serviço com coeficientes e metodologia, editável.
-- Preços e coeficientes iniciais são referências aproximadas no estilo SINAPI (RJ), em três
-- padrões de acabamento (básico, médio e premium), para o Rhuann conferir e ajustar. Quem tem financeiro edita; a equipe administrativa lê
-- as composições (sem preço). Na obra aceita, a composição da proposta gera a lista de
-- compras dos materiais, com as quantidades para conferir.

create table public.insumo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (length(trim(codigo)) > 0),
  nome text not null check (length(trim(nome)) > 0),
  tipo text not null check (tipo in ('material', 'mao_de_obra', 'equipamento')),
  unidade text not null check (length(trim(unidade)) > 0),
  -- Preço por padrão de acabamento: básico, médio (preco) e premium. Material comum e
  -- estrutural custa igual nos três; acabamento e mão de obra especializada mudam.
  preco_basico numeric(14,4) not null default 0 check (preco_basico >= 0),
  preco numeric(14,4) not null default 0 check (preco >= 0),
  preco_premium numeric(14,4) not null default 0 check (preco_premium >= 0),
  compra_unidade text,
  compra_fator numeric(14,4) check (compra_fator is null or compra_fator > 0),
  referencia text not null default 'Referência ROSAE (aproximação SINAPI RJ)',
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table public.composicao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (length(trim(codigo)) > 0),
  nome text not null check (length(trim(nome)) > 0),
  unidade text not null check (length(trim(unidade)) > 0),
  grupo text not null default 'Geral',
  metodologia text,
  palavras_chave text[] not null default '{}',
  -- Serviço de acabamento: o padrão (básico, médio, premium) muda preços e o tempo de mão de obra.
  varia_padrao boolean not null default false,
  fator_mo_basico numeric(6,3) not null default 0.9 check (fator_mo_basico > 0),
  fator_mo_premium numeric(6,3) not null default 1.25 check (fator_mo_premium > 0),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table public.composicao_item (
  composicao_id uuid not null references public.composicao (id) on delete cascade,
  insumo_id uuid not null references public.insumo (id) on delete restrict,
  coeficiente numeric(14,6) not null check (coeficiente > 0),
  primary key (composicao_id, insumo_id)
);
create index composicao_item_insumo_idx on public.composicao_item (insumo_id);

create trigger insumo_atualizado before update on public.insumo for each row execute function public.tocar_atualizado_em();
create trigger composicao_atualizado before update on public.composicao for each row execute function public.tocar_atualizado_em();
create trigger insumo_auditoria after insert or update or delete on public.insumo for each row execute function public.auditar();
create trigger composicao_auditoria after insert or update or delete on public.composicao for each row execute function public.auditar();

alter table public.insumo enable row level security;
alter table public.insumo force row level security;
alter table public.composicao enable row level security;
alter table public.composicao force row level security;
alter table public.composicao_item enable row level security;
alter table public.composicao_item force row level security;
revoke all on public.insumo, public.composicao, public.composicao_item from anon, authenticated;
grant select, insert, update, delete on public.insumo, public.composicao, public.composicao_item to authenticated;
create policy insumo_fin on public.insumo for all to authenticated using (tem_financeiro()) with check (tem_financeiro());
create policy composicao_ler on public.composicao for select to authenticated using (eh_equipe_adm());
create policy composicao_fin on public.composicao for insert to authenticated with check (tem_financeiro());
create policy composicao_fin_upd on public.composicao for update to authenticated using (tem_financeiro()) with check (tem_financeiro());
create policy composicao_fin_del on public.composicao for delete to authenticated using (tem_financeiro());
create policy composicao_item_ler on public.composicao_item for select to authenticated using (eh_equipe_adm());
create policy composicao_item_fin on public.composicao_item for insert to authenticated with check (tem_financeiro());
create policy composicao_item_fin_upd on public.composicao_item for update to authenticated using (tem_financeiro()) with check (tem_financeiro());
create policy composicao_item_fin_del on public.composicao_item for delete to authenticated using (tem_financeiro());

-- Material gerado a partir da proposta aprovada (para não gerar duas vezes).
alter table public.material add column if not exists origem_versao_id uuid references public.proposta_versao (id) on delete set null;

/**
 * Lista de compras da obra: soma os materiais de todas as composições ligadas à proposta
 * aprovada (custos->composicoes: [{item_id, composicao_id, quantidade, perda_pct}]),
 * converte para a embalagem de compra (saco, galão, barra…) arredondando para cima e grava
 * como materiais da obra, para o engenheiro conferir antes de comprar. Material de acabamento
 * sai separado por padrão (básico, médio, premium), para comprar a linha certa.
 */
create or replace function public.gerar_lista_compras(p_obra uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_versao uuid; v_n integer;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select proposta_versao_id into v_versao from obra where id = p_obra;
  if v_versao is null then raise exception 'Esta obra não veio de uma proposta aprovada.'; end if;
  if exists (select 1 from material where obra_id = p_obra and origem_versao_id = v_versao and estado = 'ativo') then
    raise exception 'A lista de compras desta proposta já foi gerada. Confira em Materiais.';
  end if;
  with usos as (
    select (u->>'composicao_id')::uuid as composicao_id, nullif(u->>'item_id', '') as item_id,
           greatest(coalesce((u->>'quantidade')::numeric, 0), 0) as qtd,
           greatest(coalesce((u->>'perda_pct')::numeric, 0), 0) as perda,
           coalesce(nullif(u->>'padrao', ''), nullif(pc.custos->>'padrao', ''), 'medio') as padrao
      from proposta_custo pc, jsonb_array_elements(case when jsonb_typeof(pc.custos->'composicoes') = 'array' then pc.custos->'composicoes' else '[]'::jsonb end) u
     where pc.versao_id = v_versao
  ), linhas as (
    select u.*, c.nome as comp_nome, i.id as insumo_id, ci.coeficiente,
           case when c.varia_padrao and u.padrao in ('basico', 'premium')
                     and (i.preco_basico <> i.preco or i.preco_premium <> i.preco) then u.padrao end as padrao_compra
      from usos u
      join composicao c on c.id = u.composicao_id
      join composicao_item ci on ci.composicao_id = c.id
      join insumo i on i.id = ci.insumo_id and i.tipo = 'material'
     where u.qtd > 0
  ), soma as (
    select i.id, i.nome, i.unidade, i.compra_unidade, i.compra_fator,
           l.padrao_compra,
           sum(l.qtd * l.coeficiente * (1 + l.perda / 100)) as qtd,
           string_agg(distinct l.comp_nome, '; ') as para,
           (array_agg(distinct s.id))[1] as servico_id, count(distinct s.id) as n_servicos
      from linhas l
      join insumo i on i.id = l.insumo_id
      left join servico s on s.obra_id = p_obra and s.origem_item_id = l.item_id
     group by i.id, i.nome, i.unidade, i.compra_unidade, i.compra_fator, l.padrao_compra
  )
  insert into material (obra_id, servico_id, descricao, especificacao, unidade, quantidade, responsavel_compra, visivel_cliente, observacoes, origem_versao_id)
  select p_obra, case when n_servicos = 1 then servico_id end,
         nome || case padrao_compra when 'basico' then ' (padrão básico)' when 'premium' then ' (padrão premium)' else '' end,
         'Para: ' || para || case when compra_fator is not null then ' · total ' || replace(round(qtd, 2)::text, '.', ',') || ' ' || unidade else '' end,
         coalesce(compra_unidade, unidade),
         case when compra_fator is not null then ceil(qtd / compra_fator)
              when unidade in ('un', 'kg', 'm', 'L') then ceil(qtd)
              else ceil(qtd * 100) / 100 end,
         'rosae', false,
         'Lista gerada pela composição de custos da proposta aprovada. Confira as quantidades antes de comprar.', v_versao
    from soma where qtd > 0
   order by nome;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.gerar_lista_compras(uuid) from anon, public;
grant execute on function public.gerar_lista_compras(uuid) to authenticated;

insert into public.insumo (codigo, nome, tipo, unidade, preco_basico, preco, preco_premium, compra_unidade, compra_fator) values
('MAT-001', 'Cimento Portland CP-II', 'material', 'kg', 0.85, 0.85, 0.85, 'saco 50 kg', 50),
('MAT-002', 'Areia média lavada', 'material', 'm³', 140.0, 140, 140.0, null, null),
('MAT-003', 'Cal hidratada CH-III', 'material', 'kg', 1.1, 1.1, 1.1, 'saco 20 kg', 20),
('MAT-004', 'Bloco cerâmico de vedação 9x19x19 cm', 'material', 'un', 1.6, 1.6, 1.6, null, null),
('MAT-005', 'Brita 1', 'material', 'm³', 150.0, 150, 150.0, null, null),
('MAT-006', 'Porcelanato 60x60 cm', 'material', 'm²', 42.0, 70, 140.0, null, null),
('MAT-007', 'Revestimento cerâmico de parede', 'material', 'm²', 24.0, 40, 88.0, null, null),
('MAT-008', 'Argamassa colante AC-III', 'material', 'kg', 1.17, 1.3, 1.69, 'saco 20 kg', 20),
('MAT-009', 'Argamassa colante AC-II', 'material', 'kg', 0.81, 0.9, 1.17, 'saco 20 kg', 20),
('MAT-010', 'Rejunte cimentício', 'material', 'kg', 4.2, 6.0, 15.0, 'saco 1 kg', 1),
('MAT-011', 'Massa corrida PVA', 'material', 'kg', 2.24, 2.8, 3.92, 'balde 25 kg', 25),
('MAT-012', 'Lixa para massa', 'material', 'un', 1.2, 1.2, 1.2, null, null),
('MAT-013', 'Tinta acrílica premium', 'material', 'L', 12.1, 22.0, 35.2, 'galão 3,6 L', 3.6),
('MAT-014', 'Selador acrílico', 'material', 'L', 9.6, 12.0, 15.6, 'galão 3,6 L', 3.6),
('MAT-015', 'Concreto usinado fck 25 MPa (bombeável)', 'material', 'm³', 560.0, 560, 560.0, null, null),
('MAT-016', 'Aço CA-50 (barras)', 'material', 'kg', 7.5, 7.5, 7.5, null, null),
('MAT-017', 'Arame recozido 18', 'material', 'kg', 16.0, 16.0, 16.0, null, null),
('MAT-018', 'Chapa de compensado resinado 12 mm', 'material', 'm²', 38.0, 38.0, 38.0, 'chapa 2,2x1,1 m', 2.42),
('MAT-019', 'Sarrafo/pontalete de madeira', 'material', 'm', 6.0, 6.0, 6.0, null, null),
('MAT-020', 'Prego com cabeça', 'material', 'kg', 18.0, 18.0, 18.0, null, null),
('MAT-021', 'Gesso em pó para revestimento', 'material', 'kg', 1.0, 1.0, 1.0, 'saco 40 kg', 40),
('MAT-022', 'Forro de drywall (placa, perfis e fixação)', 'material', 'm²', 38.25, 45.0, 63.0, null, null),
('MAT-023', 'Manta asfáltica 3 mm', 'material', 'm²', 32.3, 38.0, 47.5, 'rolo 10 m²', 10),
('MAT-024', 'Primer asfáltico', 'material', 'L', 18.0, 18.0, 18.0, 'galão 3,6 L', 3.6),
('MAT-025', 'Argamassa polimérica impermeabilizante', 'material', 'kg', 5.1, 6.0, 7.8, 'caixa 18 kg', 18),
('MAT-026', 'Cabo flexível 2,5 mm²', 'material', 'm', 2.88, 3.2, 3.52, 'rolo 100 m', 100),
('MAT-027', 'Eletroduto corrugado 3/4"', 'material', 'm', 2.25, 2.5, 2.75, 'rolo 50 m', 50),
('MAT-028', 'Caixa de luz 4x2"', 'material', 'un', 2.0, 2.0, 2.0, null, null),
('MAT-029', 'Tomada ou interruptor com placa', 'material', 'un', 7.5, 15.0, 45.0, null, null),
('MAT-030', 'Tubo PVC soldável 25 mm', 'material', 'm', 4.5, 5.0, 6.0, 'barra 6 m', 6),
('MAT-031', 'Conexões PVC soldável 25 mm', 'material', 'un', 3.6, 4.0, 4.8, null, null),
('MAT-032', 'Tubo PVC esgoto 40/100 mm', 'material', 'm', 9.0, 10.0, 12.0, 'barra 6 m', 6),
('MAT-033', 'Conexões PVC esgoto', 'material', 'un', 7.2, 8.0, 9.6, null, null),
('MAT-034', 'Manta de fibra de carbono', 'material', 'm²', 420.0, 420.0, 420.0, null, null),
('MAT-035', 'Resina epóxi de saturação', 'material', 'kg', 120.0, 120.0, 120.0, null, null),
('MAT-036', 'Primer epóxi', 'material', 'kg', 110.0, 110.0, 110.0, null, null),
('MAT-037', 'Graute estrutural', 'material', 'kg', 1.5, 1.5, 1.5, 'saco 25 kg', 25),
('MAT-038', 'Telha cerâmica', 'material', 'un', 1.54, 2.2, 3.96, null, null),
('MAT-039', 'Madeiramento de telhado (caibro e ripa)', 'material', 'm', 8.1, 9.0, 10.8, null, null),
('MAT-040', 'Bloco de concreto estrutural 14x19x39 cm', 'material', 'un', 4.2, 4.2, 4.2, null, null),
('MO-001', 'Pedreiro (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-002', 'Servente (com encargos)', 'mao_de_obra', 'h', 18.9, 21.0, 27.3, null, null),
('MO-003', 'Carpinteiro de formas (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-004', 'Armador (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-005', 'Azulejista / ladrilheiro (com encargos)', 'mao_de_obra', 'h', 27.0, 30.0, 39.0, null, null),
('MO-006', 'Pintor (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-007', 'Gesseiro (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-008', 'Eletricista (com encargos)', 'mao_de_obra', 'h', 27.9, 31.0, 40.3, null, null),
('MO-009', 'Encanador (com encargos)', 'mao_de_obra', 'h', 27.9, 31.0, 40.3, null, null),
('MO-010', 'Ajudante de instalações (com encargos)', 'mao_de_obra', 'h', 19.8, 22.0, 28.6, null, null),
('MO-011', 'Impermeabilizador (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-012', 'Aplicador de reforço estrutural', 'mao_de_obra', 'h', 36.0, 40.0, 52.0, null, null),
('MO-013', 'Telhadista (com encargos)', 'mao_de_obra', 'h', 26.1, 29.0, 37.7, null, null),
('MO-020', 'Engenheiro civil (sua hora técnica)', 'mao_de_obra', 'h', 150.0, 150.0, 150.0, null, null),
('EQ-001', 'Vibrador de imersão (uso)', 'equipamento', 'h', 4.0, 4.0, 4.0, null, null),
('EQ-002', 'Escora metálica (locação mensal)', 'equipamento', 'un', 12.0, 12.0, 12.0, null, null),
('EQ-003', 'Betoneira 400 L (uso)', 'equipamento', 'h', 3.5, 3.5, 3.5, null, null)
on conflict (codigo) do nothing;

insert into public.composicao (codigo, nome, unidade, grupo, metodologia, palavras_chave, varia_padrao) values
('CP-001', 'Alvenaria de vedação com bloco cerâmico 9 cm', 'm²', 'Alvenaria', 'Marcação da primeira fiada nivelada, assentamento com argamassa mista 1:2:8 em juntas de 1 cm, amarração nos pilares com tela ou ferro-cabelo e encunhamento só depois de 7 dias.', array['alvenaria', 'parede', 'vedação', 'bloco cerâmico', 'tijolo'], true),
('CP-002', 'Chapisco em parede', 'm²', 'Revestimento', 'Superfície limpa e umedecida; aplicação de argamassa 1:3 de cimento e areia lançada com colher, criando aderência para o reboco. Cura mínima de 3 dias.', array['chapisco'], true),
('CP-003', 'Reboco (massa única) 2 cm em parede', 'm²', 'Revestimento', 'Sobre chapisco curado, execução de mestras e taliscas, aplicação da argamassa mista em camada única de 2 cm, sarrafeamento e desempeno. Aguardar 21 dias antes da pintura.', array['reboco', 'emboço', 'massa única', 'revestimento de parede'], true),
('CP-004', 'Contrapiso 4 cm', 'm²', 'Piso', 'Base limpa, nivelamento por taliscas, argamassa 1:4 de cimento e areia sarrafeada e desempenada. Cura úmida de 3 dias antes do revestimento.', array['contrapiso', 'regularização de piso', 'nivelamento'], true),
('CP-005', 'Piso em porcelanato 60x60 assentado', 'm²', 'Piso', 'Contrapiso curado e limpo, argamassa AC-III com dupla colagem, juntas de 2 mm com espaçadores e nivelador, rejunte após 72 h e limpeza final.', array['porcelanato', 'piso', 'revestimento de piso', 'cerâmica de piso'], true),
('CP-006', 'Revestimento cerâmico de parede assentado', 'm²', 'Revestimento', 'Reboco curado e prumado, argamassa AC-II com desempenadeira dentada, juntas alinhadas e rejunte após 72 h.', array['azulejo', 'revestimento cerâmico', 'cerâmica de parede', 'banheiro', 'cozinha'], true),
('CP-007', 'Massa corrida PVA em parede, 2 demãos', 'm²', 'Pintura', 'Reboco curado e selado, aplicação de duas demãos de massa com desempenadeira de aço e lixamento entre demãos até superfície lisa.', array['massa corrida', 'emassamento'], true),
('CP-008', 'Pintura acrílica em parede, selador + 2 demãos', 'm²', 'Pintura', 'Superfície limpa e lixada, uma demão de selador e duas de tinta acrílica com rolo, respeitando o intervalo de secagem do fabricante.', array['pintura', 'tinta', 'pintar'], true),
('CP-009', 'Concreto estrutural fck 25 MPa: lançamento e adensamento', 'm³', 'Estrutura', 'Conferência de formas e armaduras antes da concretagem, lançamento em camadas, adensamento com vibrador de imersão e cura úmida por 7 dias.', array['concreto', 'concretagem', 'laje', 'viga', 'pilar', 'sapata'], false),
('CP-010', 'Armação em aço CA-50', 'kg', 'Estrutura', 'Corte e dobra conforme o projeto, montagem com arame recozido, espaçadores para cobrimento e conferência pelo engenheiro antes da concretagem.', array['armação', 'aço', 'ferragem', 'armadura'], false),
('CP-011', 'Forma de compensado para pilares e vigas', 'm²', 'Estrutura', 'Montagem das formas com compensado resinado travado por sarrafos e pontaletes, prumo e nível conferidos, desmoldante e desforma no prazo do projeto.', array['forma', 'fôrma', 'escoramento de forma'], false),
('CP-012', 'Revestimento de gesso liso em parede', 'm²', 'Revestimento', 'Base de alvenaria limpa, aplicação de pasta de gesso em camada fina com desempenadeira, acabamento liso pronto para pintura.', array['gesso', 'gesso liso'], true),
('CP-013', 'Forro de drywall', 'm²', 'Forro', 'Marcação do nível, fixação de tirantes e perfis, aparafusamento das placas, tratamento das juntas com fita e massa.', array['forro', 'drywall', 'rebaixamento'], true),
('CP-014', 'Impermeabilização com manta asfáltica 3 mm', 'm²', 'Impermeabilização', 'Regularização com caimento, primer asfáltico, manta aplicada a maçarico com sobreposição de 10 cm, teste de estanqueidade de 72 h e proteção mecânica.', array['impermeabilização', 'manta', 'laje', 'terraço'], true),
('CP-015', 'Impermeabilização com argamassa polimérica', 'm²', 'Impermeabilização', 'Superfície limpa e úmida, três demãos cruzadas de argamassa polimérica com trincha, reforço com tela nos cantos e ralos.', array['impermeabilização', 'argamassa polimérica', 'banheiro', 'área molhada', 'box'], true),
('CP-016', 'Ponto elétrico (tomada ou interruptor)', 'un', 'Instalações', 'Rasgo e embutimento do eletroduto, caixa 4x2 nivelada, passagem dos cabos pelo quadro, ligação e teste do ponto.', array['ponto elétrico', 'tomada', 'interruptor', 'elétrica'], true),
('CP-017', 'Ponto de água fria', 'un', 'Instalações', 'Rasgo, tubulação soldável com conexões, teste de pressão antes de fechar a parede e fechamento com argamassa.', array['ponto hidráulico', 'água fria', 'hidráulica'], true),
('CP-018', 'Ponto de esgoto', 'un', 'Instalações', 'Tubulação com caimento mínimo de 1% a 2%, conexões soldadas, teste com água antes do fechamento.', array['esgoto', 'ponto de esgoto', 'ralo'], true),
('CP-019', 'Reforço com fibra de carbono', 'm²', 'Reforço estrutural', 'Preparo do substrato por lixamento, arredondamento de cantos, primer epóxi, saturação e colagem da manta conforme o projeto, com controle de bolhas e cura.', array['fibra de carbono', 'reforço', 'reforço estrutural'], false),
('CP-020', 'Encamisamento com graute', 'm³', 'Reforço estrutural', 'Apicoamento e limpeza do concreto existente, nova armadura conforme o projeto, forma estanque, lançamento contínuo do graute e cura úmida.', array['encamisamento', 'graute', 'aumento de seção', 'reforço'], false),
('CP-021', 'Escoramento metálico (por mês)', 'm²', 'Reforço estrutural', 'Distribuição das escoras conforme o plano de escoramento, apoio em base firme e conferência de prumo antes de qualquer intervenção.', array['escoramento', 'escora'], false),
('CP-022', 'Demolição de revestimento cerâmico', 'm²', 'Demolição', 'Proteção dos ambientes vizinhos, remoção do revestimento e da argamassa com ferramenta manual ou martelete e ensacamento do entulho.', array['demolição', 'remoção de piso', 'retirada de revestimento', 'quebra'], false),
('CP-023', 'Demolição de alvenaria', 'm³', 'Demolição', 'Escoramento quando necessário, demolição manual de cima para baixo, separação e ensacamento do entulho.', array['demolição de parede', 'demolir alvenaria'], false),
('CP-024', 'Telhado cerâmico com madeiramento', 'm²', 'Cobertura', 'Madeiramento tratado com caimento do projeto, ripamento na galga da telha, colocação de cumeeiras e arremates com argamassa.', array['telhado', 'telha', 'cobertura'], true),
('CP-025', 'Alvenaria estrutural com bloco de concreto 14 cm', 'm²', 'Alvenaria', 'Primeira fiada nivelada, assentamento com argamassa 1:0,5:4,5, grauteamento dos furos indicados no projeto e conferência de prumo a cada fiada.', array['alvenaria estrutural', 'bloco de concreto'], false),
('CP-026', 'Acompanhamento técnico do engenheiro', 'h', 'Engenharia', 'Hora técnica de acompanhamento, conferência de execução e orientação da equipe em obra ou no escritório.', array['acompanhamento', 'visita técnica', 'gestão', 'engenheiro'], false)
on conflict (codigo) do nothing;

insert into public.composicao_item (composicao_id, insumo_id, coeficiente)
select c.id, i.id, v.coef from (values
  ('CP-001', 'MAT-004', 25.5),
  ('CP-001', 'MAT-001', 2.0),
  ('CP-001', 'MAT-003', 2.0),
  ('CP-001', 'MAT-002', 0.012),
  ('CP-001', 'MO-001', 0.75),
  ('CP-001', 'MO-002', 0.45),
  ('CP-002', 'MAT-001', 1.5),
  ('CP-002', 'MAT-002', 0.005),
  ('CP-002', 'MO-001', 0.1),
  ('CP-002', 'MO-002', 0.1),
  ('CP-003', 'MAT-001', 4.0),
  ('CP-003', 'MAT-003', 4.0),
  ('CP-003', 'MAT-002', 0.024),
  ('CP-003', 'MO-001', 0.6),
  ('CP-003', 'MO-002', 0.5),
  ('CP-004', 'MAT-001', 10.0),
  ('CP-004', 'MAT-002', 0.045),
  ('CP-004', 'MO-001', 0.35),
  ('CP-004', 'MO-002', 0.45),
  ('CP-005', 'MAT-006', 1.1),
  ('CP-005', 'MAT-008', 5.0),
  ('CP-005', 'MAT-010', 0.3),
  ('CP-005', 'MO-005', 0.6),
  ('CP-005', 'MO-002', 0.3),
  ('CP-006', 'MAT-007', 1.1),
  ('CP-006', 'MAT-009', 5.0),
  ('CP-006', 'MAT-010', 0.25),
  ('CP-006', 'MO-005', 0.7),
  ('CP-006', 'MO-002', 0.3),
  ('CP-007', 'MAT-011', 0.8),
  ('CP-007', 'MAT-012', 0.25),
  ('CP-007', 'MO-006', 0.35),
  ('CP-007', 'MO-002', 0.1),
  ('CP-008', 'MAT-014', 0.12),
  ('CP-008', 'MAT-013', 0.17),
  ('CP-008', 'MO-006', 0.3),
  ('CP-008', 'MO-002', 0.05),
  ('CP-009', 'MAT-015', 1.05),
  ('CP-009', 'MO-001', 1.5),
  ('CP-009', 'MO-002', 3.0),
  ('CP-009', 'EQ-001', 0.4),
  ('CP-010', 'MAT-016', 1.1),
  ('CP-010', 'MAT-017', 0.025),
  ('CP-010', 'MO-004', 0.1),
  ('CP-010', 'MO-002', 0.06),
  ('CP-011', 'MAT-018', 0.35),
  ('CP-011', 'MAT-019', 1.5),
  ('CP-011', 'MAT-020', 0.15),
  ('CP-011', 'MO-003', 1.0),
  ('CP-011', 'MO-002', 0.4),
  ('CP-012', 'MAT-021', 6.0),
  ('CP-012', 'MO-007', 0.35),
  ('CP-013', 'MAT-022', 1.05),
  ('CP-013', 'MO-007', 0.5),
  ('CP-013', 'MO-002', 0.2),
  ('CP-014', 'MAT-023', 1.15),
  ('CP-014', 'MAT-024', 0.4),
  ('CP-014', 'MO-011', 0.35),
  ('CP-014', 'MO-002', 0.2),
  ('CP-015', 'MAT-025', 3.0),
  ('CP-015', 'MO-011', 0.3),
  ('CP-016', 'MAT-027', 4.0),
  ('CP-016', 'MAT-026', 12.0),
  ('CP-016', 'MAT-028', 1.0),
  ('CP-016', 'MAT-029', 1.0),
  ('CP-016', 'MO-008', 1.0),
  ('CP-016', 'MO-010', 1.0),
  ('CP-017', 'MAT-030', 3.0),
  ('CP-017', 'MAT-031', 4.0),
  ('CP-017', 'MO-009', 1.2),
  ('CP-017', 'MO-010', 1.2),
  ('CP-018', 'MAT-032', 3.0),
  ('CP-018', 'MAT-033', 3.0),
  ('CP-018', 'MO-009', 1.0),
  ('CP-018', 'MO-010', 1.0),
  ('CP-019', 'MAT-034', 1.1),
  ('CP-019', 'MAT-035', 1.2),
  ('CP-019', 'MAT-036', 0.3),
  ('CP-019', 'MO-012', 1.5),
  ('CP-019', 'MO-002', 1.0),
  ('CP-020', 'MAT-037', 2200),
  ('CP-020', 'MO-001', 4.0),
  ('CP-020', 'MO-002', 6.0),
  ('CP-021', 'EQ-002', 1.2),
  ('CP-021', 'MO-003', 0.3),
  ('CP-021', 'MO-002', 0.3),
  ('CP-022', 'MO-002', 0.6),
  ('CP-023', 'MO-002', 6.0),
  ('CP-024', 'MAT-038', 16.0),
  ('CP-024', 'MAT-039', 3.5),
  ('CP-024', 'MAT-020', 0.05),
  ('CP-024', 'MO-013', 0.6),
  ('CP-024', 'MO-002', 0.4),
  ('CP-025', 'MAT-040', 12.5),
  ('CP-025', 'MAT-001', 3.0),
  ('CP-025', 'MAT-003', 1.5),
  ('CP-025', 'MAT-002', 0.014),
  ('CP-025', 'MO-001', 0.85),
  ('CP-025', 'MO-002', 0.5),
  ('CP-026', 'MO-020', 1.0)
) as v(comp, ins, coef)
join public.composicao c on c.codigo = v.comp join public.insumo i on i.codigo = v.ins
on conflict do nothing;
