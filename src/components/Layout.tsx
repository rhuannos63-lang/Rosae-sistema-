import { Link, NavLink, Outlet } from 'react-router-dom';
import { Icone } from './Icone';
import { useAuth } from '../auth/AuthProvider';

const itens = [
  { para: '/', rotulo: 'Início', icone: 'inicio', fin: false },
  { para: '/comercial', rotulo: 'Comercial', icone: 'comercial', fin: false, comercial: true },
  { para: '/obras', rotulo: 'Obras', icone: 'obras', fin: false },
  { para: '/financeiro', rotulo: 'Financeiro', icone: 'financeiro', fin: true },
  { para: '/contas', rotulo: 'Contas', icone: 'contas', fin: true },
  { para: '/planejador', rotulo: 'Planejador', icone: 'planejador', fin: true },
  { para: '/pessoas', rotulo: 'Cadastros', icone: 'pessoas', fin: false },
  { para: '/configuracoes', rotulo: 'Configurações', icone: 'config', fin: false, admin: true },
];

function useItens() {
  const { usuario, podeFinanceiro, ehAdmin } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  return itens.filter((i) => (!i.fin || podeFinanceiro) && (!i.admin || ehAdmin) && (!i.comercial || comercial));
}

export function Layout() {
  const { usuario, sair } = useAuth();
  const visiveis = useItens();
  const mobile = visiveis.length > 5 ? [...visiveis.slice(0, 4), { para: '/mais', rotulo: 'Mais', icone: 'menu', fin: false }] : visiveis;
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
