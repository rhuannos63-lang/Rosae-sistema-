-- Avisos push: cada pessoa da equipe cadastra e apaga só os próprios aparelhos; a chave do servidor e o controle de avisos ficam fora do alcance da tela.
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
grant execute on all functions in schema pg_temp to anon, authenticated;

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into public.push_assinatura (endpoint, p256dh, auth, aparelho) values ('https://push.exemplo/abc', 'p', 'a', 'Celular');
do $$ begin
  if (select count(*) from public.push_assinatura) <> 1 then raise exception 'FALHOU: a pessoa deveria ver a própria inscrição'; end if;
end $$;
select pg_temp.deve_falhar($$ select * from public.push_chave $$, 'chave do servidor não pode ser lida pela tela');
select pg_temp.deve_falhar($$ select * from public.push_avisado $$, 'controle de avisos não pode ser lido pela tela');
select pg_temp.deve_falhar($$ insert into public.push_assinatura (usuario_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-00000000000b', 'https://push.exemplo/x', 'p', 'a') $$, 'não cadastra aparelho em nome de outra pessoa');
select pg_temp.deve_falhar($$ insert into public.push_assinatura (endpoint, p256dh, auth) values ('http://inseguro/x', 'p', 'a') $$, 'endereço sem https');

select pg_temp.como(null);
select pg_temp.deve_falhar($$ insert into public.push_assinatura (endpoint, p256dh, auth) values ('https://push.exemplo/y', 'p', 'a') $$, 'visitante não cadastra aparelho');
reset role;
