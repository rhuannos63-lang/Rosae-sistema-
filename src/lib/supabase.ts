import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/** Falta de configuração aparece na tela como pendência, nunca como sistema funcionando. */
export const configurado = Boolean(url && chave);

export const supabase: SupabaseClient = configurado
  ? createClient(url!, chave!, { auth: { persistSession: true, autoRefreshToken: true } })
  : (null as unknown as SupabaseClient);

/** Traduz erros do banco para uma mensagem legível. */
export function mensagemErro(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (/row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para esta ação.';
  if (/duplicate key/i.test(msg)) return 'Já existe um registro com estes dados.';
  return msg;
}
