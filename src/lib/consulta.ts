import { useCallback, useEffect, useState } from 'react';
import { mensagemErro } from './supabase';

/** Carrega dados e expõe erro/recarregar. A função deve lançar em caso de erro. */
export function useConsulta<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const executar = useCallback(fn, deps);
  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await executar());
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregando(false);
    }
  }, [executar]);
  useEffect(() => {
    recarregar();
  }, [recarregar]);
  return { dados, erro, carregando, recarregar, setDados };
}

/** Desembrulha a resposta do supabase-js, lançando o erro. */
export function ok<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

export function novaChave(): string {
  return crypto.randomUUID();
}

/**
 * Busca todas as linhas de uma consulta, em lotes. O banco devolve no máximo 1.000 linhas
 * por pedido; com muitos dados, uma lista simples cortaria o resto sem avisar.
 * `montar` recebe o intervalo (de, até) e devolve a consulta com `.range(de, ate)` aplicado.
 */
export async function todas<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>, lote = 1000, maximo = 50000): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; de < maximo; de += lote) {
    const r = await montar(de, de + lote - 1);
    if (r.error) throw r.error;
    const pagina = r.data ?? [];
    saida.push(...pagina);
    if (pagina.length < lote) break;
  }
  return saida;
}

/** Mostra uma lista longa aos poucos (rápido mesmo com milhares de itens). */
export function useAosPoucos<T>(lista: T[], passo = 120): { visiveis: T[]; resta: number; mais: () => void } {
  const [n, setN] = useState(passo);
  useEffect(() => { setN(passo); }, [lista.length, passo]);
  return { visiveis: lista.slice(0, n), resta: Math.max(0, lista.length - n), mais: () => setN((x) => x + passo * 2) };
}
