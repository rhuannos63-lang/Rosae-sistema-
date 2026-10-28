import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icone } from './Icone';
import { useAuth } from '../auth/AuthProvider';
import { BuscaRapida, useBuscaRapida } from './BuscaRapida';
import { useAparencia, type Modo } from '../lib/aparencia';

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

type Item = { para: string; rotulo: string; icone: string; fin: boolean; grupo?: string; comercial?: boolean; admin?: boolean };

const itens: Item[] = [
  { para: '/', rotulo: 'Início', icone: 'inicio', fin: false, grupo: 'Gestão' },
  { para: '/comercial', rotulo: 'Comercial', icone: 'comercial', fin: false, comercial: true, grupo: 'Gestão' },
  { para: '/orcamento', rotulo: 'Novo orçamento', icone: 'varinha', fin: false, comercial: true, grupo: 'Gestão' },
  { para: '/agenda', rotulo: 'Agenda', icone: 'calendario', fin: false, grupo: 'Gestão' },
  { para: '/obras', rotulo: 'Obras', icone: 'obras', fin: false, grupo: 'Gestão' },
  { para: '/financeiro', rotulo: 'Financeiro', icone: 'financeiro', fin: true, grupo: 'Financeiro' },
  { para: '/pendencias', rotulo: 'Pendências', icone: 'alerta', fin: false, grupo: 'Gestão' },
  { para: '/notas', rotulo: 'Notas fiscais', icone: 'documento', fin: true, grupo: 'Financeiro' },
  { para: '/contas', rotulo: 'Contas', icone: 'contas', fin: true, grupo: 'Financeiro' },
  { para: '/planejador', rotulo: 'Planejador', icone: 'planejador', fin: true, grupo: 'Financeiro' },
  { para: '/pessoas', rotulo: 'Cadastros', icone: 'pessoas', fin: false, grupo: 'Sistema' },
  { para: '/manual', rotulo: 'Manual', icone: 'livro', fin: false, grupo: 'Sistema' },
  { para: '/aparencia', rotulo: 'Aparência', icone: 'paleta', fin: false, grupo: 'Sistema' },
  { para: '/ajuda', rotulo: 'Ajuda rápida', icone: 'ajuda', fin: false, grupo: 'Sistema' },
  { para: '/configuracoes', rotulo: 'Configurações', icone: 'config', fin: false, admin: true, grupo: 'Sistema' },
];
const GRUPOS = ['Gestão', 'Financeiro', 'Sistema'];
const PAPEL: Record<string, string> = { administrador: 'Administrador', administrativo: 'Administrativo', financeiro: 'Financeiro', campo: 'Campo' };
const iniciais = (nome?: string) => (nome ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'R';

// Barra de baixo do celular: as 4 áreas de uso diário; o resto fica em "Mais".
const BARRA = ['/', '/comercial', '/obras', '/financeiro', '/agenda', '/pendencias'];
function naBarra(visiveis: Item[]): Item[] {
  return BARRA.map((p) => visiveis.find((i) => i.para === p)).filter((i): i is Item => !!i).slice(0, 4);
}

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
  const mobile = visiveis.length > 5 ? [...naBarra(visiveis), { para: '/mais', rotulo: 'Mais', icone: 'menu', fin: false }] : visiveis;
  const ehMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const destinos = [...visiveis, ...(visiveis.some((i) => i.para === '/comercial') ? [{ para: '/propostas', rotulo: 'Propostas', icone: 'documento' }, { para: '/orcamento/precos', rotulo: 'Tabela de preços do orçamento', icone: 'config' }, { para: '/biblioteca', rotulo: 'Biblioteca de serviços', icone: 'lista' }] : [])];
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="logo" aria-label="Início"><Logo /></Link>
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

/** Menu "Mais" do celular: o que não cabe na barra de baixo, em blocos por área. */
export function Mais() {
  const visiveis = useItens();
  const { usuario, sair } = useAuth();
  const extras: Item[] = visiveis.some((i) => i.para === '/comercial')
    ? [{ para: '/propostas', rotulo: 'Propostas', icone: 'documento', fin: false, grupo: 'Gestão' }, { para: '/biblioteca', rotulo: 'Biblioteca de serviços', icone: 'lista', fin: false, grupo: 'Gestão' }, { para: '/orcamento/precos', rotulo: 'Tabela de preços', icone: 'config', fin: false, grupo: 'Gestão' }]
    : [];
  const resto = [...visiveis.filter((i) => !naBarra(visiveis).includes(i)), ...extras];
  return (
    <>
      <div className="mais-perfil card">
        <span className="avatar" aria-hidden="true">{iniciais(usuario?.nome)}</span>
        <div className="quem"><b>{usuario?.nome}</b><span className="muted small">{PAPEL[usuario?.papel ?? ''] ?? usuario?.papel}</span></div>
        <button className="btn-secundario" onClick={sair}><Icone nome="sair" /> Sair</button>
      </div>
      {GRUPOS.map((g) => {
        const doGrupo = resto.filter((i) => i.grupo === g);
        if (!doGrupo.length) return null;
        return (
          <section key={g} className="mais-grupo">
            <h2 className="mais-titulo">{g}</h2>
            <div className="mais-grade">
              {doGrupo.map((i) => (
                <Link key={i.para} to={i.para} className="mais-item">
                  <span className="mais-icone"><Icone nome={i.icone} /></span>
                  {i.rotulo}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
