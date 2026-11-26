import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Usuario } from '../lib/tipos';
import { aoMudarAparencia, definirAparencia, normalizar } from '../lib/aparencia';
import { inativoDemais, marcarAtividade, minutosInatividade, SAIU_POR_INATIVIDADE } from '../lib/seguranca';

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
  /** Login com senha feito, falta o código do aplicativo autenticador (verificação em 2 etapas). */
  precisaCodigo: boolean;
};

const Ctx = createContext<Estado | null>(null);

// Aparência escolhida vale em todos os aparelhos: lê do banco ao entrar e grava a cada mudança.
// Se a tabela ainda não existir, fica só no aparelho (sem erro na tela).
let espera: ReturnType<typeof setTimeout> | undefined;
async function sincronizarAparencia() {
  const { data } = await supabase.from('preferencia_usuario').select('aparencia').maybeSingle();
  if (data?.aparencia && Object.keys(data.aparencia).length) definirAparencia(normalizar(data.aparencia), 'banco');
  aoMudarAparencia((a) => {
    clearTimeout(espera);
    espera = setTimeout(() => { void supabase.from('preferencia_usuario').upsert({ aparencia: a }); }, 600);
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [existeAdmin, setExisteAdmin] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [precisaCodigo, setPrecisaCodigo] = useState(false);
  // Link de criar/recuperar senha (e-mail do Supabase) abre a tela de nova senha.
  const [definirSenha, setDefinirSenha] = useState(() => /type=(recovery|invite)/.test(window.location.hash));

  const carregarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setUsuario(null);
      setExisteAdmin(null);
      setPrecisaCodigo(false);
      setCarregando(false);
      return;
    }
    // Quem ativou o código do celular só vê os dados depois de digitá-lo (o banco também exige).
    const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel?.nextLevel === 'aal2' && nivel.currentLevel !== 'aal2') {
      setPrecisaCodigo(true);
      setCarregando(false);
      return;
    }
    setPrecisaCodigo(false);
    const [{ data: u }, { data: adm }] = await Promise.all([
      supabase.from('usuario').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('existe_administrador'),
    ]);
    setUsuario((u as Usuario) ?? null);
    setExisteAdmin(Boolean(adm));
    setCarregando(false);
    if (u) sincronizarAparencia();
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

  // Saída por inatividade: sem uso pelo tempo escolhido (Configurações › Dados e segurança),
  // a sessão é encerrada. Vale também ao reabrir o aplicativo no dia seguinte.
  const logado = Boolean(sessao);
  useEffect(() => {
    if (!logado) return;
    const conferir = () => {
      if (inativoDemais()) {
        sessionStorage.setItem(SAIU_POR_INATIVIDADE, String(minutosInatividade()));
        aoMudarAparencia(null);
        void supabase.auth.signOut();
        return true;
      }
      return false;
    };
    if (conferir()) return;
    marcarAtividade(true);
    const ativo = () => marcarAtividade();
    const visivel = () => { if (document.visibilityState === 'visible' && !conferir()) marcarAtividade(true); };
    const eventos = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    eventos.forEach((e) => window.addEventListener(e, ativo, { passive: true }));
    document.addEventListener('visibilitychange', visivel);
    const relogio = window.setInterval(conferir, 60_000);
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, ativo));
      document.removeEventListener('visibilitychange', visivel);
      window.clearInterval(relogio);
    };
  }, [logado]);

  const valor: Estado = {
    carregando,
    sessao,
    usuario,
    existeAdmin,
    recarregar: () => carregarPerfil(sessao),
    sair: async () => {
      aoMudarAparencia(null);
      await supabase.auth.signOut();
    },
    // Só controla o que aparece na tela; quem decide de verdade é o banco (RLS).
    definirSenha,
    senhaDefinida: () => setDefinirSenha(false),
    podeFinanceiro: Boolean(usuario?.ativo && (usuario.papel === 'administrador' || (usuario.papel === 'administrativo' && usuario.acesso_financeiro))),
    ehAdmin: Boolean(usuario?.ativo && usuario.papel === 'administrador'),
    precisaCodigo,
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
