-- =====================================================================
-- ROSAE · Etapa 2 · Leads, biblioteca de serviços e propostas
--  * clique em WhatsApp é só um clique: nunca muda o funil sozinho;
--  * versão emitida de proposta é imutável; aceite aponta para a versão exata;
--  * custo interno fica em tabela separada e nunca vai para o cliente.
-- =====================================================================

-- Funções e tabelas novas não ficam liberadas por padrão para ninguém.
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------
-- Funil
-- ---------------------------------------------------------------------
create table public.estado_funil (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ordem integer not null default 0,
  tipo text not null default 'aberto' check (tipo in ('aberto', 'ganho', 'perdido', 'arquivado')),
  ativo boolean not null default true
);
insert into public.estado_funil (nome, ordem, tipo) values
  ('Novo contato', 1, 'aberto'),
  ('Aguardando informações', 2, 'aberto'),
  ('Visita ou levantamento', 3, 'aberto'),
  ('Proposta em preparação', 4, 'aberto'),
  ('Proposta enviada', 5, 'aberto'),
  ('Em negociação', 6, 'aberto'),
  ('Aprovada', 7, 'ganho'),
  ('Perdida', 8, 'perdido'),
  ('Arquivada', 9, 'arquivado');

create or replace function public.estado_funil_id(p_nome text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from estado_funil where nome = p_nome
$$;

create table public.oportunidade (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  pessoa_id uuid not null references public.pessoa (id),
  titulo text not null check (length(trim(titulo)) > 0),
  origem text not null default 'indicacao' check (origem in ('indicacao', 'site', 'instagram', 'whatsapp', 'telefone', 'outro')),
  indicado_por text,
  campanha text,
  utm jsonb,
  tipo_servico text,
  local_obra text,
  resumo text,
  estado_id uuid not null references public.estado_funil (id),
  estado_desde timestamptz not null default now(),
  proxima_acao text,
  proxima_acao_data date,
  motivo_perda text,
  valor_estimado numeric(14,2) check (valor_estimado is null or valor_estimado >= 0),
  arquivado boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
create index oportunidade_estado_idx on public.oportunidade (estado_id);
create index oportunidade_pessoa_idx on public.oportunidade (pessoa_id);
create trigger oportunidade_atualizado before update on public.oportunidade
  for each row execute function public.tocar_atualizado_em();

create table public.interacao (
  id uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references public.oportunidade (id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('nota', 'ligacao', 'whatsapp', 'email', 'visita', 'reuniao', 'site', 'sistema')),
  texto text not null check (length(trim(texto)) > 0),
  em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index interacao_op_idx on public.interacao (oportunidade_id, em desc);

create or replace function public.oportunidade_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  if tg_op = 'INSERT' and new.codigo is null then
    new.codigo := 'OPO-' || lpad(proximo_numero('oportunidade')::text, 5, '0');
  end if;
  if tg_op = 'UPDATE' and new.estado_id is distinct from old.estado_id then
    new.estado_desde := now();
  end if;
  select tipo into v_tipo from estado_funil where id = new.estado_id;
  if v_tipo = 'perdido' and length(trim(coalesce(new.motivo_perda, ''))) = 0 then
    raise exception 'Informe o motivo da perda.';
  end if;
  return new;
end $$;
create trigger oportunidade_antes before insert or update on public.oportunidade
  for each row execute function public.oportunidade_antes();

create or replace function public.oportunidade_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into interacao (oportunidade_id, tipo, texto) values (new.id, 'sistema',
      'Oportunidade criada em "' || (select nome from estado_funil where id = new.estado_id) || '"');
  elsif new.estado_id is distinct from old.estado_id then
    insert into interacao (oportunidade_id, tipo, texto) values (new.id, 'sistema',
      'Etapa: ' || (select nome from estado_funil where id = old.estado_id) || ' → ' || (select nome from estado_funil where id = new.estado_id)
      || coalesce(' · motivo: ' || nullif(new.motivo_perda, ''), ''));
  end if;
  return null;
end $$;
create trigger oportunidade_historico after insert or update on public.oportunidade
  for each row execute function public.oportunidade_historico();

-- Eventos vindos do site. Clique é clique; formulário é mensagem recebida.
create table public.evento_site (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('clique_whatsapp', 'formulario')),
  pagina text,
  utm jsonb,
  oportunidade_id uuid references public.oportunidade (id),
  criado_em timestamptz not null default now()
);
create index evento_site_em_idx on public.evento_site (criado_em);

-- p: {nome, telefone, email, mensagem, tipo_servico, local, pagina, utm:{source, medium, campaign}, site (armadilha anti-robô)}
create or replace function public.site_registrar_contato(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_nome text := left(trim(coalesce(p->>'nome', '')), 120);
  v_tel text := left(trim(coalesce(p->>'telefone', '')), 40);
  v_email text := lower(left(trim(coalesce(p->>'email', '')), 160));
  v_msg text := left(trim(coalesce(p->>'mensagem', '')), 2000);
  v_utm jsonb := case when jsonb_typeof(p->'utm') = 'object' then p->'utm' else null end;
  v_origem text;
  v_pessoa uuid; v_op uuid;
begin
  if coalesce(p->>'site', '') <> '' then return 'ok'; end if; -- robô preencheu o campo escondido
  if length(v_nome) < 2 then raise exception 'Informe seu nome.'; end if;
  if v_tel = '' and v_email = '' then raise exception 'Informe telefone ou e-mail.'; end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'E-mail inválido.'; end if;
  if (select count(*) from evento_site where tipo = 'formulario' and criado_em > now() - interval '10 minutes') >= 20 then
    raise exception 'Muitas mensagens agora. Tente em alguns minutos ou chame no WhatsApp.';
  end if;
  v_origem := case when lower(coalesce(v_utm->>'source', '')) like '%insta%' then 'instagram' else 'site' end;

  select id into v_pessoa from pessoa
  where not arquivado and (
    (v_email <> '' and lower(email) = v_email)
    or (length(regexp_replace(v_tel, '\D', '', 'g')) >= 8
        and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(regexp_replace(v_tel, '\D', '', 'g'), 9)))
  order by criado_em limit 1;
  if v_pessoa is null then
    insert into pessoa (nome, telefone, email, eh_cliente, criado_por)
    values (v_nome, nullif(v_tel, ''), nullif(v_email, ''), true, null) returning id into v_pessoa;
  end if;

  select o.id into v_op from oportunidade o join estado_funil e on e.id = o.estado_id
  where o.pessoa_id = v_pessoa and e.tipo = 'aberto' and not o.arquivado order by o.criado_em desc limit 1;
  if v_op is null then
    insert into oportunidade (pessoa_id, titulo, origem, campanha, utm, tipo_servico, local_obra, resumo, estado_id, proxima_acao, proxima_acao_data, criado_por)
    values (v_pessoa, coalesce(nullif(left(p->>'tipo_servico', 80), ''), 'Contato pelo site') || ' · ' || v_nome, v_origem,
            v_utm->>'campaign', v_utm, nullif(left(p->>'tipo_servico', 80), ''), nullif(left(p->>'local', 200), ''), nullif(v_msg, ''),
            estado_funil_id('Novo contato'), 'Responder contato do site', (now() at time zone 'America/Sao_Paulo')::date, null)
    returning id into v_op;
  end if;
  insert into interacao (oportunidade_id, tipo, texto, criado_por)
  values (v_op, 'site', 'Mensagem recebida pelo formulário do site' || coalesce(': ' || nullif(v_msg, ''), '.'), null);
  insert into evento_site (tipo, pagina, utm, oportunidade_id) values ('formulario', left(p->>'pagina', 300), v_utm, v_op);
  return 'ok';
end $$;

create or replace function public.site_registrar_clique(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from evento_site where tipo = 'clique_whatsapp' and criado_em > now() - interval '1 minute') >= 60 then
    return 'ok';
  end if;
  insert into evento_site (tipo, pagina, utm)
  values ('clique_whatsapp', left(p->>'pagina', 300), case when jsonb_typeof(p->'utm') = 'object' then p->'utm' end);
  return 'ok';
end $$;

-- ---------------------------------------------------------------------
-- Biblioteca de serviços
-- ---------------------------------------------------------------------
create table public.modelo_servico (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  grupo text not null,
  descricao_cliente text,
  palavras_chave text[] not null default '{}',
  unidade text not null default 'vb' check (unidade in ('m', 'm2', 'm3', 'kg', 'un', 'vb', 'mes', 'visita', 'dia', 'pt')),
  modelo_preco text not null default 'por_unidade' check (modelo_preco in ('fixo', 'por_unidade', 'area_complexidade')),
  preco_base numeric(14,2) check (preco_base is null or preco_base >= 0),
  complexidade jsonb not null default '[]',
  inclusoes text[] not null default '{}',
  exclusoes text[] not null default '{}',
  responsabilidades jsonb not null default '[]',
  etapas jsonb not null default '[]',
  perguntas jsonb not null default '[]',
  premissas text[] not null default '{}',
  pontos_conferir text[] not null default '{}',
  ativo boolean not null default true,
  ordem integer not null default 0,
  atualizado_em timestamptz not null default now()
);
create trigger modelo_servico_atualizado before update on public.modelo_servico
  for each row execute function public.tocar_atualizado_em();

-- Custo de referência fica separado (só quem tem financeiro vê).
create table public.modelo_servico_custo (
  modelo_id uuid primary key references public.modelo_servico (id) on delete cascade,
  custo_base numeric(14,2) check (custo_base is null or custo_base >= 0),
  observacoes text
);

-- ---------------------------------------------------------------------
-- Propostas e versões
-- ---------------------------------------------------------------------
create table public.proposta (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  tipo text not null default 'proposta' check (tipo in ('proposta', 'aditivo')),
  oportunidade_id uuid references public.oportunidade (id),
  pessoa_id uuid not null references public.pessoa (id),
  obra_id uuid references public.obra (id),
  titulo text not null check (length(trim(titulo)) > 0),
  estado text not null default 'rascunho' check (estado in ('rascunho', 'enviada', 'em_negociacao', 'aprovada', 'recusada', 'arquivada')),
  versao_aprovada_id uuid,
  aprovada_em timestamptz,
  aprovada_por_nome text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint aditivo_tem_obra check (tipo <> 'aditivo' or obra_id is not null)
);
create trigger proposta_atualizado before update on public.proposta
  for each row execute function public.tocar_atualizado_em();

create or replace function public.proposta_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ano text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY');
begin
  if new.codigo is null then
    new.codigo := case new.tipo when 'aditivo' then 'ADT-' else 'PROP-' end || v_ano || '-'
                  || lpad(proximo_numero(new.tipo || '-' || v_ano)::text, 4, '0');
  end if;
  return new;
end $$;
create trigger proposta_codigo before insert on public.proposta
  for each row execute function public.proposta_codigo();

create table public.proposta_versao (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references public.proposta (id) on delete restrict,
  numero integer not null check (numero > 0),
  conteudo jsonb not null default '{}',
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  emitida boolean not null default false,
  emitida_em timestamptz,
  hash text,
  validade date,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  unique (proposta_id, numero)
);
alter table public.proposta add constraint proposta_versao_aprovada_fk
  foreign key (versao_aprovada_id) references public.proposta_versao (id);

create or replace function public.versao_imutavel()
returns trigger language plpgsql as $$
begin
  if old.emitida then
    raise exception 'Versão emitida não pode ser alterada. Crie uma nova versão.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger proposta_versao_imutavel before update or delete on public.proposta_versao
  for each row execute function public.versao_imutavel();

create table public.proposta_custo (
  versao_id uuid primary key references public.proposta_versao (id) on delete cascade,
  custos jsonb not null default '{}',
  custo_total numeric(14,2) not null default 0,
  notas_internas text
);

create table public.proposta_link (
  id uuid primary key default gen_random_uuid(),
  versao_id uuid not null references public.proposta_versao (id),
  token_hash text not null unique,
  expira_em timestamptz not null,
  revogado_em timestamptz,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);

create table public.proposta_evento (
  id bigint generated always as identity primary key,
  proposta_id uuid not null references public.proposta (id),
  versao_id uuid references public.proposta_versao (id),
  tipo text not null check (tipo in ('emitida', 'link_criado', 'enviada_email', 'enviada_whatsapp', 'visualizada', 'aceita', 'ajuste_pedido', 'recusada', 'link_revogado')),
  nome text,
  email text,
  documento text,
  comentario text,
  canal text,
  hash_versao text,
  user_agent text,
  em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index proposta_evento_idx on public.proposta_evento (proposta_id, em desc);

create or replace function public.hash_versao(v public.proposta_versao)
returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(v.proposta_id::text || '|' || v.numero || '|' || v.valor_total::text || '|' || v.conteudo::text, 'UTF8'), 'sha256'), 'hex')
$$;

-- Cria nova versão em rascunho a partir da última (revisão preserva a anterior).
create or replace function public.nova_versao_proposta(p_proposta uuid)
returns uuid language plpgsql set search_path = public as $$
declare u proposta_versao; v_id uuid;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into u from proposta_versao where proposta_id = p_proposta order by numero desc limit 1;
  if u.id is null then
    insert into proposta_versao (proposta_id, numero) values (p_proposta, 1) returning id into v_id;
  else
    if not u.emitida then return u.id; end if;
    insert into proposta_versao (proposta_id, numero, conteudo, valor_total)
    values (p_proposta, u.numero + 1, u.conteudo, u.valor_total) returning id into v_id;
    if tem_financeiro() then
      insert into proposta_custo (versao_id, custos, custo_total, notas_internas)
      select v_id, custos, custo_total, notas_internas from proposta_custo where versao_id = u.id;
    end if;
  end if;
  return v_id;
end $$;

-- Duplicar uma proposta inteira (nova proposta, versão 1 em rascunho).
create or replace function public.duplicar_proposta(p_proposta uuid)
returns uuid language plpgsql set search_path = public as $$
declare p proposta; u proposta_versao; v_nova uuid; v_ver uuid;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into p from proposta where id = p_proposta;
  select * into u from proposta_versao where proposta_id = p_proposta order by numero desc limit 1;
  insert into proposta (tipo, oportunidade_id, pessoa_id, obra_id, titulo)
  values (p.tipo, p.oportunidade_id, p.pessoa_id, p.obra_id, p.titulo || ' (cópia)') returning id into v_nova;
  insert into proposta_versao (proposta_id, numero, conteudo, valor_total)
  values (v_nova, 1, coalesce(u.conteudo, '{}'), coalesce(u.valor_total, 0)) returning id into v_ver;
  if tem_financeiro() and u.id is not null then
    insert into proposta_custo (versao_id, custos, custo_total, notas_internas)
    select v_ver, custos, custo_total, notas_internas from proposta_custo where versao_id = u.id;
  end if;
  return v_nova;
end $$;

-- Emite (congela) a versão: confere totais e grava o código de verificação.
create or replace function public.emitir_versao(p_versao uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v proposta_versao; v_soma numeric; v_parc numeric; v_hash text; v_dias int;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into v from proposta_versao where id = p_versao for update;
  if v.id is null then raise exception 'Versão não encontrada.'; end if;
  if v.emitida then return v.hash; end if;
  if exists (select 1 from proposta_versao where proposta_id = v.proposta_id and numero > v.numero) then
    raise exception 'Existe versão mais nova desta proposta.';
  end if;
  select coalesce(sum((i->>'total')::numeric), 0) into v_soma
  from jsonb_array_elements(coalesce(v.conteudo->'ambientes', '[]')) a, jsonb_array_elements(coalesce(a->'itens', '[]')) i;
  if v_soma <= 0 then raise exception 'A proposta precisa de ao menos um item com valor.'; end if;
  if v_soma <> v.valor_total then raise exception 'O total (%) não confere com a soma dos itens (%).', v.valor_total, v_soma; end if;
  if jsonb_array_length(coalesce(v.conteudo->'pagamento'->'parcelas', '[]')) > 0 then
    select sum((x->>'valor')::numeric) into v_parc from jsonb_array_elements(v.conteudo->'pagamento'->'parcelas') x;
    if v_parc <> v.valor_total then raise exception 'As condições de pagamento (%) não somam o total (%).', v_parc, v.valor_total; end if;
  end if;
  v_dias := coalesce((v.conteudo->>'validade_dias')::int, 15);
  v.validade := (now() at time zone 'America/Sao_Paulo')::date + v_dias;
  v_hash := hash_versao(v);
  -- Única atualização permitida: o próprio ato de emitir.
  update proposta_versao set emitida = true, emitida_em = now(), hash = v_hash, validade = v.validade where id = p_versao;
  update proposta set estado = case when estado in ('rascunho', 'em_negociacao') then 'enviada' else estado end where id = v.proposta_id;
  insert into proposta_evento (proposta_id, versao_id, tipo, hash_versao) values (v.proposta_id, v.id, 'emitida', v_hash);
  return v_hash;
end $$;

-- Link privado para o cliente (token aleatório; o banco guarda só o hash).
create or replace function public.criar_link_proposta(p_versao uuid, p_dias integer default 30)
returns text language plpgsql security definer set search_path = public as $$
declare v proposta_versao; v_token text;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into v from proposta_versao where id = p_versao;
  if not coalesce(v.emitida, false) then raise exception 'Emita a versão antes de gerar o link.'; end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into proposta_link (versao_id, token_hash, expira_em)
  values (p_versao, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => greatest(1, least(p_dias, 180))));
  insert into proposta_evento (proposta_id, versao_id, tipo) values (v.proposta_id, v.id, 'link_criado');
  return v_token;
end $$;

create or replace function public.revogar_links_proposta(p_versao uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  update proposta_link set revogado_em = now() where versao_id = p_versao and revogado_em is null;
  insert into proposta_evento (proposta_id, versao_id, tipo)
  select proposta_id, id, 'link_revogado' from proposta_versao where id = p_versao;
end $$;

create or replace function public.registrar_envio_proposta(p_versao uuid, p_canal text, p_destinatario text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  insert into proposta_evento (proposta_id, versao_id, tipo, canal, email)
  select proposta_id, id, case when p_canal = 'whatsapp' then 'enviada_whatsapp' else 'enviada_email' end, p_canal, p_destinatario
  from proposta_versao where id = p_versao and emitida;
  if not found then raise exception 'Só versões emitidas podem ser enviadas.'; end if;
  update oportunidade set estado_id = estado_funil_id('Proposta enviada')
  where id = (select oportunidade_id from proposta p join proposta_versao v on v.proposta_id = p.id where v.id = p_versao)
    and estado_id in (select id from estado_funil where tipo = 'aberto' and ordem < 5);
end $$;

-- Dados públicos da empresa para documentos (registro só se conferido).
create or replace function public.empresa_publica()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', nome_fantasia, 'razao_social', razao_social, 'cnpj', cnpj, 'responsavel', responsavel_tecnico,
    'registro', case when registro_conferido then registro_profissional end,
    'endereco', endereco, 'telefone', telefone, 'email', email, 'site', site, 'instagram', instagram,
    'frase', frase_institucional)
  from empresa limit 1
$$;

create or replace function public.link_valido(p_token text)
returns public.proposta_link language sql stable security definer set search_path = public as $$
  select * from proposta_link
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and revogado_em is null and expira_em > now()
$$;

-- Página pública da proposta: nunca contém custo nem margem (estão em outra tabela).
create or replace function public.proposta_publica(p_token text, p_registrar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l proposta_link; v proposta_versao; p proposta; v_ultima int; c pessoa;
begin
  l := link_valido(p_token);
  if l.id is null then return jsonb_build_object('erro', 'Link inválido, expirado ou revogado. Peça um novo link à ROSAE.'); end if;
  select * into v from proposta_versao where id = l.versao_id;
  select * into p from proposta where id = v.proposta_id;
  select * into c from pessoa where id = p.pessoa_id;
  select max(numero) into v_ultima from proposta_versao where proposta_id = p.id and emitida;
  if p_registrar and not exists (select 1 from proposta_evento where versao_id = v.id and tipo = 'visualizada' and em > now() - interval '30 minutes') then
    insert into proposta_evento (proposta_id, versao_id, tipo, criado_por) values (p.id, v.id, 'visualizada', null);
  end if;
  return jsonb_build_object(
    'codigo', p.codigo, 'tipo', p.tipo, 'titulo', p.titulo, 'versao', v.numero, 'valor_total', v.valor_total,
    'conteudo', v.conteudo, 'emitida_em', v.emitida_em, 'validade', v.validade, 'hash', v.hash,
    'cliente', c.nome, 'empresa', empresa_publica(),
    'atual', v.numero = v_ultima,
    'vencida', v.validade < (now() at time zone 'America/Sao_Paulo')::date,
    'estado', p.estado,
    'aprovada_esta_versao', p.versao_aprovada_id = v.id,
    'aprovada_por', case when p.versao_aprovada_id = v.id then p.aprovada_por_nome end,
    'aprovada_em', case when p.versao_aprovada_id = v.id then p.aprovada_em end);
end $$;

-- Resposta do cliente pelo link: aceitar esta versão, pedir ajuste ou recusar.
create or replace function public.proposta_responder(p_token text, p_acao text, p_nome text, p_email text, p_documento text, p_comentario text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l proposta_link; v proposta_versao; p proposta; v_ultima int; v_nome text := left(trim(coalesce(p_nome, '')), 120);
begin
  l := link_valido(p_token);
  if l.id is null then raise exception 'Link inválido, expirado ou revogado.'; end if;
  select * into v from proposta_versao where id = l.versao_id;
  select * into p from proposta where id = v.proposta_id for update;
  select max(numero) into v_ultima from proposta_versao where proposta_id = p.id and emitida;
  if length(v_nome) < 3 then raise exception 'Informe seu nome completo.'; end if;
  if p_acao not in ('aceitar', 'ajuste', 'recusar') then raise exception 'Ação inválida.'; end if;
  if (select count(*) from proposta_evento where versao_id = v.id and tipo in ('aceita', 'ajuste_pedido', 'recusada') and em > now() - interval '10 minutes') >= 10 then
    raise exception 'Muitas respostas seguidas. Tente novamente em alguns minutos.';
  end if;

  if p_acao = 'aceitar' then
    if p.versao_aprovada_id = v.id then
      return jsonb_build_object('ok', true, 'mensagem', 'Esta versão já estava aceita.');
    end if;
    if p.estado = 'aprovada' then raise exception 'Outra versão desta proposta já foi aprovada.'; end if;
    if v.numero <> v_ultima then raise exception 'Existe uma versão mais nova desta proposta. Abra o link mais recente.'; end if;
    if v.validade < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A validade desta proposta terminou. Peça uma versão atualizada.'; end if;
    update proposta set estado = 'aprovada', versao_aprovada_id = v.id, aprovada_em = now(), aprovada_por_nome = v_nome where id = p.id;
    insert into proposta_evento (proposta_id, versao_id, tipo, nome, email, documento, comentario, hash_versao, user_agent, criado_por)
    values (p.id, v.id, 'aceita', v_nome, left(p_email, 160), left(p_documento, 40), left(p_comentario, 2000), v.hash, left(p_user_agent, 300), null);
    if p.oportunidade_id is not null then
      update oportunidade set estado_id = estado_funil_id('Aprovada') where id = p.oportunidade_id;
    end if;
    return jsonb_build_object('ok', true, 'mensagem', 'Proposta aceita. A ROSAE recebeu sua confirmação.');
  end if;

  if length(trim(coalesce(p_comentario, ''))) = 0 then raise exception 'Escreva o que gostaria de ajustar.'; end if;
  insert into proposta_evento (proposta_id, versao_id, tipo, nome, email, comentario, hash_versao, user_agent, criado_por)
  values (p.id, v.id, case p_acao when 'ajuste' then 'ajuste_pedido' else 'recusada' end, v_nome, left(p_email, 160), left(p_comentario, 2000), v.hash, left(p_user_agent, 300), null);
  if p.estado <> 'aprovada' then
    update proposta set estado = case p_acao when 'ajuste' then 'em_negociacao' else 'recusada' end where id = p.id;
    if p.oportunidade_id is not null then
      update oportunidade set estado_id = estado_funil_id('Em negociação') where id = p.oportunidade_id and p_acao = 'ajuste';
      insert into interacao (oportunidade_id, tipo, texto, criado_por)
      values (p.oportunidade_id, 'sistema', v_nome || case p_acao when 'ajuste' then ' pediu ajuste: ' else ' recusou a proposta: ' end || left(p_comentario, 500), null);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'mensagem', case p_acao when 'ajuste' then 'Pedido de ajuste enviado à ROSAE.' else 'Resposta registrada.' end);
end $$;

-- Vendido passa a vir das propostas aprovadas (e aditivos) + obras lançadas sem proposta.
alter table public.obra add column proposta_versao_id uuid unique references public.proposta_versao (id);

create or replace function public.vendido_no_periodo(p_inicio date, p_fim date)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select sum(v.valor_total) from proposta p join proposta_versao v on v.id = p.versao_aprovada_id
                   where p.estado = 'aprovada' and (p.aprovada_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim), 0)
       + coalesce((select sum(f.valor_contratado) from obra_financeiro f join obra o on o.id = f.obra_id
                   where o.status <> 'cancelada' and o.proposta_versao_id is null and f.data_contratacao between p_inicio and p_fim), 0)
$$;

create or replace function public.resumo_comercial(p_inicio date, p_fim date)
returns jsonb language sql stable set search_path = public as $$
  select case when not eh_equipe_adm() then null else jsonb_build_object(
    'enviadas', (select count(*) from proposta where estado = 'enviada'),
    'em_negociacao', (select count(*) from proposta where estado = 'em_negociacao'),
    'aprovadas_periodo', (select count(*) from proposta where estado = 'aprovada' and (aprovada_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'recusadas_periodo', (select count(*) from proposta p where estado = 'recusada' and (atualizado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'rascunhos', (select count(*) from proposta where estado = 'rascunho'),
    'oportunidades_abertas', (select count(*) from oportunidade o join estado_funil e on e.id = o.estado_id where e.tipo = 'aberto' and not o.arquivado),
    'acoes_atrasadas', (select count(*) from oportunidade o join estado_funil e on e.id = o.estado_id
                        where e.tipo = 'aberto' and not o.arquivado and o.proxima_acao_data < (now() at time zone 'America/Sao_Paulo')::date),
    'cliques_whatsapp', (select count(*) from evento_site where tipo = 'clique_whatsapp' and (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
    'formularios', (select count(*) from evento_site where tipo = 'formulario' and (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim)
  ) end
$$;

-- O painel passa a usar a nova regra de "vendido".
create or replace function public.painel_indicadores(p_inicio date, p_fim date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
  v_meta_rec numeric; v_meta_ven numeric;
begin
  if not tem_financeiro() then
    return jsonb_build_object('sem_permissao', true,
      'obras_ativas', (select count(*) from obra where not arquivado and status in ('contratada', 'em_execucao')),
      'comercial', resumo_comercial(p_inicio, p_fim));
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
    'vendido', vendido_no_periodo(p_inicio, p_fim),
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
    'obras_ativas', (select count(*) from obra where not arquivado and status in ('contratada', 'em_execucao')),
    'comercial', resumo_comercial(p_inicio, p_fim)
  ) into r;
  return r;
end $$;

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
    vendido_no_periodo(m.mes, (m.mes + interval '1 month' - interval '1 day')::date)
  from meses m
  where tem_financeiro()
  order by m.mes
$$;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['estado_funil', 'oportunidade', 'modelo_servico', 'modelo_servico_custo', 'proposta', 'proposta_versao', 'proposta_custo', 'proposta_link'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
  end loop;
  foreach t in array array['estado_funil', 'oportunidade', 'interacao', 'evento_site', 'modelo_servico', 'modelo_servico_custo',
                           'proposta', 'proposta_versao', 'proposta_custo', 'proposta_link', 'proposta_evento'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.estado_funil to authenticated;
grant insert, update on public.estado_funil to authenticated;
create policy funil_ler on public.estado_funil for select to authenticated using (eh_equipe_adm());
create policy funil_gravar on public.estado_funil for insert to authenticated with check (eh_admin());
create policy funil_editar on public.estado_funil for update to authenticated using (eh_admin()) with check (eh_admin());

grant select, insert, update on public.oportunidade to authenticated;
create policy op_ler on public.oportunidade for select to authenticated using (eh_equipe_adm());
create policy op_incluir on public.oportunidade for insert to authenticated with check (eh_equipe_adm());
create policy op_editar on public.oportunidade for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

grant select, insert on public.interacao to authenticated;
create policy int_ler on public.interacao for select to authenticated using (eh_equipe_adm());
create policy int_incluir on public.interacao for insert to authenticated with check (eh_equipe_adm() and tipo <> 'sistema');

grant select on public.evento_site to authenticated;
create policy ev_ler on public.evento_site for select to authenticated using (eh_equipe_adm());

grant select, insert, update on public.modelo_servico to authenticated;
create policy ms_ler on public.modelo_servico for select to authenticated using (eh_equipe_adm());
create policy ms_incluir on public.modelo_servico for insert to authenticated with check (eh_equipe_adm());
create policy ms_editar on public.modelo_servico for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());

grant select, insert, update on public.modelo_servico_custo, public.proposta_custo to authenticated;
create policy msc_fin on public.modelo_servico_custo for all to authenticated using (tem_financeiro()) with check (tem_financeiro());
create policy pc_fin on public.proposta_custo for all to authenticated using (tem_financeiro()) with check (tem_financeiro());

grant select, insert, update on public.proposta to authenticated;
create policy prop_ler on public.proposta for select to authenticated using (eh_equipe_adm());
create policy prop_incluir on public.proposta for insert to authenticated with check (eh_equipe_adm() and estado = 'rascunho' and versao_aprovada_id is null);
-- Aprovação só acontece pelo aceite do cliente (função), nunca por edição direta.
create policy prop_editar on public.proposta for update to authenticated using (eh_equipe_adm())
  with check (eh_equipe_adm() and estado <> 'aprovada');

grant select, insert, update, delete on public.proposta_versao to authenticated;
create policy pv_ler on public.proposta_versao for select to authenticated using (eh_equipe_adm());
create policy pv_incluir on public.proposta_versao for insert to authenticated with check (eh_equipe_adm() and not emitida);
create policy pv_editar on public.proposta_versao for update to authenticated using (eh_equipe_adm() and not emitida) with check (eh_equipe_adm() and not emitida);
create policy pv_apagar on public.proposta_versao for delete to authenticated using (eh_equipe_adm() and not emitida);

grant select on public.proposta_link, public.proposta_evento to authenticated;
create policy pl_ler on public.proposta_link for select to authenticated using (eh_equipe_adm());
create policy pe_ler on public.proposta_evento for select to authenticated using (eh_equipe_adm());

-- A proposta aprovada não pode ser "desaprovada" por edição.
create or replace function public.proposta_protegida()
returns trigger language plpgsql as $$
begin
  if old.estado = 'aprovada' and (new.estado <> 'aprovada' or new.versao_aprovada_id is distinct from old.versao_aprovada_id) then
    raise exception 'Proposta aprovada não volta atrás. Use um aditivo ou uma nova proposta.';
  end if;
  return new;
end $$;
create trigger proposta_protegida before update on public.proposta
  for each row execute function public.proposta_protegida();

grant execute on function
  public.nova_versao_proposta(uuid), public.duplicar_proposta(uuid), public.emitir_versao(uuid),
  public.criar_link_proposta(uuid, integer), public.revogar_links_proposta(uuid),
  public.registrar_envio_proposta(uuid, text, text), public.empresa_publica(),
  public.vendido_no_periodo(date, date), public.resumo_comercial(date, date),
  public.painel_indicadores(date, date), public.serie_mensal(date)
to authenticated;
-- Funções públicas (site e link da proposta). Validam tudo por dentro.
grant usage on schema public to anon;
grant execute on function
  public.site_registrar_contato(jsonb), public.site_registrar_clique(jsonb),
  public.proposta_publica(text, boolean), public.proposta_responder(text, text, text, text, text, text, text)
to anon, authenticated;
grant execute on function public.estado_funil_id(text) to authenticated;
revoke all on function public.link_valido(text), public.hash_versao(public.proposta_versao) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Biblioteca inicial de serviços da ROSAE (preços em branco: o Rhuann define)
-- ---------------------------------------------------------------------
-- complexidade: [{nivel, fator, descricao}]; responsabilidades: [{parte, itens[]}];
-- etapas: [{nome, descricao, percentual}]; perguntas: [{texto}]
insert into public.modelo_servico (ordem, nome, grupo, unidade, modelo_preco, palavras_chave, descricao_cliente, complexidade, inclusoes, exclusoes, responsabilidades, etapas, perguntas, premissas, pontos_conferir) values
(10, 'Projeto estrutural em concreto armado', 'Projetos', 'm2', 'area_complexidade',
 array['projeto estrutural','projeto de estrutura','calculo estrutural','cálculo estrutural','concreto armado','fundação','fundacao','laje','viga','pilar','casa','residência','edificação'],
 'Concepção, dimensionamento e detalhamento da estrutura em concreto armado da edificação, conforme as normas técnicas brasileiras (ABNT NBR 6118, NBR 6120, NBR 6122 e NBR 8681), compatibilizado com o projeto de arquitetura fornecido.',
 '[{"nivel":"Baixa","fator":1.0,"descricao":"Térrea ou sobrado simples, vãos usuais, sem balanços"},{"nivel":"Média","fator":1.25,"descricao":"Até 3 pavimentos, alguns vãos maiores ou balanços, piscina ou caixa d''água elevada"},{"nivel":"Alta","fator":1.6,"descricao":"Vãos grandes, transições, subsolo, contenções ou arquitetura muito recortada"}]',
 array['Lançamento estrutural sobre a arquitetura','Dimensionamento de fundações, pilares, vigas e lajes','Plantas de forma de todos os pavimentos','Detalhamento de armaduras com quantitativos (aço, concreto e forma)','Memorial descritivo e de cálculo resumido','ART de projeto','Uma rodada de ajustes por compatibilização com a arquitetura'],
 array['Projeto de arquitetura e projetos complementares (elétrico, hidráulico, etc.)','Sondagem do solo (pode ser indicada pela ROSAE)','Taxas de aprovação em prefeitura','Alterações de arquitetura após o início do cálculo (orçadas à parte)','Acompanhamento de obra (pode ser contratado separadamente)'],
 '[{"parte":"ROSAE","itens":["Elaborar o projeto conforme as normas vigentes","Emitir a ART do projeto","Esclarecer dúvidas da obra sobre o projeto durante a execução"]},{"parte":"Cliente","itens":["Fornecer arquitetura aprovada em formato editável (DWG ou IFC)","Fornecer sondagem do solo ou autorizar sua contratação","Comunicar qualquer mudança na arquitetura antes do início do cálculo"]}]',
 '[{"nome":"Estudo e lançamento","descricao":"Análise da arquitetura e concepção da estrutura","percentual":30},{"nome":"Dimensionamento","descricao":"Cálculo e verificação dos elementos","percentual":40},{"nome":"Detalhamento e entrega","descricao":"Pranchas, quantitativos, memorial e ART","percentual":30}]',
 '[{"texto":"Qual a área construída total (m²)?"},{"texto":"Quantos pavimentos?"},{"texto":"Já existe sondagem do solo?"},{"texto":"A arquitetura está aprovada e em DWG?"},{"texto":"Há piscina, subsolo ou muro de contenção?"}]',
 array['Arquitetura definitiva fornecida pelo cliente','Sondagem compatível com o porte da obra'],
 array['Conferir a área no projeto de arquitetura','Conferir se há sondagem e o tipo de fundação provável']),
(20, 'Projeto estrutural em estrutura metálica', 'Projetos', 'm2', 'area_complexidade',
 array['estrutura metálica','estrutura metalica','galpão','galpao','mezanino','cobertura metálica','aço','perfil'],
 'Concepção, dimensionamento e detalhamento de estrutura em aço (ABNT NBR 8800 e NBR 14762), incluindo ligações e lista de materiais para fabricação.',
 '[{"nivel":"Baixa","fator":1.0,"descricao":"Cobertura ou mezanino simples"},{"nivel":"Média","fator":1.3,"descricao":"Galpão com ponte rolante leve ou vários níveis"},{"nivel":"Alta","fator":1.7,"descricao":"Grandes vãos, cargas especiais ou interface com estrutura existente"}]',
 array['Concepção e modelo estrutural','Dimensionamento de perfis e ligações','Desenhos de montagem e detalhes de ligações','Lista de materiais (peso de aço estimado)','ART de projeto'],
 array['Projeto de fabricação peça a peça (pode ser feito pelo fabricante)','Fundações (podem ser incluídas como item à parte)','Fornecimento e montagem da estrutura'],
 '[{"parte":"ROSAE","itens":["Elaborar o projeto conforme as normas vigentes","Emitir a ART do projeto"]},{"parte":"Cliente","itens":["Informar uso, cargas e equipamentos previstos","Fornecer levantamento do local quando houver estrutura existente"]}]',
 '[{"nome":"Concepção","descricao":"Definição do sistema estrutural","percentual":30},{"nome":"Dimensionamento","descricao":"Perfis e ligações","percentual":40},{"nome":"Entrega","descricao":"Desenhos, lista de materiais e ART","percentual":30}]',
 '[{"texto":"Qual a área e o pé-direito?"},{"texto":"Qual será o uso e as cargas previstas?"},{"texto":"Há estrutura existente a aproveitar?"}]',
 array['Cargas de uso informadas pelo cliente'], array['Conferir vãos e pé-direito']),
(30, 'Laudo técnico e vistoria estrutural', 'Diagnóstico', 'vb', 'fixo',
 array['laudo','vistoria','inspeção','inspecao','trinca','fissura','rachadura','patologia','infiltração na laje','avaliação'],
 'Vistoria técnica no local para identificar e avaliar manifestações patológicas (trincas, fissuras, corrosão de armaduras, deformações), com relatório fotográfico, diagnóstico provável e recomendações.',
 '[]',
 array['Visita técnica ao local','Registro fotográfico','Relatório com diagnóstico e recomendações','Indicação de urgência de cada problema','ART do laudo'],
 array['Ensaios de laboratório ou extração de testemunhos (orçados à parte se necessários)','Projeto de reforço (pode ser contratado em seguida)','Execução de reparos'],
 '[{"parte":"ROSAE","itens":["Realizar a vistoria e emitir o laudo com ART","Indicar riscos imediatos assim que identificados"]},{"parte":"Cliente","itens":["Garantir acesso a todos os ambientes","Informar histórico de reformas e problemas conhecidos"]}]',
 '[{"nome":"Vistoria","descricao":"Visita e registros","percentual":50},{"nome":"Laudo","descricao":"Entrega do relatório e ART","percentual":50}]',
 '[{"texto":"Qual o endereço e o tipo de imóvel?"},{"texto":"Quais problemas aparecem e há quanto tempo?"},{"texto":"Existem projetos antigos da edificação?"}]',
 array['Acesso livre ao local na data agendada'], array['Conferir distância e deslocamento']),
(40, 'Projeto de reforço estrutural', 'Reforço estrutural', 'vb', 'fixo',
 array['reforço','reforco','reforço estrutural','recuperação estrutural','encamisamento','fibra de carbono','chapa metálica','aumento de carga','pilar fissurado','viga trincada'],
 'Projeto de reforço ou recuperação de elementos estruturais existentes em concreto ou aço, com solução técnica, procedimento executivo e especificação de materiais.',
 '[{"nivel":"Pontual","fator":1.0,"descricao":"Poucos elementos, acesso fácil"},{"nivel":"Moderada","fator":1.4,"descricao":"Vários elementos ou aumento de carga"},{"nivel":"Extensa","fator":2.0,"descricao":"Reforço global ou escoramento complexo"}]',
 array['Levantamento dos elementos afetados','Verificação da capacidade atual','Solução de reforço com detalhes executivos','Procedimento de execução e escoramento','Especificação de materiais','ART de projeto'],
 array['Ensaios e prospecções destrutivas (orçados à parte)','Execução do reforço (pode ser contratada à parte)','Reparos de acabamento'],
 '[{"parte":"ROSAE","itens":["Projetar o reforço e emitir ART","Orientar a equipe de execução sobre o procedimento"]},{"parte":"Cliente","itens":["Liberar acesso e permitir aberturas de inspeção quando necessário","Seguir as restrições de uso até a conclusão do reforço"]}]',
 '[{"nome":"Levantamento","descricao":"Inspeção e medições","percentual":30},{"nome":"Projeto","descricao":"Verificação e solução","percentual":50},{"nome":"Entrega","descricao":"Detalhes, procedimento e ART","percentual":20}]',
 '[{"texto":"Quais elementos precisam de reforço?"},{"texto":"Existe laudo ou projeto original?"},{"texto":"Haverá aumento de carga ou mudança de uso?"}]',
 array['Elementos acessíveis para inspeção'], array['Conferir se é necessário escoramento']),
(50, 'Execução de reforço estrutural', 'Reforço estrutural', 'vb', 'fixo',
 array['executar reforço','execução de reforço','recuperação de pilar','tratamento de armadura','corrosão','grauteamento'],
 'Execução do reforço ou recuperação estrutural conforme projeto, com equipe especializada, controle de qualidade e acompanhamento técnico.',
 '[]',
 array['Mobilização da equipe e equipamentos','Escoramento provisório quando previsto','Execução conforme projeto e procedimento','Limpeza da área de trabalho','Registro fotográfico das etapas'],
 array['Acabamentos finais (pintura, revestimento) salvo se listados','Remoção de móveis e objetos','Taxas e licenças'],
 '[{"parte":"ROSAE","itens":["Executar conforme projeto","Responder tecnicamente pela execução (ART)","Manter a área sinalizada e segura"]},{"parte":"Cliente","itens":["Liberar a área e os horários de trabalho","Fornecer ponto de água e energia"]},{"parte":"Parceiro","itens":["Executar os serviços contratados com qualidade e segurança","Cumprir prazos combinados"]}]',
 '[{"nome":"Mobilização","descricao":"Preparo e escoramento","percentual":20},{"nome":"Execução","descricao":"Serviços de reforço","percentual":60},{"nome":"Conclusão","descricao":"Desmobilização e entrega","percentual":20}]',
 '[{"texto":"Existe projeto de reforço?"},{"texto":"Qual o horário permitido para trabalho?"}]',
 array['Projeto de reforço aprovado'], array['Conferir materiais especiais (graute, fibra, chapa)']),
(60, 'Reforma', 'Obras', 'm2', 'area_complexidade',
 array['reforma','reformar','troca de piso','banheiro','cozinha','revestimento','pintura','demolição','demolicao'],
 'Execução de reforma conforme escopo definido por ambiente, com planejamento, coordenação de equipes e acompanhamento técnico.',
 '[{"nivel":"Leve","fator":1.0,"descricao":"Acabamentos e pintura"},{"nivel":"Média","fator":1.4,"descricao":"Troca de revestimentos e instalações"},{"nivel":"Pesada","fator":1.9,"descricao":"Demolições, mudança de layout ou intervenção estrutural"}]',
 array['Planejamento e cronograma','Coordenação das equipes','Execução dos serviços listados por ambiente','Limpeza grossa ao final','Relatório fotográfico'],
 array['Móveis, eletrodomésticos e decoração','Projetos de arquitetura e interiores','Serviços não listados no escopo','Materiais, quando a compra for do cliente'],
 '[{"parte":"ROSAE","itens":["Planejar e coordenar a obra","Garantir a qualidade dos serviços executados","Informar o andamento com registros"]},{"parte":"Cliente","itens":["Definir acabamentos dentro do prazo do cronograma","Liberar acesso ao imóvel","Efetuar os pagamentos nas datas combinadas"]},{"parte":"Parceiro","itens":["Executar os serviços com qualidade","Cumprir prazos e normas de segurança"]}]',
 '[{"nome":"Preparação","descricao":"Proteções e demolições","percentual":15},{"nome":"Infraestrutura","descricao":"Instalações e base","percentual":35},{"nome":"Acabamentos","descricao":"Revestimentos e pintura","percentual":40},{"nome":"Entrega","descricao":"Limpeza e vistoria final","percentual":10}]',
 '[{"texto":"Quais ambientes serão reformados?"},{"texto":"Quem compra os materiais?"},{"texto":"O imóvel estará ocupado durante a obra?"},{"texto":"Há regras de condomínio (horários, aprovação)?"}]',
 array['Escopo por ambiente definido antes do início'], array['Conferir regras do condomínio','Conferir se há intervenção estrutural']),
(70, 'Construção', 'Obras', 'm2', 'area_complexidade',
 array['construção','construcao','construir','obra nova','casa nova','edificação nova'],
 'Execução de obra nova conforme projetos aprovados, com gestão completa de equipes, materiais (conforme o modelo de contratação), cronograma e qualidade.',
 '[{"nivel":"Padrão","fator":1.0,"descricao":"Acabamento padrão"},{"nivel":"Médio-alto","fator":1.3,"descricao":"Acabamentos superiores"},{"nivel":"Alto","fator":1.7,"descricao":"Alto padrão, sistemas especiais"}]',
 array['Planejamento, cronograma e linha de base','Gestão de equipes e parceiros','Controle de qualidade por etapa','Medições e relatórios de evolução','Responsabilidade técnica de execução (ART)'],
 array['Projetos (salvo se contratados)','Taxas, licenças e ligações definitivas','Móveis e decoração'],
 '[{"parte":"ROSAE","itens":["Executar conforme projetos e normas","Gerir prazos, equipes e qualidade","Prestar contas por medições"]},{"parte":"Cliente","itens":["Fornecer projetos aprovados e terreno liberado","Tomar decisões no prazo do cronograma","Efetuar os pagamentos nas datas combinadas"]},{"parte":"Parceiro","itens":["Executar os serviços com qualidade e segurança"]}]',
 '[{"nome":"Fundação","descricao":"Locação e fundações","percentual":15},{"nome":"Estrutura","descricao":"Estrutura e alvenaria","percentual":30},{"nome":"Instalações e cobertura","descricao":"","percentual":20},{"nome":"Acabamentos","descricao":"","percentual":30},{"nome":"Entrega","descricao":"Limpeza e vistoria","percentual":5}]',
 '[{"texto":"Qual a área a construir?"},{"texto":"Os projetos estão aprovados?"},{"texto":"Qual o modelo de contratação (empreitada, administração)?"}]',
 array['Projetos aprovados'], array['Conferir modelo de contratação e compra de materiais']),
(80, 'Gestão e acompanhamento de obra', 'Gestão', 'mes', 'por_unidade',
 array['acompanhamento','gestão de obra','gestao de obra','fiscalização','fiscalizacao','visita técnica','gerenciamento'],
 'Acompanhamento técnico da obra com visitas periódicas, verificação da execução frente aos projetos, controle de cronograma e relatórios ao cliente.',
 '[]',
 array['Visitas técnicas na frequência combinada','Relatório de cada visita com fotos e pendências','Controle de cronograma e medições','Apoio na contratação de parceiros'],
 array['Execução de serviços','Compra de materiais','Projetos'],
 '[{"parte":"ROSAE","itens":["Realizar as visitas e relatórios","Apontar desvios e riscos"]},{"parte":"Cliente","itens":["Garantir acesso à obra","Repassar documentos e projetos atualizados"]}]',
 '[{"nome":"Acompanhamento mensal","descricao":"Visitas e relatórios","percentual":100}]',
 '[{"texto":"Qual a duração prevista da obra?"},{"texto":"Quantas visitas por mês?"}]',
 array['Frequência de visitas combinada'], array['Conferir deslocamento até a obra']);
