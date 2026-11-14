// Rascunho do montador do portal (ainda não publicado), guardado só neste aparelho.
// A "Prévia com o rascunho", aberta em outra aba, lê daqui e acompanha ao vivo.
import type { DadosPortal, RegistroPortal } from '../core/portal';
import type { Montagem } from '../core/portalMontagem';

export type RascunhoPortal = { montagem: Montagem; boas_vindas?: string | null; novidade?: { titulo: string; texto: string; etapa_id: string | null } | null };
export const chaveRascunhoPortal = (obra: string) => `rosae.portal.rascunho.${obra}`;
export function lerRascunhoPortal(obra: string): RascunhoPortal | null {
  try { const v = localStorage.getItem(chaveRascunhoPortal(obra)); return v ? (JSON.parse(v) as RascunhoPortal) : null; } catch { return null; }
}
export function gravarRascunhoPortal(obra: string, r: RascunhoPortal | null) {
  try { if (r) localStorage.setItem(chaveRascunhoPortal(obra), JSON.stringify(r)); else localStorage.removeItem(chaveRascunhoPortal(obra)); } catch { /* sem armazenamento: a prévia mostra o publicado */ }
}
/** O portal como ficará depois de publicar o rascunho. */
export function aplicarRascunho(d: DadosPortal, r: RascunhoPortal): DadosPortal {
  const agora = new Date().toISOString();
  const novidade: RegistroPortal[] = r.novidade && (r.novidade.titulo.trim() || r.novidade.texto.trim()) ? [{
    id: 'rascunho', data: agora.slice(0, 10), tipo: 'andamento', titulo: r.novidade.titulo.trim() || null, texto: r.novidade.texto.trim() || null,
    detalhes: {}, servico_id: null, etapa_id: r.novidade.etapa_id, ambiente_id: null, publicado_em: agora, versao: 'rascunho',
  }] : [];
  return {
    ...d,
    obra: { ...d.obra, montagem: r.montagem, ...(r.boas_vindas !== undefined ? { boas_vindas: r.boas_vindas } : {}) },
    registros: [...novidade, ...d.registros],
  };
}

