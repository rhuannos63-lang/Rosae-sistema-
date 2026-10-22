// Datas no fuso America/Sao_Paulo, guardadas como "AAAA-MM-DD".

export const FUSO = 'America/Sao_Paulo';

export function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.split('-').map(Number);
  return [a, m, d];
}

function montar(a: number, m: number, d: number): string {
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function diasNoMes(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Soma meses mantendo o dia; se o mês não tem o dia (31), usa o último dia. */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = partes(iso);
  const total = a * 12 + (m - 1) + meses;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return montar(na, nm, Math.min(d, diasNoMes(na, nm)));
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = partes(iso);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return montar(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export type Periodo = { inicio: string; fim: string; rotulo: string };

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function nomeMes(iso: string): string {
  const [a, m] = partes(iso);
  return `${MESES[m - 1]} de ${a}`;
}

export function nomeMesCurto(iso: string): string {
  const [a, m] = partes(iso);
  return `${MESES[m - 1].slice(0, 3)}/${String(a).slice(2)}`;
}

/** Mês, semestre ou ano que contém a data de referência. */
export function periodo(tipo: 'mes' | 'semestre' | 'ano', ref: string): Periodo {
  const [a, m] = partes(ref);
  if (tipo === 'mes') {
    return { inicio: montar(a, m, 1), fim: montar(a, m, diasNoMes(a, m)), rotulo: nomeMes(ref) };
  }
  if (tipo === 'semestre') {
    const s = m <= 6 ? 1 : 2;
    const mi = s === 1 ? 1 : 7;
    return { inicio: montar(a, mi, 1), fim: montar(a, mi + 5, diasNoMes(a, mi + 5)), rotulo: `${s}º semestre de ${a}` };
  }
  return { inicio: montar(a, 1, 1), fim: montar(a, 12, 31), rotulo: `ano de ${a}` };
}

export function deslocarPeriodo(tipo: 'mes' | 'semestre' | 'ano', ref: string, passos: number): string {
  const meses = tipo === 'mes' ? 1 : tipo === 'semestre' ? 6 : 12;
  return somarMeses(montar(...(partes(ref).slice(0, 2) as [number, number]), 1), meses * passos);
}
