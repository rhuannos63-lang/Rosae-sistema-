// Gerador do orçamento automático: tipo de serviço → perguntas → pacotes com preço ao vivo.
// Usado na tela "Novo orçamento" e na aba "Orçamento automático" do editor de proposta.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icone } from './Icone';
import { formatar } from '../core/dinheiro';
import { CampoValor } from './ui';
import type { ValoresManuais } from '../core/proposta';
import {
  camposDe, DEFINICOES, gerarOrcamento, respostasPadrao, TIPOS,
  type Campo, type Contexto, type Orcamento, type Pacote, type Respostas, type TipoServico,
} from '../core/orcamento';
import type { TabelaPrecos } from '../lib/orcamentoParametros';

const reais = (v: number) => formatar(Math.round(v * 100));
const SIGLA: Record<TipoServico, string> = { projeto_estrutural: 'PE', reforco: 'RE', reforma: 'RF', construcao: 'CO', laudo: 'LT', pericia: 'PT' };

/** valores: o preço que você definiu para cada pacote, no lugar do calculado. */
export type EstadoGerador = { tipo: TipoServico | null; respostas: Respostas; pacote: 1 | 2 | 3; valores?: ValoresManuais };

export function estadoInicial(g?: { tipo: string; respostas: Respostas; pacote: number; valores?: ValoresManuais } | null): EstadoGerador {
  if (g && (TIPOS as string[]).includes(g.tipo)) {
    const tipo = g.tipo as TipoServico;
    return { tipo, respostas: { ...respostasPadrao(tipo), ...g.respostas }, pacote: (Math.min(3, Math.max(1, g.pacote)) as 1 | 2 | 3), valores: g.valores ?? {} };
  }
  return { tipo: null, respostas: {}, pacote: 2 };
}

export function OrcamentoGerador({ estado, setEstado, precos, contexto, podeFinanceiro, acao }: {
  estado: EstadoGerador; setEstado: (e: EstadoGerador) => void; precos: TabelaPrecos; contexto: Contexto; podeFinanceiro: boolean;
  acao: (o: Orcamento) => React.ReactNode;
}) {
  const { tipo, respostas, pacote, valores } = estado;
  const orc = useMemo(() => (tipo ? gerarOrcamento(tipo, respostas, precos[tipo], pacote, { ...contexto, valores }) : null), [tipo, respostas, pacote, precos, contexto, valores]);
  const [verLinhas, setVerLinhas] = useState(false);

  function escolherTipo(t: TipoServico) {
    setEstado({ tipo: t, respostas: respostasPadrao(t), pacote: 2, valores: {} });
  }
  const set = (id: string, v: Respostas[string]) => setEstado({ ...estado, respostas: { ...respostas, [id]: v } });
  const definirValor = (k: 1 | 2 | 3, v: number | null) => {
    const n = { ...valores };
    if (v && v > 0) n[k] = v; else delete n[k];
    setEstado({ ...estado, valores: n });
  };

  return (
    <div className="gerador">
      <div className="tipos-servico" role="radiogroup" aria-label="Tipo de serviço">
        {TIPOS.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} className={`tipo-card${tipo === t ? ' ativo' : ''}`} onClick={() => escolherTipo(t)}>
            <span className="tipo-sigla">{SIGLA[t]}</span>
            <b>{DEFINICOES[t].nome}</b>
            <span>{DEFINICOES[t].chamada}</span>
          </button>
        ))}
      </div>

      {tipo && orc && (
        <div className="gerador-corpo">
          <div className="card gerador-perguntas">
            <div className="card-titulo">
              <div><h2>Dados do serviço</h2><div className="sub">O preço, o prazo e os textos se ajustam enquanto você preenche.</div></div>
              <Link className="btn-link small" to={`/orcamento/precos?tipo=${tipo}`}>Ajustar tabela de preços</Link>
            </div>
            <div className="grid grid-2">
              {camposDe(tipo).filter((c) => !c.se || c.se(respostas)).map((c) => <CampoGerador key={c.id} c={c} valor={respostas[c.id]} aoMudar={(v) => set(c.id, v)} />)}
            </div>
          </div>

          <aside className="gerador-lateral">
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>{orc.pacotes.length > 1 ? 'Escolha o pacote da proposta' : 'Honorários'}</h2>
              <div className="pacotes-escolha">
                {orc.pacotes.map((p) => (
                  <button key={p.numero} type="button" className={`pacote-card${orc.principal.numero === p.numero ? ' ativo' : ''}`} onClick={() => setEstado({ ...estado, pacote: p.numero })}>
                    <span className="pacote-nome">{p.nome}{p.numero === 2 && orc.pacotes.length > 1 && <span className="selo">recomendado</span>}</span>
                    <span className="pacote-valor num">{reais(p.valor)}</span>
                    <span className="pacote-sub">{p.subtitulo}</span>
                    {valores?.[p.numero] ? <span className="pacote-ajustado">Seu preço · pela tabela {reais(p.calculado)}</span> : null}
                  </button>
                ))}
              </div>
              {orc.pacotes.length > 1 && <p className="muted small" style={{ margin: '8px 0 0' }}>O pacote escolhido é o valor da proposta. Os outros aparecem lado a lado para o cliente comparar.</p>}
              <PrecoManual key={`${tipo}-${orc.principal.numero}`} pacote={orc.principal} manual={!!valores?.[orc.principal.numero]} varios={orc.pacotes.length > 1} aoMudar={(v) => definirValor(orc.principal.numero, v)} />
              <dl className="dl" style={{ marginTop: 12 }}>
                <dt>Prazo</dt><dd><b>{orc.conteudo.prazo_total_dias} dias</b> em {orc.conteudo.etapas.length} etapas</dd>
                <dt>Pagamento</dt><dd>{orc.conteudo.pagamento.parcelas.length} parcela(s)</dd>
              </dl>
              {podeFinanceiro && orc.analise.preco > 0 && (
                <div className="analise-interna">
                  <div className="small muted">Só você vê · não vai para o cliente</div>
                  <div className="analise-linha"><span>Custo estimado</span><b className="num">{reais(orc.analise.custo)}</b></div>
                  <div className="analise-linha"><span>Margem estimada</span><b className="num" style={{ color: orc.analise.margem_pct < 15 ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{reais(orc.analise.margem)} · {orc.analise.margem_pct.toFixed(0)}%</b></div>
                  {orc.analise.valor_hora && <div className="analise-linha"><span>Sua hora neste serviço</span><b className="num">{reais(orc.analise.valor_hora)}/h · {orc.analise.horas} h</b></div>}
                </div>
              )}
              {orc.avisos.length > 0 && (
                <ul className="avisos-gerador">{orc.avisos.map((a) => <li key={a}><Icone nome="alerta" />{a}</li>)}</ul>
              )}
              <div className="stack" style={{ marginTop: 12 }}>{acao(orc)}</div>
              <button type="button" className="btn-link small" onClick={() => setVerLinhas((v) => !v)}>{verLinhas ? 'Esconder' : 'Ver'} a composição do preço</button>
              {verLinhas && (
                <table className="tabela" style={{ marginTop: 6 }}>
                  <tbody>
                    {orc.principal.linhas.map((l, k) => <tr key={k}><td className="small">{l.titulo}</td><td className="right num small">{reais(l.valor)}</td></tr>)}
                    <tr className="total"><td>Total</td><td className="right num">{reais(orc.principal.valor)}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/** "Meu preço": troca o valor calculado do pacote pelo que você quiser cobrar. */
function PrecoManual({ pacote, manual, varios, aoMudar }: { pacote: Pacote; manual: boolean; varios: boolean; aoMudar: (v: number | null) => void }) {
  const [aberto, setAberto] = useState(manual);
  const [texto, setTexto] = useState<number | null>(manual ? Math.round(pacote.valor * 100) : null);
  if (!aberto) {
    return (
      <button type="button" className="btn-secundario preco-manual-abrir" onClick={() => { setAberto(true); setTexto(Math.round(pacote.valor * 100)); }}>
        <Icone nome="editar" /> Definir meu preço{varios ? ` do ${pacote.nome}` : ''}
      </button>
    );
  }
  const dif = pacote.calculado > 0 ? ((pacote.valor - pacote.calculado) / pacote.calculado) * 100 : 0;
  return (
    <div className="preco-manual">
      <label className="campo">
        <span>Meu preço{varios ? ` · pacote ${pacote.nome}` : ''}</span>
        <CampoValor valor={texto} aoMudar={(c) => { setTexto(c); aoMudar(c && c > 0 ? c / 100 : null); }} />
      </label>
      <div className="small muted">
        Pela tabela: <b className="num">{reais(pacote.calculado)}</b>
        {manual && Math.abs(dif) >= 0.05 && <> · {dif > 0 ? '+' : ''}{dif.toFixed(1).replace('.', ',')}%</>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>A diferença é repartida entre os itens do pacote, e o pagamento acompanha o novo valor.</p>
      <div className="row">
        <button type="button" className="btn-link small" onClick={() => { aoMudar(null); setTexto(null); setAberto(false); }}>Voltar ao preço da tabela</button>
      </div>
    </div>
  );
}

function CampoGerador({ c, valor, aoMudar }: { c: Campo; valor: Respostas[string]; aoMudar: (v: Respostas[string]) => void }) {
  const rotulo = <span>{c.rotulo}{c.ajuda && <span className="dica"> · {c.ajuda}</span>}</span>;
  if (c.tipo === 'numero') {
    return (
      <label className="campo">
        {rotulo}
        <div className="campo-unidade">
          <CampoNumero valor={typeof valor === 'number' ? valor : null} aoMudar={aoMudar} invalido={c.obrigatorio && !valor} />
          {c.unidade && <span>{c.unidade}</span>}
        </div>
      </label>
    );
  }
  if (c.tipo === 'texto') {
    return <label className="campo">{rotulo}<input value={String(valor ?? '')} placeholder={c.placeholder} onChange={(e) => aoMudar(e.target.value)} /></label>;
  }
  if (c.tipo === 'sim_nao') {
    return (
      <div className="campo">
        <span className="campo-rotulo">{rotulo}</span>
        <div className="segmentado" role="radiogroup" aria-label={c.rotulo}>
          <button type="button" className={valor === true ? 'ativo' : ''} onClick={() => aoMudar(true)}>Sim</button>
          <button type="button" className={valor !== true ? 'ativo' : ''} onClick={() => aoMudar(false)}>Não</button>
        </div>
      </div>
    );
  }
  if (c.opcoes.length <= 3 && c.opcoes.every((o) => o.rotulo.length <= 22)) {
    return (
      <div className="campo">
        <span className="campo-rotulo">{rotulo}</span>
        <div className="segmentado" role="radiogroup" aria-label={c.rotulo}>
          {c.opcoes.map((o) => <button key={o.valor} type="button" title={o.descricao} className={valor === o.valor ? 'ativo' : ''} onClick={() => aoMudar(o.valor)}>{o.rotulo}</button>)}
        </div>
        {c.opcoes.find((o) => o.valor === valor)?.descricao && <span className="dica">{c.opcoes.find((o) => o.valor === valor)?.descricao}</span>}
      </div>
    );
  }
  return (
    <label className="campo">
      {rotulo}
      <select value={String(valor ?? '')} onChange={(e) => aoMudar(e.target.value)}>
        {c.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}{o.descricao ? ` · ${o.descricao}` : ''}</option>)}
      </select>
    </label>
  );
}

const lerNumero = (t: string): number | null => {
  const x = t.trim().replace(/\s/g, '');
  if (!x) return null;
  // "1.234,5" e "1234,5" (vírgula decimal) ou "0.12" (ponto decimal sem vírgula).
  const v = x.includes(',') ? Number(x.replace(/\./g, '').replace(',', '.')) : Number(x);
  return Number.isFinite(v) ? v : null;
};
const mostrarNumero = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: 4, useGrouping: false }));

/** Número digitado no jeito brasileiro, sem perder a vírgula enquanto se digita. */
export function CampoNumero({ valor, aoMudar, invalido }: { valor: number | null; aoMudar: (v: number | null) => void; invalido?: boolean }) {
  const [texto, setTexto] = useState(mostrarNumero(valor));
  useEffect(() => { if (lerNumero(texto) !== valor) setTexto(mostrarNumero(valor)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return <input inputMode="decimal" value={texto} aria-invalid={invalido || undefined} onChange={(e) => { setTexto(e.target.value); aoMudar(lerNumero(e.target.value)); }} />;
}
