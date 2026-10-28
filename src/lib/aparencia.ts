// Aparência do sistema escolhida por cada usuário: modo claro/escuro, cor principal,
// estilo do menu, fundo, cantos, densidade e tamanho do texto. Fica salva no aparelho
// e, com login, também no banco (vale no celular e no computador).
// As páginas que o cliente abre (proposta, portal e assinatura) ficam sempre no visual da marca.
import { useSyncExternalStore } from 'react';

export type Modo = 'claro' | 'escuro' | 'auto';
export type Aparencia = {
  modo: Modo;
  cor: string;
  menu: 'claro' | 'escuro' | 'cor';
  fundo: 'branco' | 'gelo' | 'cinza';
  cantos: 'retos' | 'suaves' | 'redondos';
  densidade: 'confortavel' | 'compacta';
  fonte: 'pequena' | 'normal' | 'grande';
};

export const COR_MARCA = '#5b6b2e';
export const PADRAO: Aparencia = { modo: 'claro', cor: COR_MARCA, menu: 'claro', fundo: 'branco', cantos: 'suaves', densidade: 'confortavel', fonte: 'normal' };

export const CORES_PRONTAS: { nome: string; cor: string }[] = [
  { nome: 'Verde musgo', cor: COR_MARCA },
  { nome: 'Oliva da marca', cor: '#6f7343' },
  { nome: 'Verde floresta', cor: '#1b6e52' },
  { nome: 'Petróleo', cor: '#0f5f6b' },
  { nome: 'Azul marinho', cor: '#1f3f73' },
  { nome: 'Grafite', cor: '#3a4048' },
  { nome: 'Terracota', cor: '#a1502c' },
  { nome: 'Vinho', cor: '#7a2840' },
];

const CHAVE = 'rosae.aparencia';
const ehHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

export function normalizar(v: unknown): Aparencia {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const um = <K extends keyof Aparencia>(k: K, ok: readonly Aparencia[K][]): Aparencia[K] => (ok.includes(o[k] as Aparencia[K]) ? (o[k] as Aparencia[K]) : PADRAO[k]);
  return {
    modo: um('modo', ['claro', 'escuro', 'auto']),
    cor: ehHex(o.cor) ? o.cor.toLowerCase() : PADRAO.cor,
    menu: um('menu', ['claro', 'escuro', 'cor']),
    fundo: um('fundo', ['branco', 'gelo', 'cinza']),
    cantos: um('cantos', ['retos', 'suaves', 'redondos']),
    densidade: um('densidade', ['confortavel', 'compacta']),
    fonte: um('fonte', ['pequena', 'normal', 'grande']),
  };
}

function lerSalva(): Aparencia {
  try { const t = localStorage.getItem(CHAVE); return t ? normalizar(JSON.parse(t)) : PADRAO; } catch { return PADRAO; }
}

// ---------- Cores ----------
type RGB = [number, number, number];
const rgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Mistura a cor `a` com `b` (t = quanto de `b`). */
export const misturar = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB); };
function luminancia(h: string) {
  const [r, g, b] = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contraste(a: string, b: string) {
  const x = luminancia(a), y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const FUNDOS = { branco: '#ffffff', gelo: '#f7f8f5', cinza: '#f1f3f4' } as const;
const RAIOS = { retos: 4, suaves: 10, redondos: 16 } as const;
const FONTES = { pequena: 14, normal: 15, grande: 16.5 } as const;

/** Variáveis de CSS derivadas da cor principal, para o modo claro ou escuro. */
export function variaveis(a: Aparencia, escuro: boolean): Record<string, string> {
  const c = a.cor;
  const textoBotao = contraste(c, '#ffffff') >= 3 ? '#ffffff' : '#14171a';
  const base: Record<string, string> = escuro
    ? {
        '--verde': misturar(c, '#ffffff', 0.38),
        '--verde-escuro': misturar(c, '#ffffff', 0.7),
        '--verde-profundo': misturar(c, '#000000', 0.72),
        '--verde-claro': misturar(c, '#ffffff', 0.15),
        '--verde-suave': misturar('#1a1d20', c, 0.28),
        '--verde-tinta': misturar('#15181b', c, 0.16),
        '--btn-fundo': contraste(c, '#121417') < 2.2 ? misturar(c, '#ffffff', 0.18) : c,
      }
    : {
        '--verde': c,
        '--verde-escuro': misturar(c, '#000000', 0.35),
        '--verde-profundo': misturar(c, '#000000', 0.6),
        '--verde-claro': misturar(c, '#ffffff', 0.35),
        '--verde-suave': misturar(c, '#ffffff', 0.86),
        '--verde-tinta': misturar(c, '#ffffff', 0.93),
        '--btn-fundo': c,
        '--fundo': FUNDOS[a.fundo],
      };
  const btn = base['--btn-fundo'];
  return {
    ...base,
    '--cor-rgb': rgb(escuro ? base['--verde'] : c).join(', '),
    '--btn-texto': escuro ? (contraste(btn, '#ffffff') >= 3 ? '#ffffff' : '#14171a') : textoBotao,
    '--btn-fundo-hover': escuro ? misturar(btn, '#ffffff', 0.12) : misturar(c, '#000000', 0.18),
    '--menu-fundo': misturar(c, '#000000', escuro ? 0.78 : 0.5),
    '--menu-fundo-2': misturar(c, '#000000', escuro ? 0.86 : 0.68),
    '--menu-cor': c,
    '--menu-destaque': misturar(c, '#ffffff', 0.62),
    '--raio': `${RAIOS[a.cantos]}px`,
    '--raio-p': `${Math.max(3, RAIOS[a.cantos] - 4)}px`,
    '--fonte-base': `${FONTES[a.fonte]}px`,
  };
}

// ---------- Aplicar ----------
const escuroNoSistema = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const ehPublica = () => /^\/(p|c|a)(\/|$)/.test(window.location.pathname);
let aplicadas: string[] = [];

export function aplicar(a: Aparencia = estado) {
  const raiz = document.documentElement;
  for (const k of aplicadas) raiz.style.removeProperty(k);
  aplicadas = [];
  if (ehPublica()) { raiz.dataset.tema = 'claro'; delete raiz.dataset.menu; delete raiz.dataset.densidade; return; }
  const escuro = a.modo === 'escuro' || (a.modo === 'auto' && escuroNoSistema());
  raiz.dataset.tema = escuro ? 'escuro' : 'claro';
  raiz.dataset.menu = a.menu;
  raiz.dataset.densidade = a.densidade;
  for (const [k, v] of Object.entries(variaveis(a, escuro))) { raiz.style.setProperty(k, v); aplicadas.push(k); }
  const barra = a.menu === 'claro' ? (escuro ? '#16181b' : '#ffffff') : a.menu === 'cor' ? a.cor : misturar(a.cor, '#000000', escuro ? 0.78 : 0.5);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', barra);
}

// ---------- Estado compartilhado ----------
let estado: Aparencia = typeof window !== 'undefined' ? lerSalva() : PADRAO;
const ouvintes = new Set<() => void>();
let aoMudar: ((a: Aparencia) => void) | null = null;

export function definirAparencia(a: Partial<Aparencia>, origem: 'usuario' | 'banco' = 'usuario') {
  estado = normalizar({ ...estado, ...a });
  try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch { /* sem armazenamento: vale só nesta visita */ }
  aplicar(estado);
  ouvintes.forEach((f) => f());
  if (origem === 'usuario') aoMudar?.(estado);
}
/** Quem salva no banco se registra aqui (o AuthProvider, quando há login). */
export function aoMudarAparencia(f: ((a: Aparencia) => void) | null) { aoMudar = f; }

export function useAparencia(): [Aparencia, (a: Partial<Aparencia>) => void] {
  const a = useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f); }, () => estado, () => estado);
  return [a, definirAparencia];
}

if (typeof window !== 'undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => estado.modo === 'auto' && aplicar());
}
