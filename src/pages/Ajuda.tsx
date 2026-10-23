// Central de ajuda e introdução guiada (pode ser pulada e reaberta).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topo } from '../components/Layout';
import { Icone } from '../components/Icone';
import { AJUDA } from '../core/ajuda';

const CHAVE_INTRO = 'rosae.introducao.v1';
const EVENTO_INTRO = 'rosae:introducao';

export function abrirIntroducao() {
  window.dispatchEvent(new Event(EVENTO_INTRO));
}

export function Ajuda() {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(() => (window.location.hash ? window.location.hash.slice(1) : null));
  const termo = busca.trim().toLowerCase();
  const lista = AJUDA.filter((t) => !termo || [t.titulo, t.serve, ...t.passos].join(' ').toLowerCase().includes(termo));
  return (
    <>
      <Topo titulo="Ajuda" sub="Guia por tarefa. Os pontos de interrogação nas telas explicam cada campo.">
        <button className="btn-secundario" onClick={abrirIntroducao}><Icone nome="ajuda" /> Rever introdução</button>
      </Topo>
      <div className="card" style={{ marginBottom: 12 }}>
        <label htmlFor="busca-ajuda" className="sr-only">Buscar na ajuda</label>
        <input id="busca-ajuda" type="search" placeholder="Buscar: nota, cronograma, portal…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="stack">
        {lista.map((t) => {
          const ab = aberto === t.id || !!termo;
          return (
            <section key={t.id} id={t.id} className="card ajuda-topico">
              <button className="ajuda-cab" aria-expanded={ab} onClick={() => setAberto(ab ? null : t.id)}>
                <span><strong>{t.titulo}</strong><span className="muted small"> · {t.onde}</span></span>
              </button>
              {ab && (
                <div className="ajuda-corpo">
                  <h4>Para que serve</h4><p>{t.serve}</p>
                  <h4>Como usar</h4><ol>{t.passos.map((p) => <li key={p}>{p}</li>)}</ol>
                  <h4>Exemplo</h4><p>{t.exemplo}</p>
                  {t.erros && <><h4>Erros frequentes</h4><ul>{t.erros.map((e) => <li key={e}>{e}</li>)}</ul></>}
                  <Link className="btn-secundario" to={t.link}>Ir para {t.onde.split(' → ')[0]}</Link>
                </div>
              )}
            </section>
          );
        })}
        {lista.length === 0 && <p className="muted">Nada encontrado para “{busca}”.</p>}
      </div>
    </>
  );
}

const PASSOS_INTRO = [
  { titulo: 'Bem-vindo ao sistema da ROSAE', texto: 'Aqui ficam comercial, obras, financeiro e o portal dos clientes, tudo ligado: o que você cadastra uma vez alimenta o resto.' },
  { titulo: 'Comece pelo Início e pelas Pendências', texto: 'O Início mostra vendas, recebimentos, contas e obras. A central de Pendências lista o que precisa de ação, do mais urgente ao menos. Cada número abre os registros que o explicam.' },
  { titulo: 'Da proposta à obra', texto: 'Monte a proposta, envie o link, e quando o cliente aceitar, converta em obra: serviços, etapas, materiais e recebimentos entram sozinhos, sem duplicar.' },
  { titulo: 'Na obra', texto: 'Cronograma com peso técnico, materiais em necessidade/compra/entrega, diário com fotos e fichas para o canteiro. O percentual só sobe com execução, nunca com compra ou pagamento.' },
  { titulo: 'Portal do cliente', texto: 'Cada cliente recebe um link pessoal e vê só o que você publicar: andamento, fotos e decisões. Valores e documentos financeiros nunca aparecem lá.' },
  { titulo: 'Dúvidas', texto: 'Toque no ponto de interrogação ao lado dos campos ou abra Ajuda no menu. Esta introdução pode ser revista por lá.' },
];

export function Introducao() {
  const [aberta, setAberta] = useState(() => { try { return !localStorage.getItem(CHAVE_INTRO); } catch { return false; } });
  const [passo, setPasso] = useState(0);
  useEffect(() => {
    const abrir = () => { setPasso(0); setAberta(true); };
    window.addEventListener(EVENTO_INTRO, abrir);
    return () => window.removeEventListener(EVENTO_INTRO, abrir);
  }, []);
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });
  function fechar() {
    try { localStorage.setItem(CHAVE_INTRO, new Date().toISOString()); } catch { /* sem armazenamento: aparece de novo na próxima visita */ }
    setAberta(false);
  }
  if (!aberta) return null;
  const p = PASSOS_INTRO[passo];
  const ultimo = passo === PASSOS_INTRO.length - 1;
  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-labelledby="intro-titulo">
      <div className="modal intro">
        <div className="intro-pontos" aria-hidden="true">{PASSOS_INTRO.map((_, i) => <span key={i} className={i === passo ? 'ativo' : ''} />)}</div>
        <h2 id="intro-titulo">{p.titulo}</h2>
        <p>{p.texto}</p>
        <p className="muted small">Passo {passo + 1} de {PASSOS_INTRO.length}</p>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <button className="btn-link" onClick={fechar}>Pular introdução</button>
          <div className="row" style={{ gap: 8 }}>
            {passo > 0 && <button className="btn-secundario" onClick={() => setPasso(passo - 1)}>Voltar</button>}
            <button className="btn-primario" autoFocus onClick={() => (ultimo ? fechar() : setPasso(passo + 1))}>{ultimo ? 'Começar' : 'Próximo'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
