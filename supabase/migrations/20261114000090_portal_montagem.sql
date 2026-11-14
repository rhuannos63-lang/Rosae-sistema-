-- Montagem do portal: a ROSAE escolhe o que o cliente vê na página inicial do
-- acompanhamento (blocos, ordem, títulos), quais abas aparecem e os textos do
-- serviço (o que pedimos, cuidados, dúvidas). O sistema sugere pelo tipo de
-- serviço; sem montagem gravada, o portal segue a sugestão.
alter table public.obra add column if not exists portal_montagem jsonb;
alter table public.obra drop constraint if exists obra_portal_montagem_objeto;
alter table public.obra add constraint obra_portal_montagem_objeto
  check (portal_montagem is null or (jsonb_typeof(portal_montagem) = 'object' and pg_column_size(portal_montagem) < 65536));

create or replace function public.portal_montar(p_obra uuid, p_pessoa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tipo text; v_perfil text; v_entregaveis jsonb; v_montagem jsonb;
begin
  r := portal_montar_base(p_obra, p_pessoa) || jsonb_build_object(
    'medicoes', coalesce((select jsonb_agg(medicao_cliente(m) order by m.numero desc) from medicao m
                          where m.obra_id = p_obra and m.estado in ('enviada', 'aprovada', 'contestada')), '[]'));
  if jsonb_typeof(r->'obra') <> 'object' then return r; end if;
  select o.tipo_servico, nullif(pv.conteudo->'gerador'->>'tipo', ''),
         case when jsonb_typeof(pv.conteudo->'entregaveis') = 'array' then pv.conteudo->'entregaveis' else '[]'::jsonb end,
         o.portal_montagem
    into v_tipo, v_perfil, v_entregaveis, v_montagem
    from obra o left join proposta_versao pv on pv.id = o.proposta_versao_id
   where o.id = p_obra;
  return jsonb_set(r, '{obra}', (r->'obra') || jsonb_build_object(
    'tipo_servico', v_tipo, 'perfil', v_perfil, 'entregaveis', coalesce(v_entregaveis, '[]'::jsonb),
    'montagem', v_montagem));
end $$;
revoke all on function public.portal_montar(uuid, uuid) from anon, authenticated, public;
