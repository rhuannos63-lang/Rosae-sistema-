import { useEffect, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, Carregando, Erro, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarDataHora } from '../core/datas';
import { formatarBytes, formatarMeses, projetar, type UsoArmazenamento } from '../core/armazenamento';
import { definirMinutosInatividade, minutosInatividade, OPCOES_INATIVIDADE } from '../lib/seguranca';

/** Configurações › Dados e segurança: uso do armazenamento, backups, código em 2 etapas e inatividade. */
export function SegurancaDados() {
  return (
    <>
      <Armazenamento />
      <DuasEtapas />
      <Inatividade />
    </>
  );
}

function Medidor({ rotulo, usado, limite, detalhe, desligado }: { rotulo: string; usado: number; limite: number; detalhe?: string; desligado?: boolean }) {
  const pct = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0;
  const cor = pct >= 85 ? 'var(--desfavoravel)' : pct >= 70 ? 'var(--alerta)' : undefined;
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className="valor num">{desligado ? 'Desligado' : formatarBytes(usado)}</div>
      <div className="det">{desligado ? 'Ligue o Cloudflare R2 para guardar 10 anos' : `de ${formatarBytes(limite)} · ${pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`}</div>
      {!desligado && <div className="barra-meta" aria-hidden="true"><div style={{ width: `${Math.max(pct, 1)}%`, background: cor }} /></div>}
      {detalhe && <div className="det">{detalhe}</div>}
    </div>
  );
}

function Armazenamento() {
  const { dados, erro, carregando, recarregar } = useConsulta(async () => ok(await supabase.rpc('uso_armazenamento')) as UsoArmazenamento, []);
  if (carregando && !dados) return <div className="card"><Carregando /></div>;
  if (erro) return <div className="card"><Erro mensagem={erro} /></div>;
  if (!dados) return null;
  const p = projetar(dados);
  const r2Ligado = dados.frio.copiado_quantidade > 0 || dados.backups.some((b) => b.destino === 'r2');
  const anos = dados.config.guarda_anos;
  const ultimo = dados.backups[0];
  const horasDesde = ultimo ? (Date.now() - new Date(ultimo.em).getTime()) / 3600000 : Infinity;

  return (
    <div className="card stack">
      <h2>Armazenamento e guarda de {anos} anos</h2>
      <div className="grid grid-kpi">
        <Medidor rotulo="Banco de dados" usado={dados.banco.bytes} limite={dados.banco.limite_bytes} detalhe="Cadastros, propostas, contratos, financeiro e histórico" />
        <Medidor rotulo="Arquivos no Supabase" usado={dados.arquivos.bytes} limite={dados.arquivos.limite_bytes} detalhe={`${dados.arquivos.quantidade.toLocaleString('pt-BR')} arquivos · fotos ${formatarBytes(dados.arquivos.fotos_bytes)}`} />
        <Medidor rotulo="Arquivo frio (Cloudflare R2)" usado={dados.frio.copiado_bytes} limite={dados.frio.limite_bytes} desligado={!r2Ligado}
          detalhe={r2Ligado ? `${dados.frio.copiado_quantidade.toLocaleString('pt-BR')} com cópia · ${dados.frio.quantidade.toLocaleString('pt-BR')} só no R2` : undefined} />
      </div>

      <div className={`aviso ${p.supabase_arquivos_enche_em !== null && !r2Ligado ? '' : 'info'}`}>
        <Icone nome="grafico" />
        <div>
          <strong>No ritmo atual, em {anos} anos:</strong> cerca de {formatarBytes(p.arquivos_final)} de arquivos (≈ {formatarBytes(p.arquivos_mes)} por mês) e {formatarBytes(p.banco_final)} de banco.
          {' '}
          {p.banco_enche_em !== null
            ? <>O banco grátis enche em {formatarMeses(p.banco_enche_em)}: será preciso o plano pago do Supabase.</>
            : <>O banco cabe no plano grátis o período todo.</>}
          {' '}
          {p.supabase_arquivos_enche_em === null
            ? <>Os arquivos cabem no Supabase grátis.</>
            : r2Ligado
              ? <>Os arquivos passariam de {formatarBytes(dados.arquivos.limite_bytes)} em {formatarMeses(p.supabase_arquivos_enche_em)}; o sistema leva os mais antigos para o R2 sozinho, sem você fazer nada.{p.custo_r2_mes_usd > 0 ? ` Acima de 10 GB o R2 cobra cerca de US$ ${p.custo_r2_mes_usd.toFixed(2).replace('.', ',')} por mês.` : ' Tudo dentro dos 10 GB grátis do R2.'}</>
              : <>Os arquivos enchem o Supabase grátis em {formatarMeses(p.supabase_arquivos_enche_em)}. Ligue o Cloudflare R2 para guardar os {anos} anos.</>}
        </div>
      </div>

      <h3 style={{ margin: '6px 0 0' }}>Backups</h3>
      <p className="muted" style={{ margin: 0 }}>
        {r2Ligado
          ? <>Todo dia às 3h (Brasília) o banco inteiro é copiado e criptografado (AES-256) no Cloudflare R2: os diários ficam 35 dias e um por mês fica {anos} anos. Fotos e arquivos novos também são copiados todo dia.</>
          : <>Todo dia às 3h (Brasília) o banco inteiro é copiado e criptografado (AES-256) e fica 30 dias no GitHub; no dia 1 de cada mês a cópia inclui todos os arquivos. Para guardar {anos} anos, ligue o Cloudflare R2.</>}
        {' '}Isso também evita a pausa do plano gratuito do Supabase.
      </p>
      {ultimo ? (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Onde</th><th className="num">Tamanho</th><th className="num">Arquivos copiados</th><th>Situação</th></tr></thead>
            <tbody>
              {dados.backups.map((b) => (
                <tr key={b.em}>
                  <td>{formatarDataHora(b.em)}</td>
                  <td>{b.tipo === 'mensal' ? `Mensal (${anos} anos)` : b.tipo === 'manual' ? 'Manual' : 'Diário'}</td>
                  <td>{b.destino === 'r2' ? 'Cloudflare R2' : 'GitHub (30 dias)'}</td>
                  <td className="num">{b.bytes ? formatarBytes(b.bytes) : '—'}</td>
                  <td className="num">{b.arquivos_copiados}{b.arquivos_arquivados ? ` · ${b.arquivos_arquivados} levados ao R2` : ''}</td>
                  <td>{b.ok ? <span className="selo ok">Concluído</span> : <span className="selo erro" title={b.detalhe ?? ''}>Com falha</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>O primeiro registro aparece aqui depois do próximo backup.</p>
      )}
      {ultimo && horasDesde > 36 && <div className="aviso erro"><Icone nome="alerta" />O último backup foi há mais de um dia e meio. Confira em GitHub › Actions › “Backup diário”.</div>}
      {ultimo && !ultimo.ok && <div className="aviso erro"><Icone nome="alerta" />O último backup teve falha. {ultimo.detalhe}</div>}

      <details>
        <summary className="muted" style={{ cursor: 'pointer' }}>O que mais ocupa o banco</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {dados.banco.tabelas.map((t) => <li key={t.tabela}>{t.tabela}: {formatarBytes(t.bytes)}</li>)}
        </ul>
      </details>
      <Limites uso={dados} aoMudar={recarregar} />
    </div>
  );
}

function Limites({ uso, aoMudar }: { uso: UsoArmazenamento; aoMudar: () => void }) {
  const toast = useToast();
  const [banco, setBanco] = useState(uso.config.limite_banco_mb);
  const [arquivos, setArquivos] = useState(uso.config.limite_arquivos_mb);
  const mudou = banco !== uso.config.limite_banco_mb || arquivos !== uso.config.limite_arquivos_mb;
  async function salvar() {
    const { error } = await supabase.from('armazenamento_config').update({ limite_banco_mb: banco, limite_arquivos_mb: arquivos, atualizado_em: new Date().toISOString() }).eq('id', 1);
    if (error) return toast(mensagemErro(error));
    toast('Limites atualizados.');
    aoMudar();
  }
  return (
    <details>
      <summary className="muted" style={{ cursor: 'pointer' }}>Limites do plano do Supabase</summary>
      <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <label className="campo">Banco (MB)<input type="number" min={100} value={banco} onChange={(e) => setBanco(Number(e.target.value) || 0)} /></label>
        <label className="campo">Arquivos (MB)<input type="number" min={100} value={arquivos} onChange={(e) => setArquivos(Number(e.target.value) || 0)} /></label>
        <button className="btn-secundario" disabled={!mudou || banco < 100 || arquivos < 100} onClick={salvar}>Salvar</button>
      </div>
      <p className="muted" style={{ margin: '6px 0 0' }}>Plano grátis: 500 MB de banco e 1.024 MB de arquivos. Só mude se trocar de plano. Quando os arquivos passam de {uso.config.arquivar_acima_pct}% do limite, os com mais de {uso.config.idade_minima_meses} meses vão para o R2 até voltar a {uso.config.alvo_pct}%.</p>
    </details>
  );
}

type Fator = { id: string; friendly_name?: string; status: string; created_at: string };

function DuasEtapas() {
  const toast = useToast();
  const [fatores, setFatores] = useState<Fator[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ id: string; qr: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return setErro(mensagemErro(error));
    setFatores(((data?.all ?? []) as Fator[]).filter((f) => f.status === 'verified'));
  }
  useEffect(() => { void carregar(); }, []);

  async function comecar() {
    setErro(null);
    setOcupado(true);
    // Limpa tentativas anteriores que não foram confirmadas.
    const { data: todos } = await supabase.auth.mfa.listFactors();
    for (const f of (todos?.all ?? []) as Fator[]) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const nome = `Celular ${new Date().toLocaleDateString('pt-BR')} ${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: nome, issuer: 'ROSAE' });
    setOcupado(false);
    if (error || !data || !('totp' in data)) return setErro(mensagemErro(error ?? 'Não consegui gerar o QR code.'));
    setNovo({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
    setCodigo('');
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo) return;
    setErro(null);
    setOcupado(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: novo.id, code: codigo.replace(/\D/g, '') });
    setOcupado(false);
    if (error) return setErro('Código incorreto. Confira o relógio do celular e digite o código que aparece agora.');
    setNovo(null);
    toast('Verificação em 2 etapas ligada.');
    void carregar();
  }

  async function remover(f: Fator) {
    if (!window.confirm(`Tirar "${f.friendly_name ?? 'este aparelho'}"? ${fatores && fatores.length === 1 ? 'A verificação em 2 etapas será desligada.' : ''}`)) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) return toast(mensagemErro(error));
    toast('Aparelho removido.');
    void carregar();
  }

  const ligada = Boolean(fatores?.length);
  return (
    <div className="card stack">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icone nome="cadeado" /> Verificação em 2 etapas {ligada ? <span className="selo ok">Ligada</span> : <span className="selo alerta">Desligada</span>}</h2>
      <p className="muted" style={{ margin: 0 }}>
        Além da senha, o login pede um código de 6 números do aplicativo autenticador do celular (Google Authenticator, Microsoft Authenticator ou o app de senhas do iPhone).
        Quem roubar a senha não entra. O banco também confere: sem o código, nenhum dado é lido.
      </p>
      <Ajuda>Cadastre dois aparelhos (por exemplo, o celular e um tablet) para não ficar sem acesso se perder um. Se perder todos, o acesso é recuperado pelo painel do Supabase (Authentication › Users › o seu usuário › remover o fator).</Ajuda>
      {fatores && fatores.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} className="stack">
          {fatores.map((f) => (
            <li key={f.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span><Icone nome="check" /> {f.friendly_name ?? 'Aplicativo autenticador'} <span className="muted">· desde {formatarDataHora(f.created_at)}</span></span>
              <button className="btn-link" onClick={() => remover(f)}>Tirar</button>
            </li>
          ))}
        </ul>
      )}
      {novo ? (
        <form className="stack" onSubmit={confirmar}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
            <img src={novo.qr} alt="QR code para o aplicativo autenticador" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--linha)' }} />
            <div className="stack" style={{ flex: 1, minWidth: 220 }}>
              <p style={{ margin: 0 }}>1. No aplicativo autenticador, toque em <strong>adicionar</strong> e leia o QR code.<br />No próprio celular, sem câmera: copie a chave abaixo e cole no aplicativo.</p>
              <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{novo.segredo}</code>
              <label className="campo">2. Digite o código que apareceu
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus style={{ fontSize: 20, letterSpacing: 5, maxWidth: 180 }} />
              </label>
              <div className="row">
                <button className="btn-primario" disabled={ocupado || codigo.replace(/\D/g, '').length !== 6}>Confirmar e ligar</button>
                <button type="button" className="btn-link" onClick={() => { void supabase.auth.mfa.unenroll({ factorId: novo.id }); setNovo(null); }}>Cancelar</button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="row"><button className={ligada ? 'btn-secundario' : 'btn-primario'} disabled={ocupado || fatores === null} onClick={comecar}>{ligada ? 'Cadastrar outro aparelho' : 'Ligar verificação em 2 etapas'}</button></div>
      )}
      <Erro mensagem={erro} />
    </div>
  );
}

function Inatividade() {
  const toast = useToast();
  const [min, setMin] = useState(minutosInatividade());
  return (
    <div className="card stack">
      <h2>Sair sozinho depois de um tempo sem uso</h2>
      <p className="muted" style={{ margin: 0 }}>Se o celular ou o computador ficar aberto e esquecido, a sessão fecha sozinha. Vale para este aparelho.</p>
      <label className="campo" style={{ maxWidth: 280 }}>Tempo sem uso
        <select value={min} onChange={(e) => { const v = Number(e.target.value); setMin(v); definirMinutosInatividade(v); toast('Preferência salva neste aparelho.'); }}>
          {OPCOES_INATIVIDADE.map((o) => <option key={o.minutos} value={o.minutos}>{o.rotulo}</option>)}
        </select>
      </label>
    </div>
  );
}
