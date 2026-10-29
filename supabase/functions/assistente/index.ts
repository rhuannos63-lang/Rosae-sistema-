// Assistente de IA na tela do sistema. Roda com o login de quem está usando:
// o token da pessoa vai junto em todas as consultas, então as permissões valem.
import { createClient } from '@supabase/supabase-js';
import { cancelar, confirmar, conversar, textoDecisoes, type Dependencias } from '../_shared/assistente/nucleo.ts';
import { CHAVES, lerConfig, montarModelo } from '../_shared/assistente/provedor.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const MIMES_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ erro: 'Faça login.' }, 401);

  const db = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u } = await db.auth.getUser(auth.slice(7));
  if (!u?.user) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
  const { data: perfil } = await db.from('usuario').select('id, nome, papel, ativo').eq('id', u.user.id).maybeSingle();
  if (!perfil?.ativo || !['administrador', 'administrativo', 'campo'].includes(perfil.papel)) return json({ erro: 'Só a equipe usa o assistente.' }, 403);

  try {
    const corpo = await req.json();
    const cfg = await lerConfig(db);
    const dep: Dependencias = { db, modelo: montarModelo(cfg), canal: 'sistema', usuario: { id: perfil.id, nome: perfil.nome }, instrucoes: cfg.instrucoes };

    if (corpo.acao === 'status') {
      return json({
        claude: Boolean(CHAVES.claude()),
        gemini: Boolean(CHAVES.gemini()),
        whatsapp: Boolean(Deno.env.get('WHATSAPP_TOKEN') && Deno.env.get('WHATSAPP_NUMERO_ID') && Deno.env.get('WHATSAPP_APP_SECRET') && Deno.env.get('WHATSAPP_VERIFY_TOKEN')),
        numero: Deno.env.get('WHATSAPP_NUMERO_EXIBICAO') ?? null,
        webhook: `${URL}/functions/v1/whatsapp`,
        pronto: Boolean(dep.modelo),
      });
    }
    if (corpo.acao === 'confirmar' || corpo.acao === 'cancelar') {
      const ids = Array.isArray(corpo.ids) ? corpo.ids.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
      const decisoes = corpo.acao === 'confirmar' ? await confirmar(dep, ids) : await cancelar(dep, ids);
      const texto = textoDecisoes(decisoes, corpo.acao === 'confirmar');
      await db.from('assistente_mensagem').insert({ usuario_id: perfil.id, canal: 'sistema', papel: 'assistente', texto });
      return json({ texto, decisoes });
    }
    if (corpo.acao === 'mensagem') {
      const texto = String(corpo.texto ?? '').slice(0, 4000);
      const img = corpo.imagem;
      const imagem = img && MIMES_IMAGEM.includes(img.mime) && typeof img.base64 === 'string' && img.base64.length < 7_000_000
        ? { mime: String(img.mime), base64: img.base64 } : null;
      if (!texto.trim() && !imagem) return json({ erro: 'Escreva uma mensagem.' }, 400);
      return json(await conversar(dep, { texto, imagem }));
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: e instanceof Error ? e.message : 'Erro inesperado.' }, 500);
  }
});
