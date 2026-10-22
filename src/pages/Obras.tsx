import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarData } from '../core/datas';
import { MODELO_CONTRATACAO, SITUACAO, STATUS_OBRA, TIPOS_SERVICO, type Obra, type ObraFinanceiro, type Pessoa, type StatusObra, type VParcela } from '../lib/tipos';
import { PessoaForm } from './Pessoas';
import { LancamentoForm } from './Financeiro';

const ATIVAS: StatusObra[] = ['contratada', 'em_execucao'];

function seloStatus(s: StatusObra) {
  const cls = s === 'cancelada' ? 'neutro' : ATIVAS.includes(s) ? 'ok' : s === 'em_negociacao' || s === 'aprovada' ? 'alerta' : '';
  return <span className={`selo ${cls}`}>{STATUS_OBRA[s]}</span>;
}

export function Obras() {
  const { podeFinanceiro } = useAuth();
  const [params] = useSearchParams();
  const filtroContratadas = params.get('contratadas') ? { inicio: params.get('inicio')!, fim: params.get('fim')! } : null;
  const [mostrar, setMostrar] = useState<'ativas' | 'todas'>(filtroContratadas ? 'todas' : 'ativas');
  const [nova, setNova] = useState(false);
  const navegar = useNavigate();
  const { dados, erro, carregando } = useConsulta(async () => {
    const obras = ok(await supabase.from('obra').select('*, cliente:pessoa(nome)').order('criado_em', { ascending: false })) as Obra[];
    const fin = podeFinanceiro ? (ok(await supabase.from('obra_financeiro').select('*')) as ObraFinanceiro[]) : [];
    return { obras, fin: new Map(fin.map((f) => [f.obra_id, f])) };
  }, [podeFinanceiro]);

  const lista = (dados?.obras ?? []).filter((o) => {
    if (filtroContratadas) {
      const f = dados?.fin.get(o.id);
      return o.status !== 'cancelada' && f?.data_contratacao && f.data_contratacao >= filtroContratadas.inicio && f.data_contratacao <= filtroContratadas.fim;
    }
    return mostrar === 'todas' ? !o.arquivado : !o.arquivado && o.status !== 'cancelada' && o.status !== 'encerrada_financeiramente';
  });
  const totalContratado = filtroContratadas ? lista.reduce((a, o) => a + doBanco(dados?.fin.get(o.id)?.valor_contratado), 0) : 0;

  return (
    <>
      <Topo titulo="Obras" sub="Cada obra ou trabalho só de projeto. Ambientes, serviços e financeiro ficam dentro dela.">
        <button className="btn-primario" onClick={() => setNova(true)}><Icone nome="mais" /> Nova obra</button>
      </Topo>
      {filtroContratadas && (
        <div className="aviso info" style={{ marginBottom: 14 }}>
          <span>
            Obras contratadas entre {formatarData(filtroContratadas.inicio)} e {formatarData(filtroContratadas.fim)}: <b>{formatar(totalContratado)}</b>. Esta lista explica o número "Vendido" do painel.{' '}
            <Link to="/obras">Ver todas</Link>
          </span>
        </div>
      )}
      <div className="card">
        {!filtroContratadas && (
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="segmentado">
              <button className={mostrar === 'ativas' ? 'ativo' : ''} onClick={() => setMostrar('ativas')}>Em andamento</button>
              <button className={mostrar === 'todas' ? 'ativo' : ''} onClick={() => setMostrar('todas')}>Todas</button>
            </div>
          </div>
        )}
        <Erro mensagem={erro} />
        {carregando && !dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio titulo="Nenhuma obra aqui">
            <p>Cadastre a obra atual para lançar recebimentos e custos ligados a ela.</p>
          </Vazio>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {lista.map((o) => {
              const f = dados?.fin.get(o.id);
              return (
                <Link key={o.id} to={`/obras/${o.id}`} className="item-cartao">
                  <div>
                    <div className="titulo">{o.nome}</div>
                    <div className="muted small">
                      {o.codigo} · {o.cliente?.nome ?? 'sem cliente'}{o.tipo_servico ? ` · ${o.tipo_servico}` : ''}
                    </div>
                  </div>
                  <div className="right">
                    {seloStatus(o.status)}
                    {f && <div className="num small" style={{ marginTop: 4 }}>{formatar(doBanco(f.valor_contratado))}</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {nova && <ObraForm obra={null} aoFechar={() => setNova(false)} aoSalvar={(id) => navegar(`/obras/${id}`)} />}
    </>
  );
}

type FormObra = {
  nome: string; cliente_id: string; tipo_servico: string; endereco: string; status: StatusObra;
  data_inicio: string; data_previsao_fim: string; data_conclusao: string; observacoes: string;
  modelo_contratacao: string; valor_contratado: Centavos | null; data_contratacao: string;
};

function ObraForm({ obra, financeiro, aoFechar, aoSalvar }: { obra: Obra | null; financeiro?: ObraFinanceiro | null; aoFechar: () => void; aoSalvar: (id: string) => void }) {
  const { podeFinanceiro } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<FormObra>({
    nome: obra?.nome ?? '', cliente_id: obra?.cliente_id ?? '', tipo_servico: obra?.tipo_servico ?? '', endereco: obra?.endereco ?? '',
    status: obra?.status ?? 'contratada', data_inicio: obra?.data_inicio ?? '', data_previsao_fim: obra?.data_previsao_fim ?? '',
    data_conclusao: obra?.data_conclusao ?? '', observacoes: obra?.observacoes ?? '',
    modelo_contratacao: financeiro?.modelo_contratacao ?? 'preco_fechado',
    valor_contratado: financeiro ? doBanco(financeiro.valor_contratado) : null,
    data_contratacao: financeiro?.data_contratacao ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoCliente, setNovoCliente] = useState(false);
  const set = <K extends keyof FormObra>(k: K, v: FormObra[K]) => setF((x) => ({ ...x, [k]: v }));
  const clientes = useConsulta(async () => ok(await supabase.from('pessoa').select('id, nome').eq('arquivado', false).eq('eh_cliente', true).order('nome')) as Pick<Pessoa, 'id' | 'nome'>[], []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    const dadosObra = {
      nome: f.nome.trim(), cliente_id: f.cliente_id || null, tipo_servico: f.tipo_servico || null, endereco: f.endereco.trim() || null,
      status: f.status, data_inicio: f.data_inicio || null, data_previsao_fim: f.data_previsao_fim || null,
      data_conclusao: f.data_conclusao || null, observacoes: f.observacoes.trim() || null,
    };
    const r = obra
      ? await supabase.from('obra').update(dadosObra).eq('id', obra.id).select('id').single()
      : await supabase.from('obra').insert(dadosObra).select('id').single();
    if (r.error) { setSalvando(false); return setErro(mensagemErro(r.error)); }
    const id = (r.data as { id: string }).id;
    if (podeFinanceiro && (f.valor_contratado !== null || financeiro)) {
      const rf = await supabase.from('obra_financeiro').upsert({
        obra_id: id, modelo_contratacao: f.modelo_contratacao || null,
        valor_contratado: paraBanco(f.valor_contratado ?? 0), data_contratacao: f.data_contratacao || null,
      });
      if (rf.error) { setSalvando(false); return setErro(`A obra foi salva, mas o valor do contrato não: ${mensagemErro(rf.error)}`); }
    }
    setSalvando(false);
    toast(obra ? 'Obra atualizada.' : 'Obra cadastrada.');
    aoSalvar(id);
  }

  return (
    <Modal
      titulo={obra ? `Editar ${obra.codigo}` : 'Nova obra'}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button>
          <button className="btn-primario" form="form-obra" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <form id="form-obra" className="stack" onSubmit={salvar}>
        <label className="campo">
          Nome da obra
          <span className="dica">Ex.: Reforma cozinha Silva, Projeto estrutural casa Itaipu</span>
          <input value={f.nome} onChange={(e) => set('nome', e.target.value)} required autoFocus />
        </label>
        <div className="grid grid-2">
          <label className="campo">
            Cliente
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={f.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                <option value="">Sem cliente</option>
                {(clientes.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <button type="button" className="btn-secundario" onClick={() => setNovoCliente(true)} aria-label="Novo cliente"><Icone nome="mais" /></button>
            </div>
          </label>
          <label className="campo">
            Tipo de serviço
            <input list="tipos-servico" value={f.tipo_servico} onChange={(e) => set('tipo_servico', e.target.value)} />
            <datalist id="tipos-servico">{TIPOS_SERVICO.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
        </div>
        <label className="campo">
          Local da obra
          <input value={f.endereco} onChange={(e) => set('endereco', e.target.value)} placeholder="Endereço ou bairro, cidade" />
        </label>
        <div className="grid grid-2">
          <label className="campo">
            Situação
            <select value={f.status} onChange={(e) => set('status', e.target.value as StatusObra)}>
              {Object.entries(STATUS_OBRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="campo">
            Início
            <input type="date" value={f.data_inicio} onChange={(e) => set('data_inicio', e.target.value)} />
          </label>
          <label className="campo">
            Previsão de término
            <input type="date" value={f.data_previsao_fim} onChange={(e) => set('data_previsao_fim', e.target.value)} />
          </label>
          {(f.status === 'concluida_fisicamente' || f.status === 'encerrada_financeiramente') && (
            <label className="campo">
              Conclusão física
              <input type="date" value={f.data_conclusao} onChange={(e) => set('data_conclusao', e.target.value)} />
            </label>
          )}
        </div>
        {podeFinanceiro && (
          <fieldset>
            <legend>Contrato (só quem tem acesso ao financeiro vê)</legend>
            <div className="grid grid-3">
              <label className="campo">
                Modelo
                <select value={f.modelo_contratacao} onChange={(e) => set('modelo_contratacao', e.target.value)}>
                  {Object.entries(MODELO_CONTRATACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="campo">
                Valor contratado
                <CampoValor valor={f.valor_contratado} aoMudar={(v) => set('valor_contratado', v)} />
              </label>
              <label className="campo">
                Data da contratação
                <input type="date" value={f.data_contratacao} onChange={(e) => set('data_contratacao', e.target.value)} />
              </label>
            </div>
            <p className="muted small" style={{ margin: '8px 0 0' }}>O valor contratado entra no "Vendido" do painel na data da contratação. Na Etapa 2 ele virá da proposta aprovada.</p>
          </fieldset>
        )}
        <label className="campo">
          Observações
          <textarea value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
        </label>
        <Erro mensagem={erro} />
      </form>
      {novoCliente && (
        <PessoaForm
          pessoa={null}
          padrao={{ eh_cliente: true }}
          aoFechar={() => setNovoCliente(false)}
          aoSalvar={async (p) => { setNovoCliente(false); await clientes.recarregar(); set('cliente_id', p.id); }}
        />
      )}
    </Modal>
  );
}

type Ambiente = { id: string; nome: string; ordem: number };
type Servico = { id: string; nome: string; descricao: string | null; ordem: number; arquivado: boolean };

export function ObraDetalhe() {
  const { id } = useParams();
  const { podeFinanceiro } = useAuth();
  const [editar, setEditar] = useState(false);
  const [novoLanc, setNovoLanc] = useState<'receber' | 'pagar' | null>(null);
  const navegar = useNavigate();
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const obra = ok(await supabase.from('obra').select('*, cliente:pessoa(nome, telefone, email)').eq('id', id!).maybeSingle()) as (Obra & { cliente: { nome: string; telefone: string | null; email: string | null } | null }) | null;
    const [amb, serv, sa] = await Promise.all([
      supabase.from('ambiente').select('*').eq('obra_id', id!).order('ordem').order('nome'),
      supabase.from('servico').select('*').eq('obra_id', id!).order('ordem').order('nome'),
      supabase.from('servico_ambiente').select('*, servico!inner(obra_id)').eq('servico.obra_id', id!),
    ]);
    let fin: { financeiro: ObraFinanceiro | null; resumo: Record<string, string> | null; parcelas: VParcela[] } = { financeiro: null, resumo: null, parcelas: [] };
    if (podeFinanceiro) {
      const [f, r, p] = await Promise.all([
        supabase.from('obra_financeiro').select('*').eq('obra_id', id!).maybeSingle(),
        supabase.rpc('resumo_obra', { p_obra: id }),
        supabase.from('v_parcela').select('*').eq('obra_id', id!).order('vencimento'),
      ]);
      fin = { financeiro: ok(f) as ObraFinanceiro | null, resumo: ok(r) as Record<string, string>, parcelas: ok(p) as VParcela[] };
    }
    return {
      obra, ambientes: ok(amb) as Ambiente[], servicos: ok(serv) as Servico[],
      ligacoes: (ok(sa) as { servico_id: string; ambiente_id: string }[]) ?? [], ...fin,
    };
  }, [id, podeFinanceiro]);

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados?.obra) return <Vazio titulo="Obra não encontrada ou sem acesso" />;
  const { obra, resumo, parcelas } = dados;
  const r = (k: string) => doBanco(resumo?.[k]);

  return (
    <>
      <Topo titulo={obra.nome} sub={<>{obra.codigo} · {seloStatus(obra.status)}</>}>
        <button className="btn-secundario" onClick={() => navegar('/obras')}><Icone nome="voltar" /> Obras</button>
        <button className="btn-secundario" onClick={() => setEditar(true)}><Icone nome="editar" /> Editar</button>
      </Topo>

      <div className="grid grid-2">
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Dados da obra</h2>
          <dl className="dl">
            <dt>Cliente</dt><dd>{obra.cliente?.nome ?? '—'}{obra.cliente?.telefone ? ` · ${obra.cliente.telefone}` : ''}</dd>
            <dt>Serviço</dt><dd>{obra.tipo_servico ?? '—'}</dd>
            <dt>Local</dt><dd>{obra.endereco ?? '—'}</dd>
            <dt>Início</dt><dd>{formatarData(obra.data_inicio) || '—'}</dd>
            <dt>Previsão</dt><dd>{formatarData(obra.data_previsao_fim) || '—'}</dd>
            {podeFinanceiro && dados.financeiro && (
              <>
                <dt>Contrato</dt>
                <dd>{MODELO_CONTRATACAO[dados.financeiro.modelo_contratacao ?? ''] ?? '—'} · <Dinheiro valor={doBanco(dados.financeiro.valor_contratado)} /> {dados.financeiro.data_contratacao && <span className="muted">em {formatarData(dados.financeiro.data_contratacao)}</span>}</dd>
              </>
            )}
          </dl>
          {obra.observacoes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{obra.observacoes}</p>}
        </div>
        <AmbientesServicos obraId={obra.id} ambientes={dados.ambientes} servicos={dados.servicos} ligacoes={dados.ligacoes} aoMudar={recarregar} />
      </div>

      {podeFinanceiro && resumo && (
        <div className="section">
          <div className="topo" style={{ marginBottom: 12 }}>
            <h2>Financeiro da obra <Ajuda>Números gerenciais desta obra, a partir dos lançamentos ligados a ela. Saldo de caixa = recebido − pago nesta obra.</Ajuda></h2>
            <div className="row">
              <button className="btn-secundario" onClick={() => setNovoLanc('receber')}><Icone nome="mais" /> A receber</button>
              <button className="btn-secundario" onClick={() => setNovoLanc('pagar')}><Icone nome="mais" /> A pagar</button>
            </div>
          </div>
          <div className="grid grid-kpi">
            <div className="kpi"><div className="rotulo">Contratado</div><div className="valor">{formatar(r('valor_contratado'))}</div></div>
            <div className="kpi"><div className="rotulo">Recebido</div><div className="valor">{formatar(r('recebido'))}</div><div className="det">Lançado a receber: {formatar(r('a_receber_total'))}</div></div>
            <div className="kpi"><div className="rotulo">Pago em custos</div><div className="valor">{formatar(r('pago'))}</div><div className="det">Custos lançados: {formatar(r('custo_lancado'))}</div></div>
            <div className="kpi destaque"><div className="rotulo">Saldo de caixa da obra</div><div className="valor">{formatar(r('saldo_caixa'))}</div><div className="det">Gerencial</div></div>
          </div>
          {r('valor_contratado') > 0 && r('a_receber_total') !== r('valor_contratado') && (
            <div className="aviso" style={{ marginTop: 12 }}>
              <Icone nome="alerta" />
              <span>O total lançado a receber ({formatar(r('a_receber_total'))}) é diferente do valor contratado ({formatar(r('valor_contratado'))}). Confira se faltam parcelas.</span>
            </div>
          )}
          <div className="card" style={{ marginTop: 14 }}>
            {parcelas.length === 0 ? (
              <Vazio titulo="Nenhum lançamento nesta obra"><p>Lance as parcelas do contrato e os custos para acompanhar o caixa da obra.</p></Vazio>
            ) : (
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th className="right">Valor</th><th className="right">Saldo</th><th>Situação</th></tr></thead>
                  <tbody>
                    {parcelas.map((p) => (
                      <tr key={p.id} className="clicavel" onClick={() => navegar(`/financeiro/${p.lancamento_id}`)}>
                        <td className="num">{formatarData(p.vencimento)}</td>
                        <td>{p.descricao}{p.total_parcelas > 1 && <span className="muted"> · {p.numero}/{p.total_parcelas}</span>}<div className="muted small">{p.categoria_nome}</div></td>
                        <td>{p.tipo === 'receber' ? 'Receber' : 'Pagar'}</td>
                        <td className="right"><Dinheiro valor={doBanco(p.valor)} /></td>
                        <td className="right"><Dinheiro valor={doBanco(p.saldo)} /></td>
                        <td><span className={`selo ${SITUACAO[p.situacao].classe}`}>{SITUACAO[p.situacao].rotulo}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {editar && <ObraForm obra={obra} financeiro={dados.financeiro} aoFechar={() => setEditar(false)} aoSalvar={() => { setEditar(false); recarregar(); }} />}
      {novoLanc && (
        <LancamentoForm
          tipo={novoLanc}
          padrao={{ escopo: 'obra', obra_id: obra.id, pessoa_id: novoLanc === 'receber' ? obra.cliente_id ?? '' : '' }}
          aoFechar={() => setNovoLanc(null)}
          aoSalvar={() => { setNovoLanc(null); recarregar(); }}
        />
      )}
    </>
  );
}

function AmbientesServicos({ obraId, ambientes, servicos, ligacoes, aoMudar }: { obraId: string; ambientes: Ambiente[]; servicos: Servico[]; ligacoes: { servico_id: string; ambiente_id: string }[]; aoMudar: () => void }) {
  const [novoAmb, setNovoAmb] = useState('');
  const [novoServ, setNovoServ] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function exec(p: PromiseLike<{ error: unknown }>) {
    const { error } = await p;
    if (error) setErro(mensagemErro(error));
    else { setErro(null); aoMudar(); }
  }
  const ligado = (s: string, a: string) => ligacoes.some((l) => l.servico_id === s && l.ambiente_id === a);

  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Ambientes e serviços</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Um serviço pode atender vários ambientes sem duplicar valor. Etapas e cronograma chegam na Etapa 4.</p>
      <div className="stack" style={{ gap: 10 }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (novoAmb.trim()) exec(supabase.from('ambiente').insert({ obra_id: obraId, nome: novoAmb.trim(), ordem: ambientes.length })).then(() => setNovoAmb('')); }}>
          <input placeholder="Novo ambiente (ex.: Cozinha)" value={novoAmb} onChange={(e) => setNovoAmb(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-secundario">Adicionar</button>
        </form>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (novoServ.trim()) exec(supabase.from('servico').insert({ obra_id: obraId, nome: novoServ.trim(), ordem: servicos.length })).then(() => setNovoServ('')); }}>
          <input placeholder="Novo serviço (ex.: Troca de piso)" value={novoServ} onChange={(e) => setNovoServ(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-secundario">Adicionar</button>
        </form>
        <Erro mensagem={erro} />
        {servicos.length === 0 && ambientes.length === 0 ? (
          <p className="muted small">Nenhum ambiente ou serviço ainda.</p>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr><th>Serviço</th>{ambientes.map((a) => <th key={a.id}>{a.nome}</th>)}</tr>
              </thead>
              <tbody>
                {servicos.map((s) => (
                  <tr key={s.id}>
                    <td>{s.nome}</td>
                    {ambientes.map((a) => (
                      <td key={a.id}>
                        <input
                          type="checkbox"
                          aria-label={`${s.nome} em ${a.nome}`}
                          checked={ligado(s.id, a.id)}
                          onChange={(e) => exec(e.target.checked
                            ? supabase.from('servico_ambiente').insert({ servico_id: s.id, ambiente_id: a.id })
                            : supabase.from('servico_ambiente').delete().eq('servico_id', s.id).eq('ambiente_id', a.id))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
