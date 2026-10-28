// Manual do sistema: passo a passo detalhado por capítulo, com índice, busca e progresso de leitura.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topo } from '../components/Layout';
import { Icone } from '../components/Icone';
import { MANUAL, type Capitulo } from '../core/manual';

const CHAVE = 'rosae.manual.lidos';
function lerLidos(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE) ?? '[]') as string[]); } catch { return new Set(); }
}

function CapituloManual({ c, n, lido, alternarLido }: { c: Capitulo; n: number; lido: boolean; alternarLido: () => void }) {
  return (
    <section id={c.id} className="card manual-cap">
      <header className="manual-cab">
        <span className="manual-num">{String(n).padStart(2, '0')}</span>
        <div className="manual-cab-texto">
          <h2>{c.titulo}</h2>
          <p className="muted">{c.resumo}</p>
        </div>
        <span className="manual-icone"><Icone nome={c.icone} /></span>
      </header>
      <ol className="manual-passos">
        {c.passos.map((p, i) => (
          <li key={p.titulo}>
            <span className="manual-passo-n">{i + 1}</span>
            <div><h3>{p.titulo}</h3><p>{p.texto}</p></div>
          </li>
        ))}
      </ol>
      {c.dicas && (
        <div className="manual-nota dica">
          <b>Dica</b>
          <ul>{c.dicas.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
      {c.atencao && (
        <div className="manual-nota atencao">
          <b>Atenção</b>
          <ul>{c.atencao.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
      <footer className="row manual-rodape">
        {c.link && <Link className="btn-primario" to={c.link.para}>{c.link.rotulo} <Icone nome="seta" /></Link>}
        <div className="spacer" />
        <label className="check"><input type="checkbox" checked={lido} onChange={alternarLido} /> Já li este capítulo</label>
      </footer>
    </section>
  );
}

export function Manual() {
  const [busca, setBusca] = useState('');
  const [lidos, setLidos] = useState(lerLidos);
  const [atual, setAtual] = useState(MANUAL[0].id);
  const termo = busca.trim().toLowerCase();
  const lista = useMemo(
    () => MANUAL.filter((c) => !termo || [c.titulo, c.resumo, ...c.passos.flatMap((p) => [p.titulo, p.texto]), ...(c.dicas ?? []), ...(c.atencao ?? [])].join(' ').toLowerCase().includes(termo)),
    [termo],
  );
  const alternar = (id: string) => setLidos((l) => {
    const n = new Set(l);
    if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem(CHAVE, JSON.stringify([...n])); } catch { /* sem armazenamento: vale só nesta visita */ }
    return n;
  });

  // Índice acompanha o capítulo que está na tela.
  useEffect(() => {
    const obs = new IntersectionObserver((es) => {
      const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (v) setAtual(v.target.id);
    }, { rootMargin: '-15% 0px -70% 0px' });
    document.querySelectorAll('.manual-cap').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [lista]);

  const pct = Math.round((lidos.size / MANUAL.length) * 100);
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <>
      <Topo titulo="Manual do sistema" sub="Passo a passo de cada parte, na ordem em que o trabalho acontece: do primeiro contato à entrega da obra.">
        <button className="btn-secundario" onClick={() => window.print()}><Icone nome="imprimir" /> Imprimir</button>
      </Topo>

      <div className="manual-grade">
        <aside className="manual-indice">
          <div className="card">
            <input type="search" placeholder="Buscar no manual…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar no manual" />
            <div className="manual-progresso">
              <div className="row small"><span className="muted">Seu progresso</span><div className="spacer" /><b className="num">{lidos.size} de {MANUAL.length}</b></div>
              <div className="barra-meta"><div style={{ width: `${pct}%` }} /></div>
            </div>
            <nav aria-label="Capítulos">
              {lista.map((c) => (
                <button key={c.id} className={`manual-link${atual === c.id ? ' ativo' : ''}`} onClick={() => ir(c.id)}>
                  <span className={`manual-marca${lidos.has(c.id) ? ' lido' : ''}`}>{lidos.has(c.id) ? <Icone nome="check" /> : MANUAL.indexOf(c) + 1}</span>
                  {c.titulo}
                </button>
              ))}
            </nav>
          </div>
        </aside>
        <div className="stack">
          {lista.map((c) => <CapituloManual key={c.id} c={c} n={MANUAL.indexOf(c) + 1} lido={lidos.has(c.id)} alternarLido={() => alternar(c.id)} />)}
          {!lista.length && <div className="card vazio"><h3>Nada encontrado</h3><p>Tente outra palavra, como “nota”, “parcela” ou “portal”.</p></div>}
        </div>
      </div>
    </>
  );
}
