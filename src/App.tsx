import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { configurado } from './lib/supabase';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ToastProvider, Carregando } from './components/ui';
import { Layout } from './components/Layout';
import { Login, PrimeiroAcesso, NaoConfigurado, SemAcesso } from './pages/Acesso';
import { Painel } from './pages/Painel';
import { Pessoas } from './pages/Pessoas';
import { Obras, ObraDetalhe } from './pages/Obras';
import { Financeiro, LancamentoDetalhe } from './pages/Financeiro';
import { Contas } from './pages/Contas';
import { Configuracoes } from './pages/Configuracoes';

function Rotas() {
  const { carregando, sessao, usuario, existeAdmin, podeFinanceiro, ehAdmin } = useAuth();
  if (carregando) return <Carregando />;
  if (!sessao) return <Login />;
  if (!usuario) return existeAdmin ? <SemAcesso /> : <PrimeiroAcesso />;
  if (!usuario.ativo || usuario.papel === 'cliente') return <SemAcesso cliente={usuario.papel === 'cliente'} />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Painel />} />
        <Route path="obras" element={<Obras />} />
        <Route path="obras/:id" element={<ObraDetalhe />} />
        <Route path="pessoas" element={<Pessoas />} />
        {podeFinanceiro && <Route path="financeiro" element={<Financeiro />} />}
        {podeFinanceiro && <Route path="financeiro/:id" element={<LancamentoDetalhe />} />}
        {podeFinanceiro && <Route path="contas" element={<Contas />} />}
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
      <AuthProvider>
        <ToastProvider>
          <Rotas />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
