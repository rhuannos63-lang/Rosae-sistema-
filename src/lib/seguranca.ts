// Preferências de segurança deste aparelho.
const CHAVE_MIN = 'rosae.inatividade_min';
const CHAVE_ULTIMA = 'rosae.ultima_atividade';
export const SAIU_POR_INATIVIDADE = 'rosae.saiu_por_inatividade';

export const OPCOES_INATIVIDADE: { minutos: number; rotulo: string }[] = [
  { minutos: 30, rotulo: '30 minutos' },
  { minutos: 60, rotulo: '1 hora' },
  { minutos: 120, rotulo: '2 horas' },
  { minutos: 480, rotulo: '8 horas (padrão)' },
  { minutos: 1440, rotulo: '24 horas' },
  { minutos: 0, rotulo: 'Nunca sair sozinho' },
];

export function minutosInatividade(): number {
  const v = Number(localStorage.getItem(CHAVE_MIN));
  return localStorage.getItem(CHAVE_MIN) === null || !Number.isFinite(v) ? 480 : Math.max(0, v);
}
export function definirMinutosInatividade(min: number) {
  localStorage.setItem(CHAVE_MIN, String(min));
  marcarAtividade(true);
}

let ultimaGravada = 0;
/** Guarda a hora do último uso (no máximo a cada 30 s, para não pesar). */
export function marcarAtividade(forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimaGravada < 30_000) return;
  ultimaGravada = agora;
  localStorage.setItem(CHAVE_ULTIMA, String(agora));
}

export function inativoDemais(agora = Date.now()): boolean {
  const min = minutosInatividade();
  const ultima = Number(localStorage.getItem(CHAVE_ULTIMA));
  if (!min || !ultima) return false;
  return agora - ultima > min * 60_000;
}
