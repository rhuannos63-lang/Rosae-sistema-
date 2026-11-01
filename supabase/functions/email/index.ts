// Envio da proposta por e-mail: pelo Gmail da ROSAE (SMTP com senha de app) ou pelo Resend. A tela chama com o login da pessoa
// (as permissões do banco valem para ler a proposta e gerar o link); a situação
// do envio é gravada aqui com a chave de serviço, para "enviado" só aparecer
// quando o provedor aceitou de verdade.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { erroDoProvedor, estadoDoEvento, montarEmail, validarEnvio, type Empresa, type Estado } from '../_shared/email.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CHAVE = () => Deno.env.get('RESEND_API_KEY') ?? '';
const REMETENTE = () => Deno.env.get('EMAIL_REMETENTE') ?? '';
// Gmail: o endereço e a senha de app (16 letras, gerada na conta Google). Tem prioridade sobre o Resend.
const GMAIL_USUARIO = () => (Deno.env.get('GMAIL_USUARIO') ?? '').trim();
const GMAIL_SENHA = () => (Deno.env.get('GMAIL_SENHA_APP') ?? '').replace(/\s+/g, '');
type Provedor = 'gmail' | 'resend';
const provedor = (): Provedor | null => (GMAIL_USUARIO() && GMAIL_SENHA() ? 'gmail' : CHAVE() && REMETENTE() ? 'resend' : null);
const remetenteAtual = () => (provedor() === 'gmail' ? GMAIL_USUARIO() : provedor() === 'resend' ? REMETENTE() : null);

/** Envia pelo Gmail (porta 465, TLS). Devolve o id da mensagem ou o erro em português. */
async function enviarGmail(m: { de: string; para: string; assunto: string; html: string; texto: string; responderPara?: string | null; anexo?: { nome: string; base64: string } | null }): Promise<{ id?: string; erro?: string }> {
  const transporte = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USUARIO(), pass: GMAIL_SENHA() } });
  try {
    const info = await transporte.sendMail({
      from: m.de, to: m.para, subject: m.assunto, html: m.html, text: m.texto,
      ...(m.responderPara ? { replyTo: m.responderPara } : {}),
      ...(m.anexo ? { attachments: [{ filename: m.anexo.nome, content: m.anexo.base64, encoding: 'base64', contentType: 'application/pdf' }] } : {}),
    });
    return { id: String(info.messageId ?? 'gmail') };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    if (err.code === 'EAUTH' || err.responseCode === 535) return { erro: 'O Gmail recusou o login. Confira o endereço e a senha de app cadastrados.' };
    if (err.responseCode === 550 || err.responseCode === 553) return { erro: 'O Gmail recusou o destinatário. Confira o e-mail do cliente.' };
    if (err.responseCode === 552) return { erro: 'O Gmail recusou o anexo (grande demais).' };
    if (err.responseCode === 421 || err.responseCode === 454) return { erro: 'Limite de envios do Gmail atingido. Tente de novo mais tarde.' };
    console.error('gmail', err.code, err.responseCode);
    return { erro: 'Não consegui falar com o Gmail. Tente de novo.' };
  } finally {
    transporte.close();
  }
}
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

type Envio = { id: string; versao_id: string; proposta_id: string; destinatario: string; assunto: string; mensagem: string; estado: Estado; provedor_id: string | null; erro: string | null; tentativas: number; atualizado_em: string };
const CAMPOS = 'id, versao_id, proposta_id, destinatario, assunto, mensagem, estado, provedor_id, erro, tentativas, atualizado_em';

async function enviar(db: SupabaseClient, adm: SupabaseClient, c: Record<string, string>) {
  const chave = c.chave;
  let envio = (await adm.from('envio_email').select(CAMPOS).eq('chave', chave).maybeSingle()).data as Envio | null;
  if (envio && ['enviado', 'entregue', 'devolvido'].includes(envio.estado)) return json({ envio, repetido: true });
  if (envio?.estado === 'enviando' && Date.now() - Date.parse(envio.atualizado_em) < 120_000) return json({ envio, repetido: true });

  if (!envio) {
    // A leitura com o login da pessoa confere que ela pode ver esta proposta.
    const { data: v } = await db.from('proposta_versao').select('id, proposta_id, emitida').eq('id', c.versao_id).maybeSingle();
    if (!v) return json({ erro: 'Proposta não encontrada.' }, 404);
    if (!v.emitida) return json({ erro: 'Emita a versão antes de enviar.' }, 409);
    const novo = await adm.from('envio_email').insert({
      proposta_id: v.proposta_id, versao_id: v.id, destinatario: c.destinatario.trim(), assunto: c.assunto.trim(), mensagem: c.mensagem, chave, criado_por: c.usuario,
    }).select(CAMPOS).maybeSingle();
    if (novo.error) {
      // Dois cliques ao mesmo tempo: o segundo encontra o primeiro.
      const ja = (await adm.from('envio_email').select(CAMPOS).eq('chave', chave).maybeSingle()).data as Envio | null;
      if (ja) return json({ envio: ja, repetido: true });
      return json({ erro: 'Não consegui registrar o envio.' }, 500);
    }
    envio = novo.data as Envio;
  } else {
    // Nova tentativa do mesmo envio: só uma chamada por vez assume.
    const r = await adm.from('envio_email').update({ estado: 'enviando', erro: null, tentativas: envio.tentativas + 1 })
      .eq('id', envio.id).eq('atualizado_em', envio.atualizado_em).select(CAMPOS).maybeSingle();
    if (!r.data) return json({ envio, repetido: true });
    envio = r.data as Envio;
  }

  const falhar = async (erro: string, status = 502) => {
    const r = await adm.from('envio_email').update({ estado: 'falhou', erro }).eq('id', envio!.id).select(CAMPOS).maybeSingle();
    return json({ erro, envio: r.data }, status);
  };

  const link = await db.rpc('criar_link_proposta', { p_versao: envio.versao_id, p_dias: 60 });
  if (link.error) return falhar(link.error.message, 409);
  const url = `${c.origem}/p/${link.data as string}`;
  const empresa = ((await db.rpc('empresa_publica')).data ?? {}) as Empresa;
  const { html, texto } = montarEmail(envio.mensagem, url, empresa);

  const anexo = c.anexo_base64 ? { nome: c.anexo_nome, base64: c.anexo_base64 } : null;
  let provedorId: string;
  if (provedor() === 'gmail') {
    const nome = (empresa.nome || 'ROSAE Engenharia & Estruturas').replace(/["<>]/g, '');
    const r = await enviarGmail({ de: `"${nome}" <${GMAIL_USUARIO()}>`, para: envio.destinatario, assunto: envio.assunto, html, texto, responderPara: empresa.email, anexo });
    if (!r.id) return falhar(r.erro ?? 'Falha no Gmail.');
    provedorId = r.id;
  } else {
    let resp: Response;
    try {
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${CHAVE()}`, 'content-type': 'application/json', 'idempotency-key': chave },
        body: JSON.stringify({
          from: REMETENTE(), to: [envio.destinatario], subject: envio.assunto, html, text: texto,
          ...(anexo ? { attachments: [{ filename: anexo.nome, content: anexo.base64 }] } : {}),
          ...(empresa.email ? { reply_to: empresa.email } : {}),
          tags: [{ name: 'tipo', value: 'proposta' }],
        }),
      });
    } catch {
      return falhar('Não consegui falar com o provedor de e-mail. Tente de novo.');
    }
    const corpo = await resp.json().catch(() => null) as { id?: string; message?: string; name?: string } | null;
    if (!resp.ok || !corpo?.id) return falhar(erroDoProvedor(resp.status, corpo));
    provedorId = corpo.id;
  }

  const ok = await adm.from('envio_email').update({ estado: 'enviado', provedor_id: provedorId, erro: null }).eq('id', envio.id).select(CAMPOS).maybeSingle();
  // Histórico da proposta e funil ("Proposta enviada"), com o login da pessoa.
  await db.rpc('registrar_envio_proposta', { p_versao: envio.versao_id, p_canal: 'email', p_destinatario: envio.destinatario });
  return json({ envio: ok.data });
}

async function atualizar(adm: SupabaseClient, id: string) {
  const envio = (await adm.from('envio_email').select(CAMPOS).eq('id', id).maybeSingle()).data as Envio | null;
  if (!envio) return json({ erro: 'Envio não encontrado.' }, 404);
  if (!envio.provedor_id) return json({ envio });
  // O Gmail não informa a entrega depois do envio: o e-mail fica como enviado.
  if (envio.provedor_id.startsWith('<') || provedor() === 'gmail') return json({ envio, aviso: 'O Gmail não informa a entrega. Se o e-mail voltar, o aviso chega na caixa do Gmail da ROSAE.' });
  const resp = await fetch(`https://api.resend.com/emails/${encodeURIComponent(envio.provedor_id)}`, { headers: { authorization: `Bearer ${CHAVE()}` } }).catch(() => null);
  if (!resp?.ok) return json({ envio, aviso: 'O provedor não respondeu agora. Tente de novo depois.' });
  const dados = await resp.json().catch(() => null) as { last_event?: string } | null;
  const estado = estadoDoEvento(dados?.last_event, envio.estado);
  if (estado === envio.estado) return json({ envio });
  const r = await adm.from('envio_email').update({ estado, ...(estado === 'devolvido' ? { erro: 'O e-mail voltou: confira o endereço do cliente.' } : {}) }).eq('id', id).select(CAMPOS).maybeSingle();
  return json({ envio: r.data });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ erro: 'Faça login.' }, 401);
  const db = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u } = await db.auth.getUser(auth.slice(7));
  if (!u?.user) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
  const { data: perfil } = await db.from('usuario').select('id, papel, ativo').eq('id', u.user.id).maybeSingle();
  if (!perfil?.ativo || !['administrador', 'administrativo'].includes(perfil.papel)) return json({ erro: 'Só o escritório envia propostas.' }, 403);

  try {
    const corpo = await req.json();
    const configurado = provedor() !== null;
    if (corpo.acao === 'status') return json({ configurado, remetente: remetenteAtual(), provedor: provedor() });
    if (!configurado) {
      return json({ erro: 'O envio automático de e-mail ainda não está ligado: falta cadastrar o Gmail e a senha de app.', nao_configurado: true }, 409);
    }
    const adm = createClient(URL, SERVICO, { auth: { persistSession: false, autoRefreshToken: false } });
    if (corpo.acao === 'enviar') {
      const erro = validarEnvio(corpo);
      if (erro) return json({ erro }, 400);
      return await enviar(db, adm, { ...corpo, usuario: perfil.id });
    }
    if (corpo.acao === 'atualizar' && typeof corpo.id === 'string') {
      // Só quem pode ver o envio pede a atualização.
      const { data: meu } = await db.from('envio_email').select('id').eq('id', corpo.id).maybeSingle();
      if (!meu) return json({ erro: 'Envio não encontrado.' }, 404);
      return await atualizar(adm, corpo.id);
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return json({ erro: 'Erro inesperado no envio.' }, 500);
  }
});
