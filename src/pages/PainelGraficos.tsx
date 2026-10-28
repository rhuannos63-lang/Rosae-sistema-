// Gráficos do painel: fluxo de caixa mês a mês, para onde foi o dinheiro e projeção de caixa.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, Erro } from '../components/ui';
import { BarrasRanking, Grafico, Rosca, TabelaDados, type Serie } from '../components/graficos';
import { Icone } from '../components/Icone';
import { doBanco, formatar, type Centavos } from '../core/dinheiro';
import { acumular, formatarCompacto } from '../core/graficos';
import { formatarData, hoje, nomeMes, nomeMesCurto, periodo, somarDias, somarMeses } from '../core/datas';
import type { VMovimento, VParcela } from '../lib/tipos';

export type SerieMensal = { mes: string; recebido: string; pago: string; vendido: string };
type Visao = 'fluxo' | 'resultado' | 'acumulado';

const NAT_SAIDAS = ['custo_material', 'custo_mao_obra', 'custo_outros', 'despesa_empresa', 'tributo', 'outras_saidas'];
const NAT_ENTRADAS = ['receita_servico', 'reembolso_cliente'];
const corResultado = (v: number) => (v < 0 ? 'var(--desfavoravel)' : 'var(--serie-1)');

/** Fluxo de caixa mês a mês, com três visões, 6/12/24 meses, legenda que liga/desliga e clique no mês. */
export function FluxoCaixa({ fim, aoAbrirMes }: { fim: string; aoAbrirMes: (mes: string) => void }) {
  const [visao, setVisao] = useState<Visao>('fluxo');
  const [meses, setMeses] = useState<6 | 12 | 24>(12);
  const [tabela, setTabela] = useState(false);
  const [sel, setSel] = useState<number | null>(null);

  const { dados, erro, carregando } = useConsulta(async () => {
    const [a, b] = await Promise.all([
      supabase.rpc('serie_mensal', { p_fim: fim }),
      meses === 24 ? supabase.rpc('serie_mensal', { p_fim: somarMeses(fim, -12) }) : Promise.resolve({ data: [], error: null }),
    ]);
    return [...(ok(b) as SerieMensal[]), ...(ok(a) as SerieMensal[])];
  }, [fim, meses === 24]);

  const linhas = useMemo(() => (dados ?? []).slice(-meses).map((s) => ({ mes: s.mes, rec: doBanco(s.recebido), pag: doBanco(s.pago), ven: doBanco(s.vendido) })), [dados, meses]);
  const rotulos = linhas.map((l) => nomeMesCurto(l.mes));
  const longos = linhas.map((l) => nomeMes(l.mes));
  const resultado = linhas.map((l) => l.rec - l.pag);

  const series: Serie[] = visao === 'fluxo'
    ? [
        { chave: 'rec', nome: 'Recebido', cor: 'var(--serie-1)', valores: linhas.map((l) => l.rec) },
        { chave: 'pag', nome: 'Pago', cor: 'var(--serie-2)', valores: linhas.map((l) => l.pag) },
        { chave: 'ven', nome: 'Vendido', cor: 'var(--serie-3)', valores: linhas.map((l) => l.ven), forma: 'linha' },
      ]
    : visao === 'resultado'
      ? [{ chave: 'res', nome: 'Resultado de caixa', cor: 'var(--serie-1)', valores: resultado, corPorValor: corResultado }]
      : [
          { chave: 'rec', nome: 'Recebido acumulado', cor: 'var(--serie-1)', valores: acumular(linhas.map((l) => l.rec)), forma: 'area' },
          { chave: 'pag', nome: 'Pago acumulado', cor: 'var(--serie-2)', valores: acumular(linhas.map((l) => l.pag)), forma: 'area' },
          { chave: 'ven', nome: 'Vendido acumulado', cor: 'var(--serie-3)', valores: acumular(linhas.map((l) => l.ven)), forma: 'linha', tracejada: true },
        ];

  const totRec = linhas.reduce((s, l) => s + l.rec, 0);
  const totPag = linhas.reduce((s, l) => s + l.pag, 0);
  const melhor = linhas.length ? resultado.indexOf(Math.max(...resultado)) : -1;
  const l = sel !== null ? linhas[sel] : null;
  const intervalo = l ? periodo('mes', l.mes) : null;

  return (
    <div className={`card${carregando && dados ? ' g-carregando' : ''}`}>
      <div className="card-titulo">
        <div>
          <h2>Fluxo de caixa <Ajuda>Recebido = dinheiro que entrou de clientes. Pago = saídas de obras e da empresa (sem pró-labore e retiradas). Vendido = propostas e aditivos aprovados. Clique num mês para ver o detalhe.</Ajuda></h2>
          <div className="sub">
            {linhas.length > 0 && <>Últimos {linhas.length} meses: recebido <b className="num">{formatarCompacto(totRec)}</b> · pago <b className="num">{formatarCompacto(totPag)}</b> · resultado <b className="num" style={{ color: totRec - totPag < 0 ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatarCompacto(totRec - totPag)}</b></>}
          </div>
        </div>
        <div className="g-barra-ferramentas">
          <div className="segmentado mini" role="group" aria-label="Visão">
            {([['fluxo', 'Entradas × saídas'], ['resultado', 'Resultado'], ['acumulado', 'Acumulado']] as const).map(([k, r]) => (
              <button key={k} className={visao === k ? 'ativo' : ''} onClick={() => setVisao(k)}>{r}</button>
            ))}
          </div>
          <div className="segmentado mini" role="group" aria-label="Meses">
            {([6, 12, 24] as const).map((m) => <button key={m} className={meses === m ? 'ativo' : ''} onClick={() => { setMeses(m); setSel(null); }}>{m}m</button>)}
          </div>
          <button className={`btn-secundario${tabela ? ' ativo' : ''}`} style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => setTabela((t) => !t)} aria-pressed={tabela}>
            <Icone nome={tabela ? 'grafico' : 'tabela'} /> {tabela ? 'Gráfico' : 'Tabela'}
          </button>
        </div>
      </div>
      <Erro mensagem={erro} />
      {linhas.length > 0 && (tabela ? (
        <TabelaDados rotulos={longos} series={series} formatar={formatar} cabecalho="Mês" />
      ) : (
        <Grafico
          rotulos={rotulos} rotulosLongos={longos} series={series} formatar={formatar} formatarEixo={formatarCompacto}
          descricao="Fluxo de caixa por mês. Use as setas para percorrer os meses e Enter para detalhar."
          selecionado={sel} aoSelecionar={(i) => setSel(sel === i ? null : i)} dicaSelecionar="Clique para detalhar o mês" altura={300}
          extraDica={visao === 'fluxo' ? (i) => (
            <div className="g-dica-extra"><span className="muted">Resultado</span><b className="num" style={{ color: resultado[i] < 0 ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatar(resultado[i])}</b></div>
          ) : undefined}
        />
      ))}
      {visao === 'resultado' && melhor >= 0 && !tabela && (
        <p className="muted small" style={{ margin: '8px 0 0' }}>Melhor mês: <b>{longos[melhor]}</b> ({formatar(resultado[melhor])}). Barras vermelhas são meses em que saiu mais do que entrou.</p>
      )}
      {l && intervalo && (
        <div className="detalhe-mes">
          <div className="row">
            <h3><Icone nome="calendario" /> {nomeMes(l.mes)}</h3>
            <div className="spacer" />
            <button className="btn-secundario" style={{ padding: '6px 11px', fontSize: '0.82rem' }} onClick={() => aoAbrirMes(l.mes)}>Abrir este mês no painel</button>
            <button className="btn-link" onClick={() => setSel(null)} aria-label="Fechar detalhe"><Icone nome="fechar" /></button>
          </div>
          <div className="detalhe-numeros">
            <div><span>Recebido</span><b>{formatar(l.rec)}</b></div>
            <div><span>Pago</span><b>{formatar(l.pag)}</b></div>
            <div><span>Resultado de caixa</span><b style={{ color: l.rec - l.pag < 0 ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatar(l.rec - l.pag)}</b></div>
            <div><span>Vendido</span><b>{formatar(l.ven)}</b></div>
          </div>
          <div className="row small">
            <Link className="chip-link" to={`/contas?grupo=recebido&inicio=${intervalo.inicio}&fim=${intervalo.fim}`}>Ver recebimentos <Icone nome="seta" /></Link>
            <Link className="chip-link" to={`/contas?grupo=pago_obras&inicio=${intervalo.inicio}&fim=${intervalo.fim}`}>Pagamentos de obras <Icone nome="seta" /></Link>
            <Link className="chip-link" to={`/contas?grupo=pago_empresa&inicio=${intervalo.inicio}&fim=${intervalo.fim}`}>Despesas da empresa <Icone nome="seta" /></Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Para onde foi (ou de onde veio) o dinheiro no período, por categoria, com detalhe ao clicar. */
export function ParaOndeFoi({ inicio, fim, rotulo }: { inicio: string; fim: string; rotulo: string }) {
  const [lado, setLado] = useState<'saidas' | 'entradas'>('saidas');
  const [forma, setForma] = useState<'rosca' | 'barras'>('rosca');
  const [sel, setSel] = useState<string | null>(null);
  const { dados, erro, carregando } = useConsulta(async () => {
    const r = await supabase.from('v_movimento').select('id, data, valor_assinado, categoria_nome, categoria_natureza, lancamento_id, lancamento_descricao, descricao, conta_nome')
      .gte('data', inicio).lte('data', fim).in('categoria_natureza', lado === 'saidas' ? NAT_SAIDAS : NAT_ENTRADAS).limit(5000);
    return ok(r) as Pick<VMovimento, 'id' | 'data' | 'valor_assinado' | 'categoria_nome' | 'categoria_natureza' | 'lancamento_id' | 'lancamento_descricao' | 'descricao' | 'conta_nome'>[];
  }, [inicio, fim, lado]);

  const grupos = useMemo(() => {
    const m = new Map<string, { valor: Centavos; qtd: number }>();
    for (const mv of dados ?? []) {
      const v = doBanco(mv.valor_assinado) * (lado === 'saidas' ? -1 : 1);
      const g = m.get(mv.categoria_nome) ?? { valor: 0, qtd: 0 };
      g.valor += v; g.qtd += 1;
      m.set(mv.categoria_nome, g);
    }
    return [...m.entries()].map(([nome, g]) => ({ chave: nome, nome, valor: g.valor, det: `${g.qtd} mov.` })).filter((g) => g.valor !== 0).sort((a, b) => b.valor - a.valor);
  }, [dados, lado]);
  const total = grupos.reduce((s, g) => s + g.valor, 0);
  // Mais de 7 categorias: o resto vira "Outras" para o ranking continuar legível.
  // Na rosca, só 4 fatias com cor própria e o resto somado em "Outras" (cores fixas e legíveis).
  const limite = forma === 'rosca' ? 4 : 6;
  const visiveis = grupos.length > limite + 1 ? [...grupos.slice(0, limite), { chave: '__outras', nome: `Outras (${grupos.length - limite})`, valor: grupos.slice(limite).reduce((s, g) => s + g.valor, 0), det: undefined }] : grupos;
  const CORES = ['var(--serie-1)', 'var(--serie-2)', 'var(--serie-3)', 'var(--serie-4)'];
  const fatias = visiveis.map((g, i) => ({ chave: g.chave, nome: g.nome, valor: g.valor, cor: g.chave === '__outras' ? 'var(--serie-neutra)' : CORES[i] ?? 'var(--serie-neutra)' }));
  const movsSel = useMemo(() => {
    if (!sel) return [];
    const nomes = sel === '__outras' ? new Set(grupos.slice(limite).map((g) => g.chave)) : new Set([sel]);
    return (dados ?? []).filter((m) => nomes.has(m.categoria_nome)).sort((a, b) => Math.abs(doBanco(b.valor_assinado)) - Math.abs(doBanco(a.valor_assinado))).slice(0, 8);
  }, [sel, dados, grupos, limite]);

  return (
    <div className={`card${carregando && dados ? ' g-carregando' : ''}`}>
      <div className="card-titulo">
        <div>
          <h2>{lado === 'saidas' ? 'Para onde foi o dinheiro' : 'De onde veio o dinheiro'}</h2>
          <div className="sub">{rotulo} · total <b className="num">{formatar(total)}</b></div>
        </div>
        <div className="g-barra-ferramentas">
          <div className="segmentado mini" role="group" aria-label="Entradas ou saídas">
            <button className={lado === 'saidas' ? 'ativo' : ''} onClick={() => { setLado('saidas'); setSel(null); }}>Saídas</button>
            <button className={lado === 'entradas' ? 'ativo' : ''} onClick={() => { setLado('entradas'); setSel(null); }}>Entradas</button>
          </div>
          <div className="segmentado mini" role="group" aria-label="Forma do gráfico">
            <button className={forma === 'rosca' ? 'ativo' : ''} onClick={() => { setForma('rosca'); setSel(null); }} aria-label="Rosca" title="Rosca"><Icone nome="planejador" /></button>
            <button className={forma === 'barras' ? 'ativo' : ''} onClick={() => { setForma('barras'); setSel(null); }} aria-label="Barras" title="Barras"><Icone nome="lista" /></button>
          </div>
        </div>
      </div>
      <Erro mensagem={erro} />
      {dados && !grupos.length && <p className="muted" style={{ margin: 0 }}>Nenhum movimento {lado === 'saidas' ? 'de saída' : 'de entrada'} no período.</p>}
      {grupos.length > 0 && (forma === 'rosca'
        ? <Rosca key={lado + inicio} fatias={fatias} formatar={formatar} rotuloTotal={lado === 'saidas' ? 'Saídas' : 'Entradas'} selecionado={sel} aoSelecionar={(k) => setSel(sel === k ? null : k)} />
        : <BarrasRanking key={lado + inicio} itens={visiveis} formatar={formatar} total={total} selecionado={sel} aoSelecionar={(k) => setSel(sel === k ? null : k)} />)}
      {sel && (
        <div className="detalhe-mes" style={{ marginTop: 10 }}>
          <div className="row"><b>{sel === '__outras' ? 'Outras categorias' : sel}</b><div className="spacer" /><span className="muted small">maiores movimentos</span></div>
          <ul className="lista-mov">
            {movsSel.map((m) => (
              <li key={m.id}>
                {m.lancamento_id ? <Link to={`/financeiro/${m.lancamento_id}`}>{m.lancamento_descricao ?? m.descricao ?? 'Movimento'}</Link> : <span>{m.descricao ?? 'Movimento'}</span>}
                <span className="num">{formatarData(m.data).slice(0, 5)} · <b>{formatar(Math.abs(doBanco(m.valor_assinado)))}</b></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Próximas 8 semanas: a receber, a pagar e o saldo projetado a partir do saldo de hoje. */
export function ProjecaoCaixa({ saldoHoje }: { saldoHoje: Centavos }) {
  const [sel, setSel] = useState<number | null>(null);
  const hj = hoje();
  const limite = somarDias(hj, 55);
  const { dados, erro } = useConsulta(async () => ok(await supabase.from('v_parcela')
    .select('id, lancamento_id, tipo, vencimento, saldo, descricao, pessoa_nome, obra_codigo, situacao')
    .in('situacao', ['aberta', 'parcial', 'vencida']).eq('cancelado', false).lte('vencimento', limite).limit(3000)) as VParcela[], [limite]);

  const semanas = useMemo(() => Array.from({ length: 8 }, (_, i) => ({ ini: somarDias(hj, i * 7), fim: somarDias(hj, i * 7 + 6) })), [hj]);
  const baldes = useMemo(() => {
    const b = semanas.map(() => ({ rec: 0, pag: 0, itens: [] as VParcela[] }));
    for (const p of dados ?? []) {
      const i = p.vencimento < hj ? 0 : Math.floor((Date.parse(p.vencimento) - Date.parse(hj)) / (7 * 86400000));
      if (i < 0 || i > 7) continue;
      const v = doBanco(p.saldo);
      if (p.tipo === 'receber') b[i].rec += v; else b[i].pag += v;
      b[i].itens.push(p);
    }
    return b;
  }, [dados, semanas, hj]);
  const saldo = acumular(baldes.map((b) => b.rec - b.pag)).map((v) => saldoHoje + v);
  const minimo = saldo.length ? Math.min(...saldo) : 0;
  const rotulos = semanas.map((s, i) => (i === 0 ? 'Esta sem.' : formatarData(s.ini).slice(0, 5)));
  const longos = semanas.map((s, i) => `${i === 0 ? 'Vencidos + ' : ''}${formatarData(s.ini).slice(0, 5)} a ${formatarData(s.fim).slice(0, 5)}`);
  const series: Serie[] = [
    { chave: 'rec', nome: 'A receber', cor: 'var(--serie-1)', valores: baldes.map((b) => b.rec) },
    { chave: 'pag', nome: 'A pagar', cor: 'var(--serie-2)', valores: baldes.map((b) => b.pag) },
    { chave: 'saldo', nome: 'Saldo projetado', cor: 'var(--serie-3)', valores: saldo, forma: 'linha' },
  ];
  const itens = sel !== null ? [...baldes[sel].itens].sort((a, b) => a.vencimento.localeCompare(b.vencimento)) : [];

  return (
    <div className="card">
      <div className="card-titulo">
        <div>
          <h2>Projeção de caixa <Ajuda>Parte do saldo de hoje nas contas e soma o que vence a receber e a pagar em cada semana (vencidos entram na primeira). É uma projeção: depende de os clientes pagarem em dia.</Ajuda></h2>
          <div className="sub">Próximas 8 semanas</div>
        </div>
      </div>
      <Erro mensagem={erro} />
      <div className="resumo-projecao">
        <div><span>Saldo hoje</span><b>{formatar(saldoHoje)}</b></div>
        <div><span>Em 8 semanas</span><b style={{ color: saldo[7] < 0 ? 'var(--desfavoravel)' : undefined }}>{formatar(saldo[7] ?? saldoHoje)}</b></div>
        <div><span>Menor saldo previsto</span><b style={{ color: minimo < 0 ? 'var(--desfavoravel)' : undefined }}>{formatar(minimo)}</b></div>
      </div>
      {minimo < 0 && <div className="aviso erro" style={{ marginBottom: 10 }}><Icone nome="alerta" /><span>O saldo fica negativo em <b>{longos[saldo.findIndex((s) => s < 0)]}</b>. Antecipe recebimentos ou renegocie vencimentos.</span></div>}
      <Grafico
        rotulos={rotulos} rotulosLongos={longos} series={series} formatar={formatar} formatarEixo={formatarCompacto} altura={230}
        descricao="Projeção semanal de caixa" selecionado={sel} aoSelecionar={(i) => setSel(sel === i ? null : i)} dicaSelecionar="Clique para ver as contas da semana"
      />
      {sel !== null && (
        <div className="detalhe-mes">
          <div className="row"><b>{longos[sel]}</b><div className="spacer" /><button className="btn-link" onClick={() => setSel(null)} aria-label="Fechar"><Icone nome="fechar" /></button></div>
          {!itens.length ? <p className="muted small" style={{ margin: '6px 0 0' }}>Nada vence nesta semana.</p> : (
            <ul className="lista-mov">
              {itens.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <Link to={`/financeiro/${p.lancamento_id}`}>
                    <span className={`selo ${p.tipo === 'receber' ? 'ok' : 'alerta'}`} style={{ marginRight: 8 }}>{p.tipo === 'receber' ? 'Receber' : 'Pagar'}</span>
                    {p.descricao}{p.pessoa_nome ? <span className="muted"> · {p.pessoa_nome}</span> : null}
                  </Link>
                  <span className="num">{p.situacao === 'vencida' ? <span className="desfavoravel">venceu {formatarData(p.vencimento).slice(0, 5)}</span> : formatarData(p.vencimento).slice(0, 5)} · <b>{formatar(doBanco(p.saldo))}</b></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
