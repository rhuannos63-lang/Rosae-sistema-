// Fichas de execução para o canteiro: rascunho → liberada pelo responsável técnico,
// com revisão impressa e QR code que abre a versão vigente (com login). Sem custos.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData, formatarDataHora } from '../core/datas';
import type { ConteudoFicha, Etapa, Ficha } from '../lib/tipos';

type Item = { id: string; nome: string };
const CAMPOS: [keyof ConteudoFicha, string, string][] = [
  ['atividades', 'Atividades', 'Uma por linha, na ordem de execução'],
  ['materiais', 'Materiais necessários', 'Sem preços'],
  ['pre_requisitos', 'Pré-requisitos', 'O que precisa estar pronto antes de começar'],
  ['conferencia', 'Pontos de conferência', 'O que será verificado na conferência técnica'],
  ['referencias', 'Referências técnicas aprovadas', 'Projeto, prancha, norma ou manual do fabricante'],
];
const vazia = (): ConteudoFicha => ({ atividades: [], materiais: [], pre_requisitos: [], conferencia: [], referencias: [] });

/** Monta uma sugestão a partir das etapas, materiais e do modelo da biblioteca. */
async function sugerirFicha(servicoId: string): Promise<ConteudoFicha> {
  const [s, e, m] = await Promise.all([
    supabase.from('servico').select('id, modelo_id').eq('id', servicoId).single(),
    supabase.from('etapa').select('nome, criterios, estado').eq('servico_id', servicoId).neq('estado', 'cancelado').order('ordem'),
    supabase.from('material').select('descricao, especificacao, quantidade, unidade').eq('servico_id', servicoId).eq('estado', 'ativo'),
  ]);
  const serv = ok(s) as { modelo_id: string | null };
  const etapas = ok(e) as Pick<Etapa, 'nome' | 'criterios'>[];
  let modelo: { pre_requisitos: string[]; criterios: string[] } | null = null;
  if (serv.modelo_id) modelo = ok(await supabase.from('modelo_servico').select('pre_requisitos, criterios').eq('id', serv.modelo_id).maybeSingle());
  return {
    ...vazia(),
    atividades: etapas.map((x) => x.nome),
    materiais: (ok(m) as { descricao: string; especificacao: string | null; quantidade: string | null; unidade: string }[]).map((x) => `${x.descricao}${x.especificacao ? ` (${x.especificacao})` : ''}${x.quantidade ? ` · ${Number(x.quantidade).toLocaleString('pt-BR')} ${x.unidade}` : ''}`),
    pre_requisitos: modelo?.pre_requisitos ?? [],
    conferencia: [...new Set([...(modelo?.criterios ?? []), ...etapas.flatMap((x) => x.criterios ?? [])])],
  };
}

export function FichasObra({ obraId, servicos, ehAdm }: { obraId: string; servicos: Item[]; ehAdm: boolean }) {
  const toast = useToast();
  const [editar, setEditar] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { dados, carregando, recarregar } = useConsulta(async () => ok(await supabase.from('ficha').select('*').eq('obra_id', obraId).order('revisao', { ascending: false })) as Ficha[], [obraId]);

  async function criar(servicoId: string) {
    setErro(null);
    try {
      const tem = (dados ?? []).some((f) => f.servico_id === servicoId);
      const conteudo = tem ? null : await sugerirFicha(servicoId);
      const r = await supabase.rpc('nova_revisao_ficha', { p_servico: servicoId, p_conteudo: conteudo, p_origem: tem ? 'manual' : 'modelo' });
      if (r.error) throw r.error;
      const f = ok(await supabase.from('ficha').select('*').eq('id', r.data as string).single()) as Ficha;
      setEditar(f);
      recarregar();
    } catch (e) { setErro(mensagemErro(e)); }
  }
  async function liberar(f: Ficha) {
    if (!window.confirm(`Liberar a revisão ${f.revisao}? Confirme que você revisou o conteúdo técnico: depois de liberada ela não muda (mudanças viram nova revisão).`)) return;
    const r = await supabase.rpc('liberar_ficha', { p_id: f.id });
    if (r.error) return setErro(mensagemErro(r.error));
    toast(`Ficha revisão ${f.revisao} liberada para o canteiro.`);
    recarregar();
  }

  if (carregando && !dados) return <Carregando />;
  return (
    <div className="card">
      <div className="topo" style={{ marginBottom: 10 }}>
        <h2>Fichas de execução <Ajuda>Uma ficha por serviço, para o celular e para imprimir. O texto sugerido (etapas, materiais e critérios da biblioteca) é só ponto de partida: revise e libere. A ficha impressa mostra a revisão e um QR code que abre a versão vigente, com login. Custos e margens nunca aparecem.</Ajuda></h2>
      </div>
      <Erro mensagem={erro} />
      {servicos.length === 0 ? <Vazio titulo="Sem serviços" /> : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Serviço</th><th>Ficha vigente</th><th>Rascunho</th><th /></tr></thead>
            <tbody>
              {servicos.map((s) => {
                const fs = (dados ?? []).filter((f) => f.servico_id === s.id);
                const lib = fs.find((f) => f.estado === 'liberada');
                const ras = fs.find((f) => f.estado === 'rascunho');
                return (
                  <tr key={s.id}>
                    <td><b>{s.nome}</b></td>
                    <td className="small">{lib ? <>Revisão {lib.revisao} · liberada em {formatarData(lib.liberada_em?.slice(0, 10))}{lib.liberada_por_nome ? ` por ${lib.liberada_por_nome}` : ''}</> : <span className="muted">—</span>}</td>
                    <td className="small">{ras ? `Revisão ${ras.revisao} em edição` : '—'}</td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {lib && <Link className="btn-secundario" to={`/fichas/${lib.id}/imprimir`} target="_blank"><Icone nome="imprimir" /> Imprimir</Link>}
                        {lib && <Link className="btn-link" to={`/ficha/${s.id}`}>Abrir</Link>}
                        {ehAdm && ras && <><button className="btn-secundario" onClick={() => setEditar(ras)}><Icone nome="editar" /> Editar</button><button className="btn-primario" onClick={() => liberar(ras)}>Liberar</button></>}
                        {ehAdm && !ras && <button className="btn-secundario" onClick={() => criar(s.id)}>{lib ? 'Nova revisão' : 'Criar ficha'}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editar && <FichaEditor f={editar} servico={servicos.find((s) => s.id === editar.servico_id)?.nome ?? ''} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); recarregar(); }} />}
    </div>
  );
}

function FichaEditor({ f, servico, aoFechar, aoSalvar }: { f: Ficha; servico: string; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const c = { ...vazia(), ...f.conteudo };
  const [t, setT] = useState<Record<string, string>>(Object.fromEntries(CAMPOS.map(([k]) => [k, ((c[k] as string[]) ?? []).join('\n')])));
  const [responsavel, setResponsavel] = useState(c.responsavel ?? '');
  const [obs, setObs] = useState(c.observacoes ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const conteudo: ConteudoFicha = {
      ...(Object.fromEntries(CAMPOS.map(([k]) => [k, t[k].split('\n').map((x) => x.trim()).filter(Boolean)])) as unknown as ConteudoFicha),
      responsavel: responsavel.trim() || undefined, observacoes: obs.trim() || undefined,
    };
    const r = await supabase.from('ficha').update({ conteudo }).eq('id', f.id);
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Rascunho da ficha salvo.');
    aoSalvar();
  }
  return (
    <Modal titulo={`Ficha · ${servico} · revisão ${f.revisao}`} aoFechar={aoFechar} largo
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar}>Salvar rascunho</button></>}>
      <div className="stack">
        {f.origem !== 'manual' && <div className="aviso info"><span>Conteúdo sugerido a partir da biblioteca e das etapas. Revise tudo antes de liberar: é orientação técnica para o canteiro.</span></div>}
        <label className="campo">Responsável no canteiro<input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} /></label>
        {CAMPOS.map(([k, rot, dica]) => (
          <label key={k} className="campo">{rot}<textarea rows={k === 'atividades' ? 6 : 3} value={t[k]} onChange={(e) => setT((x) => ({ ...x, [k]: e.target.value }))} /><span className="dica">{dica}</span></label>
        ))}
        <label className="campo">Observações<textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

type FichaCompleta = Ficha & { obra: { nome: string; codigo: string; endereco: string | null }; servico: { nome: string; ambientes: { ambiente: { nome: string } }[] } };
const SELECT_FICHA = '*, obra:obra(nome, codigo, endereco), servico:servico(nome, ambientes:servico_ambiente(ambiente:ambiente(nome)))';

function useQr(texto: string) {
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(texto, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg('')); }, [texto]);
  return svg;
}

export function FichaDocumento({ f }: { f: FichaCompleta }) {
  const c = { ...vazia(), ...f.conteudo };
  const url = `${window.location.origin}/ficha/${f.servico_id}?r=${f.revisao}`;
  const qr = useQr(url);
  const ambientes = f.servico.ambientes?.map((a) => a.ambiente.nome).join(', ');
  return (
    <article className="doc-a4 ficha-doc">
      <header className="doc-cab">
        <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" />
        <div className="ficha-qr" aria-label="QR code da versão vigente" dangerouslySetInnerHTML={{ __html: qr }} />
      </header>
      <h1>Ficha de execução · {f.servico.nome}</h1>
      <dl className="dl compacto">
        <dt>Obra</dt><dd>{f.obra.nome} ({f.obra.codigo})</dd>
        {ambientes && <><dt>Ambiente</dt><dd>{ambientes}</dd></>}
        {c.responsavel && <><dt>Responsável</dt><dd>{c.responsavel}</dd></>}
        <dt>Revisão</dt><dd>{f.revisao} · {f.estado === 'liberada' ? `liberada em ${formatarDataHora(f.liberada_em)}${f.liberada_por_nome ? ` por ${f.liberada_por_nome}` : ''}` : f.estado === 'substituida' ? 'SUBSTITUÍDA: consulte a versão vigente pelo QR code' : 'RASCUNHO: não liberada'}</dd>
      </dl>
      {CAMPOS.map(([k, rot]) => {
        const v = c[k] as string[];
        if (!v?.length) return null;
        return (
          <section key={k}>
            <h2>{rot}</h2>
            {k === 'atividades' || k === 'conferencia' ? (
              <ul className="ficha-check">{v.map((x, i) => <li key={i}><span className="caixa" aria-hidden="true" />{x}</li>)}</ul>
            ) : <ul>{v.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </section>
        );
      })}
      {c.observacoes && <section><h2>Observações</h2><p>{c.observacoes}</p></section>}
      <section><h2>Impedimentos encontrados</h2><div className="linhas-escrever" /></section>
      <footer className="doc-rodape small">Escaneie o QR code para abrir a versão vigente (acesso com login). Esta folha é a revisão {f.revisao}.</footer>
    </article>
  );
}

export function FichaImprimir() {
  const { id } = useParams();
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.from('ficha').select(SELECT_FICHA).eq('id', id!).single()) as FichaCompleta, [id]);
  useEffect(() => { if (dados) { document.title = `Ficha ${dados.servico.nome} rev ${dados.revisao}`; setTimeout(() => window.print(), 800); } }, [dados]);
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro ?? 'Não encontrada.'} />;
  return <div className="pagina-impressao a4"><FichaDocumento f={dados} /></div>;
}

/** Aberta pelo QR code: mostra a revisão liberada vigente do serviço. */
export function FichaAtual() {
  const { servicoId } = useParams();
  const [params] = useSearchParams();
  const impressa = Number(params.get('r')) || null;
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.from('ficha').select(SELECT_FICHA).eq('servico_id', servicoId!).eq('estado', 'liberada').maybeSingle()) as FichaCompleta | null, [servicoId]);
  if (carregando) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados) return <Vazio titulo="Nenhuma ficha liberada para este serviço ou sem acesso a esta obra" />;
  return (
    <div className="stack">
      {impressa && impressa < dados.revisao && <div className="aviso erro"><Icone nome="alerta" /><span>A folha impressa é a revisão {impressa}, que foi substituída. Siga esta revisão {dados.revisao}.</span></div>}
      {impressa && impressa === dados.revisao && <div className="aviso ok"><Icone nome="check" /><span>A folha impressa (revisão {impressa}) é a vigente.</span></div>}
      <div className="row nao-imprimir"><Link className="btn-secundario" to={`/obras/${dados.obra_id}?aba=cronograma`}><Icone nome="voltar" /> Obra</Link><Link className="btn-secundario" to={`/fichas/${dados.id}/imprimir`} target="_blank"><Icone nome="imprimir" /> Imprimir</Link></div>
      <div className="card"><FichaDocumento f={dados} /></div>
    </div>
  );
}
