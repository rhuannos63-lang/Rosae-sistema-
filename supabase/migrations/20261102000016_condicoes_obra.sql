-- Condições da obra e logística (2026-11-02): o que deixa o serviço mais trabalhoso que o
-- normal (subir material por escada, terreno em aclive, condomínio com horário reduzido,
-- imóvel ocupado, trabalho em altura...). Cada condição acrescenta um percentual na mão de
-- obra (menor produtividade, mais ajudantes) e no material (frete, transbordo, perdas,
-- proteção). O Rhuann marca as que valem em cada orçamento. Percentuais iniciais são
-- estimativas para o Rio de Janeiro, editáveis por quem tem financeiro.

create table public.condicao_obra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (length(trim(codigo)) > 0),
  grupo text not null default 'Geral',
  nome text not null check (length(trim(nome)) > 0),
  descricao text,
  mao_de_obra_pct numeric(6,2) not null default 0 check (mao_de_obra_pct between 0 and 200),
  material_pct numeric(6,2) not null default 0 check (material_pct between 0 and 200),
  ordem integer not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create trigger condicao_obra_atualizado before update on public.condicao_obra for each row execute function public.tocar_atualizado_em();
create trigger condicao_obra_auditoria after insert or update or delete on public.condicao_obra for each row execute function public.auditar();

alter table public.condicao_obra enable row level security;
alter table public.condicao_obra force row level security;
revoke all on public.condicao_obra from anon, authenticated;
grant select, insert, update, delete on public.condicao_obra to authenticated;
create policy condicao_obra_ler on public.condicao_obra for select to authenticated using (eh_equipe_adm());
create policy condicao_obra_ins on public.condicao_obra for insert to authenticated with check (tem_financeiro());
create policy condicao_obra_upd on public.condicao_obra for update to authenticated using (tem_financeiro()) with check (tem_financeiro());
create policy condicao_obra_del on public.condicao_obra for delete to authenticated using (tem_financeiro());

insert into public.condicao_obra (codigo, grupo, nome, descricao, mao_de_obra_pct, material_pct, ordem) values
  ('AC-01', 'Acesso e transporte de material', 'Apartamento com elevador de serviço', 'Material sobe pelo elevador de serviço, com proteção da cabine e agendamento na portaria.', 5, 1, 10),
  ('AC-02', 'Acesso e transporte de material', 'Apartamento só com elevador social', 'Material só pode subir em horário restrito, em pequenas quantidades e com proteção.', 8, 2, 20),
  ('AC-03', 'Acesso e transporte de material', 'Material pela escada (até 3 andares)', 'Sacos, blocos e entulho sobem e descem pela escada, carregados por ajudante.', 12, 3, 30),
  ('AC-04', 'Acesso e transporte de material', 'Material pela escada (acima de 3 andares)', 'Escada longa: mais ajudantes, mais tempo e mais perda no transporte.', 22, 5, 40),
  ('AC-05', 'Acesso e transporte de material', 'Casa em terreno em aclive ou declive', 'Material e entulho por escadaria ou rampa até a obra.', 15, 4, 50),
  ('AC-06', 'Acesso e transporte de material', 'Rua sem acesso para caminhão', 'Descarga longe da obra e transbordo em carrinho ou veículo menor.', 8, 5, 60),
  ('AC-07', 'Acesso e transporte de material', 'Sem vaga para carga e descarga', 'Descarga em horário restrito, entregas fracionadas ou taxa de estacionamento.', 4, 3, 70),
  ('AC-08', 'Acesso e transporte de material', 'Comunidade ou acesso restrito a veículos', 'Veículo não chega na porta: transporte manual e entrega em etapas.', 18, 8, 80),
  ('HO-01', 'Condomínio e horários', 'Horário reduzido do condomínio', 'Sem sábado, sem barulho fora do horário ou janela curta de trabalho.', 10, 0, 110),
  ('HO-02', 'Condomínio e horários', 'Trabalho à noite, domingo ou feriado', 'Comércio que não pode parar ou exigência do cliente.', 35, 0, 120),
  ('HO-03', 'Condomínio e horários', 'Exigências do condomínio', 'Cadastro da equipe, seguro, laudo, vistoria do síndico e caçamba autorizada.', 3, 1, 130),
  ('IM-01', 'Imóvel e ambiente', 'Imóvel ocupado (morando ou funcionando)', 'Proteção e limpeza diárias, trabalho por partes e menos produtividade.', 12, 2, 210),
  ('IM-02', 'Imóvel e ambiente', 'Proteger pisos, móveis e acabamentos existentes', 'Lona, papelão, fita e cuidado extra para não danificar o que fica.', 4, 3, 220),
  ('IM-03', 'Imóvel e ambiente', 'Ambiente apertado ou de difícil manobra', 'Banheiro pequeno, shaft, entreforro ou área sem espaço para estocar.', 10, 0, 230),
  ('IM-04', 'Imóvel e ambiente', 'Sem água ou energia no local', 'Gerador, reservatório provisório ou ligação provisória.', 6, 4, 240),
  ('EX-01', 'Execução e segurança', 'Trabalho em altura', 'Fachada, telhado ou pé-direito alto: andaime, balancim, linha de vida e EPI.', 20, 3, 310),
  ('EX-02', 'Execução e segurança', 'Entulho ensacado e sem caçamba na porta', 'Entulho em sacos, descido manualmente e levado até a caçamba.', 10, 2, 320),
  ('EX-03', 'Execução e segurança', 'Demolição manual, sem máquina', 'Ruído e vibração restritos: quebra na marreta e talhadeira.', 12, 0, 330),
  ('EX-04', 'Execução e segurança', 'Serviço externo em período de chuva', 'Dias parados e retrabalho em serviço exposto ao tempo.', 6, 1, 340),
  ('RG-01', 'Região e deslocamento da equipe', 'Fora da Região Metropolitana do Rio', 'Transporte, alimentação e, se preciso, estadia da equipe; frete maior.', 15, 5, 410),
  ('RG-02', 'Região e deslocamento da equipe', 'Área de risco', 'Horário limitado, cuidado com equipamento e equipe.', 15, 3, 420);
