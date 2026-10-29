// Webhook do WhatsApp Cloud API (Meta). Cada número só é atendido depois de
// vinculado a um usuário do sistema; daí em diante o assistente age como essa pessoa.
import { createClient } from '@supabase/supabase-js';
import { conversar, type Dependencias } from '../_shared/assistente/nucleo.ts';
import { CHAVES, lerConfig, montarModelo } from '../_shared/assistente/provedor.ts';
import { transcreverAudio } from '../_shared/assistente/gemini.ts';
import { assinaturaValida, baixarMidia, enviarTexto, lerWebhook, marcarLida, type Recebida } from '../_shared/assistente/whatsapp.ts';
import { codigoVinculo } from '../_shared/assistente/texto.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WA = { token: Deno.env.get('WHATSAPP_TOKEN') ?? '', numeroId: Deno.env.get('WHATSAPP_NUMERO_ID') ?? '' };
const SEGREDO = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
const VERIFICACAO = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';

const admin = createClient(URL, SERVICO, { auth: { persistSession: false, autoRefreshToken: false } });

const AJUDA = `Sou o assistente da ROSAE. Você pode me mandar, por exemplo:
• "gastei R$ 850 de cimento na obra do Leblon, paguei no Pix"
• "como está a obra da Barra?"
• "registra no diário: laje concretada hoje"
• "o que vence esta semana?"
• uma foto de nota fiscal ou da obra
• um áudio contando o que aconteceu

Antes de gravar qualquer coisa eu peço sua confirmação.`;

/** Abre uma sessão como o dono do número (link mágico gerado e usado aqui mesmo, sem e-mail). */
async function sessaoDe(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.hashed_token) throw new Error(`Não consegui abrir a sessão: ${error?.message ?? 'sem token'}`);
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`Não consegui abrir a sessão: ${e2?.message ?? 'sem sessão'}`);
  const token = s.session.access_token;
  const db = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return { db, encerrar: () => admin.auth.admin.signOut(token, 'local').catch(() => undefined) };
}

function rodapePendentes(resumos: string[]): string {
  if (!resumos.length) return '';
  return `\n\n*Para gravar no sistema:*\n${resumos.map((r) => `• ${r}`).join('\n')}\n\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`;
}

async function processar(m: Recebida) {
  const { error: repetida } = await admin.from('whatsapp_recebida').insert({ id: m.id });
  if (repetida) return; // a Meta reenviou a mesma mensagem
  const cfg = await lerConfig(admin);
  if (!cfg.whatsapp_ativo) return;
  await marcarLida(WA, m.id);
  const responder = (t: string) => enviarTexto(WA, m.de, t);

  const codigo = m.tipo === 'texto' ? codigoVinculo(m.texto) : null;
  if (codigo) {
    const { data: usuario } = await admin.rpc('assistente_confirmar_vinculo', { p_telefone: m.de, p_codigo: codigo });
    if (!usuario) return responder('Código inválido ou vencido. No sistema, abra Empresa e Sistema › Assistente IA e gere um novo.');
    return responder(`Pronto! Este WhatsApp está ligado ao sistema da ROSAE.\n\n${AJUDA}`);
  }

  const { data: donos } = await admin.rpc('assistente_usuario_por_telefone', { p_telefone: m.de });
  const dono = donos?.[0] as { usuario_id: string; email: string; nome: string } | undefined;
  if (!dono?.email) {
    return responder('Este número ainda não está ligado ao sistema da ROSAE. Peça ao responsável para gerar um código em Empresa e Sistema › Assistente IA e mande aqui: vincular 123456');
  }
  if (m.tipo === 'texto' && /^(ajuda|menu|oi|ola|olá)$/i.test(m.texto.trim())) return responder(AJUDA);

  let texto = '';
  let imagem: { mime: string; base64: string } | null = null;
  if (m.tipo === 'texto') texto = m.texto;
  else if (m.tipo === 'imagem') {
    imagem = await baixarMidia(WA, m.midia);
    texto = m.legenda;
  } else if (m.tipo === 'audio') {
    const chave = CHAVES.gemini();
    if (!chave) return responder('Ainda não entendo áudio por aqui. Mande por texto, por favor.');
    const audio = await baixarMidia(WA, m.midia);
    texto = await transcreverAudio(chave, audio.mime, audio.base64);
    if (!texto) return responder('Não consegui entender o áudio. Pode mandar de novo ou escrever?');
    texto = `(áudio transcrito) ${texto}`;
  } else {
    return responder('Por enquanto entendo texto, fotos e áudio. Para PDF e XML de nota, use a tela de Notas do sistema.');
  }

  const sessao = await sessaoDe(dono.email);
  try {
    const dep: Dependencias = { db: sessao.db, modelo: montarModelo(cfg), canal: 'whatsapp', usuario: { id: dono.usuario_id, nome: dono.nome }, instrucoes: cfg.instrucoes };
    const r = await conversar(dep, { texto, imagem });
    await responder(r.texto + rodapePendentes(r.pendentes.map((p) => p.resumo)));
  } finally {
    await sessao.encerrar();
  }
}

Deno.serve(async (req) => {
  const u = new globalThis.URL(req.url);
  if (req.method === 'GET') {
    // Verificação do webhook, feita uma vez pela Meta ao cadastrar o endereço.
    const ok = u.searchParams.get('hub.mode') === 'subscribe' && VERIFICACAO && u.searchParams.get('hub.verify_token') === VERIFICACAO;
    return ok ? new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Proibido', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const bruto = await req.text();
  if (!(await assinaturaValida(bruto, req.headers.get('x-hub-signature-256'), SEGREDO))) return new Response('Assinatura inválida', { status: 401 });
  let corpo: unknown;
  try { corpo = JSON.parse(bruto); } catch { return new Response('JSON inválido', { status: 400 }); }

  // Responde 200 na hora (a Meta reenvia se demorar) e trabalha em segundo plano.
  const tarefa = Promise.all(lerWebhook(corpo).map((m) => processar(m).catch(async (e) => {
    console.error('whatsapp', e);
    await enviarTexto(WA, m.de, 'Tive um problema para responder agora. Tente de novo em instantes.').catch(() => undefined);
  })));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(tarefa); else await tarefa;
  return new Response('ok', { status: 200 });
});
