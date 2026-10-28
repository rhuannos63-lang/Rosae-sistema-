// Página que o contratante abre pelo link de assinatura. Não exige login: mostra o contrato
// congelado e registra o aceite eletrônico (nome, CPF/CNPJ, data e a versão exata lida).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { Carregando, Erro } from '../components/ui';
import { formatarDataHora } from '../core/datas';
import { ContratoDocumento } from './ObraContrato';
import type { Contrato } from '../lib/tipos';

type Publico = Pick<Contrato, 'codigo' | 'estado' | 'minuta' | 'hash' | 'emitido_em' | 'valor_total' | 'modelo' | 'conteudo'> & {
  erro?: string; id: string; assinado_em: string | null;
  obra: { codigo: string; nome: string; endereco: string | null };
  empresa: { nome?: string; telefone?: string | null; email?: string | null } | null;
  aceite: { nome: string; em: string } | null;
};

function documentoValido(v: string) {
  const d = v.replace(/\D/g, '');
  return d.length === 11 || d.length === 14;
}

export function ContratoPublico() {
  const { token } = useParams();
  const [d, setD] = useState<Publico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState({ nome: '', documento: '', email: '', concordo: false });
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<string | null>(null);

  async function carregar() {
    const r = await supabase.rpc('contrato_publico', { p_token: token });
    if (r.error) return setErro(mensagemErro(r.error));
    setD(r.data as Publico);
  }
  useEffect(() => { carregar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { if (d && !d.erro) document.title = `${d.codigo} · Contrato · ROSAE`; }, [d]);

  async function assinar(e: React.FormEvent) {
    e.preventDefault();
    if (!d) return;
    if (f.nome.trim().split(/\s+/).length < 2) return setErro('Informe seu nome completo.');
    if (!documentoValido(f.documento)) return setErro('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
    if (!f.concordo) return setErro('Marque que leu e concorda com o contrato.');
    setErro(null);
    setEnviando(true);
    const r = await supabase.rpc('contrato_assinar', {
      p_token: token, p_nome: f.nome, p_documento: f.documento, p_email: f.email || null,
      p_hash: d.hash, p_concordo: f.concordo, p_user_agent: navigator.userAgent,
    });
    setEnviando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    setResposta((r.data as { mensagem: string }).mensagem);
    // O link é desativado após o aceite: mostra o estado final sem recarregar pelo link.
    setD({ ...d, estado: 'assinado', aceite: { nome: f.nome.trim(), em: new Date().toISOString() } });
  }

  if (erro && !d) return <div className="publica"><Erro mensagem={erro} /></div>;
  if (!d) return <Carregando />;
  if (d.erro) {
    return (
      <div className="publica">
        <div className="card" style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
          <img src="/marca/rosae-logo-vertical.svg" alt="ROSAE" style={{ width: 150 }} />
          <p>{d.erro}</p>
        </div>
      </div>
    );
  }
  const assinado = d.estado === 'assinado';

  return (
    <div className="publica">
      <header className="publica-cab">
        <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" />
        <div className="spacer" />
        <span className="small muted">{d.codigo} · {d.obra.nome}</span>
      </header>
      {resposta && <div className="aviso ok" style={{ margin: '0 0 12px' }}><span>{resposta}</span></div>}
      {assinado && !resposta && d.aceite && (
        <div className="aviso ok" style={{ margin: '0 0 12px' }}><span>Contrato assinado por <b>{d.aceite.nome}</b> em {formatarDataHora(d.aceite.em)}.</span></div>
      )}

      <ContratoDocumento c={d} />

      <div className="card resposta-cliente" id="assinar">
        <h2>{assinado ? 'Contrato assinado' : 'Assinar o contrato'}</h2>
        {assinado ? (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn-primario" onClick={() => window.print()}>Salvar cópia em PDF</button>
          </div>
        ) : d.estado !== 'emitido' ? (
          <p className="muted">Este contrato não está disponível para assinatura. Fale com a ROSAE.</p>
        ) : (
          <form className="stack" onSubmit={assinar}>
            <p className="muted small" style={{ margin: 0 }}>
              Leia o contrato acima com calma. Ao confirmar, ficam registrados seu nome, seu documento, a data e a hora e o código desta versão ({d.hash?.slice(0, 16).toUpperCase()}). O aceite eletrônico tem a mesma validade da assinatura no papel entre as partes.
            </p>
            <label className="campo">Nome completo<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required minLength={5} autoComplete="name" /></label>
            <div className="grid grid-2">
              <label className="campo">CPF ou CNPJ<input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} required inputMode="numeric" placeholder="Somente números ou com pontuação" /></label>
              <label className="campo">E-mail (para receber a cópia)<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
            </div>
            <label className="check">
              <input type="checkbox" checked={f.concordo} onChange={(e) => setF({ ...f, concordo: e.target.checked })} />
              Li e concordo com todas as cláusulas do contrato {d.codigo}, versão {d.hash?.slice(0, 16).toUpperCase()}.
            </label>
            <Erro mensagem={erro} />
            <div className="row">
              <button className="btn-primario" disabled={enviando}>{enviando ? 'Registrando…' : 'Assinar contrato'}</button>
              <button type="button" className="btn-link" onClick={() => window.print()}>Salvar em PDF antes</button>
            </div>
          </form>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          {d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'}{d.empresa?.telefone ? ` · ${d.empresa.telefone}` : ''}{d.empresa?.email ? ` · ${d.empresa.email}` : ''}
        </p>
      </div>
    </div>
  );
}
