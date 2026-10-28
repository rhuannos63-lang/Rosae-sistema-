// Modo claro, escuro ou automático (segue o celular/computador). Só no sistema interno:
// as páginas que o cliente abre (proposta e portal) ficam sempre no visual claro da marca.
import { useEffect, useState } from 'react';

export type Tema = 'claro' | 'escuro' | 'auto';
const CHAVE = 'rosae.tema';
const escuroNoSistema = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function temaSalvo(): Tema {
  try { const t = localStorage.getItem(CHAVE); return t === 'claro' || t === 'escuro' || t === 'auto' ? t : 'auto'; } catch { return 'auto'; }
}
const ehPublica = () => /^\/(p|c)(\/|$)/.test(window.location.pathname);

export function aplicarTema(t: Tema = temaSalvo()) {
  const escuro = !ehPublica() && (t === 'escuro' || (t === 'auto' && escuroNoSistema()));
  document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#061a13' : '#0e3b2c');
}

export function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setTema] = useState<Tema>(temaSalvo);
  useEffect(() => {
    aplicarTema(tema);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const mudou = () => aplicarTema(tema);
    mq?.addEventListener?.('change', mudou);
    return () => mq?.removeEventListener?.('change', mudou);
  }, [tema]);
  return [tema, (t: Tema) => { try { localStorage.setItem(CHAVE, t); } catch { /* sem armazenamento: vale só nesta visita */ } setTema(t); }];
}
