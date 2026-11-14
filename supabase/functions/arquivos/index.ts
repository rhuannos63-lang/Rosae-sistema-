// Arquivo frio: devolve endereços temporários (10 min) dos arquivos que já saíram do
// Supabase e ficam só no Cloudflare R2. Quem decide se a pessoa pode ler é o banco,
// com as mesmas regras do Storage (função arquivos_frios_permitidos, com o login dela).
import { createClient } from '@supabase/supabase-js';
import { assinarGet } from '../_shared/r2.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const R2 = {
  conta: Deno.env.get('R2_ACCOUNT_ID') ?? '',
  chave: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  segredo: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  balde: Deno.env.get('R2_BUCKET') ?? '',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ erro: 'Entre no sistema.' }, 401);
  const db = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u } = await db.auth.getUser(auth.slice(7));
  if (!u?.user) return json({ erro: 'Entre no sistema.' }, 401);

  let corpo: { caminhos?: unknown; segundos?: unknown };
  try { corpo = await req.json(); } catch { return json({ erro: 'Pedido inválido.' }, 400); }
  const caminhos = Array.isArray(corpo.caminhos) ? corpo.caminhos.filter((c): c is string => typeof c === 'string').slice(0, 200) : [];
  if (!caminhos.length) return json({ urls: {} });
  if (!R2.conta || !R2.chave || !R2.segredo || !R2.balde) return json({ erro: 'Arquivo frio (Cloudflare R2) ainda não ligado.' }, 503);

  const { data: permitidos, error } = await db.rpc('arquivos_frios_permitidos', { p_caminhos: caminhos });
  if (error) return json({ erro: 'Não consegui conferir a permissão.' }, 403);
  const segundos = Math.min(3600, Math.max(60, Number(corpo.segundos) || 600));
  const host = `${R2.conta}.r2.cloudflarestorage.com`;
  const urls: Record<string, string> = {};
  for (const c of (permitidos as string[] | null) ?? []) {
    urls[c] = await assinarGet({ chave: R2.chave, segredo: R2.segredo }, host, `/${R2.balde}/arquivos/${c}`, segundos);
  }
  return json({ urls });
});
