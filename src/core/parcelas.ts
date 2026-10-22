import { type Centavos, dividirEmParcelas } from './dinheiro';
import { somarMeses, somarDias } from './datas';

export type ParcelaPlano = { numero: number; valor: Centavos; vencimento: string };

export type Frequencia = 'mensal' | 'quinzenal' | 'semanal';

/** Gera o plano de parcelas: valores pelo maior resto, vencimentos pela frequência. */
export function gerarParcelas(total: Centavos, quantidade: number, primeiroVencimento: string, frequencia: Frequencia = 'mensal'): ParcelaPlano[] {
  if (total <= 0) throw new Error('O valor total precisa ser maior que zero.');
  const valores = dividirEmParcelas(total, quantidade);
  return valores.map((valor, i) => ({
    numero: i + 1,
    valor,
    vencimento:
      frequencia === 'mensal' ? somarMeses(primeiroVencimento, i) : somarDias(primeiroVencimento, i * (frequencia === 'quinzenal' ? 15 : 7)),
  }));
}

/** Entrada + saldo parcelado (ex.: 30% de entrada e o resto em 3 vezes). */
export function gerarComEntrada(total: Centavos, entrada: Centavos, quantidadeRestante: number, dataEntrada: string, primeiroVencimento: string): ParcelaPlano[] {
  if (entrada <= 0 || entrada >= total) throw new Error('A entrada precisa ser maior que zero e menor que o total.');
  const resto = gerarParcelas(total - entrada, quantidadeRestante, primeiroVencimento);
  return [{ numero: 1, valor: entrada, vencimento: dataEntrada }, ...resto.map((p) => ({ ...p, numero: p.numero + 1 }))];
}

export function validarPlano(total: Centavos, plano: ParcelaPlano[]): string | null {
  if (plano.length === 0) return 'Informe ao menos uma parcela.';
  if (plano.some((p) => p.valor <= 0)) return 'Toda parcela precisa ter valor maior que zero.';
  if (plano.some((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento))) return 'Toda parcela precisa de vencimento.';
  const soma = plano.reduce((a, p) => a + p.valor, 0);
  if (soma !== total) return 'A soma das parcelas precisa ser igual ao valor total.';
  return null;
}
