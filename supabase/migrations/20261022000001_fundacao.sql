-- =====================================================================
-- ROSAE · Etapa 1 · Fundação + financeiro essencial
-- Regras:
--  * dinheiro sempre NUMERIC(14,2), nunca ponto flutuante;
--  * padrão é negar: RLS ligada em todas as tabelas, cliente não lê tabela nenhuma;
--  * nada com valor é apagado: cancelamento e estorno geram registro novo;
--  * toda tabela crítica grava auditoria (quem, quando, antes, depois).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.papel_usuario as enum ('administrador', 'administrativo', 'campo', 'cliente');
create type public.tipo_conta as enum ('receber', 'pagar');
create type public.natureza_movimento as enum ('entrada', 'saida');
create type public.escopo_financeiro as enum ('obra', 'empresa');

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- Contadores para códigos legíveis (OBR-2026-001, CR-000001...)
create table public.contador (
  chave text primary key,
  valor integer not null default 0
);
alter table public.contador enable row level security;

create or replace function public.proximo_numero(p_chave text)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into contador (chave, valor) values (p_chave, 1)
  on conflict (chave) do update set valor = contador.valor + 1
  returning valor into v;
  return v;
end $$;
revoke all on function public.proximo_numero(text) from public;

-- ---------------------------------------------------------------------
-- Empresa (registro único) e usuários
-- ---------------------------------------------------------------------
create table public.empresa (
  id uuid primary key default gen_random_uuid(),
  unico boolean not null default true unique check (unico),
  nome_fantasia text not null default 'ROSAE Engenharia & Estruturas',
  razao_social text,
  cnpj text,
  data_inicio_cnpj date,
  responsavel_tecnico text not null default 'Eng. Rhuann Rosa',
  registro_profissional text default 'CREA-RJ 2025104534',
  registro_conferido boolean not null default false,
  registro_conferido_em timestamptz,
  registro_conferido_por uuid,
  endereco text,
  telefone text,
  email text,
  site text default 'rosaeengenharia.com',
  instagram text,
  frase_institucional text default 'Projetamos para funcionar no cálculo. E principalmente na obra.',
  meta_recebimentos_mensal numeric(14,2) default 4000.00 check (meta_recebimentos_mensal is null or meta_recebimentos_mensal >= 0),
  meta_vendas_mensal numeric(14,2) check (meta_vendas_mensal is null or meta_vendas_mensal >= 0),
  provisao_impostos_pct numeric(5,2) check (provisao_impostos_pct between 0 and 100),
  reserva_pct numeric(5,2) check (reserva_pct between 0 and 100),
  -- Enquanto for nulo, todo resultado aparece como "gerencial (estimado)".
  regra_reconhecimento text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger empresa_atualizado before update on public.empresa
  for each row execute function public.tocar_atualizado_em();

-- Mudou o registro profissional: volta a "não conferido".
create or replace function public.empresa_registro_reconferir()
returns trigger language plpgsql as $$
begin
  if new.registro_profissional is distinct from old.registro_profissional then
    new.registro_conferido := false;
    new.registro_conferido_em := null;
    new.registro_conferido_por := null;
  elsif new.registro_conferido and not old.registro_conferido then
    new.registro_conferido_em := now();
    new.registro_conferido_por := auth.uid();
  elsif not new.registro_conferido then
    new.registro_conferido_em := null;
    new.registro_conferido_por := null;
  end if;
  return new;
end $$;
create trigger empresa_reconferir before update on public.empresa
  for each row execute function public.empresa_registro_reconferir();

insert into public.empresa default values;

create table public.usuario (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text,
  papel public.papel_usuario not null,
  acesso_financeiro boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger usuario_atualizado before update on public.usuario
  for each row execute function public.tocar_atualizado_em();

-- Funções de permissão. SECURITY DEFINER para poderem ler "usuario"
-- sem recursão de políticas; todas olham só para o próprio auth.uid().
create or replace function public.meu_papel()
returns public.papel_usuario language sql stable security definer set search_path = public as $$
  select papel from usuario where id = auth.uid() and ativo
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'administrador' from usuario where id = auth.uid() and ativo), false)
$$;

create or replace function public.eh_equipe_adm()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('administrador', 'administrativo') from usuario where id = auth.uid() and ativo), false)
$$;

create or replace function public.eh_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('administrador', 'administrativo', 'campo') from usuario where id = auth.uid() and ativo), false)
$$;

create or replace function public.tem_financeiro()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select papel = 'administrador' or (papel = 'administrativo' and acesso_financeiro)
    from usuario where id = auth.uid() and ativo
  ), false)
$$;

-- Primeiro acesso: só funciona enquanto não existe nenhum administrador.
-- O cadastro aberto fica desligado no Supabase, então apenas contas criadas
-- pelo dono no painel conseguem chegar aqui.
create or replace function public.reivindicar_administrador(p_nome text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if auth.uid() is null then
    raise exception 'Faça login primeiro.';
  end if;
  perform pg_advisory_xact_lock(hashtext('reivindicar_administrador'));
  if exists (select 1 from usuario where papel = 'administrador') then
    raise exception 'Já existe um administrador. Peça acesso a ele.';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into usuario (id, nome, email, papel, acesso_financeiro)
  values (auth.uid(), coalesce(nullif(trim(p_nome), ''), v_email, 'Administrador'), v_email, 'administrador', true)
  on conflict (id) do update set papel = 'administrador', acesso_financeiro = true, ativo = true;
end $$;

create or replace function public.existe_administrador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuario where papel = 'administrador')
$$;

-- ---------------------------------------------------------------------
-- Pessoas: um cadastro, vários papéis
-- ---------------------------------------------------------------------
create table public.pessoa (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  tipo_pessoa text not null default 'fisica' check (tipo_pessoa in ('fisica', 'juridica')),
  nome text not null check (length(trim(nome)) > 0),
  documento text,
  telefone text,
  email text,
  eh_cliente boolean not null default false,
  eh_fornecedor boolean not null default false,
  eh_prestador boolean not null default false,
  especialidade text,
  chave_pix text,
  endereco text,
  observacoes text,
  arquivado boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
create index pessoa_nome_idx on public.pessoa (lower(nome));
create index pessoa_email_idx on public.pessoa (lower(email));
create index pessoa_tel_idx on public.pessoa (regexp_replace(coalesce(telefone, ''), '\D', '', 'g'));
create trigger pessoa_atualizado before update on public.pessoa
  for each row execute function public.tocar_atualizado_em();

create or replace function public.pessoa_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.codigo := 'PES-' || lpad(proximo_numero('pessoa')::text, 5, '0');
  end if;
  return new;
end $$;
create trigger pessoa_codigo before insert on public.pessoa
  for each row execute function public.pessoa_codigo();

-- Possíveis duplicados por e-mail, telefone ou documento (aviso antes de salvar).
create or replace function public.pessoas_semelhantes(p_email text, p_telefone text, p_documento text, p_ignorar uuid default null)
returns setof public.pessoa language sql stable as $$
  select * from pessoa p
  where (p_ignorar is null or p.id <> p_ignorar)
    and not p.arquivado
    and (
      (nullif(trim(p_email), '') is not null and lower(p.email) = lower(trim(p_email)))
      or (length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) >= 8
          and right(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), 9)
            = right(regexp_replace(p_telefone, '\D', '', 'g'), 9))
      or (length(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g')) >= 11
          and regexp_replace(coalesce(p.documento, ''), '\D', '', 'g') = regexp_replace(p_documento, '\D', '', 'g'))
    )
  limit 5
$$;

-- ---------------------------------------------------------------------
-- Obras: Obra → Ambiente → Serviço (etapas chegam na Etapa 4)
-- ---------------------------------------------------------------------
create table public.obra (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nome text not null check (length(trim(nome)) > 0),
  cliente_id uuid references public.pessoa (id),
  tipo_servico text,
  endereco text,
  status text not null default 'contratada' check (status in (
    'em_negociacao', 'aprovada', 'contratada', 'em_execucao',
    'concluida_fisicamente', 'encerrada_financeiramente', 'cancelada')),
  data_inicio date,
  data_previsao_fim date,
  data_conclusao date,
  observacoes text,
  arquivado boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
create trigger obra_atualizado before update on public.obra
  for each row execute function public.tocar_atualizado_em();

create or replace function public.obra_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ano text := to_char(coalesce(new.data_inicio, (now() at time zone 'America/Sao_Paulo')::date), 'YYYY');
begin
  if new.codigo is null then
    new.codigo := 'OBR-' || v_ano || '-' || lpad(proximo_numero('obra-' || v_ano)::text, 3, '0');
  end if;
  return new;
end $$;
create trigger obra_codigo before insert on public.obra
  for each row execute function public.obra_codigo();

-- Valores do contrato ficam fora da tabela obra: quem não tem financeiro não os vê.
create table public.obra_financeiro (
  obra_id uuid primary key references public.obra (id) on delete cascade,
  modelo_contratacao text check (modelo_contratacao in ('preco_fechado', 'administracao', 'projeto', 'diaria', 'outro')),
  valor_contratado numeric(14,2) not null default 0 check (valor_contratado >= 0),
  data_contratacao date,
  observacoes text,
  atualizado_em timestamptz not null default now()
);
create trigger obra_fin_atualizado before update on public.obra_financeiro
  for each row execute function public.tocar_atualizado_em();

create table public.membro_obra (
  obra_id uuid not null references public.obra (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  papel text not null default 'campo' check (papel in ('campo', 'cliente', 'administrativo')),
  criado_em timestamptz not null default now(),
  primary key (obra_id, usuario_id)
);

create or replace function public.membro_da_obra(p_obra uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membro_obra m join usuario u on u.id = m.usuario_id
                 where m.obra_id = p_obra and m.usuario_id = auth.uid() and u.ativo)
$$;

create table public.ambiente (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index ambiente_obra_idx on public.ambiente (obra_id);

create table public.servico (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  descricao text,
  ordem integer not null default 0,
  arquivado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index servico_obra_idx on public.servico (obra_id);

-- Um serviço pode atender vários ambientes; o valor fica só no serviço.
create table public.servico_ambiente (
  servico_id uuid not null references public.servico (id) on delete cascade,
  ambiente_id uuid not null references public.ambiente (id) on delete cascade,
  primary key (servico_id, ambiente_id)
);

create or replace function public.servico_ambiente_mesma_obra()
returns trigger language plpgsql as $$
begin
  if (select obra_id from servico where id = new.servico_id)
     is distinct from (select obra_id from ambiente where id = new.ambiente_id) then
    raise exception 'Serviço e ambiente precisam ser da mesma obra.';
  end if;
  return new;
end $$;
create trigger servico_ambiente_check before insert or update on public.servico_ambiente
  for each row execute function public.servico_ambiente_mesma_obra();

-- ---------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------
create table public.categoria (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo public.tipo_conta not null,
  -- Natureza decide em qual número do painel o valor entra.
  natureza text not null check (natureza in (
    'receita_servico', 'reembolso_cliente', 'rendimento', 'aporte', 'outras_entradas',
    'custo_material', 'custo_mao_obra', 'custo_outros',
    'despesa_empresa', 'tributo', 'pro_labore', 'retirada', 'outras_saidas')),
  ativo boolean not null default true,
  ordem integer not null default 0,
  unique (nome, tipo)
);

insert into public.categoria (nome, tipo, natureza, ordem) values
  ('Honorários de projeto', 'receber', 'receita_servico', 1),
  ('Execução de obra / reforma', 'receber', 'receita_servico', 2),
  ('Gestão e acompanhamento', 'receber', 'receita_servico', 3),
  ('Reembolso de material pelo cliente', 'receber', 'reembolso_cliente', 4),
  ('Rendimento de aplicação', 'receber', 'rendimento', 5),
  ('Aporte do sócio', 'receber', 'aporte', 6),
  ('Outras entradas', 'receber', 'outras_entradas', 9),
  ('Material de obra', 'pagar', 'custo_material', 1),
  ('Parceiro / prestador', 'pagar', 'custo_mao_obra', 2),
  ('Frete, caçamba e locação', 'pagar', 'custo_outros', 3),
  ('Software e assinaturas', 'pagar', 'despesa_empresa', 4),
  ('Combustível e deslocamento', 'pagar', 'despesa_empresa', 5),
  ('Marketing e site', 'pagar', 'despesa_empresa', 6),
  ('Contabilidade e taxas', 'pagar', 'despesa_empresa', 7),
  ('Impostos', 'pagar', 'tributo', 8),
  ('Pró-labore', 'pagar', 'pro_labore', 9),
  ('Retirada de lucro', 'pagar', 'retirada', 10),
  ('Outras saídas', 'pagar', 'outras_saidas', 11);

create table public.conta_bancaria (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  instituicao text,
  tipo text not null default 'corrente' check (tipo in ('corrente', 'cofrinho', 'caixa', 'outro')),
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo_inicial date not null default (now() at time zone 'America/Sao_Paulo')::date,
  ativa boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

insert into public.conta_bancaria (nome, instituicao, tipo, ordem) values
  ('Conta principal', 'Mercado Pago', 'corrente', 1),
  ('Cofrinho Reserva', 'Mercado Pago', 'cofrinho', 2),
  ('Cofrinho Impostos', 'Mercado Pago', 'cofrinho', 3),
  ('Cofrinho Obras', 'Mercado Pago', 'cofrinho', 4);

-- Conta a receber ou a pagar. A despesa existe uma vez, aqui.
create table public.lancamento (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  tipo public.tipo_conta not null,
  descricao text not null check (length(trim(descricao)) > 0),
  pessoa_id uuid references public.pessoa (id),
  categoria_id uuid not null references public.categoria (id),
  escopo public.escopo_financeiro not null,
  obra_id uuid references public.obra (id),
  servico_id uuid references public.servico (id),
  valor_total numeric(14,2) not null check (valor_total > 0),
  data_competencia date not null,
  documento_ref text,
  observacoes text,
  cancelado boolean not null default false,
  cancelado_motivo text,
  cancelado_em timestamptz,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint lancamento_escopo_obra check ((escopo = 'obra') = (obra_id is not null)),
  constraint lancamento_servico_obra check (servico_id is null or obra_id is not null),
  constraint lancamento_cancelamento check (not cancelado or length(trim(coalesce(cancelado_motivo, ''))) > 0)
);
create index lancamento_obra_idx on public.lancamento (obra_id);
create index lancamento_tipo_comp_idx on public.lancamento (tipo, data_competencia);
create trigger lancamento_atualizado before update on public.lancamento
  for each row execute function public.tocar_atualizado_em();

create or replace function public.lancamento_validar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo_cat public.tipo_conta;
begin
  select tipo into v_tipo_cat from categoria where id = new.categoria_id;
  if v_tipo_cat is distinct from new.tipo then
    raise exception 'A categoria escolhida não é do tipo %.', new.tipo;
  end if;
  if new.servico_id is not null
     and (select obra_id from servico where id = new.servico_id) is distinct from new.obra_id then
    raise exception 'O serviço precisa ser da obra escolhida.';
  end if;
  if tg_op = 'INSERT' then
    if new.codigo is null then
      new.codigo := case new.tipo when 'receber' then 'CR-' else 'CP-' end
                    || lpad(proximo_numero('lancamento-' || new.tipo)::text, 6, '0');
    end if;
  else
    if new.tipo <> old.tipo then
      raise exception 'Não é possível trocar entre a receber e a pagar. Cancele e crie outro.';
    end if;
    if old.cancelado and new.cancelado is false then
      raise exception 'Lançamento cancelado não pode ser reaberto. Crie um novo.';
    end if;
    if new.cancelado and not old.cancelado then
      if exists (select 1 from v_parcela_interna where lancamento_id = new.id and pago <> 0) then
        raise exception 'Há valores pagos/recebidos neste lançamento. Estorne os movimentos antes de cancelar.';
      end if;
      new.cancelado_em := now();
    end if;
    if new.valor_total <> old.valor_total
       and exists (select 1 from movimento m join parcela p on p.id = m.parcela_id where p.lancamento_id = new.id) then
      raise exception 'O valor não pode mudar depois de haver pagamento/recebimento. Estorne ou crie um lançamento complementar.';
    end if;
  end if;
  return new;
end $$;

create table public.parcela (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.lancamento (id) on delete restrict,
  numero integer not null check (numero > 0),
  valor numeric(14,2) not null check (valor > 0),
  vencimento date not null,
  unique (lancamento_id, numero)
);
create index parcela_venc_idx on public.parcela (vencimento);

-- Dinheiro que de fato entrou ou saiu. Nunca é alterado nem apagado.
create table public.movimento (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  conta_bancaria_id uuid not null references public.conta_bancaria (id),
  natureza public.natureza_movimento not null,
  valor numeric(14,2) not null check (valor > 0),
  data date not null,
  parcela_id uuid references public.parcela (id),
  transferencia_id uuid,
  estorno_de uuid unique references public.movimento (id),
  descricao text,
  chave_idempotencia text unique,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  constraint movimento_origem check (num_nonnulls(parcela_id, transferencia_id, estorno_de) = 1)
);
create index movimento_data_idx on public.movimento (data);
create index movimento_parcela_idx on public.movimento (parcela_id);

-- Visão interna (sem RLS própria, usada por gatilhos) do quanto já foi liquidado em cada parcela.
create or replace view public.v_parcela_interna as
select p.id, p.lancamento_id,
  coalesce(sum(case when m.estorno_de is null then m.valor else 0 end), 0)
  - coalesce((select sum(e.valor) from movimento e join movimento o on o.id = e.estorno_de where o.parcela_id = p.id), 0) as pago
from parcela p
left join movimento m on m.parcela_id = p.id
group by p.id, p.lancamento_id;

create trigger lancamento_validar before insert or update on public.lancamento
  for each row execute function public.lancamento_validar();

-- Soma das parcelas = valor total (verificado no fim da transação).
create or replace function public.parcelas_somam_total()
returns trigger language plpgsql as $$
declare v_id uuid; v_total numeric(14,2); v_soma numeric(14,2);
begin
  if tg_table_name = 'lancamento' then
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')::uuid;
  else
    v_id := coalesce(to_jsonb(new)->>'lancamento_id', to_jsonb(old)->>'lancamento_id')::uuid;
  end if;
  select valor_total into v_total from lancamento where id = v_id;
  if v_total is null then return null; end if;
  select coalesce(sum(valor), 0) into v_soma from parcela where lancamento_id = v_id;
  if v_soma <> v_total then
    raise exception 'A soma das parcelas (%) precisa ser igual ao valor total (%).', v_soma, v_total;
  end if;
  return null;
end $$;
create constraint trigger lancamento_soma after insert or update on public.lancamento
  deferrable initially deferred for each row execute function public.parcelas_somam_total();
create constraint trigger parcela_soma after insert or update or delete on public.parcela
  deferrable initially deferred for each row execute function public.parcelas_somam_total();

create or replace function public.parcela_protegida()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from movimento where parcela_id = old.id) then
    if tg_op = 'DELETE' or new.valor <> old.valor or new.lancamento_id <> old.lancamento_id then
      raise exception 'Parcela com pagamento/recebimento registrado não pode mudar de valor nem ser removida.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger parcela_protegida before update or delete on public.parcela
  for each row execute function public.parcela_protegida();

create or replace function public.movimento_validar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo public.tipo_conta; v_cancelado boolean; v_valor numeric(14,2); v_pago numeric(14,2);
  o public.movimento;
begin
  if new.parcela_id is not null then
    select l.tipo, l.cancelado, p.valor into v_tipo, v_cancelado, v_valor
    from parcela p join lancamento l on l.id = p.lancamento_id where p.id = new.parcela_id;
    if v_cancelado then
      raise exception 'Lançamento cancelado não recebe pagamento.';
    end if;
    if (v_tipo = 'receber' and new.natureza <> 'entrada') or (v_tipo = 'pagar' and new.natureza <> 'saida') then
      raise exception 'Conta a receber gera entrada; conta a pagar gera saída.';
    end if;
    select pago into v_pago from v_parcela_interna where id = new.parcela_id;
    if v_pago + new.valor > v_valor then
      raise exception 'Valor maior que o saldo da parcela (saldo: %).', v_valor - v_pago;
    end if;
  elsif new.estorno_de is not null then
    select * into o from movimento where id = new.estorno_de;
    if o.estorno_de is not null then
      raise exception 'Não se estorna um estorno. Registre um novo lançamento.';
    end if;
    if o.transferencia_id is not null then
      raise exception 'Transferência se desfaz com outra transferência no sentido contrário.';
    end if;
    if new.valor <> o.valor or new.conta_bancaria_id <> o.conta_bancaria_id or new.natureza = o.natureza then
      raise exception 'O estorno precisa ter o mesmo valor e conta, em sentido contrário.';
    end if;
  end if;
  if new.codigo is null then
    new.codigo := 'MOV-' || lpad(proximo_numero('movimento')::text, 6, '0');
  end if;
  return new;
end $$;
create trigger movimento_validar before insert on public.movimento
  for each row execute function public.movimento_validar();

create or replace function public.bloquear_alteracao()
returns trigger language plpgsql as $$
begin
  raise exception '% não pode ser alterado nem apagado. Use estorno.', tg_table_name;
end $$;
create trigger movimento_imutavel before update or delete on public.movimento
  for each row execute function public.bloquear_alteracao();

-- Transferência: dois movimentos com o mesmo transferencia_id, um de cada lado.
create or replace function public.transferencia_par()
returns trigger language plpgsql as $$
declare v_qtd integer; v_ent numeric; v_sai numeric; v_contas integer;
begin
  if new.transferencia_id is null then return null; end if;
  select count(*), sum(valor) filter (where natureza = 'entrada'), sum(valor) filter (where natureza = 'saida'),
         count(distinct conta_bancaria_id)
    into v_qtd, v_ent, v_sai, v_contas
  from movimento where transferencia_id = new.transferencia_id;
  if v_qtd <> 2 or v_ent is distinct from v_sai or v_contas <> 2 then
    raise exception 'Transferência precisa de uma saída e uma entrada de mesmo valor em contas diferentes.';
  end if;
  return null;
end $$;
create constraint trigger movimento_transferencia after insert on public.movimento
  deferrable initially deferred for each row execute function public.transferencia_par();

-- Arquivos (comprovantes, notas). O binário fica no Storage privado.
create table public.arquivo (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'documentos',
  caminho text not null unique,
  nome_original text not null,
  mime text,
  tamanho bigint,
  natureza text not null default 'comprovante' check (natureza in ('comprovante', 'nota_fiscal', 'recibo', 'contrato', 'outro')),
  lancamento_id uuid references public.lancamento (id),
  movimento_id uuid references public.movimento (id),
  obra_id uuid references public.obra (id),
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  constraint arquivo_vinculo check (num_nonnulls(lancamento_id, movimento_id, obra_id) >= 1),
  constraint arquivo_pasta check (caminho like 'financeiro/%' or caminho like 'obras/%')
);
create index arquivo_lanc_idx on public.arquivo (lancamento_id);

-- Metas mensais específicas (sobrepõem a meta padrão da empresa).
create table public.meta (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('vendas', 'recebimentos')),
  mes date not null check (extract(day from mes) = 1),
  valor numeric(14,2) not null check (valor >= 0),
  unique (tipo, mes)
);

-- ---------------------------------------------------------------------
-- Visões com segurança do chamador (respeitam RLS)
-- ---------------------------------------------------------------------
create or replace view public.v_parcela with (security_invoker = true) as
select
  p.id, p.lancamento_id, p.numero, p.valor, p.vencimento,
  (select count(*) from parcela x where x.lancamento_id = p.lancamento_id) as total_parcelas,
  l.codigo, l.tipo, l.descricao, l.pessoa_id, l.categoria_id, l.escopo, l.obra_id, l.servico_id,
  l.data_competencia, l.cancelado, l.documento_ref,
  pe.nome as pessoa_nome, c.nome as categoria_nome, c.natureza as categoria_natureza,
  o.codigo as obra_codigo, o.nome as obra_nome,
  coalesce(pg.pago, 0) as pago,
  p.valor - coalesce(pg.pago, 0) as saldo,
  case
    when l.cancelado then 'cancelada'
    when p.valor - coalesce(pg.pago, 0) = 0 then 'liquidada'
    when p.vencimento < (now() at time zone 'America/Sao_Paulo')::date then 'vencida'
    when coalesce(pg.pago, 0) > 0 then 'parcial'
    else 'aberta'
  end as situacao,
  (select max(m.data) from movimento m where m.parcela_id = p.id and m.estorno_de is null) as ultima_liquidacao
from parcela p
join lancamento l on l.id = p.lancamento_id
join categoria c on c.id = l.categoria_id
left join pessoa pe on pe.id = l.pessoa_id
left join obra o on o.id = l.obra_id
left join lateral (
  select coalesce(sum(m.valor), 0)
       - coalesce((select sum(e.valor) from movimento e join movimento o2 on o2.id = e.estorno_de where o2.parcela_id = p.id), 0) as pago
  from movimento m where m.parcela_id = p.id
) pg on true;

create or replace view public.v_movimento with (security_invoker = true) as
select
  m.*,
  cb.nome as conta_nome,
  case when m.natureza = 'entrada' then m.valor else -m.valor end as valor_assinado,
  coalesce(l.id, lo.id) as lancamento_id,
  coalesce(l.codigo, lo.codigo) as lancamento_codigo,
  coalesce(l.descricao, lo.descricao, m.descricao) as lancamento_descricao,
  coalesce(l.escopo, lo.escopo) as escopo,
  coalesce(l.obra_id, lo.obra_id) as obra_id,
  coalesce(c.natureza, co.natureza, 'transferencia') as categoria_natureza,
  coalesce(c.nome, co.nome, 'Transferência entre contas') as categoria_nome,
  (select 1 from movimento e where e.estorno_de = m.id) is not null as estornado
from movimento m
join conta_bancaria cb on cb.id = m.conta_bancaria_id
left join parcela p on p.id = m.parcela_id
left join lancamento l on l.id = p.lancamento_id
left join categoria c on c.id = l.categoria_id
left join movimento orig on orig.id = m.estorno_de
left join parcela po on po.id = orig.parcela_id
left join lancamento lo on lo.id = po.lancamento_id
left join categoria co on co.id = lo.categoria_id;

create or replace view public.v_saldo_conta with (security_invoker = true) as
select cb.id, cb.nome, cb.instituicao, cb.tipo, cb.ativa, cb.ordem, cb.saldo_inicial,
  cb.saldo_inicial + coalesce(sum(case when m.natureza = 'entrada' then m.valor else -m.valor end), 0) as saldo
from conta_bancaria cb
left join movimento m on m.conta_bancaria_id = cb.id
group by cb.id;

-- ---------------------------------------------------------------------
-- Operações (uma transação cada)
-- ---------------------------------------------------------------------
-- p: {tipo, descricao, pessoa_id, categoria_id, escopo, obra_id, servico_id,
--     valor_total, data_competencia, documento_ref, observacoes,
--     parcelas: [{numero, valor, vencimento}]}
create or replace function public.salvar_lancamento(p jsonb, p_id uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare v_id uuid; v_parc jsonb;
begin
  if not tem_financeiro() then
    raise exception 'Sem permissão para o financeiro.';
  end if;
  if p_id is null then
    insert into lancamento (tipo, descricao, pessoa_id, categoria_id, escopo, obra_id, servico_id,
                            valor_total, data_competencia, documento_ref, observacoes)
    values ((p->>'tipo')::tipo_conta, p->>'descricao', nullif(p->>'pessoa_id', '')::uuid,
            (p->>'categoria_id')::uuid, (p->>'escopo')::escopo_financeiro,
            nullif(p->>'obra_id', '')::uuid, nullif(p->>'servico_id', '')::uuid,
            (p->>'valor_total')::numeric, (p->>'data_competencia')::date,
            p->>'documento_ref', p->>'observacoes')
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
      observacoes = p->>'observacoes'
    where id = p_id and not cancelado
    returning id into v_id;
    if v_id is null then
      raise exception 'Lançamento não encontrado ou cancelado.';
    end if;
  end if;

  if p ? 'parcelas' then
    -- Parcelas com movimento ficam; as demais são substituídas.
    if p_id is not null then
      if exists (select 1 from movimento m join parcela pa on pa.id = m.parcela_id where pa.lancamento_id = v_id) then
        -- só permite ajustar vencimentos das parcelas existentes
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

create or replace function public.cancelar_lancamento(p_id uuid, p_motivo text)
returns void language plpgsql set search_path = public as $$
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  update lancamento set cancelado = true, cancelado_motivo = p_motivo where id = p_id;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
end $$;

-- Registra recebimento/pagamento de uma parcela. A chave evita duplicar em clique duplo ou nova tentativa.
create or replace function public.registrar_liquidacao(
  p_parcela uuid, p_conta uuid, p_valor numeric, p_data date, p_descricao text, p_chave text)
returns uuid language plpgsql set search_path = public as $$
declare v_id uuid; v_tipo tipo_conta;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  select id into v_id from movimento where chave_idempotencia = p_chave;
  if v_id is not null then return v_id; end if;
  select l.tipo into v_tipo from parcela p join lancamento l on l.id = p.lancamento_id where p.id = p_parcela;
  if v_tipo is null then raise exception 'Parcela não encontrada.'; end if;
  insert into movimento (conta_bancaria_id, natureza, valor, data, parcela_id, descricao, chave_idempotencia)
  values (p_conta, case v_tipo when 'receber' then 'entrada'::natureza_movimento else 'saida'::natureza_movimento end,
          round(p_valor, 2), p_data, p_parcela, p_descricao, p_chave)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.estornar_movimento(p_movimento uuid, p_data date, p_motivo text)
returns uuid language plpgsql set search_path = public as $$
declare o movimento; v_id uuid;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Informe o motivo do estorno.'; end if;
  select * into o from movimento where id = p_movimento;
  if o.id is null then raise exception 'Movimento não encontrado.'; end if;
  select id into v_id from movimento where estorno_de = o.id;
  if v_id is not null then return v_id; end if;
  insert into movimento (conta_bancaria_id, natureza, valor, data, estorno_de, descricao)
  values (o.conta_bancaria_id, case o.natureza when 'entrada' then 'saida'::natureza_movimento else 'entrada'::natureza_movimento end,
          o.valor, p_data, o.id, 'Estorno: ' || p_motivo)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.registrar_transferencia(
  p_origem uuid, p_destino uuid, p_valor numeric, p_data date, p_descricao text, p_chave text)
returns uuid language plpgsql set search_path = public as $$
declare v_t uuid; v_existente uuid;
begin
  if not tem_financeiro() then raise exception 'Sem permissão para o financeiro.'; end if;
  if p_origem = p_destino then raise exception 'Escolha contas diferentes.'; end if;
  select transferencia_id into v_existente from movimento where chave_idempotencia = p_chave || ':saida';
  if v_existente is not null then return v_existente; end if;
  v_t := gen_random_uuid();
  insert into movimento (conta_bancaria_id, natureza, valor, data, transferencia_id, descricao, chave_idempotencia) values
    (p_origem, 'saida', round(p_valor, 2), p_data, v_t, coalesce(nullif(p_descricao, ''), 'Transferência entre contas'), p_chave || ':saida'),
    (p_destino, 'entrada', round(p_valor, 2), p_data, v_t, coalesce(nullif(p_descricao, ''), 'Transferência entre contas'), p_chave || ':entrada');
  return v_t;
end $$;

-- ---------------------------------------------------------------------
-- Painel: números com nome fixo e critério declarado
-- ---------------------------------------------------------------------
create or replace function public.painel_indicadores(p_inicio date, p_fim date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
  v_meta_rec numeric; v_meta_ven numeric;
begin
  if not tem_financeiro() then
    return jsonb_build_object('sem_permissao', true,
      'obras_ativas', (select count(*) from obra where not arquivado and status in ('contratada', 'em_execucao')));
  end if;

  select coalesce((select valor from meta where tipo = 'recebimentos' and mes = date_trunc('month', p_fim)::date), meta_recebimentos_mensal),
         coalesce((select valor from meta where tipo = 'vendas' and mes = date_trunc('month', p_fim)::date), meta_vendas_mensal)
    into v_meta_rec, v_meta_ven
  from empresa limit 1;

  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'hoje', hoje),
    'gerencial', (select regra_reconhecimento is null from empresa limit 1),
    'meta_recebimentos', v_meta_rec,
    'meta_vendas', v_meta_ven,
    'vendido', (select coalesce(sum(f.valor_contratado), 0) from obra_financeiro f join obra o on o.id = f.obra_id
                where o.status <> 'cancelada' and f.data_contratacao between p_inicio and p_fim),
    'recebido', (select coalesce(sum(valor_assinado), 0) from v_movimento
                 where data between p_inicio and p_fim and categoria_natureza in ('receita_servico', 'reembolso_cliente')),
    'outras_entradas', (select coalesce(sum(valor_assinado), 0) from v_movimento
                 where data between p_inicio and p_fim and categoria_natureza in ('rendimento', 'aporte', 'outras_entradas')),
    'pago_obras', (select coalesce(-sum(valor_assinado), 0) from v_movimento
                 where data between p_inicio and p_fim and categoria_natureza in ('custo_material', 'custo_mao_obra', 'custo_outros')),
    'pago_empresa', (select coalesce(-sum(valor_assinado), 0) from v_movimento
                 where data between p_inicio and p_fim and categoria_natureza in ('despesa_empresa', 'tributo', 'outras_saidas')),
    'retiradas', (select coalesce(-sum(valor_assinado), 0) from v_movimento
                 where data between p_inicio and p_fim and categoria_natureza in ('pro_labore', 'retirada')),
    'despesas_empresa_competencia', (select coalesce(sum(l.valor_total), 0) from lancamento l join categoria c on c.id = l.categoria_id
                 where not l.cancelado and l.tipo = 'pagar' and c.natureza in ('despesa_empresa', 'tributo', 'outras_saidas')
                   and l.data_competencia between p_inicio and p_fim),
    'a_receber', (select coalesce(sum(saldo), 0) from v_parcela where tipo = 'receber' and situacao in ('aberta', 'parcial', 'vencida')),
    'a_receber_vencido', (select coalesce(sum(saldo), 0) from v_parcela where tipo = 'receber' and situacao = 'vencida'),
    'a_receber_vencido_qtd', (select count(*) from v_parcela where tipo = 'receber' and situacao = 'vencida'),
    'a_pagar', (select coalesce(sum(saldo), 0) from v_parcela where tipo = 'pagar' and situacao in ('aberta', 'parcial', 'vencida')),
    'a_pagar_7_dias', (select coalesce(sum(saldo), 0) from v_parcela where tipo = 'pagar' and situacao in ('aberta', 'parcial', 'vencida') and vencimento <= hoje + 7),
    'a_pagar_7_dias_qtd', (select count(*) from v_parcela where tipo = 'pagar' and situacao in ('aberta', 'parcial', 'vencida') and vencimento <= hoje + 7),
    'saldo_contas', (select coalesce(sum(saldo), 0) from v_saldo_conta where ativa),
    'obras_ativas', (select count(*) from obra where not arquivado and status in ('contratada', 'em_execucao'))
  ) into r;
  return r;
end $$;

-- Série mensal para comparação (recebido x pago), 12 meses até p_fim.
create or replace function public.serie_mensal(p_fim date)
returns table (mes date, recebido numeric, pago numeric, vendido numeric)
language sql stable set search_path = public as $$
  with meses as (
    select generate_series(date_trunc('month', p_fim) - interval '11 months', date_trunc('month', p_fim), interval '1 month')::date as mes
  )
  select m.mes,
    coalesce((select sum(valor_assinado) from v_movimento v where date_trunc('month', v.data) = m.mes
              and v.categoria_natureza in ('receita_servico', 'reembolso_cliente')), 0),
    coalesce((select -sum(valor_assinado) from v_movimento v where date_trunc('month', v.data) = m.mes
              and v.categoria_natureza in ('custo_material', 'custo_mao_obra', 'custo_outros', 'despesa_empresa', 'tributo', 'outras_saidas')), 0),
    coalesce((select sum(f.valor_contratado) from obra_financeiro f join obra o on o.id = f.obra_id
              where o.status <> 'cancelada' and date_trunc('month', f.data_contratacao) = m.mes), 0)
  from meses m
  where tem_financeiro()
  order by m.mes
$$;

-- Resumo financeiro de uma obra.
create or replace function public.resumo_obra(p_obra uuid)
returns jsonb language sql stable set search_path = public as $$
  select case when not tem_financeiro() then null else jsonb_build_object(
    'valor_contratado', (select valor_contratado from obra_financeiro where obra_id = p_obra),
    'a_receber_total', (select coalesce(sum(valor), 0) from v_parcela where obra_id = p_obra and tipo = 'receber' and not cancelado),
    'recebido', (select coalesce(sum(valor_assinado), 0) from v_movimento where obra_id = p_obra and categoria_natureza in ('receita_servico', 'reembolso_cliente')),
    'custo_lancado', (select coalesce(sum(valor), 0) from v_parcela where obra_id = p_obra and tipo = 'pagar' and not cancelado),
    'pago', (select coalesce(-sum(valor_assinado), 0) from v_movimento where obra_id = p_obra and valor_assinado is not null and categoria_natureza like 'custo_%'),
    'saldo_caixa', (select coalesce(sum(valor_assinado), 0) from v_movimento where obra_id = p_obra)
  ) end
$$;

-- ---------------------------------------------------------------------
-- Auditoria (só inserção, gravada por gatilho)
-- ---------------------------------------------------------------------
create table public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text,
  acao text not null,
  usuario_id uuid,
  em timestamptz not null default now(),
  antes jsonb,
  depois jsonb
);
create index auditoria_reg_idx on public.auditoria (tabela, registro_id);

create or replace function public.auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'obra_id', to_jsonb(old)->>'obra_id');
  insert into auditoria (tabela, registro_id, acao, usuario_id, antes, depois)
  values (tg_table_name, v_id, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresa', 'usuario', 'pessoa', 'obra', 'obra_financeiro', 'membro_obra',
                           'ambiente', 'servico', 'categoria', 'conta_bancaria', 'lancamento', 'parcela',
                           'movimento', 'arquivo', 'meta'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
  end loop;
end $$;

create or replace function public.auditoria_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'Auditoria só aceita inclusão.';
end $$;
create trigger auditoria_imutavel before update or delete on public.auditoria
  for each row execute function public.auditoria_imutavel();
create trigger auditoria_sem_truncate before truncate on public.auditoria
  for each statement execute function public.auditoria_imutavel();
create trigger movimento_sem_truncate before truncate on public.movimento
  for each statement execute function public.bloquear_alteracao();

-- ---------------------------------------------------------------------
-- Permissões (RLS). Padrão: negar.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['contador', 'empresa', 'usuario', 'pessoa', 'obra', 'obra_financeiro', 'membro_obra',
                           'ambiente', 'servico', 'servico_ambiente', 'categoria', 'conta_bancaria',
                           'lancamento', 'parcela', 'movimento', 'arquivo', 'meta', 'auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Visitante sem login não acessa nada.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;

-- Empresa
grant select, update on public.empresa to authenticated;
create policy empresa_ler on public.empresa for select to authenticated using (eh_equipe());
create policy empresa_editar on public.empresa for update to authenticated using (eh_admin()) with check (eh_admin());

-- Usuários
grant select, insert, update on public.usuario to authenticated;
create policy usuario_ler on public.usuario for select to authenticated using (id = auth.uid() or eh_admin());
create policy usuario_incluir on public.usuario for insert to authenticated with check (eh_admin());
create policy usuario_editar on public.usuario for update to authenticated using (eh_admin()) with check (eh_admin());

-- Pessoas
grant select, insert, update on public.pessoa to authenticated;
create policy pessoa_ler on public.pessoa for select to authenticated using (eh_equipe_adm());
create policy pessoa_incluir on public.pessoa for insert to authenticated with check (eh_equipe_adm());
create policy pessoa_editar on public.pessoa for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

-- Obras: equipe administrativa vê todas; campo só as atribuídas. Cliente: nunca pela tabela.
grant select, insert, update on public.obra to authenticated;
create policy obra_ler on public.obra for select to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(id)));
create policy obra_incluir on public.obra for insert to authenticated with check (eh_equipe_adm());
create policy obra_editar on public.obra for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

grant select, insert, update on public.obra_financeiro to authenticated;
create policy obra_fin_ler on public.obra_financeiro for select to authenticated using (tem_financeiro());
create policy obra_fin_incluir on public.obra_financeiro for insert to authenticated with check (tem_financeiro());
create policy obra_fin_editar on public.obra_financeiro for update to authenticated using (tem_financeiro()) with check (tem_financeiro());

grant select, insert, delete on public.membro_obra to authenticated;
create policy membro_ler on public.membro_obra for select to authenticated using (eh_admin() or usuario_id = auth.uid());
create policy membro_incluir on public.membro_obra for insert to authenticated with check (eh_admin());
create policy membro_remover on public.membro_obra for delete to authenticated using (eh_admin());

grant select, insert, update, delete on public.ambiente, public.servico, public.servico_ambiente to authenticated;
create policy ambiente_ler on public.ambiente for select to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy ambiente_gravar on public.ambiente for all to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy servico_ler on public.servico for select to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra(obra_id)));
create policy servico_gravar on public.servico for all to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy serv_amb_ler on public.servico_ambiente for select to authenticated
  using (eh_equipe_adm() or (meu_papel() = 'campo' and membro_da_obra((select obra_id from servico s where s.id = servico_id))));
create policy serv_amb_gravar on public.servico_ambiente for all to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

-- Financeiro: só administrador ou administrativo com concessão "financeiro".
grant select, insert, update on public.categoria, public.conta_bancaria, public.lancamento, public.parcela, public.meta to authenticated;
grant delete on public.parcela, public.meta to authenticated;
grant select, insert on public.movimento, public.arquivo to authenticated;
do $$
declare t text;
begin
  foreach t in array array['categoria', 'conta_bancaria', 'lancamento', 'parcela', 'meta'] loop
    execute format('create policy %I on public.%I for all to authenticated using (tem_financeiro()) with check (tem_financeiro())', t || '_financeiro', t);
  end loop;
end $$;
create policy movimento_ler on public.movimento for select to authenticated using (tem_financeiro());
create policy movimento_incluir on public.movimento for insert to authenticated with check (tem_financeiro());
create policy arquivo_ler on public.arquivo for select to authenticated
  using (tem_financeiro() or (caminho like 'obras/%' and eh_equipe_adm()));
create policy arquivo_incluir on public.arquivo for insert to authenticated
  with check (tem_financeiro() or (caminho like 'obras/%' and eh_equipe_adm()));

grant select on public.v_parcela, public.v_movimento, public.v_saldo_conta to authenticated;
-- A visão interna não é exposta.
revoke all on public.v_parcela_interna from anon, authenticated;

-- Auditoria: só o administrador lê.
grant select on public.auditoria to authenticated;
create policy auditoria_ler on public.auditoria for select to authenticated using (eh_admin());

-- Funções liberadas para usuários logados
grant execute on function
  public.meu_papel(), public.eh_admin(), public.eh_equipe_adm(), public.eh_equipe(), public.tem_financeiro(),
  public.membro_da_obra(uuid), public.reivindicar_administrador(text), public.existe_administrador(),
  public.pessoas_semelhantes(text, text, text, uuid),
  public.salvar_lancamento(jsonb, uuid), public.cancelar_lancamento(uuid, text),
  public.registrar_liquidacao(uuid, uuid, numeric, date, text, text),
  public.estornar_movimento(uuid, date, text),
  public.registrar_transferencia(uuid, uuid, numeric, date, text, text),
  public.painel_indicadores(date, date), public.serie_mensal(date), public.resumo_obra(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- Armazenamento privado: pasta financeiro/ só para quem tem financeiro;
-- obras/ para a equipe administrativa. Nada é público.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 10485760)
on conflict (id) do nothing;

create policy "documentos_ler" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (
    ((storage.foldername(name))[1] = 'financeiro' and public.tem_financeiro())
    or ((storage.foldername(name))[1] = 'obras' and public.eh_equipe_adm())));
create policy "documentos_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (
    ((storage.foldername(name))[1] = 'financeiro' and public.tem_financeiro())
    or ((storage.foldername(name))[1] = 'obras' and public.eh_equipe_adm())));
