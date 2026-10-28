-- Medições da obra com aprovação do cliente pelo portal, e assinatura do contrato pelo link.
--
-- Medição: retrato do avanço físico (percentual de cada etapa) numa data de corte.
-- O escritório gera, confere e envia; o cliente aprova ou contesta pelo portal.
-- O cliente vê só percentuais, nunca valores (regra do portal). O valor medido
-- (contratado × avanço do período) fica para o escritório ligar à cobrança.
--
-- Contrato: o escritório gera um link para o contrato emitido; o contratante lê o
-- documento congelado e dá o aceite eletrônico (nome, CPF/CNPJ, declaração). O aceite
-- fica guardado com o hash da versão e marca o contrato como assinado.

alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Medições
-- ---------------------------------------------------------------------
create table public.medicao (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  numero integer not null,
  data_corte date not null,
  estado text not null default 'rascunho' check (estado in ('rascunho', 'enviada', 'aprovada', 'contestada', 'cancelada')),
  -- [{etapa_id, servico_id, servico, etapa, peso, anterior, atual}] (percentuais acumulados)
  itens jsonb not null default '[]',
  percentual_anterior numeric(5,1) not null default 0,
  percentual_atual numeric(5,1) not null default 0,
  valor_contratado numeric(14,2) not null default 0,
  valor_medido numeric(14,2) not null default 0,
  observacao text,
  parcela_id uuid references public.parcela (id),
  hash text,
  enviada_em timestamptz,
  respondida_em timestamptz,
  resposta_pessoa_id uuid references public.pessoa (id),
  resposta_nome text,
  resposta_texto text,
  resposta_user_agent text,
  cancelada_motivo text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  unique (obra_id, numero),
  constraint medicao_cancelamento check (estado <> 'cancelada' or length(trim(coalesce(cancelada_motivo, ''))) > 0)
);
create index medicao_obra_idx on public.medicao (obra_id, numero desc);
create trigger medicao_atualizado before update on public.medicao
  for each row execute function public.tocar_atualizado_em();
create trigger medicao_sem_apagar before delete on public.medicao
  for each row execute function public.evento_imutavel();

-- Depois de enviada, o conteúdo medido não muda (o cliente aprova exatamente o que viu).
create or replace function public.medicao_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.estado <> 'rascunho' and (new.itens is distinct from old.itens or new.percentual_atual <> old.percentual_atual
     or new.percentual_anterior <> old.percentual_anterior or new.data_corte <> old.data_corte or new.hash is distinct from old.hash
     or new.valor_medido <> old.valor_medido) then
    raise exception 'Medição enviada não muda. Cancele e gere outra.';
  end if;
  if old.estado in ('aprovada', 'cancelada') and new.estado <> old.estado then
    raise exception 'Medição % não muda de situação.', old.estado;
  end if;
  return new;
end $$;
create trigger medicao_antes before update on public.medicao
  for each row execute function public.medicao_antes();

-- Gera a medição a partir do avanço atual das etapas, comparando com a última aprovada.
create or replace function public.criar_medicao(p_obra uuid, p_data_corte date default null, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ant medicao; v_num int; v_itens jsonb; v_atual numeric; v_contratado numeric; v_id uuid;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório gera medições.'; end if;
  if not exists (select 1 from obra where id = p_obra and not arquivado and status <> 'cancelada') then
    raise exception 'Obra não encontrada, arquivada ou cancelada.';
  end if;
  if exists (select 1 from medicao where obra_id = p_obra and estado in ('rascunho', 'enviada')) then
    raise exception 'Já existe uma medição em aberto nesta obra. Envie, aguarde a resposta ou cancele antes de gerar outra.';
  end if;
  select * into v_ant from medicao where obra_id = p_obra and estado = 'aprovada' order by numero desc limit 1;
  select coalesce(max(numero), 0) + 1 into v_num from medicao where obra_id = p_obra;
  select coalesce(jsonb_agg(jsonb_build_object(
           'etapa_id', e.id, 'servico_id', s.id, 'servico', s.nome, 'etapa', e.nome, 'peso', e.peso,
           'anterior', coalesce((select (x->>'atual')::numeric from jsonb_array_elements(v_ant.itens) x where x->>'etapa_id' = e.id::text), 0),
           'atual', e.percentual) order by s.ordem, s.nome, e.ordem, e.nome), '[]')
    into v_itens
    from etapa e join servico s on s.id = e.servico_id
   where e.obra_id = p_obra and e.estado <> 'cancelado' and e.visivel_cliente and not s.arquivado;
  if jsonb_array_length(v_itens) = 0 then raise exception 'A obra ainda não tem etapas visíveis ao cliente para medir.'; end if;
  v_atual := coalesce((progresso_obra(p_obra)->>'executado')::numeric, 0);
  select coalesce(valor_contratado, 0) into v_contratado from obra_financeiro where obra_id = p_obra;
  insert into medicao (obra_id, numero, data_corte, itens, percentual_anterior, percentual_atual, valor_contratado, valor_medido, observacao)
  values (p_obra, v_num, coalesce(p_data_corte, (now() at time zone 'America/Sao_Paulo')::date), v_itens,
          coalesce(v_ant.percentual_atual, 0), v_atual, coalesce(v_contratado, 0),
          round(greatest(0, v_atual - coalesce(v_ant.percentual_atual, 0)) / 100 * coalesce(v_contratado, 0), 2),
          nullif(trim(p_observacao), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.enviar_medicao(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m medicao;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into m from medicao where id = p_id for update;
  if m.id is null then raise exception 'Medição não encontrada.'; end if;
  if m.estado = 'enviada' then return; end if;
  if m.estado <> 'rascunho' then raise exception 'Só medição em rascunho pode ser enviada.'; end if;
  update medicao set estado = 'enviada', enviada_em = now(),
         hash = left(encode(extensions.digest(convert_to(m.id::text || '|' || m.itens::text || '|' || m.percentual_atual::text, 'UTF8'), 'sha256'), 'hex'), 16)
   where id = p_id;
  insert into registro (obra_id, tipo, titulo, texto)
  values (m.obra_id, 'sistema', 'Medição enviada ao cliente', 'Medição nº ' || m.numero || ' (' || m.percentual_atual || '% executado) enviada pelo portal para aprovação.');
end $$;

create or replace function public.cancelar_medicao(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update medicao set estado = 'cancelada', cancelada_motivo = trim(p_motivo) where id = p_id and estado in ('rascunho', 'enviada', 'contestada');
  if not found then raise exception 'Medição não encontrada ou já aprovada.'; end if;
end $$;

-- Liga a medição aprovada a uma parcela a receber da mesma obra (a cobrança).
create or replace function public.vincular_parcela_medicao(p_id uuid, p_parcela uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m medicao;
begin
  if not (eh_equipe_adm() and tem_financeiro()) then raise exception 'Só quem tem acesso ao financeiro liga a cobrança.'; end if;
  select * into m from medicao where id = p_id;
  if m.id is null then raise exception 'Medição não encontrada.'; end if;
  if p_parcela is not null and not exists (
    select 1 from parcela pa join lancamento l on l.id = pa.lancamento_id
     where pa.id = p_parcela and l.tipo = 'receber' and l.obra_id = m.obra_id) then
    raise exception 'A parcela precisa ser a receber e da mesma obra.';
  end if;
  update medicao set parcela_id = p_parcela where id = p_id;
end $$;

-- O que o cliente vê de uma medição (sem valores).
create or replace function public.medicao_cliente(m public.medicao)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', m.id, 'numero', m.numero, 'data_corte', m.data_corte, 'estado', m.estado,
    'itens', (select coalesce(jsonb_agg(x - 'peso' - 'etapa_id' - 'servico_id'), '[]') from jsonb_array_elements(m.itens) x),
    'percentual_anterior', m.percentual_anterior, 'percentual_atual', m.percentual_atual, 'observacao', m.observacao,
    'hash', m.hash, 'enviada_em', m.enviada_em, 'respondida_em', m.respondida_em, 'resposta_nome', m.resposta_nome,
    'resposta_texto', m.resposta_texto)
$$;

-- Resposta do cliente pelo portal: aprovar ou contestar exatamente a versão que leu.
create or replace function public.portal_responder_medicao(p_token text, p_medicao uuid, p_hash text, p_acao text, p_nome text, p_texto text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a portal_acesso; m medicao; v_nome text := left(trim(coalesce(p_nome, '')), 120);
begin
  a := portal_exigir(p_token);
  select * into m from medicao where id = p_medicao and obra_id = a.obra_id for update;
  if m.id is null then raise exception 'Medição não encontrada nesta obra.'; end if;
  if m.estado <> 'enviada' then raise exception 'Esta medição já foi respondida ou não está mais aguardando aprovação.'; end if;
  if m.hash is distinct from p_hash then raise exception 'A medição foi atualizada. Recarregue a página e confira a versão nova.'; end if;
  if p_acao not in ('aprovar', 'contestar') then raise exception 'Ação inválida.'; end if;
  if length(v_nome) < 3 then raise exception 'Informe seu nome completo.'; end if;
  if p_acao = 'contestar' and length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva o que não confere na medição.'; end if;
  update medicao set estado = case p_acao when 'aprovar' then 'aprovada' else 'contestada' end,
         respondida_em = now(), resposta_pessoa_id = a.pessoa_id, resposta_nome = v_nome,
         resposta_texto = nullif(left(trim(coalesce(p_texto, '')), 2000), ''), resposta_user_agent = left(p_user_agent, 300)
   where id = m.id;
  insert into registro (obra_id, tipo, titulo, texto)
  values (m.obra_id, 'sistema', case p_acao when 'aprovar' then 'Medição aprovada pelo cliente' else 'Medição contestada pelo cliente' end,
          'Medição nº ' || m.numero || ' ' || case p_acao when 'aprovar' then 'aprovada' else 'contestada' end || ' por ' || v_nome
          || coalesce(': ' || left(nullif(trim(p_texto), ''), 500), '') || '.');
  return jsonb_build_object('ok', true, 'mensagem', case p_acao when 'aprovar' then 'Medição aprovada. A ROSAE recebeu sua confirmação.'
                                                     else 'Contestação enviada. A ROSAE vai rever a medição com você.' end);
end $$;

-- Portal passa a mostrar as medições enviadas e respondidas (a montagem antiga continua igual).
alter function public.portal_montar(uuid, uuid) rename to portal_montar_base;
create or replace function public.portal_montar(p_obra uuid, p_pessoa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return portal_montar_base(p_obra, p_pessoa) || jsonb_build_object(
    'medicoes', coalesce((select jsonb_agg(medicao_cliente(m) order by m.numero desc) from medicao m
                          where m.obra_id = p_obra and m.estado in ('enviada', 'aprovada', 'contestada')), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Assinatura do contrato pelo link
-- ---------------------------------------------------------------------
create table public.contrato_link (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contrato (id),
  token_hash text not null unique,
  expira_em timestamptz not null,
  revogado_em timestamptz,
  visualizacoes integer not null default 0,
  ultima_visualizacao timestamptz,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);

create table public.contrato_aceite (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contrato (id),
  link_id uuid references public.contrato_link (id),
  nome text not null,
  documento text not null,
  email text,
  declaracao text not null,
  hash_contrato text not null,
  user_agent text,
  em timestamptz not null default now()
);
create trigger contrato_aceite_imutavel before update or delete on public.contrato_aceite
  for each row execute function public.evento_imutavel();

create or replace function public.criar_link_contrato(p_contrato uuid, p_dias integer default 15)
returns text language plpgsql security definer set search_path = public as $$
declare c contrato; v_token text;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into c from contrato where id = p_contrato;
  if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  if c.estado <> 'emitido' then raise exception 'Só contrato emitido (e ainda não assinado) pode ir para assinatura.'; end if;
  update contrato_link set revogado_em = now() where contrato_id = p_contrato and revogado_em is null;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into contrato_link (contrato_id, token_hash, expira_em)
  values (p_contrato, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => greatest(1, least(coalesce(p_dias, 15), 90))));
  return v_token;
end $$;

create or replace function public.revogar_link_contrato(p_contrato uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  update contrato_link set revogado_em = now() where contrato_id = p_contrato and revogado_em is null;
end $$;

-- Interna (sem grant).
create or replace function public.contrato_link_valido(p_token text)
returns public.contrato_link language sql stable security definer set search_path = public as $$
  select * from contrato_link
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and revogado_em is null and expira_em > now()
$$;

-- Página pública do contrato: o documento congelado, a empresa e a situação.
create or replace function public.contrato_publico(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l contrato_link; c contrato; o obra; ac contrato_aceite;
begin
  l := contrato_link_valido(p_token);
  if l.id is null then return jsonb_build_object('erro', 'Link inválido, expirado ou substituído. Peça um novo link à ROSAE.'); end if;
  select * into c from contrato where id = l.contrato_id;
  select * into o from obra where id = c.obra_id;
  select * into ac from contrato_aceite where contrato_id = c.id order by em desc limit 1;
  update contrato_link set visualizacoes = visualizacoes + 1, ultima_visualizacao = now() where id = l.id;
  return jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'estado', c.estado, 'modelo', c.modelo, 'conteudo', c.conteudo, 'valor_total', c.valor_total,
    'minuta', c.minuta, 'hash', c.hash, 'emitido_em', c.emitido_em, 'assinado_em', c.assinado_em,
    'obra', jsonb_build_object('codigo', o.codigo, 'nome', o.nome, 'endereco', o.endereco),
    'empresa', empresa_publica(),
    'aceite', case when ac.id is null then null else jsonb_build_object('nome', ac.nome, 'em', ac.em) end);
end $$;

-- Aceite eletrônico do contratante. Assina o contrato (mesmo efeito do registro manual).
create or replace function public.contrato_assinar(p_token text, p_nome text, p_documento text, p_email text, p_hash text, p_concordo boolean, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l contrato_link; c contrato; v_nome text := left(trim(coalesce(p_nome, '')), 120);
        v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'); v_decl text; v_quando text;
begin
  l := contrato_link_valido(p_token);
  if l.id is null then raise exception 'Link inválido, expirado ou substituído. Peça um novo link à ROSAE.'; end if;
  select * into c from contrato where id = l.contrato_id for update;
  if c.estado = 'assinado' then return jsonb_build_object('ok', true, 'mensagem', 'Este contrato já estava assinado.'); end if;
  if c.estado <> 'emitido' then raise exception 'Este contrato não está disponível para assinatura.'; end if;
  if c.hash is distinct from p_hash then raise exception 'O contrato foi atualizado. Recarregue a página e leia a versão nova.'; end if;
  if length(v_nome) < 5 or position(' ' in v_nome) = 0 then raise exception 'Informe seu nome completo.'; end if;
  if length(v_doc) not in (11, 14) then raise exception 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.'; end if;
  if not coalesce(p_concordo, false) then raise exception 'Marque que leu e concorda com o contrato.'; end if;
  if (select count(*) from contrato_aceite where contrato_id = c.id and em > now() - interval '10 minutes') >= 5 then
    raise exception 'Muitas tentativas seguidas. Tente novamente em alguns minutos.';
  end if;
  v_quando := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
  v_decl := 'Eu, ' || v_nome || ', documento ' || v_doc || ', declaro que li o contrato ' || c.codigo
            || ' (versão ' || left(c.hash, 12) || ') e concordo com todas as suas cláusulas.';
  insert into contrato_aceite (contrato_id, link_id, nome, documento, email, declaracao, hash_contrato, user_agent)
  values (c.id, l.id, v_nome, v_doc, nullif(left(trim(coalesce(p_email, '')), 160), ''), v_decl, c.hash, left(p_user_agent, 300));
  update contrato set estado = 'assinado', assinado_em = (now() at time zone 'America/Sao_Paulo')::date,
         assinatura_registro = 'Aceite eletrônico pelo link: ' || v_nome || ' (doc. ' || v_doc || ') em ' || v_quando
   where id = c.id;
  update obra set status = 'contratada' where id = c.obra_id and status in ('em_negociacao', 'aprovada');
  update contrato_link set revogado_em = now() where contrato_id = c.id and revogado_em is null;
  insert into registro (obra_id, tipo, titulo, texto)
  values (c.obra_id, 'sistema', 'Contrato assinado pelo link', c.codigo || ' aceito eletronicamente por ' || v_nome || ' em ' || v_quando || '.');
  return jsonb_build_object('ok', true, 'mensagem', 'Contrato assinado. A ROSAE recebeu seu aceite e você pode imprimir uma cópia.');
end $$;

-- ---------------------------------------------------------------------
-- Central de pendências: medições e contratos aguardando
-- ---------------------------------------------------------------------
alter function public.central_pendencias() rename to central_pendencias_base;
-- As medições guardam valores em colunas protegidas: os avisos saem de uma função
-- própria, que só responde ao escritório (e o caso "aprovada sem cobrança" só a quem tem financeiro).
create or replace function public.medicao_pendencias()
returns table (chave text, tipo text, prioridade int, titulo text, detalhe text, link text, data date, obra text)
language sql stable security definer set search_path = public as $$
  select 'medicao:' || m.id || ':' || m.estado, 'medicao',
         case m.estado when 'contestada' then 1 else 2 end,
         case m.estado when 'contestada' then 'Medição contestada pelo cliente'
                       when 'aprovada' then 'Medição aprovada: lance a cobrança'
                       when 'enviada' then 'Medição aguardando o cliente'
                       else 'Medição em rascunho' end,
         'Medição nº ' || m.numero || ' · ' || m.percentual_atual || '% executado',
         '/obras/' || m.obra_id || '?aba=medicoes', coalesce((m.respondida_em at time zone 'America/Sao_Paulo')::date, m.data_corte), o.nome
  from medicao m join obra o on o.id = m.obra_id
  where eh_equipe_adm()
    and (m.estado in ('rascunho', 'contestada')
         or (m.estado = 'enviada' and m.enviada_em < now() - interval '3 days')
         or (m.estado = 'aprovada' and m.parcela_id is null and m.valor_medido > 0 and tem_financeiro()))
  union all
  select 'contrato_assinatura:' || k.id, 'documento', 2, 'Contrato aguardando assinatura', k.codigo,
         '/obras/' || k.obra_id || '?aba=contrato', (k.emitido_em at time zone 'America/Sao_Paulo')::date, o.nome
  from contrato k join obra o on o.id = k.obra_id
  where eh_equipe_adm() and k.estado = 'emitido' and k.emitido_em < now() - interval '3 days'
$$;

create or replace function public.central_pendencias()
returns table (chave text, tipo text, prioridade int, titulo text, detalhe text, link text, data date, obra text)
language sql stable set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select * from (
    select * from central_pendencias_base()
    union all
    select e.* from medicao_pendencias() e
    where not exists (select 1 from aviso_dispensado a where a.usuario_id = auth.uid() and a.chave = e.chave
                      and (a.ate is null or a.ate >= (select d from hoje)))
  ) x
  order by x.prioridade, x.data nulls last
$$;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['medicao', 'contrato_link', 'contrato_aceite'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Escritório lê; escrever só pelas funções. O valor medido só com acesso ao financeiro.
grant select (id, obra_id, numero, data_corte, estado, itens, percentual_anterior, percentual_atual, observacao, parcela_id, hash,
              enviada_em, respondida_em, resposta_pessoa_id, resposta_nome, resposta_texto, cancelada_motivo, criado_em, criado_por, atualizado_em)
  on public.medicao to authenticated;
create policy medicao_ler on public.medicao for select to authenticated using (eh_equipe_adm());
grant select (id, contrato_id, expira_em, revogado_em, visualizacoes, ultima_visualizacao, criado_em, criado_por) on public.contrato_link to authenticated;
create policy contrato_link_ler on public.contrato_link for select to authenticated using (eh_equipe_adm());
grant select on public.contrato_aceite to authenticated;
create policy contrato_aceite_ler on public.contrato_aceite for select to authenticated using (eh_equipe_adm());

-- Valor medido: função para quem tem financeiro (a coluna não é legível diretamente).
create or replace function public.medicoes_valores(p_obra uuid)
returns table (id uuid, valor_contratado numeric, valor_medido numeric)
language sql stable security definer set search_path = public as $$
  select m.id, m.valor_contratado, m.valor_medido from medicao m where m.obra_id = p_obra and eh_equipe_adm() and tem_financeiro()
$$;

grant execute on function
  public.criar_medicao(uuid, date, text), public.enviar_medicao(uuid), public.cancelar_medicao(uuid, text),
  public.vincular_parcela_medicao(uuid, uuid), public.medicoes_valores(uuid),
  public.criar_link_contrato(uuid, integer), public.revogar_link_contrato(uuid),
  public.central_pendencias(), public.medicao_pendencias()
to authenticated;
grant execute on function
  public.portal_responder_medicao(text, uuid, text, text, text, text, text),
  public.contrato_publico(text), public.contrato_assinar(text, text, text, text, text, boolean, text)
to anon, authenticated;
revoke all on function public.portal_montar_base(uuid, uuid), public.contrato_link_valido(text), public.medicao_cliente(public.medicao) from anon, authenticated, public;
