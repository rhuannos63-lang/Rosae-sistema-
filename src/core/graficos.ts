// Regras puras dos gráficos: escala "redonda", formato compacto de dinheiro e Curva S.
import type { Centavos } from './dinheiro';
import { diasEntre } from './cronograma';
import { somarDias } from './datas';

/** Passo "bonito" (1, 2, 2,5 ou 5 × 10ⁿ) para cerca de `alvo` divisões. */
function passoBonito(amplitude: number, alvo: number): number {
  const bruto = amplitude / Math.max(1, alvo);
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const f = bruto / pot;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * pot;
}

/** Domínio e marcas do eixo Y; sempre inclui o zero. */
export function escalaY(valores: number[], alvo = 4): { min: number; max: number; marcas: number[] } {
  let lo = Math.min(0, ...valores);
  let hi = Math.max(0, ...valores);
  if (lo === hi) hi = lo + 1;
  const passo = passoBonito(hi - lo, alvo);
  lo = Math.floor(lo / passo) * passo;
  hi = Math.ceil(hi / passo) * passo;
  const marcas: number[] = [];
  for (let v = lo; v <= hi + passo / 2; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
  return { min: lo, max: hi, marcas };
}

/** "R$ 1,2 mil", "R$ 35 mil", "R$ 1,4 mi" — para eixos e rótulos curtos. */
export function formatarCompacto(c: Centavos): string {
  const reais = c / 100;
  const abs = Math.abs(reais);
  const sinal = reais < 0 ? '−' : '';
  const num = (v: number, casas: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });
  if (abs >= 1_000_000) return `${sinal}R$ ${num(abs / 1_000_000, abs >= 10_000_000 ? 0 : 1)} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${num(abs / 1_000, abs >= 10_000 ? 0 : 1)} mil`;
  return `${sinal}R$ ${num(abs, 0)}`;
}

/** Soma acumulada. */
export function acumular(v: number[]): number[] {
  let s = 0;
  return v.map((x) => (s += x));
}

export type EtapaCurva = {
  servico_id: string; peso: number; estado: string;
  inicio_previsto: string | null; fim_previsto: string | null; inicio_base: string | null; fim_base: string | null;
};

/**
 * Peso de cada etapa na obra: peso do serviço (normalizado entre os serviços com etapas)
 * × peso da etapa dentro do serviço. Canceladas ficam fora, como no progresso físico.
 */
export function pesosNaObra(etapas: EtapaCurva[], pesoServico: Map<string, number>): number[] {
  const validas = etapas.map((e) => e.estado !== 'cancelado');
  const somaEtapas = new Map<string, number>();
  etapas.forEach((e, i) => validas[i] && somaEtapas.set(e.servico_id, (somaEtapas.get(e.servico_id) ?? 0) + Math.max(0, e.peso)));
  const servicos = [...somaEtapas.keys()];
  const qtdEtapas = new Map<string, number>();
  etapas.forEach((e, i) => validas[i] && qtdEtapas.set(e.servico_id, (qtdEtapas.get(e.servico_id) ?? 0) + 1));
  const somaServ = servicos.reduce((s, id) => s + Math.max(0, pesoServico.get(id) ?? 1), 0);
  return etapas.map((e, i) => {
    if (!validas[i]) return 0;
    const ps = somaServ > 0 ? Math.max(0, pesoServico.get(e.servico_id) ?? 1) / somaServ : 1 / servicos.length;
    const se = somaEtapas.get(e.servico_id) ?? 0;
    const pe = se > 0 ? Math.max(0, e.peso) / se : 1 / (qtdEtapas.get(e.servico_id) ?? 1);
    return ps * pe;
  });
}

/**
 * Curva S planejada: % acumulado previsto em cada data, distribuindo o peso de cada
 * etapa de forma linear entre início e fim. `campo` escolhe previsão atual ou linha de base.
 */
export function curvaS(etapas: EtapaCurva[], pesos: number[], datas: string[], campo: 'previsto' | 'base'): (number | null)[] {
  const itens = etapas
    .map((e, i) => ({ ini: campo === 'base' ? e.inicio_base : e.inicio_previsto, fim: campo === 'base' ? e.fim_base : e.fim_previsto, p: pesos[i] }))
    .filter((x) => x.p > 0);
  if (!itens.length || itens.some((x) => !x.ini || !x.fim)) return datas.map(() => null);
  const total = itens.reduce((s, x) => s + x.p, 0);
  return datas.map((d) => {
    let feito = 0;
    for (const x of itens) {
      const dur = diasEntre(x.ini!, x.fim!) + 1;
      const passados = Math.min(dur, Math.max(0, diasEntre(x.ini!, d) + 1));
      feito += x.p * (passados / dur);
    }
    return Math.round((feito / total) * 1000) / 10;
  });
}

/** Datas igualmente espaçadas (a cada `passo` dias) cobrindo o intervalo, incluindo o fim. */
export function datasDaCurva(inicio: string, fim: string, pontosMax = 40): string[] {
  const dias = Math.max(1, diasEntre(inicio, fim));
  const passo = Math.max(1, Math.ceil(dias / pontosMax));
  const r: string[] = [];
  for (let d = inicio; d < fim; d = somarDias(d, passo)) r.push(d);
  r.push(fim);
  return r;
}
