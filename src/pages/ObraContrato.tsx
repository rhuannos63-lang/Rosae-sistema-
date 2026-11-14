// Contrato da obra (gerado da proposta aprovada, congelado ao emitir), aditivos e
// biblioteca de cláusulas. Modelos sem revisão jurídica saem marcados como MINUTA.
import { Fragment, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { NovoAditivo } from '../components/NovoAditivo';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarData, formatarDataHora, hoje } from '../core/datas';
import { normalizar, type Conteudo } from '../core/proposta';
import {
  MODELO_CONTRATO, mesclarClausulas, modeloSugerido, montarContrato, pendenciasContrato, ROTULO_FALTANDO, SERVICO_CONTRATO, SERVICOS_CONTRATO,
  servicosDoContrato, textoHonorarios, tituloContrato, totalEscopo, type Clausula, type RevisaoJuridica, type ClausulaContrato, type ConteudoContrato, type Honorarios, type ModeloContrato, type Parte,
} from '../core/contrato';
import type { Perfil } from '../core/jornada';
import { ESTADO_PROPOSTA, type Contrato, type Empresa, type EstadoProposta, type Obra, type Pessoa } from '../lib/tipos';

const ESTADO_CONTRATO: Record<Contrato['estado'], { rotulo: string; classe: string }> = {
  rascunho: { rotulo: 'Rascunho', classe: 'neutro' }, emitido: { rotulo: 'Emitido · aguardando assinatura', classe: 'alerta' },
  assinado: { rotulo: 'Assinado', classe: 'ok' }, cancelado: { rotulo: 'Cancelado', classe: 'neutro' },
};
const MODELO_DE_OBRA: Record<string, ModeloContrato> = { preco_fechado: 'preco_fechado', administracao: 'administracao', projeto: 'projeto' };
export const SELO_REVISAO: Record<RevisaoJuridica, { rotulo: string; classe: string; ajuda: string }> = {
  minuta: { rotulo: 'minuta', classe: 'alerta', ajuda: 'Texto de partida, sem base legal citada. O contrato sai marcado como MINUTA.' },
  fundamentada: { rotulo: 'com base legal', classe: 'info', ajuda: 'Texto com a lei e a norma citadas, pronto para uso.' },
  revisada: { rotulo: 'revisada', classe: 'ok', ajuda: 'Revisão registrada por advogado.' },
};
/** Ao mudar o texto: o revisado por advogado deixa de ser "revisado"; o resto mantém o estado. */
const aposEditar = (r: RevisaoJuridica): RevisaoJuridica => (r === 'revisada' ? 'fundamentada' : r);

type AditivoLista = { id: string; codigo: string; titulo: string; estado: EstadoProposta; versao_aprovada_id: string | null; aprovada_em: string | null; versoes: { id: string; numero: number; valor_total: string; emitida: boolean }[] };

function parteEmpresa(e: Empresa | null): Parte {
  return {
    nome: e?.razao_social || e?.nome_fantasia || 'ROSAE Engenharia & Estruturas', documento: e?.cnpj ?? null, endereco: e?.endereco ?? null,
    email: e?.email ?? null, telefone: e?.telefone ?? null,
    extra: `Responsável técnico: ${e?.responsavel_tecnico ?? 'Eng. Rhuann Rosa'}${e?.registro_conferido && e.registro_profissional ? ` · ${e.registro_profissional}` : ''}`,
  };
}

export function ContratoObra({ obra, aoMudar }: { obra: Obra & { cliente: { nome: string; telefone?: string | null } | null }; aoMudar: () => void }) {
  const toast = useToast();
  const [gerar, setGerar] = useState<Contrato | 'novo' | null>(null);
  const [assinar, setAssinar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aditivo, setAditivo] = useState(false);
  const [params, setParams] = useSearchParams();
  const { dados, erro: erroCarga, carregando, recarregar } = useConsulta(async () => {
    const [c, a, s] = await Promise.all([
      supabase.from('contrato').select('*').eq('obra_id', obra.id).order('criado_em', { ascending: false }),
      supabase.from('proposta').select('id, codigo, titulo, estado, versao_aprovada_id, aprovada_em, versoes:proposta_versao!proposta_versao_proposta_id_fkey(id, numero, valor_total, emitida)').eq('obra_id', obra.id).eq('tipo', 'aditivo').order('criado_em'),
      supabase.from('servico').select('origem_versao_id').eq('obra_id', obra.id).not('origem_versao_id', 'is', null),
    ]);
    return { contratos: ok(c) as Contrato[], aditivos: ok(a) as AditivoLista[], incorporados: new Set((ok(s) as { origem_versao_id: string }[]).map((x) => x.origem_versao_id)) };
  }, [obra.id]);

  const atual = dados?.contratos.find((c) => c.estado !== 'cancelado') ?? null;
  // Proposta aceita e ainda sem contrato (vindo da proposta, do funil ou da aba): o gerador
  // abre sozinho. Com ?gerar=1, abre também o rascunho já salvo.
  const [abriuSozinho, setAbriuSozinho] = useState(false);
  useEffect(() => {
    if (!dados || abriuSozinho) return;
    setAbriuSozinho(true);
    const pediu = params.get('gerar') === '1';
    if (pediu) { const p = new URLSearchParams(params); p.delete('gerar'); setParams(p, { replace: true }); }
    if (!atual && (pediu || (obra.proposta_versao_id && dados.contratos.length === 0))) setGerar('novo');
    else if (pediu && atual?.estado === 'rascunho') setGerar(atual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);
  if (carregando && !dados) return <Carregando />;
  const cancelados = dados?.contratos.filter((c) => c.estado === 'cancelado') ?? [];

  async function exec(p: PromiseLike<{ error: unknown }>, msg: string) {
    setErro(null);
    const r = await p;
    if (r.error) return setErro(mensagemErro(r.error));
    toast(msg);
    recarregar();
    aoMudar();
  }
  async function emitir() {
    if (!atual) return;
    if (atual.conteudo.faltando.length && !window.confirm(`Ainda faltam dados: ${atual.conteudo.faltando.map(ROTULO_FALTANDO).join(', ')}. Eles sairão como “[a definir]”. Emitir mesmo assim?`)) return;
    exec(supabase.rpc('emitir_contrato', { p_id: atual.id }), 'Contrato emitido e congelado. Imprima ou salve em PDF para assinatura.');
  }
  async function cancelar() {
    if (!atual) return;
    const motivo = window.prompt('Motivo do cancelamento deste contrato (fica no histórico):');
    if (!motivo?.trim()) return;
    exec(supabase.from('contrato').update({ estado: 'cancelado', cancelado_motivo: motivo.trim() }).eq('id', atual.id), 'Contrato cancelado. Você pode gerar outro.');
  }
  function novoAditivo() {
    if (!obra.cliente_id) return setErro('Defina o cliente da obra antes de criar um aditivo.');
    setAditivo(true);
  }
  async function incorporar(a: AditivoLista) {
    exec(supabase.rpc('converter_proposta', { p_versao: a.versao_aprovada_id }), 'Aditivo incorporado à obra: serviços, etapas e previsão de recebimento criados. O contrato original foi preservado.');
  }

  const etapaObra = obra.status === 'em_execucao' || obra.liberada_em ? 'liberada' : atual?.estado === 'assinado' ? 'formalizada' : obra.proposta_versao_id ? 'aprovada' : 'sem_proposta';
  return (
    <div className="stack">
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Situação da contratação <Ajuda>Proposta aprovada, contrato formalizado e obra liberada são três passos diferentes. Cada um fica registrado no diário da obra.</Ajuda></h2>
        <ol className="passos">
          <li className={obra.proposta_versao_id ? 'feito' : ''}><b>Proposta aprovada</b><span className="small muted">{obra.proposta_versao_id ? 'Versão aceita pelo cliente guardada como referência' : 'Obra criada sem proposta'}</span></li>
          <li className={atual?.estado === 'assinado' ? 'feito' : atual ? 'atual' : ''}><b>Contrato formalizado</b><span className="small muted">{atual?.estado === 'assinado' ? `Assinado em ${formatarData(atual.assinado_em)}` : atual ? ESTADO_CONTRATO[atual.estado].rotulo : 'Ainda não gerado'}</span></li>
          <li className={etapaObra === 'liberada' ? 'feito' : ''}><b>Obra liberada para iniciar</b><span className="small muted">{obra.liberada_em ? `Em ${formatarDataHora(obra.liberada_em)}` : etapaObra === 'liberada' ? 'Em execução' : 'Aguardando liberação'}</span></li>
        </ol>
        {etapaObra !== 'liberada' && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className={atual?.estado === 'assinado' ? 'btn-primario' : 'btn-secundario'} onClick={() => {
              if (atual?.estado !== 'assinado' && !window.confirm('O contrato ainda não está assinado. Liberar a obra para iniciar mesmo assim?')) return;
              exec(supabase.rpc('liberar_obra', { p_obra: obra.id }), 'Obra liberada para iniciar.');
            }}>Liberar obra para iniciar</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <h2>Contrato</h2>
          <div className="row">
            <Link className="btn-link" to="/clausulas">Biblioteca de cláusulas</Link>
            {!atual && <button className="btn-primario" onClick={() => setGerar('novo')}><Icone nome="documento" /> Gerar contrato</button>}
          </div>
        </div>
        <Erro mensagem={erro ?? erroCarga} />
        {!atual ? (
          <Vazio titulo="Nenhum contrato ativo"><p>O contrato é montado com a proposta aceita, os dados do cliente e da ROSAE e as cláusulas próprias do tipo de serviço, com a base legal citada (Código Civil, Código de Defesa do Consumidor, ART e normas ABNT). Você revisa e edita tudo antes de emitir.</p></Vazio>
        ) : (
          <div className="stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><b>{atual.codigo}</b> · {atual.conteudo.titulo ?? MODELO_CONTRATO[atual.modelo].rotulo} · <span className={`selo ${ESTADO_CONTRATO[atual.estado].classe}`}>{ESTADO_CONTRATO[atual.estado].rotulo}</span>
                {atual.estado !== 'rascunho' && atual.minuta && <span className="selo alerta" style={{ marginLeft: 6 }}>Minuta (cláusulas sem revisão jurídica)</span>}
              </div>
              <div className="row">
                {atual.estado === 'rascunho' && <><button className="btn-secundario" onClick={() => setGerar(atual)}><Icone nome="editar" /> Revisar</button><button className="btn-primario" onClick={emitir}>Emitir</button></>}
                {atual.estado === 'emitido' && <button className="btn-primario" onClick={() => setAssinar(true)}>Registrar assinatura</button>}
                <Link className="btn-secundario" to={`/contratos/${atual.id}/imprimir`} target="_blank"><Icone nome="imprimir" /> PDF / imprimir</Link>
                {atual.estado !== 'rascunho' && <button className="btn-link" onClick={cancelar}>Cancelar contrato</button>}
              </div>
            </div>
            {atual.conteudo.faltando?.length > 0 && atual.estado === 'rascunho' && (
              <div className="aviso"><Icone nome="alerta" /><span>Faltam dados: {atual.conteudo.faltando.map(ROTULO_FALTANDO).join(', ')}. Complete em Configurações (dados da ROSAE), no cadastro do cliente ou em “Revisar”.</span></div>
            )}
            {atual.estado === 'assinado' && <div className="aviso ok"><Icone nome="check" /><span>Assinado em {formatarData(atual.assinado_em)} · {atual.assinatura_registro}. Código de verificação {atual.hash?.slice(0, 16).toUpperCase()}.</span></div>}
            {(atual.estado === 'emitido' || atual.estado === 'assinado') && <AssinaturaPorLink contrato={atual} cliente={obra.cliente} />}
            <div className="contrato-previa"><ContratoDocumento c={atual} /></div>
          </div>
        )}
        {cancelados.length > 0 && <p className="muted small">Contratos cancelados: {cancelados.map((c) => `${c.codigo} (${c.cancelado_motivo})`).join('; ')}</p>}
      </div>

      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <h2>Aditivos <Ajuda>Todo serviço adicional, alteração ou supressão vira um aditivo com escopo, preço, impacto no prazo e motivo. Ele segue o mesmo caminho da proposta (versão, envio, aceite do cliente) e, depois de aceito, é incorporado à obra. O contrato original nunca é alterado.</Ajuda></h2>
          <button className="btn-secundario" onClick={novoAditivo}><Icone nome="mais" /> Novo aditivo</button>
        </div>
        {(dados?.aditivos.length ?? 0) === 0 ? <p className="muted small">Nenhum aditivo.</p> : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Aditivo</th><th>Situação</th><th className="right">Valor</th><th /></tr></thead>
              <tbody>
                {dados!.aditivos.map((a) => {
                  const u = [...a.versoes].sort((x, y) => y.numero - x.numero)[0];
                  const ap = a.versoes.find((v) => v.id === a.versao_aprovada_id);
                  const inc = a.versao_aprovada_id && dados!.incorporados.has(a.versao_aprovada_id);
                  return (
                    <tr key={a.id}>
                      <td><Link to={`/propostas/${a.id}`}><b>{a.titulo}</b></Link><div className="muted small">{a.codigo}{u ? ` · v${u.numero}` : ''}</div></td>
                      <td><span className={`selo ${ESTADO_PROPOSTA[a.estado].classe}`}>{ESTADO_PROPOSTA[a.estado].rotulo}</span>{inc && <span className="selo ok" style={{ marginLeft: 6 }}>Incorporado</span>}</td>
                      <td className="right num">{formatar(doBanco((ap ?? u)?.valor_total))}</td>
                      <td className="right">{a.estado === 'aprovada' && !inc && <button className="btn-primario" onClick={() => incorporar(a)}>Incorporar à obra</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {gerar && <GerarContrato obra={obra} contrato={gerar === 'novo' ? null : gerar} aoFechar={() => setGerar(null)} aoSalvar={() => { setGerar(null); recarregar(); }} />}
      {aditivo && <NovoAditivo obraId={obra.id} aoFechar={() => setAditivo(false)} />}
      {assinar && atual && <AssinarContrato contrato={atual} aoFechar={() => setAssinar(false)} aoSalvar={() => { setAssinar(false); recarregar(); aoMudar(); }} />}
    </div>
  );
}

type LinkContrato = { id: string; expira_em: string; revogado_em: string | null; visualizacoes: number; ultima_visualizacao: string | null; criado_em: string };
type AceiteContrato = { id: string; nome: string; documento: string; email: string | null; declaracao: string; hash_contrato: string; em: string };

/** Link para o contratante ler e assinar pelo celular, com o aceite guardado (nome, documento, data, versão). */
function AssinaturaPorLink({ contrato, cliente }: { contrato: Contrato; cliente: { nome: string; telefone?: string | null } | null }) {
  const toast = useToast();
  const [novo, setNovo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { dados, recarregar } = useConsulta(async () => {
    const [l, a] = await Promise.all([
      supabase.from('contrato_link').select('id, expira_em, revogado_em, visualizacoes, ultima_visualizacao, criado_em').eq('contrato_id', contrato.id).order('criado_em', { ascending: false }),
      supabase.from('contrato_aceite').select('*').eq('contrato_id', contrato.id).order('em', { ascending: false }),
    ]);
    return { links: ok(l) as LinkContrato[], aceites: ok(a) as AceiteContrato[] };
  }, [contrato.id, contrato.estado]);
  const vigente = dados?.links.find((l) => !l.revogado_em && new Date(l.expira_em) > new Date());

  async function gerar() {
    if (vigente && !window.confirm('Já existe um link ativo. Gerar outro desativa o anterior. Continuar?')) return;
    setOcupado(true);
    const r = await supabase.rpc('criar_link_contrato', { p_contrato: contrato.id, p_dias: 15 });
    setOcupado(false);
    if (r.error) return toast(mensagemErro(r.error));
    setNovo(`${window.location.origin}/a/${r.data as string}`);
    recarregar();
  }
  async function revogar() {
    if (!window.confirm('Desativar o link de assinatura? Quem tiver o link não consegue mais abrir.')) return;
    const r = await supabase.rpc('revogar_link_contrato', { p_contrato: contrato.id });
    if (r.error) return toast(mensagemErro(r.error));
    toast('Link desativado.');
    setNovo(null);
    recarregar();
  }
  async function copiar(t: string) {
    try { await navigator.clipboard.writeText(t); toast('Link copiado.'); } catch { window.prompt('Copie o link:', t); }
  }
  const tel = (cliente?.telefone ?? '').replace(/\D/g, '');
  const whats = novo && tel ? `https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}?text=${encodeURIComponent(`Olá${cliente?.nome ? `, ${cliente.nome.split(' ')[0]}` : ''}! Segue o contrato ${contrato.codigo} da ROSAE para leitura e assinatura pelo celular: ${novo}`)}` : null;

  return (
    <div className="bloco-assinatura">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3>Assinatura pelo link <Ajuda>O cliente abre o link no celular, lê o contrato congelado e assina com nome completo e CPF/CNPJ. Ficam guardados a data, a hora, o aparelho e o código da versão. Ao assinar, o contrato passa a “Assinado” e a obra a “Contratada”. Para assinatura com certificado (gov.br), use “Registrar assinatura”.</Ajuda></h3>
        {contrato.estado === 'emitido' && (
          <div className="row" style={{ gap: 8 }}>
            {vigente && <button className="btn-link" onClick={revogar}>Desativar link</button>}
            <button className="btn-primario" disabled={ocupado} onClick={gerar}><Icone nome="link" /> {vigente ? 'Gerar novo link' : 'Gerar link de assinatura'}</button>
          </div>
        )}
      </div>
      {novo && (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="aviso ok"><Icone nome="check" /><span>Link criado. Ele aparece só agora: copie e envie ao cliente. Vale por 15 dias.</span></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input readOnly value={novo} onFocus={(e) => e.target.select()} style={{ flex: '1 1 260px' }} aria-label="Link de assinatura" />
            <button className="btn-secundario" onClick={() => copiar(novo)}>Copiar</button>
            {whats && <a className="btn-secundario" href={whats} target="_blank" rel="noopener noreferrer">Enviar no WhatsApp</a>}
          </div>
        </div>
      )}
      {!novo && contrato.estado === 'emitido' && (
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          {vigente ? `Link ativo até ${formatarData(vigente.expira_em)} · ${vigente.visualizacoes ? `aberto ${vigente.visualizacoes}× (último em ${formatarDataHora(vigente.ultima_visualizacao)})` : 'ainda não aberto'}.` : 'Nenhum link ativo. Gere um link para o cliente assinar pelo celular.'}
        </p>
      )}
      {(dados?.aceites.length ?? 0) > 0 && (
        <ul className="lista-adm" style={{ marginTop: 10 }}>
          {dados!.aceites.map((a) => (
            <li key={a.id}>
              <b>{a.nome}</b> · doc. {a.documento} · {formatarDataHora(a.em)}{a.email ? ` · ${a.email}` : ''}
              <div className="muted small">{a.declaracao}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function linhasDe(t: string): string[] {
  return t.split('\n').map((x) => x.trim()).filter(Boolean);
}

/** Lista de frases, uma por linha (apagar a linha tira o item). */
function ListaContrato({ rotulo, valor, aoMudar, ajuda }: { rotulo: string; valor: string[]; aoMudar: (v: string[]) => void; ajuda?: string }) {
  const [texto, setTexto] = useState(valor.join('\n'));
  useEffect(() => { if (linhasDe(texto).join('\n') !== valor.join('\n')) setTexto(valor.join('\n')); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <label className="campo">
      <span>{rotulo} <span className="muted small">(um por linha; apague a linha para tirar)</span>{ajuda && <Ajuda>{ajuda}</Ajuda>}</span>
      <textarea rows={Math.max(3, valor.length + 1)} value={texto} onChange={(e) => { setTexto(e.target.value); aoMudar(linhasDe(e.target.value)); }} />
    </label>
  );
}

const centavosDe = (v: number | null | undefined): Centavos => doBanco(v ?? 0);
const reaisDe = (c: Centavos | null): number => Number(paraBanco(c ?? 0));

/**
 * Editor completo do contrato: começa com a sugestão (proposta aceita + cliente + cláusulas
 * do modelo) e tudo pode ser editado, incluído ou tirado antes de emitir.
 */
function GerarContrato({ obra, contrato, aoFechar, aoSalvar }: { obra: Obra; contrato: Contrato | null; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const apoio = useConsulta(async () => {
    const [emp, cli, cl, fin, ver] = await Promise.all([
      supabase.from('empresa').select('*').limit(1).maybeSingle(),
      obra.cliente_id ? supabase.from('pessoa').select('*').eq('id', obra.cliente_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      supabase.from('clausula').select('*').eq('ativo', true).order('ordem'),
      supabase.from('obra_financeiro').select('modelo_contratacao, valor_contratado').eq('obra_id', obra.id).maybeSingle(),
      obra.proposta_versao_id ? supabase.from('proposta_versao').select('*, proposta:proposta!proposta_versao_proposta_id_fkey(codigo)').eq('id', obra.proposta_versao_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    return {
      empresa: ok(emp) as Empresa | null, cliente: ok(cli) as Pessoa | null, clausulas: ok(cl) as Clausula[],
      fin: ok(fin) as { modelo_contratacao: string | null; valor_contratado: string } | null,
      versao: ok(ver) as { id: string; numero: number; hash: string | null; conteudo: Partial<Conteudo>; valor_total: string; proposta: { codigo: string } } | null,
    };
  }, [obra.id]);
  const [modelo, setModelo] = useState<ModeloContrato>(contrato?.modelo ?? 'preco_fechado');
  const [servicos, setServicos] = useState<Perfil[]>(contrato?.conteudo.servicos ?? []);
  const h0 = contrato?.conteudo.honorarios ?? {};
  const [hon, setHon] = useState<Honorarios>(h0);
  const [cents, setCents] = useState<Record<string, Centavos | null>>({
    valor_inicial: h0.valor_inicial != null ? doBanco(h0.valor_inicial) : null, mensalidade: h0.mensalidade != null ? doBanco(h0.mensalidade) : null,
    valor_visita_adicional: h0.valor_visita_adicional != null ? doBanco(h0.valor_visita_adicional) : null,
  });
  const [valorTotal, setValorTotal] = useState<Centavos | null>(contrato ? doBanco(contrato.valor_total) : null);
  const [k, setK] = useState<ConteudoContrato | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const d = apoio.dados;
  const honorarios: Honorarios = {
    ...hon,
    valor_inicial: cents.valor_inicial != null ? Number(paraBanco(cents.valor_inicial)) : null,
    mensalidade: cents.mensalidade != null ? Number(paraBanco(cents.mensalidade)) : null,
    valor_visita_adicional: cents.valor_visita_adicional != null ? Number(paraBanco(cents.valor_visita_adicional)) : null,
  };
  /** Sugestão do sistema com os dados de agora (o prazo e as partes que você editou entram nos marcadores). */
  function sugestao(m: ModeloContrato, base?: ConteudoContrato | null, sv?: Perfil[]): ConteudoContrato | null {
    if (!d) return null;
    const cli = d.cliente;
    const conteudoProposta = d.versao ? normalizar(d.versao.conteudo) : null;
    if (conteudoProposta && base) conteudoProposta.prazo_texto = base.prazo;
    return montarContrato({
      modelo: m,
      proposta: d.versao && conteudoProposta ? { codigo: d.versao.proposta.codigo, versao: d.versao.numero, hash: d.versao.hash, conteudo: conteudoProposta, valor_total: Number(paraBanco(valorTotal ?? 0)) } : null,
      obra: { nome: obra.nome, endereco: obra.endereco },
      contratante: base?.partes.contratante ?? { nome: cli?.nome ?? '[contratante]', documento: cli?.documento ?? null, endereco: cli?.endereco ?? null, email: cli?.email ?? null, telefone: cli?.telefone ?? null },
      contratada: base?.partes.contratada ?? parteEmpresa(d.empresa),
      honorarios, clausulas: d.clausulas, servicos: sv ?? servicos, tipoObra: obra.tipo_servico,
    });
  }
  const servicosIniciais = () => (d ? servicosDoContrato(d.versao ? normalizar(d.versao.conteudo) : null, obra.tipo_servico) : []);

  useEffect(() => {
    if (!d || k) return;
    let m = modelo;
    const sv = servicos.length ? servicos : servicosIniciais();
    if (!servicos.length) setServicos(sv);
    if (!contrato) {
      m = d.fin?.modelo_contratacao && MODELO_DE_OBRA[d.fin.modelo_contratacao] && !(d.fin.modelo_contratacao === 'preco_fechado' && !SERVICO_CONTRATO[sv[0]]?.obra)
        ? MODELO_DE_OBRA[d.fin.modelo_contratacao] : modeloSugerido(sv);
      setModelo(m);
    }
    if (valorTotal === null) setValorTotal(doBanco(d.versao?.valor_total ?? d.fin?.valor_contratado ?? 0));
    const novo = sugestao(m, null, sv);
    if (!novo) return;
    if (!contrato) { setK({ ...novo, edicao: 2 }); return; }
    // Rascunho salvo: mantém tudo o que está nele. Os de antes do editor completo marcam
    // como editadas as cláusulas com texto diferente da sugestão (para não perder ajustes).
    const salvo = contrato.conteudo;
    const porCodigo = new Map(novo.clausulas.map((x) => [x.codigo, x]));
    const clausulas = salvo.edicao === 2 ? salvo.clausulas : (salvo.clausulas ?? []).map((x) => ({ ...x, editada: porCodigo.get(x.codigo)?.texto !== x.texto || undefined }));
    setK({ ...novo, ...salvo, clausulas, removidas: salvo.removidas ?? [], data_inicio: salvo.data_inicio ?? novo.data_inicio, data_entrega: salvo.data_entrega ?? novo.data_entrega, edicao: 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  if (apoio.carregando || !d || !k) return <Modal titulo="Contrato" aoFechar={aoFechar}><Carregando /></Modal>;

  const sug = sugestao(modelo, k)!;
  const clausulas = mesclarClausulas(k.clausulas, sug.clausulas, k.removidas);
  const sugPorCodigo = new Map(sug.clausulas.map((x) => [x.codigo, x]));
  const tituloAuto = tituloContrato(servicos, modelo);
  const final: ConteudoContrato = { ...k, clausulas, honorarios, observacoes: hon.condicoes_adicionais ?? k.observacoes ?? '', servicos, titulo: k.titulo?.trim() ? k.titulo : tituloAuto };
  final.faltando = pendenciasContrato(final);
  const somaEscopo = totalEscopo(final);
  const mostra = (campo: 'gestao' | 'visitas' | 'adm') => campo === 'gestao' ? ['gestao', 'combinado'].includes(modelo) : campo === 'visitas' ? ['gestao', 'acompanhamento', 'combinado'].includes(modelo) : ['administracao', 'combinado'].includes(modelo);
  const mudar = (f: (x: ConteudoContrato) => ConteudoContrato) => setK((x) => (x ? f(x) : x));
  /** Mexe nas cláusulas a partir da lista que está na tela. */
  const mudarClausulas = (f: (l: ClausulaContrato[]) => ClausulaContrato[], removidas?: string[]) => mudar((x) => ({ ...x, clausulas: f(clausulas), removidas: removidas ?? x.removidas }));
  const editarClausula = (codigo: string, m: Partial<ClausulaContrato>) => mudarClausulas((l) => l.map((x) => (x.codigo === codigo ? { ...x, ...m, editada: true, revisao_juridica: m.texto !== undefined && m.texto !== sugPorCodigo.get(codigo)?.texto ? aposEditar(sugPorCodigo.get(codigo)?.revisao_juridica ?? x.revisao_juridica) : x.revisao_juridica } : x)));
  /** Liga ou desliga um tipo de serviço: troca as cláusulas específicas e o título (as editadas ficam). */
  const alternarServico = (p: Perfil) => {
    const n = servicos.includes(p) ? servicos.filter((x) => x !== p) : [...servicos, p];
    if (!n.length) return;
    setServicos(n);
    mudar((x) => ({ ...x, titulo: undefined }));
  };
  const moverClausula = (i: number, passo: -1 | 1) => mudarClausulas((l) => { const n = [...l]; const j = i + passo; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const tirarClausula = (x: ClausulaContrato) => mudarClausulas((l) => l.filter((y) => y.codigo !== x.codigo), sugPorCodigo.has(x.codigo) ? [...(k.removidas ?? []), x.codigo] : k.removidas);
  const daBiblioteca = d.clausulas.filter((x) => !clausulas.some((y) => y.codigo === x.codigo));
  const mudarItem = (ai: number, ii: number, m: Partial<ConteudoContrato['escopo'][number]['itens'][number]>) => mudar((x) => ({ ...x, escopo: x.escopo.map((a, j) => (j !== ai ? a : { ...a, itens: a.itens.map((it, y) => (y === ii ? { ...it, ...m } : it)) })) }));
  const mudarParcela = (j: number, m: Partial<ConteudoContrato['pagamento'][number]>) => mudar((x) => ({ ...x, pagamento: x.pagamento.map((p, i) => (i === j ? { ...p, ...m } : p)) }));
  const somaParcelas = final.pagamento.reduce((t, p) => t + doBanco(p.valor || 0), 0);
  const parte = (qual: 'contratante' | 'contratada', campo: keyof Parte, v: string) => mudar((x) => ({ ...x, partes: { ...x.partes, [qual]: { ...x.partes[qual], [campo]: v || null } } }));

  function refazer() {
    if (!window.confirm('Refazer o contrato a partir da proposta aceita e do cadastro? Tudo o que você editou aqui volta à sugestão do sistema.')) return;
    const sv = servicosIniciais();
    setServicos(sv);
    const novo = sugestao(modelo, null, sv);
    if (novo) setK({ ...novo, removidas: [], edicao: 2 });
    setValorTotal(doBanco(d!.versao?.valor_total ?? d!.fin?.valor_contratado ?? 0));
    toast('Contrato refeito com a sugestão do sistema.');
  }

  async function salvar() {
    setErro(null);
    if (final.clausulas.some((x) => !x.titulo.trim())) return setErro('Há uma cláusula sem título.');
    const conteudo: ConteudoContrato = { ...final, clausulas: final.clausulas.filter((x) => x.texto.trim()) };
    const reg = { obra_id: obra.id, proposta_versao_id: obra.proposta_versao_id, modelo, valor_total: paraBanco(valorTotal ?? 0), conteudo };
    const r = contrato ? await supabase.from('contrato').update(reg).eq('id', contrato.id) : await supabase.from('contrato').insert(reg);
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Contrato salvo como rascunho. Revise e emita quando estiver pronto.');
    aoSalvar();
  }

  const secao = (id: string, titulo: string, resumo: string, corpo: React.ReactNode) => (
    <details className="detalhes-form secao-contrato" open={aberta === id} onToggle={(e) => { const el = e.currentTarget; if (el.open) setAberta(id); else if (aberta === id) setAberta(null); }}>
      <summary><b>{titulo}</b> <span className="muted small">· {resumo}</span></summary>
      <div className="stack" style={{ marginTop: 10 }}>{corpo}</div>
    </details>
  );

  return (
    <Modal titulo={contrato ? `Revisar ${contrato.codigo}` : 'Gerar contrato'} aoFechar={aoFechar} largo
      rodape={<><button className="btn-link" onClick={refazer}>Refazer pela proposta</button><span className="spacer" /><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar}>Salvar rascunho</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>O sistema monta o contrato com a proposta aceita, o cadastro e as cláusulas próprias de cada tipo de serviço, com a lei e a norma citadas (Código Civil, Código de Defesa do Consumidor, ART e ABNT). As cláusulas que limitam direitos saem em destaque, como pede o CDC. Tudo aqui pode ser editado, incluído ou tirado antes de emitir. Depois de emitido, o contrato fica congelado; mudanças viram aditivo.</p>
        <fieldset className="campo"><legend>Tipo de serviço <Ajuda>Cada tipo traz as cláusulas dele: autoria e revisões no projeto, plano de reforma (NBR 16280) na reforma, garantia de 5 anos (Código Civil, art. 618) na execução, alcance do laudo, órgãos públicos na regularização. Pode marcar mais de um.</Ajuda></legend>
          <div className="row" style={{ gap: 6 }}>{SERVICOS_CONTRATO.map((p) => (
            <button key={p} type="button" className={`chip-link${servicos.includes(p) ? ' ativo' : ''}`} aria-pressed={servicos.includes(p)} onClick={() => alternarServico(p)}>{SERVICO_CONTRATO[p].rotulo}</button>
          ))}</div>
        </fieldset>
        <label className="campo">Título do contrato<input value={final.titulo} onChange={(e) => mudar((x) => ({ ...x, titulo: e.target.value }))} /></label>
        {!d.versao && <div className="aviso info"><span>Esta obra não tem proposta aprovada ligada. Monte o escopo abaixo ou descreva nas condições.</span></div>}
        <label className="campo">Modelo de contratação
          <select value={modelo} onChange={(e) => { setModelo(e.target.value as ModeloContrato); mudar((x) => ({ ...x, titulo: undefined })); }}>{Object.entries(MODELO_CONTRATO).map(([key, v]) => <option key={key} value={key}>{v.rotulo}</option>)}</select>
          <span className="dica">{MODELO_CONTRATO[modelo].ajuda} Trocar o modelo troca as cláusulas sugeridas; as que você editou ficam.</span>
        </label>
        <div className="grid grid-3">
          <label className="campo">Valor total do contrato<CampoValor valor={valorTotal} aoMudar={setValorTotal} /></label>
          {mostra('gestao') && <label className="campo">Honorário inicial<CampoValor valor={cents.valor_inicial} aoMudar={(v) => setCents((c) => ({ ...c, valor_inicial: v }))} /></label>}
          {mostra('gestao') && <label className="campo">Mensalidade<CampoValor valor={cents.mensalidade} aoMudar={(v) => setCents((c) => ({ ...c, mensalidade: v }))} /></label>}
          {mostra('gestao') && <label className="campo">Meses<input inputMode="numeric" value={hon.meses ?? ''} onChange={(e) => setHon((h) => ({ ...h, meses: e.target.value ? Number(e.target.value) : null }))} /></label>}
          {mostra('visitas') && <label className="campo">Visitas incluídas<input inputMode="numeric" value={hon.visitas_incluidas ?? ''} onChange={(e) => setHon((h) => ({ ...h, visitas_incluidas: e.target.value ? Number(e.target.value) : null }))} /></label>}
          {mostra('visitas') && <label className="campo">Visita adicional<CampoValor valor={cents.valor_visita_adicional} aoMudar={(v) => setCents((c) => ({ ...c, valor_visita_adicional: v }))} /></label>}
        </div>
        {somaEscopo > 0 && valorTotal !== null && somaEscopo !== valorTotal && (
          <div className="aviso"><Icone nome="alerta" /><span>Os itens do escopo somam {formatar(somaEscopo)} e o valor do contrato é {formatar(valorTotal)}.</span><button className="btn-link" onClick={() => setValorTotal(somaEscopo)}>Usar a soma dos itens</button></div>
        )}
        {mostra('adm') && <label className="campo">Remuneração da administração <Ajuda>Escreva a regra combinada (percentual sobre custos comprovados, valor fixo, teto…). O sistema não aplica taxa padrão.</Ajuda><input value={hon.remuneracao_administracao ?? ''} onChange={(e) => setHon((h) => ({ ...h, remuneracao_administracao: e.target.value }))} placeholder="Ex.: 12% sobre os custos comprovados, pagos mensalmente" /></label>}

        {secao('prazo', 'Prazo e datas', [final.prazo || 'sem prazo', final.data_inicio && `início ${formatarData(final.data_inicio)}`, final.data_entrega && `entrega ${formatarData(final.data_entrega)}`].filter(Boolean).join(' · '), (
          <>
            <label className="campo">Prazo (como sai no contrato)<input value={k.prazo} onChange={(e) => mudar((x) => ({ ...x, prazo: e.target.value }))} placeholder="Ex.: 120 dias corridos a contar da liberação do local" /></label>
            <div className="grid grid-3">
              <label className="campo">Início previsto<input type="date" value={k.data_inicio ?? ''} onChange={(e) => mudar((x) => ({ ...x, data_inicio: e.target.value || null }))} /></label>
              <label className="campo">Entrega prevista<input type="date" value={k.data_entrega ?? ''} min={k.data_inicio ?? undefined} onChange={(e) => mudar((x) => ({ ...x, data_entrega: e.target.value || null }))} /></label>
              {k.data_inicio && k.data_entrega && <div className="campo"><span>Duração</span><b style={{ padding: '9px 0' }}>{Math.round((Date.parse(k.data_entrega) - Date.parse(k.data_inicio)) / 86_400_000) + 1} dias corridos</b></div>}
            </div>
          </>
        ))}

        {secao('partes', 'Partes e local', `${final.partes.contratante.nome} · ${final.local || 'local a definir'}`, (
          <>
            <div className="grid grid-2">
              <label className="campo">Contratante<input value={k.partes.contratante.nome} onChange={(e) => parte('contratante', 'nome', e.target.value)} /></label>
              <label className="campo">CPF/CNPJ do contratante<input value={k.partes.contratante.documento ?? ''} onChange={(e) => parte('contratante', 'documento', e.target.value)} /></label>
              <label className="campo">Endereço do contratante<input value={k.partes.contratante.endereco ?? ''} onChange={(e) => parte('contratante', 'endereco', e.target.value)} /></label>
              <label className="campo">E-mail do contratante<input value={k.partes.contratante.email ?? ''} onChange={(e) => parte('contratante', 'email', e.target.value)} /></label>
              <label className="campo">Contratada<input value={k.partes.contratada.nome} onChange={(e) => parte('contratada', 'nome', e.target.value)} /></label>
              <label className="campo">CNPJ da contratada<input value={k.partes.contratada.documento ?? ''} onChange={(e) => parte('contratada', 'documento', e.target.value)} /></label>
              <label className="campo">Endereço da contratada<input value={k.partes.contratada.endereco ?? ''} onChange={(e) => parte('contratada', 'endereco', e.target.value)} /></label>
              <label className="campo">Responsável técnico<input value={k.partes.contratada.extra ?? ''} onChange={(e) => parte('contratada', 'extra', e.target.value)} /></label>
            </div>
            <label className="campo">Local da obra<input value={k.local} onChange={(e) => mudar((x) => ({ ...x, local: e.target.value }))} /></label>
            <p className="muted small" style={{ margin: 0 }}>Mudar aqui vale só para este contrato. Para corrigir o cadastro, use Pessoas ou Configurações.</p>
          </>
        ))}

        {secao('escopo', 'Objeto e escopo', `${final.escopo.reduce((t, a) => t + a.itens.length, 0)} serviço(s) · ${formatar(somaEscopo)}`, (
          <>
            <label className="campo">Objeto<textarea rows={2} value={k.objeto} onChange={(e) => mudar((x) => ({ ...x, objeto: e.target.value }))} /></label>
            {k.escopo.map((a, ai) => (
              <div key={ai} className="bloco-ambiente">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="titulo-amb" value={a.ambiente} aria-label="Grupo" onChange={(e) => mudar((x) => ({ ...x, escopo: x.escopo.map((z, j) => (j === ai ? { ...z, ambiente: e.target.value } : z)) }))} />
                  <button className="btn-link" aria-label="Tirar grupo" title="Tirar este grupo e os serviços dele" onClick={() => window.confirm(`Tirar "${a.ambiente}" e os serviços dele?`) && mudar((x) => ({ ...x, escopo: x.escopo.filter((_, j) => j !== ai) }))}><Icone nome="fechar" /></button>
                </div>
                {a.itens.map((it, ii) => (
                  <div key={ii} className="item-escopo">
                    <input value={it.titulo} aria-label="Serviço" style={{ fontWeight: 600 }} onChange={(e) => mudarItem(ai, ii, { titulo: e.target.value })} />
                    <textarea rows={2} value={it.descricao ?? ''} aria-label="Descrição" placeholder="Descrição (opcional)" onChange={(e) => mudarItem(ai, ii, { descricao: e.target.value })} />
                    <div className="linha-valores">
                      <label className="campo">Qtd.<input inputMode="decimal" value={String(it.quantidade).replace('.', ',')} onChange={(e) => mudarItem(ai, ii, { quantidade: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 })} /></label>
                      <label className="campo">Unidade<input value={it.unidade} onChange={(e) => mudarItem(ai, ii, { unidade: e.target.value })} style={{ maxWidth: 90 }} /></label>
                      <label className="campo">Valor<CampoValor valor={centavosDe(it.total)} aoMudar={(v) => mudarItem(ai, ii, { total: reaisDe(v) })} /></label>
                      <button className="btn-link" aria-label="Tirar serviço" title="Tirar este serviço" onClick={() => mudar((x) => ({ ...x, escopo: x.escopo.map((z, j) => (j !== ai ? z : { ...z, itens: z.itens.filter((_, y) => y !== ii) })) }))}><Icone nome="fechar" /></button>
                    </div>
                  </div>
                ))}
                <button className="btn-secundario" onClick={() => mudar((x) => ({ ...x, escopo: x.escopo.map((z, j) => (j !== ai ? z : { ...z, itens: [...z.itens, { titulo: '', descricao: '', quantidade: 1, unidade: 'vb', total: 0 }] })) }))}><Icone nome="mais" /> Serviço</button>
              </div>
            ))}
            <div className="row"><button className="btn-secundario" onClick={() => mudar((x) => ({ ...x, escopo: [...x.escopo, { ambiente: x.escopo.length ? 'Novo grupo' : 'Escopo geral', itens: [{ titulo: '', descricao: '', quantidade: 1, unidade: 'vb', total: 0 }] }] }))}><Icone nome="mais" /> Grupo de serviços</button></div>
          </>
        ))}

        {secao('obrigacoes', 'Incluso, não incluso e responsabilidades', `${final.inclusoes.length} incluso(s) · ${final.exclusoes.length} não incluso(s) · ${final.responsabilidades.reduce((t, r) => t + r.itens.length, 0)} obrigação(ões)`, (
          <>
            <div className="grid grid-2">
              <ListaContrato rotulo="Incluso" valor={k.inclusoes} aoMudar={(v) => mudar((x) => ({ ...x, inclusoes: v }))} />
              <ListaContrato rotulo="Não incluso" valor={k.exclusoes} aoMudar={(v) => mudar((x) => ({ ...x, exclusoes: v }))} />
            </div>
            <div className="grid grid-3">
              {k.responsabilidades.map((r, j) => (
                <div key={j} className="stack" style={{ gap: 4 }}>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input value={r.parte} aria-label="Parte" style={{ fontWeight: 600 }} onChange={(e) => mudar((x) => ({ ...x, responsabilidades: x.responsabilidades.map((z, i) => (i === j ? { ...z, parte: e.target.value } : z)) }))} />
                    <button className="btn-link" aria-label="Tirar parte" title="Tirar esta parte" onClick={() => mudar((x) => ({ ...x, responsabilidades: x.responsabilidades.filter((_, i) => i !== j) }))}><Icone nome="fechar" /></button>
                  </div>
                  <ListaContrato rotulo="Obrigações" valor={r.itens} aoMudar={(v) => mudar((x) => ({ ...x, responsabilidades: x.responsabilidades.map((z, i) => (i === j ? { ...z, itens: v } : z)) }))} />
                </div>
              ))}
            </div>
            <div className="row"><button className="btn-secundario" onClick={() => mudar((x) => ({ ...x, responsabilidades: [...x.responsabilidades, { parte: x.responsabilidades.length === 0 ? 'ROSAE' : 'Nova parte', itens: [] }] }))}><Icone nome="mais" /> Parte com obrigações</button></div>
          </>
        ))}

        {secao('pagamento', 'Pagamento', final.pagamento.length ? `${final.pagamento.length} parcela(s) · ${formatar(somaParcelas)}` : 'sem parcelas', (
          <>
            {k.pagamento.map((p, j) => (
              <div key={j} className="linha-valores" style={{ alignItems: 'end' }}>
                <label className="campo" style={{ flex: 2 }}>Descrição<input value={p.descricao} onChange={(e) => mudarParcela(j, { descricao: e.target.value })} /></label>
                <label className="campo" style={{ flex: 2 }}>Quando<input value={p.quando ?? ''} onChange={(e) => mudarParcela(j, { quando: e.target.value })} placeholder="Na assinatura, ao concluir a etapa…" /></label>
                <label className="campo" style={{ maxWidth: 160 }}>Vencimento<input type="date" value={p.data ?? ''} onChange={(e) => mudarParcela(j, { data: e.target.value || null })} /></label>
                <label className="campo" style={{ flex: 1 }}>Valor<CampoValor valor={centavosDe(p.valor)} aoMudar={(v) => mudarParcela(j, { valor: reaisDe(v) })} /></label>
                <button className="btn-link" aria-label="Tirar parcela" title="Tirar esta parcela" onClick={() => mudar((x) => ({ ...x, pagamento: x.pagamento.filter((_, i) => i !== j) }))}><Icone nome="fechar" /></button>
              </div>
            ))}
            <div className="row">
              <button className="btn-secundario" onClick={() => mudar((x) => ({ ...x, pagamento: [...x.pagamento, { descricao: `Parcela ${x.pagamento.length + 1}`, valor: 0, quando: '' }] }))}><Icone nome="mais" /> Parcela</button>
              {k.pagamento.length > 0 && valorTotal !== null && <span className="small" style={{ color: somaParcelas === valorTotal ? 'var(--favoravel)' : 'var(--desfavoravel)' }}>Soma {formatar(somaParcelas)} de {formatar(valorTotal)}{somaParcelas === valorTotal ? ' · confere' : ''}</span>}
            </div>
          </>
        ))}

        {secao('clausulas', `Cláusulas (${clausulas.length})`, `${clausulas.filter((x) => x.editada).length} editada(s) por você${(k.removidas ?? []).length ? ` · ${(k.removidas ?? []).length} tirada(s)` : ''}`, (
          <>
            <p className="muted small" style={{ margin: 0 }}>As cláusulas vêm da sua biblioteca, conforme o tipo de serviço e o modelo, com valor, prazo, honorários e normas preenchidos. As que você não mexer acompanham a sugestão; as que você editar ficam como você escreveu. “Destaque” imprime a cláusula em negrito, como o CDC exige para as que limitam direitos.</p>
            {clausulas.map((x, i) => (
              <div key={x.codigo} className="clausula-ed">
                <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                  <span className="muted small" style={{ minWidth: 28 }}>{i + 1}ª</span>
                  <input value={x.titulo} aria-label="Título da cláusula" style={{ fontWeight: 600 }} onChange={(e) => editarClausula(x.codigo, { titulo: e.target.value })} />
                  <span className={`selo ${SELO_REVISAO[x.revisao_juridica]?.classe ?? 'alerta'}`} title={SELO_REVISAO[x.revisao_juridica]?.ajuda}>{SELO_REVISAO[x.revisao_juridica]?.rotulo ?? 'minuta'}</span>
                  <label className="check small" title="Imprime em negrito (CDC, art. 54, § 4º)"><input type="checkbox" checked={!!x.destaque} onChange={(e) => editarClausula(x.codigo, { destaque: e.target.checked || undefined })} /> destaque</label>
                  {x.editada && sugPorCodigo.has(x.codigo) && <button className="btn-link small" title="Volta ao texto sugerido pelo modelo" onClick={() => mudarClausulas((l) => l.map((y) => (y.codigo === x.codigo ? sugPorCodigo.get(x.codigo)! : y)))}>sugestão</button>}
                  <button className="btn-link" aria-label="Subir cláusula" title="Subir" disabled={i === 0} onClick={() => moverClausula(i, -1)}>↑</button>
                  <button className="btn-link" aria-label="Descer cláusula" title="Descer" disabled={i === clausulas.length - 1} onClick={() => moverClausula(i, 1)}>↓</button>
                  <button className="btn-link" aria-label="Tirar cláusula" title="Tirar esta cláusula" onClick={() => tirarClausula(x)}><Icone nome="fechar" /></button>
                </div>
                <textarea rows={3} value={x.texto} onChange={(e) => editarClausula(x.codigo, { texto: e.target.value })} />
              </div>
            ))}
            <div className="row">
              <button className="btn-secundario" onClick={() => mudarClausulas((l) => [...l, { codigo: `livre-${Date.now().toString(36)}`, titulo: 'Nova cláusula', texto: '', versao: 1, revisao_juridica: 'minuta', editada: true }])}><Icone nome="mais" /> Cláusula nova</button>
              {daBiblioteca.length > 0 && (
                <select value="" aria-label="Incluir cláusula da biblioteca" style={{ maxWidth: 300 }} onChange={(e) => {
                  const c = d.clausulas.find((y) => y.codigo === e.target.value);
                  if (!c) return;
                  const pronta = mesclarClausulas([], montarContrato({ ...{ modelo, proposta: null, obra: { nome: obra.nome, endereco: obra.endereco }, contratante: k.partes.contratante, contratada: k.partes.contratada, honorarios }, clausulas: [{ ...c, aplicavel: ['todos'] }], servicos }).clausulas)[0];
                  mudarClausulas((l) => [...l, { ...pronta, editada: true }], (k.removidas ?? []).filter((r) => r !== c.codigo));
                }}>
                  <option value="">+ Cláusula da biblioteca…</option>
                  {daBiblioteca.map((y) => <option key={y.codigo} value={y.codigo}>{y.titulo}</option>)}
                </select>
              )}
            </div>
            {(k.removidas ?? []).length > 0 && (
              <p className="small" style={{ margin: 0 }}><span className="muted">Tiradas por você: </span>{(k.removidas ?? []).map((r) => <span key={r} className="tirada">{d.clausulas.find((y) => y.codigo === r)?.titulo ?? r} <button className="btn-link small" onClick={() => mudar((x) => ({ ...x, removidas: (x.removidas ?? []).filter((y) => y !== r) }))}>voltar</button></span>)}</p>
            )}
          </>
        ))}

        <label className="campo">Condições adicionais<textarea rows={2} value={hon.condicoes_adicionais ?? k.observacoes ?? ''} onChange={(e) => setHon((h) => ({ ...h, condicoes_adicionais: e.target.value }))} /></label>
        {textoHonorarios(honorarios) && <p className="muted small" style={{ margin: 0 }}>Honorários no texto: {textoHonorarios(honorarios)}.</p>}
        {final.faltando.length > 0 && <div className="aviso"><Icone nome="alerta" /><span>Sairá “[a definir]” em: {final.faltando.map(ROTULO_FALTANDO).join(', ')}.</span></div>}
        <details className="detalhes-form"><summary>Ver como vai ficar</summary>
          <div className="contrato-previa" style={{ marginTop: 10 }}><ContratoDocumento c={{ codigo: contrato?.codigo ?? 'CTR (novo)', estado: 'rascunho', minuta: true, hash: null, emitido_em: null, valor_total: paraBanco(valorTotal ?? 0), modelo, conteudo: final }} /></div>
        </details>
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

function AssinarContrato({ contrato, aoFechar, aoSalvar }: { contrato: Contrato; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [data, setData] = useState(hoje());
  const [como, setComo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const r = await supabase.rpc('registrar_assinatura_contrato', { p_id: contrato.id, p_data: data, p_registro: como.trim() });
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Assinatura registrada. A obra passa a contratada.');
    aoSalvar();
  }
  return (
    <Modal titulo={`Assinatura de ${contrato.codigo}`} aoFechar={aoFechar}
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-ass">Registrar</button></>}>
      <form id="form-ass" className="stack" onSubmit={salvar}>
        <p className="muted small" style={{ margin: 0 }}>Assine fora do sistema (via física ou assinatura digital, como gov.br) e registre aqui. Anexe o PDF assinado nos documentos da obra.</p>
        <div className="grid grid-2">
          <label className="campo">Data da assinatura<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
          <label className="campo">Como foi assinado<input value={como} onChange={(e) => setComo(e.target.value)} required placeholder="Ex.: assinatura digital gov.br" /></label>
        </div>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Documento (A4) e impressão
// ---------------------------------------------------------------------
function ParteBloco({ titulo, p }: { titulo: string; p: Parte }) {
  return (
    <p><b>{titulo}:</b> {p.nome}{p.documento ? `, inscrito(a) sob ${p.documento}` : ', [CPF/CNPJ a definir]'}{p.endereco ? `, com endereço em ${p.endereco}` : ', [endereço a definir]'}{p.email ? `, e-mail ${p.email}` : ''}.{p.extra ? ` ${p.extra}.` : ''}</p>
  );
}

export function ContratoDocumento({ c }: { c: Pick<Contrato, 'codigo' | 'estado' | 'minuta' | 'hash' | 'emitido_em' | 'valor_total' | 'modelo' | 'conteudo'> }) {
  const k = c.conteudo;
  const minuta = c.estado === 'rascunho' || c.minuta;
  let n = 0;
  return (
    <article className="doc-a4 doc-contrato">
      {minuta && <div className="marca-minuta" aria-hidden="true">{c.estado === 'rascunho' ? 'RASCUNHO' : 'MINUTA'}</div>}
      <header className="doc-cab">
        <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        <div className="right small"><b>{c.codigo}</b><br />{MODELO_CONTRATO[c.modelo].rotulo}</div>
      </header>
      <h1>{k.titulo || 'Contrato de prestação de serviços de engenharia'}</h1>
      {minuta && <p className="doc-aviso">{c.estado === 'rascunho' ? 'Rascunho: confira os dados antes de emitir.' : 'Documento em minuta: há cláusulas sem base legal conferida. Não substitui orientação de advogado.'}</p>}
      <ParteBloco titulo="CONTRATADA" p={k.partes.contratada} />
      <ParteBloco titulo="CONTRATANTE" p={k.partes.contratante} />
      <p>As partes acima qualificadas celebram este contrato, que se rege pelas cláusulas a seguir e pela legislação nelas indicada.</p>
      <p><b>Local da obra:</b> {k.local || '[a definir]'}. {k.proposta && <><b>Proposta de referência:</b> {k.proposta.codigo}, versão {k.proposta.versao}.</>}</p>
      <h2>Escopo</h2>
      {k.objeto && <p>{k.objeto}</p>}
      {k.escopo.length > 0 && (
        <table className="doc-tabela">
          <thead><tr><th>Ambiente / serviço</th><th className="right">Qtd.</th><th className="right">Valor</th></tr></thead>
          <tbody>{k.escopo.map((a) => (
            <Fragment key={a.ambiente}>
              <tr className="grupo"><td colSpan={3}>{a.ambiente}</td></tr>
              {a.itens.map((i, j) => <tr key={j}><td>{i.titulo}{i.descricao ? <div className="small">{i.descricao}</div> : null}</td><td className="right">{i.quantidade.toLocaleString('pt-BR')} {i.unidade}</td><td className="right">{formatar(doBanco(i.total))}</td></tr>)}
            </Fragment>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="right">{formatar(doBanco(c.valor_total))}</td></tr></tfoot>
        </table>
      )}
      {k.inclusoes.length > 0 && <><h3>Incluso</h3><ul>{k.inclusoes.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {k.exclusoes.length > 0 && <><h3>Não incluso</h3><ul>{k.exclusoes.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {k.responsabilidades.length > 0 && <><h3>Responsabilidades</h3>{k.responsabilidades.map((r) => <div key={r.parte}><b>{r.parte}</b><ul>{r.itens.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}</>}
      {(k.prazo || k.data_inicio || k.data_entrega) && (
        <><h3>Prazo</h3><p>{k.prazo}{k.data_inicio ? `${k.prazo ? ' ' : ''}Início previsto em ${formatarData(k.data_inicio)}.` : ''}{k.data_entrega ? ` Entrega prevista em ${formatarData(k.data_entrega)}.` : ''}</p></>
      )}
      {k.pagamento.length > 0 && <><h3>Condições de pagamento</h3><ul>{k.pagamento.map((p, i) => <li key={i}>{p.descricao}: {formatar(doBanco(p.valor))}{p.quando ? ` · ${p.quando}` : ''}{p.data ? ` · vencimento ${formatarData(p.data)}` : ''}</li>)}</ul></>}
      <h2>Cláusulas</h2>
      {k.clausulas.map((x) => <div key={x.codigo} className={`clausula${x.destaque ? ' destaque' : ''}`}><h3>Cláusula {++n}ª · {x.titulo}</h3><p>{x.texto}</p></div>)}
      {k.observacoes && <><h3>Condições adicionais</h3><p style={{ whiteSpace: 'pre-wrap' }}>{k.observacoes}</p></>}
      <div className="assinaturas">
        <div><span />{k.partes.contratada.nome}<small>CONTRATADA</small></div>
        <div><span />{k.partes.contratante.nome}<small>CONTRATANTE</small></div>
      </div>
      <div className="assinaturas testemunhas">
        <div><span />Nome e CPF<small>TESTEMUNHA 1</small></div>
        <div><span />Nome e CPF<small>TESTEMUNHA 2</small></div>
      </div>
      <footer className="doc-rodape small">{c.hash ? `Emitido em ${formatarDataHora(c.emitido_em)} · código de verificação ${c.hash.slice(0, 16).toUpperCase()}` : 'Rascunho não emitido'}</footer>
    </article>
  );
}

export function ContratoImprimir() {
  const { id } = useParams();
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.from('contrato').select('*').eq('id', id!).single()) as Contrato, [id]);
  useEffect(() => { if (dados) { document.title = `${dados.codigo} · ROSAE`; setTimeout(() => window.print(), 600); } }, [dados]);
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro ?? 'Não encontrado.'} />;
  return (
    <div className="pagina-impressao a4">
      <div className="nao-imprimir aviso info" style={{ margin: 16 }}><span>Na janela de impressão, escolha “Salvar como PDF”, papel A4.</span></div>
      <ContratoDocumento c={dados} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Biblioteca de cláusulas
// ---------------------------------------------------------------------
const APLICAVEL: Record<string, string> = { todos: 'Todos', ...Object.fromEntries(Object.entries(MODELO_CONTRATO).map(([k, v]) => [k, v.rotulo])) };
const APLICAVEL_SERVICO: Record<string, string> = Object.fromEntries(SERVICOS_CONTRATO.map((p) => [`s:${p}`, SERVICO_CONTRATO[p].rotulo]));
const rotuloAplicavel = (a: string[]) => {
  const m = a.filter((x) => !x.startsWith('s:')).map((x) => APLICAVEL[x] ?? x);
  const s = a.filter((x) => x.startsWith('s:')).map((x) => APLICAVEL_SERVICO[x] ?? x);
  return `${m.length ? m.join(', ') : 'Todos os modelos'} · ${s.length ? s.join(', ') : 'todos os serviços'}`;
};

export function Clausulas() {
  const [editar, setEditar] = useState<Clausula | 'nova' | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => ok(await supabase.from('clausula').select('*').order('ordem')) as (Clausula & { id: string; revisado_por: string | null; revisado_em: string | null; referencias: string | null })[], []);
  return (
    <>
      <Topo titulo="Cláusulas de contrato" sub="Cláusulas por tipo de serviço, com versão e base legal.">
        <button className="btn-primario" onClick={() => setEditar('nova')}><Icone nome="mais" /> Cláusula</button>
      </Topo>
      <div className="aviso info" style={{ marginBottom: 14 }}><span>As cláusulas citam a base legal (Código Civil, Código de Defesa do Consumidor, Leis 5.194/66 e 6.496/77, LGPD e normas ABNT) e cada tipo de serviço tem as suas. Elas seguem o CDC: multa de atraso de 2%, arrependimento em 7 dias, foro do cliente, multa também para a ROSAE e destaque nas cláusulas que limitam direitos. Se quiser, peça a um advogado para revisar e registre aqui quem revisou e quando. Mudar o texto cria nova versão; contratos já emitidos guardam o texto da época.</span></div>
      <Erro mensagem={erro} />
      {carregando && !dados ? <Carregando /> : (
        <div className="stack">
          {(dados ?? []).map((c) => (
            <button key={c.id} className="card item-clausula" onClick={() => setEditar(c)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{c.titulo}</b>
                <span className={`selo ${SELO_REVISAO[c.revisao_juridica]?.classe ?? 'alerta'}`}>{c.revisao_juridica === 'revisada' ? `Revisada por ${c.revisado_por} em ${formatarData(c.revisado_em)}` : c.revisao_juridica === 'fundamentada' ? 'Com base legal' : 'Minuta'} · v{c.versao}</span>
              </div>
              <p className="muted small" style={{ margin: '6px 0 0' }}>{rotuloAplicavel(c.aplicavel)}{c.destaque ? ' · em destaque' : ''}{c.ativo === false ? ' · inativa' : ''}</p>
              {c.referencias && <p className="muted small" style={{ margin: '4px 0 0' }}>Base: {c.referencias}</p>}
              <p className="small" style={{ margin: '6px 0 0' }}>{c.texto.slice(0, 220)}{c.texto.length > 220 ? '…' : ''}</p>
            </button>
          ))}
        </div>
      )}
      {editar && <ClausulaForm c={editar === 'nova' ? null : editar} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); recarregar(); }} />}
    </>
  );
}

function ClausulaForm({ c, aoFechar, aoSalvar }: { c: (Clausula & { id?: string; revisado_por?: string | null; revisado_em?: string | null; referencias?: string | null }) | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState({
    codigo: c?.codigo ?? '', titulo: c?.titulo ?? '', texto: c?.texto ?? '', aplicavel: c?.aplicavel ?? ['todos'], ordem: c?.ordem ?? 50, ativo: c?.ativo ?? true, destaque: c?.destaque ?? false,
    revisada: c?.revisao_juridica === 'revisada', revisado_por: c?.revisado_por ?? '', revisado_em: c?.revisado_em ?? '', referencias: c?.referencias ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const reg = {
      codigo: f.codigo.trim() || f.titulo.trim().toLowerCase().normalize('NFD').replace(/[^\w]+/g, '_').slice(0, 40), titulo: f.titulo.trim(), texto: f.texto.trim(),
      aplicavel: f.aplicavel.length ? f.aplicavel : ['todos'], ordem: Number(f.ordem) || 0, ativo: f.ativo,
      destaque: f.destaque,
      revisao_juridica: f.revisada ? 'revisada' : c?.revisao_juridica === 'revisada' || c?.revisao_juridica === 'fundamentada' ? 'fundamentada' : 'minuta', revisado_por: f.revisado_por.trim() || null, revisado_em: f.revisado_em || null, referencias: f.referencias.trim() || null,
    };
    const r = c?.id ? await supabase.from('clausula').update(reg).eq('id', c.id) : await supabase.from('clausula').insert(reg);
    if (r.error) return setErro(mensagemErro(r.error));
    aoSalvar();
  }
  return (
    <Modal titulo={c ? c.titulo : 'Nova cláusula'} aoFechar={aoFechar} largo
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-cl">Salvar</button></>}>
      <form id="form-cl" className="stack" onSubmit={salvar}>
        <label className="campo">Título<input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} required /></label>
        <label className="campo">Texto <Ajuda>Marcadores preenchidos automaticamente: {'{proposta} {valor_total} {honorarios} {visitas_incluidas} {visita_adicional} {remuneracao_administracao} {prazo} {servicos} {normas}'}.</Ajuda>
          <textarea rows={7} value={f.texto} onChange={(e) => set('texto', e.target.value)} required /></label>
        <fieldset className="campo"><legend>Entra nos modelos</legend>
          <div className="lista-check">{Object.entries(APLICAVEL).map(([k, v]) => (
            <label key={k} className="check"><input type="checkbox" checked={f.aplicavel.includes(k)} onChange={(e) => set('aplicavel', e.target.checked ? [...f.aplicavel, k] : f.aplicavel.filter((x) => x !== k))} /> {v}</label>
          ))}</div>
        </fieldset>
        <fieldset className="campo"><legend>Tipos de serviço <Ajuda>Sem nenhum marcado, a cláusula entra em todos os serviços.</Ajuda></legend>
          <div className="lista-check">{Object.entries(APLICAVEL_SERVICO).map(([k, v]) => (
            <label key={k} className="check"><input type="checkbox" checked={f.aplicavel.includes(k)} onChange={(e) => set('aplicavel', e.target.checked ? [...f.aplicavel, k] : f.aplicavel.filter((x) => x !== k))} /> {v}</label>
          ))}</div>
        </fieldset>
        <label className="check"><input type="checkbox" checked={f.destaque} onChange={(e) => set('destaque', e.target.checked)} /> Imprimir em destaque (cláusula que limita direito do cliente; CDC, art. 54, § 4º)</label>
        <div className="grid grid-3">
          <label className="check"><input type="checkbox" checked={f.revisada} onChange={(e) => set('revisada', e.target.checked)} /> Revisada juridicamente</label>
          {f.revisada && <label className="campo">Revisada por<input value={f.revisado_por} onChange={(e) => set('revisado_por', e.target.value)} required /></label>}
          {f.revisada && <label className="campo">Em<input type="date" value={f.revisado_em} onChange={(e) => set('revisado_em', e.target.value)} required /></label>}
        </div>
        <label className="campo">Referências (fontes oficiais consultadas)<input value={f.referencias} onChange={(e) => set('referencias', e.target.value)} /></label>
        <div className="grid grid-2">
          <label className="campo">Ordem<input inputMode="numeric" value={f.ordem} onChange={(e) => set('ordem', Number(e.target.value) || 0)} /></label>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Ativa</label>
        </div>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}
