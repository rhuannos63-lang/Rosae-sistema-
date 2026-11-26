// Fechado × recebido de cada contrato e o registro do que de fato entrou.
// O aceite da proposta só cria a previsão; recebido é sempre um movimento real, com valor e data livres.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok, novaChave } from '../lib/consulta';
import { Ajuda, CampoValor, Erro, Modal, useToast } from './ui';
import { Icone } from './Icone';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarData, hoje } from '../core/datas';
import type { ContaBancaria, VMovimento } from '../lib/tipos';
import { agruparRecebimentos, faltaReceber, percentualRecebido } from '../core/recebimentos';

export type Contrato = {
  proposta_id: string | null; codigo: string; titulo: string; cliente: string | null;
  obra_id: string | null; obra_codigo: string | null; obra_nome: string | null;
  data_fechamento: string | null; valor_orcamento: number | string; aditivos: number | string; fechado: number | string;
  recebido: number | string; falta_receber: number | string; previsto_aberto: number | string; previsto_vencido: number | string;
  ultimo_recebimento: string | null;
};

export async function carregarContratos(): Promise<Contrato[]> {
  return (ok(await supabase.rpc('contratos_recebimentos')) as Contrato[] | null) ?? [];
}

/** Janela "Registrar recebimento": valor e data livres, abate da previsão sozinho. */
export function RegistrarRecebimento({ contrato, aoFechar, aoSalvar }: { contrato: Contrato; aoFechar: () => void; aoSalvar: (obraId: string) => void }) {
  const toast = useToast();
  const contas = useConsulta(async () => ok(await supabase.from('conta_bancaria').select('*').eq('ativa', true).order('ordem')) as ContaBancaria[], []);
  const falta = faltaReceber(contrato);
  const [valor, setValor] = useState<Centavos | null>(null);
  const [data, setData] = useState(hoje());
  const [conta, setConta] = useState('');
  const [forma, setForma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Uma chave por abertura: clique duplo ou nova tentativa não duplicam.
  const [chave] = useState(novaChave);
  const contaEscolhida = conta || contas.dados?.[0]?.id || '';
  const passa = valor !== null && valor > 0 && valor > doBanco(contrato.previsto_aberto);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!valor || valor <= 0) return setErro('Informe quanto entrou.');
    if (data > hoje()) return setErro('A data não pode ser no futuro. Registre quando o dinheiro de fato entrar.');
    setSalvando(true);
    const r = await supabase.rpc('registrar_recebimento_contrato', {
      p_proposta: contrato.proposta_id, p_obra: contrato.obra_id, p_conta: contaEscolhida || null,
      p_valor: paraBanco(valor), p_data: data, p_descricao: forma.trim() || null, p_chave: chave,
    });
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    const d = r.data as { obra_id: string; obra_criada?: boolean; repetido?: boolean };
    toast(d.repetido ? 'Esse recebimento já estava registrado. Nada foi duplicado.'
      : d.obra_criada ? `Recebimento de ${formatar(valor)} registrado. O orçamento virou obra para guardar o caixa.` : `Recebimento de ${formatar(valor)} registrado.`);
    aoSalvar(d.obra_id);
  }

  return (
    <Modal titulo="Registrar recebimento" aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-rec" disabled={salvando}>{salvando ? 'Registrando…' : 'Confirmar recebimento'}</button></>}>
      <form id="form-rec" className="stack" onSubmit={salvar}>
        <div className="aviso info"><span><b>{contrato.titulo}</b>{contrato.cliente ? ` · ${contrato.cliente}` : ''}<br />Fechado {formatar(doBanco(contrato.fechado))} · já recebido {formatar(doBanco(contrato.recebido))} · falta {formatar(falta)}</span></div>
        <div className="grid grid-2">
          <label className="campo">Quanto entrou<CampoValor valor={valor} aoMudar={setValor} obrigatorio autoFocus /></label>
          <label className="campo">Quando entrou<input type="date" value={data} max={hoje()} onChange={(e) => setData(e.target.value)} required /></label>
        </div>
        {falta > 0 && <div className="row"><button type="button" className="chip-link" onClick={() => setValor(falta)}>Usar o que falta ({formatar(falta)})</button></div>}
        <label className="campo">
          Entrou em qual conta?
          <select value={contaEscolhida} onChange={(e) => setConta(e.target.value)}>
            {(contas.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.instituicao ? ` (${c.instituicao})` : ''}</option>)}
          </select>
        </label>
        <label className="campo">Forma / observação<input value={forma} onChange={(e) => setForma(e.target.value)} placeholder="PIX, transferência, dinheiro, entrada combinada…" /></label>
        <p className="muted small" style={{ margin: 0 }}>
          Vale o que foi combinado com o cliente, mesmo que seja diferente das parcelas da proposta. O valor abate da previsão em aberto, da mais antiga para a mais nova.
          {passa && <> <b>Passa do que estava previsto:</b> a diferença entra como recebimento extra deste contrato.</>}
          {!contrato.obra_id && <> Como o orçamento ainda não virou obra, ele vira agora, para o caixa ficar guardado nela.</>}
        </p>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

/** Três números lado a lado e a barra do quanto já entrou. */
export function NumerosContrato({ c, compacto }: { c: Contrato; compacto?: boolean }) {
  const pct = percentualRecebido(c);
  const vencido = doBanco(c.previsto_vencido);
  return (
    <>
      <div className={compacto ? 'numeros-compactos' : 'grid grid-3'}>
        <div className="kpi"><div className="rotulo">Fechado no orçamento</div><div className="valor num">{formatar(doBanco(c.fechado))}</div>
          <div className="det">{doBanco(c.aditivos) ? `Orçamento ${formatar(doBanco(c.valor_orcamento))} + aditivos ${formatar(doBanco(c.aditivos))}` : c.data_fechamento ? `Aceito em ${formatarData(c.data_fechamento)}` : 'Valor contratado'}</div></div>
        <div className="kpi"><div className="rotulo">Recebido de fato</div><div className="valor num">{formatar(doBanco(c.recebido))}</div>
          <div className="det">{c.ultimo_recebimento ? `Último em ${formatarData(c.ultimo_recebimento)}` : 'Nada registrado ainda'}</div></div>
        <div className="kpi"><div className="rotulo">Falta receber</div><div className="valor num">{formatar(faltaReceber(c))}</div>
          <div className="det">{vencido > 0 ? `${formatar(vencido)} previsto já venceu` : `${pct}% recebido`}</div></div>
      </div>
      <div className="barra-meta" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Quanto do fechado já entrou"><div style={{ width: `${Math.min(pct, 100)}%` }} /></div>
    </>
  );
}

/**
 * Quadro "Fechado × recebido" de um contrato (orçamento aceito ou obra), com o botão para registrar
 * o que entrou e a lista dos recebimentos (com desfazer).
 */
export function QuadroRecebido({ propostaId, obraId, aoMudar, compacto }: { propostaId?: string | null; obraId?: string | null; aoMudar?: () => void; compacto?: boolean }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { dados, recarregar } = useConsulta(async () => {
    const lista = await carregarContratos();
    const c = lista.find((x) => (propostaId && x.proposta_id === propostaId) || (!propostaId && obraId && x.obra_id === obraId)) ?? null;
    const movs = c?.obra_id
      ? ok(await supabase.from('v_movimento').select('*').eq('obra_id', c.obra_id).not('parcela_id', 'is', null).eq('natureza', 'entrada')
          .in('categoria_natureza', ['receita_servico', 'reembolso_cliente']).order('data', { ascending: false }).order('criado_em', { ascending: false })) as VMovimento[]
      : [];
    return { c, movs };
  }, [propostaId, obraId]);
  const grupos = useMemo(() => agruparRecebimentos(dados?.movs ?? []), [dados?.movs]);
  if (!dados?.c) return null;
  const c = dados.c;

  async function desfazer(ids: string[], total: Centavos) {
    const motivo = window.prompt(`Desfazer o recebimento de ${formatar(total)}? Diga o motivo (fica no histórico):`, 'Lançado errado');
    if (!motivo?.trim()) return;
    setErro(null);
    for (const id of ids) {
      const r = await supabase.rpc('estornar_movimento', { p_movimento: id, p_data: hoje(), p_motivo: motivo.trim() });
      if (r.error) return setErro(mensagemErro(r.error));
    }
    toast('Recebimento desfeito. O original fica no histórico com o estorno.');
    recarregar(); aoMudar?.();
  }

  return (
    <div className="card">
      <div className="topo" style={{ marginBottom: 10 }}>
        <h2>Fechado × recebido <Ajuda>Fechado é o valor do orçamento aceito mais os aditivos aceitos. Recebido é só o dinheiro que você registrou como entrado: o aceite da proposta não conta como recebido. A previsão das parcelas da proposta serve de lembrete e é abatida a cada recebimento.</Ajuda></h2>
        <button className="btn-primario" onClick={() => setAberto(true)}><Icone nome="mais" /> Registrar recebimento</button>
      </div>
      <NumerosContrato c={c} compacto={compacto} />
      {grupos.length > 0 && (
        <div className="tabela-wrap" style={{ marginTop: 14 }}>
          <table className="tabela">
            <thead><tr><th>Data</th><th>Forma</th>{!compacto && <th>Conta</th>}<th className="right">Valor</th><th /></tr></thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.chave} className={g.estornado ? 'muted' : ''}>
                  <td>{formatarData(g.data)}</td>
                  <td>{g.descricao || '—'}{g.estornado && <span className="selo neutro" style={{ marginLeft: 6 }}>Desfeito</span>}</td>
                  {!compacto && <td>{g.conta}</td>}
                  <td className="right num">{formatar(g.valor)}</td>
                  <td className="right">{!g.estornado && <button className="btn-link" title="Desfazer" aria-label="Desfazer este recebimento" onClick={() => desfazer(g.ids, g.valor)}>{compacto ? <Icone nome="desfazer" /> : 'Desfazer'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {grupos.length === 0 && <p className="muted small" style={{ marginBottom: 0, marginTop: 12 }}>Quando o cliente pagar, toque em “Registrar recebimento” e coloque o valor e a data que de fato entraram.</p>}
      <p className="small" style={{ marginBottom: 0, marginTop: 10 }}><Link to="/recebimentos">Ver todos os contratos <Icone nome="seta" /></Link></p>
      <Erro mensagem={erro} />
      {aberto && <RegistrarRecebimento contrato={c} aoFechar={() => setAberto(false)} aoSalvar={() => { setAberto(false); recarregar(); aoMudar?.(); }} />}
    </div>
  );
}
