import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { configurado } from './lib/supabase';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ToastProvider, Carregando } from './components/ui';
import { Layout } from './components/Layout';
import { Login, PrimeiroAcesso, NaoConfigurado, SemAcesso, DefinirSenha } from './pages/Acesso';
import { Painel } from './pages/Painel';
import { Pessoas } from './pages/Pessoas';
import { Obras, ObraDetalhe } from './pages/Obras';
import { Financeiro, LancamentoDetalhe } from './pages/Financeiro';
import { Contas } from './pages/Contas';
import { Configuracoes } from './pages/Configuracoes';
import { Comercial, OportunidadeDetalhe } from './pages/Comercial';
import { Propostas, PropostaEditor, PropostaImprimir } from './pages/Propostas';
import { PropostaPublica } from './pages/PropostaPublica';
import { Biblioteca } from './pages/Biblioteca';
import { Planejador } from './pages/Planejador';
import { Mais } from './components/Layout';

function Rotas() {
  const { carregando, sessao, usuario, existeAdmin, podeFinanceiro, ehAdmin, definirSenha } = useAuth();
  if (carregando) return <Carregando />;
  if (!sessao) return <Login />;
  if (definirSenha) return <DefinirSenha />;
  if (!usuario) return existeAdmin ? <SemAcesso /> : <PrimeiroAcesso />;
  if (!usuario.ativo || usuario.papel === 'cliente') return <SemAcesso cliente={usuario.papel === 'cliente'} />;
  const comercial = usuario.papel === 'administrador' || usuario.papel === 'administrativo';
  return (
    <Routes>
      {comercial && <Route path="propostas/:id/imprimir" element={<PropostaImprimir />} />}
      <Route element={<Layout />}>
        <Route index element={<Painel />} />
        <Route path="obras" element={<Obras />} />
        <Route path="obras/:id" element={<ObraDetalhe />} />
        <Route path="pessoas" element={<Pessoas />} />
        <Route path="mais" element={<Mais />} />
        {comercial && <Route path="comercial" element={<Comercial />} />}
        {comercial && <Route path="comercial/:id" element={<OportunidadeDetalhe />} />}
        {comercial && <Route path="propostas" element={<Propostas />} />}
        {comercial && <Route path="propostas/:id" element={<PropostaEditor />} />}
        {comercial && <Route path="biblioteca" element={<Biblioteca />} />}
        {podeFinanceiro && <Route path="financeiro" element={<Financeiro />} />}
        {podeFinanceiro && <Route path="financeiro/:id" element={<LancamentoDetalhe />} />}
        {podeFinanceiro && <Route path="contas" element={<Contas />} />}
        {podeFinanceiro && <Route path="planejador" element={<Planejador />} />}
        {ehAdmin && <Route path="configuracoes" element={<Configuracoes />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  if (!configurado) return <NaoConfigurado />;
  return (
    <BrowserRouter>
      <Routes>
        {/* Link da proposta para o cliente: sem login. */}
        <Route path="/p/:token" element={<PropostaPublica />} />
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
    </BrowserRouter>
  );
}
