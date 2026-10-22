// Dinheiro em centavos inteiros. Nada de ponto flutuante em conta de dinheiro:
// o banco guarda NUMERIC(14,2) e aqui tudo vira inteiro de centavos.

export type Centavos = number;

const LIMITE = 99_999_999_999_999; // NUMERIC(14,2) em centavos

function garantirInteiro(c: number): Centavos {
  if (!Number.isSafeInteger(c) || Math.abs(c) > LIMITE) {
    throw new Error('Valor fora do limite permitido.');
  }
  return c;
}

/** Lê o valor como vem do banco ("1234.5", 1234.5) sem passar por conta de ponto flutuante. */
export function doBanco(valor: string | number | null | undefined): Centavos {
  if (valor === null || valor === undefined || valor === '') return 0;
  const texto = typeof valor === 'number' ? numeroParaTexto(valor) : valor.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m) throw new Error(`Valor inválido: ${valor}`);
  const [, sinal, inteiro, frac = ''] = m;
  const frac3 = (frac + '000').slice(0, 3);
  let c = Number(inteiro) * 100 + Number(frac3.slice(0, 2));
  // meio-para-cima no terceiro dígito
  if (Number(frac3[2]) >= 5) c += 1;
  return garantirInteiro(sinal ? -c : c);
}

function numeroParaTexto(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Valor inválido.');
  // toString de um número com até 2 casas preserva os dígitos escritos
  const s = String(n);
  if (/e/i.test(s)) return n.toFixed(2);
  return s;
}

/** Converte centavos para o texto que o banco recebe ("1234.56"). */
export function paraBanco(c: Centavos): string {
  garantirInteiro(c);
  const neg = c < 0;
  const abs = Math.abs(c);
  const inteiro = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${inteiro}.${frac}`;
}

/**
 * Lê o que a pessoa digitou: "1.234,56", "1234,5", "R$ 10", "10.50" (ponto como decimal
 * quando há só um ponto seguido de 1 ou 2 dígitos). Retorna null se não entender.
 */
export function lerDigitado(texto: string): Centavos | null {
  let t = texto.replace(/R\$|\s/g, '').trim();
  if (t === '') return null;
  let neg = false;
  if (t.startsWith('-')) {
    neg = true;
    t = t.slice(1);
  }
  let inteiro: string;
  let frac = '';
  if (t.includes(',')) {
    const partes = t.split(',');
    if (partes.length !== 2) return null;
    inteiro = partes[0].replace(/\./g, '');
    frac = partes[1];
  } else if (/^\d+\.\d{1,2}$/.test(t)) {
    [inteiro, frac] = t.split('.');
  } else {
    inteiro = t.replace(/\./g, '');
  }
  if (!/^\d+$/.test(inteiro || '0') || !/^\d*$/.test(frac) || frac.length > 2) return null;
  const c = Number(inteiro || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(c) || c > LIMITE) return null;
  return neg ? -c : c;
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "R$ 1.234,56". A divisão por 100 só acontece na exibição. */
export function formatar(c: Centavos): string {
  return fmt.format(c / 100).replace(/ /g, ' ');
}

/** "1.234,56" para preencher campos. */
export function formatarCampo(c: Centavos): string {
  return fmtNum.format(c / 100);
}

export function somar(valores: Centavos[]): Centavos {
  return garantirInteiro(valores.reduce((a, b) => a + b, 0));
}

/**
 * Divide um total em partes proporcionais aos pesos pelo método do maior resto:
 * a soma das partes é sempre exatamente o total.
 */
export function ratear(total: Centavos, pesos: number[]): Centavos[] {
  if (pesos.length === 0) return [];
  if (pesos.some((p) => p < 0)) throw new Error('Pesos não podem ser negativos.');
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  if (somaPesos === 0) throw new Error('Informe ao menos um peso maior que zero.');
  const sinal = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  // Conta exata com BigInt para não perder precisão em valores grandes.
  const escala = 1_000_000n;
  const inteiros = pesos.every((p) => Number.isSafeInteger(p));
  const pesosInt = pesos.map((p) => (inteiros ? BigInt(p) : BigInt(Math.round(p * Number(escala)))));
  const somaInt = pesosInt.reduce((a, b) => a + b, 0n);
  const bruto = pesosInt.map((p) => BigInt(abs) * p);
  const base = bruto.map((b) => b / somaInt);
  const restos = bruto.map((b, i) => ({ i, resto: b % somaInt }));
  let falta = abs - Number(base.reduce((a, b) => a + b, 0n));
  restos.sort((a, b) => (b.resto > a.resto ? 1 : b.resto < a.resto ? -1 : a.i - b.i));
  const partes = base.map((b) => Number(b));
  for (const r of restos) {
    if (falta <= 0) break;
    partes[r.i] += 1;
    falta -= 1;
  }
  return partes.map((p) => p * sinal);
}

/** Divide em n parcelas iguais; centavos que sobram vão para as primeiras. */
export function dividirEmParcelas(total: Centavos, n: number): Centavos[] {
  if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error('Número de parcelas entre 1 e 120.');
  return ratear(total, Array(n).fill(1));
}
