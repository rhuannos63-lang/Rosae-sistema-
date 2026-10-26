import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icone } from './Icone';
import { useAuth } from '../auth/AuthProvider';
import { BuscaRapida, useBuscaRapida } from './BuscaRapida';

type Item = { para: string; rotulo: string; icone: string; fin: boolean; grupo?: string; comercial?: boolean; admin?: boolean };

const itens: Item[] = [
  { para: '/', rotulo: 'Início', icone: 'inicio', fin: false, grupo: 'Gestão' },
  { para: '/comercial', rotulo: 'Comercial', icone: 'comercial', fin: false, comercial: true, grupo: 'Gestão' },
  { para: '/obras', rotulo: 'Obras', icone: 'obras', fin: false, grupo: 'Gestão' },
  { para: '/financeiro', rotulo: 'Financeiro', icone: 'financeiro', fin: true, grupo: 'Financeiro' },
  { para: '/pendencias', rotulo: 'Pendências', icone: 'alerta', fin: false, grupo: 'Gestão' },
  { para: '/notas', rotulo: 'Notas fiscais', icone: 'documento', fin: true, grupo: 'Financeiro' },
  { para: '/contas', rotulo: 'Contas', icone: 'contas', fin: true, grupo: 'Financeiro' },
  { para: '/planejador', rotulo: 'Planejador', icone: 'planejador', fin: true, grupo: 'Financeiro' },
  { para: '/pessoas', rotulo: 'Cadastros', icone: 'pessoas', fin: false, grupo: 'Sistema' },
  { para: '/ajuda', rotulo: 'Ajuda', icone: 'ajuda', fin: false, grupo: 'Sistema' },
  { para: '/configuracoes', rotulo: 'Configurações', icone: 'config', fin: false, admin: true, grupo: 'Sistema' },
];
const GRUPOS = ['Gestão', 'Financeiro', 'Sistema'];
const PAPEL: Record<string, string> = { administrador: 'Administrador', administrativo: 'Administrativo', financeiro: 'Financeiro', campo: 'Campo' };
const iniciais = (nome?: string) => (nome ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'R';

function useItens() {
  const { usuario, podeFinanceiro, ehAdmin } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  return itens.filter((i) => (!i.fin || podeFinanceiro) && (!i.admin || ehAdmin) && (!i.comercial || comercial));
}

export function Layout() {
  const { usuario, sair } = useAuth();
  const visiveis = useItens();
  const local = useLocation();
  const [busca, setBusca] = useBuscaRapida();
  const mobile = visiveis.length > 5 ? [...visiveis.slice(0, 4), { para: '/mais', rotulo: 'Mais', icone: 'menu', fin: false }] : visiveis;
  const ehMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const destinos = [...visiveis, ...(visiveis.some((i) => i.para === '/comercial') ? [{ para: '/propostas', rotulo: 'Propostas', icone: 'documento' }, { para: '/biblioteca', rotulo: 'Biblioteca de serviços', icone: 'lista' }] : [])];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <img src="/marca/rosae-logo-horizontal-negativo.svg" alt="ROSAE Engenharia & Estruturas" />
        </div>
        <button type="button" className="busca-atalho" onClick={() => setBusca(true)}>
          <Icone nome="busca" /> Buscar… <kbd>{ehMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <nav className="nav" aria-label="Principal">
          {GRUPOS.map((g) => {
            const doGrupo = visiveis.filter((i) => i.grupo === g);
            if (!doGrupo.length) return null;
            return (
              <div key={g} className="nav">
                <div className="nav-grupo">{g}</div>
                {doGrupo.map((i) => (
                  <NavLink key={i.para} to={i.para} end={i.para === '/'}>
                    <Icone nome={i.icone} />
                    {i.rotulo}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="rodape">
          <span className="avatar" aria-hidden="true">{iniciais(usuario?.nome)}</span>
          <div className="quem">
            <b>{usuario?.nome}</b>
            <span>{PAPEL[usuario?.papel ?? ''] ?? usuario?.papel}</span>
          </div>
          <button onClick={sair} aria-label="Sair" title="Sair"><Icone nome="sair" /></button>
        </div>
      </aside>
      <div>
        <header className="topo-mobile">
          <img src="/marca/rosae-logo-horizontal-negativo.svg" alt="ROSAE" />
          <div className="row" style={{ gap: 2 }}>
            <button onClick={() => setBusca(true)} aria-label="Buscar"><Icone nome="busca" /></button>
            <button onClick={sair} aria-label="Sair"><Icone nome="sair" /></button>
          </div>
        </header>
        <main className="main">
          <div className="pagina" key={local.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Principal">
        {mobile.map((i) => (
          <NavLink key={i.para} to={i.para} end={i.para === '/'}>
            <Icone nome={i.icone} />
            {i.rotulo === 'Configurações' ? 'Ajustes' : i.rotulo}
          </NavLink>
        ))}
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
      {children && <div className="row">{children}</div>}
    </div>
  );
}

/** Menu "Mais" do celular: o que não cabe na barra de baixo. */
export function Mais() {
  const visiveis = useItens();
  return (
    <>
      <Topo titulo="Mais" />
      <div className="lista-cartoes" style={{ display: 'grid' }}>
        {visiveis.slice(4).concat(visiveis.some((i) => i.para === '/comercial') ? [{ para: '/propostas', rotulo: 'Propostas', icone: 'comercial', fin: false }, { para: '/biblioteca', rotulo: 'Biblioteca de serviços', icone: 'comercial', fin: false }] : []).map((i) => (
          <Link key={i.para} to={i.para} className="item-cartao">
            <span className="row"><Icone nome={i.icone} />{i.rotulo}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
