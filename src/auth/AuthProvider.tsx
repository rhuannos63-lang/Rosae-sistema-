import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Usuario } from '../lib/tipos';

type Estado = {
  carregando: boolean;
  sessao: Session | null;
  usuario: Usuario | null;
  existeAdmin: boolean | null;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
  definirSenha: boolean;
  senhaDefinida: () => void;
  podeFinanceiro: boolean;
  ehAdmin: boolean;
};

const Ctx = createContext<Estado | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [existeAdmin, setExisteAdmin] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Link de criar/recuperar senha (e-mail do Supabase) abre a tela de nova senha.
  const [definirSenha, setDefinirSenha] = useState(() => /type=(recovery|invite)/.test(window.location.hash));

  const carregarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setUsuario(null);
      setExisteAdmin(null);
      setCarregando(false);
      return;
    }
    const [{ data: u }, { data: adm }] = await Promise.all([
      supabase.from('usuario').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('existe_administrador'),
    ]);
    setUsuario((u as Usuario) ?? null);
    setExisteAdmin(Boolean(adm));
    setCarregando(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      carregarPerfil(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setDefinirSenha(true);
      setSessao(s);
      carregarPerfil(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [carregarPerfil]);

  const valor: Estado = {
    carregando,
    sessao,
    usuario,
    existeAdmin,
    recarregar: () => carregarPerfil(sessao),
    sair: async () => {
      await supabase.auth.signOut();
    },
    // Só controla o que aparece na tela; quem decide de verdade é o banco (RLS).
    definirSenha,
    senhaDefinida: () => setDefinirSenha(false),
    podeFinanceiro: Boolean(usuario?.ativo && (usuario.papel === 'administrador' || (usuario.papel === 'administrativo' && usuario.acesso_financeiro))),
    ehAdmin: Boolean(usuario?.ativo && usuario.papel === 'administrador'),
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
