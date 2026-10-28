-- Testes da Etapa 2: funil, formulário do site, propostas, versões, link público e aceite.
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
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;

-- Reativa o usuário com financeiro (desativado no fim dos testes da Etapa 1).
update public.usuario set ativo = true where id = '00000000-0000-0000-0000-00000000000c';

-- 1. Formulário do site (visitante anônimo)
select pg_temp.como(null);
select public.site_registrar_contato('{"nome":"Maria Fictícia","telefone":"(21) 98888-0001","mensagem":"Trinca na parede da sala","tipo_servico":"Laudo","utm":{"source":"instagram","campaign":"outubro"}}');
-- mesmo telefone em outro formato: não duplica pessoa nem oportunidade
select public.site_registrar_contato('{"nome":"Maria F.","telefone":"21988880001","mensagem":"Complementando"}');
-- robô (campo escondido) é ignorado em silêncio
select public.site_registrar_contato('{"nome":"Robô","email":"robo@spam.local","site":"http://spam"}');
select public.site_registrar_clique('{"pagina":"/contato"}');
select pg_temp.deve_falhar($$select public.site_registrar_contato('{"nome":"Sem contato"}')$$, 'formulário sem telefone nem e-mail');
select pg_temp.deve_falhar($$select * from public.oportunidade$$, 'anônimo lendo oportunidades');
select pg_temp.deve_falhar($$select * from public.pessoa$$, 'anônimo lendo pessoas');
select pg_temp.deve_falhar($$select * from public.proposta$$, 'anônimo lendo propostas');
select pg_temp.deve_falhar($$select public.emitir_versao(gen_random_uuid())$$, 'anônimo emitindo proposta');
select pg_temp.deve_falhar($$insert into public.evento_site (tipo) values ('formulario')$$, 'anônimo gravando direto');
reset role;
select pg_temp.igual((select count(*) from public.pessoa where nome like 'Maria%'), 1::bigint, 'site não duplica pessoa pelo telefone');
select pg_temp.igual((select count(*) from public.pessoa where nome = 'Robô'), 0::bigint, 'robô ignorado');
select pg_temp.igual((select count(*) from public.oportunidade o join public.pessoa p on p.id = o.pessoa_id where p.nome like 'Maria%'), 1::bigint, 'site reaproveita oportunidade aberta');
select pg_temp.igual((select origem from public.oportunidade limit 1), 'instagram', 'origem pela UTM');
select pg_temp.igual((select count(*) from public.interacao where tipo = 'site'), 2::bigint, 'duas mensagens no histórico');
select pg_temp.igual((select count(*) from public.evento_site where tipo = 'clique_whatsapp'), 1::bigint, 'clique registrado');
select pg_temp.igual((select count(*) from public.evento_site where tipo = 'clique_whatsapp' and oportunidade_id is not null), 0::bigint, 'clique não cria lead');
insert into t select 'op', id::text from public.oportunidade limit 1;
insert into t select 'maria', pessoa_id::text from public.oportunidade limit 1;

-- 2. Funil: mudança de estado vai para o histórico; perda exige motivo; campo/cliente não veem.
select pg_temp.como('00000000-0000-0000-0000-00000000000b'); -- administrativo sem financeiro
update public.oportunidade set estado_id = public.estado_funil_id('Visita ou levantamento') where id = (select v::uuid from t where k = 'op');
select pg_temp.deve_falhar($$update public.oportunidade set estado_id = public.estado_funil_id('Perdida') where id = (select v::uuid from t where k = 'op')$$, 'perda sem motivo');
select pg_temp.deve_falhar($$insert into public.interacao (oportunidade_id, tipo, texto) values ((select v::uuid from t where k = 'op'), 'sistema', 'falso')$$, 'interação de sistema forjada');
insert into public.interacao (oportunidade_id, tipo, texto) values ((select v::uuid from t where k = 'op'), 'ligacao', 'Liguei e marquei visita');
select pg_temp.igual((select count(*) from public.interacao where tipo = 'sistema' and texto like 'Etapa:%'), 1::bigint, 'mudança de estado registrada');
select pg_temp.igual((select count(*) from public.modelo_servico), 9::bigint, 'biblioteca inicial (8 serviços + perícia)');
select pg_temp.igual((select count(*) from public.modelo_servico_custo), 0::bigint, 'sem financeiro não vê custos');
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000d'); -- campo
select pg_temp.igual((select count(*) from public.oportunidade), 0::bigint, 'campo não vê funil');
select pg_temp.igual((select count(*) from public.modelo_servico), 0::bigint, 'campo não vê biblioteca');
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000e'); -- cliente
select pg_temp.igual((select count(*) from public.proposta), 0::bigint, 'cliente logado não lista propostas');
reset role;

-- 3. Proposta com custos (administrativo com financeiro)
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
insert into public.proposta (id, oportunidade_id, pessoa_id, titulo)
values ('40000000-0000-0000-0000-000000000001', (select v::uuid from t where k = 'op'), (select v::uuid from t where k = 'maria'), 'Laudo da sala');
select pg_temp.igual((select codigo from public.proposta where id = '40000000-0000-0000-0000-000000000001'), 'PROP-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-0001', 'código da proposta');
insert into t select 'v1', public.nova_versao_proposta('40000000-0000-0000-0000-000000000001')::text;
update public.proposta_versao set valor_total = 1500, conteudo = '{"validade_dias":15,"ambientes":[{"nome":"Sala","itens":[{"descricao":"Vistoria","total":1000},{"descricao":"Laudo","total":500}]}],"pagamento":{"parcelas":[{"descricao":"Entrada","valor":750},{"descricao":"Entrega","valor":750}]}}'
where id = (select v::uuid from t where k = 'v1');
insert into public.proposta_custo (versao_id, custos, custo_total, notas_internas) values ((select v::uuid from t where k = 'v1'), '{"deslocamento":120}', 320, 'margem alvo 70%');
-- totais que não conferem bloqueiam a emissão
update public.proposta_versao set valor_total = 1600 where id = (select v::uuid from t where k = 'v1');
select pg_temp.deve_falhar($$select public.emitir_versao((select v::uuid from t where k = 'v1'))$$, 'total diferente da soma dos itens');
update public.proposta_versao set valor_total = 1500 where id = (select v::uuid from t where k = 'v1');
select pg_temp.deve_falhar($$select public.criar_link_proposta((select v::uuid from t where k = 'v1'))$$, 'link de versão não emitida');
select pg_temp.deve_falhar($$update public.proposta set estado = 'aprovada' where id = '40000000-0000-0000-0000-000000000001'$$, 'aprovar por edição direta');
select length(public.emitir_versao((select v::uuid from t where k = 'v1'))) = 64;
select pg_temp.igual((select estado from public.proposta where id = '40000000-0000-0000-0000-000000000001'), 'enviada', 'emitida vira enviada');
update public.proposta_versao set valor_total = 1 where id = (select v::uuid from t where k = 'v1');
delete from public.proposta_versao where id = (select v::uuid from t where k = 'v1');
select pg_temp.igual((select valor_total from public.proposta_versao where id = (select v::uuid from t where k = 'v1')), 1500.00, 'versão emitida imutável');
select pg_temp.deve_falhar($$insert into public.proposta_link (versao_id, token_hash, expira_em) values ((select v::uuid from t where k = 'v1'), 'x', now() + interval '1 day')$$, 'link gravado direto');
insert into t select 'tok1', public.criar_link_proposta((select v::uuid from t where k = 'v1'), 30);
select public.registrar_envio_proposta((select v::uuid from t where k = 'v1'), 'whatsapp', '21988880001');
select pg_temp.igual((select e.nome from public.oportunidade o join public.estado_funil e on e.id = o.estado_id where o.id = (select v::uuid from t where k = 'op')), 'Proposta enviada', 'envio move o funil');
reset role;

reset role;
-- nem o dono do banco altera uma versão emitida
select pg_temp.deve_falhar($$update public.proposta_versao set valor_total = 1 where id = (select v::uuid from t where k = 'v1')$$, 'versão emitida imutável (gatilho)');
select pg_temp.como('00000000-0000-0000-0000-00000000000c');

-- 4. Página pública: sem custos, registra visualização.
select pg_temp.como(null);
insert into t select 'pub1', public.proposta_publica((select v from t where k = 'tok1'))::text;
select pg_temp.igual(((select v from t where k = 'pub1')::jsonb->>'valor_total')::numeric, 1500::numeric, 'valor público');
select pg_temp.igual((select v from t where k = 'pub1') like '%deslocamento%' or (select v from t where k = 'pub1') like '%margem%' or (select v from t where k = 'pub1') like '%320%', false, 'custos nunca aparecem no link');
select pg_temp.igual(((select v from t where k = 'pub1')::jsonb->>'atual')::boolean, true, 'versão atual');
select pg_temp.igual((select public.proposta_publica('token-errado')->>'erro') is not null, true, 'token errado');
select pg_temp.deve_falhar($$select * from public.proposta_link$$, 'anônimo lendo links');
reset role;
select pg_temp.igual((select count(*) from public.proposta_evento where tipo = 'visualizada'), 1::bigint, 'visualização registrada');

-- 5. Nova versão: a antiga continua consultável, mas não pode mais ser aceita.
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
insert into t select 'v2', public.nova_versao_proposta('40000000-0000-0000-0000-000000000001')::text;
select pg_temp.igual((select numero from public.proposta_versao where id = (select v::uuid from t where k = 'v2')), 2, 'versão 2');
select pg_temp.igual((select custo_total from public.proposta_custo where versao_id = (select v::uuid from t where k = 'v2')), 320.00, 'custos copiados para a nova versão');
select pg_temp.igual(public.emitir_versao((select v::uuid from t where k = 'v1')), (select hash from public.proposta_versao where id = (select v::uuid from t where k = 'v1')), 'emitir de novo devolve o mesmo código');
update public.proposta_versao set valor_total = 1400, conteudo = '{"ambientes":[{"nome":"Sala","itens":[{"descricao":"Vistoria e laudo","total":1400}]}]}'
where id = (select v::uuid from t where k = 'v2');
select public.emitir_versao((select v::uuid from t where k = 'v2'));
insert into t select 'tok2', public.criar_link_proposta((select v::uuid from t where k = 'v2'), 30);
reset role;
select pg_temp.como(null);
select pg_temp.igual((public.proposta_publica((select v from t where k = 'tok1'), false)->>'atual')::boolean, false, 'v1 deixa de ser atual');
select pg_temp.deve_falhar($$select public.proposta_responder((select v from t where k = 'tok1'), 'aceitar', 'Maria Fictícia', null, null, null)$$, 'aceitar versão antiga');
select pg_temp.deve_falhar($$select public.proposta_responder((select v from t where k = 'tok2'), 'aceitar', 'M', null, null, null)$$, 'aceite sem nome');
select pg_temp.deve_falhar($$select public.proposta_responder((select v from t where k = 'tok2'), 'ajuste', 'Maria Fictícia', null, null, '')$$, 'ajuste sem comentário');
select public.proposta_responder((select v from t where k = 'tok2'), 'ajuste', 'Maria Fictícia', null, null, 'Pode parcelar em 3x?');
select public.proposta_responder((select v from t where k = 'tok2'), 'aceitar', 'Maria Fictícia', 'maria@ficticio.local', '123.456.789-00', 'De acordo', 'teste');
select pg_temp.igual((public.proposta_responder((select v from t where k = 'tok2'), 'aceitar', 'Maria Fictícia', null, null, null)->>'ok')::boolean, true, 'aceite repetido é idempotente');
reset role;
select pg_temp.igual((select estado from public.proposta where id = '40000000-0000-0000-0000-000000000001'), 'aprovada', 'proposta aprovada');
select pg_temp.igual((select versao_aprovada_id::text from public.proposta where id = '40000000-0000-0000-0000-000000000001'), (select v from t where k = 'v2'), 'versão aprovada é a 2');
select pg_temp.igual((select count(*) from public.proposta_evento where tipo = 'aceita'), 1::bigint, 'um evento de aceite');
select pg_temp.igual((select hash_versao from public.proposta_evento where tipo = 'aceita'), (select hash from public.proposta_versao where id = (select v::uuid from t where k = 'v2')), 'aceite guarda o código da versão');
select pg_temp.igual((select e.nome from public.oportunidade o join public.estado_funil e on e.id = o.estado_id where o.id = (select v::uuid from t where k = 'op')), 'Aprovada', 'funil aprovado');

-- 6. Aprovada não volta atrás; vendido entra no painel.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.deve_falhar($$update public.proposta set estado = 'recusada' where id = '40000000-0000-0000-0000-000000000001'$$, 'desaprovar proposta');
select pg_temp.igual(public.vendido_no_periodo((now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date), 1400.00, 'vendido pela proposta aprovada');
select pg_temp.igual((public.painel_indicadores(date '2000-01-01', date '2100-01-01')->'comercial'->>'aprovadas_periodo')::int, 1, 'painel comercial');
select public.revogar_links_proposta((select v::uuid from t where k = 'v2'));
reset role;
select pg_temp.como(null);
select pg_temp.igual((public.proposta_publica((select v from t where k = 'tok2'))->>'erro') is not null, true, 'link revogado');
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual((public.painel_indicadores(date '2000-01-01', date '2100-01-01')->>'sem_permissao')::boolean, true, 'sem financeiro não vê valores do painel');
select pg_temp.igual((select count(*) from public.proposta_custo), 0::bigint, 'sem financeiro não vê custos da proposta');
reset role;
