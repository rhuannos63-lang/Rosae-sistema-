// Página que o cliente abre pelo link da entrega (/e/<token>): a mensagem da ROSAE e os
// arquivos para baixar. Sem login; quem decide se o link vale é o banco.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { Carregando, Erro } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData } from '../core/datas';
import { tamanhoLegivel } from '../core/entrega';
import { textoLimpo } from '../core/textoArquivo';
import { redesDaEmpresa } from '../../supabase/functions/_shared/convite';
import { linkWhatsApp } from './Comercial';

export type ArquivoEntrega = { id: string; nome: string; mime: string | null; tamanho: number | null };
type EntregaPub = {
  erro?: string; id: string; titulo: string; mensagem: string; criado_em: string; obra: string; cliente: string | null;
  arquivos: ArquivoEntrega[];
  empresa: { nome?: string | null; telefone?: string | null; email?: string | null; site?: string | null; instagram?: string | null; responsavel?: string | null } | null;
};

/** Pede o endereço temporário e baixa o arquivo. */
export async function baixarArquivoEntrega(acesso: { token?: string; portal?: string }, arquivo: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('entrega', { body: { acao: 'baixar', arquivo, ...acesso } });
  if (error) {
    let msg = 'Não consegui baixar agora. Tente de novo em instantes.';
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = j.erro; } catch { /* sem corpo */ }
    return msg;
  }
  const url = (data as { url?: string }).url;
  if (!url) return 'Não consegui baixar agora.';
  window.location.href = url;
  return null;
}

export function ListaArquivosEntrega({ arquivos, acesso }: { arquivos: ArquivoEntrega[]; acesso: { token?: string; portal?: string } }) {
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function baixar(a: ArquivoEntrega) {
    setErro(null); setBaixando(a.id);
    const e = await baixarArquivoEntrega(acesso, a.id);
    setBaixando(null);
    if (e) setErro(e);
  }
  return (
    <>
      <ul className="lista-arquivos baixar">
        {arquivos.map((a) => (
          <li key={a.id}>
            <Icone nome="documento" />
            <span className="nome">{a.nome}</span>
            <span className="muted small">{a.tamanho ? tamanhoLegivel(a.tamanho) : ''}</span>
            <button className="btn-primario btn-mini" onClick={() => baixar(a)} disabled={baixando !== null}><Icone nome="baixar" /> {baixando === a.id ? 'Abrindo…' : 'Baixar'}</button>
          </li>
        ))}
      </ul>
      <Erro mensagem={erro} />
    </>
  );
}

export function EntregaPublica() {
  const { token } = useParams();
  const [d, setD] = useState<EntregaPub | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc('entrega_publica', { p_token: token }).then((r) => {
      if (r.error) setErro(mensagemErro(r.error)); else setD(r.data as EntregaPub);
    });
  }, [token]);
  useEffect(() => { if (d && !d.erro) document.title = textoLimpo(`${d.titulo} · ROSAE`); }, [d]);

  if (erro) return <div className="publica"><Erro mensagem={erro} /></div>;
  if (!d) return <Carregando />;
  if (d.erro) {
    return (
      <div className="publica entrega-publica">
        <div className="entrega-cartao" style={{ textAlign: 'center' }}>
          <img src="/marca/rosae-logo-vertical.svg" alt="ROSAE" style={{ width: 140 }} />
          <h1>Link indisponível</h1>
          <p className="muted">{d.erro}</p>
        </div>
      </div>
    );
  }
  const redes = redesDaEmpresa(d.empresa);
  const zap = linkWhatsApp(d.empresa?.telefone, `Olá! Recebi “${d.titulo}” e tenho uma dúvida.`);
  return (
    <div className="publica entrega-publica">
      <header className="publica-cab"><img src="/marca/rosae-logo-horizontal.svg" alt={d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'} /></header>
      <article className="entrega-cartao">
        <span className="entrega-selo">Documentos entregues · {formatarData(d.criado_em.slice(0, 10))}</span>
        <h1>{d.titulo}</h1>
        {d.cliente && <p className="muted" style={{ marginTop: -4 }}>{d.cliente} · {d.obra}</p>}
        <ListaArquivosEntrega arquivos={d.arquivos} acesso={{ token }} />
        <div className="entrega-mensagem">{d.mensagem}</div>
        <footer className="entrega-contato">
          <b>Ficou alguma dúvida?</b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {zap && <a className="btn-secundario" href={zap} target="_blank" rel="noreferrer">Falar no WhatsApp</a>}
            {d.empresa?.email && <a className="btn-secundario" href={`mailto:${d.empresa.email}`}>{d.empresa.email}</a>}
            {redes.site && <a className="btn-link" href={redes.site.url} target="_blank" rel="noreferrer">{redes.site.rotulo}</a>}
            {redes.instagram && <a className="btn-link" href={redes.instagram.url} target="_blank" rel="noreferrer">{redes.instagram.arroba}</a>}
          </div>
        </footer>
      </article>
    </div>
  );
}
