// Avisos no celular e no computador (notificação do aplicativo instalado).
// - chave: devolve a chave pública do servidor (cria na primeira vez e guarda no banco).
// - aceites: avisa todos os aparelhos cadastrados sobre propostas aceitas que ainda não foram
//   avisadas. Pode ser chamada por qualquer um (a página do cliente chama logo após o aceite):
//   só avisa aceites reais do banco, uma vez cada.
// - agenda: chamada a cada 15 minutos (GitHub Actions). Manda o resumo do dia, os lembretes das
//   tarefas com hora e os atrasos novos. O banco decide o que é novo: cada aviso sai uma vez só.
// - teste: manda um aviso de teste para os aparelhos de quem está logado.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { enviarAviso, gerarChavesVapid, type Aviso, type ChavesVapid } from '../_shared/webpush.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSUNTO = 'mailto:contato@rosaeengenharia.com';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function chaves(adm: SupabaseClient): Promise<ChavesVapid> {
  const { data } = await adm.from('push_chave').select('publica, privada').eq('id', 1).maybeSingle();
  if (data) return { publica: data.publica as string, privada: data.privada as JsonWebKey };
  const novas = await gerarChavesVapid();
  // Duas chamadas ao mesmo tempo: a primeira grava, a segunda lê a que ficou.
  await adm.from('push_chave').insert({ id: 1, publica: novas.publica, privada: novas.privada });
  const { data: ficou } = await adm.from('push_chave').select('publica, privada').eq('id', 1).single();
  return { publica: ficou!.publica as string, privada: ficou!.privada as JsonWebKey };
}

type Inscr = { id: string; endpoint: string; p256dh: string; auth: string; falhas: number };

/** Envia para as inscrições e limpa as que o navegador já descartou. */
async function enviarPara(adm: SupabaseClient, lista: Inscr[], aviso: Aviso): Promise<number> {
  if (!lista.length) return 0;
  const ch = await chaves(adm);
  let ok = 0;
  await Promise.all(lista.map(async (i) => {
    let st = 0;
    try { st = await enviarAviso(i, aviso, ch, ASSUNTO); } catch (e) { console.error('push', e instanceof Error ? e.message : e); }
    if (st >= 200 && st < 300) {
      ok += 1;
      await adm.from('push_assinatura').update({ ultimo_envio: new Date().toISOString(), falhas: 0 }).eq('id', i.id);
    } else if (st === 404 || st === 410 || i.falhas >= 9) {
      await adm.from('push_assinatura').delete().eq('id', i.id);
    } else {
      console.error('push recusado', st);
      await adm.from('push_assinatura').update({ falhas: i.falhas + 1 }).eq('id', i.id);
    }
  }));
  return ok;
}

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function avisarAceites(adm: SupabaseClient): Promise<Response> {
  const desde = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: eventos } = await adm.from('proposta_evento').select('id, proposta_id, versao_id, nome, em').eq('tipo', 'aceita').gte('em', desde).order('em').limit(20);
  if (!eventos?.length) return json({ avisados: 0 });
  const { data: ja } = await adm.from('push_avisado').select('evento_id').in('evento_id', eventos.map((e) => e.id));
  const feitos = new Set((ja ?? []).map((x) => Number(x.evento_id)));
  const pendentes = eventos.filter((e) => !feitos.has(Number(e.id)));
  if (!pendentes.length) return json({ avisados: 0 });
  const { data: inscr } = await adm.from('push_assinatura').select('id, endpoint, p256dh, auth, falhas');
  let avisados = 0;
  for (const e of pendentes) {
    // Marca antes de enviar: se duas chamadas chegarem juntas, só uma avisa.
    const marca = await adm.from('push_avisado').insert({ evento_id: e.id });
    if (marca.error) continue;
    const [{ data: p }, { data: v }] = await Promise.all([
      adm.from('proposta').select('id, codigo, titulo, tipo').eq('id', e.proposta_id).maybeSingle(),
      adm.from('proposta_versao').select('valor_total').eq('id', e.versao_id).maybeSingle(),
    ]);
    const valor = v ? Number(v.valor_total) : 0;
    const quem = (e.nome as string | null)?.trim() || 'O cliente';
    const { data: reserva } = await adm.rpc('agenda_reserva', { p_proposta: e.proposta_id });
    const r = reserva as { inicio: string | null; fim: string | null } | null;
    const naAgenda = r?.inicio && r.fim ? ` Entrou na agenda de ${dataBR(r.inicio)} a ${dataBR(r.fim)}.` : '';
    const aviso: Aviso = {
      titulo: p?.tipo === 'aditivo' ? 'Aditivo aceito' : 'Proposta aceita',
      corpo: `${quem} aceitou ${p ? `${p.codigo} · ${p.titulo}` : 'uma proposta'}${valor > 0 ? ` (${brl(valor)})` : ''}.${naAgenda}`,
      url: p ? `/propostas/${p.id}` : '/propostas',
      tag: `aceite-${e.id}`,
    };
    const n = await enviarPara(adm, (inscr ?? []) as Inscr[], aviso);
    await adm.from('push_avisado').update({ enviados: n }).eq('evento_id', e.id);
    avisados += 1;
  }
  return json({ avisados });
}

async function avisarAgenda(adm: SupabaseClient): Promise<Response> {
  const { data: inscr } = await adm.from('push_assinatura').select('id, endpoint, p256dh, auth, falhas');
  // Sem aparelho com avisos ligados: não gasta os avisos do dia (saem quando alguém ligar).
  if (!inscr?.length) return json({ avisos: 0, aparelhos: 0 });
  const { data, error } = await adm.rpc('agenda_avisos_a_enviar');
  if (error) throw new Error(error.message);
  const avisos = (data ?? []) as { chave: string; titulo: string; corpo: string; url: string }[];
  for (const a of avisos) {
    await enviarPara(adm, inscr as Inscr[], { titulo: a.titulo, corpo: a.corpo, url: a.url, tag: a.chave.startsWith('resumo:') ? 'resumo' : a.chave });
  }
  return json({ avisos: avisos.length, aparelhos: inscr.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  const adm = createClient(URL, SERVICO, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const corpo = await req.json().catch(() => ({}));
    if (corpo.acao === 'chave') return json({ publica: (await chaves(adm)).publica });
    if (corpo.acao === 'aceites') return await avisarAceites(adm);
    if (corpo.acao === 'agenda') return await avisarAgenda(adm);
    if (corpo.acao === 'teste') {
      const auth = req.headers.get('authorization') ?? '';
      if (!auth.startsWith('Bearer ')) return json({ erro: 'Faça login.' }, 401);
      const db = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: u } = await db.auth.getUser(auth.slice(7));
      if (!u?.user) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
      const { data: inscr } = await adm.from('push_assinatura').select('id, endpoint, p256dh, auth, falhas').eq('usuario_id', u.user.id);
      const n = await enviarPara(adm, (inscr ?? []) as Inscr[], { titulo: 'Avisos ligados', corpo: 'Tudo certo: o resumo do dia, os lembretes, os atrasos e os aceites de proposta chegam aqui.', url: '/', tag: 'teste' });
      return json({ enviados: n, aparelhos: inscr?.length ?? 0 });
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return json({ erro: 'Não consegui enviar o aviso agora.' }, 500);
  }
});
