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

/**
 * Paletas prontas. Cada uma tem a cor principal, o tom profundo (menu escuro, capas e
 * cartão de destaque) e quatro cores de gráfico escolhidas para combinar com ela e
 * continuar distinguíveis entre si (inclusive para daltonismo).
 */
export type Paleta = { id: string; nome: string; grupo: 'Verdes' | 'Azuis' | 'Neutros' | 'Quentes'; cor: string; profundo: string; series: [string, string, string, string] };
export const PALETAS: Paleta[] = [
  { id: 'musgo', nome: 'Musgo ROSAE', grupo: 'Verdes', cor: COR_MARCA, profundo: '#1e2412', series: ['#5b6b2e', '#3c6e91', '#c47f3a', '#8e4f72'] },
  { id: 'oliva', nome: 'Oliva', grupo: 'Verdes', cor: '#6f7343', profundo: '#26281a', series: ['#6f7343', '#40708a', '#d39a3e', '#a8476e'] },
  { id: 'salvia', nome: 'Sálvia', grupo: 'Verdes', cor: '#566f5b', profundo: '#1d2620', series: ['#566f5b', '#3f6fb8', '#d39a4e', '#a64d73'] },
  { id: 'floresta', nome: 'Floresta', grupo: 'Verdes', cor: '#1f5c46', profundo: '#0c241b', series: ['#1f5c46', '#4a72b0', '#cc8a3e', '#9a5a8a'] },
  { id: 'esmeralda', nome: 'Esmeralda', grupo: 'Verdes', cor: '#0d7356', profundo: '#05291f', series: ['#0d7356', '#3f6fd1', '#e0913c', '#a8509a'] },
  { id: 'petroleo', nome: 'Petróleo', grupo: 'Azuis', cor: '#0f5f6b', profundo: '#072a30', series: ['#0f5f6b', '#c8743a', '#6b6fbf', '#7d9a3a'] },
  { id: 'marinho', nome: 'Azul marinho', grupo: 'Azuis', cor: '#1f3f73', profundo: '#0b1830', series: ['#1f3f73', '#c98b3a', '#3d8f7a', '#a0506e'] },
  { id: 'safira', nome: 'Safira', grupo: 'Azuis', cor: '#234a9e', profundo: '#0b1838', series: ['#234a9e', '#d08a3c', '#2f8f6f', '#a0506e'] },
  { id: 'aco', nome: 'Azul aço', grupo: 'Azuis', cor: '#3b5a7a', profundo: '#141f2b', series: ['#3b5a7a', '#c47a3a', '#6f9a3e', '#9a4f8a'] },
  { id: 'onix', nome: 'Ônix', grupo: 'Neutros', cor: '#1f2023', profundo: '#0b0b0c', series: ['#2b2d31', '#4f7cc9', '#d08a3c', '#4f9a78'] },
  { id: 'grafite', nome: 'Grafite', grupo: 'Neutros', cor: '#3a4048', profundo: '#121417', series: ['#3a4048', '#4f7cc9', '#d08a3c', '#5a9a7a'] },
  { id: 'vinho', nome: 'Vinho', grupo: 'Quentes', cor: '#7a2840', profundo: '#2a0e16', series: ['#7a2840', '#3a72b0', '#c8913c', '#5e8a4a'] },
  { id: 'ameixa', nome: 'Ameixa', grupo: 'Quentes', cor: '#5b3a6e', profundo: '#201427', series: ['#5b3a6e', '#2f8f8a', '#d08a3c', '#8a9a2e'] },
  { id: 'terracota', nome: 'Terracota', grupo: 'Quentes', cor: '#a1502c', profundo: '#36190d', series: ['#a1502c', '#2f6f8f', '#6f9a3a', '#7a4a9a'] },
];
/** Compatibilidade: lista simples de cores prontas. */
export const CORES_PRONTAS = PALETAS.map((p) => ({ nome: p.nome, cor: p.cor }));
export const paletaDaCor = (c: string) => PALETAS.find((p) => p.cor === c.toLowerCase());

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

function hsl(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, s, l];
}
function deHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex([r, g, b].map((v) => (v + m) * 255) as RGB);
}
/** Tom profundo e cores de gráfico da cor escolhida: da paleta pronta ou calculados. */
export function derivarPaleta(c: string): { profundo: string; series: [string, string, string, string] } {
  const p = paletaDaCor(c);
  if (p) return { profundo: p.profundo, series: p.series };
  const [h, s] = hsl(c);
  const sat = Math.min(0.6, Math.max(0.35, s));
  return {
    profundo: misturar(c, '#000000', 0.68),
    series: [c, deHsl((h + 200) % 360, sat, 0.42), deHsl((h + 35) % 360, 0.62, 0.52), deHsl((h + 290) % 360, 0.38, 0.46)],
  };
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
  const pal = derivarPaleta(c);
  const serie = (x: string) => (escuro ? misturar(x, '#ffffff', 0.3) : x);
  return {
    ...base,
    '--profundo': escuro ? misturar(pal.profundo, '#ffffff', 0.06) : pal.profundo,
    '--profundo-rgb': rgb(pal.profundo).join(', '),
    '--serie-1': serie(pal.series[0]),
    '--serie-2': serie(pal.series[1]),
    '--serie-3': serie(pal.series[2]),
    '--serie-4': serie(pal.series[3]),
    '--cor-rgb': rgb(escuro ? base['--verde'] : c).join(', '),
    '--btn-texto': escuro ? (contraste(btn, '#ffffff') >= 3 ? '#ffffff' : '#14171a') : textoBotao,
    '--btn-fundo-hover': escuro ? misturar(btn, '#ffffff', 0.12) : misturar(c, '#000000', 0.18),
    '--menu-fundo': escuro ? misturar(pal.profundo, '#000000', 0.25) : pal.profundo,
    '--menu-fundo-2': escuro ? misturar(pal.profundo, '#000000', 0.35) : misturar(pal.profundo, '#000000', 0.15),
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
  const barra = a.menu === 'claro' ? (escuro ? '#16181b' : '#ffffff') : a.menu === 'cor' ? a.cor : derivarPaleta(a.cor).profundo;
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
