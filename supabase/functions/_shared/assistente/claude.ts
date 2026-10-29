// Provedor Claude (Anthropic), pelo SDK oficial.
import Anthropic from '@anthropic-ai/sdk';
import type { Ferramenta } from './ferramentas.ts';
import type { Chamada, Mensagem, Modelo, Resposta } from './modelo.ts';

type Bloco = Anthropic.Beta.BetaContentBlockParam;

function converter(mensagens: Mensagem[]): Anthropic.Beta.BetaMessageParam[] {
  return mensagens.map((m): Anthropic.Beta.BetaMessageParam => {
    if (m.papel === 'usuario') {
      const conteudo: Bloco[] = [];
      if (m.imagem?.mime === 'application/pdf') {
        conteudo.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.imagem.base64 } });
      } else if (m.imagem) {
        conteudo.push({ type: 'image', source: { type: 'base64', media_type: m.imagem.mime as 'image/jpeg', data: m.imagem.base64 } });
      }
      conteudo.push({ type: 'text', text: m.texto || '(foto enviada sem texto)' });
      return { role: 'user', content: conteudo };
    }
    if (m.papel === 'resultados') {
      return {
        role: 'user',
        content: m.resultados.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.conteudo, is_error: r.erro || undefined })),
      };
    }
    // A resposta da própria rodada volta exatamente como veio (inclui os blocos de raciocínio).
    if (m.bruto) return { role: 'assistant', content: m.bruto as Bloco[] };
    return { role: 'assistant', content: m.texto || '…' };
  });
}

export function criarClaude(apiKey: string, modelo: string): Modelo {
  const client = new Anthropic({ apiKey });
  const ehOpus = /opus|fable/.test(modelo);
  return {
    async responder(sistema: string, mensagens: Mensagem[], ferramentas: Ferramenta[]): Promise<Resposta> {
      const tools: Anthropic.Beta.BetaTool[] = ferramentas.map((f) => ({
        name: f.nome, description: f.descricao, input_schema: f.parametros as Anthropic.Beta.BetaTool.InputSchema, strict: true,
      }));
      const parametros = {
        model: modelo,
        max_tokens: 16000,
        system: [{ type: 'text' as const, text: sistema, cache_control: { type: 'ephemeral' as const } }],
        tools,
        messages: converter(mensagens),
        output_config: { effort: 'low' as const },
        // Se o modelo principal recusar por engano, o próprio servidor tenta outro modelo.
        ...(ehOpus ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      };
      const r = await client.beta.messages.create(parametros as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (r.stop_reason === 'refusal') {
        return { texto: 'Não consigo ajudar com esse pedido. Tente reformular.', chamadas: [], bruto: null };
      }
      const texto = r.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
      const chamadas: Chamada[] = r.stop_reason === 'max_tokens' ? [] : r.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, nome: b.name, args: (b.input ?? {}) as Record<string, unknown> }));
      return { texto, chamadas, bruto: r.content };
    },
  };
}
