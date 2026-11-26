// Busca e checagem de cliente repetido no "Novo orçamento". Puro, testável sem banco.
import { textoLimpo } from './textoArquivo';

export type ClienteMin = { id: string; nome: string; telefone: string | null; email: string | null };

/** Texto para comparar: sem acento, sem caixa, sem pontuação ("Soluções" = "solucoes"). */
export function chaveBusca(s: string | null | undefined): string {
  return textoLimpo(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
}

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');
/** Últimos 8 dígitos: o mesmo celular com ou sem 55, DDD e o 9 da frente. */
const fimTelefone = (s: string | null | undefined) => digitos(s).slice(-8);

/** Clientes cujo nome, telefone ou e-mail batem com o que foi digitado (todas as palavras, em qualquer ordem). */
export function buscarClientes<T extends ClienteMin>(lista: T[], termo: string, limite = 50): T[] {
  const t = chaveBusca(termo);
  if (!t) return lista.slice(0, limite);
  const palavras = t.split(' ');
  const num = digitos(termo);
  return lista.filter((p) => {
    const alvo = chaveBusca(`${p.nome} ${p.email ?? ''}`);
    if (palavras.every((w) => alvo.includes(w))) return true;
    return num.length >= 4 && digitos(p.telefone).includes(num);
  }).slice(0, limite);
}

/** Cadastros que parecem ser a mesma pessoa que está sendo digitada como "Novo cliente". */
export function clientesParecidos<T extends ClienteMin>(lista: T[], novo: { nome: string; telefone?: string; email?: string }): T[] {
  const nome = chaveBusca(novo.nome);
  const tel = fimTelefone(novo.telefone);
  const email = chaveBusca(novo.email);
  if (nome.length < 3 && tel.length < 8 && !email.includes('@')) return [];
  return lista.filter((p) =>
    (nome.length >= 3 && chaveBusca(p.nome) === nome)
    || (tel.length === 8 && fimTelefone(p.telefone) === tel)
    || (email.includes('@') && chaveBusca(p.email) === email),
  ).slice(0, 3);
}
