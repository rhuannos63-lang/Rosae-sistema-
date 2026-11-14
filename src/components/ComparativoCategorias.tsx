// Orçado × fechado por categoria, no financeiro da obra. As categorias saem sozinhas do
// orçamento aceito (e dos aditivos aceitos); o Rhuann só lança quanto fechou com cada
// profissional ou fornecedor e vê, ao lado, o lucro ou prejuízo de cada uma.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { carregarBase, carregarCondicoes } from '../lib/composicoes';
import { Ajuda, CampoValor, Carregando, Erro, Modal, useToast } from './ui';
import { Icone } from './Icone';
import { formatar, doBanco, type Centavos } from '../core/dinheiro';
import { acrescimoDas } from '../core/condicoes';
import type { Uso, Padrao } from '../core/composicao';
import type { Conteudo } from '../core/proposta';
import {
  compararCategorias, montarCategorias, novoId, percentual, rotuloDiferenca, TIPO_LINHA,
  type CategoriaComparada, type DadosComparativo, type FonteOrcamento, type LinhaComparada, type TipoLinha,
} from '../core/comparativo';

type Custos = { linhas?: { descricao: string; valor: number }[]; composicoes?: Uso[]; padrao?: Padrao; condicoes?: string[] } | null;
type Sugestao = { codigo: string; pessoa: string; valor: Centavos };
type Carga = { base: Awaited<ReturnType<typeof carregarBase>>; fontes: FonteOrcamento[]; dados: DadosComparativo; existe: boolean; sugestoes: Record<string, Sugestao[]>; nomes: string[] };

async function carregar(obraId: string): Promise<Carga> {
  const obra = ok(await supabase.from('obra').select('proposta_versao_id').eq('id', obraId).single()) as { proposta_versao_id: string | null };
  const aditivos = ok(await supabase.from('proposta').select('codigo, versao_aprovada_id').eq('obra_id', obraId).eq('tipo', 'aditivo').not('versao_aprovada_id', 'is', null).order('criado_em')) as { codigo: string; versao_aprovada_id: string }[];
  const versoes = [
    ...(obra.proposta_versao_id ? [{ id: obra.proposta_versao_id, rotulo: null as string | null }] : []),
    ...aditivos.map((a) => ({ id: a.versao_aprovada_id, rotulo: `Aditivo ${a.codigo}` })),
  ];
  const ids = versoes.map((v) => v.id);
  const [vs, cs, base, condicoes, salvo, contratos, servicos, pessoas] = await Promise.all([
    ids.length ? supabase.from('proposta_versao').select('id, conteudo').in('id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from('proposta_custo').select('versao_id, custos').in('versao_id', ids) : Promise.resolve({ data: [], error: null }),
    carregarBase(),
    carregarCondicoes(),
    supabase.from('obra_comparativo').select('dados').eq('obra_id', obraId).maybeSingle(),
    supabase.from('v_contratacao').select('codigo, servico_id, pessoa_nome, valor_total, estado').eq('obra_id', obraId),
    supabase.from('servico').select('id, origem_item_id, origem_versao_id').eq('obra_id', obraId),
    supabase.from('pessoa').select('nome').eq('arquivado', false).or('eh_fornecedor.eq.true,eh_prestador.eq.true').order('nome').limit(300),
  ]);
  const conteudos = new Map((ok(vs) as { id: string; conteudo: Conteudo }[]).map((v) => [v.id, v.conteudo]));
  const custos = new Map((ok(cs) as { versao_id: string; custos: Custos }[]).map((c) => [c.versao_id, c.custos]));
  const fontes: FonteOrcamento[] = versoes.filter((v) => conteudos.has(v.id)).map((v) => {
    const cu = custos.get(v.id) ?? null;
    return { rotulo: v.rotulo, conteudo: conteudos.get(v.id)!, custos: cu, acrescimo: acrescimoDas(cu?.condicoes, condicoes) };
  });
  // Parceiro já contratado para um serviço: sugere usar o valor como fechamento da categoria.
  const prefixo = new Map(versoes.filter((v) => conteudos.has(v.id)).map((v, i) => [v.id, i === 0 ? '' : `a${i}:`]));
  const catDoServico = new Map((ok(servicos) as { id: string; origem_item_id: string | null; origem_versao_id: string | null }[])
    .filter((s) => s.origem_item_id && s.origem_versao_id && prefixo.has(s.origem_versao_id))
    .map((s) => [s.id, `${prefixo.get(s.origem_versao_id!)}item:${s.origem_item_id}`]));
  const sugestoes: Record<string, Sugestao[]> = {};
  for (const ct of (ok(contratos) as { codigo: string; servico_id: string | null; pessoa_nome: string; valor_total: string; estado: string }[])) {
    const cat = ct.servico_id ? catDoServico.get(ct.servico_id) : undefined;
    if (!cat || ct.estado === 'cancelada') continue;
    (sugestoes[cat] ??= []).push({ codigo: ct.codigo, pessoa: ct.pessoa_nome, valor: doBanco(ct.valor_total) });
  }
  const d = ok(salvo) as { dados: DadosComparativo } | null;
  return { base, fontes, dados: d?.dados ?? {}, existe: !!d, sugestoes, nomes: (ok(pessoas) as { nome: string }[]).map((p) => p.nome) };
}

type Filtro = 'todas' | 'abertas' | 'prejuizo';

export function ComparativoCategorias({ obraId }: { obraId: string }) {
  const carga = useConsulta(() => carregar(obraId), [obraId]);
  if (carga.carregando && !carga.dados) return <div className="card" style={{ marginTop: 14 }}><Carregando /></div>;
  if (carga.erro) return <div className="card" style={{ marginTop: 14 }}><Erro mensagem={carga.erro} /></div>;
  if (!carga.dados) return null;
  return <Quadro obraId={obraId} carga={carga.dados} />;
}

function Quadro({ obraId, carga }: { obraId: string; carga: Carga }) {
  const toast = useToast();
  const [dados, setDados] = useState<DadosComparativo>(carga.dados);
  const [estado, setEstado] = useState<'salvo' | 'pendente' | 'salvando' | 'erro'>('salvo');
  const [erro, setErro] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [semCusto, setSemCusto] = useState(false);
  const [novaCat, setNovaCat] = useState(false);
  const salvoJson = useRef(JSON.stringify(carga.dados));

  const base = useMemo(() => {
    try { return { cats: montarCategorias(carga.fontes, carga.base), erro: null }; } catch (e) { return { cats: [], erro: String(e) }; }
  }, [carga.fontes, carga.base]);
  const { categorias, totais } = useMemo(() => compararCategorias(base.cats, dados), [base.cats, dados]);

  // Salva sozinho, um instante depois de cada mudança.
  useEffect(() => {
    const json = JSON.stringify(dados);
    if (json === salvoJson.current) return;
    setEstado('pendente');
    const t = setTimeout(async () => {
      setEstado('salvando');
      const { error } = await supabase.from('obra_comparativo').upsert({ obra_id: obraId, dados });
      if (error) { setEstado('erro'); setErro(mensagemErro(error)); return; }
      salvoJson.current = json; setErro(null); setEstado('salvo');
    }, 900);
    return () => clearTimeout(t);
  }, [dados, obraId]);

  const mudar = (f: (d: DadosComparativo) => DadosComparativo) => setDados((d) => f({ ...d }));
  const alternar = (id: string) => setAbertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const temCusto = (c: CategoriaComparada) => c.orcado > 0 || c.fechado > 0 || c.manual || c.linhas.length > 0;
  const semCustoN = categorias.filter((c) => !temCusto(c)).length;
  const visiveis = categorias.filter((c) => (semCusto || temCusto(c)) && (
    filtro === 'todas' || (filtro === 'abertas' && c.situacao !== 'fechada') || (filtro === 'prejuizo' && c.situacao !== 'aberta' && c.diferenca < 0)));

  const res = rotuloDiferenca(totais.orcadoFechado || totais.fechado ? totais.diferenca : null);
  const pct = percentual(totais.diferenca, totais.orcadoFechado);

  if (!carga.fontes.length && !(dados.categorias ?? []).length) {
    return (
      <div className="card comparativo" style={{ marginTop: 14 }}>
        <div className="card-titulo"><h2>Orçado × fechado por categoria</h2><button className="btn-secundario" onClick={() => setNovaCat(true)}><Icone nome="mais" /> Nova categoria</button></div>
        <p className="muted" style={{ margin: 0 }}>Esta obra não veio de um orçamento aceito, então não há categorias automáticas. Crie as categorias à mão (ex.: Troca de piso, Ar-condicionado) e lance o orçado e o fechado de cada item.</p>
        {novaCat && <NovaCategoria aoFechar={() => setNovaCat(false)} aoCriar={(nome) => { const id = novoId('cat'); mudar((d) => ({ ...d, categorias: [...(d.categorias ?? []), { id, nome }] })); setAbertas(new Set([id])); setNovaCat(false); }} />}
      </div>
    );
  }

  return (
    <div className="card comparativo" style={{ marginTop: 14 }}>
      <div className="card-titulo">
        <h2>Orçado × fechado por categoria <Ajuda>Cada serviço do orçamento aceito vira uma categoria, com os itens da composição de custos (material por material, mão de obra somada). Lance quanto fechou com cada profissional ou fornecedor: a diferença ao lado mostra se deu lucro ou prejuízo. O resultado só conta o que já foi fechado; o resto aparece como “a fechar”. É custo direto: tributos e despesas da empresa ficam de fora.</Ajuda></h2>
        <div className="row">
          <span className={`small ${estado === 'erro' ? 'desfavoravel' : 'muted'}`}>{{ salvo: carga.existe || estado !== 'salvo' ? 'Tudo salvo' : '', pendente: 'Salvando…', salvando: 'Salvando…', erro: 'Não salvou' }[estado]}</span>
          <button className="btn-secundario" onClick={() => setNovaCat(true)}><Icone nome="mais" /> Nova categoria</button>
        </div>
      </div>
      <Erro mensagem={erro ?? base.erro} />

      <div className="cmp-resumo">
        <div className="cmp-kpi"><span className="rotulo">Orçado</span><b className="num">{formatar(totais.orcado)}</b><span className="det">custo previsto de {totais.categorias} categoria{totais.categorias === 1 ? '' : 's'}</span></div>
        <div className="cmp-kpi"><span className="rotulo">Fechado</span><b className="num">{formatar(totais.fechado)}</b><span className="det">contra {formatar(totais.orcadoFechado)} orçados nesses itens</span></div>
        <div className={`cmp-kpi destaque ${res.classe}`}>
          <span className="rotulo">{res.texto === 'A fechar' ? 'Resultado' : res.texto}</span>
          <b className="num">{totais.orcadoFechado || totais.fechado ? formatar(Math.abs(totais.diferenca)) : '—'}</b>
          <span className="det">{totais.orcadoFechado ? `${Math.abs(pct).toLocaleString('pt-BR')}% ${totais.diferenca >= 0 ? 'abaixo' : 'acima'} do orçado` : 'nada fechado ainda'}{totais.comPrejuizo ? ` · ${totais.comPrejuizo} com prejuízo` : ''}</span>
        </div>
        <div className="cmp-kpi"><span className="rotulo">A fechar</span><b className="num">{formatar(totais.aFechar)}</b>
          <span className="det">{totais.fechadas} de {totais.categorias} fechadas</span>
          <span className="cmp-barra" aria-hidden><i style={{ width: `${totais.orcado ? Math.min(100, (totais.orcadoFechado / totais.orcado) * 100) : 0}%` }} /></span>
        </div>
      </div>

      <div className="cmp-filtros" role="group" aria-label="Filtrar categorias">
        {([['todas', 'Todas'], ['abertas', 'Falta fechar'], ['prejuizo', 'Com prejuízo']] as [Filtro, string][]).map(([k, r]) => (
          <button key={k} className={filtro === k ? 'ativo' : ''} onClick={() => setFiltro(k)}>{r}</button>
        ))}
        <span className="espaco" />
        <button className="btn-link small" onClick={() => setAbertas(abertas.size ? new Set() : new Set(visiveis.map((c) => c.id)))}>{abertas.size ? 'Recolher tudo' : 'Abrir tudo'}</button>
      </div>

      <div className="cmp-tabela" role="table" aria-label="Orçado e fechado por categoria">
        <div className="cmp-cab" role="row"><span role="columnheader">Categoria</span><span role="columnheader" className="right">Orçado</span><span role="columnheader" className="right">Fechado</span><span role="columnheader" className="right">Diferença</span></div>
        {visiveis.length === 0 && <p className="muted small" style={{ padding: '14px 4px' }}>Nenhuma categoria neste filtro.</p>}
        {visiveis.map((c) => (
          <Categoria key={c.id} c={c} aberta={abertas.has(c.id)} alternar={() => alternar(c.id)} mudar={mudar} sugestoes={carga.sugestoes[c.id] ?? []} nomes={carga.nomes}
            aoRemover={c.manual ? () => { mudar((d) => ({ ...d, categorias: (d.categorias ?? []).filter((x) => x.id !== c.id) })); toast('Categoria removida.'); } : undefined} />
        ))}
        <div className="cmp-total" role="row">
          <span>Total</span>
          <span className="right num">{formatar(totais.orcado)}</span>
          <span className="right num">{formatar(totais.fechado)}</span>
          <span className="right"><Diferenca valor={totais.orcadoFechado || totais.fechado ? totais.diferenca : null} /></span>
        </div>
      </div>
      {semCustoN > 0 && <button className="btn-link small" onClick={() => setSemCusto((v) => !v)}>{semCusto ? 'Esconder' : 'Mostrar'} {semCustoN} serviço{semCustoN === 1 ? '' : 's'} sem custo orçado (ex.: gestão, projeto próprio)</button>}
      <p className="muted small" style={{ marginBottom: 0 }}>Lucro = fechou abaixo do orçado · Prejuízo = fechou acima. Valores da composição já incluem perdas e as condições da obra marcadas no orçamento.</p>
      {novaCat && <NovaCategoria aoFechar={() => setNovaCat(false)} aoCriar={(nome) => { const id = novoId('cat'); mudar((d) => ({ ...d, categorias: [...(d.categorias ?? []), { id, nome }] })); setAbertas((s) => new Set([...s, id])); setNovaCat(false); }} />}
    </div>
  );
}

function Diferenca({ valor, pequeno }: { valor: Centavos | null; pequeno?: boolean }) {
  const r = rotuloDiferenca(valor);
  if (valor == null) return <span className="cmp-pill neutro">A fechar</span>;
  return (
    <span className={`cmp-dif ${r.classe}`}>
      <b className="num">{valor === 0 ? formatar(0) : `${valor > 0 ? '+' : '−'} ${formatar(Math.abs(valor))}`}</b>
      {!pequeno && <span className={`cmp-pill ${r.classe}`}>{r.texto}</span>}
    </span>
  );
}

const SITUACAO: Record<CategoriaComparada['situacao'], string> = { aberta: 'A fechar', parcial: 'Em parte', fechada: 'Fechada' };

function Categoria({ c, aberta, alternar, mudar, sugestoes, nomes, aoRemover }: {
  c: CategoriaComparada; aberta: boolean; alternar: () => void; mudar: (f: (d: DadosComparativo) => DadosComparativo) => void;
  sugestoes: Sugestao[]; nomes: string[]; aoRemover?: () => void;
}) {
  const [novaLinha, setNovaLinha] = useState(false);
  const pctFechado = c.orcado ? Math.min(100, (c.orcadoFechado / c.orcado) * 100) : c.situacao === 'fechada' ? 100 : 0;
  const setLinha = (l: LinhaComparada, valor: Centavos | null, fornecedor: string) => mudar((d) => {
    const linhas = { ...(d.linhas ?? {}) };
    if (valor == null && !fornecedor) delete linhas[l.id]; else linhas[l.id] = { valor, fornecedor: fornecedor || undefined };
    return { ...d, linhas };
  });
  const setPacote = (valor: Centavos | null, fornecedor: string, ligado: boolean) => mudar((d) => {
    const pacotes = { ...(d.pacotes ?? {}) };
    if (!ligado) delete pacotes[c.id]; else pacotes[c.id] = { valor, fornecedor: fornecedor || undefined };
    return { ...d, pacotes };
  });
  const pacoteLigado = c.pacote != null;
  return (
    <div className={`cmp-cat ${aberta ? 'expandida' : ''}`} role="rowgroup">
      <button className="cmp-linha-cat" role="row" aria-expanded={aberta} onClick={alternar}>
        <span className="cmp-nome" role="cell">
          <Icone nome="chevron" />
          <span>
            <b>{c.nome}</b>
            <span className="cmp-sub">
              <span className={`cmp-situacao ${c.situacao}`}>{SITUACAO[c.situacao]}</span>
              {c.origem && <span>{c.origem}</span>}
              {c.pacote ? <span>pacote{c.pacote.fornecedor ? ` · ${c.pacote.fornecedor}` : ''}</span> : <span>{c.linhas.length} ite{c.linhas.length === 1 ? 'm' : 'ns'}</span>}
              {c.vendido > 0 && <span>vendido {formatar(c.vendido)}</span>}
            </span>
            <span className="cmp-barra" aria-hidden><i style={{ width: `${pctFechado}%` }} /></span>
          </span>
        </span>
        <span className="right num" role="cell"><span className="cmp-rot-mob">Orçado</span>{formatar(c.orcado)}</span>
        <span className="right num" role="cell"><span className="cmp-rot-mob">Fechado</span>{c.situacao === 'aberta' ? <span className="muted">—</span> : formatar(c.fechado)}</span>
        <span className="right" role="cell"><Diferenca valor={c.situacao === 'aberta' ? null : c.diferenca} /></span>
      </button>

      {aberta && (
        <div className="cmp-detalhe">
          {sugestoes.length > 0 && !c.pacote && (
            <div className="aviso info cmp-sugestao">
              <Icone nome="raio" />
              <span>{sugestoes.map((s) => `${s.codigo} · ${s.pessoa} · ${formatar(s.valor)}`).join('; ')} já está contratado para este serviço.</span>
              <button className="btn-secundario" onClick={() => setPacote(sugestoes.reduce((t, s) => t + s.valor, 0), sugestoes.map((s) => s.pessoa).join(', '), true)}>Usar como fechado</button>
            </div>
          )}
          <label className="cmp-pacote">
            <input type="checkbox" checked={pacoteLigado} onChange={(e) => setPacote(e.target.checked ? c.orcado : null, '', e.target.checked)} />
            <span>Fechei esta categoria inteira num valor só <span className="muted small">(ex.: empreiteiro com material e mão de obra)</span></span>
          </label>
          {c.pacote && (
            <div className="cmp-pacote-campos">
              <label className="campo">Valor fechado<CampoValor valor={c.pacote.valor} aoMudar={(v) => setPacote(v, c.pacote?.fornecedor ?? '', true)} /></label>
              <label className="campo">Com quem<input list="cmp-nomes" value={c.pacote.fornecedor ?? ''} placeholder="Profissional ou empresa" onChange={(e) => setPacote(c.pacote?.valor ?? null, e.target.value, true)} /></label>
            </div>
          )}
          {c.linhas.length > 0 && (
            <div className="cmp-itens">
              <div className="cmp-itens-cab"><span>Item</span><span className="right">Orçado</span><span>Fechado com</span><span className="right">Valor fechado</span><span className="right">Diferença</span><span /></div>
              {c.linhas.map((l) => (
                <div key={l.id} className={`cmp-item ${l.dispensada ? 'dispensada' : ''}`}>
                  <span className="cmp-item-nome">
                    {l.tipo !== 'outro' && <span className={`cmp-tipo ${l.tipo}`}>{TIPO_LINHA[l.tipo]}</span>}
                    <b>{l.nome}</b>
                    {(l.quantidade != null || l.detalhe) && <span className="muted small">{l.quantidade != null ? `${l.quantidade.toLocaleString('pt-BR')} ${l.unidade ?? ''}` : ''}{l.detalhe ? l.detalhe : ''}</span>}
                  </span>
                  <span className="right num"><span className="cmp-rot-mob">Orçado</span>{formatar(l.orcado)}</span>
                  {c.pacote ? <span className="muted small cmp-no-pacote">No pacote</span> : l.dispensada ? <span className="muted small cmp-no-pacote">Não vai acontecer</span> : (
                    <>
                      <input className="cmp-forn" list="cmp-nomes" aria-label={`Com quem fechou: ${l.nome}`} placeholder="Profissional ou loja" value={l.fornecedor} onChange={(e) => setLinha(l, l.fechado, e.target.value)} />
                      <span className="cmp-valor"><CampoValor valor={l.fechado} aoMudar={(v) => setLinha(l, v, l.fornecedor)} /></span>
                    </>
                  )}
                  <span className="right">{c.pacote ? null : <Diferenca valor={l.diferenca} pequeno />}</span>
                  <span className="cmp-acoes">
                    {l.manual ? (
                      <button className="btn-icone" title="Remover linha" aria-label="Remover linha" onClick={() => mudar((d) => ({ ...d, extras: { ...(d.extras ?? {}), [c.id]: (d.extras?.[c.id] ?? []).filter((x) => x.id !== l.id) } }))}><Icone nome="lixeira" /></button>
                    ) : (
                      <button className="btn-icone" title={l.dispensada ? 'Voltar a contar' : 'Não vai acontecer (cliente tirou ou compra ele mesmo)'} aria-label={l.dispensada ? 'Voltar a contar' : 'Marcar que não vai acontecer'}
                        onClick={() => mudar((d) => { const s = new Set(d.dispensadas ?? []); if (s.has(l.id)) s.delete(l.id); else s.add(l.id); return { ...d, dispensadas: Array.from(s) }; })}>
                        <Icone nome={l.dispensada ? 'desfazer' : 'fechar'} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {c.linhas.length === 0 && !c.pacote && <p className="muted small" style={{ margin: '4px 0' }}>Sem itens orçados nesta categoria. Adicione o que você contratou ou comprou.</p>}
          <div className="row cmp-rodape">
            <button className="btn-link" onClick={() => setNovaLinha(true)}><Icone nome="mais" /> Item fora do orçamento</button>
            {aoRemover && <button className="btn-link desfavoravel" onClick={aoRemover}><Icone nome="lixeira" /> Remover categoria</button>}
            {c.situacao !== 'aberta' && c.orcadoFechado > 0 && <span className="muted small espaco-esq">{Math.abs(percentual(c.diferenca, c.orcadoFechado)).toLocaleString('pt-BR')}% {c.diferenca >= 0 ? 'abaixo' : 'acima'} do orçado{c.aFechar > 0 ? ` · falta fechar ${formatar(c.aFechar)}` : ''}</span>}
          </div>
        </div>
      )}
      {novaLinha && <NovaLinha categoria={c.nome} aoFechar={() => setNovaLinha(false)} aoCriar={(l, fechado, fornecedor) => {
        const id = novoId(`${c.id}:x`);
        mudar((d) => ({ ...d, extras: { ...(d.extras ?? {}), [c.id]: [...(d.extras?.[c.id] ?? []), { id, ...l }] }, linhas: fechado != null || fornecedor ? { ...(d.linhas ?? {}), [id]: { valor: fechado, fornecedor: fornecedor || undefined } } : d.linhas }));
        setNovaLinha(false);
      }} />}
      <datalist id="cmp-nomes">{nomes.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}

function NovaCategoria({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (nome: string) => void }) {
  const [nome, setNome] = useState('');
  return (
    <Modal titulo="Nova categoria" aoFechar={aoFechar}
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" disabled={!nome.trim()} onClick={() => aoCriar(nome.trim())}>Criar</button></>}>
      <label className="campo">Nome<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Imprevistos, Ar-condicionado da suíte" onKeyDown={(e) => e.key === 'Enter' && nome.trim() && aoCriar(nome.trim())} /></label>
      <p className="muted small">Use para o que não estava no orçamento. Dentro dela, lance cada item com o orçado (se houver) e o fechado.</p>
    </Modal>
  );
}

function NovaLinha({ categoria, aoFechar, aoCriar }: { categoria: string; aoFechar: () => void; aoCriar: (l: { nome: string; tipo: TipoLinha; orcado: Centavos }, fechado: Centavos | null, fornecedor: string) => void }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoLinha>('material');
  const [orcado, setOrcado] = useState<Centavos | null>(null);
  const [fechado, setFechado] = useState<Centavos | null>(null);
  const [forn, setForn] = useState('');
  const pode = nome.trim().length > 0;
  return (
    <Modal titulo={`Item em ${categoria}`} aoFechar={aoFechar}
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" disabled={!pode} onClick={() => aoCriar({ nome: nome.trim(), tipo, orcado: orcado ?? 0 }, fechado, forn.trim())}>Adicionar</button></>}>
      <div className="stack">
        <label className="campo">Item<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Rejunte epóxi, Suporte da condensadora" /></label>
        <div className="cmp-tipos" role="radiogroup" aria-label="Tipo">
          {(Object.keys(TIPO_LINHA) as TipoLinha[]).map((t) => <button key={t} type="button" role="radio" aria-checked={tipo === t} className={tipo === t ? 'ativo' : ''} onClick={() => setTipo(t)}>{TIPO_LINHA[t]}</button>)}
        </div>
        <div className="linha-valores">
          <label className="campo">Orçado<CampoValor valor={orcado} aoMudar={setOrcado} /></label>
          <label className="campo">Fechado<CampoValor valor={fechado} aoMudar={setFechado} /></label>
        </div>
        <label className="campo">Com quem<input list="cmp-nomes" value={forn} onChange={(e) => setForn(e.target.value)} placeholder="Profissional ou loja" /></label>
        <p className="muted small" style={{ margin: 0 }}>Sem orçado, o valor fechado conta inteiro como prejuízo da categoria: é custo que não estava previsto.</p>
      </div>
    </Modal>
  );
}
