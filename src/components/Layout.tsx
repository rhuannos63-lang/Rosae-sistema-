import { NavLink, Outlet } from 'react-router-dom';
import { Icone } from './Icone';
import { useAuth } from '../auth/AuthProvider';

const itens = [
  { para: '/', rotulo: 'Início', icone: 'inicio', fin: false },
  { para: '/obras', rotulo: 'Obras', icone: 'obras', fin: false },
  { para: '/financeiro', rotulo: 'Financeiro', icone: 'financeiro', fin: true },
  { para: '/contas', rotulo: 'Contas', icone: 'contas', fin: true },
  { para: '/pessoas', rotulo: 'Cadastros', icone: 'pessoas', fin: false },
  { para: '/configuracoes', rotulo: 'Configurações', icone: 'config', fin: false, admin: true },
];

export function Layout() {
  const { usuario, sair, podeFinanceiro, ehAdmin } = useAuth();
  const visiveis = itens.filter((i) => (!i.fin || podeFinanceiro) && (!i.admin || ehAdmin));
  const mobile = visiveis.filter((i) => i.para !== '/contas').slice(0, 5);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <img src="/marca/rosae-logo-horizontal-negativo.svg" alt="ROSAE Engenharia & Estruturas" />
        </div>
        <nav className="nav" aria-label="Principal">
          {visiveis.map((i) => (
            <NavLink key={i.para} to={i.para} end={i.para === '/'}>
              <Icone nome={i.icone} />
              {i.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="rodape">
          <div>{usuario?.nome}</div>
          <button className="btn-link" onClick={sair}>Sair</button>
        </div>
      </aside>
      <div>
        <header className="topo-mobile">
          <img src="/marca/rosae-logo-horizontal-negativo.svg" alt="ROSAE" />
          <button className="btn-link" style={{ color: '#e8e2cc' }} onClick={sair} aria-label="Sair">
            <Icone nome="sair" />
          </button>
        </header>
        <main className="main">
          <Outlet />
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
