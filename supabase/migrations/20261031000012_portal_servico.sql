-- Portal imersivo: o cliente vê a jornada do tipo de serviço contratado
-- (projeto, reforço, reforma, construção, laudo). O portal passa a receber o tipo
-- de serviço da obra, o tipo do orçamento automático e os entregáveis da proposta
-- aprovada (texto que o cliente já recebeu na proposta; nada de valores).
create or replace function public.portal_montar(p_obra uuid, p_pessoa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tipo text; v_perfil text; v_entregaveis jsonb;
begin
  r := portal_montar_base(p_obra, p_pessoa) || jsonb_build_object(
    'medicoes', coalesce((select jsonb_agg(medicao_cliente(m) order by m.numero desc) from medicao m
                          where m.obra_id = p_obra and m.estado in ('enviada', 'aprovada', 'contestada')), '[]'));
  if jsonb_typeof(r->'obra') <> 'object' then return r; end if;
  select o.tipo_servico, nullif(pv.conteudo->'gerador'->>'tipo', ''),
         case when jsonb_typeof(pv.conteudo->'entregaveis') = 'array' then pv.conteudo->'entregaveis' else '[]'::jsonb end
    into v_tipo, v_perfil, v_entregaveis
    from obra o left join proposta_versao pv on pv.id = o.proposta_versao_id
   where o.id = p_obra;
  return jsonb_set(r, '{obra}', (r->'obra') || jsonb_build_object(
    'tipo_servico', v_tipo, 'perfil', v_perfil, 'entregaveis', coalesce(v_entregaveis, '[]'::jsonb)));
end $$;
revoke all on function public.portal_montar(uuid, uuid) from anon, authenticated, public;
