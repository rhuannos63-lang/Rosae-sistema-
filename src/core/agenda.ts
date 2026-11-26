// Agenda: regras puras (sem banco). Tarefas que se repetem, grade do mês e da semana,
// faixas de vários dias empilhadas sem sobrepor e mudança de data mantendo a duração.
import { somarDias } from './datas';

export type Categoria = 'tarefa' | 'reuniao' | 'visita' | 'ligacao' | 'prazo' | 'pessoal' | 'trabalho';
export type Fonte = 'tarefa' | 'etapa' | 'material' | 'receber' | 'pagar' | 'proposta' | 'comercial';
export type Repetir = 'nao' | 'diaria' | 'dias_uteis' | 'semanal' | 'mensal';
export type Grupo = 'tarefas' | 'obras' | 'propostas' | 'receber' | 'pagar' | 'comercial';

export type Tarefa = {
  id: string; titulo: string; notas: string | null; data: string; data_fim: string | null;
  hora: string | null; hora_fim: string | null; categoria: Categoria; prioridade: number;
  repetir: Repetir; repetir_ate: string | null; concluida: boolean; concluidas: string[];
  lembrete_min: number | null; obra_id: string | null; proposta_id: string | null;
  origem: 'manual' | 'automatica'; chave: string | null;
};

export type Evento = {
  /** Único na tela (tarefas que se repetem têm um por dia). */
  id: string;
  fonte: Fonte;
  /** Id do registro de origem (tarefa, etapa, parcela...). */
  ref: string;
  titulo: string;
  det?: string;
  inicio: string;
  fim: string;
  hora?: string | null;
  horaFim?: string | null;
  /** Cor: categoria da tarefa ou a própria fonte. */
  cor: string;
  feito: boolean;
  atrasado: boolean;
  valor?: number;
  link?: string;
  notas?: string | null;
  /** Dia desta ocorrência (tarefas que se repetem). */
  ocorrencia?: string;
  prioridade?: number;
  automatica?: boolean;
  /** Pode arrastar para outro dia. */
  movivel: boolean;
};

export const CATEGORIAS: { id: Categoria; rotulo: string }[] = [
  { id: 'tarefa', rotulo: 'Tarefa' },
  { id: 'reuniao', rotulo: 'Reunião' },
  { id: 'visita', rotulo: 'Visita' },
  { id: 'ligacao', rotulo: 'Ligação' },
  { id: 'prazo', rotulo: 'Prazo' },
  { id: 'pessoal', rotulo: 'Pessoal' },
  { id: 'trabalho', rotulo: 'Trabalho reservado' },
];

export const FONTES: Record<Fonte, { rotulo: string; icone: string; grupo: Grupo }> = {
  tarefa: { rotulo: 'Tarefa', icone: 'check', grupo: 'tarefas' },
  etapa: { rotulo: 'Etapa de obra', icone: 'obras', grupo: 'obras' },
  material: { rotulo: 'Material necessário', icone: 'caixa', grupo: 'obras' },
  receber: { rotulo: 'A receber', icone: 'financeiro', grupo: 'receber' },
  pagar: { rotulo: 'A pagar', icone: 'contas', grupo: 'pagar' },
  proposta: { rotulo: 'Validade de proposta', icone: 'documento', grupo: 'propostas' },
  comercial: { rotulo: 'Ação comercial', icone: 'comercial', grupo: 'comercial' },
};

export const GRUPOS: { id: Grupo; rotulo: string; cor: string }[] = [
  { id: 'tarefas', rotulo: 'Tarefas', cor: 'tarefa' },
  { id: 'obras', rotulo: 'Obras', cor: 'etapa' },
  { id: 'propostas', rotulo: 'Propostas', cor: 'trabalho' },
  { id: 'receber', rotulo: 'A receber', cor: 'receber' },
  { id: 'pagar', rotulo: 'A pagar', cor: 'pagar' },
  { id: 'comercial', rotulo: 'Comercial', cor: 'comercial' },
];

/** Grupo do filtro: reservas de proposta aceita contam como "Propostas". */
export function grupoDe(e: Pick<Evento, 'fonte' | 'cor'>): Grupo {
  if (e.fonte === 'tarefa' && e.cor === 'trabalho') return 'propostas';
  return FONTES[e.fonte].grupo;
}

export const REPETIR: { id: Repetir; rotulo: string }[] = [
  { id: 'nao', rotulo: 'Não repete' },
  { id: 'diaria', rotulo: 'Todo dia' },
  { id: 'dias_uteis', rotulo: 'Dias úteis (seg a sex)' },
  { id: 'semanal', rotulo: 'Toda semana' },
  { id: 'mensal', rotulo: 'Todo mês' },
];

export const LEMBRETES: { min: number | null; rotulo: string }[] = [
  { min: null, rotulo: 'Sem aviso' },
  { min: 0, rotulo: 'Na hora' },
  { min: 15, rotulo: '15 min antes' },
  { min: 30, rotulo: '30 min antes' },
  { min: 60, rotulo: '1 hora antes' },
  { min: 120, rotulo: '2 horas antes' },
  { min: 1440, rotulo: '1 dia antes' },
];

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [a, m, d];
}

/** Dia da semana ISO: 1 = segunda ... 7 = domingo. */
export function diaDaSemana(iso: string): number {
  const [a, m, d] = partes(iso);
  const w = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = partes(de);
  const [a2, m2, d2] = partes(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function ultimoDiaDoMes(iso: string): number {
  const [a, m] = partes(iso);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** A tarefa acontece neste dia? (mesma regra do banco, tarefa_no_dia) */
export function tarefaNoDia(t: Pick<Tarefa, 'data' | 'data_fim' | 'repetir' | 'repetir_ate'>, dia: string): boolean {
  if (t.repetir === 'nao') return dia >= t.data && dia <= (t.data_fim ?? t.data);
  if (dia < t.data || (t.repetir_ate && dia > t.repetir_ate)) return false;
  switch (t.repetir) {
    case 'diaria': return true;
    case 'dias_uteis': return diaDaSemana(dia) <= 5;
    case 'semanal': return diaDaSemana(dia) === diaDaSemana(t.data);
    case 'mensal': return partes(dia)[2] === Math.min(partes(t.data)[2], ultimoDiaDoMes(dia));
    default: return false;
  }
}

/** Uma tarefa vira um evento (ou um por dia, se repete) entre de e ate. */
export function expandirTarefa(t: Tarefa, de: string, ate: string, hoje: string): Evento[] {
  const base = {
    fonte: 'tarefa' as const, ref: t.id, titulo: t.titulo, notas: t.notas, hora: t.hora?.slice(0, 5) ?? null, horaFim: t.hora_fim?.slice(0, 5) ?? null,
    cor: t.categoria, prioridade: t.prioridade, automatica: t.origem === 'automatica', link: t.proposta_id ? `/propostas/${t.proposta_id}` : t.obra_id ? `/obras/${t.obra_id}` : undefined,
  };
  if (t.repetir === 'nao') {
    const fim = t.data_fim ?? t.data;
    // Pendente de dia passado continua aparecendo (atrasada) até ser feita ou mudar de data.
    const atrasado = !t.concluida && fim < hoje && t.categoria !== 'trabalho';
    if (!atrasado && (fim < de || t.data > ate)) return [];
    return [{ ...base, id: `tarefa:${t.id}`, inicio: t.data, fim, feito: t.concluida, atrasado, movivel: true }];
  }
  const r: Evento[] = [];
  let dia = t.data > de ? t.data : de;
  for (let n = 0; dia <= ate && n < 400; n++, dia = somarDias(dia, 1)) {
    if (!tarefaNoDia(t, dia)) continue;
    r.push({ ...base, id: `tarefa:${t.id}:${dia}`, inicio: dia, fim: dia, ocorrencia: dia, feito: t.concluidas.includes(dia), atrasado: false, movivel: false });
  }
  return r;
}

/** Segunda-feira da semana do dia. */
export function inicioDaSemana(iso: string): string {
  return somarDias(iso, 1 - diaDaSemana(iso));
}

export function semana(iso: string): string[] {
  const s = inicioDaSemana(iso);
  return Array.from({ length: 7 }, (_, k) => somarDias(s, k));
}

/** Semanas (segunda a domingo) que cobrem o mês do dia de referência. */
export function gradeDoMes(iso: string): string[][] {
  const [a, m] = partes(iso);
  const primeiro = `${a}-${String(m).padStart(2, '0')}-01`;
  const ultimo = `${a}-${String(m).padStart(2, '0')}-${String(ultimoDiaDoMes(iso)).padStart(2, '0')}`;
  const r: string[][] = [];
  for (let s = inicioDaSemana(primeiro); s <= ultimo; s = somarDias(s, 7)) r.push(semana(s));
  return r;
}

export function mesmoMes(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Ordem dentro do dia: atrasados, faixas mais longas, com hora (pela hora), depois o resto. */
export function ordenar(a: Evento, b: Evento): number {
  const da = diasEntre(a.inicio, a.fim);
  const db = diasEntre(b.inicio, b.fim);
  return (Number(a.feito) - Number(b.feito))
    || a.inicio.localeCompare(b.inicio)
    || Number(!!a.ocorrencia) - Number(!!b.ocorrencia)
    || db - da
    || (a.hora ?? '99').localeCompare(b.hora ?? '99')
    || (a.prioridade ?? 2) - (b.prioridade ?? 2)
    || a.titulo.localeCompare(b.titulo);
}

export type Faixa = { e: Evento; coluna: number; span: number; linha: number; continuaAntes: boolean; continuaDepois: boolean };

/**
 * Empilha os eventos de uma semana em linhas, sem sobrepor: cada evento ocupa da coluna do
 * primeiro dia visível até o último. Devolve também quantas linhas cada dia precisaria.
 */
export function faixasDaSemana(eventos: Evento[], dias: string[]): Faixa[] {
  const ini = dias[0];
  const fim = dias[dias.length - 1];
  const visiveis = eventos.filter((e) => e.inicio <= fim && e.fim >= ini).sort(ordenar);
  const ocupadas: boolean[][] = [];
  const r: Faixa[] = [];
  for (const e of visiveis) {
    const c0 = Math.max(0, diasEntre(ini, e.inicio));
    const c1 = Math.min(dias.length - 1, diasEntre(ini, e.fim));
    let linha = 0;
    while ((ocupadas[linha] ??= []).slice(c0, c1 + 1).some(Boolean)) linha++;
    for (let c = c0; c <= c1; c++) ocupadas[linha][c] = true;
    r.push({ e, coluna: c0, span: c1 - c0 + 1, linha, continuaAntes: e.inicio < ini, continuaDepois: e.fim > fim });
  }
  return r;
}

export function eventosDoDia(eventos: Evento[], dia: string): Evento[] {
  return eventos.filter((e) => e.inicio <= dia && e.fim >= dia).sort(ordenar);
}

/** Nova data de início e fim ao arrastar, mantendo a duração. */
export function moverPara(e: Pick<Evento, 'inicio' | 'fim'>, novoInicio: string): { inicio: string; fim: string } {
  return { inicio: novoInicio, fim: somarDias(novoInicio, diasEntre(e.inicio, e.fim)) };
}

/** Minutos desde a meia-noite de "HH:MM". */
export function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function rotuloHora(e: Pick<Evento, 'hora' | 'horaFim'>): string {
  if (!e.hora) return '';
  return e.horaFim ? `${e.hora}–${e.horaFim}` : e.hora;
}

/** Texto curto do período ("12/11 a 20/11", "hoje"). */
export function rotuloPeriodo(e: Pick<Evento, 'inicio' | 'fim'>): string {
  const f = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  return e.inicio === e.fim ? f(e.inicio) : `${f(e.inicio)} a ${f(e.fim)}`;
}

const SEMANA_CURTA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const SEMANA_LONGA = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeDiaCurto = (iso: string) => SEMANA_CURTA[diaDaSemana(iso) - 1];
export const nomeDiaLongo = (iso: string) => SEMANA_LONGA[diaDaSemana(iso) - 1];
export const DIAS_CABECALHO = SEMANA_CURTA;

/** "10 de novembro" / "10 de novembro de 2027" (ano só se diferente do de referência). */
export function dataPorExtenso(iso: string, anoRef?: string): string {
  const [a, m, d] = partes(iso);
  return `${d} de ${MESES[m - 1]}${anoRef && anoRef.slice(0, 4) === String(a) ? '' : ` de ${a}`}`;
}

export function tituloSemana(dias: string[]): string {
  const [a, b] = [dias[0], dias[6]];
  const [, m1, d1] = partes(a);
  const [a2, m2, d2] = partes(b);
  return m1 === m2 ? `${d1} a ${d2} de ${MESES[m2 - 1]} de ${a2}` : `${d1} de ${MESES[m1 - 1]} a ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

/** Resumo de um dia para o cabeçalho e o painel. */
export function resumoDoDia(eventos: Evento[], dia: string): { total: number; feitos: number; receber: number; pagar: number } {
  const doDia = eventosDoDia(eventos, dia);
  return {
    total: doDia.length,
    feitos: doDia.filter((e) => e.feito).length,
    receber: doDia.filter((e) => e.fonte === 'receber' && !e.feito).reduce((t, e) => t + (e.valor ?? 0), 0),
    pagar: doDia.filter((e) => e.fonte === 'pagar' && !e.feito).reduce((t, e) => t + (e.valor ?? 0), 0),
  };
}
