-- Testes da Etapa 5: portal do cliente (acesso por link pessoal, publicação, fotos, comentários e ciência).
create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.deve_falhar(p_sql text, p_motivo text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU: deveria ter sido recusado: %', p_motivo;
end $$;
create or replace function pg_temp.igual(p_obtido anyelement, p_esperado anyelement, p_motivo text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (obtido %, esperado %)', p_motivo, p_obtido, p_esperado;
  end if;
end $$;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Imagem "JPEG" mínima (só o cabeçalho importa para a validação).
insert into t values ('jpg', encode('\xffd8ffe0'::bytea || convert_to(repeat('x', 300), 'UTF8'), 'base64'));
insert into t values ('o1', '20000000-0000-0000-0000-000000000001'), ('o2', '20000000-0000-0000-0000-000000000002'),
                     ('p1', '10000000-0000-0000-0000-000000000001');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- Segunda pessoa da mesma obra (cônjuge) e uma etapa visível.
with x as (insert into public.pessoa (nome, eh_cliente) values ('Cônjuge Fictícia', true) returning id) insert into t select 'p2', id::text from x;
with x as (insert into public.etapa (obra_id, servico_id, nome, estado, inicio_previsto, fim_previsto)
           values ((select v::uuid from t where k = 'o1'), '30000000-0000-0000-0000-000000000001', 'Escoramento', 'em_execucao', '2026-10-20', '2026-10-25') returning id)
  insert into t select 'e1', id::text from x;
with x as (insert into public.etapa (obra_id, servico_id, nome, visivel_cliente)
           values ((select v::uuid from t where k = 'o1'), '30000000-0000-0000-0000-000000000001', 'Etapa interna', false) returning id)
  insert into t select 'e2', id::text from x;
with x as (insert into public.registro (obra_id, tipo, titulo, texto) values ((select v::uuid from t where k = 'o1'), 'andamento', 'Escoramento iniciado', 'Escoras posicionadas na cozinha.') returning id)
  insert into t select 'r1', id::text from x;
with x as (insert into public.registro (obra_id, tipo, texto) values ((select v::uuid from t where k = 'o1'), 'nota_interna', 'SEGREDO-INTERNO margem apertada') returning id)
  insert into t select 'r2', id::text from x;
with x as (insert into public.registro (obra_id, tipo, texto) values ((select v::uuid from t where k = 'o1'), 'andamento', 'RASCUNHO-NAO-PUBLICADO') returning id)
  insert into t select 'r3', id::text from x;
with x as (insert into public.registro (obra_id, tipo, texto) values ((select v::uuid from t where k = 'o2'), 'andamento', 'OUTRA-OBRA') returning id)
  insert into t select 'r4', id::text from x;
with x as (insert into public.foto (obra_id, caminho, momento) values ((select v::uuid from t where k = 'o1'), 'obras/' || (select v from t where k = 'o1') || '/fotos/p1.jpg', 'antes') returning id)
  insert into t select 'f1', id::text from x;
with x as (insert into public.foto (obra_id, caminho, momento) values ((select v::uuid from t where k = 'o2'), 'obras/' || (select v from t where k = 'o2') || '/fotos/p2.jpg', 'depois') returning id)
  insert into t select 'f2', id::text from x;
with x as (insert into public.material (obra_id, descricao, quantidade, responsavel_compra) values ((select v::uuid from t where k = 'o1'), 'Escoras metálicas', 10, 'rosae') returning id)
  insert into t select 'm1', id::text from x;
update public.obra_financeiro set valor_contratado = 98765.43 where obra_id = (select v::uuid from t where k = 'o1');

-- Publicação
select public.portal_publicar('registro', (select v::uuid from t where k = 'r1'), true);
select public.portal_publicar('registro', (select v::uuid from t where k = 'r4'), true);
select pg_temp.deve_falhar($$select public.portal_publicar('registro', (select v::uuid from t where k = 'r2'), true)$$, 'publicar nota interna');
select pg_temp.deve_falhar($$update public.foto set publicada_em = now() where id = (select v::uuid from t where k = 'f1')$$, 'publicar foto sem cópia');
select pg_temp.deve_falhar($$select public.publicar_foto((select v::uuid from t where k = 'f1'), encode('GIF89a-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'::bytea, 'base64'), (select v from t where k = 'jpg'))$$, 'cópia que não é JPEG/WebP');
select public.publicar_foto((select v::uuid from t where k = 'f1'), (select v from t where k = 'jpg'), (select v from t where k = 'jpg'), 1280, 960);
select public.publicar_foto((select v::uuid from t where k = 'f2'), (select v from t where k = 'jpg'), (select v from t where k = 'jpg'));
update public.obra set portal_capa_foto_id = (select v::uuid from t where k = 'f1') where id = (select v::uuid from t where k = 'o1');
select pg_temp.deve_falhar($$update public.obra set portal_capa_foto_id = (select v::uuid from t where k = 'f2') where id = (select v::uuid from t where k = 'o1')$$, 'capa com foto de outra obra');
with x as (insert into public.pendencia (obra_id, tipo, titulo, responsavel) values ((select v::uuid from t where k = 'o1'), 'decisao_cliente', 'Escolher o rejunte', 'cliente') returning id)
  insert into t select 'd1', id::text from x;
select public.portal_publicar('pendencia', (select v::uuid from t where k = 'd1'), true);

-- Acesso: só o escritório cria; cada pessoa tem o seu link.
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.portal_criar_acesso((select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 'p1'))$$, 'campo criando acesso');
select pg_temp.deve_falhar($$select public.portal_previa((select v::uuid from t where k = 'o1'))$$, 'campo vendo prévia');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'tk1', public.portal_criar_acesso((select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 'p1'), 90);
insert into t select 'tk2', public.portal_criar_acesso((select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 'p2'), 90);
insert into t select 'tk3', public.portal_criar_acesso((select v::uuid from t where k = 'o2'), (select v::uuid from t where k = 'p2'), 90);
select pg_temp.igual((select count(*) from public.portal_acesso where obra_id = (select v::uuid from t where k = 'o1') and revogado_em is null), 2::bigint, 'dois acessos vigentes na obra');
select pg_temp.igual(length((select v from t where k = 'tk1')) >= 40, true, 'token longo');
reset role;
select pg_temp.igual((select count(*) from public.portal_acesso where token_hash = (select v from t where k = 'tk1')), 0::bigint, 'banco não guarda o token em claro');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.deve_falhar($$select token_hash from public.portal_acesso$$, 'hash do token não é legível nem pelo escritório');

-- Cliente (anônimo com o link)
select pg_temp.como(null);
insert into t select 'd', public.portal_dados((select v from t where k = 'tk1'))::text;
select pg_temp.igual((select v::jsonb->'obra'->>'nome' from t where k = 'd'), 'Obra Um (fictícia)', 'portal mostra a obra do link');
select pg_temp.igual((select v::jsonb->'eu'->>'nome' from t where k = 'd'), 'Cliente Fictício', 'portal identifica a pessoa');
select pg_temp.igual((select jsonb_array_length(v::jsonb->'registros') from t where k = 'd'), 1, 'só o registro publicado da própria obra');
select pg_temp.igual((select jsonb_array_length(v::jsonb->'fotos') from t where k = 'd'), 1, 'só a foto publicada da própria obra');
select pg_temp.igual((select jsonb_array_length(v::jsonb->'etapas') from t where k = 'd'), 1, 'etapa interna não aparece');
select pg_temp.igual((select v::jsonb->'materiais'->0->>'situacao' from t where k = 'd'), 'previsto', 'material com situação operacional');
select pg_temp.igual((select v::jsonb->'obra'->>'capa' from t where k = 'd'), (select v from t where k = 'f1'), 'capa publicada');
select pg_temp.igual((select jsonb_array_length(v::jsonb->'participantes') from t where k = 'd'), 2, 'participantes da obra');
select pg_temp.igual((select v ~* 'SEGREDO|RASCUNHO|OUTRA-OBRA|98765|valor|peso|caminho|custo|margem|lancamento|fornecedor' from t where k = 'd'), false, 'nada interno ou financeiro na resposta');
select pg_temp.igual(public.portal_dados('token-inventado') ? 'erro', true, 'token inválido não abre nada');
select pg_temp.igual(public.portal_foto((select v from t where k = 'tk1'), (select v::uuid from t where k = 'f1'), true) is not null, true, 'cliente vê a foto publicada');
select pg_temp.deve_falhar($$select public.portal_foto((select v from t where k = 'tk1'), (select v::uuid from t where k = 'f2'))$$, 'foto de outra obra trocando o identificador');
select pg_temp.deve_falhar($$select public.portal_foto(null, (select v::uuid from t where k = 'f1'))$$, 'foto sem token');
select pg_temp.deve_falhar($$select public.portal_previa((select v::uuid from t where k = 'o1'))$$, 'anônimo vendo prévia');
select pg_temp.deve_falhar($$select count(*) from public.portal_comentario$$, 'anônimo lendo tabela do portal');
select pg_temp.deve_falhar($$select count(*) from public.foto_portal$$, 'anônimo lendo cópias');

-- Comentários: ligados ao item, sem duplicar no reenvio, só em itens visíveis da obra.
insert into t values ('ch', gen_random_uuid()::text);
insert into t select 'c1', public.portal_comentar((select v from t where k = 'tk1'), (select v::uuid from t where k = 'ch'), 'foto', (select v::uuid from t where k = 'f1'), 'solicitacao_ajuste', 'Podem ajustar o rodapé?')::text;
select pg_temp.igual(public.portal_comentar((select v from t where k = 'tk1'), (select v::uuid from t where k = 'ch'), 'foto', (select v::uuid from t where k = 'f1'), 'solicitacao_ajuste', 'Podem ajustar o rodapé?')::text,
                     (select v from t where k = 'c1'), 'reenvio não duplica');
select pg_temp.deve_falhar($$select public.portal_comentar((select v from t where k = 'tk1'), gen_random_uuid(), 'foto', (select v::uuid from t where k = 'f2'), 'comentario', 'x')$$, 'comentar foto de outra obra');
select pg_temp.deve_falhar($$select public.portal_comentar((select v from t where k = 'tk1'), gen_random_uuid(), 'etapa', (select v::uuid from t where k = 'e2'), 'comentario', 'x')$$, 'comentar etapa não publicada');
select pg_temp.deve_falhar($$select public.portal_comentar((select v from t where k = 'tk1'), gen_random_uuid(), 'registro', (select v::uuid from t where k = 'r3'), 'comentario', 'x')$$, 'comentar registro não publicado');
select public.portal_comentar((select v from t where k = 'tk2'), gen_random_uuid(), 'etapa', (select v::uuid from t where k = 'e1'), 'pergunta', 'Quando termina?');

-- Ciência: cada pessoa a sua, com versão; mudar o conteúdo pede nova ciência.
insert into t select 'ver', public.portal_dados((select v from t where k = 'tk1'))->'registros'->0->>'versao';
select public.portal_dar_ciencia((select v from t where k = 'tk1'), 'registro', (select v::uuid from t where k = 'r1'), (select v from t where k = 'ver'));
select public.portal_dar_ciencia((select v from t where k = 'tk1'), 'registro', (select v::uuid from t where k = 'r1'), (select v from t where k = 'ver'));
select public.portal_dar_ciencia((select v from t where k = 'tk2'), 'registro', (select v::uuid from t where k = 'r1'), (select v from t where k = 'ver'));
select pg_temp.deve_falhar($$select public.portal_dar_ciencia((select v from t where k = 'tk1'), 'registro', (select v::uuid from t where k = 'r1'), 'versao-errada')$$, 'ciência de versão que não é a atual');
select pg_temp.deve_falhar($$select public.portal_dar_ciencia((select v from t where k = 'tk3'), 'registro', (select v::uuid from t where k = 'r1'), (select v from t where k = 'ver'))$$, 'ciência em registro de outra obra');
insert into t select 'd2', public.portal_dados((select v from t where k = 'tk2'))::text;
select pg_temp.igual((select jsonb_array_length(v::jsonb->'ciencias') from t where k = 'd2'), 2, 'duas ciências, uma por pessoa');
select pg_temp.igual((select jsonb_array_length(v::jsonb->'comentarios') from t where k = 'd2'), 2, 'participantes veem os comentários da obra');
select pg_temp.igual((select count(*) from jsonb_array_elements((select v::jsonb->'comentarios' from t where k = 'd2')) c where (c->>'meu')::boolean), 1::bigint, 'cada um identifica o que é seu');
select pg_temp.igual(public.portal_dados((select v from t where k = 'tk3'))::text ~ 'Escoramento iniciado', false, 'link de outra obra não vê esta obra');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) from public.portal_ciencia where alvo_id = (select v::uuid from t where k = 'r1')), 2::bigint, 'escritório vê as ciências');
select pg_temp.deve_falhar($$update public.portal_ciencia set versao = 'x'$$, 'ciência imutável');
update public.registro set texto = 'Escoras posicionadas e conferidas.' where id = (select v::uuid from t where k = 'r1');
select public.responder_comentario((select v::uuid from t where k = 'c1'), 'Sim, ajustamos amanhã.', 'respondido');
select pg_temp.como(null);
select pg_temp.igual(public.portal_dados((select v from t where k = 'tk1'))->'registros'->0->>'versao' <> (select v from t where k = 'ver'), true, 'versão muda com o conteúdo');
select pg_temp.igual(public.portal_dados((select v from t where k = 'tk1'))->'comentarios'->0->>'resposta', 'Sim, ajustamos amanhã.', 'resposta do escritório aparece');

-- Despublicar e revogar têm efeito imediato.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select public.despublicar_foto((select v::uuid from t where k = 'f1'));
reset role;
select pg_temp.igual((select count(*) from public.foto_portal where foto_id = (select v::uuid from t where k = 'f1')), 0::bigint, 'cópia apagada');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select portal_capa_foto_id from public.obra where id = (select v::uuid from t where k = 'o1')), null::uuid, 'capa retirada');
insert into t select 'tk1b', public.portal_criar_acesso((select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 'p1'), 30);
select public.portal_revogar_acesso((select id from public.portal_acesso where obra_id = (select v::uuid from t where k = 'o1') and pessoa_id = (select v::uuid from t where k = 'p2') and revogado_em is null), 'teste');
select pg_temp.igual(jsonb_array_length(public.portal_previa((select v::uuid from t where k = 'o1'))->'fotos'), 0, 'prévia igual ao portal');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select public.portal_foto((select v from t where k = 'tk1b'), (select v::uuid from t where k = 'f1'))$$, 'foto despublicada');
select pg_temp.igual(public.portal_dados((select v from t where k = 'tk1')) ? 'erro', true, 'link antigo substituído não abre');
select pg_temp.igual(public.portal_dados((select v from t where k = 'tk2')) ? 'erro', true, 'link revogado não abre');
select pg_temp.igual(public.portal_dados((select v from t where k = 'tk1b')) ? 'erro', false, 'link novo abre');
select pg_temp.deve_falhar($$select public.portal_comentar((select v from t where k = 'tk2'), gen_random_uuid(), 'obra', null, 'comentario', 'x')$$, 'comentar com link revogado');

-- Usuário com perfil cliente também não lê nada direto.
select pg_temp.como('00000000-0000-0000-0000-00000000000e');
select pg_temp.igual((select count(*) from public.portal_comentario) + (select count(*) from public.portal_ciencia), 0::bigint, 'perfil cliente não lê tabelas do portal');
select pg_temp.deve_falhar($$select public.portal_previa((select v::uuid from t where k = 'o1'))$$, 'perfil cliente vendo prévia');
reset role;
