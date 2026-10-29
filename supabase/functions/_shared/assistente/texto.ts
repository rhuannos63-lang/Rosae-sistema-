// Utilidades de texto do assistente (sem dependências: rodam no Deno e nos testes).

/** Data de hoje em Brasília, AAAA-MM-DD. */
export function hojeBrasilia(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export function somarDiasIso(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function dataValida(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

/** Só dígitos; números brasileiros sem DDI ganham 55. */
export function normalizarTelefone(t: string): string {
  const d = (t ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function reais(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function dataBr(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Resposta curta de confirmação ("sim", "pode lançar") ou recusa ("não", "cancela"). */
export function interpretarResposta(texto: string): 'sim' | 'nao' | null {
  const t = semAcento(texto).replace(/[.!,;]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > 40) return null;
  if (/^(nao|n|cancela|cancelar|cancele|nao quero|deixa|esquece|nao confirmo|errado|👎)( .*)?$/.test(t)) return 'nao';
  if (/^(sim|s|ok|okay|confirmo|confirmar|confirma|pode|pode sim|pode lancar|pode gravar|pode salvar|isso|certo|correto|manda|fechado|beleza|blz|👍|✅)( .*)?$/.test(t)) return 'sim';
  return null;
}

/** Comando de vínculo enviado pelo WhatsApp: "vincular 123456". */
export function codigoVinculo(texto: string): string | null {
  const m = semAcento(texto).match(/^vincular?\s*(\d{6})$/);
  return m ? m[1] : null;
}

/** Corta mensagens longas em partes que cabem no WhatsApp (4096 caracteres). */
export function partirMensagem(texto: string, limite = 4000): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > limite) {
    let corte = resto.lastIndexOf('\n', limite);
    if (corte < limite / 2) corte = resto.lastIndexOf(' ', limite);
    if (corte < limite / 2) corte = limite;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Limita o tamanho do que volta das consultas para a IA. */
export function compactar(valor: unknown, limite = 12000): string {
  const s = JSON.stringify(valor ?? null);
  return s.length > limite ? `${s.slice(0, limite)}… (cortado; peça um filtro mais específico)` : s;
}
