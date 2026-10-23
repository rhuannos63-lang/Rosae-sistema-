-- Etapa 4: contratos e operação.
-- Biblioteca de cláusulas (minutas), contrato gerado da proposta, conversão
-- proposta → obra sem duplicar, cronograma por etapa com linha de base,
-- progresso físico por peso, materiais (necessidade, compra, entrega),
-- fichas de execução com revisão, registros de obra, fotos e pendências.

alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

create or replace function public.evento_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'Registro de histórico não pode ser alterado nem apagado. Lance um evento de correção.';
end $$;

-- ---------------------------------------------------------------------
-- Biblioteca de serviços: materiais, critérios e procedimento sugeridos
-- ---------------------------------------------------------------------
alter table public.modelo_servico
  add column materiais jsonb not null default '[]',          -- [{descricao, unidade, por_unidade?}]
  add column criterios text[] not null default '{}',          -- critérios de verificação
  add column pre_requisitos text[] not null default '{}';

update public.modelo_servico set
  materiais = '[{"descricao":"Argamassa colante (tipo conforme revestimento)","unidade":"sc"},{"descricao":"Rejunte","unidade":"kg"},{"descricao":"Lona e papelão para proteção","unidade":"vb"}]',
  criterios = '{"Base limpa, firme e nivelada antes do assentamento","Paginação conferida com o cliente","Juntas alinhadas e uniformes","Teste de som cavo após a cura","Limpeza final sem resíduos de rejunte"}',
  pre_requisitos = '{"Ambiente liberado e protegido","Revestimento escolhido e entregue","Avaliação da base concluída"}'
where nome = 'Reforma';

update public.modelo_servico set
  materiais = '[{"descricao":"Graute / argamassa estrutural conforme projeto","unidade":"sc"},{"descricao":"Aço conforme projeto","unidade":"kg"},{"descricao":"Escoramento","unidade":"vb"}]',
  criterios = '{"Escoramento conferido antes de qualquer remoção","Armaduras conferidas com o projeto antes do fechamento","Preparo do substrato conforme especificação","Registro fotográfico de cada fase"}',
  pre_requisitos = '{"Projeto de reforço aprovado","Escoramento definido","Acesso e área de trabalho liberados"}'
where nome ilike 'Execução de reforço%';

-- ---------------------------------------------------------------------
-- Cláusulas (com versão e estado de revisão jurídica)
-- ---------------------------------------------------------------------
create table public.clausula (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  titulo text not null check (length(trim(titulo)) > 0),
  texto text not null check (length(trim(texto)) > 0),
  -- Modelos em que entra: preco_fechado, gestao, acompanhamento, administracao, projeto ou 'todos'.
  aplicavel text[] not null default '{todos}',
  versao integer not null default 1,
  revisao_juridica text not null default 'minuta' check (revisao_juridica in ('minuta', 'revisada')),
  revisado_por text,
  revisado_em date,
  referencias text,
  ativo boolean not null default true,
  ordem integer not null default 0,
  atualizado_em timestamptz not null default now()
);

create table public.clausula_versao (
  id bigint generated always as identity primary key,
  clausula_id uuid not null references public.clausula (id) on delete cascade,
  versao integer not null,
  titulo text not null,
  texto text not null,
  revisao_juridica text not null,
  guardada_em timestamptz not null default now()
);

-- Mudou o texto: nova versão e volta a ser minuta (a não ser que a revisão venha junto).
create or replace function public.clausula_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.texto is distinct from old.texto or new.titulo is distinct from old.titulo then
    insert into clausula_versao (clausula_id, versao, titulo, texto, revisao_juridica)
    values (old.id, old.versao, old.titulo, old.texto, old.revisao_juridica);
    new.versao := old.versao + 1;
    if not (new.revisao_juridica = 'revisada' and new.revisado_em is distinct from old.revisado_em) then
      new.revisao_juridica := 'minuta';
    end if;
  end if;
  if new.revisao_juridica = 'revisada' and (coalesce(trim(new.revisado_por), '') = '' or new.revisado_em is null) then
    raise exception 'Para marcar como revisada, informe quem revisou e a data.';
  end if;
  return new;
end $$;
create trigger clausula_antes before update on public.clausula
  for each row execute function public.clausula_antes();

-- Minutas iniciais. Sem citação de lei: o texto jurídico final é do advogado do Rhuann.
insert into public.clausula (codigo, titulo, texto, aplicavel, ordem) values
  ('objeto', 'Objeto', 'O presente instrumento tem por objeto a prestação dos serviços descritos no escopo anexo, conforme a proposta {proposta} aprovada pelo CONTRATANTE, que integra este contrato.', '{todos}', 1),
  ('documentos', 'Documentos integrantes', 'Integram este contrato, nesta ordem de prevalência: (i) este instrumento; (ii) a proposta aprovada, na versão identificada; (iii) os aditivos aprovados por escrito. Em caso de divergência, prevalece o documento de ordem anterior, salvo aditivo posterior que trate do mesmo ponto.', '{todos}', 2),
  ('preco_fechado', 'Preço e forma de pagamento', 'Pela execução do escopo, o CONTRATANTE pagará o valor total de {valor_total}, conforme as condições de pagamento descritas no anexo. O preço contempla apenas os itens expressamente incluídos no escopo.', '{preco_fechado,projeto}', 3),
  ('gestao_honorarios', 'Honorários de gestão', 'Pelos serviços de gestão, o CONTRATANTE pagará {honorarios}. Os custos de materiais, mão de obra e serviços de terceiros não estão incluídos nos honorários, salvo quando expressamente indicado.', '{gestao,combinado}', 4),
  ('acompanhamento', 'Acompanhamento técnico e visitas', 'O acompanhamento compreende {visitas_incluidas} visita(s) técnica(s) no período contratado. Visitas adicionais solicitadas pelo CONTRATANTE serão cobradas conforme {visita_adicional}, mediante aviso prévio.', '{acompanhamento,gestao,combinado}', 5),
  ('administracao', 'Administração e reembolso', 'Os custos da obra serão pagos pelo CONTRATANTE diretamente ou por reembolso, mediante apresentação dos comprovantes. A remuneração da CONTRATADA pela administração será {remuneracao_administracao}. Eventuais economias obtidas nas compras pertencem ao CONTRATANTE, salvo regra diferente escrita neste contrato.', '{administracao,combinado}', 6),
  ('prazo', 'Prazo e dependências', 'O prazo estimado de execução é de {prazo}, contado da liberação da obra para início. O prazo depende do acesso ao local, das decisões e aprovações do CONTRATANTE, da entrega de materiais de sua responsabilidade e de condições climáticas. Atrasos decorrentes dessas dependências serão registrados e comunicados.', '{todos}', 7),
  ('obrigacoes_contratada', 'Obrigações da CONTRATADA', 'Executar os serviços com técnica adequada e responsabilidade profissional; manter o CONTRATANTE informado sobre o andamento; registrar impedimentos e decisões; providenciar a Anotação de Responsabilidade Técnica quando exigível. A CONTRATADA responde pelos danos decorrentes de falhas na execução dos serviços sob sua responsabilidade.', '{todos}', 8),
  ('obrigacoes_contratante', 'Obrigações do CONTRATANTE', 'Garantir acesso ao local nos horários combinados; fornecer as informações e documentos necessários; tomar as decisões que lhe cabem nos prazos combinados; efetuar os pagamentos nas datas previstas; providenciar os itens de sua responsabilidade listados no escopo.', '{todos}', 9),
  ('alteracoes', 'Alterações e serviços adicionais', 'Qualquer alteração de escopo, serviço adicional ou supressão será formalizada em aditivo com descrição, preço, impacto no prazo e motivo, e só será executada após aprovação por escrito do CONTRATANTE. O contrato original permanece preservado.', '{todos}', 10),
  ('existentes', 'Intervenções em elementos existentes', 'Antes de intervir em elementos existentes, a CONTRATADA registrará a condição anterior com fotos, os riscos identificados, a necessidade de proteção ou desmontagem e as recomposições incluídas e não incluídas. Constatado impedimento, a solução proposta será apresentada ao CONTRATANTE e a execução só prosseguirá após sua aprovação. A autorização do CONTRATANTE não representa renúncia a direitos.', '{todos}', 11),
  ('materiais', 'Materiais e compras', 'A responsabilidade pela compra de cada material segue o indicado no escopo (CONTRATADA, CONTRATANTE ou terceiro). Materiais adquiridos pelo CONTRATANTE devem estar disponíveis na obra na data combinada; a falta deles poderá alterar o cronograma.', '{todos}', 12),
  ('comunicacao', 'Comunicação e registros', 'O andamento será comunicado por meio do portal de acompanhamento e dos canais combinados. A ciência do CONTRATANTE sobre uma atualização não significa aprovação técnica, quitação ou aceitação contratual.', '{todos}', 13),
  ('rescisao', 'Rescisão', '[Minuta — condições de rescisão, multas e prazos a definir com a assessoria jurídica da ROSAE.]', '{todos}', 14),
  ('foro', 'Foro', '[Minuta — foro a definir com a assessoria jurídica da ROSAE.]', '{todos}', 15);

-- ---------------------------------------------------------------------
-- Contrato (gerado da proposta aprovada; congelado ao emitir)
-- ---------------------------------------------------------------------
create table public.contrato (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  obra_id uuid not null references public.obra (id),
  proposta_versao_id uuid references public.proposta_versao (id),
  modelo text not null check (modelo in ('preco_fechado', 'gestao', 'acompanhamento', 'administracao', 'projeto', 'combinado')),
  estado text not null default 'rascunho' check (estado in ('rascunho', 'emitido', 'assinado', 'cancelado')),
  -- {partes, objeto, escopo, honorarios, pagamento, prazo, clausulas:[{codigo,titulo,texto,versao,revisao_juridica}]}
  conteudo jsonb not null default '{}',
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  minuta boolean not null default true,
  hash text,
  emitido_em timestamptz,
  assinado_em date,
  assinatura_registro text,
  cancelado_motivo text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint contrato_cancelamento check (estado <> 'cancelado' or length(trim(coalesce(cancelado_motivo, ''))) > 0)
);
create unique index contrato_um_ativo on public.contrato (obra_id) where estado <> 'cancelado';
create trigger contrato_atualizado before update on public.contrato
  for each row execute function public.tocar_atualizado_em();

create or replace function public.contrato_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.codigo is null then
      new.codigo := 'CTR-' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY') || '-'
                    || lpad(proximo_numero('contrato-' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY'))::text, 3, '0');
    end if;
    if new.estado <> 'rascunho' then raise exception 'Contrato nasce como rascunho.'; end if;
    return new;
  end if;
  if old.estado <> 'rascunho' then
    if new.conteudo is distinct from old.conteudo or new.valor_total <> old.valor_total or new.modelo <> old.modelo
       or new.hash is distinct from old.hash or new.obra_id <> old.obra_id then
      raise exception 'Contrato emitido não muda. Para alterar, faça um aditivo.';
    end if;
    if old.estado = 'cancelado' then raise exception 'Contrato cancelado não volta.'; end if;
    if old.estado = 'assinado' and new.estado not in ('assinado', 'cancelado') then raise exception 'Contrato assinado não volta a rascunho.'; end if;
  end if;
  if old.estado = 'rascunho' and new.estado in ('emitido', 'assinado') and new.hash is null then
    raise exception 'Use "Emitir" para congelar o contrato.';
  end if;
  return new;
end $$;
create trigger contrato_antes before insert or update on public.contrato
  for each row execute function public.contrato_antes();
create trigger contrato_sem_apagar before delete on public.contrato
  for each row execute function public.evento_imutavel();

create or replace function public.emitir_contrato(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c contrato; v_hash text; v_minuta boolean;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into c from contrato where id = p_id for update;
  if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  if c.estado <> 'rascunho' then return c.hash; end if;
  if jsonb_array_length(coalesce(c.conteudo->'clausulas', '[]')) = 0 then raise exception 'O contrato precisa de cláusulas.'; end if;
  select exists (select 1 from jsonb_array_elements(c.conteudo->'clausulas') x where x->>'revisao_juridica' is distinct from 'revisada')
    into v_minuta;
  v_hash := encode(extensions.digest(convert_to(c.id::text || '|' || c.valor_total::text || '|' || c.conteudo::text, 'UTF8'), 'sha256'), 'hex');
  update contrato set estado = 'emitido', hash = v_hash, emitido_em = now(), minuta = v_minuta where id = p_id;
  return v_hash;
end $$;

-- Assinatura registrada pelo escritório (data e como foi assinado). Formaliza a obra.
create or replace function public.registrar_assinatura_contrato(p_id uuid, p_data date, p_registro text)
returns void language plpgsql security definer set search_path = public as $$
declare c contrato;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into c from contrato where id = p_id for update;
  if c.estado = 'assinado' then return; end if;
  if c.estado <> 'emitido' then raise exception 'Emita o contrato antes de registrar a assinatura.'; end if;
  if coalesce(trim(p_registro), '') = '' then raise exception 'Informe como foi assinado (ex.: assinatura digital, via física).'; end if;
  update contrato set estado = 'assinado', assinado_em = p_data, assinatura_registro = p_registro where id = p_id;
  update obra set status = 'contratada' where id = c.obra_id and status in ('em_negociacao', 'aprovada');
  insert into registro (obra_id, tipo, titulo, texto)
  values (c.obra_id, 'sistema', 'Contrato assinado', c.codigo || ' assinado em ' || to_char(p_data, 'DD/MM/YYYY') || ' (' || p_registro || ').');
end $$;

-- ---------------------------------------------------------------------
-- Serviço: quantidade, unidade, peso técnico e origem na proposta
-- ---------------------------------------------------------------------
alter table public.servico
  add column quantidade numeric(14,3),
  add column unidade text,
  add column modelo_id uuid references public.modelo_servico (id),
  add column peso numeric(8,2) not null default 1 check (peso >= 0),
  add column origem_versao_id uuid references public.proposta_versao (id),
  add column origem_item_id text;
create unique index servico_origem_unico on public.servico (origem_versao_id, origem_item_id) where origem_versao_id is not null;

alter table public.obra
  add column liberada_em timestamptz,
  add column liberada_por uuid,
  add column imagem_caminho text;

-- ---------------------------------------------------------------------
-- Etapas (cronograma)
-- ---------------------------------------------------------------------
create table public.etapa (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  servico_id uuid not null references public.servico (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  descricao text,
  ordem integer not null default 0,
  estado text not null default 'nao_iniciado' check (estado in (
    'nao_iniciado', 'programado', 'em_execucao', 'aguardando_material', 'aguardando_liberacao',
    'suspenso', 'executado', 'conferido', 'cancelado')),
  peso numeric(8,2) not null default 1 check (peso >= 0),
  criterio_medicao text,
  unidade text,
  quantidade_prevista numeric(14,3) check (quantidade_prevista is null or quantidade_prevista > 0),
  quantidade_executada numeric(14,3) check (quantidade_executada is null or quantidade_executada >= 0),
  percentual numeric(5,2) not null default 0 check (percentual between 0 and 100),
  duracao_dias integer check (duracao_dias is null or duracao_dias > 0),
  inicio_previsto date,
  fim_previsto date,
  inicio_base date,
  fim_base date,
  inicio_real date,
  fim_real date,
  responsavel_id uuid references public.pessoa (id),
  depende_de uuid[] not null default '{}',
  criterios text[] not null default '{}',
  conferido_por uuid,
  conferido_em timestamptz,
  conferencia_obs text,
  motivo_alteracao text,
  visivel_cliente boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint etapa_datas check (fim_previsto is null or inicio_previsto is null or fim_previsto >= inicio_previsto),
  constraint etapa_datas_real check (fim_real is null or inicio_real is null or fim_real >= inicio_real)
);
create index etapa_obra_idx on public.etapa (obra_id);
create index etapa_servico_idx on public.etapa (servico_id);

create table public.etapa_historico (
  id bigint generated always as identity primary key,
  etapa_id uuid not null references public.etapa (id) on delete cascade,
  em timestamptz not null default now(),
  por uuid default auth.uid(),
  campo text not null,
  antes text,
  depois text,
  motivo text
);
create index etapa_hist_idx on public.etapa_historico (etapa_id, em desc);

create or replace function public.etapa_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_adm boolean := eh_equipe_adm() or auth.uid() is null;
begin
  new.atualizado_em := now();
  if (select obra_id from servico where id = new.servico_id) is distinct from new.obra_id then
    raise exception 'A etapa precisa ser de um serviço da mesma obra.';
  end if;
  -- Medição por quantidade, quando definida.
  if new.quantidade_prevista is not null and new.quantidade_executada is not null then
    new.percentual := least(100, round(new.quantidade_executada / new.quantidade_prevista * 100, 2));
  end if;
  if new.estado in ('executado', 'conferido') then
    new.percentual := 100;
    new.fim_real := coalesce(new.fim_real, v_hoje);
    new.inicio_real := coalesce(new.inicio_real, new.fim_real);
  elsif new.estado = 'em_execucao' then
    new.inicio_real := coalesce(new.inicio_real, v_hoje);
  end if;
  if tg_op = 'INSERT' then
    if new.estado = 'conferido' then raise exception 'Conferência técnica é registrada depois da execução.'; end if;
    return new;
  end if;

  -- Equipe de campo atualiza andamento; estrutura, pesos e base são do escritório.
  if not v_adm then
    if new.nome <> old.nome or new.peso <> old.peso or new.servico_id <> old.servico_id
       or new.inicio_base is distinct from old.inicio_base or new.fim_base is distinct from old.fim_base
       or new.inicio_previsto is distinct from old.inicio_previsto or new.fim_previsto is distinct from old.fim_previsto
       or new.quantidade_prevista is distinct from old.quantidade_prevista or new.visivel_cliente <> old.visivel_cliente
       or (new.estado in ('conferido', 'cancelado') and new.estado <> old.estado) then
      raise exception 'A equipe de campo registra o andamento; planejamento e conferência técnica são do escritório.';
    end if;
  end if;
  if new.estado = 'conferido' and old.estado <> 'conferido' then
    if old.estado <> 'executado' then raise exception 'Só é possível conferir uma etapa com execução concluída.'; end if;
    new.conferido_por := auth.uid(); new.conferido_em := now();
  elsif new.estado <> 'conferido' then
    new.conferido_por := null; new.conferido_em := null;
  end if;
  if new.estado not in ('executado', 'conferido') and old.estado in ('executado', 'conferido') and new.percentual = 100
     and new.quantidade_executada is null then
    new.percentual := 99;
  end if;
  -- Com linha de base definida, mudar prazo exige motivo (fica no histórico).
  if (new.inicio_previsto is distinct from old.inicio_previsto or new.fim_previsto is distinct from old.fim_previsto)
     and old.inicio_base is not null and new.inicio_base is not distinct from old.inicio_base
     and coalesce(trim(new.motivo_alteracao), '') = '' then
    raise exception 'Informe o motivo da mudança de prazo (a previsão original fica guardada).';
  end if;
  if new.estado <> old.estado then
    insert into etapa_historico (etapa_id, campo, antes, depois, motivo) values (new.id, 'estado', old.estado, new.estado, nullif(trim(new.motivo_alteracao), ''));
  end if;
  if new.inicio_previsto is distinct from old.inicio_previsto or new.fim_previsto is distinct from old.fim_previsto then
    insert into etapa_historico (etapa_id, campo, antes, depois, motivo)
    values (new.id, 'prazo', concat_ws(' a ', old.inicio_previsto, old.fim_previsto), concat_ws(' a ', new.inicio_previsto, new.fim_previsto), nullif(trim(new.motivo_alteracao), ''));
  end if;
  if new.percentual <> old.percentual then
    insert into etapa_historico (etapa_id, campo, antes, depois, motivo) values (new.id, 'percentual', old.percentual::text, new.percentual::text, nullif(trim(new.motivo_alteracao), ''));
  end if;
  new.motivo_alteracao := null;
  return new;
end $$;
create trigger etapa_antes before insert or update on public.etapa
  for each row execute function public.etapa_antes();

-- Congela a previsão atual como planejamento original (só onde ainda não há base, ou tudo se pedido).
create or replace function public.definir_linha_base(p_obra uuid, p_substituir boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  update etapa set inicio_base = inicio_previsto, fim_base = fim_previsto
  where obra_id = p_obra and inicio_previsto is not null and estado <> 'cancelado'
    and (p_substituir or inicio_base is null);
  get diagnostics n = row_count;
  if n > 0 then
    insert into registro (obra_id, tipo, titulo, texto)
    values (p_obra, 'sistema', 'Linha de base do cronograma', n || ' etapa(s) com planejamento original ' || case when p_substituir then 'substituído' else 'definido' end || '.');
  end if;
  return n;
end $$;

-- Progresso físico: média ponderada por peso das etapas (dentro do serviço) e dos serviços (na obra).
-- Compra de material e pagamentos não entram. Etapas canceladas saem da base e são contadas à parte.
create or replace function public.progresso_obra(p_obra uuid)
returns jsonb language sql stable set search_path = public as $$
  with e as (
    select * from etapa where obra_id = p_obra
  ),
  s as (
    select sv.id, sv.nome, sv.peso, sv.ordem,
           coalesce(sum(e.peso * e.percentual) filter (where e.estado <> 'cancelado') / nullif(sum(e.peso) filter (where e.estado <> 'cancelado'), 0), 0) as executado,
           coalesce(sum(e.peso * 100) filter (where e.estado = 'conferido') / nullif(sum(e.peso) filter (where e.estado <> 'cancelado'), 0), 0) as conferido,
           count(e.id) filter (where e.estado <> 'cancelado') as etapas,
           count(e.id) filter (where e.estado = 'cancelado') as canceladas,
           count(e.id) filter (where e.estado in ('executado', 'conferido')) as concluidas
    from servico sv left join e on e.servico_id = sv.id
    where sv.obra_id = p_obra and not sv.arquivado
    group by sv.id
  ),
  sb as (select * from s where etapas > 0)
  select jsonb_build_object(
    'executado', coalesce(round((select sum(peso * executado) / nullif(sum(peso), 0) from sb), 1), 0),
    'conferido', coalesce(round((select sum(peso * conferido) / nullif(sum(peso), 0) from sb), 1), 0),
    'etapas', (select count(*) from e where estado <> 'cancelado'),
    'concluidas', (select count(*) from e where estado in ('executado', 'conferido')),
    'canceladas', (select count(*) from e where estado = 'cancelado'),
    'servicos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'peso', peso,
                  'executado', round(executado, 1), 'conferido', round(conferido, 1), 'etapas', etapas, 'concluidas', concluidas, 'canceladas', canceladas) order by ordem, nome) from s), '[]'),
    'ambientes', coalesce((select jsonb_agg(x order by x->>'nome') from (
        select jsonb_build_object('id', a.id, 'nome', a.nome,
               'executado', round(coalesce(sum(sb.peso * sb.executado) / nullif(sum(sb.peso), 0), 0), 1)) as x
        from ambiente a join servico_ambiente sa on sa.ambiente_id = a.id join sb on sb.id = sa.servico_id
        where a.obra_id = p_obra group by a.id) y), '[]')
  )
$$;

-- ---------------------------------------------------------------------
-- Materiais: necessidade → compra → entrega/local. Pagamento fica no financeiro.
-- ---------------------------------------------------------------------
create table public.material (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  servico_id uuid references public.servico (id) on delete set null,
  ambiente_id uuid references public.ambiente (id) on delete set null,
  etapa_id uuid references public.etapa (id) on delete set null,
  descricao text not null check (length(trim(descricao)) > 0),
  especificacao text,
  unidade text not null default 'un',
  quantidade numeric(14,3) check (quantidade is null or quantidade > 0),
  responsavel_compra text not null default 'rosae' check (responsavel_compra in ('rosae', 'cliente', 'terceiro')),
  fornecedor_id uuid references public.pessoa (id),
  necessario_em date,
  estado text not null default 'ativo' check (estado in ('ativo', 'cancelado', 'substituido')),
  substituido_por uuid references public.material (id),
  motivo text,
  localizacao text,
  observacoes text,
  visivel_cliente boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint material_cancelamento check (estado = 'ativo' or length(trim(coalesce(motivo, ''))) > 0)
);
create index material_obra_idx on public.material (obra_id);
create trigger material_atualizado before update on public.material
  for each row execute function public.tocar_atualizado_em();

create or replace function public.material_validar()
returns trigger language plpgsql as $$
begin
  if new.servico_id is not null and (select obra_id from servico where id = new.servico_id) is distinct from new.obra_id then
    raise exception 'O serviço precisa ser da mesma obra.';
  end if;
  if new.etapa_id is not null and (select obra_id from etapa where id = new.etapa_id) is distinct from new.obra_id then
    raise exception 'A etapa precisa ser da mesma obra.';
  end if;
  return new;
end $$;
create trigger material_validar before insert or update on public.material
  for each row execute function public.material_validar();

-- Cada fato é um evento; nada é sobrescrito. Correção = evento contrário.
create table public.material_evento (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.material (id) on delete cascade,
  tipo text not null check (tipo in ('compra', 'compra_cancelada', 'entrega', 'devolucao')),
  quantidade numeric(14,3) not null check (quantidade > 0),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  local text,
  documento text,
  lancamento_id uuid references public.lancamento (id),
  observacoes text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index material_evento_idx on public.material_evento (material_id);

create or replace function public.material_evento_validar()
returns trigger language plpgsql security definer set search_path = public as $$
declare m material; v_comprado numeric; v_entregue numeric;
begin
  select * into m from material where id = new.material_id;
  if m.estado <> 'ativo' and new.tipo in ('compra', 'entrega') then raise exception 'Material cancelado ou substituído.'; end if;
  select coalesce(sum(case tipo when 'compra' then quantidade when 'compra_cancelada' then -quantidade else 0 end), 0),
         coalesce(sum(case tipo when 'entrega' then quantidade when 'devolucao' then -quantidade else 0 end), 0)
    into v_comprado, v_entregue from material_evento where material_id = new.material_id;
  if new.tipo = 'compra_cancelada' and new.quantidade > v_comprado then raise exception 'Cancelamento maior que a quantidade comprada.'; end if;
  if new.tipo = 'devolucao' and new.quantidade > v_entregue then raise exception 'Devolução maior que a quantidade entregue.'; end if;
  if new.tipo = 'entrega' and m.responsavel_compra = 'rosae' and v_entregue + new.quantidade > v_comprado then
    raise exception 'Entrega maior que o comprado. Registre a compra primeiro.';
  end if;
  if new.lancamento_id is not null then
    if new.tipo <> 'compra' then raise exception 'Só a compra se liga a uma conta a pagar.'; end if;
    if m.responsavel_compra <> 'rosae' then raise exception 'Material comprado pelo cliente ou por terceiro não vira despesa da ROSAE.'; end if;
    if not tem_financeiro() then raise exception 'Sem permissão para ligar ao financeiro.'; end if;
  end if;
  if new.tipo = 'entrega' and new.local is not null then
    update material set localizacao = new.local where id = new.material_id;
  end if;
  return new;
end $$;
create trigger material_evento_validar before insert on public.material_evento
  for each row execute function public.material_evento_validar();
create trigger material_evento_imutavel before update or delete on public.material_evento
  for each row execute function public.evento_imutavel();

create view public.v_material with (security_invoker = true) as
  select m.*, s.nome as servico_nome, a.nome as ambiente_nome, e.nome as etapa_nome, e.inicio_previsto as etapa_inicio,
         f.nome as fornecedor_nome,
         coalesce(ev.comprado, 0) as comprado, coalesce(ev.entregue, 0) as entregue, coalesce(ev.devolvido, 0) as devolvido,
         case
           when m.estado <> 'ativo' then m.estado
           -- Sem quantidade definida, a referência é o que foi comprado.
           when coalesce(ev.entregue, 0) > 0 and coalesce(ev.entregue, 0) >= coalesce(m.quantidade, nullif(ev.comprado, 0), 0) then 'na_obra'
           when coalesce(ev.entregue, 0) > 0 then 'parcial'
           when m.responsavel_compra <> 'rosae' then 'aguardando_' || m.responsavel_compra
           when m.quantidade is not null and coalesce(ev.comprado, 0) >= m.quantidade then 'comprado'
           when coalesce(ev.comprado, 0) > 0 then 'comprado_parcial'
           else 'a_comprar'
         end as situacao
  from material m
  left join servico s on s.id = m.servico_id
  left join ambiente a on a.id = m.ambiente_id
  left join etapa e on e.id = m.etapa_id
  left join pessoa f on f.id = m.fornecedor_id
  left join lateral (
    select sum(case tipo when 'compra' then quantidade when 'compra_cancelada' then -quantidade else 0 end) as comprado,
           sum(case tipo when 'entrega' then quantidade when 'devolucao' then -quantidade else 0 end) as entregue,
           sum(quantidade) filter (where tipo = 'devolucao') as devolvido
    from material_evento where material_id = m.id) ev on true;

-- Situação de pagamento das compras (só financeiro).
create or replace function public.material_pagamentos(p_obra uuid)
returns table (material_id uuid, lancado numeric, pago numeric) language sql stable set search_path = public as $$
  select ev.material_id, sum(l.valor_total), sum(lp.pago)
  from material_evento ev join material m on m.id = ev.material_id
  join lancamento l on l.id = ev.lancamento_id and not l.cancelado
  join v_lancamento_pago lp on lp.lancamento_id = l.id
  where m.obra_id = p_obra and tem_financeiro()
  group by ev.material_id
$$;

-- Etapas próximas (7 dias) ou em andamento que dependem de material ainda não disponível.
create or replace function public.alertas_materiais(p_obra uuid default null)
returns table (obra_id uuid, obra_nome text, etapa_id uuid, etapa_nome text, inicio date, material_id uuid, material text, situacao text)
language sql stable set search_path = public as $$
  select e.obra_id, o.nome, e.id, e.nome, e.inicio_previsto, m.id, m.descricao, m.situacao
  from etapa e join obra o on o.id = e.obra_id
  join v_material m on m.obra_id = e.obra_id and (m.etapa_id = e.id or (m.etapa_id is null and m.servico_id = e.servico_id))
  where (p_obra is null or e.obra_id = p_obra)
    and e.estado in ('nao_iniciado', 'programado', 'em_execucao', 'aguardando_material')
    and (e.estado in ('em_execucao', 'aguardando_material') or e.inicio_previsto <= (now() at time zone 'America/Sao_Paulo')::date + 7)
    and m.situacao not in ('na_obra', 'cancelado', 'substituido')
    and o.status not in ('cancelada', 'concluida_fisicamente', 'encerrada_financeiramente')
  order by e.inicio_previsto nulls last
$$;

-- ---------------------------------------------------------------------
-- Fichas de execução (revisão; liberação só pelo escritório)
-- ---------------------------------------------------------------------
create table public.ficha (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  servico_id uuid not null references public.servico (id) on delete cascade,
  revisao integer not null check (revisao > 0),
  estado text not null default 'rascunho' check (estado in ('rascunho', 'liberada', 'substituida')),
  origem text not null default 'modelo' check (origem in ('modelo', 'manual', 'ia')),
  -- {responsavel, atividades[], materiais[], pre_requisitos[], conferencia[], referencias[], impedimentos, observacoes}
  conteudo jsonb not null default '{}',
  liberada_por uuid,
  liberada_por_nome text,
  liberada_em timestamptz,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  unique (servico_id, revisao)
);

create or replace function public.ficha_antes()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'rascunho' then raise exception 'Ficha liberada não pode ser apagada.'; end if;
    return old;
  end if;
  if (select obra_id from servico where id = new.servico_id) is distinct from new.obra_id then
    raise exception 'O serviço precisa ser da mesma obra.';
  end if;
  if tg_op = 'UPDATE' and old.estado <> 'rascunho' then
    if new.conteudo is distinct from old.conteudo or new.revisao <> old.revisao then
      raise exception 'Ficha liberada não muda. Crie uma nova revisão.';
    end if;
    if not (old.estado = 'liberada' and new.estado = 'substituida') and new.estado <> old.estado then
      raise exception 'Mudança de estado inválida.';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.estado = 'rascunho' and new.estado <> 'rascunho' and new.liberada_em is null then
    raise exception 'Use "Liberar" para liberar a ficha.';
  end if;
  return new;
end $$;
create trigger ficha_antes before insert or update or delete on public.ficha
  for each row execute function public.ficha_antes();

create or replace function public.liberar_ficha(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f ficha;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório libera fichas (revisão técnica do responsável).'; end if;
  select * into f from ficha where id = p_id for update;
  if f.estado <> 'rascunho' then return; end if;
  update ficha set estado = 'substituida' where servico_id = f.servico_id and estado = 'liberada';
  update ficha set estado = 'liberada', liberada_em = now(), liberada_por = auth.uid(),
         liberada_por_nome = (select nome from usuario where id = auth.uid()) where id = p_id;
end $$;

-- Nova revisão em rascunho a partir da última (ou vazia).
create or replace function public.nova_revisao_ficha(p_servico uuid, p_conteudo jsonb default null, p_origem text default 'modelo')
returns uuid language plpgsql security definer set search_path = public as $$
declare u ficha; v_id uuid;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into u from ficha where servico_id = p_servico order by revisao desc limit 1;
  if u.id is not null and u.estado = 'rascunho' then return u.id; end if;
  insert into ficha (obra_id, servico_id, revisao, conteudo, origem)
  values ((select obra_id from servico where id = p_servico), p_servico, coalesce(u.revisao, 0) + 1,
          coalesce(p_conteudo, u.conteudo, '{}'), coalesce(p_origem, 'modelo'))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Registros de obra, fotos e pendências
-- ---------------------------------------------------------------------
create table public.registro (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  tipo text not null check (tipo in ('andamento', 'impedimento', 'inspecao', 'condicao_existente', 'decisao', 'nota_interna', 'sistema')),
  servico_id uuid references public.servico (id) on delete set null,
  etapa_id uuid references public.etapa (id) on delete set null,
  ambiente_id uuid references public.ambiente (id) on delete set null,
  titulo text,
  texto text,
  -- condição existente: {condicao_anterior, riscos, protecao, recomposicao_inclusa, recomposicao_nao_inclusa, impedimentos, solucao, aprovacao_necessaria}
  detalhes jsonb not null default '{}',
  publicado_em timestamptz,
  publicado_por uuid,
  autor_id uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint registro_conteudo check (length(trim(coalesce(titulo, '') || coalesce(texto, ''))) > 0 or detalhes <> '{}'),
  constraint registro_interno check (tipo not in ('nota_interna', 'sistema') or publicado_em is null)
);
create index registro_obra_idx on public.registro (obra_id, data desc);
create trigger registro_atualizado before update on public.registro
  for each row execute function public.tocar_atualizado_em();

create table public.foto (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  registro_id uuid references public.registro (id) on delete set null,
  servico_id uuid references public.servico (id) on delete set null,
  etapa_id uuid references public.etapa (id) on delete set null,
  ambiente_id uuid references public.ambiente (id) on delete set null,
  caminho text not null unique,
  legenda text,
  momento text not null default 'durante' check (momento in ('antes', 'durante', 'depois', 'outro')),
  tirada_em timestamptz not null default now(),
  largura integer,
  altura integer,
  publicada_em timestamptz,
  publicada_por uuid,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  constraint foto_pasta check (caminho like 'obras/' || obra_id::text || '/fotos/%')
);
create index foto_obra_idx on public.foto (obra_id, tirada_em desc);

create table public.pendencia (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  tipo text not null default 'pendencia' check (tipo in ('pendencia', 'decisao_cliente', 'impedimento', 'inspecao')),
  titulo text not null check (length(trim(titulo)) > 0),
  descricao text,
  prioridade text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  responsavel text not null default 'rosae' check (responsavel in ('rosae', 'cliente', 'parceiro', 'outro')),
  prazo date,
  estado text not null default 'aberta' check (estado in ('aberta', 'resolvida', 'cancelada')),
  resolucao text,
  resolvida_em timestamptz,
  servico_id uuid references public.servico (id) on delete set null,
  etapa_id uuid references public.etapa (id) on delete set null,
  registro_id uuid references public.registro (id) on delete set null,
  publicado_em timestamptz,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pendencia_resolucao check (estado = 'aberta' or length(trim(coalesce(resolucao, ''))) > 0)
);
create index pendencia_obra_idx on public.pendencia (obra_id, estado);
create or replace function public.pendencia_antes()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.estado <> 'aberta' and (tg_op = 'INSERT' or old.estado = 'aberta') then new.resolvida_em := now(); end if;
  if new.estado = 'aberta' then new.resolvida_em := null; end if;
  return new;
end $$;
create trigger pendencia_antes before insert or update on public.pendencia
  for each row execute function public.pendencia_antes();

-- ---------------------------------------------------------------------
-- Converter proposta aprovada em obra (ou incorporar aditivo). Idempotente.
-- ---------------------------------------------------------------------
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
      -- Etapas sugeridas pelo modelo (ou uma etapa única).
      if v_modelo.id is not null and jsonb_array_length(v_modelo.etapas) > 0 then
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

-- Liberar a obra para iniciar (diferente de proposta aprovada e de contrato assinado).
create or replace function public.liberar_obra(p_obra uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  update obra set status = 'em_execucao', liberada_em = coalesce(liberada_em, now()), liberada_por = coalesce(liberada_por, auth.uid()),
         data_inicio = coalesce(data_inicio, (now() at time zone 'America/Sao_Paulo')::date)
  where id = p_obra and status in ('aprovada', 'contratada', 'em_negociacao');
  if found then
    insert into registro (obra_id, tipo, titulo, texto) values (p_obra, 'sistema', 'Obra liberada para iniciar', 'Liberação registrada.');
  end if;
end $$;

-- Aditivo precisa de motivo antes de ser emitido.
create or replace function public.aditivo_exige_motivo()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.emitida and not old.emitida and (select tipo from proposta where id = new.proposta_id) = 'aditivo'
     and coalesce(trim(new.conteudo->>'motivo'), '') = '' then
    raise exception 'Informe o motivo do aditivo antes de emitir.';
  end if;
  return new;
end $$;
create trigger aditivo_exige_motivo before update on public.proposta_versao
  for each row execute function public.aditivo_exige_motivo();

-- Resumo da obra: aditivos aprovados aparecem à parte do contratado original.
create or replace function public.resumo_obra(p_obra uuid)
returns jsonb language sql stable set search_path = public as $$
  with a as (select * from v_alocacao where obra_id = p_obra and not cancelado),
  t as (select
    (select valor_contratado from obra_financeiro where obra_id = p_obra) as valor_contratado,
    coalesce((select sum(v.valor_total) from proposta pr join proposta_versao v on v.id = pr.versao_aprovada_id
              where pr.obra_id = p_obra and pr.tipo = 'aditivo' and pr.estado = 'aprovada'), 0) as aditivos,
    coalesce((select sum(valor) from a where tipo = 'receber'), 0) as a_receber_total,
    coalesce((select sum(pago) from a where tipo = 'receber' and categoria_natureza in ('receita_servico', 'reembolso_cliente')), 0) as recebido,
    coalesce((select sum(valor) from a where tipo = 'pagar'), 0) as custo_lancado,
    coalesce((select sum(pago) from a where tipo = 'pagar' and categoria_natureza like 'custo_%'), 0) as pago,
    coalesce((select sum(case when tipo = 'receber' then pago else -pago end) from a), 0) as saldo_caixa)
  select case when not tem_financeiro() then null else jsonb_build_object(
    'valor_contratado', valor_contratado, 'aditivos', aditivos, 'a_receber_total', a_receber_total, 'recebido', recebido,
    'custo_lancado', custo_lancado, 'pago', pago, 'saldo_caixa', saldo_caixa) end
  from t
$$;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['clausula', 'contrato', 'etapa', 'material', 'material_evento', 'ficha', 'registro', 'foto', 'pendencia'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
  end loop;
  foreach t in array array['clausula', 'clausula_versao', 'contrato', 'etapa', 'etapa_historico', 'material', 'material_evento',
                           'ficha', 'registro', 'foto', 'pendencia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Escritório (administrador e administrativo): tudo. Campo: só obras atribuídas.
grant select, insert, update on public.clausula, public.contrato to authenticated;
grant select on public.clausula_versao to authenticated;
create policy clausula_adm on public.clausula for all to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy clausula_versao_adm on public.clausula_versao for select to authenticated using (eh_equipe_adm());
create policy contrato_adm on public.contrato for all to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

grant select, insert, update, delete on public.etapa to authenticated;
create policy etapa_ler on public.etapa for select to authenticated using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy etapa_incluir on public.etapa for insert to authenticated with check (eh_equipe_adm());
create policy etapa_apagar on public.etapa for delete to authenticated using (eh_equipe_adm());
create policy etapa_editar on public.etapa for update to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)))
  with check (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
grant select on public.etapa_historico to authenticated;
create policy etapa_hist_ler on public.etapa_historico for select to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra((select obra_id from etapa where id = etapa_id))));

grant select, insert, update on public.material to authenticated;
grant select, insert on public.material_evento to authenticated;
create policy material_ler on public.material for select to authenticated using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy material_gravar on public.material for insert to authenticated with check (eh_equipe_adm());
create policy material_editar on public.material for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy mat_ev_ler on public.material_evento for select to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra((select obra_id from material where id = material_id))));
-- Campo registra o recebimento na obra (entrega/devolução); compra é do escritório.
create policy mat_ev_incluir on public.material_evento for insert to authenticated
  with check (eh_equipe_adm() or (meu_papel() = 'campo' and tipo in ('entrega', 'devolucao') and lancamento_id is null
              and membro_da_obra((select obra_id from material where id = material_id))));

grant select, insert, update, delete on public.ficha to authenticated;
create policy ficha_adm on public.ficha for all to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy ficha_campo on public.ficha for select to authenticated using (meu_papel() = 'campo' and estado = 'liberada' and membro_da_obra(obra_id));

grant select, insert, update on public.registro, public.pendencia to authenticated;
grant select, insert, update, delete on public.foto to authenticated;
create policy registro_ler on public.registro for select to authenticated using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy registro_incluir on public.registro for insert to authenticated
  with check ((eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id))) and tipo <> 'sistema' and publicado_em is null);
create policy registro_editar on public.registro for update to authenticated
  using (eh_equipe_adm() or (autor_id = auth.uid() and membro_da_obra(obra_id))) with check (tipo <> 'sistema' and (eh_equipe_adm() or publicado_em is null));
create policy foto_ler on public.foto for select to authenticated using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy foto_incluir on public.foto for insert to authenticated
  with check ((eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id))) and publicada_em is null);
create policy foto_editar on public.foto for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy foto_apagar on public.foto for delete to authenticated using (eh_equipe_adm() and publicada_em is null);
create policy pendencia_ler on public.pendencia for select to authenticated using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy pendencia_incluir on public.pendencia for insert to authenticated with check (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy pendencia_editar on public.pendencia for update to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)))
  with check (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));

grant select on public.v_material to authenticated;
revoke all on public.v_material from anon;

-- Campo envia e vê fotos só das obras atribuídas (pasta obras/<obra>/fotos/).
create or replace function public.obra_da_pasta(p_nome text)
returns uuid language plpgsql immutable as $$
begin
  return (string_to_array(p_nome, '/'))[2]::uuid;
exception when others then return null;
end $$;
grant execute on function public.obra_da_pasta(text) to authenticated;
create policy "fotos_campo_ler" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = 'obras' and (storage.foldername(name))[3] = 'fotos'
         and public.meu_papel() = 'campo' and public.membro_da_obra(public.obra_da_pasta(name)));
create policy "fotos_campo_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = 'obras' and (storage.foldername(name))[3] = 'fotos'
              and public.meu_papel() = 'campo' and public.membro_da_obra(public.obra_da_pasta(name)));

grant execute on function
  public.emitir_contrato(uuid), public.registrar_assinatura_contrato(uuid, date, text),
  public.definir_linha_base(uuid, boolean), public.progresso_obra(uuid),
  public.material_pagamentos(uuid), public.alertas_materiais(uuid),
  public.liberar_ficha(uuid), public.nova_revisao_ficha(uuid, jsonb, text),
  public.converter_proposta(uuid), public.liberar_obra(uuid)
to authenticated;
