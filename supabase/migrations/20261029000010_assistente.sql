-- =====================================================================
-- Assistente de IA (no sistema e no WhatsApp)
-- Regras:
--  * o assistente age sempre como a pessoa logada: as consultas e gravações
--    passam pelas mesmas permissões do sistema (RLS e funções);
--  * nada é gravado sem confirmação: a IA só propõe ações, que ficam em
--    assistente_acao até a pessoa confirmar ou cancelar;
--  * o WhatsApp só fala com números vinculados por código gerado no sistema.
-- =====================================================================

-- Ajustes gerais (uma linha só). O dono escolhe provedor e modelo de IA.
create table public.assistente_config (
  id boolean primary key default true check (id),
  provedor text not null default 'claude' check (provedor in ('claude', 'gemini')),
  modelo text not null default 'claude-opus-5-5' check (length(trim(modelo)) > 0),
  whatsapp_ativo boolean not null default true,
  instrucoes text,
  atualizado_em timestamptz not null default now()
);
insert into public.assistente_config default values;
create trigger assistente_config_atualizado before update on public.assistente_config
  for each row execute function public.tocar_atualizado_em();

-- Número de WhatsApp de cada usuário da equipe. Só é gravado quando a pessoa
-- manda pelo WhatsApp o código gerado no sistema (prova que o número é dela).
create table public.assistente_vinculo (
  usuario_id uuid primary key default auth.uid() references public.usuario (id) on delete cascade,
  telefone text unique check (telefone is null or telefone ~ '^[0-9]{10,15}$'),
  codigo text check (codigo is null or codigo ~ '^[0-9]{6}$'),
  codigo_expira timestamptz,
  vinculado_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Conversa (só o texto final de cada lado; as consultas internas não ficam guardadas).
create table public.assistente_mensagem (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references public.usuario (id) on delete cascade,
  canal text not null check (canal in ('sistema', 'whatsapp')),
  papel text not null check (papel in ('usuario', 'assistente')),
  texto text not null,
  anexo jsonb,
  criado_em timestamptz not null default now()
);
create index assistente_mensagem_idx on public.assistente_mensagem (usuario_id, criado_em desc);

-- Ações propostas pela IA, que só valem depois de confirmadas.
create table public.assistente_acao (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references public.usuario (id) on delete cascade,
  canal text not null check (canal in ('sistema', 'whatsapp')),
  tipo text not null check (tipo in ('lancar_conta', 'registrar_diario', 'criar_pendencia', 'resolver_pendencia',
                                     'atualizar_etapa', 'novo_lead', 'salvar_foto')),
  dados jsonb not null,
  resumo text not null check (length(trim(resumo)) > 0),
  estado text not null default 'proposta' check (estado in ('proposta', 'executada', 'cancelada', 'erro')),
  resultado jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  decidida_em timestamptz
);
create index assistente_acao_idx on public.assistente_acao (usuario_id, estado, criado_em desc);

-- Mensagens do WhatsApp já processadas (a Meta pode reenviar a mesma).
create table public.whatsapp_recebida (
  id text primary key,
  recebida_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Vincular o WhatsApp
-- ---------------------------------------------------------------------
create or replace function public.assistente_gerar_codigo()
returns text language plpgsql security definer set search_path = public as $$
declare v_codigo text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
  if not eh_equipe() then raise exception 'Só a equipe usa o assistente.'; end if;
  insert into assistente_vinculo (usuario_id, codigo, codigo_expira)
  values (auth.uid(), v_codigo, now() + interval '15 minutes')
  on conflict (usuario_id) do update set codigo = excluded.codigo, codigo_expira = excluded.codigo_expira;
  return v_codigo;
end $$;

create or replace function public.assistente_desvincular()
returns void language sql security definer set search_path = public as $$
  update assistente_vinculo set telefone = null, vinculado_em = null, codigo = null, codigo_expira = null
  where usuario_id = auth.uid()
$$;

-- Chamada só pelo servidor do WhatsApp (service_role), quando chega "vincular 123456".
create or replace function public.assistente_confirmar_vinculo(p_telefone text, p_codigo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_usuario uuid; v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  select usuario_id into v_usuario from assistente_vinculo
  where codigo = trim(p_codigo) and codigo_expira >= now();
  if v_usuario is null then return null; end if;
  update assistente_vinculo set telefone = null, vinculado_em = null where telefone = v_tel and usuario_id <> v_usuario;
  update assistente_vinculo set telefone = v_tel, vinculado_em = now(), codigo = null, codigo_expira = null
  where usuario_id = v_usuario;
  return v_usuario;
end $$;

-- Quem é o dono deste número (só equipe ativa).
create or replace function public.assistente_usuario_por_telefone(p_telefone text)
returns table (usuario_id uuid, email text, nome text) language sql stable security definer set search_path = public as $$
  select u.id, coalesce(a.email, u.email), u.nome
  from assistente_vinculo v
  join usuario u on u.id = v.usuario_id and u.ativo and u.papel in ('administrador', 'administrativo', 'campo')
  left join auth.users a on a.id = u.id
  where v.telefone = regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['assistente_config', 'assistente_vinculo', 'assistente_mensagem', 'assistente_acao', 'whatsapp_recebida'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select, update on public.assistente_config to authenticated;
create policy assistente_config_ler on public.assistente_config for select to authenticated using (eh_equipe());
create policy assistente_config_editar on public.assistente_config for update to authenticated using (eh_admin()) with check (eh_admin());

grant select on public.assistente_vinculo to authenticated;
create policy assistente_vinculo_proprio on public.assistente_vinculo for select to authenticated using (usuario_id = auth.uid());

grant select, insert, delete on public.assistente_mensagem to authenticated;
create policy assistente_mensagem_ler on public.assistente_mensagem for select to authenticated using (usuario_id = auth.uid());
create policy assistente_mensagem_incluir on public.assistente_mensagem for insert to authenticated
  with check (usuario_id = auth.uid() and eh_equipe());
create policy assistente_mensagem_apagar on public.assistente_mensagem for delete to authenticated using (usuario_id = auth.uid());

grant select, insert, update on public.assistente_acao to authenticated;
create policy assistente_acao_ler on public.assistente_acao for select to authenticated using (usuario_id = auth.uid());
create policy assistente_acao_incluir on public.assistente_acao for insert to authenticated
  with check (usuario_id = auth.uid() and eh_equipe() and estado = 'proposta');
create policy assistente_acao_editar on public.assistente_acao for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

revoke all on function public.assistente_gerar_codigo() from public;
revoke all on function public.assistente_desvincular() from public;
revoke all on function public.assistente_confirmar_vinculo(text, text) from public;
revoke all on function public.assistente_usuario_por_telefone(text) from public;
grant execute on function public.assistente_gerar_codigo() to authenticated;
grant execute on function public.assistente_desvincular() to authenticated;
grant execute on function public.assistente_confirmar_vinculo(text, text) to service_role;
grant execute on function public.assistente_usuario_por_telefone(text) to service_role;
grant select, insert on public.whatsapp_recebida to service_role;
