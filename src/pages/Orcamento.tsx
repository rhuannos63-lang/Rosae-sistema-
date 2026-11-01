// Novo orçamento (automático) e tabela de preços do orçamento.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { ok, useConsulta } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Carregando, Erro, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { CampoNumero, estadoInicial, OrcamentoGerador, servicosDo, type EstadoGerador } from '../components/OrcamentoGerador';
import { carregarPrecos, salvarPrecos, type TabelaPrecos } from '../lib/orcamentoParametros';
import { paraBanco } from '../core/dinheiro';
import { prepararParaSalvar, type ModeloServico } from '../core/proposta';
import {
  DEFINICOES, gerarOrcamento, gerarOrcamentoServicos, nomeDosServicos, parametrosDe, parametrosPadrao, respostasPadrao, TIPOS,
  type Orcamento, type Parametros, type TipoServico,
} from '../core/orcamento';

const reaisTexto = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type PessoaMin = { id: string; nome: string; telefone: string | null; email: string | null };
type Op = { id: string; titulo: string; pessoa_id: string; resumo: string | null; local_obra: string | null; estado_id: string };

/** Grava o orçamento gerado como proposta (versão 1 em rascunho) e os custos internos. */
export async function gravarOrcamento(o: Orcamento, versaoId: string, podeFinanceiro: boolean) {
  const pr = prepararParaSalvar(o.conteudo);
  const manual = Math.round(o.principal.valor * 100) !== Math.round(o.principal.calculado * 100);
  ok(await supabase.from('proposta_versao').update({ conteudo: pr.conteudo, valor_total: pr.valor_total }).eq('id', versaoId).select('id'));
  if (podeFinanceiro) {
    ok(await supabase.from('proposta_custo').upsert({
      versao_id: versaoId, custos: { linhas: o.custos }, custo_total: paraBanco(Math.round(o.analise.custo * 100)),
      notas_internas: `Gerado pelo orçamento automático (${nomeDosServicos(o)}, pacote ${o.principal.nome}).${manual ? ` Preço definido por você; pela tabela seria ${reaisTexto(o.principal.calculado)}.` : ''} Margem estimada ${o.analise.margem_pct.toFixed(0)}%.`,
    }));
  }
}

export function NovoOrcamento() {
  const navegar = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { podeFinanceiro } = useAuth();
  const opId = params.get('oportunidade');
  const { dados, erro: erroCarga, carregando } = useConsulta(async () => {
    const [precos, pessoas, bib, op] = await Promise.all([
      carregarPrecos(),
      supabase.from('pessoa').select('id, nome, telefone, email').eq('arquivado', false).order('nome'),
      supabase.from('modelo_servico').select('*').eq('ativo', true),
      opId ? supabase.from('oportunidade').select('id, titulo, pessoa_id, resumo, local_obra, estado_id').eq('id', opId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    return { precos, pessoas: ok(pessoas) as PessoaMin[], biblioteca: ok(bib) as ModeloServico[], op: ok(op) as Op | null };
  }, [opId]);
  const [estado, setEstado] = useState<EstadoGerador>(() => estadoInicial(params.get('tipo') ? { tipo: params.get('tipo')!, respostas: {}, pacote: 2 } : null));
  const [modoCliente, setModoCliente] = useState<'existente' | 'novo'>('existente');
  const [clienteId, setClienteId] = useState('');
  const [novo, setNovo] = useState({ nome: '', telefone: '', email: '' });
  const [busca, setBusca] = useState('');
  const [necessidade, setNecessidade] = useState('');
  const [local, setLocal] = useState('');
  const [titulo, setTitulo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const op = dados?.op ?? null;
  const contexto = useMemo(() => ({ necessidade: necessidade || op?.resumo || '', local: local || op?.local_obra || '', biblioteca: dados?.biblioteca }), [necessidade, local, op, dados?.biblioteca]);
  if (carregando && !dados) return <Carregando />;
  if (erroCarga || !dados) return <Erro mensagem={erroCarga ?? 'Erro ao carregar.'} />;
  const filtradas = dados.pessoas.filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 50);
  const clienteNome = op ? dados.pessoas.find((p) => p.id === op.pessoa_id)?.nome : modoCliente === 'novo' ? novo.nome : dados.pessoas.find((p) => p.id === clienteId)?.nome;

  async function gerar(o: Orcamento) {
    setErro(null);
    if (!op && modoCliente === 'existente' && !clienteId) return setErro('Escolha o cliente.');
    if (!op && modoCliente === 'novo' && novo.nome.trim().length < 2) return setErro('Informe o nome do cliente.');
    if (o.principal.valor <= 0) return setErro('Preencha os dados do serviço para calcular o valor.');
    setGravando(true);
    try {
      let pessoaId = op?.pessoa_id ?? clienteId;
      if (!op && modoCliente === 'novo') {
        pessoaId = (ok(await supabase.from('pessoa').insert({ nome: novo.nome.trim(), telefone: novo.telefone || null, email: novo.email || null, eh_cliente: true }).select('id').single()) as { id: string }).id;
      }
      const estados = ok(await supabase.from('estado_funil').select('id, nome, ordem, tipo')) as { id: string; nome: string; ordem: number; tipo: string }[];
      const prep = estados.find((x) => x.nome === 'Proposta em preparação');
      const nomeProposta = titulo.trim() || o.titulo;
      let oportunidadeId = op?.id;
      if (!oportunidadeId) {
        oportunidadeId = (ok(await supabase.from('oportunidade').insert({
          pessoa_id: pessoaId, titulo: nomeProposta, tipo_servico: nomeDosServicos(o), local_obra: contexto.local || null, resumo: contexto.necessidade || null,
          estado_id: prep?.id ?? estados.sort((a, b) => a.ordem - b.ordem)[0].id, valor_estimado: paraBanco(Math.round(o.principal.valor * 100)),
        }).select('id').single()) as { id: string }).id;
      } else {
        const atual = estados.find((x) => x.id === op!.estado_id);
        if (prep && atual && atual.tipo === 'aberto' && atual.ordem < prep.ordem) await supabase.from('oportunidade').update({ estado_id: prep.id }).eq('id', op!.id);
      }
      const pid = (ok(await supabase.from('proposta').insert({ oportunidade_id: oportunidadeId, pessoa_id: pessoaId, titulo: nomeProposta }).select('id').single()) as { id: string }).id;
      const vid = ok(await supabase.rpc('nova_versao_proposta', { p_proposta: pid })) as string;
      await gravarOrcamento(o, vid, podeFinanceiro);
      toast('Proposta criada. Revise a apresentação e emita quando estiver pronta.');
      navegar(`/propostas/${pid}?aba=revisao`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <>
      <Topo titulo="Novo orçamento" sub="Escolha o serviço, preencha os dados e a proposta sai pronta: escopo, pacotes, prazo, pagamento e apresentação.">
        <Link className="btn-secundario" to="/orcamento/precos"><Icone nome="config" /> Tabela de preços</Link>
        <Link className="btn-secundario" to="/propostas">Propostas</Link>
      </Topo>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid grid-2">
          <div className="stack" style={{ gap: 10 }}>
            <h2>Cliente</h2>
            {op ? (
              <p style={{ margin: 0 }}>Oportunidade <b>{op.titulo}</b> · {clienteNome}</p>
            ) : (
              <>
                <div className="segmentado">
                  <button type="button" className={modoCliente === 'existente' ? 'ativo' : ''} onClick={() => setModoCliente('existente')}>Já cadastrado</button>
                  <button type="button" className={modoCliente === 'novo' ? 'ativo' : ''} onClick={() => setModoCliente('novo')}>Novo cliente</button>
                </div>
                {modoCliente === 'existente' ? (
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente" />
                    <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} aria-label="Cliente">
                      <option value="">Escolha…</option>
                      {filtradas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }}>
                    <input placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} aria-label="Nome do cliente" />
                    <input placeholder="WhatsApp" inputMode="tel" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} aria-label="WhatsApp" />
                    <input placeholder="E-mail" type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} aria-label="E-mail" />
                  </div>
                )}
              </>
            )}
            <label className="campo">Título da proposta <span className="dica">Deixe em branco para usar o sugerido</span>
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={estado.tipo ? gerarOrcamentoServicos(servicosDo(estado), dados.precos, estado.pacote).titulo : 'Ex.: Projeto estrutural · Casa Itaipava'} />
            </label>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <label className="campo">Local do serviço<input value={local || op?.local_obra || ''} onChange={(e) => setLocal(e.target.value)} placeholder="Bairro, cidade" /></label>
            <label className="campo">A necessidade, nas palavras do cliente <span className="dica">Personaliza a apresentação. Sem isso, entra um texto padrão do serviço.</span>
              <textarea rows={3} value={necessidade || op?.resumo || ''} onChange={(e) => setNecessidade(e.target.value)} placeholder="Ex.: Quero construir uma casa de dois andares no terreno da família e preciso do projeto estrutural para orçar a obra." />
            </label>
          </div>
        </div>
      </div>
      <OrcamentoGerador
        estado={estado} setEstado={setEstado} precos={dados.precos} contexto={contexto} podeFinanceiro={podeFinanceiro}
        acao={(o) => (
          <>
            <Erro mensagem={erro} />
            <button className="btn-primario btn-grande" disabled={gravando || o.principal.valor <= 0} onClick={() => gerar(o)}>
              <Icone nome="varinha" /> {gravando ? 'Gerando…' : 'Gerar proposta'}
            </button>
            <span className="muted small">Cria a proposta em rascunho para {clienteNome || 'o cliente'}. Você revisa tudo antes de enviar.</span>
          </>
        )}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Tabela de preços
// ---------------------------------------------------------------------
export function PrecosOrcamento() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { podeFinanceiro } = useAuth();
  const tipo = ((TIPOS as string[]).includes(params.get('tipo') ?? '') ? params.get('tipo') : 'projeto_estrutural') as TipoServico;
  const { dados, erro, carregando, recarregar } = useConsulta<TabelaPrecos>(() => carregarPrecos(), []);
  const [edit, setEdit] = useState<Partial<Record<TipoServico, Parametros>>>({});
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro ?? 'Erro ao carregar.'} />;
  const valores = edit[tipo] ?? dados[tipo];
  const padrao = parametrosPadrao(tipo);
  const mudar = (id: string, v: number | null) => setEdit({ ...edit, [tipo]: { ...valores, [id]: v ?? padrao[id] } });
  const exemplo = gerarOrcamento(tipo, { ...respostasPadrao(tipo), area: respostasPadrao(tipo).area ?? 120 }, valores, 2);
  const defs = parametrosDe(tipo);

  async function salvar() {
    setErroSalvar(null);
    setSalvando(true);
    try {
      await salvarPrecos(tipo, valores);
      setEdit({ ...edit, [tipo]: undefined });
      toast(`Tabela de ${DEFINICOES[tipo].nome.toLowerCase()} salva. Vale para os próximos orçamentos.`);
      recarregar();
    } catch (e) { setErroSalvar(mensagemErro(e)); } finally { setSalvando(false); }
  }
  // Função (não componente) para os campos não perderem o foco a cada tecla.
  const grupo = (titulo: string, custo: boolean) => {
    const lista = defs.filter((d) => !!d.custo === custo);
    if (!lista.length) return null;
    return (
      <div className="stack" style={{ gap: 8 }}>
        <h3>{titulo}</h3>
        <div className="grid grid-2">
          {lista.map((d) => (
            <label key={d.id} className="campo">
              <span>{d.rotulo}{d.ajuda && <span className="dica"> · {d.ajuda}</span>}</span>
              <div className="campo-unidade">
                <CampoNumero valor={valores[d.id] ?? null} aoMudar={(v) => mudar(d.id, v)} />
                <span>{d.unidade}</span>
              </div>
              {valores[d.id] !== padrao[d.id] && <button type="button" className="btn-link small" style={{ alignSelf: 'flex-start' }} onClick={() => mudar(d.id, padrao[d.id])}>Voltar ao padrão ({padrao[d.id].toLocaleString('pt-BR')})</button>}
            </label>
          ))}
        </div>
      </div>
    );
  };
  return (
    <>
      <Topo titulo="Tabela de preços do orçamento" sub="Os valores iniciais são referências para começar. Ajuste à sua realidade: vale para os próximos orçamentos, os já emitidos não mudam.">
        <Link className="btn-secundario" to="/orcamento"><Icone nome="voltar" /> Novo orçamento</Link>
      </Topo>
      <div className="abas-obra">
        {TIPOS.map((t) => <button key={t} className={t === tipo ? 'ativo' : ''} onClick={() => setParams({ tipo: t })}>{DEFINICOES[t].nome}</button>)}
      </div>
      <div className="grid grid-2-1">
        <div className="card stack">
          {grupo('Preços', false)}
          {grupo(podeFinanceiro ? 'Custos de referência (entram no cálculo e na margem)' : 'Custos de referência', true)}
          <Erro mensagem={erroSalvar} />
          <div className="row"><button className="btn-primario" onClick={salvar} disabled={salvando || !edit[tipo]}>{salvando ? 'Salvando…' : 'Salvar tabela'}</button>{edit[tipo] && <button className="btn-link" onClick={() => setEdit({ ...edit, [tipo]: undefined })}>Descartar mudanças</button>}</div>
        </div>
        <aside className="card" style={{ alignSelf: 'start', position: 'sticky', top: 12 }}>
          <h2>Exemplo com estes preços</h2>
          <p className="muted small" style={{ marginTop: 4 }}>{DEFINICOES[tipo].nome} com as respostas padrão{respostasPadrao(tipo).area === null ? ' e 120 m²' : ''}.</p>
          {exemplo.pacotes.map((p) => (
            <div key={p.numero} className="destino"><span>{p.nome}</span><b className="num">{(p.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b></div>
          ))}
          {podeFinanceiro && <div className="destino"><span>Margem estimada (Completo)</span><b className="num">{exemplo.analise.margem_pct.toFixed(0)}%</b></div>}
          <div className="destino"><span>Prazo</span><b>{exemplo.conteudo.prazo_total_dias} dias</b></div>
        </aside>
      </div>
    </>
  );
}
