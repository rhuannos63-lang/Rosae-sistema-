import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok, novaChave, todas, useAosPoucos } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { BotaoExcluir } from '../components/Excluir';
import { doBanco, formatar, paraBanco, somar, type Centavos } from '../core/dinheiro';
import { formatarData, formatarDataHora, hoje, somarDias, somarMeses } from '../core/datas';
import { gerarComEntrada, gerarParcelas, validarPlano, type Frequencia, type ParcelaPlano } from '../core/parcelas';
import { SITUACAO, type Arquivo, type Categoria, type ContaBancaria, type Escopo, type Lancamento, type TipoConta, type VMovimento, type VParcela } from '../lib/tipos';

type FiltroSituacao = 'abertas' | 'vencida' | 'proximos' | 'liquidada' | 'todas';

export function Financeiro() {
  const [params, setParams] = useSearchParams();
  const tipo = (params.get('tipo') as TipoConta) ?? 'receber';
  const situacao = (params.get('situacao') as FiltroSituacao) ?? 'abertas';
  const [busca, setBusca] = useState('');
  const [escopo, setEscopo] = useState<'' | Escopo>('');
  const [novo, setNovo] = useState(false);
  const navegar = useNavigate();
  const mudar = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };

  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const montar = () => {
      let q = supabase.from('v_parcela').select('*').eq('tipo', tipo).order('vencimento').order('id');
      if (situacao === 'abertas') q = q.in('situacao', ['aberta', 'parcial', 'vencida']);
      else if (situacao === 'vencida') q = q.eq('situacao', 'vencida');
      else if (situacao === 'proximos') q = q.in('situacao', ['aberta', 'parcial', 'vencida']).lte('vencimento', somarDias(hoje(), 7));
      else if (situacao === 'liquidada') q = q.eq('situacao', 'liquidada');
      return q;
    };
    return (await todas<VParcela>((de, ate) => montar().range(de, ate)));
  }, [tipo, situacao]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (dados ?? []).filter((p) => (!escopo || p.escopo === escopo) && (!b || [p.descricao, p.pessoa_nome, p.obra_nome, p.codigo, p.categoria_nome, p.documento_ref].some((v) => v?.toLowerCase().includes(b))));
  }, [dados, busca, escopo]);
  const { visiveis, resta, mais } = useAosPoucos(lista);
  const totalValor = somar(lista.map((p) => doBanco(p.valor)));
  const totalSaldo = somar(lista.map((p) => doBanco(p.saldo)));
  const rotuloTipo = tipo === 'receber' ? 'a receber' : 'a pagar';

  return (
    <>
      <Topo titulo="Financeiro" sub="Contas a receber e a pagar, com parcelas. Cada pagamento registrado vira um movimento na conta.">
        <button className="btn-primario" onClick={() => setNovo(true)}><Icone nome="mais" /> Nova conta {rotuloTipo}</button>
      </Topo>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmentado" role="group" aria-label="Tipo">
            <button className={tipo === 'receber' ? 'ativo' : ''} onClick={() => mudar('tipo', 'receber')}>A receber</button>
            <button className={tipo === 'pagar' ? 'ativo' : ''} onClick={() => mudar('tipo', 'pagar')}>A pagar</button>
          </div>
          <select value={situacao} onChange={(e) => mudar('situacao', e.target.value)} style={{ width: 'auto' }} aria-label="Situação">
            <option value="abertas">Em aberto</option>
            <option value="vencida">Vencidas</option>
            <option value="proximos">Vencidas e próximos 7 dias</option>
            <option value="liquidada">Liquidadas</option>
            <option value="todas">Todas</option>
          </select>
          <select value={escopo} onChange={(e) => setEscopo(e.target.value as Escopo | '')} style={{ width: 'auto' }} aria-label="Obra ou empresa">
            <option value="">Obras e empresa</option>
            <option value="obra">Só obras</option>
            <option value="empresa">Só empresa</option>
          </select>
          <div className="spacer" />
          <input placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
        <Erro mensagem={erro} />
        {carregando && !dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio titulo={`Nenhuma conta ${rotuloTipo} neste filtro`}>
            <p>{tipo === 'receber' ? 'Lance as parcelas que os clientes vão pagar.' : 'Lance compras, parceiros e despesas da empresa.'}</p>
          </Vazio>
        ) : (
          <>
            <div className="tabela-wrap so-desktop">
              <table className="tabela">
                <thead>
                  <tr><th>Vencimento</th><th>Descrição</th><th>{tipo === 'receber' ? 'Cliente' : 'Favorecido'}</th><th>Obra / empresa</th><th className="right">Valor</th><th className="right">Saldo</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => (
                    <tr key={p.id} className="clicavel" onClick={() => navegar(`/financeiro/${p.lancamento_id}`)}>
                      <td className="num">{formatarData(p.vencimento)}</td>
                      <td>
                        {p.descricao}{p.total_parcelas > 1 && <span className="muted"> · {p.numero}/{p.total_parcelas}</span>}
                        <div className="muted small">{p.codigo} · {p.categoria_nome}</div>
                      </td>
                      <td>{p.pessoa_nome ?? '—'}</td>
                      <td>{p.escopo === 'obra' ? <span title={p.obra_nome ?? ''}>{p.obra_codigo}</span> : <span className="muted">Empresa</span>}</td>
                      <td className="right"><Dinheiro valor={doBanco(p.valor)} /></td>
                      <td className="right"><Dinheiro valor={doBanco(p.saldo)} /></td>
                      <td><span className={`selo ${SITUACAO[p.situacao].classe}`}>{SITUACAO[p.situacao].rotulo}</span></td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={4}>{lista.length} parcela(s)</td>
                    <td className="right"><Dinheiro valor={totalValor} /></td>
                    <td className="right"><Dinheiro valor={totalSaldo} /></td>
                    <td />
                  </tr>
                </tbody>
              </table>
              {resta > 0 && <button type="button" className="btn-secundario mostrar-mais" onClick={mais}>Mostrar mais {Math.min(resta, 240)} de {resta}</button>}
            </div>
            <div className="lista-cartoes">
              {visiveis.map((p) => (
                <Link key={p.id} to={`/financeiro/${p.lancamento_id}`} className="item-cartao">
                  <div>
                    <div className="titulo">{p.descricao}{p.total_parcelas > 1 && ` · ${p.numero}/${p.total_parcelas}`}</div>
                    <div className="muted small">{formatarData(p.vencimento)} · {p.pessoa_nome ?? p.categoria_nome}</div>
                  </div>
                  <div className="right">
                    <Dinheiro valor={doBanco(p.saldo)} />
                    <div><span className={`selo ${SITUACAO[p.situacao].classe}`}>{SITUACAO[p.situacao].rotulo}</span></div>
                  </div>
                </Link>
              ))}
              {resta > 0 && <button type="button" className="btn-secundario mostrar-mais" onClick={mais}>Mostrar mais {Math.min(resta, 240)} de {resta}</button>}
              <div className="muted small right">Saldo total: {formatar(totalSaldo)}</div>
            </div>
          </>
        )}
      </div>
      {novo && <LancamentoForm tipo={tipo} aoFechar={() => setNovo(false)} aoSalvar={(id) => { setNovo(false); recarregar(); navegar(`/financeiro/${id}`); }} />}
    </>
  );
}

// ---------------------------------------------------------------------
// Formulário de conta a receber / a pagar
// ---------------------------------------------------------------------

type Padrao = { escopo?: Escopo; obra_id?: string; pessoa_id?: string; servico_id?: string; contratacao_id?: string; descricao?: string; categoria_id?: string; valor?: Centavos | null };
type LinhaRateio = { obra_id: string; servico_id: string; valor: Centavos | null };
type ModoParcelas = 'unica' | 'iguais' | 'entrada' | 'manual';

export function LancamentoForm({ tipo, lancamento, parcelasAtuais, temMovimento, padrao, aoFechar, aoSalvar }: {
  tipo: TipoConta; lancamento?: Lancamento; parcelasAtuais?: VParcela[]; temMovimento?: boolean; padrao?: Padrao;
  aoFechar: () => void; aoSalvar: (id: string) => void;
}) {
  const toast = useToast();
  const apoio = useConsulta(async () => {
    const [cat, pes, obr] = await Promise.all([
      supabase.from('categoria').select('*').eq('tipo', tipo).eq('ativo', true).order('ordem'),
      todas((de, ate) => supabase.from('pessoa').select('id, nome, eh_cliente, eh_prestador, eh_fornecedor').eq('arquivado', false).order('nome').order('id').range(de, ate)).then((data) => ({ data, error: null })),
      supabase.from('obra').select('id, codigo, nome, status').eq('arquivado', false).order('criado_em', { ascending: false }),
    ]);
    return {
      categorias: ok(cat) as Categoria[],
      pessoas: ok(pes) as { id: string; nome: string; eh_cliente: boolean; eh_prestador: boolean; eh_fornecedor: boolean }[],
      obras: ok(obr) as { id: string; codigo: string; nome: string; status: string }[],
    };
  }, [tipo]);

  const [descricao, setDescricao] = useState(lancamento?.descricao ?? padrao?.descricao ?? '');
  const [categoriaId, setCategoriaId] = useState(lancamento?.categoria_id ?? padrao?.categoria_id ?? '');
  const [pessoaId, setPessoaId] = useState(lancamento?.pessoa_id ?? padrao?.pessoa_id ?? '');
  const [escopo, setEscopo] = useState<Escopo>(lancamento?.escopo ?? padrao?.escopo ?? (tipo === 'receber' ? 'obra' : 'empresa'));
  const [obraId, setObraId] = useState(lancamento?.obra_id ?? padrao?.obra_id ?? '');
  const [servicoId, setServicoId] = useState(lancamento?.servico_id ?? padrao?.servico_id ?? '');
  const contratacaoId = lancamento?.contratacao_id ?? padrao?.contratacao_id ?? null;
  const [ratear, setRatear] = useState(false);
  const [rateio, setRateio] = useState<LinhaRateio[]>([]);
  useEffect(() => {
    if (!lancamento) return;
    supabase.from('lancamento_rateio').select('obra_id, servico_id, valor').eq('lancamento_id', lancamento.id).then(({ data }) => {
      const l = (data ?? []) as { obra_id: string; servico_id: string | null; valor: string }[];
      if (l.length) { setRatear(true); setRateio(l.map((x) => ({ obra_id: x.obra_id, servico_id: x.servico_id ?? '', valor: doBanco(x.valor) }))); }
    });
  }, [lancamento]);
  const [total, setTotal] = useState<Centavos | null>(lancamento ? doBanco(lancamento.valor_total) : padrao?.valor ?? null);
  const [competencia, setCompetencia] = useState(lancamento?.data_competencia ?? hoje());
  const [documento, setDocumento] = useState(lancamento?.documento_ref ?? '');
  const [obs, setObs] = useState(lancamento?.observacoes ?? '');
  const [modo, setModo] = useState<ModoParcelas>(parcelasAtuais?.length ? 'manual' : 'unica');
  const [qtd, setQtd] = useState(3);
  const [freq, setFreq] = useState<Frequencia>('mensal');
  const [primeiro, setPrimeiro] = useState(parcelasAtuais?.[0]?.vencimento ?? hoje());
  const [entrada, setEntrada] = useState<Centavos | null>(null);
  const [manual, setManual] = useState<ParcelaPlano[]>(
    parcelasAtuais?.map((p) => ({ numero: p.numero, valor: doBanco(p.valor), vencimento: p.vencimento })) ?? [],
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const servicos = useConsulta(async () => (obraId ? (ok(await supabase.from('servico').select('id, nome').eq('obra_id', obraId).order('nome')) as { id: string; nome: string }[]) : []), [obraId]);

  const plano: ParcelaPlano[] | string = useMemo(() => {
    if (!total || total <= 0) return 'Informe o valor total.';
    try {
      if (modo === 'unica') return [{ numero: 1, valor: total, vencimento: primeiro }];
      if (modo === 'iguais') return gerarParcelas(total, qtd, primeiro, freq);
      if (modo === 'entrada') return entrada ? gerarComEntrada(total, entrada, qtd, competencia, primeiro) : 'Informe o valor da entrada.';
      return manual;
    } catch (e) {
      return (e as Error).message;
    }
  }, [total, modo, qtd, freq, primeiro, entrada, manual, competencia]);

  const pessoasFiltradas = (apoio.dados?.pessoas ?? []).filter((p) => (tipo === 'receber' ? p.eh_cliente : p.eh_prestador || p.eh_fornecedor) || p.id === pessoaId);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!categoriaId) return setErro('Escolha a categoria.');
    if (escopo === 'obra' && !obraId) return setErro('Escolha a obra ou marque como despesa/receita da empresa.');
    if (typeof plano === 'string') return setErro(plano);
    if (ratear) {
      if (rateio.length < 2 || rateio.some((r) => !r.obra_id || !r.valor)) return setErro('No rateio, informe obra e valor de cada parte (pelo menos duas).');
      const soma = rateio.reduce((a, r) => a + (r.valor ?? 0), 0);
      if (soma !== total) return setErro(`O rateio soma ${formatar(soma)}, mas o total é ${formatar(total ?? 0)}.`);
    }
    const problema = validarPlano(total!, plano);
    if (problema) return setErro(problema);
    setSalvando(true);
    const payload = {
      tipo, descricao: descricao.trim(), pessoa_id: pessoaId || null, categoria_id: categoriaId, escopo,
      obra_id: escopo === 'obra' ? obraId : null, servico_id: escopo === 'obra' && servicoId ? servicoId : null,
      valor_total: paraBanco(total!), data_competencia: competencia, documento_ref: documento.trim() || null, observacoes: obs.trim() || null,
      parcelas: plano.map((p) => ({ numero: p.numero, valor: paraBanco(p.valor), vencimento: p.vencimento })),
      contratacao_id: contratacaoId,
      rateio: ratear && escopo === 'obra' ? rateio.map((r) => ({ obra_id: r.obra_id, servico_id: r.servico_id || null, valor: paraBanco(r.valor ?? 0) })) : [],
    };
    const { data, error } = await supabase.rpc('salvar_lancamento', { p: payload, p_id: lancamento?.id ?? null });
    setSalvando(false);
    if (error) return setErro(mensagemErro(error));
    toast(lancamento ? 'Lançamento atualizado.' : 'Lançamento criado.');
    aoSalvar(data as string);
  }

  const bloqueado = Boolean(temMovimento);

  return (
    <Modal
      largo
      titulo={lancamento ? `Editar ${lancamento.codigo}` : tipo === 'receber' ? 'Nova conta a receber' : 'Nova conta a pagar'}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button>
          <button className="btn-primario" form="form-lanc" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <form id="form-lanc" className="stack" onSubmit={salvar}>
        <Erro mensagem={apoio.erro} />
        <label className="campo">
          Descrição
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} required autoFocus placeholder={tipo === 'receber' ? 'Ex.: Contrato reforma cozinha' : 'Ex.: Cimento e areia, Parceiro pedreiro etapa 1'} />
        </label>
        <div className="grid grid-2">
          <label className="campo">
            Valor total
            {bloqueado ? <input value={formatar(total ?? 0)} disabled /> : <CampoValor valor={total} aoMudar={setTotal} obrigatorio />}
            {bloqueado && <span className="dica">Já há pagamento registrado: o valor não muda. Estorne os movimentos ou crie um lançamento complementar.</span>}
          </label>
          <label className="campo">
            Categoria
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
              <option value="">Escolha…</option>
              {(apoio.dados?.categorias ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>De quem é este valor?</legend>
          <div className="row" style={{ gap: 18 }}>
            <label className="check"><input type="radio" name="escopo" checked={escopo === 'obra'} onChange={() => setEscopo('obra')} /> De uma obra</label>
            <label className="check"><input type="radio" name="escopo" checked={escopo === 'empresa'} onChange={() => setEscopo('empresa')} /> Da empresa</label>
          </div>
          {escopo === 'obra' && (
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <label className="campo">
                Obra
                <select value={obraId} onChange={(e) => { setObraId(e.target.value); setServicoId(''); }} required>
                  <option value="">Escolha…</option>
                  {(apoio.dados?.obras ?? []).map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
                </select>
              </label>
              <label className="campo">
                Serviço (opcional)
                <select value={servicoId} onChange={(e) => setServicoId(e.target.value)} disabled={!obraId}>
                  <option value="">Obra inteira</option>
                  {(servicos.dados ?? []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </label>
            </div>
          )}
          {escopo === 'obra' && !contratacaoId && (
            <label className="check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={ratear} onChange={(e) => {
                setRatear(e.target.checked);
                if (e.target.checked && rateio.length === 0) setRateio([{ obra_id: obraId, servico_id: servicoId, valor: total }, { obra_id: '', servico_id: '', valor: null }]);
              }} /> Dividir entre obras ou serviços (rateio)
              <Ajuda>Use quando uma mesma compra ou nota atende mais de uma obra ou serviço. A soma das partes precisa ser igual ao total; os pagamentos são distribuídos na mesma proporção.</Ajuda>
            </label>
          )}
          {escopo === 'obra' && ratear && (
            <EditorRateio linhas={rateio} aoMudar={setRateio} total={total ?? 0} obras={apoio.dados?.obras ?? []} />
          )}
          {contratacaoId && <p className="muted small" style={{ marginBottom: 0 }}>Este lançamento é um pagamento de parceiro contratado e abate o saldo da contratação.</p>}
        </fieldset>
        <div className="grid grid-2">
          <label className="campo">
            {tipo === 'receber' ? 'Cliente / pagador' : 'Fornecedor / parceiro'}
            <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value)}>
              <option value="">Não informado</option>
              {pessoasFiltradas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Competência <Ajuda>Data a que o valor se refere (quando o serviço foi feito ou a despesa aconteceu). Pode ser diferente do vencimento e do dia do pagamento.</Ajuda></span>
            <input type="date" value={competencia} onChange={(e) => setCompetencia(e.target.value)} required />
          </label>
        </div>

        <fieldset>
          <legend>Parcelas</legend>
          {bloqueado ? (
            <p className="muted small" style={{ margin: 0 }}>Com pagamento registrado, só os vencimentos podem mudar.</p>
          ) : (
            <div className="segmentado" role="group" aria-label="Forma" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              {(['unica', 'iguais', 'entrada', 'manual'] as ModoParcelas[]).map((m) => (
                <button type="button" key={m} className={modo === m ? 'ativo' : ''} onClick={() => { setModo(m); if (m === 'entrada' && primeiro <= competencia) setPrimeiro(somarMeses(competencia, 1)); if (m === 'manual' && typeof plano !== 'string' && manual.length === 0) setManual(plano); }}>
                  {{ unica: 'À vista', iguais: 'Parcelado', entrada: 'Entrada + parcelas', manual: 'Ajustar à mão' }[m]}
                </button>
              ))}
            </div>
          )}
          {!bloqueado && modo !== 'manual' && (
            <div className="grid grid-3">
              {modo === 'entrada' && (
                <label className="campo">Entrada (paga em {formatarData(competencia)})<CampoValor valor={entrada} aoMudar={setEntrada} /></label>
              )}
              {modo !== 'unica' && (
                <label className="campo">{modo === 'entrada' ? 'Parcelas do saldo' : 'Quantidade'}<input type="number" min={1} max={120} value={qtd} onChange={(e) => setQtd(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} /></label>
              )}
              <label className="campo">{modo === 'unica' ? 'Vencimento' : 'Primeiro vencimento'}<input type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} required /></label>
              {modo === 'iguais' && (
                <label className="campo">Frequência
                  <select value={freq} onChange={(e) => setFreq(e.target.value as Frequencia)}>
                    <option value="mensal">Mensal</option><option value="quinzenal">Quinzenal</option><option value="semanal">Semanal</option>
                  </select>
                </label>
              )}
            </div>
          )}
          {(modo === 'manual' || bloqueado) ? (
            <EditorParcelas plano={manual} aoMudar={setManual} total={total ?? 0} soVencimento={bloqueado} />
          ) : typeof plano === 'string' ? (
            <p className="muted small">{plano}</p>
          ) : plano.length > 1 ? (
            <div className="tabela-wrap" style={{ marginTop: 10 }}>
              <table className="tabela">
                <tbody>
                  {plano.map((p) => <tr key={p.numero}><td>{p.numero}ª</td><td className="num">{formatarData(p.vencimento)}</td><td className="right"><Dinheiro valor={p.valor} /></td></tr>)}
                </tbody>
              </table>
              <p className="muted small">Centavos que sobram na divisão ficam nas primeiras parcelas; a soma é sempre igual ao total.</p>
            </div>
          ) : null}
        </fieldset>

        <details className="avancado" open={Boolean(documento || obs)}>
          <summary>Documento e observações</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <label className="campo">Nº da nota, recibo ou contrato<input value={documento} onChange={(e) => setDocumento(e.target.value)} /></label>
            <label className="campo">Observações<textarea value={obs} onChange={(e) => setObs(e.target.value)} /></label>
          </div>
        </details>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function EditorParcelas({ plano, aoMudar, total, soVencimento }: { plano: ParcelaPlano[]; aoMudar: (p: ParcelaPlano[]) => void; total: Centavos; soVencimento: boolean }) {
  const soma = somar(plano.map((p) => p.valor));
  const atualizar = (i: number, campo: Partial<ParcelaPlano>) => aoMudar(plano.map((p, j) => (j === i ? { ...p, ...campo } : p)));
  return (
    <div className="stack" style={{ gap: 8, marginTop: 6 }}>
      {plano.map((p, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="muted small" style={{ width: 28 }}>{p.numero}ª</span>
          <input type="date" value={p.vencimento} onChange={(e) => atualizar(i, { vencimento: e.target.value })} style={{ maxWidth: 170 }} />
          {soVencimento ? <span className="num">{formatar(p.valor)}</span> : <CampoValor valor={p.valor} aoMudar={(v) => atualizar(i, { valor: v ?? 0 })} />}
          {!soVencimento && plano.length > 1 && (
            <button type="button" className="btn-link" aria-label="Remover parcela" onClick={() => aoMudar(plano.filter((_, j) => j !== i).map((x, j) => ({ ...x, numero: j + 1 })))}>
              <Icone nome="fechar" />
            </button>
          )}
        </div>
      ))}
      {!soVencimento && (
        <div className="row">
          <button type="button" className="btn-secundario" onClick={() => aoMudar([...plano, { numero: plano.length + 1, valor: Math.max(0, total - soma), vencimento: plano.at(-1)?.vencimento ?? hoje() }])}>
            <Icone nome="mais" /> Parcela
          </button>
          <span className={`small ${soma === total ? 'muted' : ''}`} style={soma !== total ? { color: 'var(--desfavoravel)' } : undefined}>
            Soma: {formatar(soma)} {soma !== total && `· falta ${formatar(total - soma)}`}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Detalhe do lançamento: parcelas, pagamentos, estornos e comprovantes
// ---------------------------------------------------------------------

export function LancamentoDetalhe() {
  const { id } = useParams();
  const { ehAdmin } = useAuth();
  const toast = useToast();
  const navegar = useNavigate();
  const [editar, setEditar] = useState(false);
  const [liquidar, setLiquidar] = useState<VParcela | null>(null);
  const [estornar, setEstornar] = useState<VMovimento | null>(null);
  const [cancelar, setCancelar] = useState(false);

  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const lanc = ok(await supabase.from('lancamento').select('*').eq('id', id!).maybeSingle()) as Lancamento | null;
    if (!lanc) return null;
    const [parc, mov, arq, aud] = await Promise.all([
      supabase.from('v_parcela').select('*').eq('lancamento_id', id!).order('numero'),
      supabase.from('v_movimento').select('*').eq('lancamento_id', id!).order('data').order('criado_em'),
      supabase.from('arquivo').select('*').eq('lancamento_id', id!).order('criado_em'),
      ehAdmin ? supabase.from('auditoria').select('id, acao, em, tabela').eq('registro_id', id!).order('em', { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    ]);
    const parcelas = ok(parc) as VParcela[];
    return { lanc, parcelas, movimentos: ok(mov) as VMovimento[], arquivos: ok(arq) as Arquivo[], historico: (ok(aud) ?? []) as { id: number; acao: string; em: string; tabela: string }[] };
  }, [id, ehAdmin]);

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados) return <Vazio titulo="Lançamento não encontrado" />;
  const { lanc, parcelas, movimentos, arquivos } = dados;
  const p0 = parcelas[0];
  const pago = somar(parcelas.map((p) => doBanco(p.pago)));
  const verbo = lanc.tipo === 'receber' ? 'Receber' : 'Pagar';

  async function baixar(a: Arquivo) {
    const { data, error } = await supabase.storage.from('documentos').createSignedUrl(a.caminho, 120);
    if (error || !data) return toast(mensagemErro(error));
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  return (
    <>
      <Topo titulo={lanc.descricao} sub={<>{lanc.codigo} · {lanc.tipo === 'receber' ? 'Conta a receber' : 'Conta a pagar'} {lanc.cancelado && <span className="selo neutro">Cancelado</span>}</>}>
        <button className="btn-secundario" onClick={() => navegar(`/financeiro?tipo=${lanc.tipo}`)}><Icone nome="voltar" /> Lista</button>
        {!lanc.cancelado && <button className="btn-secundario" onClick={() => setEditar(true)}><Icone nome="editar" /> Editar</button>}
        <BotaoExcluir tabela="lancamento" id={lanc.id} nome={lanc.descricao} aoExcluir={() => navegar(`/financeiro?tipo=${lanc.tipo}`)} />
      </Topo>
      <div className="grid grid-2">
        <div className="card">
          <dl className="dl">
            <dt>Valor total</dt><dd><b><Dinheiro valor={doBanco(lanc.valor_total)} /></b></dd>
            <dt>{lanc.tipo === 'receber' ? 'Recebido' : 'Pago'}</dt><dd><Dinheiro valor={pago} /></dd>
            <dt>Saldo</dt><dd><Dinheiro valor={doBanco(lanc.valor_total) - pago} /></dd>
            <dt>Categoria</dt><dd>{p0?.categoria_nome}</dd>
            <dt>{lanc.tipo === 'receber' ? 'Cliente' : 'Favorecido'}</dt><dd>{p0?.pessoa_nome ?? '—'}</dd>
            <dt>De quem</dt><dd>{lanc.escopo === 'obra' ? <Link to={`/obras/${lanc.obra_id}`}>{p0?.obra_codigo} · {p0?.obra_nome}</Link> : 'Empresa'}</dd>
            <dt>Competência</dt><dd>{formatarData(lanc.data_competencia)}</dd>
            {lanc.documento_ref && <><dt>Documento</dt><dd>{lanc.documento_ref}</dd></>}
            {lanc.cancelado && <><dt>Cancelamento</dt><dd>{lanc.cancelado_motivo}</dd></>}
          </dl>
          {lanc.observacoes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{lanc.observacoes}</p>}
          {!lanc.cancelado && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn-perigo" onClick={() => setCancelar(true)} disabled={pago !== 0} title={pago !== 0 ? 'Estorne os movimentos antes de cancelar' : undefined}>Cancelar lançamento</button>
            </div>
          )}
        </div>
        <Anexos lancamentoId={lanc.id} arquivos={arquivos} aoMudar={recarregar} aoBaixar={baixar} />
      </div>

      <div className="card section">
        <h2 style={{ marginBottom: 10 }}>Parcelas</h2>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Nº</th><th>Vencimento</th><th className="right">Valor</th><th className="right">{lanc.tipo === 'receber' ? 'Recebido' : 'Pago'}</th><th className="right">Saldo</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {parcelas.map((p) => (
                <tr key={p.id}>
                  <td>{p.numero}/{p.total_parcelas}</td>
                  <td className="num">{formatarData(p.vencimento)}</td>
                  <td className="right"><Dinheiro valor={doBanco(p.valor)} /></td>
                  <td className="right"><Dinheiro valor={doBanco(p.pago)} /></td>
                  <td className="right"><Dinheiro valor={doBanco(p.saldo)} /></td>
                  <td><span className={`selo ${SITUACAO[p.situacao].classe}`}>{SITUACAO[p.situacao].rotulo}</span></td>
                  <td className="right">
                    {!lanc.cancelado && doBanco(p.saldo) > 0 && <button className="btn-primario" onClick={() => setLiquidar(p)}><Icone nome="check" /> {verbo}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card section">
        <h2 style={{ marginBottom: 4 }}>Movimentos <Ajuda>Dinheiro que de fato entrou ou saiu de uma conta. Não se apaga: um erro se corrige com estorno, que fica registrado.</Ajuda></h2>
        {movimentos.length === 0 ? (
          <p className="muted">Nenhum {lanc.tipo === 'receber' ? 'recebimento' : 'pagamento'} registrado ainda.</p>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Data</th><th>Código</th><th>Conta</th><th>Descrição</th><th className="right">Valor</th><th /></tr></thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{formatarData(m.data)}</td>
                    <td className="muted small">{m.codigo}</td>
                    <td>{m.conta_nome}</td>
                    <td>{m.descricao}{m.estorno_de && <span className="selo alerta" style={{ marginLeft: 6 }}>Estorno</span>}{m.estornado && <span className="selo neutro" style={{ marginLeft: 6 }}>Estornado</span>}</td>
                    <td className="right"><Dinheiro valor={doBanco(m.valor_assinado)} sinal /></td>
                    <td className="right">{!m.estorno_de && !m.estornado && <button className="btn-link" onClick={() => setEstornar(m)}>Estornar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {ehAdmin && dados.historico.length > 0 && (
        <details className="card section avancado">
          <summary>Histórico de alterações</summary>
          <ul className="small muted">
            {dados.historico.map((h) => <li key={h.id}>{formatarDataHora(h.em)} · {h.acao === 'insert' ? 'criado' : h.acao === 'update' ? 'alterado' : 'removido'}</li>)}
          </ul>
        </details>
      )}

      {editar && <LancamentoForm tipo={lanc.tipo} lancamento={lanc} parcelasAtuais={parcelas} temMovimento={movimentos.length > 0} aoFechar={() => setEditar(false)} aoSalvar={() => { setEditar(false); recarregar(); }} />}
      {liquidar && <LiquidarModal parcela={liquidar} aoFechar={() => setLiquidar(null)} aoSalvar={() => { setLiquidar(null); recarregar(); }} />}
      {estornar && <EstornoModal movimento={estornar} aoFechar={() => setEstornar(null)} aoSalvar={() => { setEstornar(null); recarregar(); }} />}
      {cancelar && <CancelarModal lancamento={lanc} aoFechar={() => setCancelar(false)} aoSalvar={() => { setCancelar(false); recarregar(); }} />}
    </>
  );
}

function LiquidarModal({ parcela, aoFechar, aoSalvar }: { parcela: VParcela; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const contas = useConsulta(async () => ok(await supabase.from('conta_bancaria').select('*').eq('ativa', true).order('ordem')) as ContaBancaria[], []);
  const [conta, setConta] = useState('');
  const [valor, setValor] = useState<Centavos | null>(doBanco(parcela.saldo));
  const [data, setData] = useState(hoje());
  const [desc, setDesc] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Uma chave por abertura do formulário: clique duplo ou nova tentativa não duplicam o movimento.
  const [chave] = useState(novaChave);
  const receber = parcela.tipo === 'receber';
  const contaEscolhida = conta || contas.dados?.[0]?.id || '';

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valor || valor <= 0) return setErro('Informe o valor.');
    if (valor > doBanco(parcela.saldo)) return setErro(`O valor passa do saldo da parcela (${formatar(doBanco(parcela.saldo))}).`);
    setSalvando(true);
    setErro(null);
    const { data: movId, error } = await supabase.rpc('registrar_liquidacao', {
      p_parcela: parcela.id, p_conta: contaEscolhida, p_valor: paraBanco(valor), p_data: data, p_descricao: desc.trim() || null, p_chave: chave,
    });
    if (error) { setSalvando(false); return setErro(mensagemErro(error)); }
    if (arquivo) {
      const r = await enviarArquivo(arquivo, { lancamento_id: parcela.lancamento_id, movimento_id: movId as string, natureza: 'comprovante' });
      if (r) { setSalvando(false); toast('Movimento registrado.'); setErro(`O movimento foi registrado, mas o comprovante não foi enviado: ${r}. Anexe de novo na tela do lançamento.`); return; }
    }
    setSalvando(false);
    toast(receber ? 'Recebimento registrado.' : 'Pagamento registrado.');
    aoSalvar();
  }

  return (
    <Modal
      titulo={receber ? 'Registrar recebimento' : 'Registrar pagamento'}
      aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-liq" disabled={salvando}>{salvando ? 'Registrando…' : 'Confirmar'}</button></>}
    >
      <form id="form-liq" className="stack" onSubmit={salvar}>
        <div className="aviso info"><span>{parcela.descricao} · parcela {parcela.numero}/{parcela.total_parcelas} · saldo {formatar(doBanco(parcela.saldo))}</span></div>
        <div className="grid grid-2">
          <label className="campo">Valor {receber ? 'recebido' : 'pago'}<CampoValor valor={valor} aoMudar={setValor} obrigatorio autoFocus /></label>
          <label className="campo">Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        </div>
        <label className="campo">
          {receber ? 'Entrou em qual conta?' : 'Saiu de qual conta?'}
          <select value={contaEscolhida} onChange={(e) => setConta(e.target.value)} required>
            {(contas.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.instituicao ? ` (${c.instituicao})` : ''}</option>)}
          </select>
        </label>
        <label className="campo">Forma / observação<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="PIX, transferência, boleto, dinheiro…" /></label>
        <label className="campo">
          Comprovante (opcional)
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          <span className="dica">Foto ou PDF, até 10 MB. Fica guardado em área privada.</span>
        </label>
        {valor !== null && valor < doBanco(parcela.saldo) && <p className="muted small" style={{ margin: 0 }}>Pagamento parcial: a parcela continua em aberto com o restante.</p>}
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function EstornoModal({ movimento, aoFechar, aoSalvar }: { movimento: VMovimento; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState(hoje());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const { error } = await supabase.rpc('estornar_movimento', { p_movimento: movimento.id, p_data: data, p_motivo: motivo.trim() });
    setSalvando(false);
    if (error) return setErro(mensagemErro(error));
    toast('Estorno registrado.');
    aoSalvar();
  }
  return (
    <Modal titulo="Estornar movimento" aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Voltar</button><button className="btn-perigo" form="form-est" disabled={salvando}>Confirmar estorno</button></>}>
      <form id="form-est" className="stack" onSubmit={salvar}>
        <p style={{ margin: 0 }}>Será criado um movimento inverso de <b>{formatar(doBanco(movimento.valor))}</b> na conta {movimento.conta_nome}. O original continua no histórico.</p>
        <label className="campo">Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required autoFocus placeholder="Ex.: valor lançado errado" /></label>
        <label className="campo">Data do estorno<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function CancelarModal({ lancamento, aoFechar, aoSalvar }: { lancamento: Lancamento; aoFechar: () => void; aoSalvar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('cancelar_lancamento', { p_id: lancamento.id, p_motivo: motivo.trim() });
    if (error) return setErro(mensagemErro(error));
    aoSalvar();
  }
  return (
    <Modal titulo={`Cancelar ${lancamento.codigo}`} aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Voltar</button><button className="btn-perigo" form="form-canc">Cancelar lançamento</button></>}>
      <form id="form-canc" className="stack" onSubmit={salvar}>
        <p style={{ margin: 0 }}>O lançamento sai dos totais, mas continua registrado com o motivo. Não pode ser reaberto.</p>
        <label className="campo">Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required autoFocus /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Anexos (Storage privado + tabela arquivo)
// ---------------------------------------------------------------------

const LIMITE_ARQUIVO = 10 * 1024 * 1024;

async function enviarArquivo(arquivo: File, vinculo: { lancamento_id: string; movimento_id?: string; natureza: string }): Promise<string | null> {
  if (arquivo.size > LIMITE_ARQUIVO) return 'arquivo maior que 10 MB';
  if (!/^image\/|^application\/pdf$/.test(arquivo.type)) return 'envie imagem ou PDF';
  const nomeSeguro = arquivo.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
  const caminho = `financeiro/${vinculo.lancamento_id}/${crypto.randomUUID()}-${nomeSeguro}`;
  const up = await supabase.storage.from('documentos').upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (up.error) return mensagemErro(up.error);
  const reg = await supabase.from('arquivo').insert({
    caminho, nome_original: arquivo.name, mime: arquivo.type, tamanho: arquivo.size, natureza: vinculo.natureza,
    lancamento_id: vinculo.lancamento_id, movimento_id: vinculo.movimento_id ?? null,
  });
  return reg.error ? mensagemErro(reg.error) : null;
}

function Anexos({ lancamentoId, arquivos, aoMudar, aoBaixar }: { lancamentoId: string; arquivos: Arquivo[]; aoMudar: () => void; aoBaixar: (a: Arquivo) => void }) {
  const [natureza, setNatureza] = useState('nota_fiscal');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar(f: File | undefined) {
    if (!f) return;
    setEnviando(true);
    const r = await enviarArquivo(f, { lancamento_id: lancamentoId, natureza });
    setEnviando(false);
    setErro(r);
    if (!r) aoMudar();
  }
  const rotulo: Record<string, string> = { comprovante: 'Comprovante', nota_fiscal: 'Nota fiscal', recibo: 'Recibo', contrato: 'Contrato', outro: 'Outro' };
  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Notas e comprovantes</h2>
      <p className="muted small" style={{ marginTop: 0 }}>A nota prova a compra e o comprovante prova o pagamento. Eles se ligam ao lançamento e nunca somam o valor de novo.</p>
      {arquivos.length === 0 ? <p className="muted small">Nenhum arquivo anexado.</p> : (
        <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
          {arquivos.map((a) => (
            <button key={a.id} className="chip-link" style={{ fontWeight: 400 }} onClick={() => aoBaixar(a)}>
              <Icone nome="anexo" /> {a.nome_original} <span className="muted small">· {rotulo[a.natureza]} · {formatarDataHora(a.criado_em)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <select value={natureza} onChange={(e) => setNatureza(e.target.value)} style={{ width: 'auto' }} aria-label="Tipo do arquivo">
          {Object.entries(rotulo).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="btn btn-secundario">
          <Icone nome="anexo" /> {enviando ? 'Enviando…' : 'Anexar arquivo'}
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => enviar(e.target.files?.[0])} disabled={enviando} />
        </label>
      </div>
      <Erro mensagem={erro} />
    </div>
  );
}

function EditorRateio({ linhas, aoMudar, total, obras }: { linhas: LinhaRateio[]; aoMudar: (l: LinhaRateio[]) => void; total: Centavos; obras: { id: string; codigo: string; nome: string }[] }) {
  const ids = Array.from(new Set(linhas.map((l) => l.obra_id).filter(Boolean)));
  const servicos = useConsulta(async () => (ids.length ? (ok(await supabase.from('servico').select('id, nome, obra_id').in('obra_id', ids).order('nome')) as { id: string; nome: string; obra_id: string }[]) : []), [ids.join()]);
  const soma = linhas.reduce((a, l) => a + (l.valor ?? 0), 0);
  const set = (i: number, m: Partial<LinhaRateio>) => aoMudar(linhas.map((l, j) => (j === i ? { ...l, ...m } : l)));
  return (
    <div className="stack" style={{ marginTop: 10, gap: 8 }}>
      {linhas.map((l, i) => (
        <div key={i} className="linha-valores">
          <label className="campo" style={{ flex: 2 }}>Obra
            <select value={l.obra_id} onChange={(e) => set(i, { obra_id: e.target.value, servico_id: '' })}>
              <option value="">Escolha…</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
            </select>
          </label>
          <label className="campo" style={{ flex: 2 }}>Serviço
            <select value={l.servico_id} onChange={(e) => set(i, { servico_id: e.target.value })} disabled={!l.obra_id}>
              <option value="">Obra inteira</option>
              {(servicos.dados ?? []).filter((s) => s.obra_id === l.obra_id).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
          <label className="campo" style={{ flex: 1 }}>Valor<CampoValor valor={l.valor} aoMudar={(v) => set(i, { valor: v })} /></label>
          {linhas.length > 2 && <button type="button" className="btn-link" aria-label="Remover parte" onClick={() => aoMudar(linhas.filter((_, j) => j !== i))}><Icone nome="fechar" /></button>}
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn-secundario" onClick={() => aoMudar([...linhas, { obra_id: '', servico_id: '', valor: total - soma > 0 ? total - soma : null }])}><Icone nome="mais" /> Parte</button>
        <span className="small" style={{ color: soma === total ? 'var(--favoravel)' : 'var(--desfavoravel)' }}>
          Soma {formatar(soma)} de {formatar(total)}{soma === total ? ' · confere' : ` · diferença ${formatar(total - soma)}`}
        </span>
      </div>
    </div>
  );
}
