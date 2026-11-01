// "Como funciona": botão em cada página que abre o guia daquela tela (para que serve e
// passo a passo) e uma demonstração que acende, na própria tela, cada botão explicado.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { Icone } from './Icone';
import { guiaDaRota, type Guia } from '../core/guias';

/** Acha na tela o elemento visível cujo texto contém o alvo (botões e links primeiro). */
function acharAlvo(alvo?: string): HTMLElement | null {
  if (!alvo) return null;
  const termo = alvo.toLowerCase();
  const raiz = document.querySelector('.main') ?? document.body;
  const grupos = ['button, a, [role="tab"], [role="radio"], summary', 'h1, h2, h3, .rotulo, label, .card-titulo, .kpi'];
  for (const sel of grupos) {
    const lista = Array.from(raiz.querySelectorAll<HTMLElement>(sel)).filter((el) => {
      if (el.closest('.cf-gaveta, .cf-tour')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (el.textContent ?? '').toLowerCase().includes(termo);
    });
    // O menor elemento que contém o texto é o mais preciso.
    lista.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
    if (lista[0]) return lista[0];
  }
  return null;
}

function Demonstracao({ guia, inicio, aoSair }: { guia: Guia; inicio: number; aoSair: () => void }) {
  const [i, setI] = useState(inicio);
  const [caixa, setCaixa] = useState<DOMRect | null>(null);
  const passo = guia.passos[i];
  const medir = useCallback(() => {
    const el = acharAlvo(passo.alvo);
    setCaixa(el ? el.getBoundingClientRect() : null);
  }, [passo]);
  useLayoutEffect(() => {
    const el = acharAlvo(passo.alvo);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(medir, el ? 380 : 0);
    medir();
    return () => window.clearTimeout(t);
  }, [passo, medir]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoSair();
      if (e.key === 'ArrowRight') setI((x) => Math.min(guia.passos.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', tecla);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => { window.removeEventListener('keydown', tecla); window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); };
  }, [aoSair, guia.passos.length, medir]);

  const m = 8;
  const ultimo = i === guia.passos.length - 1;
  const larg = Math.min(360, window.innerWidth - 24);
  let balao: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: larg };
  if (caixa) {
    const abaixo = caixa.bottom + 16 + 200 < window.innerHeight;
    const left = Math.max(12, Math.min(window.innerWidth - larg - 12, caixa.left + caixa.width / 2 - larg / 2));
    balao = abaixo ? { left, top: caixa.bottom + m + 12, width: larg } : { left, top: Math.max(12, caixa.top - m - 12), transform: 'translateY(-100%)', width: larg };
  }
  return createPortal(
    <div className="cf-tour" role="dialog" aria-modal="true" aria-label={`Demonstração: ${guia.titulo}`}>
      <div className="cf-fundo" onClick={aoSair} />
      {caixa
        ? <div className="cf-foco" style={{ left: caixa.left - m, top: caixa.top - m, width: caixa.width + m * 2, height: caixa.height + m * 2 }} />
        : <div className="cf-foco cf-foco-vazio" />}
      <div className="cf-balao" style={balao} key={i}>
        <div className="cf-balao-topo">
          <span className="cf-passo-n">{String(i + 1).padStart(2, '0')}</span>
          <span className="muted small">de {String(guia.passos.length).padStart(2, '0')} · {guia.titulo}</span>
        </div>
        <h3>{passo.titulo}</h3>
        <p>{passo.texto}</p>
        {!caixa && passo.alvo && <p className="muted small">Este ponto aparece quando houver dados na tela.</p>}
        <div className="cf-pontos" aria-hidden="true">{guia.passos.map((_, k) => <i key={k} className={k === i ? 'ativo' : k < i ? 'feito' : ''} />)}</div>
        <div className="cf-balao-acoes">
          <button className="btn-link" onClick={aoSair}>Sair</button>
          <span className="spacer" />
          {i > 0 && <button className="btn-secundario" onClick={() => setI(i - 1)}>Anterior</button>}
          <button className="btn-primario" onClick={() => (ultimo ? aoSair() : setI(i + 1))}>{ultimo ? 'Concluir' : 'Próximo'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ComoFunciona({ compacto }: { compacto?: boolean }) {
  const { pathname } = useLocation();
  const guia = guiaDaRota(pathname);
  const [aberto, setAberto] = useState(false);
  const [demo, setDemo] = useState<number | null>(null);
  useEffect(() => { setAberto(false); setDemo(null); }, [pathname]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto]);
  if (!guia) return null;
  const mostrar = (k: number) => { setAberto(false); setDemo(k); };
  return (
    <>
      <button type="button" className={`btn-como${compacto ? ' compacto' : ''}`} onClick={() => setAberto(true)} aria-haspopup="dialog">
        <Icone nome="ajuda" /><span>Como funciona</span>
      </button>
      {aberto && createPortal(
        <div className="cf-gaveta-fundo" onMouseDown={(e) => e.target === e.currentTarget && setAberto(false)}>
          <aside className="cf-gaveta" role="dialog" aria-modal="true" aria-label={`Como funciona: ${guia.titulo}`}>
            <header>
              <span className="cf-kicker">Como funciona</span>
              <button className="btn-link" onClick={() => setAberto(false)} aria-label="Fechar"><Icone nome="fechar" /></button>
            </header>
            <h2 className="serifa">{guia.titulo}</h2>
            <section className="cf-serve">
              <h4>Para que serve</h4>
              <p>{guia.serve}</p>
            </section>
            <button className="btn-primario cf-demo" onClick={() => mostrar(0)}><span className="cf-play" aria-hidden="true">▶</span> Mostrar na tela, passo a passo</button>
            <h4>Passo a passo</h4>
            <ol className="cf-passos">
              {guia.passos.map((p, k) => (
                <li key={p.titulo}>
                  <span className="cf-n">{String(k + 1).padStart(2, '0')}</span>
                  <div>
                    <b>{p.titulo}</b>
                    <p>{p.texto}</p>
                    {p.alvo && <button className="btn-link small" onClick={() => mostrar(k)}>Ver onde fica</button>}
                  </div>
                </li>
              ))}
            </ol>
            {guia.dicas && guia.dicas.length > 0 && (
              <section className="cf-dicas">
                <h4>Dicas</h4>
                <ul>{guia.dicas.map((d) => <li key={d}>{d}</li>)}</ul>
              </section>
            )}
            {guia.manual && <Link className="btn-secundario" to={`/manual#${guia.manual}`} onClick={() => setAberto(false)}><Icone nome="livro" /> Ler no manual completo</Link>}
          </aside>
        </div>,
        document.body,
      )}
      {demo !== null && <Demonstracao guia={guia} inicio={demo} aoSair={() => setDemo(null)} />}
    </>
  );
}
