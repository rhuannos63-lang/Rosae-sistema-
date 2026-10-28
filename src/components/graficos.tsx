// Gráficos interativos sem biblioteca externa: barras, linhas e áreas num mesmo eixo,
// minigráfico (faísca), ranking em barras e número animado. Dica ao passar o mouse
// ou o dedo, legenda que liga/desliga séries, clique para detalhar e visão em tabela.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { escalaY } from '../core/graficos';

const semMovimento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLargura(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setLargura(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largura] as const;
}

export type Serie = {
  chave: string;
  nome: string;
  cor: string;
  valores: (number | null)[];
  forma?: 'barra' | 'linha' | 'area';
  tracejada?: boolean;
  /** Cor por valor (ex.: positivo/negativo). A legenda usa `cor`. */
  corPorValor?: (v: number) => string;
};

/** Barra com a ponta de dado arredondada (4px) e a base reta no eixo. */
function caminhoBarra(x: number, w: number, base: number, topo: number): string {
  const h = Math.abs(base - topo);
  if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  if (topo <= base) {
    return `M${x},${base}V${topo + r}Q${x},${topo} ${x + r},${topo}H${x + w - r}Q${x + w},${topo} ${x + w},${topo + r}V${base}Z`;
  }
  return `M${x},${base}V${topo - r}Q${x},${topo} ${x + r},${topo}H${x + w - r}Q${x + w},${topo} ${x + w},${topo - r}V${base}Z`;
}

function Chave({ s }: { s: Serie }) {
  return s.forma === 'linha' || s.forma === 'area'
    ? <i className="g-chave-linha" style={{ background: s.cor, opacity: s.tracejada ? 0.7 : 1 }} />
    : <i className="g-chave-barra" style={{ background: s.cor }} />;
}

export function Legenda({ series, ocultas, alternar }: { series: Serie[]; ocultas?: Set<string>; alternar?: (k: string) => void }) {
  return (
    <div className="g-legenda" role="group" aria-label="Séries do gráfico">
      {series.map((s) => {
        const off = ocultas?.has(s.chave);
        return alternar ? (
          <button key={s.chave} type="button" className={off ? 'off' : ''} aria-pressed={!off} onClick={() => alternar(s.chave)} title={off ? 'Mostrar série' : 'Ocultar série'}>
            <Chave s={s} />{s.nome}
          </button>
        ) : (
          <span key={s.chave}><Chave s={s} />{s.nome}</span>
        );
      })}
    </div>
  );
}

type PropsGrafico = {
  rotulos: string[];
  rotulosLongos?: string[];
  series: Serie[];
  formatar: (v: number) => string;
  formatarEixo?: (v: number) => string;
  altura?: number;
  descricao: string;
  selecionado?: number | null;
  aoSelecionar?: (i: number) => void;
  dicaSelecionar?: string;
  marcador?: { indice: number; rotulo: string } | null;
  extraDica?: (i: number) => ReactNode;
  /** Fixa o domínio do eixo Y (ex.: 0–100 na Curva S). */
  dominio?: [number, number];
  legenda?: boolean;
};

/** Barras, linhas e áreas num mesmo eixo, com dica, foco por teclado e clique para detalhar. */
export function Grafico({
  rotulos, rotulosLongos, series, formatar, formatarEixo, altura = 260, descricao, selecionado = null, aoSelecionar, dicaSelecionar,
  marcador, extraDica, dominio, legenda = true,
}: PropsGrafico) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [foco, setFoco] = useState<number | null>(null);
  const alternar = (k: string) => setOcultas((o) => {
    const n = new Set(o);
    if (n.has(k)) n.delete(k);
    else if (series.length - n.size > 1) n.add(k);
    return n;
  });
  const visiveis = series.filter((s) => !ocultas.has(s.chave));
  const barras = visiveis.filter((s) => (s.forma ?? 'barra') === 'barra');
  const linhas = visiveis.filter((s) => s.forma === 'linha' || s.forma === 'area');
  const n = rotulos.length;

  const esc = useMemo(() => {
    if (dominio) {
      const passo = (dominio[1] - dominio[0]) / 4;
      return { min: dominio[0], max: dominio[1], marcas: [0, 1, 2, 3, 4].map((i) => dominio[0] + passo * i) };
    }
    const vals = visiveis.flatMap((s) => s.valores.filter((v): v is number => v !== null));
    return escalaY(vals.length ? vals : [0, 1]);
  }, [visiveis, dominio]);

  const fmtEixo = formatarEixo ?? formatar;
  const margemEsq = Math.min(92, Math.max(...esc.marcas.map((m) => fmtEixo(m).length)) * 6.6 + 12);
  const M = { t: 12, r: 10, b: 28, l: margemEsq };
  const W = Math.max(largura, 240);
  const H = altura;
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const banda = pw / Math.max(1, n);
  const cx = (i: number) => M.l + banda * (i + 0.5);
  const y = (v: number) => M.t + ph - ((v - esc.min) / (esc.max - esc.min || 1)) * ph;
  const y0 = y(Math.max(esc.min, Math.min(esc.max, 0)));
  const k = barras.length;
  const grupo = Math.min(banda * 0.66, k * 30);
  const lb = k ? Math.max(2, (grupo - 2 * (k - 1)) / k) : 0;
  const passoRot = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 58))));
  // A animação de entrada só recomeça quando os dados mudam, não a cada passada do mouse.
  const versao = useMemo(() => visiveis.map((s) => s.chave + s.valores.join(',')).join('|'), [visiveis]);

  const caminho = (s: Serie) => {
    let d = '';
    let aberto = false;
    s.valores.forEach((v, i) => {
      if (v === null) { aberto = false; return; }
      d += `${aberto ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
      aberto = true;
    });
    return d;
  };
  const area = (s: Serie) => {
    const pts = s.valores.map((v, i) => (v === null ? null : [cx(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
    if (pts.length < 2) return '';
    return `M${pts[0][0]},${y0}` + pts.map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join('') + `L${pts[pts.length - 1][0]},${y0}Z`;
  };

  function teclado(e: React.KeyboardEvent) {
    const atual = foco ?? selecionado ?? n - 1;
    if (e.key === 'ArrowRight') { setFoco(Math.min(n - 1, atual + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setFoco(Math.max(0, atual - 1)); e.preventDefault(); }
    else if ((e.key === 'Enter' || e.key === ' ') && aoSelecionar && foco !== null) { aoSelecionar(foco); e.preventDefault(); }
    else if (e.key === 'Escape') setFoco(null);
  }

  const dicaEsq = foco !== null && cx(foco) > W * 0.58;
  const idGrad = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), []);

  return (
    <div className="g-grafico">
      {legenda && series.length > 1 && <Legenda series={series} ocultas={ocultas} alternar={alternar} />}
      <div ref={ref} className="g-area" onPointerLeave={() => setFoco(null)}>
        {largura > 0 && (
          <svg
            width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={descricao} tabIndex={0}
            onKeyDown={teclado} onFocus={() => foco === null && setFoco(selecionado ?? n - 1)} onBlur={() => setFoco(null)}
            className={foco !== null ? 'com-foco' : ''}
          >
            <defs>
              {linhas.filter((s) => s.forma === 'area').map((s) => (
                <linearGradient key={s.chave} id={`${idGrad}-${s.chave}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.cor} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={s.cor} stopOpacity="0.02" />
                </linearGradient>
              ))}
            </defs>
            {/* grade recessiva */}
            {esc.marcas.map((m) => (
              <g key={m}>
                <line x1={M.l} x2={W - M.r} y1={y(m)} y2={y(m)} className={m === 0 ? 'g-zero' : 'g-grade'} />
                <text x={M.l - 8} y={y(m)} dy="0.32em" textAnchor="end" className="g-eixo">{fmtEixo(m)}</text>
              </g>
            ))}
            {selecionado !== null && selecionado >= 0 && selecionado < n && (
              <rect x={M.l + banda * selecionado + 1} y={M.t} width={banda - 2} height={ph} rx="6" className="g-selecionado" />
            )}
            {foco !== null && <rect x={M.l + banda * foco + 1} y={M.t} width={banda - 2} height={ph} rx="6" className="g-banda" />}
            {marcador && marcador.indice >= 0 && marcador.indice < n && (
              <g className="g-marcador">
                <line x1={cx(marcador.indice)} x2={cx(marcador.indice)} y1={M.t} y2={M.t + ph} />
                <text x={cx(marcador.indice) + 5} y={M.t + 10}>{marcador.rotulo}</text>
              </g>
            )}
            <g key={versao}>
              {barras.map((s, si) => s.valores.map((v, i) => {
                if (v === null) return null;
                const x = cx(i) - grupo / 2 + si * (lb + 2);
                const d = caminhoBarra(x, lb, y0, y(v));
                if (!d) return null;
                const apagada = foco !== null && foco !== i;
                return (
                  <path
                    key={`${s.chave}-${i}`} d={d} fill={s.corPorValor ? s.corPorValor(v) : s.cor}
                    className={`g-barra${v < 0 ? ' neg' : ''}${apagada ? ' apagada' : ''}`}
                    style={{ animationDelay: semMovimento() ? '0ms' : `${Math.min(i * 28, 500)}ms` }}
                  />
                );
              }))}
              {linhas.map((s) => (
                <g key={s.chave}>
                  {s.forma === 'area' && <path d={area(s)} fill={`url(#${idGrad}-${s.chave})`} className="g-area-fundo" />}
                  <path d={caminho(s)} fill="none" stroke={s.cor} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round"
                    strokeDasharray={s.tracejada ? '5 5' : undefined} pathLength={s.tracejada ? undefined : 1}
                    className={s.tracejada ? 'g-linha-tracejada' : 'g-linha'} />
                </g>
              ))}
            </g>
            {foco !== null && linhas.map((s) => {
              const v = s.valores[foco];
              return v === null || v === undefined ? null : <circle key={s.chave} cx={cx(foco)} cy={y(v)} r="4.5" fill={s.cor} className="g-ponto" />;
            })}
            {rotulos.map((r, i) => (n - 1 - i) % passoRot === 0 ? (
              <text key={i} x={cx(i)} y={H - 8} textAnchor="middle" className={`g-eixo${i === selecionado || i === foco ? ' forte' : ''}`}>{r}</text>
            ) : null)}
            {/* alvos de toque: a coluna inteira, maior que a marca */}
            {rotulos.map((_, i) => (
              <rect
                key={i} x={M.l + banda * i} y={0} width={banda} height={H} fill="transparent"
                style={{ cursor: aoSelecionar ? 'pointer' : 'default' }}
                onPointerEnter={() => setFoco(i)} onPointerMove={() => foco !== i && setFoco(i)}
                onClick={() => aoSelecionar?.(i)}
              />
            ))}
          </svg>
        )}
        {foco !== null && largura > 0 && (
          <div className="g-dica" style={{ left: dicaEsq ? undefined : cx(foco) + 14, right: dicaEsq ? W - cx(foco) + 14 : undefined, top: 6 }} role="status">
            <div className="g-dica-titulo">{rotulosLongos?.[foco] ?? rotulos[foco]}</div>
            {visiveis.map((s) => {
              const v = s.valores[foco];
              return (
                <div key={s.chave} className="g-dica-linha">
                  <i style={{ background: s.corPorValor && v !== null && v !== undefined ? s.corPorValor(v) : s.cor }} />
                  <b className="num">{v === null || v === undefined ? '—' : formatar(v)}</b>
                  <span>{s.nome}</span>
                </div>
              );
            })}
            {extraDica?.(foco)}
            {aoSelecionar && <div className="g-dica-acao">{dicaSelecionar ?? 'Clique para detalhar'}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** A mesma informação do gráfico, em tabela (acessível e sem depender do mouse). */
export function TabelaDados({ rotulos, series, formatar, cabecalho = '' }: { rotulos: string[]; series: Serie[]; formatar: (v: number) => string; cabecalho?: string }) {
  return (
    <div className="tabela-wrap g-tabela">
      <table className="tabela">
        <thead><tr><th>{cabecalho}</th>{series.map((s) => <th key={s.chave} className="right">{s.nome}</th>)}</tr></thead>
        <tbody>
          {rotulos.map((r, i) => (
            <tr key={i}><td>{r}</td>{series.map((s) => <td key={s.chave} className="right num">{s.valores[i] === null ? '—' : formatar(s.valores[i]!)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Minigráfico de tendência para os indicadores. Passe o mouse para ver cada mês. */
export function Faisca({ valores, rotulos, formatar, cor = 'var(--serie-1)', claro }: { valores: number[]; rotulos: string[]; formatar: (v: number) => string; cor?: string; claro?: boolean }) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const H = 34;
  const n = valores.length;
  if (n < 2) return <div className="faisca" ref={ref} />;
  const lo = Math.min(...valores, 0);
  const hi = Math.max(...valores, 1);
  const x = (i: number) => 3 + (i / (n - 1)) * Math.max(1, largura - 6);
  const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (H - 6);
  const linha = valores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${linha}L${x(n - 1)},${H}L${x(0)},${H}Z`;
  const traco = claro ? 'rgba(255, 255, 255, 0.85)' : cor;
  function mover(e: React.PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    setFoco(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - 3) / Math.max(1, largura - 6)) * (n - 1)))));
  }
  return (
    <div className="faisca" ref={ref} onPointerLeave={() => setFoco(null)}>
      {largura > 0 && (
        <svg width={largura} height={H} onPointerMove={mover} onPointerDown={mover} aria-hidden="true">
          <path d={area} fill={traco} opacity={claro ? 0.16 : 0.1} />
          <path d={linha} fill="none" stroke={traco} strokeWidth="1.75" strokeLinejoin="round" pathLength={1} className="g-linha" />
          {foco !== null ? (
            <>
              <line x1={x(foco)} x2={x(foco)} y1={0} y2={H} stroke={traco} strokeOpacity="0.35" />
              <circle cx={x(foco)} cy={y(valores[foco])} r="3.5" fill={traco} className="g-ponto" />
            </>
          ) : (
            <circle cx={x(n - 1)} cy={y(valores[n - 1])} r="2.75" fill={traco} />
          )}
        </svg>
      )}
      {foco !== null && (
        <div className="faisca-dica" style={{ left: Math.min(Math.max(0, x(foco) - 50), largura - 100) }}>
          <span>{rotulos[foco]}</span> <b className="num">{formatar(valores[foco])}</b>
        </div>
      )}
    </div>
  );
}

export type ItemRanking = { chave: string; nome: string; valor: number; det?: string };

/** Ranking em barras horizontais (uma cor só: aqui a cor mede tamanho, não identidade). */
export function BarrasRanking({ itens, formatar, selecionado, aoSelecionar, total }: { itens: ItemRanking[]; formatar: (v: number) => string; selecionado?: string | null; aoSelecionar?: (k: string) => void; total?: number }) {
  const [pronto, setPronto] = useState(semMovimento());
  const [foco, setFoco] = useState<string | null>(null);
  useEffect(() => { const t = requestAnimationFrame(() => setPronto(true)); return () => cancelAnimationFrame(t); }, []);
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  const soma = total ?? itens.reduce((s, i) => s + Math.abs(i.valor), 0);
  return (
    <ul className="g-ranking" onPointerLeave={() => setFoco(null)}>
      {itens.map((it, idx) => {
        const pct = soma ? (Math.abs(it.valor) / soma) * 100 : 0;
        const sel = selecionado === it.chave;
        return (
          <li key={it.chave} className={`${sel ? 'sel' : ''}${foco && foco !== it.chave ? ' apagado' : ''}`}>
            <button type="button" onClick={() => aoSelecionar?.(it.chave)} onPointerEnter={() => setFoco(it.chave)} onFocus={() => setFoco(it.chave)} onBlur={() => setFoco(null)} disabled={!aoSelecionar} aria-pressed={aoSelecionar ? sel : undefined}>
              <span className="g-rank-nome">{it.nome}{it.det && <small>{it.det}</small>}</span>
              <span className="g-rank-valor num">{formatar(it.valor)} <small>{pct.toLocaleString('pt-BR', { maximumFractionDigits: pct < 10 ? 1 : 0 })}%</small></span>
              <span className="g-rank-trilho"><span style={{ width: pronto ? `${(Math.abs(it.valor) / max) * 100}%` : 0, transitionDelay: `${idx * 40}ms` }} /></span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Número que conta até o valor novo (respeita "reduzir movimento"). */
export function useContagem(alvo: number, duracao = 750): number {
  const [v, setV] = useState(semMovimento() ? alvo : 0);
  const anterior = useRef(semMovimento() ? alvo : 0);
  useEffect(() => {
    if (semMovimento()) { setV(alvo); anterior.current = alvo; return; }
    const de = anterior.current;
    const t0 = performance.now();
    let raf = 0;
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / duracao);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(de + (alvo - de) * e));
      if (p < 1) raf = requestAnimationFrame(passo);
      else anterior.current = alvo;
    };
    raf = requestAnimationFrame(passo);
    return () => { cancelAnimationFrame(raf); anterior.current = alvo; };
  }, [alvo, duracao]);
  return v;
}

export function NumeroAnimado({ valor, formatar }: { valor: number; formatar: (v: number) => string }) {
  const v = useContagem(valor);
  return <>{formatar(v)}</>;
}

export type FatiaRosca = { chave: string; nome: string; valor: number; cor: string };

/** Rosca (parte do todo) com total no centro, legenda com valores e destaque ao passar o mouse.
 *  Use no máximo 5 fatias: o resto deve vir somado em "Outras". */
export function Rosca({ fatias, formatar, rotuloTotal = 'Total', selecionado, aoSelecionar }: { fatias: FatiaRosca[]; formatar: (v: number) => string; rotuloTotal?: string; selecionado?: string | null; aoSelecionar?: (k: string) => void }) {
  const [foco, setFoco] = useState<string | null>(null);
  const total = fatias.reduce((s, f) => s + Math.max(0, f.valor), 0);
  const R = 70, r = 48, C = 80;
  let ang = -Math.PI / 2;
  const arcos = fatias.map((f) => {
    const a = total ? (Math.max(0, f.valor) / total) * Math.PI * 2 : 0;
    const ini = ang; ang += a;
    return { ...f, ini, fim: ang, pct: total ? (f.valor / total) * 100 : 0 };
  });
  const ponto = (rad: number, a: number) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
  const caminho = (ini: number, fim: number) => {
    const fol = fim - ini > Math.PI ? 1 : 0;
    const f2 = Math.min(fim, ini + Math.PI * 2 - 0.0001);
    return `M${ponto(R, ini)}A${R},${R} 0 ${fol} 1 ${ponto(R, f2)}L${ponto(r, f2)}A${r},${r} 0 ${fol} 0 ${ponto(r, ini)}Z`;
  };
  const ativo = foco ?? selecionado ?? null;
  const fatiaAtiva = arcos.find((f) => f.chave === ativo);
  return (
    <div className="g-rosca">
      <svg viewBox="0 0 160 160" role="img" aria-label={`${rotuloTotal}: ${formatar(total)}`}>
        {arcos.map((f) => f.fim - f.ini > 0.0005 && (
          <path key={f.chave} d={caminho(f.ini, f.fim)} fill={f.cor} stroke="var(--papel)" strokeWidth="2"
            opacity={ativo && ativo !== f.chave ? 0.35 : 1} className="g-rosca-fatia"
            onPointerEnter={() => setFoco(f.chave)} onPointerLeave={() => setFoco(null)} onClick={() => aoSelecionar?.(f.chave)} />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" className="g-rosca-total">{fatiaAtiva ? `${Math.round(fatiaAtiva.pct)}%` : formatarCurto(total, formatar)}</text>
        <text x={C} y={C + 13} textAnchor="middle" className="g-rosca-rotulo">{fatiaAtiva ? fatiaAtiva.nome.slice(0, 18) : rotuloTotal}</text>
      </svg>
      <ul className="g-rosca-legenda">
        {arcos.map((f) => (
          <li key={f.chave} className={ativo === f.chave ? 'sel' : ''}>
            <button type="button" onPointerEnter={() => setFoco(f.chave)} onPointerLeave={() => setFoco(null)} onClick={() => aoSelecionar?.(f.chave)}>
              <i style={{ background: f.cor }} />
              <span className="g-rosca-nome">{f.nome}</span>
              <span className="g-rosca-pct num">{Math.round(f.pct)}%</span>
              <b className="num">{formatar(f.valor)}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
function formatarCurto(v: number, formatar: (v: number) => string) {
  const s = formatar(v);
  return s.length > 11 ? s.replace(/,\d\d$/, '') : s;
}

/** Medidor semicircular de meta (0 a 100%+), com o valor e a meta embaixo. */
export function Medidor({ rotulo, valor, meta, formatar }: { rotulo: string; valor: number; meta: number | null; formatar: (v: number) => string }) {
  const pct = meta ? (valor / meta) * 100 : 0;
  const p = Math.max(0, Math.min(1, pct / 100));
  const anim = useContagem(p * 1000) / 1000;
  const R = 62, C = 80, Y = 78;
  const ponto = (t: number) => `${(C - R * Math.cos(Math.PI * t)).toFixed(2)},${(Y - R * Math.sin(Math.PI * t)).toFixed(2)}`;
  return (
    <div className="g-medidor">
      <svg viewBox="0 0 160 92" role="img" aria-label={meta ? `${rotulo}: ${Math.round(pct)}% da meta` : `${rotulo}: sem meta`}>
        <path d={`M${ponto(0)}A${R},${R} 0 0 1 ${ponto(1)}`} fill="none" stroke="var(--trilho)" strokeWidth="12" strokeLinecap="round" />
        {meta ? <path d={`M${ponto(0)}A${R},${R} 0 0 1 ${ponto(Math.max(0.001, anim))}`} fill="none" stroke={pct >= 100 ? 'var(--favoravel)' : 'var(--verde)'} strokeWidth="12" strokeLinecap="round" /> : null}
        <text x={C} y={Y - 12} textAnchor="middle" className="g-medidor-pct">{meta ? `${Math.round(pct)}%` : '—'}</text>
      </svg>
      <div className="g-medidor-rotulo">{rotulo}</div>
      <div className="g-medidor-det num">{formatar(valor)}{meta ? <span className="muted"> de {formatar(meta)}</span> : <span className="muted"> · sem meta</span>}</div>
    </div>
  );
}
