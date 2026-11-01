import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icone } from './Icone';
import { useAuth } from '../auth/AuthProvider';
import { BuscaRapida, useBuscaRapida } from './BuscaRapida';
import { ComoFunciona } from './ComoFunciona';
import { useAparencia, type Modo } from '../lib/aparencia';
import { departamentosVisiveis, localizar, type Departamento } from '../core/departamentos';

const PROXIMO: Record<Modo, Modo> = { auto: 'claro', claro: 'escuro', escuro: 'auto' };
const ROTULO_TEMA: Record<Modo, string> = { auto: 'Tema automático', claro: 'Modo claro', escuro: 'Modo escuro' };
const ICONE_TEMA: Record<Modo, string> = { auto: 'monitor', claro: 'sol', escuro: 'lua' };
function BotaoTema() {
  const [a, mudar] = useAparencia();
  return (
    <button onClick={() => mudar({ modo: PROXIMO[a.modo] })} aria-label={`${ROTULO_TEMA[a.modo]} (trocar)`} title={`${ROTULO_TEMA[a.modo]}: clique para trocar`}>
      <Icone nome={ICONE_TEMA[a.modo]} />
    </button>
  );
}

/** Logo que acompanha o menu: colorida no menu claro, branca no menu escuro ou colorido. */
function Logo({ tipo = 'horizontal' }: { tipo?: 'horizontal' | 'nome' }) {
  return (
    <>
      <img className="logo-pos" src={`/marca/rosae-${tipo === 'nome' ? 'nome' : 'logo-horizontal'}.svg`} alt="ROSAE Engenharia & Estruturas" />
      <img className="logo-neg" src={`/marca/rosae-${tipo === 'nome' ? 'nome' : 'logo-horizontal'}-negativo.svg`} alt="ROSAE Engenharia & Estruturas" />
    </>
  );
}

type Item = { para: string; rotulo: string; icone: string };
const PAPEL: Record<string, string> = { administrador: 'Administrador', administrativo: 'Administrativo', financeiro: 'Financeiro', campo: 'Campo' };
const iniciais = (nome?: string) => (nome ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'R';

/** Departamentos (com as subpastas) que a pessoa logada pode abrir. */
export function useDepartamentos(): Departamento[] {
  const { usuario, podeFinanceiro, ehAdmin } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  return useMemo(() => departamentosVisiveis({ comercial, financeiro: podeFinanceiro, admin: ehAdmin }), [comercial, podeFinanceiro, ehAdmin]);
}

const CHAVE_ABERTOS = 'rosae.menu.abertos';
function lerAbertos(): string[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_ABERTOS) ?? '[]') as string[]; } catch { return []; }
}

/** Menu lateral: Início e as pastas dos departamentos, que abrem mostrando as subpastas. */
function MenuDepartamentos({ deps }: { deps: Departamento[] }) {
  const local = useLocation();
  const atual = localizar(local.pathname, deps);
  const [abertos, setAbertos] = useState<string[]>(lerAbertos);
  const alternar = (id: string) => setAbertos((a) => {
    const n = a.includes(id) ? a.filter((x) => x !== id) : [...a, id];
    try { localStorage.setItem(CHAVE_ABERTOS, JSON.stringify(n)); } catch { /* sem armazenamento: vale só nesta visita */ }
    return n;
  });
  return (
    <nav className="nav" aria-label="Principal">
      <NavLink to="/" end><Icone nome="inicio" />Início</NavLink>
      <div className="nav-grupo">Departamentos</div>
      {deps.map((d) => {
        const ativo = atual?.dep.id === d.id;
        const aberto = ativo || abertos.includes(d.id);
        return (
          <div key={d.id} className={`nav-dep${aberto ? ' aberto' : ''}${ativo ? ' ativo' : ''}`}>
            <div className="nav-dep-cab">
              <NavLink to={`/d/${d.id}`} className={() => (ativo && !atual?.sub ? 'active' : ativo ? 'dentro' : '')}>
                <Icone nome={d.icone} />{d.curto === 'Empresa' ? 'Empresa' : d.curto}
              </NavLink>
              {!ativo && (
                <button type="button" className="nav-dep-seta" aria-expanded={aberto} aria-label={`${aberto ? 'Fechar' : 'Abrir'} ${d.nome}`} onClick={() => alternar(d.id)}>
                  <Icone nome="chevron" />
                </button>
              )}
            </div>
            {aberto && (
              <div className="nav-sub">
                {d.subpastas.map((s) => (
                  <NavLink key={s.para} to={s.para} className={() => (atual?.sub?.para === s.para ? 'active' : '')}>{s.rotulo}</NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** Trilha no topo das páginas: departamento › subpasta, e as outras subpastas ao lado. */
function Trilha({ deps }: { deps: Departamento[] }) {
  const local = useLocation();
  const l = localizar(local.pathname, deps);
  if (!l || !l.sub) return null;
  const naRaiz = local.pathname === l.sub.para;
  return (
    <div className="trilha">
      <nav className="trilha-caminho" aria-label="Você está em">
        <Link to={`/d/${l.dep.id}`}><Icone nome={l.dep.icone} />{l.dep.nome}</Link>
        <Icone nome="chevron" />
        {naRaiz ? <span aria-current="page">{l.sub.rotulo}</span> : <Link to={l.sub.para}>{l.sub.rotulo}</Link>}
      </nav>
      {naRaiz && l.dep.subpastas.length > 1 && (
        <div className="trilha-pastas" role="tablist" aria-label={`Subpastas de ${l.dep.nome}`}>
          {l.dep.subpastas.map((s) => (
            <Link key={s.para} to={s.para} role="tab" aria-selected={s.para === l.sub!.para} className={s.para === l.sub!.para ? 'ativo' : ''}>{s.rotulo}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { usuario, sair } = useAuth();
  const deps = useDepartamentos();
  const local = useLocation();
  const [busca, setBusca] = useBuscaRapida();
  const atual = localizar(local.pathname, deps);
  const ehMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const destinos: Item[] = [
    { para: '/', rotulo: 'Início', icone: 'inicio' },
    ...deps.flatMap((d) => [{ para: `/d/${d.id}`, rotulo: d.nome, icone: d.icone }, ...d.subpastas.map((s) => ({ para: s.para, rotulo: `${s.rotulo} · ${d.curto}`, icone: s.icone }))]),
  ];
  // Barra de baixo do celular: Início, até 3 departamentos e "Mais".
  const barra = deps.filter((d) => d.id !== 'empresa').slice(0, 3);
  const naBarra = (id: string) => atual?.dep.id === id;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="logo" aria-label="Início"><Logo /></Link>
        <button type="button" className="busca-atalho" onClick={() => setBusca(true)}>
          <Icone nome="busca" /> Buscar… <kbd>{ehMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <MenuDepartamentos deps={deps} />
        <div className="rodape">
          <span className="avatar" aria-hidden="true">{iniciais(usuario?.nome)}</span>
          <div className="quem">
            <b>{usuario?.nome}</b>
            <span>{PAPEL[usuario?.papel ?? ''] ?? usuario?.papel}</span>
          </div>
          <BotaoTema />
          <button onClick={sair} aria-label="Sair" title="Sair"><Icone nome="sair" /></button>
        </div>
      </aside>
      <div>
        <header className="topo-mobile">
          <Link to="/" className="logo" aria-label="Início"><Logo tipo="nome" /></Link>
          <div className="row" style={{ gap: 2 }}>
            <button onClick={() => setBusca(true)} aria-label="Buscar"><Icone nome="busca" /></button>
            <BotaoTema />
            <Link to="/aparencia" className="botao-icone" aria-label="Aparência"><Icone nome="paleta" /></Link>
            <span className="avatar avatar-mini" aria-label={usuario?.nome} title={usuario?.nome}>{iniciais(usuario?.nome)}</span>
          </div>
        </header>
        <main className="main">
          <div className="pagina" key={local.pathname}>
            <Trilha deps={deps} />
            <Outlet />
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Principal">
        <NavLink to="/" end><Icone nome="inicio" />Início</NavLink>
        {barra.map((d) => (
          <Link key={d.id} to={`/d/${d.id}`} className={naBarra(d.id) ? 'active' : ''}><Icone nome={d.icone} />{d.curto}</Link>
        ))}
        <Link to="/mais" className={local.pathname === '/mais' || (atual && !barra.some((d) => d.id === atual.dep.id)) ? 'active' : ''}><Icone nome="menu" />Mais</Link>
      </nav>
      {busca && <BuscaRapida destinos={destinos} aoFechar={() => setBusca(false)} />}
    </div>
  );
}

export function Topo({ titulo, sub, children }: { titulo: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="topo">
      <div>
        <h1>{titulo}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="row"><ComoFunciona />{children}</div>
    </div>
  );
}

/** Menu "Mais" do celular: todos os departamentos, cada um com as suas subpastas. */
export function Mais() {
  const deps = useDepartamentos();
  const { usuario, sair } = useAuth();
  return (
    <>
      <div className="mais-perfil card">
        <span className="avatar" aria-hidden="true">{iniciais(usuario?.nome)}</span>
        <div className="quem"><b>{usuario?.nome}</b><span className="muted small">{PAPEL[usuario?.papel ?? ''] ?? usuario?.papel}</span></div>
        <button className="btn-secundario" onClick={sair}><Icone nome="sair" /> Sair</button>
      </div>
      {deps.map((d) => (
        <section key={d.id} className="mais-grupo">
          <Link to={`/d/${d.id}`} className="mais-titulo mais-titulo-link"><Icone nome={d.icone} />{d.nome}<Icone nome="chevron" /></Link>
          <div className="mais-grade">
            {d.subpastas.map((s) => (
              <Link key={s.para} to={s.para} className="mais-item">
                <span className="mais-icone"><Icone nome={s.icone} /></span>
                {s.rotulo}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
