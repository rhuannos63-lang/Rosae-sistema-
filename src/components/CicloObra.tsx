// Ciclo da obra/serviço no alto da página: onde está (aguardando, em andamento, entregue,
// encerrada) e um botão para o próximo passo. Iniciar e entregar são um toque, com a data.
import { useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta } from '../lib/consulta';
import { Erro, Modal, useToast } from './ui';
import { Icone } from './Icone';
import { MenuAcoes } from './MenuAcoes';
import { BotaoRecebimento } from './Recebimentos';
import { EntregarDocumentos } from './EntregaDocumentos';
import { formatarData, hoje, somarDias } from '../core/datas';
import { doBanco, formatar } from '../core/dinheiro';
import { perfilDaObra } from '../core/jornada';
import { entregaPorDocumento, nomeDoTrabalho, passoDaObra, type Passo } from '../core/entrega';
import type { Obra } from '../lib/tipos';

type ObraCiclo = Obra & { entregue_em?: string | null; encerrada_em?: string | null; cliente?: { nome: string; telefone?: string | null; email?: string | null } | null };

const PASSOS: { id: Passo; rotulo: string }[] = [
  { id: 'aguardando', rotulo: 'Aguardando início' },
  { id: 'andamento', rotulo: 'Em andamento' },
  { id: 'entregue', rotulo: 'Entregue' },
  { id: 'encerrada', rotulo: 'Encerrada' },
];

/** Hoje, ontem ou outra data, em um toque. */
export function EscolherData({ valor, aoMudar, max, rotulo }: { valor: string; aoMudar: (d: string) => void; max?: string; rotulo: string }) {
  const h = hoje();
  return (
    <div className="campo">
      {rotulo}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`chip-link${valor === h ? ' ativo' : ''}`} onClick={() => aoMudar(h)}>Hoje</button>
        <button type="button" className={`chip-link${valor === somarDias(h, -1) ? ' ativo' : ''}`} onClick={() => aoMudar(somarDias(h, -1))}>Ontem</button>
        <input type="date" aria-label={`${rotulo}: outra data`} value={valor} max={max} onChange={(e) => aoMudar(e.target.value || h)} style={{ maxWidth: 170 }} />
      </div>
    </div>
  );
}

export function CicloObra({ obra, podeFinanceiro, aoMudar }: { obra: ObraCiclo; podeFinanceiro: boolean; aoMudar: () => void }) {
  const toast = useToast();
  const perfil = perfilDaObra(obra.tipo_servico, obra.tipo_servico);
  const t = nomeDoTrabalho(perfil);
  const doc = entregaPorDocumento(perfil);
  const passo = passoDaObra(obra.status);
  const [modal, setModal] = useState<'iniciar' | 'entregar' | 'documentos' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const info = useConsulta(async () => {
    const [e, f] = await Promise.all([
      supabase.from('etapa').select('estado, inicio_previsto').eq('obra_id', obra.id),
      podeFinanceiro ? supabase.rpc('obra_falta_receber', { p_obra: obra.id }) : Promise.resolve({ data: null, error: null }),
    ]);
    const etapas = (e.data ?? []) as { estado: string; inicio_previsto: string | null }[];
    return {
      etapas: etapas.filter((x) => x.estado !== 'cancelado').length,
      abertas: etapas.filter((x) => !['executado', 'conferido', 'cancelado'].includes(x.estado)).length,
      semData: etapas.filter((x) => x.estado !== 'cancelado' && !x.inicio_previsto).length,
      falta: f.data == null ? null : doBanco(f.data as string),
    };
  }, [obra.id, obra.status, podeFinanceiro]);
  if (passo === 'cancelada') return null;
  const falta = info.dados?.falta ?? null;

  function mudou() { info.recarregar(); aoMudar(); }

  async function encerrar() {
    setErro(null);
    const r = await supabase.rpc('encerrar_obra', { p_obra: obra.id });
    if (r.error) return setErro(mensagemErro(r.error));
    toast(`${cap(t.nome)} encerrad${t.artigo}.`);
    mudou();
  }
  async function reabrir() {
    const motivo = window.prompt(`Reabrir ${t.artigo} ${t.nome}? Diga o motivo (fica no diário):`, 'Ajuste depois da entrega');
    if (motivo === null) return;
    const r = await supabase.rpc('reabrir_obra', { p_obra: obra.id, p_motivo: motivo });
    if (r.error) return setErro(mensagemErro(r.error));
    toast(`${cap(t.nome)} reaberto${t.artigo === 'a' ? 'a' : ''}.`.replace('reabertoa', 'reaberta'));
    mudou();
  }
  /** Depois de um recebimento: se já foi entregue e não falta nada, encerra sozinho. */
  async function aposReceber() {
    const r = await supabase.rpc('obra_falta_receber', { p_obra: obra.id });
    if (passo === 'entregue' && r.data != null && doBanco(r.data as string) === 0) {
      const e = await supabase.rpc('encerrar_obra', { p_obra: obra.id });
      if (!e.error) toast(`Tudo recebido: ${t.artigo} ${t.nome} foi encerrad${t.artigo}.`);
    }
    mudou();
  }

  const ordem = PASSOS.findIndex((p) => p.id === passo);
  const datas: Record<Passo, string | null> = {
    aguardando: null,
    andamento: obra.data_inicio ? `desde ${formatarData(obra.data_inicio)}` : null,
    entregue: obra.entregue_em ?? obra.data_conclusao ? `em ${formatarData(obra.entregue_em ?? obra.data_conclusao)}` : null,
    encerrada: obra.encerrada_em ? `em ${formatarData(obra.encerrada_em)}` : null,
  };

  return (
    <div className="ciclo-obra card">
      <ol className="ciclo-passos" aria-label={`Andamento d${t.artigo} ${t.nome}`}>
        {PASSOS.map((p, i) => (
          <li key={p.id} className={i < ordem ? 'feito' : i === ordem ? 'atual' : ''} aria-current={i === ordem ? 'step' : undefined}>
            <span className="ciclo-bola">{i < ordem ? <Icone nome="check" /> : i + 1}</span>
            <span><b>{p.rotulo}</b>{i <= ordem && datas[p.id] && <span className="muted small"> {datas[p.id]}</span>}</span>
          </li>
        ))}
      </ol>
      <div className="ciclo-acoes">
        <p className="ciclo-texto">
          {passo === 'aguardando' && <>Quando começar, toque em <b>Iniciar</b>: a data fica registrada{info.dados?.semData ? ` e ${info.dados.semData} etapa(s) sem data ganham datas a partir dela` : ''}.</>}
          {passo === 'andamento' && <>{info.dados ? (info.dados.abertas ? `${info.dados.abertas} de ${info.dados.etapas} etapa(s) em aberto.` : info.dados.etapas ? 'Todas as etapas concluídas.' : 'Sem etapas no cronograma.') : ''} Terminou? Toque em <b>Entregar</b>.</>}
          {passo === 'entregue' && (falta && falta > 0
            ? <>Entregue. <b>Falta receber {formatar(falta)}</b>: ao registrar o último valor, {t.artigo} {t.nome} se encerra sozinh{t.artigo}.</>
            : <>Entregue. Quando estiver tudo certo, encerre.</>)}
          {passo === 'encerrada' && <>Tudo entregue e encerrado.</>}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {passo === 'aguardando' && <button className="btn-primario" onClick={() => setModal('iniciar')}><Icone nome="seta" /> Iniciar {t.nome}</button>}
          {passo === 'andamento' && <button className="btn-primario" onClick={() => setModal('entregar')}><Icone nome="check" /> Entregar {t.nome}</button>}
          {doc && passo !== 'aguardando' && <button className={passo === 'andamento' ? 'btn-secundario' : 'btn-primario'} onClick={() => setModal('documentos')}><Icone nome="documento" /> Enviar documentos</button>}
          {podeFinanceiro && (passo !== 'encerrada' || (falta ?? 0) > 0) && <BotaoRecebimento obraId={obra.id} classe="btn-secundario" aoMudar={aposReceber} />}
          {passo === 'entregue' && (falta ?? 0) <= 0 && <button className="btn-primario" onClick={encerrar}>Encerrar</button>}
          {(passo === 'entregue' || passo === 'encerrada' || !doc) && (
            <MenuAcoes rotulo="Mais passos">
              {!doc && passo !== 'aguardando' && <button role="menuitem" onClick={() => setModal('documentos')}><Icone nome="documento" /> Enviar documentos ao cliente</button>}
              {passo === 'entregue' && (falta ?? 0) > 0 && <button role="menuitem" onClick={encerrar}>Encerrar mesmo com saldo</button>}
              {(passo === 'entregue' || passo === 'encerrada') && <button role="menuitem" onClick={reabrir}><Icone nome="desfazer" /> Reabrir</button>}
            </MenuAcoes>
          )}
        </div>
      </div>
      <Erro mensagem={erro} />
      {modal === 'iniciar' && <Iniciar obra={obra} nome={t.nome} semData={info.dados?.semData ?? 0} aoFechar={() => setModal(null)} aoSalvar={() => { setModal(null); mudou(); }} />}
      {modal === 'entregar' && (
        <Entregar obra={obra} nome={t.nome} artigo={t.artigo} abertas={info.dados?.abertas ?? 0} doc={doc} falta={falta}
          aoFechar={() => setModal(null)} aoSalvar={(docs) => { setModal(docs ? 'documentos' : null); mudou(); }} />
      )}
      {modal === 'documentos' && <EntregarDocumentos obra={obra} aoFechar={() => setModal(null)} aoMudar={mudou} />}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Iniciar({ obra, nome, semData, aoFechar, aoSalvar }: { obra: Obra; nome: string; semData: number; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [data, setData] = useState(hoje());
  const [primeira, setPrimeira] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setErro(null); setSalvando(true);
    const r = await supabase.rpc('iniciar_obra', { p_obra: obra.id, p_data: data, p_primeira_etapa: primeira });
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    const d = r.data as { programadas: number; etapa: string | null };
    toast(`Início registrado em ${formatarData(data)}.${d.etapa ? ` Em andamento: ${d.etapa}.` : ''}`);
    aoSalvar();
  }
  return (
    <Modal titulo={`Iniciar ${nome}`} aoFechar={aoFechar}
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Iniciar'}</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{obra.nome}{obra.cliente?.nome ? ` · ${obra.cliente.nome}` : ''}</p>
        <EscolherData rotulo="Começou em" valor={data} aoMudar={setData} max={somarDias(hoje(), 60)} />
        <label className="check"><input type="checkbox" checked={primeira} onChange={(e) => setPrimeira(e.target.checked)} /> Já marcar a primeira etapa como em andamento</label>
        {semData > 0 && <div className="aviso info"><span>{semData} etapa(s) sem data entram no cronograma uma depois da outra, a partir de {formatarData(data)}. Dá para ajustar depois.</span></div>}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

function Entregar({ obra, nome, artigo, abertas, doc, falta, aoFechar, aoSalvar }: {
  obra: Obra; nome: string; artigo: 'o' | 'a'; abertas: number; doc: boolean; falta: number | null; aoFechar: () => void; aoSalvar: (documentos: boolean) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState(hoje());
  const [concluir, setConcluir] = useState(true);
  const [docs, setDocs] = useState(doc);
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setErro(null); setSalvando(true);
    const r = await supabase.rpc('entregar_obra', { p_obra: obra.id, p_data: data, p_concluir_etapas: concluir, p_obs: obs.trim() || null });
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    const d = r.data as { status: string; etapas_concluidas: number };
    toast(d.status === 'encerrada_financeiramente'
      ? `${cap(nome)} entregue e encerrad${artigo}: não há nada a receber.`
      : `${cap(nome)} entregue em ${formatarData(data)}.`);
    aoSalvar(docs);
  }
  return (
    <Modal titulo={`Entregar ${nome}`} aoFechar={aoFechar}
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : docs ? 'Entregar e enviar documentos' : 'Entregar'}</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{obra.nome}{obra.cliente?.nome ? ` · ${obra.cliente.nome}` : ''}</p>
        <EscolherData rotulo="Entregue em" valor={data} aoMudar={setData} max={hoje()} />
        {abertas > 0 && <label className="check"><input type="checkbox" checked={concluir} onChange={(e) => setConcluir(e.target.checked)} /> Concluir as {abertas} etapa(s) que ainda estão em aberto</label>}
        <label className="check"><input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} /> Enviar os documentos ao cliente agora (e-mail, WhatsApp e portal)</label>
        <label className="campo">Observação (opcional)<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: entregue ao cliente na obra, com as chaves" /></label>
        {falta !== null && (falta > 0
          ? <div className="aviso"><Icone nome="alerta" /><span>Ainda falta receber <b>{formatar(falta)}</b>. {cap(nome)} fica como entregue e se encerra quando o último valor for registrado.</span></div>
          : <div className="aviso ok"><Icone nome="check" /><span>Tudo recebido: ao entregar, {artigo} {nome} já fica encerrad{artigo}.</span></div>)}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}
