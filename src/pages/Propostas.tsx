import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { PropostaDocumento, type DadosDocumento, type EmpresaPublica } from '../components/PropostaDocumento';
import { doBanco, formatar, paraBanco, somar, type Centavos } from '../core/dinheiro';
import { formatarData, formatarDataHora } from '../core/datas';
import {
  aplicarModelos, compararVersoes, itemDoModelo, normalizar, novoId, paraCentavos, pendencias, prepararParaSalvar, rascunhoDoTexto,
  somaParcelas, sugerirPagamento, totalAmbiente, totalConteudo, totalItem, UNIDADES,
  type Ambiente, type Conteudo, type Item, type ModeloServico,
} from '../core/proposta';
import { ESTADO_PROPOSTA, EVENTO_PROPOSTA, type EstadoProposta, type Proposta, type PropostaEvento, type PropostaVersao } from '../lib/tipos';
import { linkWhatsApp } from './Comercial';

type PropostaLista = Proposta & { versoes: { id: string; numero: number; valor_total: string; emitida: boolean; validade: string | null }[] };

export function Propostas() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [filtro, setFiltro] = useState<'ativas' | EstadoProposta | 'todas'>(params.get('estado') === 'aprovada' ? 'aprovada' : 'ativas');
  const { dados, erro, carregando } = useConsulta(
    async () => ok(await supabase.from('proposta').select('*, pessoa:pessoa(nome, telefone, email), versoes:proposta_versao!proposta_versao_proposta_id_fkey(id, numero, valor_total, emitida, validade)').order('atualizado_em', { ascending: false })) as PropostaLista[],
    [],
  );
  const lista = (dados ?? []).filter((p) =>
    filtro === 'todas' ? true : filtro === 'ativas' ? ['rascunho', 'enviada', 'em_negociacao'].includes(p.estado) : p.estado === filtro,
  );
  return (
    <>
      <Topo titulo="Propostas" sub="Cada proposta guarda todas as versões. A versão enviada fica congelada; mudanças viram uma nova versão.">
        <Link className="btn-secundario" to="/comercial"><Icone nome="voltar" /> Comercial</Link>
        <Link className="btn-secundario" to="/biblioteca">Biblioteca de serviços</Link>
      </Topo>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmentado">
            {(['ativas', 'aprovada', 'recusada', 'todas'] as const).map((f) => (
              <button key={f} className={filtro === f ? 'ativo' : ''} onClick={() => setFiltro(f)}>
                {{ ativas: 'Em aberto', aprovada: 'Aprovadas', recusada: 'Recusadas', todas: 'Todas' }[f]}
              </button>
            ))}
          </div>
        </div>
        <Erro mensagem={erro} />
        {carregando && !dados ? <Carregando /> : lista.length === 0 ? (
          <Vazio titulo="Nenhuma proposta aqui">
            <p>Propostas nascem de um contato no Comercial: abra o contato e clique em “Nova proposta”.</p>
          </Vazio>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Proposta</th><th>Cliente</th><th>Situação</th><th>Versão</th><th className="right">Valor</th></tr></thead>
              <tbody>
                {lista.map((p) => {
                  const u = [...p.versoes].sort((a, b) => b.numero - a.numero)[0];
                  return (
                    <tr key={p.id} className="clicavel" onClick={() => navegar(`/propostas/${p.id}`)}>
                      <td><b>{p.titulo}</b><div className="muted small">{p.codigo}</div></td>
                      <td>{p.pessoa?.nome}</td>
                      <td><span className={`selo ${ESTADO_PROPOSTA[p.estado].classe}`}>{ESTADO_PROPOSTA[p.estado].rotulo}</span></td>
                      <td className="small">{u ? `v${u.numero}${u.emitida ? '' : ' (rascunho)'}` : '—'}</td>
                      <td className="right">{u && <Dinheiro valor={doBanco(u.valor_total)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------
type Custo = { descricao: string; valor: number };
type Carga = {
  proposta: Proposta & { oportunidade: { resumo: string | null; local_obra: string | null } | null };
  versoes: PropostaVersao[];
  eventos: PropostaEvento[];
  biblioteca: ModeloServico[];
  empresa: EmpresaPublica | null;
};

const ABAS = [
  ['geral', 'Apresentação'], ['escopo', 'Escopo e valores'], ['incluso', 'Incluso / não incluso'], ['resp', 'Responsabilidades'],
  ['prazo', 'Etapas e prazo'], ['pagamento', 'Pagamento'], ['condicoes', 'Premissas'], ['custos', 'Custos internos'], ['revisao', 'Revisar e emitir'],
] as const;
type Aba = (typeof ABAS)[number][0];

export function PropostaEditor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const toast = useToast();
  const { podeFinanceiro } = useAuth();
  const [erro, setErro] = useState<string | null>(null);
  const { dados, erro: erroCarga, carregando, recarregar } = useConsulta<Carga>(async () => {
    const [p, v, e, b, emp] = await Promise.all([
      supabase.from('proposta').select('*, pessoa:pessoa(nome, telefone, email), oportunidade:oportunidade(resumo, local_obra)').eq('id', id!).maybeSingle(),
      supabase.from('proposta_versao').select('*').eq('proposta_id', id!).order('numero'),
      supabase.from('proposta_evento').select('*').eq('proposta_id', id!).order('em', { ascending: false }),
      supabase.from('modelo_servico').select('*').eq('ativo', true).order('ordem'),
      supabase.rpc('empresa_publica'),
    ]);
    return {
      proposta: ok(p) as Carga['proposta'], versoes: ok(v) as PropostaVersao[], eventos: ok(e) as PropostaEvento[],
      biblioteca: ok(b) as ModeloServico[], empresa: ok(emp) as EmpresaPublica | null,
    };
  }, [id]);

  const versoes = dados?.versoes ?? [];
  const pedida = params.get('v');
  const versao = versoes.find((x) => x.id === pedida) ?? versoes[versoes.length - 1];
  const ultima = versoes[versoes.length - 1];

  if (carregando && !dados) return <Carregando />;
  if (erroCarga) return <Erro mensagem={erroCarga} />;
  if (!dados?.proposta) return <Vazio titulo="Proposta não encontrada ou sem acesso" />;
  const p = dados.proposta;

  async function novaVersao() {
    setErro(null);
    const r = await supabase.rpc('nova_versao_proposta', { p_proposta: p.id });
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Nova versão criada a partir da anterior.');
    setParams({});
    recarregar();
  }

  async function duplicar() {
    const r = await supabase.rpc('duplicar_proposta', { p_proposta: p.id });
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Proposta duplicada.');
    navegar(`/propostas/${r.data as string}`);
  }

  return (
    <>
      <Topo titulo={p.titulo} sub={<>{p.codigo} · {p.pessoa?.nome} · <span className={`selo ${ESTADO_PROPOSTA[p.estado].classe}`}>{ESTADO_PROPOSTA[p.estado].rotulo}</span></>}>
        <button className="btn-secundario" onClick={() => (p.oportunidade_id ? navegar(`/comercial/${p.oportunidade_id}`) : navegar('/propostas'))}><Icone nome="voltar" /> Voltar</button>
        <button className="btn-secundario" onClick={duplicar}>Duplicar</button>
      </Topo>
      <div className="row versoes" style={{ marginBottom: 14 }}>
        <span className="muted small">Versões:</span>
        {versoes.map((x) => (
          <button key={x.id} className={`chip-link${x.id === versao?.id ? ' ativo' : ''}`} onClick={() => setParams({ v: x.id })}>
            v{x.numero} {x.emitida ? (p.versao_aprovada_id === x.id ? '· aprovada' : '· emitida') : '· rascunho'}
          </button>
        ))}
        {ultima?.emitida && p.estado !== 'aprovada' && <button className="btn-secundario" onClick={novaVersao}><Icone nome="mais" /> Nova versão (revisão)</button>}
      </div>
      <Erro mensagem={erro} />
      {!versao ? (
        <Vazio titulo="Sem versão"><button className="btn-primario" onClick={novaVersao}>Criar versão 1</button></Vazio>
      ) : versao.emitida ? (
        <VersaoEmitida key={versao.id} carga={dados} versao={versao} anterior={versoes.find((x) => x.numero === versao.numero - 1)} ehUltima={versao.id === ultima?.id} aoMudar={recarregar} />
      ) : (
        <EditorVersao key={versao.id} carga={dados} versao={versao} anterior={versoes.find((x) => x.numero === versao.numero - 1)} podeFinanceiro={podeFinanceiro} aoEmitir={recarregar} />
      )}
    </>
  );
}

function linhas(t: string): string[] {
  return t.split('\n').map((x) => x.trim()).filter(Boolean);
}

function ListaTexto({ rotulo, valor, aoMudar, ajuda }: { rotulo: string; valor: string[]; aoMudar: (v: string[]) => void; ajuda?: string }) {
  const [texto, setTexto] = useState(valor.join('\n'));
  useEffect(() => { if (linhas(texto).join('\n') !== valor.join('\n')) setTexto(valor.join('\n')); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <label className="campo">
      <span>{rotulo} <span className="muted small">(um por linha)</span>{ajuda && <Ajuda>{ajuda}</Ajuda>}</span>
      <textarea rows={Math.max(4, valor.length + 1)} value={texto} onChange={(e) => { setTexto(e.target.value); aoMudar(linhas(e.target.value)); }} />
    </label>
  );
}

function EditorVersao({ carga, versao, anterior, podeFinanceiro, aoEmitir }: { carga: Carga; versao: PropostaVersao; anterior?: PropostaVersao; podeFinanceiro: boolean; aoEmitir: () => void }) {
  const toast = useToast();
  const p = carga.proposta;
  const [c, setC] = useState<Conteudo>(() => {
    const n = normalizar(versao.conteudo as Partial<Conteudo>);
    if (!n.necessidade && p.oportunidade?.resumo) n.necessidade = p.oportunidade.resumo;
    if (!n.local && p.oportunidade?.local_obra) n.local = p.oportunidade.local_obra;
    return n;
  });
  const [aba, setAba] = useState<Aba>(c.ambientes.length ? 'escopo' : 'geral');
  const [estadoSalvo, setEstadoSalvo] = useState<'salvo' | 'pendente' | 'salvando' | 'erro'>('salvo');
  const [erro, setErro] = useState<string | null>(null);
  const [custos, setCustos] = useState<Custo[]>([]);
  const [notas, setNotas] = useState('');
  const [custoCarregado, setCustoCarregado] = useState(false);
  const [preview, setPreview] = useState(false);
  const [comparar, setComparar] = useState(false);
  const primeira = useRef(true);

  const salvar = useCallback(async (conteudo: Conteudo) => {
    setEstadoSalvo('salvando');
    const pr = prepararParaSalvar(conteudo);
    const { error } = await supabase.from('proposta_versao').update({ conteudo: pr.conteudo, valor_total: pr.valor_total }).eq('id', versao.id);
    if (error) { setEstadoSalvo('erro'); setErro(mensagemErro(error)); return false; }
    setEstadoSalvo('salvo');
    return true;
  }, [versao.id]);

  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    setEstadoSalvo('pendente');
    const t = setTimeout(() => salvar(c), 1200);
    return () => clearTimeout(t);
  }, [c, salvar]);

  useEffect(() => {
    if (!podeFinanceiro) return;
    supabase.from('proposta_custo').select('*').eq('versao_id', versao.id).maybeSingle().then(({ data }) => {
      const d = data as { custos: { linhas?: Custo[] }; notas_internas: string | null } | null;
      setCustos(d?.custos?.linhas ?? []);
      setNotas(d?.notas_internas ?? '');
      setCustoCarregado(true);
    });
  }, [podeFinanceiro, versao.id]);

  async function salvarCustos() {
    const linhasValidas = custos.filter((x) => x.descricao.trim() || x.valor);
    const total = somar(linhasValidas.map((x) => paraCentavos(x.valor)));
    const { error } = await supabase.from('proposta_custo').upsert({ versao_id: versao.id, custos: { linhas: linhasValidas }, custo_total: paraBanco(total), notas_internas: notas || null });
    if (error) return setErro(mensagemErro(error));
    toast('Custos internos salvos (não aparecem para o cliente).');
  }

  const total = totalConteudo(c);
  const pend = pendencias(c, carga.proposta.tipo === 'aditivo');
  const set = <K extends keyof Conteudo>(k: K, v: Conteudo[K]) => setC((x) => ({ ...x, [k]: v }));

  async function emitir() {
    setErro(null);
    if (pend.length) return setErro('Resolva as pendências antes de emitir.');
    if (!(await salvar(c))) return;
    if (!window.confirm(`Emitir a versão ${versao.numero}? Depois de emitida ela fica congelada: qualquer mudança vira uma nova versão.`)) return;
    const r = await supabase.rpc('emitir_versao', { p_versao: versao.id });
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Versão emitida. Agora gere o link e envie ao cliente.');
    aoEmitir();
  }

  const doc: DadosDocumento = {
    codigo: p.codigo, tipo: p.tipo, titulo: p.titulo, versao: versao.numero, cliente: p.pessoa?.nome ?? '', emitida_em: null, validade: null,
    hash: null, conteudo: prepararParaSalvar(c).conteudo, empresa: carga.empresa, rascunho: true,
  };

  return (
    <div className="editor-proposta">
      <nav className="abas" aria-label="Partes da proposta">
        {ABAS.filter(([k]) => k !== 'custos' || podeFinanceiro).map(([k, r], i) => (
          <button key={k} className={aba === k ? 'ativo' : ''} onClick={() => setAba(k)}><span className="n">{i + 1}</span>{r}</button>
        ))}
        <div className="resumo-lateral">
          <div className="muted small">Total</div>
          <div className="num" style={{ fontSize: '1.3rem', fontWeight: 600 }}>{formatar(total)}</div>
          <div className="small muted">{{ salvo: 'Tudo salvo', pendente: 'Alterações a salvar…', salvando: 'Salvando…', erro: 'Erro ao salvar' }[estadoSalvo]}</div>
          <button className="btn-secundario" onClick={() => setPreview(true)} style={{ marginTop: 8 }}>Ver como o cliente</button>
          {anterior && <button className="btn-link" onClick={() => setComparar(true)}>Comparar com v{anterior.numero}</button>}
        </div>
      </nav>
      <div className="card">
        <Erro mensagem={erro} />
        {aba === 'geral' && <AbaGeral c={c} setC={setC} biblioteca={carga.biblioteca} irPara={setAba} aditivo={carga.proposta.tipo === 'aditivo'} />}
        {aba === 'escopo' && <AbaEscopo c={c} setC={setC} biblioteca={carga.biblioteca} />}
        {aba === 'incluso' && (
          <div className="grid grid-2">
            <ListaTexto rotulo="Incluso" valor={c.inclusoes} aoMudar={(v) => set('inclusoes', v)} />
            <ListaTexto rotulo="Não incluso" valor={c.exclusoes} aoMudar={(v) => set('exclusoes', v)} ajuda="Deixar claro o que não está no preço evita a maior parte das discussões de mudança de escopo." />
          </div>
        )}
        {aba === 'resp' && <AbaResponsabilidades c={c} setC={setC} />}
        {aba === 'prazo' && <AbaPrazo c={c} setC={setC} />}
        {aba === 'pagamento' && <AbaPagamento c={c} setC={setC} />}
        {aba === 'condicoes' && (
          <div className="stack">
            <ListaTexto rotulo="Premissas" valor={c.premissas} aoMudar={(v) => set('premissas', v)} ajuda="O que você considerou verdadeiro para chegar neste preço e prazo." />
            <label className="campo">Garantia<textarea value={c.garantia} onChange={(e) => set('garantia', e.target.value)} placeholder="Ex.: Garantia de 12 meses para os serviços executados, conforme o Código Civil e o CDC." /></label>
            <label className="campo">Observações<textarea value={c.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></label>
            <label className="campo" style={{ maxWidth: 220 }}>Validade (dias)<input type="number" min={1} max={180} value={c.validade_dias} onChange={(e) => set('validade_dias', Math.max(1, Number(e.target.value) || 15))} /></label>
            <p className="muted small">As condições gerais (mudança de escopo por aditivo, ajuste de prazo por pendências do cliente, conferência de qualidade por etapa) entram automaticamente.</p>
          </div>
        )}
        {aba === 'custos' && podeFinanceiro && (
          <AbaCustos custos={custos} setCustos={setCustos} notas={notas} setNotas={setNotas} total={total} carregado={custoCarregado} salvar={salvarCustos} />
        )}
        {aba === 'revisao' && (
          <div className="stack">
            {pend.length ? (
              <div className="aviso"><Icone nome="alerta" /><div><b>Antes de emitir:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pend.map((x) => <li key={x}>{x}</li>)}</ul></div></div>
            ) : (
              <div className="aviso ok"><Icone nome="check" /><span>Tudo certo para emitir. Confira a apresentação abaixo como o cliente vai ver.</span></div>
            )}
            {carga.empresa && !carga.empresa.registro && (
              <div className="aviso info"><span>O registro no CREA não aparece na proposta até ser conferido em Configurações → Empresa.</span></div>
            )}
            <div className="row"><button className="btn-primario" onClick={emitir} disabled={pend.length > 0}>Emitir versão {versao.numero}</button></div>
            <PropostaDocumento d={doc} />
          </div>
        )}
      </div>
      {preview && (
        <Modal titulo="Como o cliente vai ver" aoFechar={() => setPreview(false)} largo>
          <PropostaDocumento d={doc} />
        </Modal>
      )}
      {comparar && anterior && (
        <Comparacao a={normalizar(anterior.conteudo as Partial<Conteudo>)} b={c} na={anterior.numero} nb={versao.numero} aoFechar={() => setComparar(false)} />
      )}
    </div>
  );
}

function Comparacao({ a, b, na, nb, aoFechar }: { a: Conteudo; b: Conteudo; na: number; nb: number; aoFechar: () => void }) {
  const d = compararVersoes(a, b);
  return (
    <Modal titulo={`O que mudou da v${na} para a v${nb}`} aoFechar={aoFechar} largo>
      {d.length === 0 ? <p>Nenhuma diferença de escopo, valores, prazo ou pagamento.</p> : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Onde</th><th>v{na}</th><th>v{nb}</th></tr></thead>
            <tbody>{d.map((x, k) => <tr key={k}><td><b>{x.onde}</b></td><td className="small">{x.antes}</td><td className="small">{x.depois}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

type SetC = React.Dispatch<React.SetStateAction<Conteudo>>;

function AbaGeral({ c, setC, biblioteca, irPara, aditivo }: { c: Conteudo; setC: SetC; biblioteca: ModeloServico[]; irPara: (a: Aba) => void; aditivo: boolean }) {
  const [pedido, setPedido] = useState(c.necessidade);
  const [perguntas, setPerguntas] = useState<string[]>([]);
  const toast = useToast();
  function montar() {
    const r = rascunhoDoTexto(pedido, biblioteca, { ...c, necessidade: c.necessidade || pedido });
    if (!r.usados.length) return toast('Não reconheci nenhum serviço da biblioteca no texto. Monte o escopo manualmente.');
    setC(r.conteudo);
    setPerguntas(r.perguntas);
    toast(`Escopo sugerido com: ${r.usados.map((m) => m.nome).join(', ')}. Revise tudo antes de emitir.`);
  }
  return (
    <div className="stack">
      <div className="grid grid-2">
        <label className="campo">Local da obra<input value={c.local} onChange={(e) => setC({ ...c, local: e.target.value })} /></label>
        {aditivo && <label className="campo">Impacto no prazo (dias) <Ajuda>Quantos dias o aditivo acrescenta (ou tira, com sinal negativo) à previsão de término. 0 = sem impacto.</Ajuda><input inputMode="numeric" value={c.impacto_prazo_dias ?? ''} onChange={(e) => setC({ ...c, impacto_prazo_dias: e.target.value === '' ? null : Number(e.target.value) || 0 })} /></label>}
      </div>
      {aditivo && <label className="campo">Motivo do aditivo (obrigatório) <Ajuda>Ex.: pedido do cliente, condição encontrada na obra, mudança de projeto. Aparece no documento enviado ao cliente.</Ajuda><input value={c.motivo ?? ''} onChange={(e) => setC({ ...c, motivo: e.target.value })} /></label>}
      <label className="campo">
        <span>A necessidade do cliente <Ajuda>Escreva com as palavras do cliente o que ele precisa. Aparece na apresentação como “A sua necessidade”.</Ajuda></span>
        <textarea rows={4} value={c.necessidade} onChange={(e) => setC({ ...c, necessidade: e.target.value })} />
      </label>
      <div className="card destaque-card">
        <h3>Montar o escopo a partir do pedido</h3>
        <p className="muted small" style={{ marginTop: 4 }}>
          Cole a mensagem do cliente. O sistema procura na sua biblioteca os serviços citados, a área e os ambientes, e preenche escopo, inclusos,
          não inclusos, responsabilidades e etapas. É só um ponto de partida: nada é enviado sem a sua revisão.
        </p>
        <textarea rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: Preciso de projeto estrutural para casa de 2 pavimentos, 180 m², com piscina." />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn-primario" onClick={montar} disabled={!pedido.trim()}>Sugerir escopo</button>
          {c.ambientes.length > 0 && <button className="btn-secundario" onClick={() => irPara('escopo')}>Ir para o escopo</button>}
        </div>
        {perguntas.length > 0 && (
          <div className="aviso info" style={{ marginTop: 10 }}>
            <div><b>Confirme com o cliente:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{perguntas.map((q) => <li key={q}>{q}</li>)}</ul></div>
          </div>
        )}
      </div>
      <label className="campo">
        Apresentação da ROSAE
        <textarea rows={3} value={c.apresentacao} onChange={(e) => setC({ ...c, apresentacao: e.target.value })} />
      </label>
    </div>
  );
}

function AbaEscopo({ c, setC, biblioteca }: { c: Conteudo; setC: SetC; biblioteca: ModeloServico[] }) {
  const porId = useMemo(() => new Map(biblioteca.map((m) => [m.id, m])), [biblioteca]);
  const mudarAmb = (id: string, f: (a: Ambiente) => Ambiente) => setC((x) => ({ ...x, ambientes: x.ambientes.map((a) => (a.id === id ? f(a) : a)) }));
  const mudarItem = (aid: string, iid: string, mud: Partial<Item>) =>
    mudarAmb(aid, (a) => ({ ...a, itens: a.itens.map((i) => (i.id === iid ? { ...i, ...mud, total: totalItem({ ...i, ...mud }) } : i)) }));
  function adicionarModelo(aid: string, mid: string) {
    const m = porId.get(mid);
    if (!m) return;
    setC((x) => aplicarModelos({ ...x, ambientes: x.ambientes.map((a) => (a.id === aid ? { ...a, itens: [...a.itens, itemDoModelo(m)] } : a)) }, [m]));
  }
  const grupos = Array.from(new Set(biblioteca.map((m) => m.grupo)));
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Organize por ambiente (sala, cozinha…) ou use um único bloco “Escopo geral”. Ao escolher um serviço da biblioteca, os textos padrão dele entram nas outras partes.</p>
      {c.ambientes.map((a) => (
        <div key={a.id} className="bloco-ambiente">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="titulo-amb" value={a.nome} onChange={(e) => mudarAmb(a.id, (x) => ({ ...x, nome: e.target.value }))} aria-label="Nome do ambiente" />
            <span className="num muted">{formatar(totalAmbiente(a))}</span>
            <button className="btn-link" aria-label="Remover ambiente" onClick={() => window.confirm(`Remover "${a.nome}" e seus itens?`) && setC((x) => ({ ...x, ambientes: x.ambientes.filter((y) => y.id !== a.id) }))}><Icone nome="fechar" /></button>
          </div>
          {a.itens.map((i) => {
            const m = i.modelo_id ? porId.get(i.modelo_id) : undefined;
            return (
              <div key={i.id} className="item-escopo">
                <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 6 }}>
                  <input value={i.titulo} onChange={(e) => mudarItem(a.id, i.id, { titulo: e.target.value })} aria-label="Serviço" style={{ fontWeight: 600 }} />
                  <textarea rows={2} value={i.descricao ?? ''} onChange={(e) => mudarItem(a.id, i.id, { descricao: e.target.value })} aria-label="Descrição para o cliente" placeholder="Descrição que o cliente vai ler" />
                </div>
                <div className="linha-valores">
                  <label className="campo">Qtd.<input inputMode="decimal" value={String(i.quantidade).replace('.', ',')} onChange={(e) => mudarItem(a.id, i.id, { quantidade: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 })} /></label>
                  <label className="campo">Unidade
                    <select value={i.unidade} onChange={(e) => mudarItem(a.id, i.id, { unidade: e.target.value })}>{Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  </label>
                  <label className="campo">Preço unit.<CampoValor valor={paraCentavos(i.preco_unitario)} aoMudar={(v) => mudarItem(a.id, i.id, { preco_unitario: Number(paraBanco(v ?? 0)) })} /></label>
                  {m && m.complexidade.length > 0 && (
                    <label className="campo">Complexidade
                      <select value={i.complexidade ?? ''} onChange={(e) => { const k = m.complexidade.find((x) => x.nivel === e.target.value); mudarItem(a.id, i.id, { complexidade: k?.nivel ?? null, fator: k?.fator ?? 1 }); }}>
                        {m.complexidade.map((k) => <option key={k.nivel} value={k.nivel}>{k.nivel} (×{String(k.fator).replace('.', ',')})</option>)}
                      </select>
                    </label>
                  )}
                  <div className="campo"><span>Total</span><b className="num" style={{ padding: '9px 0' }}>{formatar(paraCentavos(totalItem(i)))}</b></div>
                  <button className="btn-link" aria-label="Remover item" onClick={() => mudarAmb(a.id, (x) => ({ ...x, itens: x.itens.filter((y) => y.id !== i.id) }))}><Icone nome="fechar" /></button>
                </div>
                {m && m.pontos_conferir.length > 0 && <div className="muted small">Conferir: {m.pontos_conferir.join(' · ')}</div>}
                {m && !(Number(m.preco_base) > 0) && !(paraCentavos(i.preco_unitario) > 0) && <div className="small" style={{ color: 'var(--alerta)' }}>Este serviço ainda não tem preço base na biblioteca. Informe o preço aqui ou cadastre na biblioteca.</div>}
              </div>
            );
          })}
          <div className="row">
            <select value="" onChange={(e) => adicionarModelo(a.id, e.target.value)} aria-label="Adicionar serviço da biblioteca" style={{ maxWidth: 320 }}>
              <option value="">+ Serviço da biblioteca…</option>
              {grupos.map((g) => <optgroup key={g} label={g}>{biblioteca.filter((m) => m.grupo === g).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</optgroup>)}
            </select>
            <button className="btn-secundario" onClick={() => mudarAmb(a.id, (x) => ({ ...x, itens: [...x.itens, { id: novoId(), titulo: '', descricao: '', unidade: 'vb', quantidade: 1, preco_unitario: 0, total: 0 }] }))}>+ Item livre</button>
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn-secundario" onClick={() => setC((x) => ({ ...x, ambientes: [...x.ambientes, { id: novoId(), nome: x.ambientes.length ? 'Novo ambiente' : 'Escopo geral', itens: [] }] }))}><Icone nome="mais" /> Ambiente</button>
      </div>
    </div>
  );
}

function AbaResponsabilidades({ c, setC }: { c: Conteudo; setC: SetC }) {
  const partesBase = ['ROSAE', 'Cliente', 'Parceiro'];
  const todas = Array.from(new Set([...partesBase, ...c.responsabilidades.map((r) => r.parte)]));
  const itens = (parte: string) => c.responsabilidades.find((r) => r.parte === parte)?.itens ?? [];
  const mudar = (parte: string, v: string[]) =>
    setC((x) => {
      const outras = x.responsabilidades.filter((r) => r.parte !== parte);
      return { ...x, responsabilidades: todas.map((pp) => (pp === parte ? { parte, itens: v } : outras.find((r) => r.parte === pp) ?? { parte: pp, itens: [] })).filter((r) => r.itens.length || partesBase.includes(r.parte)) };
    });
  return (
    <div className="grid grid-3">
      {todas.map((parte) => (
        <ListaTexto key={parte} rotulo={parte === 'Parceiro' ? 'Equipes parceiras' : parte} valor={itens(parte)} aoMudar={(v) => mudar(parte, v)} />
      ))}
    </div>
  );
}

function AbaPrazo({ c, setC }: { c: Conteudo; setC: SetC }) {
  const somaDias = c.etapas.reduce((s, e) => s + (Number(e.prazo_dias) || 0), 0);
  const mudar = (k: number, m: Partial<Conteudo['etapas'][number]>) => setC((x) => ({ ...x, etapas: x.etapas.map((e, j) => (j === k ? { ...e, ...m } : e)) }));
  return (
    <div className="stack">
      {c.etapas.map((e, k) => (
        <div key={k} className="linha-valores" style={{ alignItems: 'end' }}>
          <label className="campo" style={{ flex: 2 }}>Etapa {k + 1}<input value={e.nome} onChange={(ev) => mudar(k, { nome: ev.target.value })} /></label>
          <label className="campo" style={{ flex: 3 }}>Descrição<input value={e.descricao ?? ''} onChange={(ev) => mudar(k, { descricao: ev.target.value })} /></label>
          <label className="campo" style={{ maxWidth: 90 }}>Dias<input type="number" min={0} value={e.prazo_dias ?? ''} onChange={(ev) => mudar(k, { prazo_dias: ev.target.value ? Number(ev.target.value) : null })} /></label>
          <label className="campo" style={{ maxWidth: 90 }}>% valor<input type="number" min={0} max={100} value={e.percentual ?? ''} onChange={(ev) => mudar(k, { percentual: ev.target.value ? Number(ev.target.value) : null })} /></label>
          <button className="btn-link" aria-label="Remover etapa" onClick={() => setC((x) => ({ ...x, etapas: x.etapas.filter((_, j) => j !== k) }))}><Icone nome="fechar" /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn-secundario" onClick={() => setC((x) => ({ ...x, etapas: [...x.etapas, { nome: '', descricao: '', prazo_dias: null, percentual: null }] }))}><Icone nome="mais" /> Etapa</button>
        {somaDias > 0 && <span className="muted small">Soma das etapas: {somaDias} dias</span>}
      </div>
      <label className="campo">
        <span>Prazo total (como o cliente vai ler)</span>
        <input value={c.prazo_texto} onChange={(e) => setC({ ...c, prazo_texto: e.target.value })} placeholder={somaDias ? `${somaDias} dias corridos após a aprovação` : 'Ex.: 30 dias corridos após a aprovação'} />
      </label>
    </div>
  );
}

function AbaPagamento({ c, setC }: { c: Conteudo; setC: SetC }) {
  const total = totalConteudo(c);
  const soma = somaParcelas(c);
  const [n, setN] = useState(3);
  const parcelas = c.pagamento.parcelas;
  const mudar = (k: number, m: Partial<(typeof parcelas)[number]>) => setC((x) => ({ ...x, pagamento: { ...x.pagamento, parcelas: x.pagamento.parcelas.map((p, j) => (j === k ? { ...p, ...m } : p)) } }));
  const sugerir = (modo: 'entrada_parcelas' | 'etapas' | 'mensal') => setC((x) => ({ ...x, pagamento: { ...x.pagamento, parcelas: sugerirPagamento(total, modo, n, x.etapas) } }));
  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">Sugerir:</span>
        <button className="btn-secundario" onClick={() => sugerir('entrada_parcelas')} disabled={total <= 0}>Entrada 30% + parcelas</button>
        <button className="btn-secundario" onClick={() => sugerir('etapas')} disabled={total <= 0 || c.etapas.length === 0}>Por etapa</button>
        <button className="btn-secundario" onClick={() => sugerir('mensal')} disabled={total <= 0}>Mensal</button>
        <label className="row small" style={{ gap: 4 }}>em <input type="number" min={1} max={36} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64 }} /> vezes</label>
      </div>
      {parcelas.map((p, k) => (
        <div key={k} className="linha-valores" style={{ alignItems: 'end' }}>
          <label className="campo" style={{ flex: 2 }}>Descrição<input value={p.descricao} onChange={(e) => mudar(k, { descricao: e.target.value })} /></label>
          <label className="campo" style={{ flex: 2 }}>Quando<input value={p.quando ?? ''} onChange={(e) => mudar(k, { quando: e.target.value })} placeholder="Na assinatura, 30 dias, ao concluir…" /></label>
          <label className="campo" style={{ flex: 1 }}>Valor<CampoValor valor={paraCentavos(p.valor)} aoMudar={(v) => mudar(k, { valor: Number(paraBanco(v ?? 0)) })} /></label>
          <button className="btn-link" aria-label="Remover parcela" onClick={() => setC((x) => ({ ...x, pagamento: { ...x.pagamento, parcelas: x.pagamento.parcelas.filter((_, j) => j !== k) } }))}><Icone nome="fechar" /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn-secundario" onClick={() => setC((x) => ({ ...x, pagamento: { ...x.pagamento, parcelas: [...x.pagamento.parcelas, { descricao: `Parcela ${x.pagamento.parcelas.length + 1}`, valor: 0 }] } }))}><Icone nome="mais" /> Parcela</button>
        {parcelas.length > 0 && (
          <span className="small" style={{ color: soma === total ? 'var(--favoravel)' : 'var(--desfavoravel)' }}>
            Soma {formatar(soma)} de {formatar(total)}{soma !== total ? ` · diferença ${formatar(total - soma)}` : ' · confere'}
          </span>
        )}
      </div>
      <label className="campo">Observação sobre pagamento<input value={c.pagamento.descricao} onChange={(e) => setC({ ...c, pagamento: { ...c.pagamento, descricao: e.target.value } })} placeholder="Ex.: PIX ou transferência. Materiais pagos diretamente pelo cliente." /></label>
    </div>
  );
}

function AbaCustos({ custos, setCustos, notas, setNotas, total, carregado, salvar }: { custos: Custo[]; setCustos: (c: Custo[]) => void; notas: string; setNotas: (s: string) => void; total: Centavos; carregado: boolean; salvar: () => void }) {
  if (!carregado) return <Carregando />;
  const custoTotal = somar(custos.map((x) => paraCentavos(x.valor)));
  const margem = total - custoTotal;
  const pct = total > 0 ? Math.round((margem / total) * 1000) / 10 : 0;
  return (
    <div className="stack">
      <div className="aviso info"><span>Só você vê esta parte. Custos e margem nunca vão para a proposta, o link ou o PDF.</span></div>
      {custos.map((x, k) => (
        <div key={k} className="linha-valores" style={{ alignItems: 'end' }}>
          <label className="campo" style={{ flex: 3 }}>Custo<input value={x.descricao} onChange={(e) => setCustos(custos.map((y, j) => (j === k ? { ...y, descricao: e.target.value } : y)))} placeholder="Mão de obra parceira, material, deslocamento, impostos…" /></label>
          <label className="campo" style={{ flex: 1 }}>Valor<CampoValor valor={paraCentavos(x.valor)} aoMudar={(v) => setCustos(custos.map((y, j) => (j === k ? { ...y, valor: Number(paraBanco(v ?? 0)) } : y)))} /></label>
          <button className="btn-link" aria-label="Remover custo" onClick={() => setCustos(custos.filter((_, j) => j !== k))}><Icone nome="fechar" /></button>
        </div>
      ))}
      <div className="row"><button className="btn-secundario" onClick={() => setCustos([...custos, { descricao: '', valor: 0 }])}><Icone nome="mais" /> Custo</button></div>
      <div className="grid grid-3">
        <div className="kpi"><div className="rotulo">Preço</div><div className="valor num">{formatar(total)}</div></div>
        <div className="kpi"><div className="rotulo">Custo previsto</div><div className="valor num">{formatar(custoTotal)}</div></div>
        <div className="kpi"><div className="rotulo">Margem prevista</div><div className="valor num" style={{ color: margem < 0 ? 'var(--desfavoravel)' : undefined }}>{formatar(margem)} · {String(pct).replace('.', ',')}%</div></div>
      </div>
      <label className="campo">Notas internas<textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></label>
      <div className="row"><button className="btn-primario" onClick={salvar}>Salvar custos</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Versão emitida: link, envio e respostas do cliente
// ---------------------------------------------------------------------
function VersaoEmitida({ carga, versao, anterior, ehUltima, aoMudar }: { carga: Carga; versao: PropostaVersao; anterior?: PropostaVersao; ehUltima: boolean; aoMudar: () => void }) {
  const toast = useToast();
  const p = carga.proposta;
  const [link, setLink] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comparar, setComparar] = useState(false);
  const c = normalizar(versao.conteudo as Partial<Conteudo>);
  const eventos = carga.eventos.filter((e) => e.versao_id === versao.id);
  const respostas = carga.eventos.filter((e) => ['aceita', 'ajuste_pedido', 'recusada'].includes(e.tipo));
  const vencida = versao.validade ? versao.validade < new Date().toISOString().slice(0, 10) : false;
  const doc: DadosDocumento = {
    codigo: p.codigo, tipo: p.tipo, titulo: p.titulo, versao: versao.numero, cliente: p.pessoa?.nome ?? '', emitida_em: versao.emitida_em,
    validade: versao.validade, hash: versao.hash, conteudo: c, empresa: carga.empresa,
  };

  async function gerarLink(): Promise<string | null> {
    setErro(null);
    const r = await supabase.rpc('criar_link_proposta', { p_versao: versao.id, p_dias: 60 });
    if (r.error) { setErro(mensagemErro(r.error)); return null; }
    const url = `${window.location.origin}/p/${r.data as string}`;
    setLink(url);
    return url;
  }

  async function enviar(canal: 'whatsapp' | 'email') {
    const url = link ?? (await gerarLink());
    if (!url) return;
    const nome = p.pessoa?.nome?.split(' ')[0] ?? '';
    const texto = `Olá, ${nome}! Segue a proposta ${p.codigo} (versão ${versao.numero}) da ROSAE Engenharia: ${p.titulo}.\n\nPara ver todos os detalhes e responder, acesse:\n${url}\n\nQualquer dúvida, estou à disposição.\nRhuann Rosa · ROSAE Engenharia & Estruturas`;
    const destino = canal === 'whatsapp' ? p.pessoa?.telefone ?? '' : p.pessoa?.email ?? '';
    const alvo = canal === 'whatsapp'
      ? linkWhatsApp(destino, texto) ?? `https://wa.me/?text=${encodeURIComponent(texto)}`
      : `mailto:${encodeURIComponent(destino)}?subject=${encodeURIComponent(`Proposta ${p.codigo} · ROSAE Engenharia`)}&body=${encodeURIComponent(texto)}`;
    window.open(alvo, '_blank', 'noopener');
    const r = await supabase.rpc('registrar_envio_proposta', { p_versao: versao.id, p_canal: canal, p_destinatario: destino || null });
    if (r.error) return setErro(mensagemErro(r.error));
    toast(canal === 'whatsapp' ? 'Mensagem preparada no WhatsApp. Confira e toque em enviar.' : 'E-mail preparado no seu aplicativo de e-mail. Confira e envie.');
    aoMudar();
  }

  async function revogar() {
    if (!window.confirm('Desativar todos os links desta versão? O cliente não conseguirá mais abrir os links já enviados.')) return;
    const r = await supabase.rpc('revogar_links_proposta', { p_versao: versao.id });
    if (r.error) return setErro(mensagemErro(r.error));
    setLink(null);
    toast('Links desativados.');
    aoMudar();
  }

  return (
    <div className="grid editor-emitida">
      <div className="stack">
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>Versão {versao.numero} · {formatar(doBanco(versao.valor_total))}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Emitida em {formatarDataHora(versao.emitida_em)} · válida até {formatarData(versao.validade)}{vencida ? ' (vencida)' : ''} · código {versao.hash?.slice(0, 16).toUpperCase()}
          </p>
          {p.versao_aprovada_id === versao.id && (
            <>
              <div className="aviso ok" style={{ marginTop: 10 }}><Icone nome="check" /><span>Aprovada por <b>{p.aprovada_por_nome}</b> em {formatarDataHora(p.aprovada_em)}.</span></div>
              <Converter proposta={p} versaoId={versao.id} />
            </>
          )}
          {!ehUltima && <div className="aviso info" style={{ marginTop: 10 }}><span>Existe versão mais nova. Esta continua guardada como histórico, mas não pode mais ser aceita.</span></div>}
          <Erro mensagem={erro} />
          {ehUltima && p.estado !== 'aprovada' && (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="row">
                <button className="btn-primario" onClick={() => enviar('whatsapp')}>Enviar por WhatsApp</button>
                <button className="btn-secundario" onClick={() => enviar('email')}>Enviar por e-mail</button>
                <button className="btn-secundario" onClick={gerarLink}>Gerar link</button>
              </div>
              {link && (
                <div className="aviso info" style={{ wordBreak: 'break-all' }}>
                  <span>{link} <button className="btn-link" onClick={() => { navigator.clipboard.writeText(link); toast('Link copiado.'); }}>Copiar</button></span>
                </div>
              )}
              <p className="muted small" style={{ margin: 0 }}>O envio abre o seu WhatsApp ou o seu aplicativo de e-mail com a mensagem pronta; você confere e envia. O link vale 60 dias e mostra só o que está nesta versão.</p>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn-secundario" to={`/propostas/${p.id}/imprimir?v=${versao.id}`} target="_blank"><Icone nome="baixar" /> PDF / imprimir</Link>
            {anterior && <button className="btn-link" onClick={() => setComparar(true)}>Comparar com v{anterior.numero}</button>}
            {ehUltima && <button className="btn-link" onClick={revogar}>Desativar links</button>}
          </div>
        </div>
        {respostas.length > 0 && (
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>Respostas do cliente</h2>
            <ul className="linha-tempo">
              {respostas.map((e) => (
                <li key={e.id} className={e.tipo}>
                  <div className="small muted">{formatarDataHora(e.em)} · {EVENTO_PROPOSTA[e.tipo]} · v{carga.versoes.find((v) => v.id === e.versao_id)?.numero}</div>
                  <div><b>{e.nome}</b>{e.email ? ` · ${e.email}` : ''}{e.documento ? ` · doc. ${e.documento}` : ''}</div>
                  {e.comentario && <div style={{ whiteSpace: 'pre-wrap' }}>{e.comentario}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Histórico desta versão</h2>
          {eventos.length === 0 ? <p className="muted">Sem eventos.</p> : (
            <ul className="linha-tempo">
              {eventos.map((e) => (
                <li key={e.id} className={e.tipo}>
                  <div className="small muted">{formatarDataHora(e.em)}</div>
                  <div>{EVENTO_PROPOSTA[e.tipo] ?? e.tipo}{e.email ? ` · ${e.email}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="card"><PropostaDocumento d={doc} /></div>
      {comparar && anterior && <Comparacao a={normalizar(anterior.conteudo as Partial<Conteudo>)} b={c} na={anterior.numero} nb={versao.numero} aoFechar={() => setComparar(false)} />}
    </div>
  );
}

// Proposta aprovada vira obra (ou o aditivo entra na obra). Repetir não duplica.
function Converter({ proposta, versaoId }: { proposta: Proposta; versaoId: string }) {
  const navegar = useNavigate();
  const toast = useToast();
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const existente = useConsulta(async () => {
    if (proposta.tipo === 'aditivo') return ok(await supabase.from('servico').select('obra_id').eq('origem_versao_id', versaoId).limit(1)) as { obra_id: string }[];
    return ok(await supabase.from('obra').select('id').eq('proposta_versao_id', versaoId).limit(1)) as { id: string }[];
  }, [versaoId]);
  const feito = (existente.dados?.length ?? 0) > 0;
  const obraId = proposta.tipo === 'aditivo' ? proposta.obra_id : (existente.dados?.[0] as { id?: string } | undefined)?.id;
  async function converter() {
    setErro(null);
    setRodando(true);
    const r = await supabase.rpc('converter_proposta', { p_versao: versaoId });
    setRodando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(proposta.tipo === 'aditivo' ? 'Aditivo incorporado à obra.' : 'Obra criada: ambientes, serviços, etapas, materiais sugeridos e previsão de recebimento. Revise cada parte.');
    navegar(`/obras/${r.data as string}${proposta.tipo === 'aditivo' ? '?aba=contrato' : ''}`);
  }
  if (existente.carregando && !existente.dados) return null;
  return (
    <div className="stack" style={{ marginTop: 10 }}>
      {feito ? (
        <Link className="btn-secundario" to={`/obras/${obraId}`}>{proposta.tipo === 'aditivo' ? 'Aditivo já incorporado · abrir obra' : 'Abrir a obra criada'}</Link>
      ) : (
        <>
          <button className="btn-primario" onClick={converter} disabled={rodando}>{proposta.tipo === 'aditivo' ? 'Incorporar aditivo à obra' : 'Converter em obra'}</button>
          <p className="muted small" style={{ margin: 0 }}>{proposta.tipo === 'aditivo'
            ? 'Cria os serviços, etapas e a previsão de recebimento do aditivo na obra. O contrato original fica como está.'
            : 'Cria a obra com ambientes, serviços e quantidades da versão aprovada, orçamento-base com o valor vendido, etapas e materiais sugeridos e a previsão de recebimentos. A proposta aprovada fica guardada como referência. Pode clicar de novo: não duplica.'}</p>
        </>
      )}
      <Erro mensagem={erro} />
    </div>
  );
}

// Página só com a apresentação, para salvar em PDF pelo navegador.
export function PropostaImprimir() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { dados, erro, carregando } = useConsulta(async () => {
    const [p, v, emp] = await Promise.all([
      supabase.from('proposta').select('*, pessoa:pessoa(nome)').eq('id', id!).single(),
      supabase.from('proposta_versao').select('*').eq('id', params.get('v')!).single(),
      supabase.rpc('empresa_publica'),
    ]);
    return { p: ok(p) as Proposta, v: ok(v) as PropostaVersao, empresa: ok(emp) as EmpresaPublica | null };
  }, [id, params]);
  useEffect(() => {
    if (dados) { document.title = `${dados.p.codigo} v${dados.v.numero} · ROSAE`; setTimeout(() => window.print(), 600); }
  }, [dados]);
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro ?? 'Não encontrado.'} />;
  const { p, v } = dados;
  return (
    <div className="pagina-impressao">
      <div className="nao-imprimir aviso info" style={{ margin: 16 }}><span>Na janela de impressão, escolha “Salvar como PDF”. Margens: nenhuma. Ative “Gráficos de fundo”.</span></div>
      <PropostaDocumento d={{
        codigo: p.codigo, tipo: p.tipo, titulo: p.titulo, versao: v.numero, cliente: p.pessoa?.nome ?? '', emitida_em: v.emitida_em,
        validade: v.validade, hash: v.hash, conteudo: normalizar(v.conteudo as Partial<Conteudo>), empresa: dados.empresa, rascunho: !v.emitida,
      }} />
    </div>
  );
}
