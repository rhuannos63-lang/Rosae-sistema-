import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo, useDepartamentos } from '../components/Layout';
import { Ajuda, Carregando, Erro } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, type Centavos } from '../core/dinheiro';
import { deslocarPeriodo, hoje, nomeMesCurto, periodo } from '../core/datas';
import type { Empresa } from '../lib/tipos';
import { LinhaPendencia, usePendencias } from './Pendencias';
import { Faisca, Medidor, NumeroAnimado } from '../components/graficos';
import { formatarCompacto } from '../core/graficos';
import { FluxoCaixa, ParaOndeFoi, ProjecaoCaixa } from './PainelGraficos';

type Comercial = { enviadas: number; em_negociacao: number; aprovadas_periodo: number; recusadas_periodo: number; rascunhos: number; oportunidades_abertas: number; acoes_atrasadas: number; cliques_whatsapp: number; formularios: number };
type Indicadores = Record<string, string | number | boolean | null | Comercial> & { sem_permissao?: boolean; gerencial?: boolean; comercial?: Comercial | null };

function KpisComerciais({ c }: { c: Comercial | null | undefined }) {
  if (!c) return null;
  return (
    <>
      <Kpi rotulo="Propostas em aberto" valor={String(c.enviadas + c.em_negociacao)} det={<>{c.em_negociacao} em negociação · {c.rascunhos} rascunho(s) · {c.aprovadas_periodo} aprovada(s) no período</>} para="/propostas" />
      <Kpi rotulo="Oportunidades" valor={String(c.oportunidades_abertas)} det={c.acoes_atrasadas > 0 ? <span style={{ color: 'var(--desfavoravel)' }}>{c.acoes_atrasadas} com ação atrasada</span> : 'Nenhuma ação atrasada'} para="/comercial" ajuda="Contatos em andamento no funil. Formulários do site e cliques no WhatsApp do período aparecem no Comercial." />
    </>
  );
}
type Serie = { mes: string; recebido: string; pago: string; vendido: string };
type TipoPeriodo = 'mes' | 'semestre' | 'ano';

type Tendencia = { valores: number[]; rotulos: string[] };

function Kpi({ rotulo, valor, centavos, det, para, ajuda, destaque, meta, tendencia }: { rotulo: string; valor: string; centavos?: Centavos; det?: React.ReactNode; para?: string; ajuda?: string; destaque?: boolean; meta?: number | null; tendencia?: Tendencia }) {
  const conteudo = (
    <>
      <div className="rotulo">
        {rotulo}
        {ajuda && <Ajuda>{ajuda}</Ajuda>}
      </div>
      <div className="valor">{centavos !== undefined ? <NumeroAnimado valor={centavos} formatar={formatar} /> : valor}</div>
      {det && <div className="det">{det}</div>}
      {tendencia && tendencia.valores.length > 1 && <Faisca valores={tendencia.valores} rotulos={tendencia.rotulos} formatar={formatarCompacto} claro={destaque} />}
      {meta !== undefined && meta !== null && (
        <div className="barra-meta" aria-label={`${Math.round(meta)}% da meta`}>
          <div style={{ width: `${Math.min(100, Math.max(0, meta))}%` }} />
        </div>
      )}
      {para && <Icone nome="seta" className="seta" />}
    </>
  );
  return para ? (
    <Link to={para} className={`kpi${destaque ? ' destaque' : ''}`}>{conteudo}</Link>
  ) : (
    <div className={`kpi${destaque ? ' destaque' : ''}`}>{conteudo}</div>
  );
}

/** Indicador no estilo de painel de BI: rótulo, número grande, variação contra o período anterior e tendência. */
function KpiBI({ rotulo, centavos, anterior, rotuloAnt, custo, tendencia, para, ajuda, det }: { rotulo: string; centavos: Centavos; anterior?: Centavos | null; rotuloAnt?: string; custo?: boolean; tendencia?: Tendencia; para?: string; ajuda?: string; det?: React.ReactNode }) {
  let variacao: React.ReactNode = null;
  if (anterior !== undefined && anterior !== null && anterior !== 0) {
    const pct = Math.round(((centavos - anterior) / Math.abs(anterior)) * 1000) / 10;
    const fav = pct === 0 ? null : custo ? pct < 0 : pct > 0;
    variacao = (
      <span className={`bi-var${fav === null ? '' : fav ? ' fav' : ' desfav'}`} title={`Comparado com ${rotuloAnt}`}>
        {pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} {String(Math.abs(pct)).replace('.', ',')}% <span className="muted">vs {rotuloAnt}</span>
      </span>
    );
  } else if (anterior === 0 && rotuloAnt) {
    variacao = <span className="bi-var"><span className="muted">sem base em {rotuloAnt}</span></span>;
  }
  const conteudo = (
    <>
      <div className="rotulo">{rotulo}{ajuda && <Ajuda>{ajuda}</Ajuda>}</div>
      <div className="valor" style={centavos < 0 ? { color: 'var(--desfavoravel)' } : undefined}><NumeroAnimado valor={centavos} formatar={formatar} /></div>
      {variacao}
      {det && <div className="det">{det}</div>}
      {tendencia && tendencia.valores.length > 1 && <Faisca valores={tendencia.valores} rotulos={tendencia.rotulos} formatar={formatarCompacto} />}
      {para && <Icone nome="seta" className="seta" />}
    </>
  );
  return para ? <Link to={para} className="kpi bi-kpi">{conteudo}</Link> : <div className="kpi bi-kpi">{conteudo}</div>;
}

/** Faixa de números menores, lado a lado, como os cartões de um painel de BI. */
function Faixa({ itens }: { itens: { rotulo: string; valor: React.ReactNode; det?: React.ReactNode; para?: string; alerta?: boolean }[] }) {
  return (
    <div className="card bi-faixa" style={{ '--colunas': itens.length <= 4 ? itens.length : Math.ceil(itens.length / 2) } as React.CSSProperties}>
      {itens.map((i) => {
        const corpo = (<><span className="bi-faixa-rotulo">{i.rotulo}</span><b className="num">{i.valor}</b>{i.det && <span className={`bi-faixa-det${i.alerta ? ' alerta' : ''}`}>{i.det}</span>}</>);
        return i.para ? <Link key={i.rotulo} to={i.para} className="bi-faixa-item">{corpo}</Link> : <div key={i.rotulo} className="bi-faixa-item">{corpo}</div>;
      })}
    </div>
  );
}

function saudacao(): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export function Painel() {
  const { podeFinanceiro, usuario, ehAdmin } = useAuth();
  const [tipo, setTipo] = useState<TipoPeriodo>('mes');
  const [ref, setRef] = useState(hoje());
  const p = periodo(tipo, ref);

  const { dados, erro, carregando } = useConsulta(async () => {
    const pa = periodo(tipo, deslocarPeriodo(tipo, ref, -1));
    const py = periodo(tipo, deslocarPeriodo('ano', ref, -1));
    const [ind, serie, empresa, ant, anoAnt] = await Promise.all([
      supabase.rpc('painel_indicadores', { p_inicio: p.inicio, p_fim: p.fim }),
      podeFinanceiro ? supabase.rpc('serie_mensal', { p_fim: p.fim }) : Promise.resolve({ data: [], error: null }),
      supabase.from('empresa').select('*').maybeSingle(),
      podeFinanceiro ? supabase.rpc('painel_indicadores', { p_inicio: pa.inicio, p_fim: pa.fim }) : Promise.resolve({ data: null, error: null }),
      podeFinanceiro ? supabase.rpc('painel_indicadores', { p_inicio: py.inicio, p_fim: py.fim }) : Promise.resolve({ data: null, error: null }),
    ]);
    return {
      ind: ok(ind) as Indicadores, serie: (ok(serie) ?? []) as Serie[], empresa: ok(empresa) as Empresa | null,
      comparar: ok(ant) ? { anterior: ok(ant) as Indicadores, anoAnterior: ok(anoAnt) as Indicadores, rotuloAnt: pa.rotulo, rotuloAno: py.rotulo } : null,
    };
  }, [p.inicio, p.fim, podeFinanceiro]);

  const primeiroNome = usuario?.nome.split(' ')[0] ?? '';
  const qs = `inicio=${p.inicio}&fim=${p.fim}`;

  return (
    <>
      <Topo titulo={`${saudacao()}, ${primeiroNome}`} sub={<>Situação da ROSAE · {p.rotulo}</>}>
        <div className="segmentado" role="group" aria-label="Período">
          {(['mes', 'semestre', 'ano'] as TipoPeriodo[]).map((t) => (
            <button key={t} className={tipo === t ? 'ativo' : ''} onClick={() => setTipo(t)}>
              {t === 'mes' ? 'Mês' : t === 'semestre' ? 'Semestre' : 'Ano'}
            </button>
          ))}
        </div>
        <button className="btn-secundario" aria-label="Período anterior" onClick={() => setRef(deslocarPeriodo(tipo, ref, -1))}>‹</button>
        <button className="btn-secundario" aria-label="Próximo período" onClick={() => setRef(deslocarPeriodo(tipo, ref, 1))}>›</button>
      </Topo>
      <AtalhosDepartamentos />
      <Erro mensagem={erro} />
      {carregando && !dados && <Carregando />}
      {dados && (
        <ConteudoPainel
          anterior={dados.comparar?.anterior ?? null} rotuloAnt={dados.comparar?.rotuloAnt}
          ind={dados.ind} serie={dados.serie} empresa={dados.empresa} qs={qs} rotulo={p.rotulo} tipo={tipo} ehAdmin={ehAdmin} inicio={p.inicio} fim={p.fim}
          aoAbrirMes={(mes) => { setTipo('mes'); setRef(mes); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        />
      )}
      {dados?.comparar && !dados.ind.sem_permissao && <Comparativo atual={dados.ind} {...dados.comparar} rotulo={p.rotulo} />}
    </>
  );
}

/** Entrada rápida nos departamentos (pastas) logo abaixo do título. */
function AtalhosDepartamentos() {
  const deps = useDepartamentos();
  return (
    <nav className="dep-atalhos" aria-label="Departamentos">
      {deps.map((d) => (
        <Link key={d.id} to={`/d/${d.id}`} className="dep-atalho">
          <span className="dep-pasta-icone"><Icone nome={d.icone} /></span>
          <span className="dep-pasta-texto"><b>{d.nome}</b><span>{d.subpastas.length} subpastas</span></span>
        </Link>
      ))}
    </nav>
  );
}

function ConteudoPainel({ ind, serie, qs, rotulo, tipo, inicio, fim, aoAbrirMes, anterior, rotuloAnt }: { anterior: Indicadores | null; rotuloAnt?: string; ind: Indicadores; serie: Serie[]; empresa: Empresa | null; qs: string; rotulo: string; tipo: TipoPeriodo; ehAdmin: boolean; inicio: string; fim: string; aoAbrirMes: (mes: string) => void }) {
  if (ind.sem_permissao) {
    return (
      <div className="grid grid-kpi">
        <Kpi rotulo="Obras ativas" valor={String(ind.obras_ativas)} para="/obras" />
        <KpisComerciais c={ind.comercial} />
        <div className="aviso info" style={{ gridColumn: '1 / -1' }}>Os números financeiros aparecem só para quem tem acesso ao financeiro.</div>
      </div>
    );
  }
  const c = (k: string) => doBanco(ind[k] as string);
  const meses = tipo === 'mes' ? 1 : tipo === 'semestre' ? 6 : 12;
  const metaRec = ind.meta_recebimentos === null ? null : c('meta_recebimentos') * meses;
  const metaVen = ind.meta_vendas === null ? null : c('meta_vendas') * meses;
  const resultadoCaixa = c('recebido') - c('pago_obras') - c('pago_empresa');
  const ca = (k: string) => (anterior ? doBanco(anterior[k] as string) : null);
  const caixaDe = (i: Indicadores) => doBanco(i.recebido as string) - doBanco(i.pago_obras as string) - doBanco(i.pago_empresa as string);
  const rotulosSerie = serie.map((s) => nomeMesCurto(s.mes));
  const tend = (f: (s: Serie) => Centavos): Tendencia => ({ valores: serie.map(f), rotulos: rotulosSerie });
  const tRec = tend((s) => doBanco(s.recebido));
  const tVen = tend((s) => doBanco(s.vendido));
  const tRes = tend((s) => doBanco(s.recebido) - doBanco(s.pago));

  return (
    <>
      {ind.gerencial && (
        <div className="aviso info" style={{ marginBottom: 14 }}>
          <span>
            Valores <b>gerenciais (estimados)</b>: ainda não há regra de reconhecimento de receita configurada. Vendido, recebido e resultado são números diferentes e aparecem separados.
          </span>
        </div>
      )}
      <div className="bi-kpis">
        <KpiBI
          rotulo="Recebido de clientes" centavos={c('recebido')} anterior={ca('recebido')} rotuloAnt={rotuloAnt} tendencia={tRec}
          para={`/contas?grupo=recebido&${qs}`}
          ajuda="Dinheiro que de fato entrou de clientes no período (recebimentos registrados, já descontados estornos). Não inclui transferências entre suas contas nem rendimentos."
        />
        <KpiBI
          rotulo="Vendido (contratado)" centavos={c('vendido')} anterior={ca('vendido')} rotuloAnt={rotuloAnt} tendencia={tVen}
          para="/propostas?estado=aprovada"
          ajuda="Propostas e aditivos aceitos pelo cliente no período (versão aprovada), mais obras lançadas sem proposta pela data de contratação. Vendido não é dinheiro em caixa."
        />
        <KpiBI
          rotulo="Resultado de caixa" centavos={resultadoCaixa} anterior={anterior ? caixaDe(anterior) : null} rotuloAnt={rotuloAnt} tendencia={tRes}
          para={`/contas?grupo=operacional&${qs}`}
          ajuda="Critério: regime de caixa, só o que entrou e saiu no período (recebido − pago em obras − despesas da empresa). Não é lucro contábil."
        />
        <KpiBI
          rotulo="Saldo nas contas" centavos={c('saldo_contas')} det="Hoje, somando todas as contas ativas" para="/contas"
        />
      </div>

      <Faixa itens={[
        { rotulo: 'A receber', valor: formatar(c('a_receber')), det: c('a_receber_vencido') > 0 ? `${formatar(c('a_receber_vencido'))} vencido` : 'Nada vencido', alerta: c('a_receber_vencido') > 0, para: '/financeiro?tipo=receber&situacao=abertas' },
        { rotulo: 'A pagar', valor: formatar(c('a_pagar')), det: `${formatar(c('a_pagar_7_dias'))} em 7 dias`, para: '/financeiro?tipo=pagar&situacao=abertas' },
        { rotulo: 'Pago em obras', valor: formatar(c('pago_obras')), det: 'Material e parceiros', para: `/contas?grupo=pago_obras&${qs}` },
        { rotulo: 'Despesas da empresa', valor: formatar(c('pago_empresa')), det: 'Pagas no período', para: `/contas?grupo=pago_empresa&${qs}` },
        { rotulo: 'Pró-labore', valor: formatar(c('retiradas')), det: 'Retiradas', para: `/contas?grupo=retiradas&${qs}` },
        { rotulo: 'Obras ativas', valor: String(ind.obras_ativas), det: 'Contratadas ou em execução', para: '/obras' },
        ...(ind.comercial ? [
          { rotulo: 'Propostas em aberto', valor: String(ind.comercial.enviadas + ind.comercial.em_negociacao), det: `${ind.comercial.aprovadas_periodo} aprovada(s)`, para: '/propostas' },
          { rotulo: 'Oportunidades', valor: String(ind.comercial.oportunidades_abertas), det: ind.comercial.acoes_atrasadas > 0 ? `${ind.comercial.acoes_atrasadas} atrasada(s)` : 'Em dia', alerta: ind.comercial.acoes_atrasadas > 0, para: '/comercial' },
        ] : []),
        ...(c('outras_entradas') !== 0 ? [{ rotulo: 'Outras entradas', valor: formatar(c('outras_entradas')), det: 'Rendimentos e aportes', para: `/contas?grupo=outras&${qs}` }] : []),
      ]} />

      <div className="grid bi-linha section">
        <FluxoCaixa fim={fim} aoAbrirMes={aoAbrirMes} />
        <ParaOndeFoi inicio={inicio} fim={fim} rotulo={rotulo} />
      </div>
      <div className="grid bi-linha section">
        <ProjecaoCaixa saldoHoje={c('saldo_contas')} />
        <div className="card">
          <div className="card-titulo">
            <div><h2>Metas do período</h2><div className="sub">{rotulo}</div></div>
            {(metaRec === null || metaVen === null) && <Link to="/configuracoes" className="small">Definir metas</Link>}
          </div>
          <div className="bi-medidores">
            <Medidor rotulo="Recebimentos" valor={c('recebido')} meta={metaRec} formatar={formatarCompacto} />
            <Medidor rotulo="Vendas" valor={c('vendido')} meta={metaVen} formatar={formatarCompacto} />
          </div>
        </div>
      </div>
      <div className="card section">
        <div className="card-titulo">
          <h2>Pendências</h2>
          <Link to="/pendencias" className="small">Ver todas</Link>
        </div>
        <ResumoPendencias />
      </div>
    </>
  );
}

function Comparativo({ atual, anterior, anoAnterior, rotulo, rotuloAnt, rotuloAno }: { atual: Indicadores; anterior: Indicadores; anoAnterior: Indicadores; rotulo: string; rotuloAnt: string; rotuloAno: string }) {
  const v = (i: Indicadores, k: string) => doBanco(i[k] as string);
  const caixa = (i: Indicadores) => v(i, 'recebido') - v(i, 'pago_obras') - v(i, 'pago_empresa');
  const linhas: { rotulo: string; f: (i: Indicadores) => Centavos; custo?: boolean }[] = [
    { rotulo: 'Vendido', f: (i) => v(i, 'vendido') },
    { rotulo: 'Recebido de clientes', f: (i) => v(i, 'recebido') },
    { rotulo: 'Pago em obras', f: (i) => v(i, 'pago_obras'), custo: true },
    { rotulo: 'Despesas da empresa', f: (i) => v(i, 'pago_empresa'), custo: true },
    { rotulo: 'Resultado de caixa (gerencial)', f: caixa },
  ];
  const delta = (a: Centavos, b: Centavos, custo?: boolean) => {
    if (b === 0) return <span className="muted small">—</span>;
    const pct = Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
    const fav = custo ? pct < 0 : pct > 0;
    return <span className="small" style={{ color: pct === 0 ? undefined : fav ? 'var(--favoravel)' : 'var(--desfavoravel)' }}>{pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {String(Math.abs(pct)).replace('.', ',')}%</span>;
  };
  return (
    <div className="card section">
      <div className="card-titulo"><h2>Comparativo</h2><span className="muted small">{rotulo} × {rotuloAnt} × {rotuloAno}</span></div>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th /><th className="right">{rotulo}</th><th className="right">{rotuloAnt}</th><th className="right">{rotuloAno}</th></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo}>
                <td>{l.rotulo}</td>
                <td className="right num"><b>{formatar(l.f(atual))}</b></td>
                <td className="right num">{formatar(l.f(anterior))} {delta(l.f(atual), l.f(anterior), l.custo)}</td>
                <td className="right num">{formatar(l.f(anoAnterior))} {delta(l.f(atual), l.f(anoAnterior), l.custo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>Percentuais comparam o período atual com cada coluna. Mais recebimento não significa mais lucro: confira custos e o resultado por obra.</p>
    </div>
  );
}

function ResumoPendencias() {
  const { dados, erro } = usePendencias();
  if (erro) return <p className="muted small">{erro}</p>;
  if (!dados) return <p className="muted small">Carregando…</p>;
  if (!dados.length) return <p className="muted" style={{ margin: 0 }}>Nada exigindo ação agora.</p>;
  return (
    <>
      <ul className="lista-adm">{dados.slice(0, 6).map((i) => <LinhaPendencia key={i.chave} i={i} />)}</ul>
      {dados.length > 6 && <Link to="/pendencias" className="small">Mais {dados.length - 6} na central de pendências</Link>}
    </>
  );
}
