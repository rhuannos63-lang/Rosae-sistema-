// Nomes com acento, cedilha e til do jeito certo: em nomes de arquivo (PDF da proposta),
// títulos e cadastros. Puro, sem DOM, para testar sem navegador.

// Caracteres que o Windows-1252 põe entre 0x80 e 0x9F: aparecem quando um texto em UTF-8
// foi lido como Windows-1252 (ex.: "SoluÃ§Ãµes", "Ã‰" no lugar de "É").
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
// Controles, espaços de largura zero, quebras de linha Unicode e BOM.
const INVISIVEIS = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\ufeff]', 'g');
const PARECE_QUEBRADO = /[ÃÂ][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

/** Desfaz "SoluÃ§Ãµes" → "Soluções" quando o texto foi gravado com a codificação errada. */
export function consertarCodificacao(s: string): string {
  if (!PARECE_QUEBRADO.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x100) bytes.push(c);
    else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
    else return s; // tem algo que não veio dessa troca: deixa como está
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

/**
 * Texto pronto para gravar ou exibir: acentos na forma composta (NFC, "ç" num caractere só,
 * como o Windows, o WhatsApp e o Gmail esperam), codificação consertada e espaços simples.
 */
export function textoLimpo(s: string | null | undefined): string {
  return consertarCodificacao((s ?? '').normalize('NFC')).normalize('NFC')
    .replace(INVISIVEIS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nome de arquivo que abre igual no Windows, Mac, celular, WhatsApp e e-mail, mantendo
 * acento, cedilha e til. Só troca o que o Windows proíbe (\ / : * ? " < > |).
 */
export function nomeDeArquivo(base: string, extensao = 'pdf', limite = 150): string {
  let n = textoLimpo(base)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.length > limite) n = n.slice(0, limite).trim();
  n = n.replace(/[. ]+$/, ''); // o Windows não aceita nome terminando em ponto ou espaço
  return `${n || 'Proposta'}.${extensao}`;
}
