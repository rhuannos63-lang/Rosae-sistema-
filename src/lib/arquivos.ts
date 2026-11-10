import { supabase } from './supabase';

/**
 * Endereços temporários dos arquivos privados. Primeiro tenta o Supabase; o que não
 * estiver mais lá (arquivo antigo, guardado só no Cloudflare R2) vem pela função
 * "arquivos", que confere a permissão no banco antes de assinar.
 */
export async function urlsAssinadas(caminhos: string[], segundos = 3600): Promise<Record<string, string>> {
  const lista = [...new Set(caminhos.filter(Boolean))];
  const urls: Record<string, string> = {};
  if (!lista.length) return urls;
  const { data } = await supabase.storage.from('documentos').createSignedUrls(lista, segundos);
  (data ?? []).forEach((d) => { if (d.signedUrl && d.path && !d.error) urls[d.path] = d.signedUrl; });
  const faltam = lista.filter((c) => !urls[c]);
  if (faltam.length) {
    const r = await supabase.functions.invoke('arquivos', { body: { caminhos: faltam, segundos } });
    const frios = (r.data as { urls?: Record<string, string> } | null)?.urls ?? {};
    Object.assign(urls, frios);
  }
  return urls;
}

export async function urlAssinada(caminho: string, segundos = 600): Promise<string | null> {
  return (await urlsAssinadas([caminho], segundos))[caminho] ?? null;
}
