// Entrega de documentos ao cliente (projeto, laudo, regularização…).
//  * acao "baixar" (sem login): com o link da entrega ou o link do portal, devolve um endereço
//    temporário (10 min) para baixar o arquivo. Quem decide se pode é o banco.
//  * acao "email" (escritório): envia a mensagem com o botão "Baixar os documentos" e, quando
//    cabem, os arquivos anexados, pelo Gmail da ROSAE (ou Resend).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { cabemNoEmail, erroDoProvedor, montarEmail, validarEntrega, type Empresa } from '../_shared/email.ts';
import { assinarGet } from '../_shared/r2.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USUARIO = () => (Deno.env.get('GMAIL_USUARIO') ?? '').trim();
const GMAIL_SENHA = () => (Deno.env.get('GMAIL_SENHA_APP') ?? '').replace(/\s+/g, '');
const RESEND = () => Deno.env.get('RESEND_API_KEY') ?? '';
const REMETENTE = () => Deno.env.get('EMAIL_REMETENTE') ?? '';
const provedor = () => (GMAIL_USUARIO() && GMAIL_SENHA() ? 'gmail' : RESEND() && REMETENTE() ? 'resend' : null);
const R2 = {
  conta: Deno.env.get('R2_ACCOUNT_ID') ?? '', chave: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  segredo: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '', balde: Deno.env.get('R2_BUCKET') ?? '',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const adm = () => createClient(URL, SERVICO, { auth: { persistSession: false, autoRefreshToken: false } });

async function baixar(c: { token?: unknown; portal?: unknown; arquivo?: unknown }) {
  const token = typeof c.token === 'string' ? c.token : null;
  const portal = typeof c.portal === 'string' ? c.portal : null;
  if ((!token && !portal) || typeof c.arquivo !== 'string' || !/^[0-9a-f-]{36}$/i.test(c.arquivo)) return json({ erro: 'Pedido inválido.' }, 400);
  const db = adm();
  const { data, error } = await db.rpc('entrega_arquivo_permitido', { p_token: token, p_portal: portal, p_arquivo: c.arquivo });
  if (error) return json({ erro: 'Não consegui conferir o link.' }, 500);
  const a = data as { caminho: string; nome: string } | null;
  if (!a) return json({ erro: 'Link inválido ou expirado. Peça um novo link à ROSAE.' }, 403);
  // Arquivo antigo que já foi para o arquivo frio (R2)?
  const frio = (await db.from('arquivo_frio').select('removido_em').eq('caminho', a.caminho).maybeSingle()).data as { removido_em: string | null } | null;
  if (frio?.removido_em) {
    if (!R2.conta) return json({ erro: 'Arquivo guardado no arquivo frio, que não está ligado. Peça o arquivo à ROSAE.' }, 503);
    const url = await assinarGet({ chave: R2.chave, segredo: R2.segredo }, `${R2.conta}.r2.cloudflarestorage.com`, `/${R2.balde}/arquivos/${a.caminho}`, 600);
    return json({ url, nome: a.nome });
  }
  const s = await db.storage.from('documentos').createSignedUrl(a.caminho, 600, { download: a.nome });
  if (s.error || !s.data?.signedUrl) return json({ erro: 'Arquivo não encontrado. Peça à ROSAE para enviar de novo.' }, 404);
  return json({ url: s.data.signedUrl, nome: a.nome });
}

const base64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

async function email(db: SupabaseClient, c: Record<string, unknown>) {
  const erro = validarEntrega(c);
  if (erro) return json({ erro }, 400);
  if (!provedor()) return json({ erro: 'O envio automático de e-mail ainda não está ligado.', nao_configurado: true }, 409);
  const entregaId = c.entrega_id as string;
  const destinatario = (c.destinatario as string).trim();
  // Leitura com o login da pessoa: confere que ela pode ver esta entrega.
  const { data: ent } = await db.from('entrega').select('id').eq('id', entregaId).maybeSingle();
  if (!ent) return json({ erro: 'Entrega não encontrada.' }, 404);
  const { data: arquivos } = await db.from('entrega_arquivo').select('caminho, nome, mime, tamanho').eq('entrega_id', entregaId).order('ordem');
  const lista = (arquivos ?? []) as { caminho: string; nome: string; mime: string | null; tamanho: number | null }[];

  const link = await db.rpc('entrega_link_novo', { p_entrega: entregaId, p_canal: 'email', p_dias: 365 });
  if (link.error) return json({ erro: link.error.message }, 409);
  const url = `${c.origem}/e/${link.data as string}`;
  const empresa = ((await db.rpc('empresa_publica')).data ?? {}) as Empresa;
  const { html, texto } = montarEmail(c.mensagem as string, url, empresa, c.convite !== false, 'Baixar os documentos');

  // Anexa quando cabem; senão o cliente baixa pelo botão.
  const anexos: { filename: string; content: string; contentType?: string }[] = [];
  if (c.anexar !== false && cabemNoEmail(lista.map((a) => a.tamanho))) {
    const s = adm().storage.from('documentos');
    for (const a of lista) {
      const d = await s.download(a.caminho);
      if (d.error || !d.data) { anexos.length = 0; break; }
      anexos.push({ filename: a.nome.normalize('NFC'), content: base64(new Uint8Array(await d.data.arrayBuffer())), ...(a.mime ? { contentType: a.mime } : {}) });
    }
  }

  const falhar = async (m: string) => {
    await db.rpc('entrega_marcar_envio', { p_entrega: entregaId, p_canal: 'email', p_destino: destinatario, p_erro: m });
    return json({ erro: m }, 502);
  };
  if (provedor() === 'gmail') {
    const nome = (empresa.nome || 'ROSAE Engenharia & Estruturas').replace(/["<>]/g, '');
    const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USUARIO(), pass: GMAIL_SENHA() } });
    try {
      await t.sendMail({
        from: `"${nome}" <${GMAIL_USUARIO()}>`, to: destinatario, subject: (c.assunto as string).trim(), html, text: texto,
        ...(empresa.email ? { replyTo: empresa.email } : {}),
        ...(anexos.length ? { attachments: anexos.map((a) => ({ ...a, encoding: 'base64' })) } : {}),
      });
    } catch (e) {
      const err = e as { code?: string; responseCode?: number };
      if (err.code === 'EAUTH' || err.responseCode === 535) return falhar('O Gmail recusou o login. Confira a senha de app cadastrada.');
      if (err.responseCode === 550 || err.responseCode === 553) return falhar('O Gmail recusou o destinatário. Confira o e-mail do cliente.');
      if (err.responseCode === 552) return falhar('Os anexos passaram do limite do Gmail. Envie sem anexos: o cliente baixa pelo botão.');
      return falhar('Não consegui falar com o Gmail. Tente de novo.');
    } finally { t.close(); }
  } else {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${RESEND()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: REMETENTE(), to: [destinatario], subject: (c.assunto as string).trim(), html, text: texto,
        ...(anexos.length ? { attachments: anexos.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
        ...(empresa.email ? { reply_to: empresa.email } : {}), tags: [{ name: 'tipo', value: 'entrega' }],
      }),
    }).catch(() => null);
    if (!resp) return falhar('Não consegui falar com o provedor de e-mail. Tente de novo.');
    const corpo = await resp.json().catch(() => null) as { id?: string; message?: string } | null;
    if (!resp.ok || !corpo?.id) return falhar(erroDoProvedor(resp.status, corpo));
  }
  await db.rpc('entrega_marcar_envio', { p_entrega: entregaId, p_canal: 'email', p_destino: destinatario, p_erro: null });
  return json({ ok: true, anexados: anexos.length, link: url });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: 'Pedido inválido.' }, 400); }
  try {
    if (corpo.acao === 'baixar') return await baixar(corpo);
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ erro: 'Faça login.' }, 401);
    const db = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: u } = await db.auth.getUser(auth.slice(7));
    if (!u?.user) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
    const { data: perfil } = await db.from('usuario').select('papel, ativo').eq('id', u.user.id).maybeSingle();
    if (!perfil?.ativo || !['administrador', 'administrativo'].includes(perfil.papel)) return json({ erro: 'Só o escritório envia documentos.' }, 403);
    if (corpo.acao === 'status') return json({ configurado: provedor() !== null });
    if (corpo.acao === 'email') return await email(db, corpo);
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return json({ erro: 'Erro inesperado.' }, 500);
  }
});
