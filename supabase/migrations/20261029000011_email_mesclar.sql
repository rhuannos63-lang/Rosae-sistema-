-- Envio de propostas por e-mail com provedor real (Resend) e mesclagem de cadastros duplicados.

-- ---------------------------------------------------------------------
-- E-mail: cada envio é um registro com situação própria. Quem grava a situação
-- é a função "email" do servidor (chave de serviço), nunca a tela: assim
-- "enviado" só aparece quando o provedor aceitou de fato.
-- ---------------------------------------------------------------------
create table public.envio_email (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references public.proposta (id),
  versao_id uuid not null references public.proposta_versao (id),
  destinatario text not null check (destinatario ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  assunto text not null check (length(trim(assunto)) > 0),
  mensagem text not null,
  -- enviando: a função está falando com o provedor; enviado: o provedor aceitou;
  -- entregue / devolvido: o provedor confirmou; falhou: dá para tentar de novo.
  estado text not null default 'enviando' check (estado in ('enviando', 'enviado', 'entregue', 'devolvido', 'falhou')),
  provedor text not null default 'resend',
  provedor_id text,
  erro text,
  -- Gerada pela tela ao abrir o envio: clicar duas vezes ou tentar de novo não duplica.
  chave text not null unique check (length(chave) between 16 and 80),
  tentativas integer not null default 1,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index envio_email_versao on public.envio_email (versao_id, criado_em desc);
create trigger envio_email_atualizado before update on public.envio_email
  for each row execute function public.tocar_atualizado_em();
alter table public.envio_email enable row level security;
create policy envio_email_ler on public.envio_email for select to authenticated using (eh_equipe_adm());
grant select on public.envio_email to authenticated;

-- ---------------------------------------------------------------------
-- Mesclar cadastros: o duplicado passa tudo para o que fica e é apagado
-- (a auditoria guarda a cópia). Dados vazios do que fica são completados.
-- Não mescla quem já tem acesso ou manifestações no portal: ciência e
-- comentários são da pessoa e não podem mudar de dono.
-- ---------------------------------------------------------------------
create or replace function public.mesclar_pessoas(p_manter uuid, p_remover uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a pessoa; b pessoa; n integer; total integer := 0; r jsonb := '{}';
begin
  if not eh_admin() then raise exception 'Só o administrador mescla cadastros.'; end if;
  if p_manter is null or p_remover is null or p_manter = p_remover then raise exception 'Escolha dois cadastros diferentes.'; end if;
  select * into a from pessoa where id = p_manter for update;
  select * into b from pessoa where id = p_remover for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado.'; end if;
  if a.documento is not null and b.documento is not null
     and regexp_replace(a.documento, '\D', '', 'g') <> regexp_replace(b.documento, '\D', '', 'g') then
    raise exception 'Os dois cadastros têm CPF/CNPJ diferentes. Confira antes de mesclar.';
  end if;
  if exists (select 1 from portal_acesso where pessoa_id = p_remover)
     or exists (select 1 from portal_comentario where pessoa_id = p_remover)
     or exists (select 1 from portal_ciencia where pessoa_id = p_remover)
     or exists (select 1 from medicao where resposta_pessoa_id = p_remover) then
    raise exception '"%" já usa o portal do cliente (acesso, comentários ou ciência). Mescle no sentido contrário: mantenha este cadastro.', b.nome;
  end if;

  update oportunidade set pessoa_id = p_manter where pessoa_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('oportunidades', n); total := total + n;
  update proposta set pessoa_id = p_manter where pessoa_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('propostas', n); total := total + n;
  update obra set cliente_id = p_manter where cliente_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('obras', n); total := total + n;
  update lancamento set pessoa_id = p_manter where pessoa_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('lancamentos', n); total := total + n;
  update contratacao set pessoa_id = p_manter where pessoa_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('contratacoes', n); total := total + n;
  update etapa set responsavel_id = p_manter where responsavel_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('etapas', n); total := total + n;
  update material set fornecedor_id = p_manter where fornecedor_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('materiais', n); total := total + n;
  update nota_fiscal set fornecedor_id = p_manter where fornecedor_id = p_remover; get diagnostics n = row_count; r := r || jsonb_build_object('notas', n); total := total + n;

  update pessoa set
    documento = coalesce(documento, b.documento),
    telefone = coalesce(nullif(telefone, ''), b.telefone),
    email = coalesce(nullif(email, ''), b.email),
    endereco = coalesce(nullif(endereco, ''), b.endereco),
    especialidade = coalesce(nullif(especialidade, ''), b.especialidade),
    chave_pix = coalesce(nullif(chave_pix, ''), b.chave_pix),
    eh_cliente = eh_cliente or b.eh_cliente,
    eh_fornecedor = eh_fornecedor or b.eh_fornecedor,
    eh_prestador = eh_prestador or b.eh_prestador,
    arquivado = arquivado and b.arquivado,
    observacoes = nullif(concat_ws(E'\n', nullif(observacoes, ''),
      format('Mesclado com "%s" em %s.', b.nome, to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
      nullif(b.observacoes, '')), '')
  where id = p_manter;
  delete from pessoa where id = p_remover;
  return r || jsonb_build_object('total', total);
end $$;

-- Possíveis duplicados: mesmo telefone (só dígitos, últimos 9), mesmo e-mail ou mesmo documento.
create or replace function public.pessoas_duplicadas()
returns table (a uuid, a_nome text, b uuid, b_nome text, motivo text)
language sql stable security definer set search_path = public as $$
  with p as (
    select id, nome, criado_em,
      nullif(right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9), '') as tel,
      nullif(lower(trim(coalesce(email, ''))), '') as mail,
      nullif(regexp_replace(coalesce(documento, ''), '\D', '', 'g'), '') as doc
    from pessoa where eh_equipe_adm()
  )
  select distinct on (x.id, y.id) x.id, x.nome, y.id, y.nome,
    case when x.doc = y.doc then 'mesmo CPF/CNPJ' when x.mail = y.mail then 'mesmo e-mail' else 'mesmo telefone' end
  from p x join p y on x.criado_em < y.criado_em or (x.criado_em = y.criado_em and x.id < y.id)
  where (x.doc = y.doc) or (x.mail = y.mail) or (length(x.tel) = 9 and x.tel = y.tel)
  order by x.id, y.id
  limit 50
$$;

revoke all on function public.mesclar_pessoas(uuid, uuid), public.pessoas_duplicadas() from public, anon;
grant execute on function public.mesclar_pessoas(uuid, uuid), public.pessoas_duplicadas() to authenticated;

-- ---------------------------------------------------------------------
-- Nota lida pela IA a partir de foto ou PDF: entra como rascunho para conferir,
-- igual ao XML. A origem fica registrada.
-- ---------------------------------------------------------------------
alter table public.nota_fiscal drop constraint nota_fiscal_origem_check;
alter table public.nota_fiscal add constraint nota_fiscal_origem_check check (origem in ('xml', 'manual', 'leitura'));

-- ---------------------------------------------------------------------
-- Privacidade: anonimizar um cadastro a pedido da pessoa. Os registros
-- financeiros e contratuais continuam (valores, datas, documentos emitidos),
-- mas nome, contatos e documento saem do cadastro e do histórico de auditoria.
-- ---------------------------------------------------------------------
create or replace function public.auditoria_imutavel()
returns trigger language plpgsql as $$
begin
  -- Única exceção: a anonimização (função abaixo) apaga dados pessoais do histórico.
  if tg_op = 'UPDATE' and coalesce(current_setting('rosae.anonimizando', true), '') = 'sim' then return new; end if;
  raise exception 'Auditoria só aceita inclusão.';
end $$;

create or replace function public.anonimizar_pessoa(p_pessoa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pessoa; v_mesclados text[];
begin
  if not eh_admin() then raise exception 'Só o administrador anonimiza cadastros.'; end if;
  select * into p from pessoa where id = p_pessoa for update;
  if p.id is null then raise exception 'Cadastro não encontrado.'; end if;
  update portal_acesso set revogado_em = now() where pessoa_id = p_pessoa and revogado_em is null;
  update pessoa set nome = 'Cadastro anonimizado ' || coalesce(codigo, left(id::text, 8)), documento = null, telefone = null, email = null,
    endereco = null, chave_pix = null, especialidade = null, observacoes = null, arquivado = true
  where id = p_pessoa;
  -- Cadastros repetidos que foram mesclados neste (apagados) com o mesmo e-mail, documento ou telefone.
  select coalesce(array_agg(distinct registro_id), '{}') into v_mesclados from auditoria
  where tabela = 'pessoa' and acao = 'delete' and antes is not null and (
    (p.email is not null and lower(antes->>'email') = lower(p.email))
    or (nullif(regexp_replace(coalesce(p.documento, ''), '\D', '', 'g'), '') = regexp_replace(coalesce(antes->>'documento', ''), '\D', '', 'g'))
    or (length(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g')) >= 9
        and right(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), 9) = right(regexp_replace(coalesce(antes->>'telefone', ''), '\D', '', 'g'), 9)));
  perform set_config('rosae.anonimizando', 'sim', true);
  update auditoria set
    antes = case when antes is null then null else jsonb_build_object('id', p_pessoa, 'anonimizado', true) end,
    depois = case when depois is null then null else jsonb_build_object('id', p_pessoa, 'anonimizado', true) end
  where tabela = 'pessoa' and (registro_id = p_pessoa::text or registro_id = any(v_mesclados));
  perform set_config('rosae.anonimizando', '', true);
  insert into auditoria (tabela, registro_id, acao, usuario_id, antes, depois)
  values ('pessoa', p_pessoa::text, 'anonimizar', auth.uid(), null, jsonb_build_object('id', p_pessoa, 'anonimizado', true));
end $$;
revoke all on function public.anonimizar_pessoa(uuid) from public, anon;
grant execute on function public.anonimizar_pessoa(uuid) to authenticated;
