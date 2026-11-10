// Logo depois do aceite: o passo "Gerar contrato" na própria proposta.
// Um toque cria a obra (se ainda não existir) e abre o contrato próprio do tipo de serviço.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Erro, useToast } from './ui';
import { Icone } from './Icone';
import { formatarData } from '../core/datas';
import { SERVICO_CONTRATO, servicosDoContrato } from '../core/contrato';
import { normalizar, type Conteudo } from '../core/proposta';
import type { Contrato, Proposta } from '../lib/tipos';

type Situacao = { obra: { id: string; tipo_servico: string | null } | null; contrato: Pick<Contrato, 'id' | 'codigo' | 'estado' | 'assinado_em'> | null };

/** Cria a obra do orçamento aceito (com os aditivos aceitos e a lista de compras). Repetir não duplica. */
export async function criarObraDoOrcamento(propostaId: string, versaoId: string): Promise<string> {
  const r = await supabase.rpc('converter_proposta', { p_versao: versaoId });
  if (r.error) throw new Error(mensagemErro(r.error));
  const ads = await supabase.from('proposta').select('versao_aprovada_id').eq('proposta_origem_id', propostaId).eq('estado', 'aprovada');
  for (const a of (ads.data ?? []) as { versao_aprovada_id: string | null }[]) {
    if (!a.versao_aprovada_id) continue;
    const x = await supabase.rpc('converter_proposta', { p_versao: a.versao_aprovada_id });
    if (x.error) throw new Error(`Obra criada, mas um aditivo não entrou: ${mensagemErro(x.error)}`);
  }
  await supabase.rpc('gerar_lista_compras', { p_obra: r.data as string });
  return r.data as string;
}

export function ContratoDoAceite({ proposta, versaoId, conteudo }: { proposta: Proposta; versaoId: string; conteudo: Partial<Conteudo> }) {
  const navegar = useNavigate();
  const toast = useToast();
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { dados } = useConsulta(async (): Promise<Situacao> => {
    const obra = (ok(await supabase.from('obra').select('id, tipo_servico').eq('proposta_versao_id', versaoId).limit(1)) as { id: string; tipo_servico: string | null }[])[0] ?? null;
    if (!obra) return { obra: null, contrato: null };
    const c = ok(await supabase.from('contrato').select('id, codigo, estado, assinado_em').eq('obra_id', obra.id).neq('estado', 'cancelado').limit(1)) as Situacao['contrato'][];
    return { obra, contrato: c[0] ?? null };
  }, [versaoId]);

  const tipos = servicosDoContrato(normalizar(conteudo), dados?.obra?.tipo_servico).map((p) => SERVICO_CONTRATO[p].rotulo.toLowerCase());
  const c = dados?.contrato;

  async function gerar() {
    setErro(null);
    setRodando(true);
    try {
      const obraId = dados?.obra?.id ?? (await criarObraDoOrcamento(proposta.id, versaoId));
      if (!dados?.obra) toast('Obra criada com serviços, etapas e previsão de recebimento. Agora revise o contrato.');
      navegar(`/obras/${obraId}?aba=contrato&gerar=1`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setRodando(false);
    }
  }

  if (!dados) return null;
  const titulo = !c ? 'Próximo passo: gerar o contrato' : c.estado === 'rascunho' ? `Contrato ${c.codigo} em rascunho` : c.estado === 'emitido' ? `Contrato ${c.codigo} aguardando assinatura` : `Contrato ${c.codigo} assinado`;
  const texto = !c
    ? `Um toque cria a obra (serviços, etapas, compras e recebimentos) e abre o contrato de ${tipos.join(' e ')} montado com esta proposta, com a base legal citada (Código de Defesa do Consumidor, Código Civil, ART e normas ABNT). Você revisa e edita tudo antes de emitir.`
    : c.estado === 'rascunho' ? 'Continue de onde parou: revise, emita e mande o link de assinatura.'
      : c.estado === 'emitido' ? 'Mande o link de assinatura ao cliente pela aba Contrato da obra.'
        : `Assinado em ${formatarData(c.assinado_em)}. Libere a obra para iniciar na aba Contrato.`;
  return (
    <div className="editar-emitida contrato-aceite">
      <div>
        <b><Icone nome="documento" /> {titulo}</b>
        <span className="muted small">{texto}</span>
      </div>
      {!c || c.estado === 'rascunho'
        ? <button className="btn-primario" onClick={gerar} disabled={rodando}>{rodando ? 'Preparando…' : c ? 'Continuar contrato' : 'Gerar contrato'}</button>
        : <Link className="btn-secundario" to={`/obras/${dados.obra!.id}?aba=contrato`}>Abrir contrato</Link>}
      {dados.obra && <Link className="btn-link" to={`/obras/${dados.obra.id}`}>Abrir a obra</Link>}
      <Erro mensagem={erro} />
    </div>
  );
}
