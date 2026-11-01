import { useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Erro } from '../components/ui';

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="tela-login">
      <aside className="login-arte" aria-hidden="true">
        <img src="/marca/rosae-logo-horizontal-negativo.svg" alt="" className="login-arte-logo" />
        <p className="login-arte-frase">Projetamos para funcionar no <em>cálculo</em>.<br />E principalmente na <em>obra</em>.</p>
        <span className="login-arte-assina">Engenharia &amp; Estruturas</span>
      </aside>
      <div className="card">
        <img className="logo" src="/marca/rosae-logo-vertical.svg" alt="ROSAE Engenharia & Estruturas" />
        {children}
        <p className="frase">“Projetamos para funcionar no cálculo. E principalmente na obra.”</p>
      </div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) setErro(mensagemErro(error));
  }

  async function recuperar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setEnviando(false);
    if (error) setErro(mensagemErro(error));
    else setAviso('Se o e-mail estiver cadastrado, você receberá um link para criar sua senha. Confira também a caixa de spam.');
  }

  return (
    <Moldura>
      <form className="stack" onSubmit={modoRecuperar ? recuperar : entrar}>
        <label className="campo">
          E-mail
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {!modoRecuperar && (
          <label className="campo">
            Senha
            <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </label>
        )}
        <Erro mensagem={erro} />
        {aviso && <div className="aviso ok">{aviso}</div>}
        <button className="btn-primario" disabled={enviando} style={{ justifyContent: 'center' }}>
          {enviando ? 'Aguarde…' : modoRecuperar ? 'Enviar link' : 'Entrar'}
        </button>
        <button type="button" className="btn-link" onClick={() => { setModoRecuperar((v) => !v); setAviso(null); setErro(null); }}>
          {modoRecuperar ? 'Voltar ao login' : 'Primeiro acesso ou esqueci a senha'}
        </button>
      </form>
    </Moldura>
  );
}

export function PrimeiroAcesso() {
  const { sessao, recarregar, sair } = useAuth();
  const [nome, setNome] = useState('Rhuann Rosa');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const { error } = await supabase.rpc('reivindicar_administrador', { p_nome: nome });
    setEnviando(false);
    if (error) setErro(mensagemErro(error));
    else await recarregar();
  }
  return (
    <Moldura>
      <form className="stack" onSubmit={confirmar}>
        <h2>Primeiro acesso</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Ainda não há administrador. A conta <b>{sessao?.user.email}</b> será o Administrador da ROSAE, com acesso completo.
          Isso só acontece uma vez.
        </p>
        <label className="campo">
          Seu nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <Erro mensagem={erro} />
        <button className="btn-primario" disabled={enviando} style={{ justifyContent: 'center' }}>Confirmar e entrar</button>
        <button type="button" className="btn-link" onClick={sair}>Sair</button>
      </form>
    </Moldura>
  );
}

export function SemAcesso({ cliente }: { cliente?: boolean }) {
  const { sair } = useAuth();
  return (
    <Moldura>
      <div className="stack">
        <h2>{cliente ? 'Portal do cliente em preparação' : 'Acesso não liberado'}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {cliente
            ? 'O acompanhamento da sua obra ficará disponível aqui em breve. A ROSAE avisará você por e-mail.'
            : 'Sua conta existe, mas ainda não tem um perfil liberado. Peça ao administrador da ROSAE para liberar seu acesso.'}
        </p>
        <button className="btn-secundario" onClick={sair} style={{ justifyContent: 'center' }}>Sair</button>
      </div>
    </Moldura>
  );
}

export function NaoConfigurado() {
  return (
    <Moldura>
      <div className="stack">
        <h2>Configuração pendente</h2>
        <div className="aviso">
          O sistema ainda não está ligado ao banco de dados. Assim que o projeto do Supabase e os dois segredos existirem no GitHub, a configuração é feita sozinha em até uma hora.
        </div>
        <p className="muted small" style={{ margin: 0 }}>Nenhum dado foi gravado ainda.</p>
      </div>
    </Moldura>
  );
}

export function DefinirSenha() {
  const { senhaDefinida, sessao } = useAuth();
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) return setErro('Use pelo menos 8 caracteres.');
    if (senha !== repetir) return setErro('As duas senhas não são iguais.');
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    window.history.replaceState(null, '', window.location.pathname);
    senhaDefinida();
  }
  return (
    <Moldura>
      <form className="stack" onSubmit={salvar}>
        <h2>Criar sua senha</h2>
        <p className="muted small" style={{ margin: 0 }}>Conta: <b>{sessao?.user.email}</b></p>
        <label className="campo">
          Nova senha
          <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoFocus />
        </label>
        <label className="campo">
          Repita a senha
          <input type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} required />
        </label>
        <Erro mensagem={erro} />
        <button className="btn-primario" disabled={enviando} style={{ justifyContent: 'center' }}>Salvar e entrar</button>
      </form>
    </Moldura>
  );
}
