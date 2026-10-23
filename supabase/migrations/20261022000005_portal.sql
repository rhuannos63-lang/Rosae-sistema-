-- Etapa 5: portal do cliente.
-- Acesso por link pessoal (um por pessoa e obra), com expiração e revogação;
-- o banco guarda só o hash do token. O cliente não lê tabela nenhuma: tudo
-- passa por funções portal_* que montam apenas o que foi publicado e nunca
-- valores, pagamentos, notas, observações internas ou dados de outra obra.
-- Fotos publicadas ganham uma cópia reduzida (sem metadados) servida pela
-- função; despublicar apaga a cópia na hora.

alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

alter table public.obra
  add column portal_boas_vindas text,
  add column portal_capa_foto_id uuid references public.foto (id) on delete set null;

-- ---------------------------------------------------------------------
-- Acesso de cada pessoa
-- ---------------------------------------------------------------------
create table public.portal_acesso (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  pessoa_id uuid not null references public.pessoa (id),
  token_hash text not null unique,
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid,
  motivo_revogacao text,
  ultimo_acesso_em timestamptz,
  acessos integer not null default 0,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create unique index portal_acesso_vigente on public.portal_acesso (obra_id, pessoa_id) where revogado_em is null;

create or replace function public.portal_criar_acesso(p_obra uuid, p_pessoa uuid, p_dias integer default 180)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text; o obra;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório cria acesso ao portal.'; end if;
  select * into o from obra where id = p_obra;
  if not found then raise exception 'Obra não encontrada.'; end if;
  if o.arquivado or o.status = 'cancelada' then raise exception 'Obra arquivada ou cancelada não tem portal.'; end if;
  if not exists (select 1 from pessoa where id = p_pessoa) then raise exception 'Pessoa não encontrada.'; end if;
  update portal_acesso set revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = 'Substituído por um novo link'
   where obra_id = p_obra and pessoa_id = p_pessoa and revogado_em is null;
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into portal_acesso (obra_id, pessoa_id, token_hash, expira_em)
  values (p_obra, p_pessoa, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          now() + make_interval(days => greatest(1, least(coalesce(p_dias, 180), 365))));
  return v_token;
end $$;

create or replace function public.portal_revogar_acesso(p_acesso uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório revoga acesso ao portal.'; end if;
  update portal_acesso set revogado_em = now(), revogado_por = auth.uid(),
         motivo_revogacao = coalesce(nullif(trim(p_motivo), ''), 'Revogado pelo escritório')
   where id = p_acesso and revogado_em is null;
  if not found then raise exception 'Acesso não encontrado ou já revogado.'; end if;
end $$;

-- Interna (sem grant): acesso válido para o token, ou nulo.
create or replace function public.portal_acesso_valido(p_token text)
returns public.portal_acesso language sql stable security definer set search_path = public as $$
  select a.* from portal_acesso a join obra o on o.id = a.obra_id
  where a.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and a.revogado_em is null and a.expira_em > now()
    and not o.arquivado and o.status <> 'cancelada'
$$;

create or replace function public.portal_exigir(p_token text)
returns public.portal_acesso language plpgsql stable security definer set search_path = public as $$
declare a portal_acesso;
begin
  a := portal_acesso_valido(p_token);
  if a.id is null then raise exception 'Link inválido, expirado ou revogado. Peça um novo link à ROSAE.'; end if;
  return a;
end $$;

-- ---------------------------------------------------------------------
-- Cópia publicada das fotos
-- ---------------------------------------------------------------------
create table public.foto_portal (
  foto_id uuid primary key references public.foto (id) on delete cascade,
  obra_id uuid not null references public.obra (id) on delete cascade,
  imagem bytea not null,
  miniatura bytea not null,
  largura integer,
  altura integer,
  criado_em timestamptz not null default now()
);

create or replace function public.imagem_web_valida(p bytea, p_max integer)
returns boolean language sql immutable as $$
  select p is not null and length(p) between 100 and p_max
     and (substring(p from 1 for 3) = '\xffd8ff'::bytea
          or (substring(p from 1 for 4) = '\x52494646'::bytea and substring(p from 9 for 4) = '\x57454250'::bytea))
$$;

create or replace function public.publicar_foto(p_foto uuid, p_imagem text, p_miniatura text, p_largura integer default null, p_altura integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare f foto; v_img bytea; v_min bytea;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório publica fotos ao cliente.'; end if;
  select * into f from foto where id = p_foto;
  if not found then raise exception 'Foto não encontrada.'; end if;
  begin
    v_img := decode(p_imagem, 'base64');
    v_min := decode(p_miniatura, 'base64');
  exception when others then raise exception 'Imagem em formato inválido.';
  end;
  if not imagem_web_valida(v_img, 900000) or not imagem_web_valida(v_min, 120000) then
    raise exception 'A cópia da foto precisa ser JPEG ou WebP reduzida (até 900 KB).';
  end if;
  insert into foto_portal (foto_id, obra_id, imagem, miniatura, largura, altura)
  values (f.id, f.obra_id, v_img, v_min, p_largura, p_altura)
  on conflict (foto_id) do update set imagem = excluded.imagem, miniatura = excluded.miniatura,
    largura = excluded.largura, altura = excluded.altura, criado_em = now();
  update foto set publicada_em = coalesce(publicada_em, now()), publicada_por = coalesce(publicada_por, auth.uid()) where id = f.id;
end $$;

create or replace function public.despublicar_foto(p_foto uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório retira fotos do portal.'; end if;
  update foto set publicada_em = null, publicada_por = null where id = p_foto;
end $$;

-- Foto só fica publicada com cópia; despublicar apaga a cópia e a capa.
create or replace function public.foto_publicacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.publicada_em is not null and not exists (select 1 from foto_portal where foto_id = new.id) then
    raise exception 'Publique a foto pela aba Portal (ela precisa de uma cópia para o cliente).';
  end if;
  if new.publicada_em is null and old.publicada_em is not null then
    delete from foto_portal where foto_id = new.id;
    update obra set portal_capa_foto_id = null where portal_capa_foto_id = new.id;
  end if;
  return new;
end $$;
create trigger foto_publicacao before update of publicada_em on public.foto
  for each row execute function public.foto_publicacao();

create or replace function public.foto_publicada_insercao()
returns trigger language plpgsql as $$
begin
  if new.publicada_em is not null then raise exception 'Foto nova entra como interna; publique depois.'; end if;
  return new;
end $$;
create trigger foto_publicada_insercao before insert on public.foto
  for each row execute function public.foto_publicada_insercao();

create or replace function public.obra_capa_valida()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.portal_capa_foto_id is not null and not exists (
       select 1 from foto where id = new.portal_capa_foto_id and obra_id = new.id and publicada_em is not null) then
    raise exception 'A capa precisa ser uma foto publicada desta obra.';
  end if;
  return new;
end $$;
create trigger obra_capa_valida before insert or update of portal_capa_foto_id on public.obra
  for each row execute function public.obra_capa_valida();

-- Registros, pendências, etapas e materiais: publicar ou retirar.
create or replace function public.portal_publicar(p_tipo text, p_id uuid, p_publicar boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório publica ao cliente.'; end if;
  if p_tipo = 'registro' then
    if p_publicar and exists (select 1 from registro where id = p_id and tipo in ('nota_interna', 'sistema')) then
      raise exception 'Nota interna e registro do sistema não vão para o cliente.';
    end if;
    update registro set publicado_em = case when p_publicar then coalesce(publicado_em, now()) end,
                        publicado_por = case when p_publicar then coalesce(publicado_por, auth.uid()) end where id = p_id;
  elsif p_tipo = 'pendencia' then
    update pendencia set publicado_em = case when p_publicar then coalesce(publicado_em, now()) end where id = p_id;
  elsif p_tipo = 'etapa' then
    update etapa set visivel_cliente = p_publicar where id = p_id;
  elsif p_tipo = 'material' then
    update material set visivel_cliente = p_publicar where id = p_id;
  else
    raise exception 'Tipo desconhecido: %', p_tipo;
  end if;
  if not found then raise exception 'Registro não encontrado.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Comentários, solicitações e ciência (cada pessoa, a sua)
-- ---------------------------------------------------------------------
create table public.portal_comentario (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  acesso_id uuid references public.portal_acesso (id),
  pessoa_id uuid not null references public.pessoa (id),
  chave uuid not null unique, -- gerada no aparelho: reenviar não duplica
  alvo_tipo text not null default 'obra' check (alvo_tipo in ('obra', 'servico', 'etapa', 'foto', 'registro', 'pendencia')),
  alvo_id uuid,
  tipo text not null default 'comentario' check (tipo in ('comentario', 'pergunta', 'solicitacao_ajuste')),
  texto text not null check (length(trim(texto)) between 1 and 2000),
  estado text not null default 'aberto' check (estado in ('aberto', 'respondido', 'resolvido')),
  resposta text,
  respondido_por uuid,
  respondido_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint comentario_alvo check ((alvo_tipo = 'obra') = (alvo_id is null))
);
create index portal_comentario_obra_idx on public.portal_comentario (obra_id, criado_em desc);

create table public.portal_ciencia (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  acesso_id uuid references public.portal_acesso (id),
  pessoa_id uuid not null references public.pessoa (id),
  alvo_tipo text not null check (alvo_tipo in ('registro', 'pendencia')),
  alvo_id uuid not null,
  versao text not null,
  conteudo jsonb not null,
  user_agent text,
  criado_em timestamptz not null default now(),
  unique (pessoa_id, alvo_tipo, alvo_id, versao)
);
create index portal_ciencia_obra_idx on public.portal_ciencia (obra_id);
create trigger portal_ciencia_imutavel before update or delete on public.portal_ciencia
  for each row execute function public.evento_imutavel();

-- Só os campos de condição existente que fazem sentido para o cliente.
create or replace function public.portal_detalhes(d jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(coalesce(d, '{}')) as e(k, v)
  where k in ('condicao_anterior', 'riscos', 'protecao', 'recomposicao_inclusa', 'recomposicao_nao_inclusa',
              'impedimentos', 'solucao', 'aprovacao_necessaria')
    and v is not null and v <> '""'::jsonb and v <> 'false'::jsonb
$$;

-- Conteúdo que o cliente vê de um registro/pendência e a versão (hash) dele.
create or replace function public.portal_conteudo(p_tipo text, p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case p_tipo
    when 'registro' then (select jsonb_build_object('data', data, 'tipo', tipo, 'titulo', titulo, 'texto', texto,
                                 'detalhes', portal_detalhes(detalhes)) from registro where id = p_id)
    when 'pendencia' then (select jsonb_build_object('tipo', tipo, 'titulo', titulo, 'descricao', descricao, 'estado', estado,
                                 'prazo', prazo, 'responsavel', responsavel, 'resolucao', resolucao) from pendencia where id = p_id)
  end
$$;

create or replace function public.portal_versao(p_tipo text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select left(encode(extensions.digest(coalesce(portal_conteudo(p_tipo, p_id)::text, ''), 'sha256'), 'hex'), 16)
$$;

-- Interna: o alvo pertence à obra e está visível ao cliente?
create or replace function public.portal_alvo_visivel(p_obra uuid, p_tipo text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_tipo
    when 'obra' then p_id is null
    when 'servico' then exists (select 1 from servico where id = p_id and obra_id = p_obra and not arquivado)
    when 'etapa' then exists (select 1 from etapa where id = p_id and obra_id = p_obra and visivel_cliente and estado <> 'cancelado')
    when 'foto' then exists (select 1 from foto where id = p_id and obra_id = p_obra and publicada_em is not null)
    when 'registro' then exists (select 1 from registro where id = p_id and obra_id = p_obra and publicado_em is not null)
    when 'pendencia' then exists (select 1 from pendencia where id = p_id and obra_id = p_obra and publicado_em is not null)
    else false
  end
$$;

-- ---------------------------------------------------------------------
-- Montagem do que o cliente vê (uma única função para o portal e para
-- "Ver como cliente", para a prévia nunca divergir do real)
-- ---------------------------------------------------------------------
create or replace function public.portal_montar(p_obra uuid, p_pessoa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o obra; p jsonb; r jsonb;
begin
  select * into o from obra where id = p_obra;
  p := progresso_obra(p_obra);
  r := jsonb_build_object(
    'obra', jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'endereco', o.endereco, 'status', o.status,
              'data_inicio', o.data_inicio, 'data_previsao_fim', o.data_previsao_fim, 'data_conclusao', o.data_conclusao,
              'boas_vindas', o.portal_boas_vindas, 'capa', o.portal_capa_foto_id),
    'empresa', (select jsonb_build_object('nome', nome_fantasia, 'telefone', telefone, 'email', email, 'site', site,
              'responsavel', responsavel_tecnico, 'frase', frase_institucional) from empresa limit 1),
    'eu', (select jsonb_build_object('id', id, 'nome', nome) from pessoa where id = p_pessoa),
    'participantes', coalesce((select jsonb_agg(jsonb_build_object('id', pe.id, 'nome', pe.nome) order by pe.nome)
              from pessoa pe where pe.id in (select pessoa_id from portal_acesso where obra_id = p_obra and revogado_em is null)), '[]'),
    'progresso', jsonb_build_object('executado', p->'executado', 'conferido', p->'conferido', 'etapas', p->'etapas', 'concluidas', p->'concluidas'),
    'ambientes', coalesce((select jsonb_agg(x - 'peso') from jsonb_array_elements(p->'ambientes') x), '[]'),
    'servicos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'ordem', s.ordem,
                 'executado', (select (x->>'executado')::numeric from jsonb_array_elements(p->'servicos') x where x->>'id' = s.id::text),
                 'ambientes', coalesce((select jsonb_agg(sa.ambiente_id) from servico_ambiente sa where sa.servico_id = s.id), '[]'))
                 order by s.ordem, s.nome)
              from servico s where s.obra_id = p_obra and not s.arquivado), '[]'),
    'etapas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'servico_id', e.servico_id, 'nome', e.nome, 'estado', e.estado,
                 'percentual', e.percentual, 'inicio_previsto', e.inicio_previsto, 'fim_previsto', e.fim_previsto,
                 'inicio_real', e.inicio_real, 'fim_real', e.fim_real, 'ordem', e.ordem)
                 order by coalesce(e.inicio_previsto, e.inicio_real, '9999-12-31'), e.ordem)
              from etapa e where e.obra_id = p_obra and e.visivel_cliente and e.estado <> 'cancelado'), '[]'),
    'registros', coalesce((select jsonb_agg(portal_conteudo('registro', g.id) || jsonb_build_object('id', g.id,
                 'servico_id', g.servico_id, 'etapa_id', g.etapa_id, 'ambiente_id', g.ambiente_id, 'publicado_em', g.publicado_em,
                 'versao', portal_versao('registro', g.id)) order by g.data desc, g.publicado_em desc)
              from registro g where g.obra_id = p_obra and g.publicado_em is not null and g.tipo not in ('nota_interna', 'sistema')), '[]'),
    'pendencias', coalesce((select jsonb_agg(portal_conteudo('pendencia', d.id) || jsonb_build_object('id', d.id,
                 'servico_id', d.servico_id, 'etapa_id', d.etapa_id, 'publicado_em', d.publicado_em,
                 'versao', portal_versao('pendencia', d.id)) order by d.estado, d.prazo nulls last)
              from pendencia d where d.obra_id = p_obra and d.publicado_em is not null and d.estado <> 'cancelada'), '[]'),
    'fotos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'tirada_em', f.tirada_em, 'legenda', f.legenda, 'momento', f.momento,
                 'servico_id', f.servico_id, 'etapa_id', f.etapa_id, 'ambiente_id', f.ambiente_id, 'registro_id', f.registro_id,
                 'largura', fp.largura, 'altura', fp.altura) order by f.tirada_em desc)
              from foto f join foto_portal fp on fp.foto_id = f.id
              where f.obra_id = p_obra and f.publicada_em is not null), '[]'),
    'materiais', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'descricao', m.descricao, 'servico_id', m.servico_id,
                 'etapa_id', m.etapa_id, 'compra_cliente', m.responsavel_compra = 'cliente', 'necessario_em', m.necessario_em,
                 'situacao', case when m.situacao = 'na_obra' then 'disponivel'
                                  when m.situacao in ('parcial', 'comprado', 'comprado_parcial') then 'aguardando_entrega'
                                  else 'previsto' end) order by m.necessario_em nulls last, m.descricao)
              from v_material m where m.obra_id = p_obra and m.visivel_cliente and m.estado = 'ativo'), '[]'),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'alvo_tipo', c.alvo_tipo, 'alvo_id', c.alvo_id, 'tipo', c.tipo,
                 'texto', c.texto, 'autor', pe.nome, 'meu', c.pessoa_id = p_pessoa, 'criado_em', c.criado_em, 'estado', c.estado,
                 'resposta', c.resposta, 'respondido_em', c.respondido_em) order by c.criado_em)
              from portal_comentario c join pessoa pe on pe.id = c.pessoa_id where c.obra_id = p_obra), '[]'),
    'ciencias', coalesce((select jsonb_agg(jsonb_build_object('alvo_tipo', c.alvo_tipo, 'alvo_id', c.alvo_id, 'versao', c.versao,
                 'pessoa_id', c.pessoa_id, 'pessoa', pe.nome, 'criado_em', c.criado_em) order by c.criado_em)
              from portal_ciencia c join pessoa pe on pe.id = c.pessoa_id where c.obra_id = p_obra), '[]')
  );
  r := r || jsonb_build_object('ultima_atualizacao', greatest(
    (select max(publicado_em) from registro where obra_id = p_obra and publicado_em is not null and tipo not in ('nota_interna', 'sistema')),
    (select max(publicada_em) from foto where obra_id = p_obra),
    (select max(atualizado_em) from etapa where obra_id = p_obra and visivel_cliente)));
  return r;
end $$;

create or replace function public.portal_dados(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a portal_acesso;
begin
  a := portal_acesso_valido(p_token);
  if a.id is null then
    return jsonb_build_object('erro', 'Este link não está mais válido (expirou ou foi substituído). Peça um novo link à ROSAE.');
  end if;
  update portal_acesso set ultimo_acesso_em = now(), acessos = acessos + 1 where id = a.id;
  return portal_montar(a.obra_id, a.pessoa_id) || jsonb_build_object('expira_em', a.expira_em);
end $$;

-- "Ver como cliente": mesma montagem, para o escritório.
create or replace function public.portal_previa(p_obra uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório vê a prévia do portal.'; end if;
  if not exists (select 1 from obra where id = p_obra) then raise exception 'Obra não encontrada.'; end if;
  return portal_montar(p_obra, null) || jsonb_build_object('previa', true);
end $$;

-- Foto publicada (cópia reduzida), em base64. Token do cliente ou escritório (prévia).
create or replace function public.portal_foto(p_token text, p_foto uuid, p_grande boolean default false)
returns text language plpgsql stable security definer set search_path = public as $$
declare a portal_acesso; v bytea;
begin
  if p_token is null then
    if not eh_equipe_adm() then raise exception 'Sem acesso.'; end if;
    select case when p_grande then imagem else miniatura end into v
      from foto_portal fp join foto f on f.id = fp.foto_id where fp.foto_id = p_foto and f.publicada_em is not null;
  else
    a := portal_exigir(p_token);
    select case when p_grande then imagem else miniatura end into v
      from foto_portal fp join foto f on f.id = fp.foto_id
     where fp.foto_id = p_foto and f.obra_id = a.obra_id and f.publicada_em is not null;
  end if;
  if v is null then raise exception 'Foto não disponível.'; end if;
  return translate(encode(v, 'base64'), E'\n', '');
end $$;

create or replace function public.portal_comentar(p_token text, p_chave uuid, p_alvo_tipo text, p_alvo_id uuid, p_tipo text, p_texto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a portal_acesso; v_id uuid;
begin
  a := portal_exigir(p_token);
  select id into v_id from portal_comentario where chave = p_chave and pessoa_id = a.pessoa_id;
  if v_id is not null then return v_id; end if;
  if not portal_alvo_visivel(a.obra_id, coalesce(p_alvo_tipo, 'obra'), p_alvo_id) then
    raise exception 'Item não encontrado nesta obra.';
  end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva a mensagem.'; end if;
  if (select count(*) from portal_comentario where pessoa_id = a.pessoa_id and criado_em > now() - interval '1 hour') >= 30 then
    raise exception 'Muitas mensagens em pouco tempo. Tente de novo mais tarde.';
  end if;
  insert into portal_comentario (obra_id, acesso_id, pessoa_id, chave, alvo_tipo, alvo_id, tipo, texto)
  values (a.obra_id, a.id, a.pessoa_id, p_chave, coalesce(p_alvo_tipo, 'obra'), p_alvo_id, coalesce(p_tipo, 'comentario'), left(trim(p_texto), 2000))
  returning id into v_id;
  return v_id;
end $$;

-- Ciência: "li e estou ciente" desta versão. Não é aprovação técnica, quitação nem aceite contratual.
create or replace function public.portal_dar_ciencia(p_token text, p_alvo_tipo text, p_alvo_id uuid, p_versao text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a portal_acesso; v_atual text;
begin
  a := portal_exigir(p_token);
  if p_alvo_tipo not in ('registro', 'pendencia') or not portal_alvo_visivel(a.obra_id, p_alvo_tipo, p_alvo_id) then
    raise exception 'Item não encontrado nesta obra.';
  end if;
  v_atual := portal_versao(p_alvo_tipo, p_alvo_id);
  if v_atual is distinct from p_versao then
    raise exception 'Este conteúdo foi atualizado. Recarregue a página e leia a versão nova.';
  end if;
  insert into portal_ciencia (obra_id, acesso_id, pessoa_id, alvo_tipo, alvo_id, versao, conteudo, user_agent)
  values (a.obra_id, a.id, a.pessoa_id, p_alvo_tipo, p_alvo_id, v_atual, portal_conteudo(p_alvo_tipo, p_alvo_id), left(p_user_agent, 300))
  on conflict (pessoa_id, alvo_tipo, alvo_id, versao) do nothing;
  return jsonb_build_object('versao', v_atual);
end $$;

create or replace function public.responder_comentario(p_id uuid, p_resposta text, p_estado text default 'respondido')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório responde no portal.'; end if;
  if p_estado not in ('aberto', 'respondido', 'resolvido') then raise exception 'Estado inválido.'; end if;
  update portal_comentario set resposta = nullif(trim(p_resposta), ''), estado = p_estado,
         respondido_por = auth.uid(), respondido_em = case when nullif(trim(p_resposta), '') is null then null else now() end
   where id = p_id;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Auditoria e permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['portal_acesso', 'portal_comentario', 'portal_ciencia'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.auditar()', t || '_auditoria', t);
  end loop;
  foreach t in array array['portal_acesso', 'portal_comentario', 'portal_ciencia', 'foto_portal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Escritório lê; escrever só pelas funções. Campo e cliente: nada.
grant select (id, obra_id, pessoa_id, expira_em, revogado_em, revogado_por, motivo_revogacao, ultimo_acesso_em, acessos, criado_em, criado_por)
  on public.portal_acesso to authenticated;
create policy portal_acesso_ler on public.portal_acesso for select to authenticated using (eh_equipe_adm());
grant select on public.portal_comentario, public.portal_ciencia to authenticated;
create policy portal_comentario_ler on public.portal_comentario for select to authenticated using (eh_equipe_adm());
create policy portal_ciencia_ler on public.portal_ciencia for select to authenticated using (eh_equipe_adm());

grant execute on function
  public.portal_criar_acesso(uuid, uuid, integer), public.portal_revogar_acesso(uuid, text),
  public.publicar_foto(uuid, text, text, integer, integer), public.despublicar_foto(uuid),
  public.portal_publicar(text, uuid, boolean), public.portal_previa(uuid), public.responder_comentario(uuid, text, text)
to authenticated;
grant execute on function
  public.portal_dados(text), public.portal_foto(text, uuid, boolean),
  public.portal_comentar(text, uuid, text, uuid, text, text), public.portal_dar_ciencia(text, text, uuid, text, text)
to anon, authenticated;
