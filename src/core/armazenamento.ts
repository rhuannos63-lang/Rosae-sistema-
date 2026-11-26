// Projeção de uso do armazenamento: banco (texto) e arquivos (fotos, PDFs, XML).
// Conta pelo ritmo real desde o início do sistema e pelo dos últimos 6 meses (o maior dos dois).

export type UsoArmazenamento = {
  inicio: string;
  banco: { bytes: number; limite_bytes: number; tabelas: { tabela: string; bytes: number }[] };
  arquivos: { bytes: number; quantidade: number; fotos_bytes: number; limite_bytes: number };
  frio: { bytes: number; quantidade: number; copiado_bytes: number; copiado_quantidade: number; limite_bytes: number; sem_copia: number };
  mensal: { mes: string; bytes: number }[];
  backups: { em: string; tipo: string; destino: 'r2' | 'github'; bytes: number | null; arquivos_copiados: number; arquivos_arquivados: number; ok: boolean; detalhe: string | null }[];
  config: { limite_banco_mb: number; limite_arquivos_mb: number; limite_frio_gb: number; arquivar_acima_pct: number; alvo_pct: number; idade_minima_meses: number; guarda_anos: number };
};

export type Projecao = {
  meses: number;
  banco_mes: number;
  arquivos_mes: number;
  banco_final: number;
  arquivos_final: number;
  /** Meses até encher (null = não enche no período). */
  banco_enche_em: number | null;
  supabase_arquivos_enche_em: number | null;
  /** Total que vai precisar ficar no R2 no fim do período (o que não cabe no Supabase). */
  frio_final: number;
  /** Custo estimado por mês no fim do período, em dólares (R2 acima de 10 GB). */
  custo_r2_mes_usd: number;
};

/** Banco recém-criado já ocupa isto só com a estrutura (tabelas vazias, índices, funções). */
export const BASE_BANCO = 15 * 1024 * 1024;
const R2_USD_GB_MES = 0.015;
const GB = 1024 ** 3;

export function mesesEntre(inicio: Date, fim: Date): number {
  return Math.max(1, (fim.getTime() - inicio.getTime()) / (30.44 * 24 * 3600 * 1000));
}

export function projetar(u: UsoArmazenamento, agora = new Date(), anos = u.config.guarda_anos || 10): Projecao {
  const meses = anos * 12;
  const vida = mesesEntre(new Date(u.inicio), agora);
  const arquivosHoje = u.arquivos.bytes + u.frio.bytes;
  const recentes = u.mensal.slice(-6).map((m) => m.bytes);
  const ritmoRecente = recentes.length ? recentes.reduce((s, b) => s + b, 0) / Math.min(6, Math.max(1, Math.ceil(vida))) : 0;
  const arquivos_mes = Math.max(arquivosHoje / vida, Math.min(ritmoRecente, arquivosHoje));
  const banco_mes = Math.max(0, u.banco.bytes - BASE_BANCO) / vida;
  const banco_final = u.banco.bytes + banco_mes * meses;
  const arquivos_final = arquivosHoje + arquivos_mes * meses;
  const enche = (atual: number, ritmo: number, limite: number) => {
    if (atual >= limite) return 0;
    if (ritmo <= 0) return null;
    const m = (limite - atual) / ritmo;
    return m > meses ? null : Math.floor(m);
  };
  const limiteUtil = (u.arquivos.limite_bytes * u.config.alvo_pct) / 100;
  const frio_final = Math.max(0, arquivos_final - limiteUtil);
  return {
    meses,
    banco_mes,
    arquivos_mes,
    banco_final,
    arquivos_final,
    banco_enche_em: enche(u.banco.bytes, banco_mes, u.banco.limite_bytes),
    supabase_arquivos_enche_em: enche(u.arquivos.bytes, arquivos_mes, u.arquivos.limite_bytes),
    frio_final,
    custo_r2_mes_usd: Math.max(0, frio_final / GB - 10) * R2_USD_GB_MES,
  };
}

export function formatarBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 MB';
  if (b >= GB) return `${(b / GB).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  const mb = b / 1024 ** 2;
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

export function formatarMeses(m: number): string {
  if (m < 1) return 'menos de 1 mês';
  if (m < 24) return `${Math.round(m)} ${Math.round(m) === 1 ? 'mês' : 'meses'}`;
  const anos = m / 12;
  return `${anos.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos`;
}
