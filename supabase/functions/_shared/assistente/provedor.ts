// Escolhe o provedor de IA conforme a configuração do sistema e as chaves cadastradas.
import { criarClaude } from './claude.ts';
import { criarGemini } from './gemini.ts';
import type { Modelo } from './modelo.ts';
import type { Db } from './executar.ts';

export type Config = { provedor: 'claude' | 'gemini'; modelo: string; whatsapp_ativo: boolean; instrucoes: string | null };

export const CHAVES = {
  claude: () => Deno.env.get('ANTHROPIC_API_KEY') ?? '',
  gemini: () => Deno.env.get('GEMINI_API_KEY') ?? '',
};

export function montarModelo(cfg: Config): Modelo | null {
  if (cfg.provedor === 'gemini') {
    const chave = CHAVES.gemini();
    return chave ? criarGemini(chave, cfg.modelo.startsWith('gemini') ? cfg.modelo : 'gemini-2.5-flash') : null;
  }
  const chave = CHAVES.claude();
  return chave ? criarClaude(chave, cfg.modelo.startsWith('claude') ? cfg.modelo : 'claude-opus-5-5') : null;
}

export async function lerConfig(db: Db): Promise<Config> {
  const { data } = await db.from('assistente_config').select('provedor, modelo, whatsapp_ativo, instrucoes').maybeSingle();
  return data ?? { provedor: 'claude', modelo: 'claude-opus-5-5', whatsapp_ativo: true, instrucoes: null };
}
