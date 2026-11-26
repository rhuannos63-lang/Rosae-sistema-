// Composição de custos da proposta (só quem tem financeiro vê): cada item do escopo pode
// ser ligado a uma ou mais composições. Mostra material, mão de obra, preço com BDI e a lista
// de insumos. Quando a obra for aceita, os materiais viram a lista de compras.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConsulta } from '../lib/consulta';
import { carregarBase, carregarCondicoes } from '../lib/composicoes';
import { acrescimoDas, textoAcrescimo } from '../core/condicoes';
import { SeletorCondicoes } from './SeletorCondicoes';
import { calcularComposicao, mesmaUnidade, novoUsoId, PADRAO, PADROES, precoComBdi, sugerirComposicoes, TIPO_INSUMO, type Composicao, type Padrao, type Uso } from '../core/composicao';
import type { Conteudo, Item } from '../core/proposta';
import { Carregando, Erro } from './ui';
import { Icone } from './Icone';
import { CampoNumero } from './OrcamentoGerador';

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number, casas = 2) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });

export function ComposicaoProposta({ c, usos, setUsos, bdi, setBdi, padrao, setPadrao, condicoes, setCondicoes, aoUsarPreco, aoCusto }: {
  c: Conteudo; usos: Uso[]; setUsos: (u: Uso[]) => void; bdi: number; setBdi: (v: number) => void;
  /** Padrão de acabamento geral da proposta (cada composição pode ter o seu). */
  padrao: Padrao; setPadrao: (p: Padrao) => void;
  /** Condições da obra e logística marcadas (códigos). */
  condicoes: string[]; setCondicoes: (c: string[]) => void;
  aoUsarPreco: (ai: number, ii: number, reais: number) => void;
  /** Custo direto das composições (em reais), para somar aos outros custos. */
  aoCusto: (reais: number) => void;
}) {
  const base = useConsulta(async () => { const [b, cond] = await Promise.all([carregarBase(), carregarCondicoes()]); return { ...b, condicoes: cond }; }, []);
  const [verInsumos, setVerInsumos] = useState(false);
  const calc = useMemo(() => (base.dados ? calcularComposicao(usos, base.dados.composicoes, base.dados.insumos, padrao, acrescimoDas(condicoes, base.dados.condicoes)) : null), [usos, base.dados, padrao, condicoes]);
  const custoTotal = calc?.total.total ?? 0;
  useEffect(() => { aoCusto(custoTotal); }, [custoTotal, aoCusto]);
  if (base.carregando && !base.dados) return <Carregando />;
  if (base.erro || !base.dados || !calc) return <Erro mensagem={base.erro ?? 'Erro ao carregar a base de composições.'} />;
  const { composicoes } = base.dados;
  const ativas = composicoes.filter((x) => x.ativo !== false);
  const grupos = Array.from(new Set(ativas.map((x) => x.grupo)));
  const itens = c.ambientes.flatMap((a, ai) => a.itens.map((item, ii) => ({ a: a.nome, ai, ii, item })));

  const incluir = (item: Item, comp: Composicao) => setUsos([...usos, {
    id: novoUsoId(), item_id: item.id, composicao_id: comp.id,
    quantidade: mesmaUnidade(item.unidade, comp.unidade) ? Number(item.quantidade) || 0 : 0, perda_pct: 5,
  }]);
  const mudar = (id: string, p: Partial<Uso>) => setUsos(usos.map((u) => (u.id === id ? { ...u, ...p } : u)));

  return (
    <div className="stack composicao">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2>Composição por insumos</h2>
          <p className="muted small" style={{ margin: '2px 0 0' }}>Ligue cada item às composições de serviço. O custo de material e mão de obra sai da sua base, que você edita em <Link to="/orcamento/composicoes">Insumos e composições</Link>.</p>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="campo"><span>Padrão de acabamento</span>
            <div className="segmentado" role="radiogroup" aria-label="Padrão de acabamento">
              {PADROES.map((p) => <button key={p} role="radio" aria-checked={padrao === p} className={padrao === p ? 'ativo' : ''} onClick={() => setPadrao(p)}>{PADRAO[p]}</button>)}
            </div>
          </div>
          <label className="campo" style={{ width: 150 }}>BDI<div className="campo-unidade"><CampoNumero valor={bdi} aoMudar={(v) => setBdi(Math.max(0, v ?? 0))} /><span>%</span></div></label>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>O padrão muda o preço dos materiais de acabamento e a produtividade da mão de obra (estimativa para o Rio de Janeiro). Estrutura, fundação e projeto não mudam. Cada composição pode ter um padrão diferente do geral.</p>
      <details className="card condicoes-card" open={condicoes.length > 0}>
        <summary><b>Condições da obra e logística</b> <span className="muted small">· {condicoes.length ? textoAcrescimo(acrescimoDas(condicoes, base.dados.condicoes)) : 'acesso fácil, sem acréscimo'}</span></summary>
        <p className="muted small" style={{ margin: '6px 0 10px' }}>Escada, elevador, terreno em aclive, condomínio, imóvel ocupado: cada condição aumenta a mão de obra e o material de todas as composições. A quantidade de material para comprar não muda. Percentuais em <Link to="/orcamento/composicoes?aba=condicoes">Condições da obra</Link>.</p>
        <SeletorCondicoes base={base.dados.condicoes} marcadas={condicoes} aoMudar={setCondicoes} compacto />
      </details>
      {itens.length === 0 && <p className="muted">Monte o escopo da proposta primeiro.</p>}
      {itens.map(({ a, ai, ii, item }) => {
        const meus = calc.resultados.filter((u) => u.item_id === item.id);
        const custo = calc.porItem.get(item.id);
        const sugeridas = sugerirComposicoes(item, ativas).filter((x) => !meus.some((u) => u.composicao_id === x.id));
        const preco = custo ? precoComBdi(custo.total, bdi) : 0;
        const atual = Number(item.total) || 0;
        return (
          <div className="card composicao-item" key={item.id}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div><span className="muted small">{a}</span><h3 style={{ margin: 0 }}>{item.titulo}</h3><span className="small muted">{num(Number(item.quantidade) || 0)} {item.unidade} · na proposta {reais(atual)}</span></div>
              {custo && custo.total > 0 && (
                <div className="composicao-resumo">
                  <span>Material <b className="num">{reais(custo.material)}</b></span>
                  <span>Mão de obra <b className="num">{reais(custo.mao_de_obra + custo.equipamento)}</b></span>
                  <span>Com BDI <b className="num">{reais(preco)}</b></span>
                  {Math.abs(preco - atual) >= 0.01 && <button className="btn-secundario small" onClick={() => aoUsarPreco(ai, ii, preco)}>Usar {reais(preco)} no item</button>}
                </div>
              )}
            </div>
            {meus.length > 0 && (
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead><tr><th>Composição</th><th style={{ width: 150 }}>Padrão</th><th style={{ width: 150 }}>Quantidade</th><th style={{ width: 110 }}>Perda</th><th className="right">Custo</th><th /></tr></thead>
                  <tbody>
                    {meus.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <select value={u.composicao_id} onChange={(e) => mudar(u.id, { composicao_id: e.target.value })} aria-label="Composição">
                            {grupos.map((g) => <optgroup key={g} label={g}>{ativas.filter((x) => x.grupo === g).map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.unidade})</option>)}</optgroup>)}
                          </select>
                          {u.composicao?.metodologia && <div className="dica small">{u.composicao.metodologia}</div>}
                        </td>
                        <td>
                          {u.composicao?.varia_padrao
                            ? <select value={u.padrao ?? ''} onChange={(e) => mudar(u.id, { padrao: (e.target.value || null) as Padrao | null })} aria-label="Padrão desta composição">
                                <option value="">Geral ({PADRAO[padrao]})</option>
                                {PADROES.map((p) => <option key={p} value={p}>{PADRAO[p]}</option>)}
                              </select>
                            : <span className="small muted">Não varia</span>}
                        </td>
                        <td><div className="campo-unidade"><CampoNumero valor={u.quantidade} aoMudar={(v) => mudar(u.id, { quantidade: v ?? 0 })} invalido={!(u.quantidade > 0)} /><span>{u.composicao?.unidade}</span></div></td>
                        <td><div className="campo-unidade"><CampoNumero valor={u.perda_pct} aoMudar={(v) => mudar(u.id, { perda_pct: v ?? 0 })} /><span>%</span></div></td>
                        <td className="right num">{reais(u.custos.total)}</td>
                        <td><button className="btn-link" aria-label="Tirar composição" onClick={() => setUsos(usos.filter((x) => x.id !== u.id))}><Icone nome="fechar" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row composicao-incluir" style={{ gap: 6, flexWrap: 'wrap' }}>
              {sugeridas.map((x) => <button key={x.id} className="chip-link" onClick={() => incluir(item, x)}><Icone nome="mais" /> {x.nome}</button>)}
              <select value="" onChange={(e) => { const x = ativas.find((k) => k.id === e.target.value); if (x) incluir(item, x); }} aria-label="Incluir composição">
                <option value="">{sugeridas.length ? 'Outra composição…' : 'Incluir composição…'}</option>
                {grupos.map((g) => <optgroup key={g} label={g}>{ativas.filter((x) => x.grupo === g).map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.unidade})</option>)}</optgroup>)}
              </select>
            </div>
          </div>
        );
      })}
      {calc.total.total > 0 && (
        <div className="card">
          <div className="grid grid-3">
            <div className="kpi"><div className="rotulo">Material</div><div className="valor num">{reais(calc.total.material)}</div></div>
            <div className="kpi"><div className="rotulo">Mão de obra e equipamento</div><div className="valor num">{reais(calc.total.mao_de_obra + calc.total.equipamento)}</div></div>
            <div className="kpi"><div className="rotulo">Custo direto</div><div className="valor num">{reais(calc.total.total)}</div><div className="small muted">Com BDI {num(bdi, 1)}%: <b className="num">{reais(precoComBdi(calc.total.total, bdi))}</b></div></div>
          </div>
          {calc.acrescimoCondicoes > 0 && <p className="small" style={{ margin: '4px 0 6px' }}>Já inclui <b className="num">{reais(calc.acrescimoCondicoes)}</b> das condições da obra e logística.</p>}
          <button className="btn-link small" onClick={() => setVerInsumos((v) => !v)}>{verInsumos ? 'Esconder' : 'Ver'} todos os insumos ({calc.insumos.length})</button>
          {verInsumos && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr><th>Insumo</th><th className="right">Quantidade</th><th>Compra</th><th className="right">Custo</th></tr></thead>
                <tbody>
                  {(['material', 'mao_de_obra', 'equipamento'] as const).map((t) => {
                    const ls = calc.insumos.filter((l) => l.insumo.tipo === t);
                    if (!ls.length) return null;
                    return (
                      <Fragment key={t}>
                        <tr className="grupo"><td colSpan={4}><b>{TIPO_INSUMO[t]}</b></td></tr>
                        {ls.map((l) => (
                          <tr key={l.insumo.id}>
                            <td>{l.insumo.nome}</td>
                            <td className="right num small">{num(l.quantidade, 3)} {l.insumo.unidade}</td>
                            <td className="small">{l.compra ? `${num(l.compra.quantidade)} ${l.compra.unidade}` : '—'}</td>
                            <td className="right num">{reais(l.custo)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {calc.acrescimoCondicoes > 0 && <tr className="grupo"><td colSpan={3}><b>Condições da obra e logística</b></td><td className="right num">{reais(calc.acrescimoCondicoes)}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ margin: '8px 0 0' }}>Quando o cliente aceitar e você converter em obra, os materiais desta lista viram a <b>lista de compras</b> da obra, já na embalagem de compra, para você conferir.</p>
        </div>
      )}
    </div>
  );
}
