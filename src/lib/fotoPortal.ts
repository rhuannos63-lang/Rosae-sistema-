// Cópia de foto para o portal do cliente: reduzida e regravada no navegador
// (sai sem os metadados da câmera, como localização) e gravada pelo publicar_foto.
import { supabase } from './supabase';
import { urlAssinada } from './arquivos';
import { comprimirImagem } from '../pages/ObraRegistros';
import type { Foto } from './tipos';

async function paraBase64(b: Blob): Promise<string> {
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  return url.slice(url.indexOf(',') + 1);
}

/** Cópia para o cliente: reduzida e regravada (sai sem os metadados da câmera, como localização). */
export async function prepararCopiaPortal(original: Blob) {
  const arquivo = new File([original], 'foto.jpg', { type: original.type || 'image/jpeg' });
  // A cópia do portal fica no banco (500 MB no plano grátis): 1280 px já é nítida em qualquer tela.
  const grande = await comprimirImagem(arquivo, 1280, 0.76);
  const mini = await comprimirImagem(arquivo, 400, 0.7);
  return { imagem: await paraBase64(grande.blob), miniatura: await paraBase64(mini.blob), largura: grande.largura, altura: grande.altura };
}

/** Publica a foto no portal (cria a cópia reduzida). Lança erro se não conseguir. */
export async function publicarFotoNoPortal(f: Foto, urlConhecida?: string): Promise<void> {
  const url = urlConhecida ?? (await urlAssinada(f.caminho, 600));
  if (!url) throw new Error('Não consegui abrir a foto original.');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Não consegui baixar a foto original.');
  const c = await prepararCopiaPortal(await resp.blob());
  const r = await supabase.rpc('publicar_foto', { p_foto: f.id, p_imagem: c.imagem, p_miniatura: c.miniatura, p_largura: c.largura, p_altura: c.altura });
  if (r.error) throw r.error;
}
