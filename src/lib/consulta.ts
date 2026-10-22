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
