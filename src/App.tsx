import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { configurado } from './lib/supabase';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ToastProvider, Carregando } from './components/ui';
import { Layout, Mais } from './components/Layout';
import { Login, PrimeiroAcesso, NaoConfigurado, SemAcesso, DefinirSenha } from './pages/Acesso';
import { Painel } from './pages/Painel';
import { Introducao } from './pages/Ajuda';

// Cada área baixa só quando é aberta: o celular carrega menos no primeiro acesso.
function preguicoso<M extends Record<string, unknown>>(carregar: () => Promise<M>, nome: keyof M) {
  return lazy(() => carregar().then((m) => ({ default: m[nome] as ComponentType })));
}
const Pessoas = preguicoso(() => import('./pages/Pessoas'), 'Pessoas');
const Obras = preguicoso(() => import('./pages/Obras'), 'Obras');
const ObraDetalhe = preguicoso(() => import('./pages/Obras'), 'ObraDetalhe');
const Financeiro = preguicoso(() => import('./pages/Financeiro'), 'Financeiro');
const LancamentoDetalhe = preguicoso(() => import('./pages/Financeiro'), 'LancamentoDetalhe');
const Contas = preguicoso(() => import('./pages/Contas'), 'Contas');
const Configuracoes = preguicoso(() => import('./pages/Configuracoes'), 'Configuracoes');
const Comercial = preguicoso(() => import('./pages/Comercial'), 'Comercial');
const OportunidadeDetalhe = preguicoso(() => import('./pages/Comercial'), 'OportunidadeDetalhe');
const Propostas = preguicoso(() => import('./pages/Propostas'), 'Propostas');
const PropostaEditor = preguicoso(() => import('./pages/Propostas'), 'PropostaEditor');
const PropostaImprimir = preguicoso(() => import('./pages/Propostas'), 'PropostaImprimir');
const PropostaPublica = preguicoso(() => import('./pages/PropostaPublica'), 'PropostaPublica');
const ContratoPublico = preguicoso(() => import('./pages/ContratoPublico'), 'ContratoPublico');
const NovoOrcamento = preguicoso(() => import('./pages/Orcamento'), 'NovoOrcamento');
const PrecosOrcamento = preguicoso(() => import('./pages/Orcamento'), 'PrecosOrcamento');
const Agenda = preguicoso(() => import('./pages/Agenda'), 'Agenda');
const Biblioteca = preguicoso(() => import('./pages/Biblioteca'), 'Biblioteca');
const Planejador = preguicoso(() => import('./pages/Planejador'), 'Planejador');
const Clausulas = preguicoso(() => import('./pages/ObraContrato'), 'Clausulas');
const ContratoImprimir = preguicoso(() => import('./pages/ObraContrato'), 'ContratoImprimir');
const FichaAtual = preguicoso(() => import('./pages/Fichas'), 'FichaAtual');
const FichaImprimir = preguicoso(() => import('./pages/Fichas'), 'FichaImprimir');
const Portal = preguicoso(() => import('./pages/Portal'), 'Portal');
const PortalEntrada = preguicoso(() => import('./pages/Portal'), 'PortalEntrada');
const PortalPrevia = preguicoso(() => import('./pages/Portal'), 'PortalPrevia');
const Notas = preguicoso(() => import('./pages/Notas'), 'Notas');
const NotaDetalhe = preguicoso(() => import('./pages/Notas'), 'NotaDetalhe');
const Pendencias = preguicoso(() => import('./pages/Pendencias'), 'Pendencias');
const Ajuda = preguicoso(() => import('./pages/Ajuda'), 'Ajuda');
const Manual = preguicoso(() => import('./pages/Manual'), 'Manual');
const Departamento = preguicoso(() => import('./pages/Departamento'), 'Departamento');
const Aparencia = preguicoso(() => import('./pages/Aparencia'), 'Aparencia');
const Assistente = preguicoso(() => import('./pages/Assistente'), 'Assistente');
const RelatorioObra = preguicoso(() => import('./pages/Relatorios'), 'RelatorioObra');
const RelatorioClientePrevia = preguicoso(() => import('./pages/Relatorios'), 'RelatorioClientePrevia');
const RelatorioClientePortal = preguicoso(() => import('./pages/Relatorios'), 'RelatorioClientePortal');

function Rotas() {
  const { carregando, sessao, usuario, existeAdmin, podeFinanceiro, ehAdmin, definirSenha } = useAuth();
  if (carregando) return <Carregando />;
  if (!sessao) return <Login />;
  if (definirSenha) return <DefinirSenha />;
  if (!usuario) return existeAdmin ? <SemAcesso /> : <PrimeiroAcesso />;
  if (!usuario.ativo || usuario.papel === 'cliente') return <SemAcesso cliente={usuario.papel === 'cliente'} />;
  const comercial = usuario.papel === 'administrador' || usuario.papel === 'administrativo';
  return (
    <>
      <Introducao />
      <Suspense fallback={<Carregando />}>
        <Routes>
          {comercial && <Route path="propostas/:id/imprimir" element={<PropostaImprimir />} />}
          {comercial && <Route path="contratos/:id/imprimir" element={<ContratoImprimir />} />}
          {comercial && <Route path="obras/:id/portal-previa" element={<PortalPrevia />} />}
          {comercial && <Route path="obras/:id/relatorio" element={<RelatorioObra />} />}
          {comercial && <Route path="obras/:id/relatorio-cliente" element={<RelatorioClientePrevia />} />}
          <Route path="fichas/:id/imprimir" element={<FichaImprimir />} />
          <Route element={<Layout />}>
            <Route index element={<Painel />} />
            <Route path="d/:id" element={<Departamento />} />
            <Route path="pendencias" element={<Pendencias />} />
            <Route path="ajuda" element={<Ajuda />} />
            <Route path="manual" element={<Manual />} />
            <Route path="aparencia" element={<Aparencia />} />
            <Route path="assistente" element={<Assistente />} />
            <Route path="obras" element={<Obras />} />
            <Route path="obras/:id" element={<ObraDetalhe />} />
            <Route path="pessoas" element={<Pessoas />} />
            <Route path="mais" element={<Mais />} />
            <Route path="ficha/:servicoId" element={<FichaAtual />} />
            {comercial && <Route path="clausulas" element={<Clausulas />} />}
            {comercial && <Route path="comercial" element={<Comercial />} />}
            {comercial && <Route path="comercial/:id" element={<OportunidadeDetalhe />} />}
            {comercial && <Route path="propostas" element={<Propostas />} />}
            {comercial && <Route path="propostas/:id" element={<PropostaEditor />} />}
            {comercial && <Route path="biblioteca" element={<Biblioteca />} />}
            {comercial && <Route path="orcamento" element={<NovoOrcamento />} />}
            {comercial && <Route path="orcamento/precos" element={<PrecosOrcamento />} />}
            <Route path="agenda" element={<Agenda />} />
            {podeFinanceiro && <Route path="financeiro" element={<Financeiro />} />}
            {podeFinanceiro && <Route path="financeiro/:id" element={<LancamentoDetalhe />} />}
            {podeFinanceiro && <Route path="notas" element={<Notas />} />}
            {podeFinanceiro && <Route path="notas/:id" element={<NotaDetalhe />} />}
            {podeFinanceiro && <Route path="contas" element={<Contas />} />}
            {podeFinanceiro && <Route path="planejador" element={<Planejador />} />}
            {ehAdmin && <Route path="configuracoes" element={<Configuracoes />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}

export function App() {
  if (!configurado) return <NaoConfigurado />;
  return (
    <BrowserRouter>
      <Suspense fallback={<Carregando />}>
        <Routes>
          {/* Link da proposta para o cliente: sem login. */}
          <Route path="/p/:token" element={<PropostaPublica />} />
          {/* Assinatura do contrato pelo link: sem login. */}
          <Route path="/a/:token" element={<ContratoPublico />} />
          {/* Portal do cliente: link pessoal, com expiração e revogação. */}
          <Route path="/c/relatorio" element={<RelatorioClientePortal />} />
          <Route path="/c/:token" element={<PortalEntrada />} />
          <Route path="/c" element={<Portal />} />
          <Route
            path="*"
            element={
              <AuthProvider>
                <ToastProvider>
                  <Rotas />
                </ToastProvider>
              </AuthProvider>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
