// Regras puras do cronograma: estados, programação sequencial e régua da linha do tempo.
import { somarDias } from './datas';

export type EstadoEtapa =
  | 'nao_iniciado' | 'programado' | 'em_execucao' | 'aguardando_material' | 'aguardando_liberacao'
  | 'suspenso' | 'executado' | 'conferido' | 'cancelado';

export const ESTADO_ETAPA: Record<EstadoEtapa, { rotulo: string; classe: string }> = {
  nao_iniciado: { rotulo: 'Não iniciado', classe: 'neutro' },
  programado: { rotulo: 'Programado', classe: '' },
  em_execucao: { rotulo: 'Em execução', classe: 'info' },
  aguardando_material: { rotulo: 'Aguardando material', classe: 'alerta' },
  aguardando_liberacao: { rotulo: 'Aguardando liberação', classe: 'alerta' },
  suspenso: { rotulo: 'Suspenso', classe: 'erro' },
  executado: { rotulo: 'Execução concluída', classe: 'ok' },
  conferido: { rotulo: 'Conferido tecnicamente', classe: 'ok' },
  cancelado: { rotulo: 'Cancelado', classe: 'neutro' },
};

export type EtapaPlano = {
  id: string; servico_id: string; ordem: number; duracao_dias: number | null; depende_de: string[];
  inicio_previsto: string | null; fim_previsto: string | null; estado: EstadoEtapa;
};

/** Dias corridos entre duas datas ISO (fim − início). */
export function diasEntre(inicio: string, fim: string): number {
  const a = Date.UTC(+inicio.slice(0, 4), +inicio.slice(5, 7) - 1, +inicio.slice(8, 10));
  const b = Date.UTC(+fim.slice(0, 4), +fim.slice(5, 7) - 1, +fim.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Pula domingo (dia de obra parada por padrão). */
function proximoUtil(iso: string, pularDomingo: boolean): string {
  if (!pularDomingo) return iso;
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
  return d === 0 ? somarDias(iso, 1) : iso;
}

/**
 * Sugere datas: cada etapa começa depois das que ela depende (ou da anterior
 * no mesmo serviço, se não houver dependência explícita). Serviços diferentes
 * começam juntos na data de início. Etapas concluídas ou canceladas mantêm suas datas.
 */
export function programarSequencial(etapas: EtapaPlano[], inicio: string, pularDomingo = true): Record<string, { inicio: string; fim: string }> {
  const porId = new Map(etapas.map((e) => [e.id, e]));
  const res: Record<string, { inicio: string; fim: string }> = {};
  const visitando = new Set<string>();
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const anteriorNoServico = new Map<string, string | undefined>();
  const ultimoPorServico = new Map<string, string>();
  for (const e of ordenadas) {
    anteriorNoServico.set(e.id, ultimoPorServico.get(e.servico_id));
    ultimoPorServico.set(e.servico_id, e.id);
  }
  const fixa = (e: EtapaPlano) => ['executado', 'conferido', 'cancelado'].includes(e.estado) && !!e.inicio_previsto && !!e.fim_previsto;
  function calcular(id: string): { inicio: string; fim: string } {
    if (res[id]) return res[id];
    const e = porId.get(id)!;
    if (fixa(e)) return (res[id] = { inicio: e.inicio_previsto!, fim: e.fim_previsto! });
    if (visitando.has(id)) throw new Error('Há dependência circular entre etapas.');
    visitando.add(id);
    const deps = e.depende_de.length ? e.depende_de.filter((d) => porId.has(d)) : [anteriorNoServico.get(id)].filter(Boolean) as string[];
    let ini = inicio;
    for (const d of deps) {
      const f = calcular(d).fim;
      const depois = somarDias(f, 1);
      if (depois > ini) ini = depois;
    }
    ini = proximoUtil(ini, pularDomingo);
    const dur = Math.max(1, e.duracao_dias ?? 1);
    let fim = ini;
    let restantes = dur - 1;
    while (restantes > 0) {
      fim = somarDias(fim, 1);
      if (pularDomingo && new Date(Date.UTC(+fim.slice(0, 4), +fim.slice(5, 7) - 1, +fim.slice(8, 10))).getUTCDay() === 0) continue;
      restantes--;
    }
    visitando.delete(id);
    return (res[id] = { inicio: ini, fim });
  }
  for (const e of ordenadas) calcular(e.id);
  return res;
}

/** Limites da régua da linha do tempo, com folga. */
export function limitesLinhaTempo(datas: (string | null | undefined)[], folga = 2): { inicio: string; fim: string; dias: number } | null {
  const v = datas.filter(Boolean).map((d) => d!.slice(0, 10)).sort();
  if (!v.length) return null;
  const inicio = somarDias(v[0], -folga);
  const fim = somarDias(v[v.length - 1], folga);
  return { inicio, fim, dias: diasEntre(inicio, fim) + 1 };
}

/** Posição (em %) de uma barra na régua. */
export function posicaoBarra(regua: { inicio: string; dias: number }, ini: string, fim: string): { esquerda: number; largura: number } {
  const e = diasEntre(regua.inicio, ini);
  const w = diasEntre(ini, fim) + 1;
  return { esquerda: (e / regua.dias) * 100, largura: Math.max((w / regua.dias) * 100, 0.8) };
}

/** Atraso (em dias) da previsão atual em relação à linha de base. */
export function desvioDias(base: string | null, atual: string | null): number | null {
  if (!base || !atual) return null;
  return diasEntre(base, atual);
}

/** Semanas (segunda a domingo) de um mês para a visão de calendário. */
export function semanasDoMes(ano: number, mes: number): string[][] {
  const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const dow = (new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay() + 6) % 7; // 0 = segunda
  let d = somarDias(primeiro, -dow);
  const semanas: string[][] = [];
  do {
    const s: string[] = [];
    for (let i = 0; i < 7; i++) { s.push(d); d = somarDias(d, 1); }
    semanas.push(s);
  } while (+d.slice(5, 7) === mes);
  return semanas;
}
