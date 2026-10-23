// Contrato da obra (gerado da proposta aprovada, congelado ao emitir), aditivos e
// biblioteca de cláusulas. Modelos sem revisão jurídica saem marcados como MINUTA.
import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarData, formatarDataHora, hoje } from '../core/datas';
import { normalizar, type Conteudo } from '../core/proposta';
import {
  MODELO_CONTRATO, montarContrato, ROTULO_FALTANDO, textoHonorarios,
  type Clausula, type ConteudoContrato, type Honorarios, type ModeloContrato, type Parte,
} from '../core/contrato';
import { ESTADO_PROPOSTA, type Contrato, type Empresa, type EstadoProposta, type Obra, type Pessoa } from '../lib/tipos';

const ESTADO_CONTRATO: Record<Contrato['estado'], { rotulo: string; classe: string }> = {
  rascunho: { rotulo: 'Rascunho', classe: 'neutro' }, emitido: { rotulo: 'Emitido · aguardando assinatura', classe: 'alerta' },
  assinado: { rotulo: 'Assinado', classe: 'ok' }, cancelado: { rotulo: 'Cancelado', classe: 'neutro' },
};
const MODELO_DE_OBRA: Record<string, ModeloContrato> = { preco_fechado: 'preco_fechado', administracao: 'administracao', projeto: 'projeto' };

type AditivoLista = { id: string; codigo: string; titulo: string; estado: EstadoProposta; versao_aprovada_id: string | null; aprovada_em: string | null; versoes: { id: string; numero: number; valor_total: string; emitida: boolean }[] };

function parteEmpresa(e: Empresa | null): Parte {
  return {
    nome: e?.razao_social || e?.nome_fantasia || 'ROSAE Engenharia & Estruturas', documento: e?.cnpj ?? null, endereco: e?.endereco ?? null,
    email: e?.email ?? null, telefone: e?.telefone ?? null,
    extra: `Responsável técnico: ${e?.responsavel_tecnico ?? 'Eng. Rhuann Rosa'}${e?.registro_conferido && e.registro_profissional ? ` · ${e.registro_profissional}` : ''}`,
  };
}

export function ContratoObra({ obra, aoMudar }: { obra: Obra & { cliente: { nome: string } | null }; aoMudar: () => void }) {
  const toast = useToast();
  const navegar = useNavigate();
  const [gerar, setGerar] = useState<Contrato | 'novo' | null>(null);
  const [assinar, setAssinar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { dados, erro: erroCarga, carregando, recarregar } = useConsulta(async () => {
    const [c, a, s] = await Promise.all([
      supabase.from('contrato').select('*').eq('obra_id', obra.id).order('criado_em', { ascending: false }),
      supabase.from('proposta').select('id, codigo, titulo, estado, versao_aprovada_id, aprovada_em, versoes:proposta_versao!proposta_versao_proposta_id_fkey(id, numero, valor_total, emitida)').eq('obra_id', obra.id).eq('tipo', 'aditivo').order('criado_em'),
      supabase.from('servico').select('origem_versao_id').eq('obra_id', obra.id).not('origem_versao_id', 'is', null),
    ]);
    return { contratos: ok(c) as Contrato[], aditivos: ok(a) as AditivoLista[], incorporados: new Set((ok(s) as { origem_versao_id: string }[]).map((x) => x.origem_versao_id)) };
  }, [obra.id]);

  if (carregando && !dados) return <Carregando />;
  const atual = dados?.contratos.find((c) => c.estado !== 'cancelado') ?? null;
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
  async function novoAditivo() {
    if (!obra.cliente_id) return setErro('Defina o cliente da obra antes de criar um aditivo.');
    const titulo = window.prompt('Título do aditivo (ex.: Troca de tomadas da cozinha):');
    if (!titulo?.trim()) return;
    const r = await supabase.from('proposta').insert({ tipo: 'aditivo', obra_id: obra.id, pessoa_id: obra.cliente_id, titulo: titulo.trim() }).select('id').single();
    if (r.error) return setErro(mensagemErro(r.error));
    const id = (r.data as { id: string }).id;
    const v = await supabase.rpc('nova_versao_proposta', { p_proposta: id });
    if (v.error) return setErro(mensagemErro(v.error));
    navegar(`/propostas/${id}`);
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
          <Vazio titulo="Nenhum contrato ativo"><p>O contrato é montado a partir da proposta aprovada, dos dados do cliente e da ROSAE e das cláusulas do modelo escolhido. Você revisa antes de emitir.</p></Vazio>
        ) : (
          <div className="stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><b>{atual.codigo}</b> · {MODELO_CONTRATO[atual.modelo].rotulo} · <span className={`selo ${ESTADO_CONTRATO[atual.estado].classe}`}>{ESTADO_CONTRATO[atual.estado].rotulo}</span>
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
      {assinar && atual && <AssinarContrato contrato={atual} aoFechar={() => setAssinar(false)} aoSalvar={() => { setAssinar(false); recarregar(); aoMudar(); }} />}
    </div>
  );
}

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
  const h0 = contrato?.conteudo.honorarios ?? {};
  const [hon, setHon] = useState<Honorarios>(h0);
  const [cents, setCents] = useState<Record<string, Centavos | null>>({
    valor_inicial: h0.valor_inicial != null ? doBanco(h0.valor_inicial) : null, mensalidade: h0.mensalidade != null ? doBanco(h0.mensalidade) : null,
    valor_visita_adicional: h0.valor_visita_adicional != null ? doBanco(h0.valor_visita_adicional) : null,
  });
  const [valorTotal, setValorTotal] = useState<Centavos | null>(contrato ? doBanco(contrato.valor_total) : null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!apoio.dados) return;
    if (!contrato && apoio.dados.fin?.modelo_contratacao && MODELO_DE_OBRA[apoio.dados.fin.modelo_contratacao]) setModelo(MODELO_DE_OBRA[apoio.dados.fin.modelo_contratacao]);
    if (valorTotal === null) setValorTotal(doBanco(apoio.dados.versao?.valor_total ?? apoio.dados.fin?.valor_contratado ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apoio.dados]);
  if (apoio.carregando || !apoio.dados) return <Modal titulo="Contrato" aoFechar={aoFechar}><Carregando /></Modal>;
  const d = apoio.dados;
  const honorarios: Honorarios = {
    ...hon,
    valor_inicial: cents.valor_inicial != null ? Number(paraBanco(cents.valor_inicial)) : null,
    mensalidade: cents.mensalidade != null ? Number(paraBanco(cents.mensalidade)) : null,
    valor_visita_adicional: cents.valor_visita_adicional != null ? Number(paraBanco(cents.valor_visita_adicional)) : null,
  };
  const cli = d.cliente;
  const conteudo: ConteudoContrato = montarContrato({
    modelo,
    proposta: d.versao ? { codigo: d.versao.proposta.codigo, versao: d.versao.numero, hash: d.versao.hash, conteudo: normalizar(d.versao.conteudo), valor_total: Number(paraBanco(valorTotal ?? 0)) } : null,
    obra: { nome: obra.nome, endereco: obra.endereco },
    contratante: { nome: cli?.nome ?? '[contratante]', documento: cli?.documento ?? null, endereco: cli?.endereco ?? null, email: cli?.email ?? null, telefone: cli?.telefone ?? null },
    contratada: parteEmpresa(d.empresa),
    honorarios, clausulas: d.clausulas,
  });
  // Texto ajustado à mão neste contrato: fica como minuta.
  conteudo.clausulas = conteudo.clausulas.map((k) => (textos[k.codigo] !== undefined && textos[k.codigo] !== k.texto ? { ...k, texto: textos[k.codigo], revisao_juridica: 'minuta' } : k));
  const mostra = (campo: 'gestao' | 'visitas' | 'adm') => campo === 'gestao' ? ['gestao', 'combinado'].includes(modelo) : campo === 'visitas' ? ['gestao', 'acompanhamento', 'combinado'].includes(modelo) : ['administracao', 'combinado'].includes(modelo);

  async function salvar() {
    setErro(null);
    const reg = { obra_id: obra.id, proposta_versao_id: obra.proposta_versao_id, modelo, valor_total: paraBanco(valorTotal ?? 0), conteudo };
    const r = contrato ? await supabase.from('contrato').update(reg).eq('id', contrato.id) : await supabase.from('contrato').insert(reg);
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Contrato salvo como rascunho. Revise e emita quando estiver pronto.');
    aoSalvar();
  }

  return (
    <Modal titulo={contrato ? `Revisar ${contrato.codigo}` : 'Gerar contrato'} aoFechar={aoFechar} largo
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar}>Salvar rascunho</button></>}>
      <div className="stack">
        {!d.versao && <div className="aviso info"><span>Esta obra não tem proposta aprovada ligada. O contrato sai sem escopo detalhado; descreva-o nas condições.</span></div>}
        <label className="campo">Modelo de contratação
          <select value={modelo} onChange={(e) => setModelo(e.target.value as ModeloContrato)}>{Object.entries(MODELO_CONTRATO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select>
          <span className="dica">{MODELO_CONTRATO[modelo].ajuda}</span>
        </label>
        <div className="grid grid-3">
          <label className="campo">Valor total do contrato<CampoValor valor={valorTotal} aoMudar={setValorTotal} /></label>
          {mostra('gestao') && <label className="campo">Honorário inicial<CampoValor valor={cents.valor_inicial} aoMudar={(v) => setCents((c) => ({ ...c, valor_inicial: v }))} /></label>}
          {mostra('gestao') && <label className="campo">Mensalidade<CampoValor valor={cents.mensalidade} aoMudar={(v) => setCents((c) => ({ ...c, mensalidade: v }))} /></label>}
          {mostra('gestao') && <label className="campo">Meses<input inputMode="numeric" value={hon.meses ?? ''} onChange={(e) => setHon((h) => ({ ...h, meses: e.target.value ? Number(e.target.value) : null }))} /></label>}
          {mostra('visitas') && <label className="campo">Visitas incluídas<input inputMode="numeric" value={hon.visitas_incluidas ?? ''} onChange={(e) => setHon((h) => ({ ...h, visitas_incluidas: e.target.value ? Number(e.target.value) : null }))} /></label>}
          {mostra('visitas') && <label className="campo">Visita adicional<CampoValor valor={cents.valor_visita_adicional} aoMudar={(v) => setCents((c) => ({ ...c, valor_visita_adicional: v }))} /></label>}
        </div>
        {mostra('adm') && <label className="campo">Remuneração da administração <Ajuda>Escreva a regra combinada (percentual sobre custos comprovados, valor fixo, teto…). O sistema não aplica taxa padrão.</Ajuda><input value={hon.remuneracao_administracao ?? ''} onChange={(e) => setHon((h) => ({ ...h, remuneracao_administracao: e.target.value }))} placeholder="Ex.: 12% sobre os custos comprovados, pagos mensalmente" /></label>}
        <label className="campo">Condições adicionais<textarea rows={2} value={hon.condicoes_adicionais ?? ''} onChange={(e) => setHon((h) => ({ ...h, condicoes_adicionais: e.target.value }))} /></label>
        {textoHonorarios(honorarios) && <p className="muted small" style={{ margin: 0 }}>Honorários no texto: {textoHonorarios(honorarios)}.</p>}
        {conteudo.faltando.length > 0 && <div className="aviso"><Icone nome="alerta" /><span>Sairá “[a definir]” em: {conteudo.faltando.map(ROTULO_FALTANDO).join(', ')}.</span></div>}
        <details className="detalhes-form"><summary>Cláusulas ({conteudo.clausulas.length}) · ajustar texto deste contrato</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {conteudo.clausulas.map((k) => (
              <label key={k.codigo} className="campo">{k.titulo} <span className={`selo ${k.revisao_juridica === 'revisada' ? 'ok' : 'alerta'}`}>{k.revisao_juridica === 'revisada' ? `revisada · v${k.versao}` : `minuta · v${k.versao}`}</span>
                <textarea rows={3} value={textos[k.codigo] ?? k.texto} onChange={(e) => setTextos((t) => ({ ...t, [k.codigo]: e.target.value }))} />
              </label>
            ))}
          </div>
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
    <article className="doc-a4">
      {minuta && <div className="marca-minuta" aria-hidden="true">{c.estado === 'rascunho' ? 'RASCUNHO' : 'MINUTA'}</div>}
      <header className="doc-cab">
        <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        <div className="right small"><b>{c.codigo}</b><br />{MODELO_CONTRATO[c.modelo].rotulo}</div>
      </header>
      <h1>Contrato de prestação de serviços de engenharia</h1>
      {minuta && <p className="doc-aviso">Documento em minuta: cláusulas ainda sem revisão jurídica. Não substitui orientação de advogado.</p>}
      <ParteBloco titulo="CONTRATADA" p={k.partes.contratada} />
      <ParteBloco titulo="CONTRATANTE" p={k.partes.contratante} />
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
      {k.pagamento.length > 0 && <><h3>Condições de pagamento</h3><ul>{k.pagamento.map((p, i) => <li key={i}>{p.descricao}: {formatar(doBanco(p.valor))}{p.quando ? ` · ${p.quando}` : ''}</li>)}</ul></>}
      <h2>Cláusulas</h2>
      {k.clausulas.map((x) => <div key={x.codigo} className="clausula"><h3>Cláusula {++n}ª · {x.titulo}</h3><p>{x.texto}</p></div>)}
      {k.observacoes && <><h3>Condições adicionais</h3><p style={{ whiteSpace: 'pre-wrap' }}>{k.observacoes}</p></>}
      <div className="assinaturas">
        <div><span />{k.partes.contratada.nome}<small>CONTRATADA</small></div>
        <div><span />{k.partes.contratante.nome}<small>CONTRATANTE</small></div>
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

export function Clausulas() {
  const [editar, setEditar] = useState<Clausula | 'nova' | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => ok(await supabase.from('clausula').select('*').order('ordem')) as (Clausula & { id: string; revisado_por: string | null; revisado_em: string | null; referencias: string | null })[], []);
  return (
    <>
      <Topo titulo="Cláusulas de contrato" sub="Modelos com versão e estado de revisão jurídica. Sem revisão, o contrato sai como minuta.">
        <Link className="btn-secundario" to="/biblioteca"><Icone nome="voltar" /> Biblioteca</Link>
        <button className="btn-primario" onClick={() => setEditar('nova')}><Icone nome="mais" /> Cláusula</button>
      </Topo>
      <div className="aviso info" style={{ marginBottom: 14 }}><span>As cláusulas iniciais são minutas de partida, sem citação de lei. Peça a revisão a um advogado e registre aqui quem revisou e quando. Mudar o texto cria nova versão e volta a minuta; contratos já emitidos guardam o texto da época.</span></div>
      <Erro mensagem={erro} />
      {carregando && !dados ? <Carregando /> : (
        <div className="stack">
          {(dados ?? []).map((c) => (
            <button key={c.id} className="card item-clausula" onClick={() => setEditar(c)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{c.titulo}</b>
                <span className={`selo ${c.revisao_juridica === 'revisada' ? 'ok' : 'alerta'}`}>{c.revisao_juridica === 'revisada' ? `Revisada por ${c.revisado_por} em ${formatarData(c.revisado_em)}` : 'Minuta'} · v{c.versao}</span>
              </div>
              <p className="muted small" style={{ margin: '6px 0 0' }}>{c.aplicavel.map((a) => APLICAVEL[a] ?? a).join(', ')}{c.ativo === false ? ' · inativa' : ''}</p>
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
    codigo: c?.codigo ?? '', titulo: c?.titulo ?? '', texto: c?.texto ?? '', aplicavel: c?.aplicavel ?? ['todos'], ordem: c?.ordem ?? 50, ativo: c?.ativo ?? true,
    revisada: c?.revisao_juridica === 'revisada', revisado_por: c?.revisado_por ?? '', revisado_em: c?.revisado_em ?? '', referencias: c?.referencias ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const reg = {
      codigo: f.codigo.trim() || f.titulo.trim().toLowerCase().normalize('NFD').replace(/[^\w]+/g, '_').slice(0, 40), titulo: f.titulo.trim(), texto: f.texto.trim(),
      aplicavel: f.aplicavel.length ? f.aplicavel : ['todos'], ordem: Number(f.ordem) || 0, ativo: f.ativo,
      revisao_juridica: f.revisada ? 'revisada' : 'minuta', revisado_por: f.revisado_por.trim() || null, revisado_em: f.revisado_em || null, referencias: f.referencias.trim() || null,
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
        <label className="campo">Texto <Ajuda>Marcadores preenchidos automaticamente: {'{proposta} {valor_total} {honorarios} {visitas_incluidas} {visita_adicional} {remuneracao_administracao} {prazo}'}.</Ajuda>
          <textarea rows={7} value={f.texto} onChange={(e) => set('texto', e.target.value)} required /></label>
        <fieldset className="campo"><legend>Entra nos modelos</legend>
          <div className="lista-check">{Object.entries(APLICAVEL).map(([k, v]) => (
            <label key={k} className="check"><input type="checkbox" checked={f.aplicavel.includes(k)} onChange={(e) => set('aplicavel', e.target.checked ? [...f.aplicavel, k] : f.aplicavel.filter((x) => x !== k))} /> {v}</label>
          ))}</div>
        </fieldset>
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
