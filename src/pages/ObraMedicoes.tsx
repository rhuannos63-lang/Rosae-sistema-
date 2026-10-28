// Aba "Medições" da obra: fotografa o avanço físico das etapas numa data de corte, envia ao
// cliente pelo portal para aprovar ou contestar e, aprovada, liga a cobrança (parcela a receber).
// O valor medido só aparece para quem tem acesso ao financeiro; o cliente nunca vê valores.
import { Fragment, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Ajuda, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar } from '../core/dinheiro';
import { formatarData, formatarDataHora, hoje } from '../core/datas';
import { LancamentoForm } from './Financeiro';
import type { Obra, VParcela } from '../lib/tipos';

type ItemMedicao = { etapa_id: string; servico: string; etapa: string; peso: number; anterior: number; atual: number };
type Medicao = {
  id: string; numero: number; data_corte: string; estado: 'rascunho' | 'enviada' | 'aprovada' | 'contestada' | 'cancelada';
  itens: ItemMedicao[]; percentual_anterior: number; percentual_atual: number; observacao: string | null; parcela_id: string | null;
  hash: string | null; enviada_em: string | null; respondida_em: string | null; resposta_nome: string | null; resposta_texto: string | null;
  cancelada_motivo: string | null; criado_em: string;
};
type Valores = { id: string; valor_contratado: string; valor_medido: string };

export const ESTADO_MEDICAO: Record<Medicao['estado'], { rotulo: string; classe: string }> = {
  rascunho: { rotulo: 'Rascunho', classe: 'neutro' },
  enviada: { rotulo: 'Aguardando o cliente', classe: 'alerta' },
  aprovada: { rotulo: 'Aprovada', classe: 'ok' },
  contestada: { rotulo: 'Contestada', classe: 'erro' },
  cancelada: { rotulo: 'Cancelada', classe: 'neutro' },
};

const pct = (v: number) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function MedicoesObra({ obra }: { obra: Obra }) {
  const toast = useToast();
  const { podeFinanceiro } = useAuth();
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [cobrar, setCobrar] = useState<Medicao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const [m, v, p, ac] = await Promise.all([
      supabase.from('medicao').select('id, numero, data_corte, estado, itens, percentual_anterior, percentual_atual, observacao, parcela_id, hash, enviada_em, respondida_em, resposta_nome, resposta_texto, cancelada_motivo, criado_em').eq('obra_id', obra.id).order('numero', { ascending: false }),
      podeFinanceiro ? supabase.rpc('medicoes_valores', { p_obra: obra.id }) : Promise.resolve({ data: [], error: null }),
      podeFinanceiro ? supabase.from('v_parcela').select('*').eq('obra_id', obra.id).eq('tipo', 'receber').eq('cancelado', false).order('vencimento') : Promise.resolve({ data: [], error: null }),
      supabase.from('portal_acesso').select('id', { count: 'exact', head: true }).eq('obra_id', obra.id).is('revogado_em', null).gt('expira_em', new Date().toISOString()),
    ]);
    return {
      medicoes: ok(m) as Medicao[],
      valores: new Map((ok(v) as Valores[]).map((x) => [x.id, x])),
      parcelas: ok(p) as VParcela[],
      comPortal: (ac.count ?? 0) > 0,
    };
  }, [obra.id, podeFinanceiro]);

  async function chamar(rotulo: string, fn: () => PromiseLike<{ error: unknown }>, sucesso: string) {
    setOcupado(rotulo);
    const r = await fn();
    setOcupado(null);
    if (r.error) return toast(mensagemErro(r.error));
    toast(sucesso);
    recarregar();
  }

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados) return null;
  const emAberto = dados.medicoes.some((m) => m.estado === 'rascunho' || m.estado === 'enviada');
  const aprovadas = dados.medicoes.filter((m) => m.estado === 'aprovada');
  const ultimaAprovada = aprovadas[0];
  const medidoAprovado = aprovadas.reduce((s, m) => s + doBanco(dados.valores.get(m.id)?.valor_medido), 0);
  const parcela = (id: string | null) => dados.parcelas.find((p) => p.id === id);

  return (
    <div className="stack">
      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <h2>Medições <Ajuda>A medição registra quanto da obra foi executado até a data de corte, a partir do avanço das etapas do cronograma (ponderado pelo peso de cada etapa). Enviada, ela aparece no portal para o cliente aprovar ou contestar, sem valores. Aprovada, vira a base da cobrança do período.</Ajuda></h2>
          <button className="btn-primario" disabled={emAberto} title={emAberto ? 'Envie, aguarde a resposta ou cancele a medição em aberto antes de gerar outra.' : undefined} onClick={() => setNova(true)}>
            <Icone nome="mais" /> Gerar medição
          </button>
        </div>
        <div className="grid grid-kpi">
          <div className="kpi"><div className="rotulo">Último avanço aprovado</div><div className="valor">{pct(ultimaAprovada?.percentual_atual ?? 0)}</div><div className="det">{ultimaAprovada ? `Medição nº ${ultimaAprovada.numero} · ${formatarData(ultimaAprovada.data_corte)}` : 'Nenhuma medição aprovada'}</div></div>
          <div className="kpi"><div className="rotulo">Medições aprovadas</div><div className="valor">{aprovadas.length}</div><div className="det">{dados.medicoes.filter((m) => m.estado === 'contestada').length} contestada(s)</div></div>
          {podeFinanceiro && <div className="kpi destaque"><div className="rotulo">Valor medido aprovado</div><div className="valor">{formatar(medidoAprovado)}</div><div className="det">Contratado × avanço de cada período</div></div>}
        </div>
        {!dados.comPortal && (
          <div className="aviso" style={{ marginTop: 12 }}><Icone nome="alerta" /><span>Nenhum cliente tem link ativo do portal desta obra. Gere o link na aba “Portal do cliente” para ele conseguir aprovar a medição.</span></div>
        )}
      </div>

      <div className="card">
        {dados.medicoes.length === 0 ? (
          <Vazio titulo="Nenhuma medição ainda"><p>Atualize o percentual das etapas no Cronograma e gere a primeira medição na data de corte combinada com o cliente.</p></Vazio>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Nº</th><th>Corte</th><th className="right">Anterior</th><th className="right">Atual</th><th className="right">Período</th>{podeFinanceiro && <th className="right">Valor medido</th>}<th>Situação</th><th /></tr></thead>
              <tbody>
                {dados.medicoes.map((m) => {
                  const v = dados.valores.get(m.id);
                  const p = parcela(m.parcela_id);
                  return (
                    <Fragment key={m.id}>
                      <tr className="clicavel" onClick={() => setAberta(aberta === m.id ? null : m.id)}>
                        <td className="num"><b>{m.numero}</b></td>
                        <td className="num">{formatarData(m.data_corte)}</td>
                        <td className="right num">{pct(m.percentual_anterior)}</td>
                        <td className="right num"><b>{pct(m.percentual_atual)}</b></td>
                        <td className="right num">{pct(m.percentual_atual - m.percentual_anterior)}</td>
                        {podeFinanceiro && <td className="right">{v ? <Dinheiro valor={doBanco(v.valor_medido)} /> : '—'}</td>}
                        <td>
                          <span className={`selo ${ESTADO_MEDICAO[m.estado].classe}`}>{ESTADO_MEDICAO[m.estado].rotulo}</span>
                          {m.estado === 'aprovada' && podeFinanceiro && (p ? <span className="selo ok" style={{ marginLeft: 6 }}>Cobrança ligada</span> : <span className="selo alerta" style={{ marginLeft: 6 }}>Sem cobrança</span>)}
                        </td>
                        <td className="right"><span className={`seta-expandir${aberta === m.id ? ' aberta' : ''}`} aria-hidden="true">›</span></td>
                      </tr>
                      {aberta === m.id && (
                        <tr className="linha-detalhe">
                          <td colSpan={podeFinanceiro ? 8 : 7}>
                            <DetalheMedicao m={m} valores={v} parcela={p} parcelas={dados.parcelas} podeFinanceiro={podeFinanceiro} ocupado={ocupado === m.id}
                              enviar={() => {
                                if (!dados.comPortal && !window.confirm('Nenhum cliente tem link ativo do portal. Enviar mesmo assim? Ele só verá quando receber o link.')) return;
                                chamar(m.id, () => supabase.rpc('enviar_medicao', { p_id: m.id }), 'Medição enviada. O cliente já pode aprovar pelo portal.');
                              }}
                              cancelar={() => {
                                const motivo = window.prompt(`Motivo do cancelamento da medição nº ${m.numero} (fica no histórico):`);
                                if (!motivo?.trim()) return;
                                chamar(m.id, () => supabase.rpc('cancelar_medicao', { p_id: m.id, p_motivo: motivo.trim() }), 'Medição cancelada.');
                              }}
                              vincular={(id) => chamar(m.id, () => supabase.rpc('vincular_parcela_medicao', { p_id: m.id, p_parcela: id }), id ? 'Cobrança ligada à medição.' : 'Cobrança desligada.')}
                              lancar={() => setCobrar(m)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nova && <NovaMedicao obraId={obra.id} aoFechar={() => setNova(false)} aoSalvar={(id) => { setNova(false); setAberta(id); recarregar(); }} />}
      {cobrar && (
        <LancamentoForm
          tipo="receber"
          padrao={{ escopo: 'obra', obra_id: obra.id, pessoa_id: obra.cliente_id ?? '', descricao: `Medição nº ${cobrar.numero} · ${obra.nome}`, valor: doBanco(dados.valores.get(cobrar.id)?.valor_medido) }}
          aoFechar={() => setCobrar(null)}
          aoSalvar={async (lancamentoId) => {
            const m = cobrar;
            setCobrar(null);
            const { data } = await supabase.from('parcela').select('id').eq('lancamento_id', lancamentoId).order('numero').limit(1);
            const id = (data as { id: string }[] | null)?.[0]?.id;
            if (id) chamar(m.id, () => supabase.rpc('vincular_parcela_medicao', { p_id: m.id, p_parcela: id }), 'Cobrança lançada e ligada à medição.');
            else recarregar();
          }}
        />
      )}
    </div>
  );
}

function DetalheMedicao({ m, valores, parcela, parcelas, podeFinanceiro, ocupado, enviar, cancelar, vincular, lancar }: {
  m: Medicao; valores?: Valores; parcela?: VParcela; parcelas: VParcela[]; podeFinanceiro: boolean; ocupado: boolean;
  enviar: () => void; cancelar: () => void; vincular: (id: string | null) => void; lancar: () => void;
}) {
  const livres = parcelas.filter((p) => p.id === m.parcela_id || p.situacao !== 'liquidada');
  return (
    <div className="stack medicao-detalhe">
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Serviço / etapa</th><th className="right">Peso</th><th className="right">Anterior</th><th className="right">Atual</th><th className="right">No período</th></tr></thead>
          <tbody>
            {m.itens.map((i) => (
              <tr key={i.etapa_id}>
                <td>{i.etapa}<div className="muted small">{i.servico}</div></td>
                <td className="right num">{i.peso}</td>
                <td className="right num">{pct(i.anterior)}</td>
                <td className="right num">{pct(i.atual)}</td>
                <td className="right num">{pct(i.atual - i.anterior)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.observacao && <p className="small" style={{ margin: 0 }}><b>Observação ao cliente:</b> {m.observacao}</p>}
      {podeFinanceiro && valores && <p className="small muted" style={{ margin: 0 }}>Contratado na data da medição: {formatar(doBanco(valores.valor_contratado))} · medido no período: <b>{formatar(doBanco(valores.valor_medido))}</b></p>}
      {m.enviada_em && <p className="small muted" style={{ margin: 0 }}>Enviada em {formatarDataHora(m.enviada_em)} · código {m.hash?.toUpperCase()}</p>}
      {m.respondida_em && (
        <div className={`aviso ${m.estado === 'aprovada' ? 'ok' : 'erro'}`}>
          <Icone nome={m.estado === 'aprovada' ? 'check' : 'alerta'} />
          <span>{m.estado === 'aprovada' ? 'Aprovada' : 'Contestada'} por <b>{m.resposta_nome}</b> em {formatarDataHora(m.respondida_em)}{m.resposta_texto ? `: “${m.resposta_texto}”` : '.'}
            {m.estado === 'contestada' && ' Converse com o cliente, ajuste o cronograma se for o caso, cancele esta medição e gere outra.'}</span>
        </div>
      )}
      {m.estado === 'cancelada' && <p className="small muted" style={{ margin: 0 }}>Cancelada: {m.cancelada_motivo}</p>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {m.estado === 'rascunho' && <button className="btn-primario" disabled={ocupado} onClick={enviar}><Icone nome="mensagem" /> Enviar ao cliente</button>}
        {['rascunho', 'enviada', 'contestada'].includes(m.estado) && <button className="btn-link" disabled={ocupado} onClick={cancelar}>Cancelar medição</button>}
        {m.estado === 'aprovada' && podeFinanceiro && (
          <>
            <label className="campo" style={{ flex: '1 1 280px', margin: 0 }}>
              Cobrança desta medição
              <select value={m.parcela_id ?? ''} disabled={ocupado} onChange={(e) => vincular(e.target.value || null)}>
                <option value="">Nenhuma parcela ligada</option>
                {livres.map((p) => <option key={p.id} value={p.id}>{formatarData(p.vencimento)} · {p.descricao}{p.total_parcelas > 1 ? ` ${p.numero}/${p.total_parcelas}` : ''} · {formatar(doBanco(p.valor))}</option>)}
              </select>
            </label>
            {!parcela && <button className="btn-secundario" disabled={ocupado} onClick={lancar}><Icone nome="mais" /> Lançar cobrança</button>}
          </>
        )}
      </div>
    </div>
  );
}

function NovaMedicao({ obraId, aoFechar, aoSalvar }: { obraId: string; aoFechar: () => void; aoSalvar: (id: string) => void }) {
  const [data, setData] = useState(hoje());
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const r = await supabase.rpc('criar_medicao', { p_obra: obraId, p_data_corte: data, p_observacao: obs.trim() || null });
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    aoSalvar(r.data as string);
  }
  return (
    <Modal titulo="Gerar medição" aoFechar={aoFechar} rodape={<><button type="button" className="btn-link" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-medicao" disabled={salvando}>{salvando ? 'Gerando…' : 'Gerar rascunho'}</button></>}>
      <form id="form-medicao" className="stack" onSubmit={salvar}>
        <p className="muted small" style={{ margin: 0 }}>A medição usa o percentual atual de cada etapa do cronograma. Confira o Cronograma antes. Você revisa o rascunho e só depois envia ao cliente.</p>
        <label className="campo">Data de corte<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        <label className="campo">Observação ao cliente (opcional)<textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: medição referente à concretagem das vigas do 1º pavimento." /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}
