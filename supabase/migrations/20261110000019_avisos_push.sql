-- Avisos no celular e no computador (notificação do aplicativo instalado) quando um
-- cliente aceita uma proposta. Cada aparelho que ativou os avisos guarda aqui a sua
-- inscrição; a função "avisos" envia a notificação pelo serviço de push do navegador.

-- Inscrição de um aparelho (gerada pelo navegador). Cada pessoa vê e apaga só as suas.
create table public.push_assinatura (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid(),
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  aparelho text,
  criado_em timestamptz not null default now(),
  ultimo_envio timestamptz,
  falhas integer not null default 0
);
create index push_assinatura_usuario on public.push_assinatura (usuario_id);
alter table public.push_assinatura enable row level security;
create policy push_assinatura_ver on public.push_assinatura for select to authenticated using (usuario_id = auth.uid());
create policy push_assinatura_incluir on public.push_assinatura for insert to authenticated with check (usuario_id = auth.uid() and eh_equipe_adm());
create policy push_assinatura_apagar on public.push_assinatura for delete to authenticated using (usuario_id = auth.uid());
grant select, insert, delete on public.push_assinatura to authenticated;

-- Chave do servidor (VAPID), criada sozinha pela função no primeiro uso. Só a função lê (chave de serviço).
create table public.push_chave (
  id integer primary key default 1 check (id = 1),
  publica text not null,
  privada jsonb not null,
  criado_em timestamptz not null default now()
);
alter table public.push_chave enable row level security;
revoke all on public.push_chave from anon, authenticated;

-- Aceites já avisados (um aviso por aceite, mesmo com várias chamadas).
create table public.push_avisado (
  evento_id bigint primary key, -- proposta_evento.id (sem chave estrangeira: a lixeira pode apagar a proposta)
  em timestamptz not null default now(),
  enviados integer not null default 0
);
alter table public.push_avisado enable row level security;
revoke all on public.push_avisado from anon, authenticated;
