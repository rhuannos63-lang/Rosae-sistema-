// Página que o cliente abre pelo link. Não exige login e só mostra o que está na versão emitida.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { PropostaDocumento, type EmpresaPublica } from '../components/PropostaDocumento';
import { Carregando, Erro } from '../components/ui';
import { formatar } from '../core/dinheiro';
import { formatarData, formatarDataHora } from '../core/datas';
import { normalizar, paginaOculta, totalConteudo, type Conteudo } from '../core/proposta';

type Publica = {
  erro?: string; codigo: string; tipo: 'proposta' | 'aditivo'; titulo: string; versao: number; valor_total: string; conteudo: Partial<Conteudo>;
  emitida_em: string; validade: string; hash: string; cliente: string; empresa: EmpresaPublica | null; atual: boolean; vencida: boolean;
  estado: string; aprovada_esta_versao: boolean; aprovada_por: string | null; aprovada_em: string | null;
};

export function PropostaPublica() {
  const { token } = useParams();
  const [d, setD] = useState<Publica | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<'aceitar' | 'ajuste' | 'recusar' | null>(null);
  const [f, setF] = useState({ nome: '', email: '', documento: '', comentario: '', concordo: false });
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<string | null>(null);
  const [opcao, setOpcao] = useState<string | null>(null);

  async function carregar(registrar: boolean) {
    const r = await supabase.rpc('proposta_publica', { p_token: token, p_registrar: registrar });
    if (r.error) return setErro(mensagemErro(r.error));
    setD(r.data as Publica);
  }
  useEffect(() => { carregar(true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { if (d && !d.erro) document.title = `${d.codigo} · ${d.titulo} · ROSAE`; }, [d]);

  async function responder(e: React.FormEvent) {
    e.preventDefault();
    if (!acao) return;
    if (acao === 'aceitar' && !f.concordo) return setErro('Marque a confirmação para aceitar.');
    setErro(null);
    setEnviando(true);
    const r = await supabase.rpc('proposta_responder', {
      p_token: token, p_acao: acao, p_nome: f.nome, p_email: f.email || null, p_documento: f.documento || null,
      p_comentario: f.comentario || null, p_user_agent: navigator.userAgent,
    });
    setEnviando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    setResposta((r.data as { mensagem: string }).mensagem);
    setAcao(null);
    carregar(false);
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
  const c = normalizar(d.conteudo);
  const podeAceitar = d.atual && !d.vencida && d.estado !== 'aprovada';
  const opcoes = paginaOculta(c, 'pacotes') ? [] : (c.opcoes ?? []).filter((o) => o.valor > 0);
  const escolhe = opcoes.length > 1 && d.estado !== 'aprovada' && d.atual;
  const principal = opcoes.find((o) => o.principal);
  const escolhida = opcoes.find((o) => o.nome === opcao) ?? principal;
  const outraOpcao = !!(escolhida && principal && escolhida.nome !== principal.nome);
  const tel = (d.empresa?.telefone ?? '').replace(/\D/g, '');
  const whats = tel ? `https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}?text=${encodeURIComponent(`Olá! Vi a proposta ${d.codigo} (${d.titulo}) e tenho uma dúvida.`)}` : null;
  function abrir(a: 'aceitar' | 'ajuste' | 'recusar') {
    if (a === 'aceitar' && outraOpcao) {
      setF((x) => ({ ...x, comentario: `Gostaria de seguir com o pacote ${escolhida!.nome} (${formatar(Math.round(escolhida!.valor * 100))}).` }));
      setAcao('ajuste');
    } else setAcao(a);
    setTimeout(() => document.getElementById('resposta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  return (
    <div className="publica">
      <header className="publica-cab">
        <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" />
        <div className="spacer" />
        <span className="small muted">{d.codigo} · versão {d.versao}</span>
      </header>
      {!d.atual && <div className="aviso" style={{ margin: '0 0 12px' }}><span>Existe uma versão mais nova desta proposta. Peça o link atualizado à ROSAE para responder.</span></div>}
      {d.vencida && d.atual && !d.aprovada_esta_versao && <div className="aviso" style={{ margin: '0 0 12px' }}><span>A validade desta proposta terminou em {formatarData(d.validade)}. Peça uma versão atualizada.</span></div>}
      {d.aprovada_esta_versao && (
        <div className="aviso ok" style={{ margin: '0 0 12px' }}><span>Proposta aceita por <b>{d.aprovada_por}</b> em {formatarDataHora(d.aprovada_em)}. Obrigado pela confiança!</span></div>
      )}
      {resposta && <div className="aviso ok" style={{ margin: '0 0 12px' }}><span>{resposta}</span></div>}

      <PropostaDocumento
        d={{ codigo: d.codigo, tipo: d.tipo, titulo: d.titulo, versao: d.versao, cliente: d.cliente, emitida_em: d.emitida_em, validade: d.validade, hash: d.hash, conteudo: c, empresa: d.empresa }}
        escolha={escolhe ? { atual: escolhida?.nome ?? null, aoEscolher: setOpcao } : undefined}
      />

      <div className="card resposta-cliente" id="resposta">
        <h2>Sua resposta</h2>
        <p className="muted" style={{ marginTop: 4 }}>Total desta versão: <b>{formatar(totalConteudo(c))}</b></p>
        {escolhe && escolhida && (
          <div className="pacote-escolhido">
            <span className="muted small">Pacote escolhido</span>
            <b>{escolhida.nome} · <span className="num">{formatar(Math.round(escolhida.valor * 100))}</span></b>
            <button type="button" className="btn-link small" onClick={() => document.querySelector('.opcoes-doc')?.closest('.slide')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Trocar de pacote</button>
            {outraOpcao && <p className="muted small" style={{ margin: '4px 0 0', flexBasis: '100%' }}>Vamos preparar a versão com o pacote {escolhida.nome} para você aprovar. É só confirmar abaixo.</p>}
          </div>
        )}
        {!acao ? (
          <div className="row">
            {podeAceitar && <button className="btn-primario" onClick={() => abrir('aceitar')}>{outraOpcao ? `Quero o pacote ${escolhida!.nome}` : 'Aceitar esta proposta'}</button>}
            {d.estado !== 'aprovada' && <button className="btn-secundario" onClick={() => abrir('ajuste')}>Pedir ajuste</button>}
            {whats && <a className="btn-secundario" href={whats} target="_blank" rel="noopener noreferrer">Falar com o engenheiro</a>}
            {d.estado !== 'aprovada' && d.atual && <button className="btn-link" onClick={() => abrir('recusar')}>Não tenho interesse</button>}
            <button className="btn-link" onClick={() => window.print()}>Salvar em PDF</button>
          </div>
        ) : (
          <form className="stack" onSubmit={responder}>
            <h3>{{ aceitar: 'Aceitar a proposta', ajuste: 'Pedir ajuste', recusar: 'Recusar' }[acao]}</h3>
            <label className="campo">Nome completo<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required minLength={3} autoComplete="name" /></label>
            <div className="grid grid-2">
              <label className="campo">E-mail<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
              {acao === 'aceitar' && <label className="campo">CPF ou CNPJ (opcional)<input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} inputMode="numeric" /></label>}
            </div>
            <label className="campo">
              {acao === 'aceitar' ? 'Comentário (opcional)' : acao === 'ajuste' ? 'O que gostaria de ajustar?' : 'Se quiser, conte o motivo'}
              <textarea value={f.comentario} onChange={(e) => setF({ ...f, comentario: e.target.value })} required={acao === 'ajuste'} />
            </label>
            {acao === 'aceitar' && (
              <label className="check">
                <input type="checkbox" checked={f.concordo} onChange={(e) => setF({ ...f, concordo: e.target.checked })} />
                Li e concordo com o escopo, os valores, os prazos e as condições desta versão ({d.codigo} v{d.versao}, código {d.hash.slice(0, 16).toUpperCase()}).
              </label>
            )}
            <Erro mensagem={erro} />
            <div className="row">
              <button className="btn-primario" disabled={enviando}>{enviando ? 'Enviando…' : 'Confirmar'}</button>
              <button type="button" className="btn-link" onClick={() => setAcao(null)}>Voltar</button>
            </div>
          </form>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          {d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'}{d.empresa?.telefone ? ` · ${d.empresa.telefone}` : ''}{d.empresa?.email ? ` · ${d.empresa.email}` : ''}
        </p>
      </div>
      {podeAceitar && !acao && (
        <div className="cta-fixa">
          <span className="cta-total"><span className="muted small">{escolhida ? `Pacote ${escolhida.nome}` : 'Total'}</span><b className="num">{formatar(escolhida ? Math.round(escolhida.valor * 100) : totalConteudo(c))}</b></span>
          {whats && <a className="btn-secundario" href={whats} target="_blank" rel="noopener noreferrer">Tirar dúvida</a>}
          <button className="btn-primario" onClick={() => abrir('aceitar')}>{outraOpcao ? 'Quero este pacote' : 'Aceitar proposta'}</button>
        </div>
      )}
    </div>
  );
}
