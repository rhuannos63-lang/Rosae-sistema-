-- Preferências de cada usuário (aparência do sistema). Cada um lê e grava só as suas.
create table public.preferencia_usuario (
  usuario_id uuid primary key references public.usuario (id) on delete cascade default auth.uid(),
  aparencia jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
create trigger preferencia_usuario_atualizado before update on public.preferencia_usuario
  for each row execute function public.tocar_atualizado_em();

alter table public.preferencia_usuario enable row level security;
create policy preferencia_propria on public.preferencia_usuario for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.preferencia_usuario to authenticated;
