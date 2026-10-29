// Provedor Gemini (Google), pela API REST. Também transcreve áudio do WhatsApp.
import type { Ferramenta } from './ferramentas.ts';
import type { Chamada, Mensagem, Modelo, Resposta } from './modelo.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type Parte = Record<string, unknown>;
type Conteudo = { role: 'user' | 'model'; parts: Parte[] };

/** O Gemini aceita um subconjunto do JSON Schema: sem additionalProperties. */
export function esquemaGemini(e: unknown): unknown {
  if (Array.isArray(e)) return e.map(esquemaGemini);
  if (!e || typeof e !== 'object') return e;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'additionalProperties') continue;
    saida[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, esquemaGemini(s)])) : esquemaGemini(v);
  }
  if (saida.type === 'object' && Object.keys((saida.properties as object) ?? {}).length === 0) delete saida.properties;
  return saida;
}

function converter(mensagens: Mensagem[]): Conteudo[] {
  return mensagens.map((m): Conteudo => {
    if (m.papel === 'usuario') {
      const parts: Parte[] = [];
      if (m.imagem) parts.push({ inlineData: { mimeType: m.imagem.mime, data: m.imagem.base64 } });
      parts.push({ text: m.texto || '(foto enviada sem texto)' });
      return { role: 'user', parts };
    }
    if (m.papel === 'resultados') {
      return { role: 'user', parts: m.resultados.map((r) => ({ functionResponse: { name: r.nome, response: r.erro ? { erro: r.conteudo } : { resultado: r.conteudo } } })) };
    }
    if (m.bruto) return m.bruto as Conteudo;
    return { role: 'model', parts: [{ text: m.texto || '…' }] };
  });
}

async function chamar(apiKey: string, modelo: string, corpo: unknown) {
  const r = await fetch(`${BASE}/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

export function criarGemini(apiKey: string, modelo: string): Modelo {
  return {
    async responder(sistema: string, mensagens: Mensagem[], ferramentas: Ferramenta[]): Promise<Resposta> {
      const j = await chamar(apiKey, modelo, {
        systemInstruction: { parts: [{ text: sistema }] },
        contents: converter(mensagens),
        tools: [{ functionDeclarations: ferramentas.map((f) => ({ name: f.nome, description: f.descricao, parameters: esquemaGemini(f.parametros) })) }],
      });
      const conteudo: Conteudo = j.candidates?.[0]?.content ?? { role: 'model', parts: [] };
      const parts = conteudo.parts ?? [];
      const texto = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text as string).join('\n').trim();
      const chamadas: Chamada[] = parts
        .filter((p) => p.functionCall)
        .map((p, i) => {
          const fc = p.functionCall as { name: string; args?: Record<string, unknown>; id?: string };
          return { id: fc.id ?? `g${i}`, nome: fc.name, args: fc.args ?? {} };
        });
      return { texto, chamadas, bruto: { role: 'model', parts } };
    },
  };
}

/** Transcreve um áudio (mensagem de voz do WhatsApp) para texto em português. */
export async function transcreverAudio(apiKey: string, mime: string, base64: string, modelo = 'gemini-2.5-flash'): Promise<string> {
  const j = await chamar(apiKey, modelo, {
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: mime.split(';')[0], data: base64 } },
      { text: 'Transcreva este áudio em português do Brasil, exatamente como foi falado, sem comentários.' },
    ] }],
  });
  return (j.candidates?.[0]?.content?.parts ?? []).map((p: Parte) => p.text ?? '').join(' ').trim();
}
