// Formato neutro da conversa, para trocar de provedor de IA sem mexer no resto.
import type { Ferramenta } from './ferramentas.ts';
import type { Imagem } from './executar.ts';

export type Chamada = { id: string; nome: string; args: Record<string, unknown> };
export type Resultado = { id: string; nome: string; conteudo: string; erro?: boolean };

export type Mensagem =
  | { papel: 'usuario'; texto: string; imagem?: Imagem | null }
  | { papel: 'assistente'; texto: string; chamadas?: Chamada[]; bruto?: unknown }
  | { papel: 'resultados'; resultados: Resultado[] };

export type Resposta = { texto: string; chamadas: Chamada[]; bruto: unknown };

/** Um provedor de IA (Claude, Gemini...). `bruto` volta igual na próxima chamada da mesma rodada. */
export type Modelo = {
  responder(sistema: string, mensagens: Mensagem[], ferramentas: Ferramenta[]): Promise<Resposta>;
};
