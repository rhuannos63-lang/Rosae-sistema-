// Endereço temporário (assinado, AWS Signature V4) para ler um arquivo do Cloudflare R2.
// Sem biblioteca: só Web Crypto. O R2 fala o mesmo protocolo do S3 (região "auto").

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmac(chave: BufferSource, texto: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(texto));
}
async function sha256(texto: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
}
/** Codificação de URI do S3: tudo menos A-Z a-z 0-9 - _ . ~ (e a barra, no caminho). */
export function codificar(s: string, manterBarra = false) {
  return [...enc.encode(s)].map((b) => {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (manterBarra && c === '/')) return c;
    return '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }).join('');
}

export type Credenciais = { chave: string; segredo: string; regiao?: string };

/** Assina um GET por query string. `host` sem https://, `caminho` começando com /. */
export async function assinarGet(cred: Credenciais, host: string, caminho: string, segundos: number, agora = new Date()): Promise<string> {
  const regiao = cred.regiao ?? 'auto';
  const data = agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // AAAAMMDDTHHMMSSZ
  const dia = data.slice(0, 8);
  const escopo = `${dia}/${regiao}/s3/aws4_request`;
  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${cred.chave}/${escopo}`],
    ['X-Amz-Date', data],
    ['X-Amz-Expires', String(Math.max(1, Math.min(604800, Math.round(segundos))))],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const query = params.map(([k, v]) => `${codificar(k)}=${codificar(v)}`).sort().join('&');
  const caminhoCod = codificar(caminho, true);
  const canonico = ['GET', caminhoCod, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const paraAssinar = ['AWS4-HMAC-SHA256', data, escopo, await sha256(canonico)].join('\n');
  let k = await hmac(new Uint8Array(enc.encode('AWS4' + cred.segredo)), dia);
  k = await hmac(k, regiao);
  k = await hmac(k, 's3');
  k = await hmac(k, 'aws4_request');
  const assinatura = hex(await hmac(k, paraAssinar));
  return `https://${host}${caminhoCod}?${query}&X-Amz-Signature=${assinatura}`;
}
