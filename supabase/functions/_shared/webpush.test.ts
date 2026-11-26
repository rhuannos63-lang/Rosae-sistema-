import { describe, expect, it } from 'vitest';
import { b64url, criptografar, deB64url, gerarChavesVapid, hkdf, juntar, tokenVapid } from './webpush.ts';

const te = new TextEncoder();

/** Lado do navegador: abre a mensagem com a chave do aparelho (RFC 8291), para conferir a ida. */
async function abrir(corpo: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const sal = corpo.slice(0, 16);
  const idlen = corpo[20];
  const asPublica = corpo.slice(21, 21 + idlen);
  const cifrado = corpo.slice(21 + idlen);
  const uaPublica = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asChave = await crypto.subtle.importKey('raw', asPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asChave }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, juntar(te.encode('WebPush: info\0'), uaPublica, asPublica), 32);
  const cek = await hkdf(sal, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const claro = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, cifrado));
  expect(claro[claro.length - 1]).toBe(2);
  return new TextDecoder().decode(claro.slice(0, -1));
}

describe('web push', () => {
  it('base64url vai e volta', () => {
    const b = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 1]);
    expect(deB64url(b64url(b))).toEqual(b);
    expect(b64url(b)).not.toMatch(/[+/=]/);
  });

  it('a mensagem criptografada abre no aparelho', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const p256dh = b64url(await crypto.subtle.exportKey('raw', ua.publicKey));
    const msg = JSON.stringify({ titulo: 'Proposta aceita', corpo: 'Maria aceitou PROP-2026-001', url: '/propostas/x' });
    const corpo = await criptografar(te.encode(msg), p256dh, b64url(auth));
    expect(corpo.slice(16, 20)).toEqual(new Uint8Array([0, 0, 16, 0]));
    expect(corpo[20]).toBe(65);
    expect(await abrir(corpo, ua, auth)).toBe(msg);
  });

  it('token VAPID é um JWT ES256 válido para a chave pública', async () => {
    const ch = await gerarChavesVapid();
    expect(deB64url(ch.publica).length).toBe(65);
    const jwt = await tokenVapid('https://fcm.googleapis.com/fcm/send/abc', 'mailto:contato@exemplo.com', ch.privada, 1_800_000_000);
    const [cab, corpo, ass] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(deB64url(cab)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(deB64url(corpo)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43200, sub: 'mailto:contato@exemplo.com' });
    const pub = await crypto.subtle.importKey('raw', deB64url(ch.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, deB64url(ass), te.encode(`${cab}.${corpo}`))).toBe(true);
  });
});
