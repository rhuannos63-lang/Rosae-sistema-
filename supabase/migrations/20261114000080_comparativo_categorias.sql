-- Comparativo orçado × fechado por categoria, em cada obra.
-- As categorias e o "orçado" saem sempre do orçamento aceito (e dos aditivos aceitos), calculados
-- na tela. Aqui fica só o que o Rhuann lança: quanto fechou com cada profissional ou fornecedor,
-- valores fechados em pacote, linhas e categorias que não estavam no orçamento.
create table public.obra_comparativo (
  obra_id uuid primary key references public.obra (id) on delete cascade,
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create trigger obra_comparativo_atualizado before update on public.obra_comparativo
  for each row execute function public.tocar_atualizado_em();

alter table public.obra_comparativo enable row level security;
-- Custo e margem são do financeiro: quem não tem acesso ao financeiro não lê nem grava.
create policy obra_comparativo_fin on public.obra_comparativo for all to authenticated
  using (tem_financeiro()) with check (tem_financeiro());
grant select, insert, update on public.obra_comparativo to authenticated;
