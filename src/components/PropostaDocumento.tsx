// Proposta em formato de apresentação 16:9. A mesma peça serve para a pré-visualização,
// a edição direta na página, a página do cliente e o PDF (impressão). Nunca recebe custos nem margens.
import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { variaveisDocumento } from '../lib/aparencia';
import { Icone } from './Icone';
import { RosaTopografica } from './RosaTopografica';
import { formatar, lerDigitado } from '../core/dinheiro';
import { formatarData } from '../core/datas';
import {
  ajustarTotal, alternarPagina, areaDaProposta, compromissosPadrao, definirTotalItem, mudarItem, paginaOculta, paraCentavos, textoParcelamento,
  totalAmbiente, totalConteudo, totalItem, valorPorMetro, PAGINAS_OPCIONAIS, UNIDADES, type Conteudo, type Item,
} from '../core/proposta';

export type EmpresaPublica = {
  nome: string | null; razao_social?: string | null; cnpj?: string | null; responsavel: string | null; registro: string | null;
  endereco: string | null; telefone: string | null; email: string | null; site: string | null; instagram: string | null; frase: string | null;
};

export type DadosDocumento = {
  codigo: string; tipo: 'proposta' | 'aditivo'; titulo: string; versao: number; cliente: string;
  emitida_em: string | null; validade: string | null; hash: string | null; conteudo: Conteudo; empresa: EmpresaPublica | null;
  rascunho?: boolean;
};

/** Edição direta na página: cada texto vira um campo; preços mexem nas parcelas junto. */
export type EdicaoDocumento = {
  /** Mudança de texto. */
  mudar: (f: (c: Conteudo) => Conteudo) => void;
};
/** Escolha do pacote feita pelo cliente na própria folha. */
export type EscolhaPacote = { atual: string | null; aoEscolher: (nome: string) => void };

const Ed = createContext<EdicaoDocumento | null>(null);

// ---------------------------------------------------------------------
// Campos editáveis na página
// ---------------------------------------------------------------------
type Tag = 'span' | 'p' | 'b' | 'h1' | 'h3' | 'dd' | 'dt' | 'small' | 'div';

/** Texto que, no modo de edição, se edita clicando em cima. Enter confirma; Esc desfaz. */
function T({ v, set, multi, ph, className, tag = 'span', vazio }: { v: string; set: (s: string) => void; multi?: boolean; ph?: string; className?: string; tag?: Tag; vazio?: string }) {
  const ed = useContext(Ed);
  const Tg = tag;
  if (!ed) return v || vazio ? <Tg className={className}>{v || vazio}</Tg> : null;
  return (
    <Tg
      key={v}
      className={`${className ?? ''} ed${multi ? ' ed-multi' : ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multi || undefined}
      aria-label={ph ?? 'Texto da proposta'}
      data-ph={ph ?? 'Escreva aqui'}
      onBlur={(e) => { const t = e.currentTarget.innerText.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim(); if (t !== v) set(t); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(multi && e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.innerText = v; e.currentTarget.blur(); }
      }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
    >{v}</Tg>
  );
}

/** Valor em reais editável. Aceita "1.234,56", "1234" ou "R$ 10". */
function V({ v, set, className, tag = 'span' }: { v: number; set?: (centavos: number) => void; className?: string; tag?: Tag }) {
  const ed = useContext(Ed);
  const Tg = tag;
  const texto = formatar(paraCentavos(v));
  if (!ed || !set) return <Tg className={className}>{texto}</Tg>;
  return (
    <Tg
      key={texto}
      className={`${className ?? ''} ed ed-valor`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Valor"
      inputMode="decimal"
      title="Clique para mudar o valor"
      onBlur={(e) => {
        const c = lerDigitado(e.currentTarget.innerText);
        if (c === null || c < 0) { e.currentTarget.innerText = texto; return; }
        if (c !== paraCentavos(v)) set(c);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.innerText = texto; e.currentTarget.blur(); }
      }}
    >{texto}</Tg>
  );
}

/** Lista de frases: no modo de edição cada linha se edita, sai no × e entra no "+ Adicionar". */
function L({ itens, set, className, ph, ordenada, padrao }: { itens: string[]; set: (v: string[]) => void; className?: string; ph?: string; ordenada?: boolean; padrao?: string[] }) {
  const ed = useContext(Ed);
  const Tg = ordenada ? 'ol' : 'ul';
  const lista = !ed && itens.length === 0 && padrao ? padrao : itens;
  return (
    <Tg className={className}>
      {lista.map((x, k) => (
        <li key={`${k}-${x}`}>
          {ed ? (
            <>
              <T v={x} ph={ph} set={(s) => set(s ? itens.map((y, j) => (j === k ? s : y)) : itens.filter((_, j) => j !== k))} />
              <button type="button" className="ed-tirar" aria-label={`Tirar "${x}"`} title="Tirar esta linha" onClick={() => set(itens.filter((_, j) => j !== k))}>×</button>
            </>
          ) : x}
        </li>
      ))}
      {ed && <li className="ed-add"><button type="button" onClick={() => set([...itens, ph ? `${ph}` : 'Novo item'])}>+ Adicionar</button></li>}
    </Tg>
  );
}

// ---------------------------------------------------------------------
// Folha
// ---------------------------------------------------------------------
/** Diminui a escala do conteúdo até caber na folha (até 60%). Mantém tudo dentro da página no PDF. */
function useCaberNaFolha() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let quadro = 0;
    // Cada medida força o navegador a recalcular a página: começa pela proporção que falta
    // (um passo só, quase sempre) e só refaz quando o texto ou a largura da folha mudam.
    const ajustar = (forcar = false) => {
      const assinatura = `${el.textContent?.length ?? 0}|${el.childElementCount}|${el.clientWidth}`;
      if (!forcar && el.dataset.ajuste === assinatura) return;
      el.dataset.ajuste = assinatura;
      el.style.removeProperty('--fator');
      const sobra = () => el.scrollHeight > el.clientHeight + 1;
      if (!sobra()) { el.classList.remove('transborda'); return; }
      let f = Math.max(0.6, Math.floor((el.clientHeight / el.scrollHeight) * 100) / 100);
      el.style.setProperty('--fator', String(f));
      for (let i = 0; i < 6 && f > 0.6 && sobra(); i++) {
        f = Math.max(0.6, Math.round((f - 0.03) * 100) / 100);
        el.style.setProperty('--fator', String(f));
      }
      el.classList.toggle('transborda', sobra());
    };
    ajustar();
    // Só reajusta quando a folha muda de tamanho de verdade: o próprio ajuste não pode disparar outro (laço sem fim).
    let ultimo = '';
    const ro = new ResizeObserver(([e]) => {
      const tam = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      if (tam === ultimo) return;
      ultimo = tam;
      cancelAnimationFrame(quadro); quadro = requestAnimationFrame(() => ajustar(true));
    });
    ro.observe(el.parentElement!);
    document.fonts?.ready.then(() => { quadro = requestAnimationFrame(() => ajustar(true)); });
    return () => { ro.disconnect(); cancelAnimationFrame(quadro); };
  });
  return ref;
}

function Slide({ n, total, titulo, children, d, classe }: { n: number; total: number; titulo?: ReactNode; children: ReactNode; d: DadosDocumento; classe?: string }) {
  const corpo = useCaberNaFolha();
  return (
    <section className={`slide ${classe ?? ''}`} aria-label={typeof titulo === 'string' ? titulo : `Página ${n}`}>
      {d.rascunho && <div className="marca-rascunho">RASCUNHO · não enviado ao cliente</div>}
      {titulo && (
        <header className="slide-cab">
          <span className="slide-kicker"><span className="slide-n">{String(n).padStart(2, '0')}</span>{d.codigo} · versão {d.versao}</span>
          <h2>{titulo}</h2>
        </header>
      )}
      <div className="slide-corpo" ref={corpo}>{children}</div>
      <footer className="slide-rodape">
        <img src="/marca/rosae-simbolo.svg" alt="" />
        <span>{d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'}</span>
        <span className="spacer" />
        <span className="slide-progresso" aria-hidden="true"><i style={{ width: `${Math.round((n / Math.max(1, total)) * 100)}%` }} /></span>
        <span>{n}/{total}</span>
      </footer>
    </section>
  );
}

function partes<T>(lista: T[], tamanho: number): T[][] {
  if (lista.length === 0) return [[]];
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) r.push(lista.slice(i, i + tamanho));
  return r;
}

const qtd = (i: Item) => `${Number(i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${UNIDADES[i.unidade] ?? i.unidade}`;

type Pagina = { id: string; titulo?: ReactNode; nome: string; classe?: string; conteudo: ReactNode };

/** Arquivo PDF: o documento fica fixo em 16:9 e ganha botões clicáveis para o aceite. */
export type ModoPdf = { aceite?: string | null };

export function PropostaDocumento({ d, edicao, escolha, pdf }: { d: DadosDocumento; edicao?: EdicaoDocumento; escolha?: EscolhaPacote; pdf?: ModoPdf }) {
  const c = d.conteudo;
  const ed = edicao ?? null;
  const mudar = (f: (c: Conteudo) => Conteudo) => ed?.mudar(f);
  const set = <K extends keyof Conteudo>(k: K) => (v: Conteudo[K]) => mudar((x) => ({ ...x, [k]: v }));
  const total = totalConteudo(c);
  const linhas = c.ambientes.flatMap((a, ai) => [{ amb: a, ai, item: null as Item | null, ii: -1 }, ...a.itens.map((item, ii) => ({ amb: a, ai, item, ii }))]);
  const itensEscopo = c.ambientes.flatMap((a, ai) => a.itens.map((item, ii) => ({ amb: a.nome, ai, item, ii })));
  const paginasEscopo = partes(itensEscopo, itensEscopo.length <= 5 ? 5 : 4);
  const parcelas = c.pagamento.parcelas;
  // Pagamento ao lado da tabela só quando os dois cabem com folga; senão ganha página própria.
  const pagamentoJunto = parcelas.length > 0 && parcelas.length <= 4 && linhas.length <= 9 && !c.condicao_especial;
  const paginasValores = partes(linhas, 12);
  const condicoes = [
    `Esta proposta é válida até ${d.validade ? formatarData(d.validade) : `${c.validade_dias} dias após a emissão`}.`,
    'Serviços ou alterações fora do escopo descrito serão orçados à parte e só executados após aprovação por escrito (aditivo).',
    'Prazos contam a partir da aprovação, do pagamento da entrada (quando houver) e da liberação do local e das informações necessárias.',
    'Atrasos causados por decisões pendentes, mudanças pedidas pelo cliente, chuvas ou falta de acesso ajustam o prazo na mesma proporção.',
    'A qualidade é conferida por etapa; pendências encontradas são registradas e corrigidas antes da etapa seguinte.',
  ];
  const mudarValor = (ai: number, ii: number) => (centavos: number) => mudar((x) => mudarItem(x, ai, ii, (i) => definirTotalItem(i, centavos)));

  const paginas: Pagina[] = [];

  const prazoCapa = c.prazo_total_dias ? `${c.prazo_total_dias} dias` : c.prazo_texto ? c.prazo_texto.split(',')[0] : null;
  paginas.push({
    id: 'capa', nome: 'Capa',
    classe: 'capa',
    conteudo: (
      <div className="capa-grade">
        <RosaTopografica className="capa-rosa" />
        <div className="capa-texto">
          <img className="capa-logo" src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" />
          <p className="capa-tipo">{d.tipo === 'aditivo' ? 'Aditivo de escopo' : 'Proposta técnica e comercial'}</p>
          <h1>{d.titulo}</h1>
          <p className="capa-cliente">Preparada exclusivamente para <b>{d.cliente}</b></p>
          <ul className="capa-selos">
            <li>Responsabilidade técnica com ART</li>
            <li>Acompanhamento pelo portal</li>
            {c.garantia ? <li>Garantia por escrito</li> : <li>Escopo detalhado</li>}
            <li>Normas ABNT</li>
          </ul>
          {pdf?.aceite && <a className="pdf-botao capa-pdf-botao" href={pdf.aceite}>Ver online e aceitar →</a>}
        </div>
        <dl className="capa-dados">
          {(c.local || ed) && <div><dt>Local</dt><T tag="dd" v={c.local} set={set('local')} ph="Endereço da obra" /></div>}
          {prazoCapa && <div><dt>Prazo</dt><dd>{prazoCapa}</dd></div>}
          <div><dt>Emissão</dt><dd>{d.emitida_em ? formatarData(d.emitida_em.slice(0, 10)) : 'rascunho'}</dd></div>
          <div><dt>Válida até</dt><dd>{d.validade ? formatarData(d.validade) : `${c.validade_dias} dias após a emissão`}</dd></div>
          <div><dt>Referência</dt><dd>{d.codigo} · v{d.versao}</dd></div>
        </dl>
      </div>
    ),
  });

  if (c.resumo) {
    const principal = c.opcoes?.find((o) => o.principal);
    paginas.push({
      id: 'resumo', nome: 'Em resumo',
      titulo: 'Em resumo',
      conteudo: (
        <div className="resumo-exec">
          <T tag="p" className="resumo-frase" v={c.resumo ?? ''} set={set('resumo')} multi ph="Em duas ou três frases: o que você vai fazer e o que o cliente ganha" />
          <div className="resumo-cartoes">
            <div><Icone nome="financeiro" /><span>Investimento</span><b className="num">{formatar(total)}</b><small>{[principal && `pacote ${principal.nome}`, textoParcelamento(c)].filter(Boolean).join(' · ')}</small></div>
            <div><Icone nome="calendario" /><span>Prazo</span><b>{c.prazo_total_dias ? `${c.prazo_total_dias} dias` : '—'}</b><small>{c.etapas.length} etapas</small></div>
            <div><Icone nome="documento" /><span>Você recebe</span><b>{(c.entregaveis ?? []).length || c.inclusoes.length}</b><small>{(c.entregaveis ?? []).length ? 'entregáveis' : 'itens inclusos'}</small></div>
            <div><Icone nome="check" /><span>Responsável técnico</span><b className="resumo-nome">{d.empresa?.responsavel ?? 'Engenheiro ROSAE'}</b><small>com ART</small></div>
          </div>
        </div>
      ),
    });
  }

  const temDados = (c.dados_tecnicos ?? []).length > 0;
  const temRiscos = (c.riscos ?? []).length > 0;
  paginas.push({
    id: d.tipo === 'aditivo' ? 'aditivo' : 'entendimento', nome: d.tipo === 'aditivo' ? 'O que muda' : 'O que entendemos',
    titulo: d.tipo === 'aditivo' ? 'O que muda' : temDados ? 'O que entendemos do seu projeto' : 'Quem somos e o que entendemos',
    conteudo: (
      <div className="duas-colunas">
        <div>
          {temDados ? (
            <>
              {(c.necessidade || ed) && <><h3>A sua necessidade</h3><T tag="p" className="citacao pre" v={c.necessidade} set={set('necessidade')} multi ph="O que o cliente pediu" /></>}
              <h3>Dados considerados</h3>
              <dl className="ficha-dados">
                {c.dados_tecnicos!.map((x, k) => (
                  <div key={x.rotulo}><dt>{x.rotulo}</dt><T tag="dd" v={x.valor} set={(s) => mudar((y) => ({ ...y, dados_tecnicos: (y.dados_tecnicos ?? []).map((z, j) => (j === k ? { ...z, valor: s } : z)) }))} ph="Valor" /></div>
                ))}
              </dl>
            </>
          ) : (
            <>
              <h3>A ROSAE</h3>
              <T tag="p" v={c.apresentacao} set={set('apresentacao')} multi ph="Apresentação da empresa" />
              {d.empresa?.frase && <p className="destaque">“{d.empresa.frase}”</p>}
            </>
          )}
        </div>
        <div>
          {temRiscos ? (
            <>
              <h3>Por que isso importa</h3>
              <L className="lista-riscos" itens={c.riscos!} set={set('riscos')} ph="Risco que este serviço evita" />
            </>
          ) : (
            <>
              <h3>{d.tipo === 'aditivo' ? 'O que muda' : 'A sua necessidade'}</h3>
              <T tag="p" className="pre" v={c.necessidade} set={set('necessidade')} multi ph="O que o cliente pediu" vazio="Descrição a completar." />
            </>
          )}
          {d.tipo === 'aditivo' && (c.motivo || ed) && <p><b>Motivo:</b> <T v={c.motivo ?? ''} set={set('motivo')} ph="Por que o escopo mudou" /></p>}
          {d.tipo === 'aditivo' && c.impacto_prazo_dias != null && <p><b>Impacto no prazo:</b> {c.impacto_prazo_dias === 0 ? 'sem alteração' : `${c.impacto_prazo_dias > 0 ? '+' : ''}${c.impacto_prazo_dias} dia(s)`}</p>}
          {d.tipo === 'aditivo' && <p className="small">Este aditivo complementa o contrato original, que permanece válido nas demais condições.</p>}
        </div>
      </div>
    ),
  });

  paginasEscopo.forEach((pg, k) => {
    paginas.push({
      id: 'escopo', nome: 'Escopo dos serviços',
      titulo: paginasEscopo.length > 1 ? `Escopo dos serviços (${k + 1}/${paginasEscopo.length})` : 'Escopo dos serviços',
      conteudo: pg.length === 0 ? <p>Escopo a definir.</p> : (
        <div className="escopo">
          {pg.map(({ amb, item, ai, ii }) => (
            <div key={item.id} className="escopo-item">
              <span className="escopo-amb">{amb}</span>
              <T tag="h3" v={item.titulo} set={(s) => s && mudar((x) => mudarItem(x, ai, ii, (i) => ({ ...i, titulo: s })))} ph="Nome do serviço" />
              <T tag="p" v={item.descricao ?? ''} set={(s) => mudar((x) => mudarItem(x, ai, ii, (i) => ({ ...i, descricao: s })))} multi ph="O que está incluído neste serviço" />
              <span className="escopo-qtd">{qtd(item)}{item.complexidade ? ` · complexidade ${item.complexidade.toLowerCase()}` : ''}</span>
            </div>
          ))}
        </div>
      ),
    });
  });

  if ((c.entregaveis ?? []).length > 0) {
    paginas.push({
      id: 'entregaveis', nome: 'O que você recebe',
      titulo: 'O que você recebe',
      conteudo: ed ? <L className="entregaveis-ed" itens={c.entregaveis!} set={set('entregaveis')} ph="Entregável" ordenada /> : (
        <div className="entregaveis">
          {c.entregaveis!.map((x, k) => <div key={x}><span className="entregavel-n">{String(k + 1).padStart(2, '0')}</span><b>{x}</b></div>)}
        </div>
      ),
    });
  }

  const padraoIncl = ['Conforme escopo descrito.'];
  const padraoExcl = ['Tudo o que não estiver descrito no escopo.'];
  const nIncl = (c.inclusoes.length || 1) + (c.exclusoes.length || 1);
  if (nIncl > 16) {
    paginas.push({ id: 'incluso', nome: 'O que está incluso', titulo: 'O que está incluso', conteudo: <L className="marcas ok em-colunas" itens={c.inclusoes} set={set('inclusoes')} padrao={padraoIncl} ph="Item incluso" /> });
    paginas.push({ id: 'incluso', nome: 'O que não está incluso', titulo: 'O que não está incluso', conteudo: <><L className="marcas nao em-colunas" itens={c.exclusoes} set={set('exclusoes')} padrao={padraoExcl} ph="Item não incluso" /><p className="small muted nota-folha">Itens não inclusos podem ser contratados à parte, sempre com orçamento aprovado antes.</p></> });
  } else {
    paginas.push({
      id: 'incluso', nome: 'Incluso e não incluso',
      titulo: 'O que está incluso e o que não está',
      conteudo: (
        <div className={`duas-colunas${nIncl > 11 ? ' compacto' : ''}`}>
          <div>
            <h3 className="ok">Incluso</h3>
            <L className="marcas ok" itens={c.inclusoes} set={set('inclusoes')} padrao={padraoIncl} ph="Item incluso" />
          </div>
          <div>
            <h3 className="nao">Não incluso</h3>
            <L className="marcas nao" itens={c.exclusoes} set={set('exclusoes')} padrao={padraoExcl} ph="Item não incluso" />
          </div>
        </div>
      ),
    });
  }

  const resp = c.responsabilidades.filter((r) => r.itens.length || ed);
  if (resp.length > 0 && c.responsabilidades.some((r) => r.itens.length > 0)) {
    paginas.push({
      id: 'responsabilidades', nome: 'Responsabilidades',
      titulo: 'Responsabilidades de cada parte',
      conteudo: (
        <div className="colunas-resp" style={{ gridTemplateColumns: `repeat(${Math.min(3, resp.length)}, 1fr)` }}>
          {resp.map((r) => (
            <div key={r.parte}>
              <h3>{r.parte === 'Parceiro' ? 'Equipes parceiras' : r.parte}</h3>
              <L itens={r.itens} set={(v) => mudar((x) => ({ ...x, responsabilidades: x.responsabilidades.map((z) => (z.parte === r.parte ? { ...z, itens: v } : z)) }))} ph="Responsabilidade" />
            </div>
          ))}
        </div>
      ),
    });
  }

  if ((c.metodologia ?? []).length > 0) {
    const setM = (k: number, campo: 'titulo' | 'texto') => (s: string) => mudar((x) => ({ ...x, metodologia: (x.metodologia ?? []).map((m, j) => (j === k ? { ...m, [campo]: s } : m)) }));
    paginas.push({
      id: 'metodologia', nome: 'Como trabalhamos',
      titulo: 'Como trabalhamos',
      conteudo: (
        <ol className="metodo">
          {c.metodologia!.map((m, k) => <li key={k}><span className="etapa-n">{k + 1}</span><T tag="b" v={m.titulo} set={setM(k, 'titulo')} ph="Passo" /><T v={m.texto} set={setM(k, 'texto')} multi ph="Como é feito" /></li>)}
        </ol>
      ),
    });
  }

  const comPrazo = c.etapas.length > 0 && c.etapas.every((e) => (e.prazo_dias ?? 0) > 0);
  const diasTotal = comPrazo ? c.etapas.reduce((t, e) => t + (e.prazo_dias ?? 0), 0) : 0;
  const setEtapa = (k: number, campo: 'nome' | 'descricao') => (s: string) => mudar((x) => ({ ...x, etapas: x.etapas.map((e, j) => (j === k ? { ...e, [campo]: s } : e)) }));
  let acumulado = 0;
  paginas.push({
    id: 'cronograma', nome: comPrazo ? 'Cronograma' : 'Etapas e prazo',
    titulo: comPrazo ? 'Cronograma' : 'Etapas e prazo',
    conteudo: (
      <div>
        {comPrazo ? (
          <div className="gantt">
            {c.etapas.map((e, k) => {
              const ini = acumulado;
              acumulado += e.prazo_dias ?? 0;
              return (
                <div key={k} className="gantt-linha">
                  <div className="gantt-nome"><b>{k + 1}. <T v={e.nome} set={setEtapa(k, 'nome')} ph="Etapa" /></b><T v={e.descricao ?? ''} set={setEtapa(k, 'descricao')} ph="Descrição" /></div>
                  <div className="gantt-trilho">
                    <div className="gantt-barra" style={{ left: `${(ini / diasTotal) * 100}%`, width: `${((e.prazo_dias ?? 0) / diasTotal) * 100}%` }}><span>{e.prazo_dias} d</span></div>
                  </div>
                </div>
              );
            })}
            <div className="gantt-regua"><span>Aceite</span><span>dia {Math.round(diasTotal / 2)}</span><span>dia {diasTotal} · entrega</span></div>
          </div>
        ) : c.etapas.length > 0 && (
          <ol className="linha-etapas">
            {c.etapas.map((e, k) => (
              <li key={k}>
                <span className="etapa-n">{k + 1}</span>
                <T tag="b" v={e.nome} set={setEtapa(k, 'nome')} ph="Etapa" />
                <T v={e.descricao ?? ''} set={setEtapa(k, 'descricao')} ph="Descrição" />
                {e.prazo_dias ? <span className="etapa-prazo">{e.prazo_dias} dias</span> : null}
              </li>
            ))}
          </ol>
        )}
        {(c.prazo_texto || ed) && <p className="destaque">Prazo: <T v={c.prazo_texto} set={set('prazo_texto')} ph="Ex.: 120 dias corridos a partir do aceite" /></p>}
      </div>
    ),
  });

  const area = areaDaProposta(c);
  const parcelamento = textoParcelamento(c);
  const opcoes = (c.opcoes ?? []).filter((o) => o.valor > 0);
  if (opcoes.length > 1) {
    const idx = (nome: string) => (c.opcoes ?? []).findIndex((o) => o.nome === nome);
    const setO = (nome: string, campo: 'nome' | 'subtitulo') => (s: string) => s && mudar((x) => ({ ...x, opcoes: (x.opcoes ?? []).map((o, j) => (j === idx(nome) ? { ...o, [campo]: s } : o)) }));
    const escolhida = escolha ? (opcoes.find((o) => o.nome === escolha.atual) ?? opcoes.find((o) => o.principal))?.nome : null;
    paginas.push({
      id: 'pacotes', nome: 'Escolha do pacote',
      titulo: 'Escolha o seu pacote',
      conteudo: (
        <div className={`opcoes-doc${escolha ? ' escolhivel' : ''}`} style={{ gridTemplateColumns: `repeat(${opcoes.length}, 1fr)` }} role={escolha ? 'radiogroup' : undefined} aria-label={escolha ? 'Escolha o seu pacote' : undefined}>
          {opcoes.map((o) => {
            const marcada = escolhida === o.nome;
            const corpo = (
              <>
                {o.recomendado && <span className="opcao-selo">Mais escolhido</span>}
                <T tag="h3" v={o.nome} set={setO(o.nome, 'nome')} ph="Nome do pacote" />
                <T tag="p" className="opcao-sub" v={o.subtitulo} set={setO(o.nome, 'subtitulo')} ph="Para quem é" />
                <V tag="p" className="opcao-valor num" v={o.valor} set={o.principal ? (cent) => mudar((x) => ajustarTotal(x, cent)) : (cent) => mudar((x) => ({ ...x, opcoes: (x.opcoes ?? []).map((z, j) => (j === idx(o.nome) ? { ...z, valor: cent / 100 } : z)) }))} />
                {(valorPorMetro(Math.round(o.valor * 100), area) || parcelamento) && <p className="opcao-ref">{[valorPorMetro(Math.round(o.valor * 100), area), parcelamento].filter(Boolean).join(' · ')}</p>}
                <L itens={o.destaques} set={(v) => mudar((x) => ({ ...x, opcoes: (x.opcoes ?? []).map((z, j) => (j === idx(o.nome) ? { ...z, destaques: v } : z)) }))} ph="O que tem neste pacote" />
                {escolha ? <span className="opcao-marca">{marcada ? '✓ Sua escolha' : 'Escolher este pacote'}</span> : o.principal && <p className="opcao-marca">Detalhado nesta proposta</p>}
              </>
            );
            const cls = `opcao-doc${o.principal ? ' principal' : ''}${o.recomendado ? ' recomendado' : ''}${marcada ? ' marcada' : ''}`;
            return escolha
              ? <button key={o.nome} type="button" role="radio" aria-checked={marcada} className={cls} onClick={() => escolha.aoEscolher(o.nome)}>{corpo}</button>
              : <div key={o.nome} className={cls}>{corpo}</div>;
          })}
        </div>
      ),
    });
  }

  const blocoPagamento = (titulo: boolean) => (
    <div className="pagamento">
      {titulo && <h3>Condições de pagamento</h3>}
      <T tag="p" v={c.pagamento.descricao} set={(s) => mudar((x) => ({ ...x, pagamento: { ...x.pagamento, descricao: s } }))} multi ph="Forma de pagamento (Pix, boleto…)" />
      {(c.condicao_especial || ed) && <T tag="p" className="condicao-especial" v={c.condicao_especial ?? ''} set={set('condicao_especial')} multi ph="Condição especial (opcional)" />}
      <ul>
        {parcelas.map((p, j) => {
          const setP = (campo: 'descricao' | 'quando') => (s: string) => mudar((x) => ({ ...x, pagamento: { ...x.pagamento, parcelas: x.pagamento.parcelas.map((z, i) => (i === j ? { ...z, [campo]: s } : z)) } }));
          return (
            <li key={j}>
              <span><T v={p.descricao} set={setP('descricao')} ph="Parcela" />{(p.quando || ed) ? <span className="muted"> · <T v={p.quando ?? ''} set={setP('quando')} ph="quando" /></span> : null}</span>
              <V tag="b" className="num" v={p.valor} set={(cent) => mudar((x) => ({ ...x, pagamento: { ...x.pagamento, parcelas: x.pagamento.parcelas.map((z, i) => (i === j ? { ...z, valor: cent / 100 } : z)) } }))} />
            </li>
          );
        })}
      </ul>
    </div>
  );

  paginasValores.forEach((pg, k) => {
    const ultima = k === paginasValores.length - 1;
    const junto = ultima && pagamentoJunto;
    paginas.push({
      id: 'investimento', nome: 'Investimento',
      titulo: paginasValores.length > 1 ? `Investimento (${k + 1}/${paginasValores.length})` : 'Investimento',
      conteudo: (
        <div className={junto ? 'investimento' : ''}>
          <table className="tabela-doc">
            <tbody>
              {pg.map(({ amb, item, ai, ii }, ix) =>
                item === null ? (
                  <tr key={`a-${amb.id ?? ix}`} className="amb"><td>{amb.nome}</td><td /><td className="num">{formatar(totalAmbiente(amb))}</td></tr>
                ) : (
                  <tr key={item.id ?? `i-${ix}`}>
                    <td><T v={item.titulo} set={(s) => s && mudar((x) => mudarItem(x, ai, ii, (i) => ({ ...i, titulo: s })))} ph="Serviço" /></td>
                    <td className="muted">{qtd(item)}</td>
                    <td className="num"><V v={totalItem(item)} set={mudarValor(ai, ii)} /></td>
                  </tr>
                ),
              )}
            </tbody>
            {ultima && <tfoot><tr><td>Total</td><td /><td className="num"><V v={total / 100} set={(cent) => mudar((x) => ajustarTotal(x, cent))} /></td></tr></tfoot>}
          </table>
          {junto && blocoPagamento(true)}
        </div>
      ),
    });
  });

  if (parcelas.length > 0 && !pagamentoJunto) {
    paginas.push({
      id: 'pagamento', nome: 'Condições de pagamento',
      titulo: 'Condições de pagamento',
      conteudo: (
        <div className="pagamento-pagina">
          <div className="pagamento-total"><span>Investimento total</span><b className="num">{formatar(total)}</b>{c.opcoes?.find((o) => o.principal) && <small>pacote {c.opcoes.find((o) => o.principal)!.nome}</small>}</div>
          {blocoPagamento(false)}
        </div>
      ),
    });
  }

  if (d.tipo !== 'aditivo') {
    paginas.push({
      id: 'compromissos', nome: 'Nossos compromissos',
      titulo: 'Nossos compromissos com você',
      conteudo: (
        <div className="compromissos">
          <L ordenada className="compromissos-lista" itens={c.compromissos ?? compromissosPadrao(c)} set={set('compromissos')} ph="Compromisso" />
          {(c.garantia || ed) && <p className="compromissos-garantia"><b>Garantia</b> <T v={c.garantia} set={set('garantia')} multi ph="Ex.: 12 meses para os serviços executados" /></p>}
        </div>
      ),
    });
  }

  if ((c.diferenciais ?? []).length > 0) {
    const setD = (k: number, campo: 'titulo' | 'texto') => (s: string) => mudar((x) => ({ ...x, diferenciais: (x.diferenciais ?? []).map((m, j) => (j === k ? { ...m, [campo]: s } : m)) }));
    paginas.push({
      id: 'porque', nome: 'Por que a ROSAE',
      titulo: 'Por que a ROSAE',
      conteudo: (
        <div className="porque">
          <div className="porque-grade">
            {c.diferenciais!.map((x, k) => <div key={k}><T tag="b" v={x.titulo} set={setD(k, 'titulo')} ph="Diferencial" /><T v={x.texto} set={setD(k, 'texto')} multi ph="Explicação" /></div>)}
          </div>
          {(c.normas ?? []).length > 0 && (
            <div className="normas"><h3>Normas técnicas que seguimos</h3><L itens={c.normas!} set={set('normas')} ph="Norma" /></div>
          )}
        </div>
      ),
    });
  }

  const depoimentos = (c.depoimentos ?? []).filter((x) => x.trim());
  if (depoimentos.length > 0 || ed) {
    paginas.push({
      id: 'depoimentos', nome: 'Quem já confiou',
      titulo: 'Quem já confiou na ROSAE',
      conteudo: ed ? (
        <div className="depoimentos editando-dep">
          {depoimentos.length === 0 && <p className="muted nota-folha">Depoimentos são o gatilho de confiança mais forte. Adicione um ou dois, no formato “texto” — Nome, cidade. Sem nenhum, esta página não aparece para o cliente.</p>}
          <L className="depoimentos-lista" itens={c.depoimentos ?? []} set={set('depoimentos')} ph="“O que o cliente disse” — Nome, cidade" />
        </div>
      ) : (
        <div className="depoimentos">
          {depoimentos.slice(0, 4).map((x, k) => {
            const [texto, autor] = x.split(/\s+[—–-]\s+(?=[^—–-]*$)/);
            return <figure key={k}><blockquote>{texto.replace(/^[“"]|[”"]$/g, '')}</blockquote>{autor && <figcaption>{autor}</figcaption>}</figure>;
          })}
        </div>
      ),
    });
  }

  if ((c.faq ?? []).length > 0) {
    const setF = (k: number, campo: 'pergunta' | 'resposta') => (s: string) => mudar((x) => ({ ...x, faq: (x.faq ?? []).map((m, j) => (j === k ? { ...m, [campo]: s } : m)) }));
    paginas.push({
      id: 'faq', nome: 'Perguntas frequentes',
      titulo: 'Perguntas frequentes',
      conteudo: (
        <div className="faq">
          {c.faq!.slice(0, 6).map((x, k) => <div key={k}><T tag="b" v={x.pergunta} set={setF(k, 'pergunta')} ph="Pergunta" /><T tag="p" v={x.resposta} set={setF(k, 'resposta')} multi ph="Resposta" /></div>)}
        </div>
      ),
    });
  }

  paginas.push({
    id: 'premissas', nome: 'Premissas e condições',
    titulo: 'Premissas e condições',
    conteudo: (
      <div className="duas-colunas">
        <div>
          <h3>Premissas desta proposta</h3>
          <L itens={c.premissas} set={set('premissas')} padrao={['Informações fornecidas pelo cliente até a data de emissão.']} ph="Premissa" />
          {(c.garantia || ed) && <><h3>Garantia</h3><T tag="p" v={c.garantia} set={set('garantia')} multi ph="Ex.: 12 meses para os serviços executados" /></>}
        </div>
        <div>
          <h3>Condições gerais</h3>
          <ul>{condicoes.map((x) => <li key={x}>{x}</li>)}</ul>
          {(c.observacoes || ed) && <T tag="p" className="pre" v={c.observacoes} set={set('observacoes')} multi ph="Observações (opcional)" />}
        </div>
      </div>
    ),
  });

  paginas.push({
    id: 'aceite', nome: 'Aceite e próximos passos',
    titulo: 'Aceite e próximos passos',
    conteudo: (
      <div className="duas-colunas">
        <div>
          <h3>Como aprovar</h3>
          <ol className="passos-aceite">
            <li><b>Hoje, em 2 minutos.</b> {pdf?.aceite ? <>Toque no botão <b>Aceitar esta proposta</b> logo abaixo. Se quiser mudar algo, peça o ajuste pela mesma página.</> : <>Abra o link desta proposta e toque em <b>Aceitar esta proposta</b>. Se quiser mudar algo, peça o ajuste por lá.</>}</li>
            <li><b>Em até 1 dia útil.</b> Enviamos o contrato para assinatura pelo celular e combinamos a data de início.</li>
            <li><b>Durante todo o serviço.</b> Você acompanha cada etapa pelo portal do cliente, com fotos e registros.</li>
          </ol>
          <p className="total-final">Total: <b>{formatar(total)}</b>{parcelamento && <span className="muted"> · {parcelamento}</span>}</p>
          {pdf?.aceite && <a className="pdf-botao" href={pdf.aceite}>Aceitar esta proposta →</a>}
          <p className="validade-aviso">{d.validade ? <>Proposta válida até <b>{formatarData(d.validade)}</b>.</> : <>Proposta válida por <b>{c.validade_dias || 15} dias</b> após o envio.</>} Com o aceite dentro da validade, os valores ficam garantidos e reservamos a sua data de início na agenda.</p>
        </div>
        <div className="assinatura">
          <p><b>{d.empresa?.responsavel ?? 'Responsável técnico'}</b></p>
          <p>{d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'}</p>
          {d.empresa?.registro && <p>{d.empresa.registro}</p>}
          {d.empresa?.cnpj && <p>CNPJ {d.empresa.cnpj}</p>}
          <p>{[d.empresa?.telefone, d.empresa?.email, d.empresa?.site].filter(Boolean).join(' · ')}</p>
          {d.hash && <p className="codigo-verificacao">Código de verificação desta versão:<br />{d.hash.slice(0, 16).toUpperCase()}</p>}
        </div>
      </div>
    ),
  });

  const visiveis = paginas.filter((p) => !paginaOculta(c, p.id));
  const estilo = variaveisDocumento(c.cor) as CSSProperties | undefined;
  const numero = new Map(visiveis.map((p, k) => [p, k + 1]));

  if (!ed) {
    return (
      <div className={`documento-proposta${pdf ? ' para-pdf' : ''}`} style={estilo}>
        {visiveis.map((p, k) => <Slide key={k} n={k + 1} total={visiveis.length} titulo={p.titulo} d={d} classe={p.classe}>{p.conteudo}</Slide>)}
      </div>
    );
  }

  // Modo de edição: barra sobre cada folha (fora da folha) para tirar ou devolver a página.
  let anterior = '';
  return (
    <Ed.Provider value={ed}>
      <div className="documento-proposta editando" style={estilo}>
        {paginas.map((p, k) => {
          const oculta = paginaOculta(c, p.id);
          const opcional = p.id in PAGINAS_OPCIONAIS;
          const primeiraDoGrupo = p.id !== anterior;
          anterior = p.id;
          if (oculta) {
            if (!primeiraDoGrupo) return null;
            return (
              <div key={k} className="pagina-oculta">
                <span><b>{PAGINAS_OPCIONAIS[p.id]}</b> · página tirada da proposta. O cliente não vê.</span>
                <button type="button" className="btn-secundario" onClick={() => mudar((x) => alternarPagina(x, p.id))}>Mostrar de novo</button>
              </div>
            );
          }
          return (
            <div key={k} className="folha-editavel">
              <div className="folha-barra">
                <span className="folha-n">{numero.get(p)}</span>
                <span className="folha-nome">{p.nome}</span>
                <span className="spacer" />
                {opcional && primeiraDoGrupo
                  ? <button type="button" className="btn-link" onClick={() => mudar((x) => alternarPagina(x, p.id))}>Tirar esta página</button>
                  : primeiraDoGrupo && <span className="muted small">Página obrigatória</span>}
              </div>
              <Slide n={numero.get(p) ?? 0} total={visiveis.length} titulo={p.titulo} d={d} classe={p.classe}>{p.conteudo}</Slide>
            </div>
          );
        })}
      </div>
    </Ed.Provider>
  );
}
