// Web Push sem dependências (WebCrypto): funciona no Deno (função do Supabase) e no Node (testes).
// Criptografia da mensagem: RFC 8291 (aes128gcm). Identificação do servidor: VAPID (RFC 8292).

const te = new TextEncoder();

export function b64url(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deB64url(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const r = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) r[i] = bin.charCodeAt(i);
  return r;
}

export function juntar(...partes: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const r = new Uint8Array(partes.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of partes) { r.set(p, o); o += p.length; }
  return r;
}

async function hmac(chave: Uint8Array<ArrayBuffer>, dados: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dados));
}

/** HKDF (extrair e expandir) com SHA-256, até 32 bytes. */
export async function hkdf(sal: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, tamanho: number): Promise<Uint8Array<ArrayBuffer>> {
  const prk = await hmac(sal, ikm);
  return (await hmac(prk, juntar(info, new Uint8Array([1])))).slice(0, tamanho);
}

export type ChavesVapid = { publica: string; privada: JsonWebKey };

/** Cria o par de chaves do servidor (uma vez só; fica guardado no banco). */
export async function gerarChavesVapid(): Promise<ChavesVapid> {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const privada = await crypto.subtle.exportKey('jwk', par.privateKey);
  return { publica: b64url(publica), privada };
}

/** Token VAPID (JWT ES256) para o serviço de push do navegador. */
export async function tokenVapid(endpoint: string, assunto: string, privada: JsonWebKey, agora = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cab = b64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64url(te.encode(JSON.stringify({ aud, exp: agora + 12 * 3600, sub: assunto })));
  const k = await crypto.subtle.importKey('jwk', { ...privada, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, te.encode(`${cab}.${corpo}`)));
  return `${cab}.${corpo}.${b64url(assinatura)}`;
}

/** Criptografa a mensagem para um aparelho (p256dh e auth vêm da inscrição do navegador). */
export async function criptografar(mensagem: Uint8Array<ArrayBuffer>, p256dh: string, auth: string, sal = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublica = deB64url(p256dh);
  const segredoAuth = deB64url(auth);
  const efemera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublica = new Uint8Array(await crypto.subtle.exportKey('raw', efemera.publicKey));
  const uaChave = await crypto.subtle.importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaChave }, efemera.privateKey, 256));
  const ikm = await hkdf(segredoAuth, ecdh, juntar(te.encode('WebPush: info\0'), uaPublica, asPublica), 32);
  const cek = await hkdf(sal, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, juntar(mensagem, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return juntar(sal, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

export type Inscricao = { endpoint: string; p256dh: string; auth: string };
export type Aviso = { titulo: string; corpo: string; url?: string; tag?: string };

/** Envia um aviso. Devolve o código HTTP do serviço de push (201 = entregue; 404/410 = inscrição vencida). */
export async function enviarAviso(i: Inscricao, aviso: Aviso, chaves: ChavesVapid, assunto: string): Promise<number> {
  const corpo = await criptografar(te.encode(JSON.stringify(aviso)), i.p256dh, i.auth);
  const jwt = await tokenVapid(i.endpoint, assunto, chaves.privada);
  const r = await fetch(i.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${chaves.publica}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'high',
    },
    body: corpo,
  });
  await r.body?.cancel().catch(() => undefined);
  return r.status;
}
