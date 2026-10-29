// WhatsApp Cloud API (oficial da Meta): ler o webhook, conferir a assinatura e enviar mensagens.
import { partirMensagem } from './texto.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';

export type Recebida =
  | { id: string; de: string; nome: string | null; tipo: 'texto'; texto: string }
  | { id: string; de: string; nome: string | null; tipo: 'imagem' | 'audio' | 'documento'; midia: string; mime: string; legenda: string }
  | { id: string; de: string; nome: string | null; tipo: 'outro' };

/** Extrai as mensagens de um webhook (ignora status de entrega e leitura). */
export function lerWebhook(corpo: unknown): Recebida[] {
  const saida: Recebida[] = [];
  // deno-lint-ignore no-explicit-any
  for (const entrada of (corpo as any)?.entry ?? []) {
    for (const mudanca of entrada?.changes ?? []) {
      const valor = mudanca?.value ?? {};
      const contatos: Record<string, string> = {};
      for (const c of valor.contacts ?? []) contatos[c.wa_id] = c.profile?.name ?? null;
      for (const m of valor.messages ?? []) {
        const base = { id: String(m.id), de: String(m.from), nome: contatos[m.from] ?? null };
        if (m.type === 'text') saida.push({ ...base, tipo: 'texto', texto: String(m.text?.body ?? '') });
        else if (m.type === 'button') saida.push({ ...base, tipo: 'texto', texto: String(m.button?.text ?? '') });
        else if (m.type === 'interactive') saida.push({ ...base, tipo: 'texto', texto: String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') });
        else if (m.type === 'image') saida.push({ ...base, tipo: 'imagem', midia: m.image.id, mime: m.image.mime_type ?? 'image/jpeg', legenda: m.image.caption ?? '' });
        else if (m.type === 'audio') saida.push({ ...base, tipo: 'audio', midia: m.audio.id, mime: m.audio.mime_type ?? 'audio/ogg', legenda: '' });
        else if (m.type === 'document') saida.push({ ...base, tipo: 'documento', midia: m.document.id, mime: m.document.mime_type ?? '', legenda: m.document.caption ?? '' });
        else saida.push({ ...base, tipo: 'outro' });
      }
    }
  }
  return saida;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Confere o cabeçalho X-Hub-Signature-256 (HMAC do corpo com o App Secret). */
export async function assinaturaValida(corpoBruto: string, cabecalho: string | null, segredo: string): Promise<boolean> {
  if (!cabecalho?.startsWith('sha256=') || !segredo) return false;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperado = hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpoBruto)));
  const recebido = cabecalho.slice(7).toLowerCase();
  if (recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

export type ConfigWhatsApp = { token: string; numeroId: string };

export async function enviarTexto(cfg: ConfigWhatsApp, para: string, texto: string): Promise<void> {
  for (const parte of partirMensagem(texto)) {
    const r = await fetch(`${GRAPH}/${cfg.numeroId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: parte, preview_url: false } }),
    });
    if (!r.ok) throw new Error(`WhatsApp recusou o envio (${r.status}): ${(await r.text()).slice(0, 300)}`);
  }
}

/** Marca como lida (os dois tracinhos azuis), para a pessoa saber que chegou. */
export async function marcarLida(cfg: ConfigWhatsApp, id: string): Promise<void> {
  await fetch(`${GRAPH}/${cfg.numeroId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: id }),
  }).catch(() => undefined);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Baixa uma foto ou áudio enviado (até 8 MB). */
export async function baixarMidia(cfg: ConfigWhatsApp, midiaId: string): Promise<{ mime: string; base64: string }> {
  const info = await fetch(`${GRAPH}/${midiaId}`, { headers: { authorization: `Bearer ${cfg.token}` } });
  if (!info.ok) throw new Error('Não consegui baixar o arquivo do WhatsApp.');
  const { url, mime_type, file_size } = await info.json();
  if (Number(file_size) > 8 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 8 MB).');
  const arq = await fetch(url, { headers: { authorization: `Bearer ${cfg.token}` } });
  if (!arq.ok) throw new Error('Não consegui baixar o arquivo do WhatsApp.');
  return { mime: String(mime_type ?? 'application/octet-stream'), base64: base64(new Uint8Array(await arq.arrayBuffer())) };
}
