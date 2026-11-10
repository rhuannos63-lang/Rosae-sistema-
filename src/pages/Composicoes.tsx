// Insumos e composições: a base de custos do orçamento (material, mão de obra e equipamento),
// com coeficientes por unidade de serviço e a metodologia de execução. Tudo editável.
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { CampoNumero } from '../components/OrcamentoGerador';
import { carregarBase, carregarCondicoes, proximoCodigo } from '../lib/composicoes';
import { gruposDe, type CondicaoObra } from '../core/condicoes';
import { custoUnitario, fatorMaoDeObra, precoNoPadrao, PADRAO, PADROES, TIPO_INSUMO, type Composicao, type Insumo, type Padrao, type TipoInsumo } from '../core/composicao';

const reais = (v: number, casas = 2) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 2) });
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Composicoes() {
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'insumos' ? 'insumos' : params.get('aba') === 'condicoes' ? 'condicoes' : 'composicoes';
  const base = useConsulta(carregarBase, []);
  return (
    <>
      <Topo titulo="Insumos e composições" sub="A base de custo dos serviços: material, a sua mão de obra e a dos profissionais, e equipamentos, com quanto cada serviço consome por unidade, em três padrões de acabamento. Os valores iniciais são estimativas médias do Rio de Janeiro no estilo SINAPI: confira e ajuste.">
        <Link className="btn-secundario" to="/propostas"><Icone nome="documento" /> Propostas</Link>
      </Topo>
      <div className="abas-obra">
        <button className={aba === 'composicoes' ? 'ativo' : ''} onClick={() => setParams({})}>Composições</button>
        <button className={aba === 'insumos' ? 'ativo' : ''} onClick={() => setParams({ aba: 'insumos' })}>Insumos e preços</button>
        <button className={aba === 'condicoes' ? 'ativo' : ''} onClick={() => setParams({ aba: 'condicoes' })}>Condições da obra</button>
      </div>
      {aba === 'condicoes' ? <Condicoes /> : base.carregando && !base.dados ? <Carregando /> : base.erro || !base.dados ? <Erro mensagem={base.erro ?? 'Erro ao carregar.'} /> : aba === 'insumos'
        ? <Insumos insumos={base.dados.insumos} recarregar={base.recarregar} />
        : <ListaComposicoes insumos={base.dados.insumos} composicoes={base.dados.composicoes} recarregar={base.recarregar} />}
    </>
  );
}

// ---------------------------------------------------------------------
// Condições da obra e logística
// ---------------------------------------------------------------------
type RascunhoCondicao = Omit<CondicaoObra, 'id'> & { id?: string };

function Condicoes() {
  const toast = useToast();
  const dados = useConsulta(carregarCondicoes, []);
  const [editar, setEditar] = useState<RascunhoCondicao | null>(null);
  if (dados.carregando && !dados.dados) return <Carregando />;
  if (dados.erro || !dados.dados) return <Erro mensagem={dados.erro ?? 'Erro ao carregar.'} />;
  const todas = dados.dados;
  const inativas = todas.filter((c) => c.ativo === false);
  async function salvarPct(c: CondicaoObra, campo: 'mao_de_obra_pct' | 'material_pct', v: number | null) {
    if (v === null || v < 0 || v > 200 || v === c[campo]) return;
    const { error } = await supabase.from('condicao_obra').update({ [campo]: v }).eq('id', c.id);
    if (error) return toast(mensagemErro(error));
    toast(`${c.nome}: +${v.toLocaleString('pt-BR')}% ${campo === 'material_pct' ? 'no material' : 'na mão de obra'}.`);
    dados.recarregar();
  }
  const nova = (): RascunhoCondicao => ({ codigo: proximoCodigo(todas.map((c) => c.codigo), 'CO'), grupo: 'Acesso e transporte de material', nome: '', descricao: '', mao_de_obra_pct: 5, material_pct: 0, ordem: 900, ativo: true });
  const linhas = (cs: CondicaoObra[]) => cs.map((c) => (
    <tr key={c.id} className={c.ativo === false ? 'muted' : ''}>
      <td><b>{c.nome}</b>{c.descricao && <div className="small muted">{c.descricao}</div>}</td>
      <td className="right" style={{ minWidth: 110 }}><PctCondicao valor={c.mao_de_obra_pct} aoSalvar={(v) => salvarPct(c, 'mao_de_obra_pct', v)} /></td>
      <td className="right" style={{ minWidth: 110 }}><PctCondicao valor={c.material_pct} aoSalvar={(v) => salvarPct(c, 'material_pct', v)} /></td>
      <td><button className="btn-link small" onClick={() => setEditar(c)}>Editar</button></td>
    </tr>
  ));
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="muted small" style={{ margin: 0, flex: '1 1 380px' }}>O que deixa a obra mais trabalhosa que o normal: subir material pela escada, terreno em aclive, condomínio com horário reduzido, imóvel ocupado, trabalho em altura. Você marca as condições no orçamento e na proposta; cada uma soma um percentual na mão de obra (menos produtividade, mais ajudantes) e no material (frete, transbordo, proteção). Os valores iniciais são estimativas para o Rio de Janeiro: ajuste à sua realidade.</p>
        <button className="btn-secundario" onClick={() => setEditar(nova())}><Icone nome="mais" /> Nova condição</button>
      </div>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Condição</th><th className="right">Mão de obra</th><th className="right">Material</th><th /></tr></thead>
          <tbody>
            {gruposDe(todas).map((g) => (
              <Fragment key={g.grupo}>
                <tr className="grupo"><td colSpan={4}><b>{g.grupo}</b></td></tr>
                {linhas(g.itens)}
              </Fragment>
            ))}
            {inativas.length > 0 && <><tr className="grupo"><td colSpan={4}><b>Desativadas</b></td></tr>{linhas(inativas)}</>}
          </tbody>
        </table>
      </div>
      {editar && <EditarCondicao inicial={editar} grupos={Array.from(new Set(todas.map((c) => c.grupo)))} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); dados.recarregar(); }} />}
    </div>
  );
}

function PctCondicao({ valor, aoSalvar }: { valor: number; aoSalvar: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(valor);
  return (
    <div className="campo-unidade preco-insumo" onBlur={() => aoSalvar(v)} onKeyDown={(e) => { if (e.key === 'Enter') aoSalvar(v); }}>
      <span>+</span><CampoNumero valor={v} aoMudar={setV} /><span>%</span>
    </div>
  );
}

function EditarCondicao({ inicial, grupos, aoFechar, aoSalvar }: { inicial: RascunhoCondicao; grupos: string[]; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof RascunhoCondicao>(k: K, v: RascunhoCondicao[K]) => setF({ ...f, [k]: v });
  async function salvar() {
    setErro(null);
    if (f.nome.trim().length < 3) return setErro('Informe o nome da condição.');
    const pcts = [f.mao_de_obra_pct, f.material_pct];
    if (pcts.some((x) => !(x >= 0 && x <= 200))) return setErro('Os percentuais vão de 0 a 200%.');
    const dados = { codigo: f.codigo.trim(), grupo: f.grupo.trim() || 'Geral', nome: f.nome.trim(), descricao: f.descricao?.trim() || null, mao_de_obra_pct: f.mao_de_obra_pct, material_pct: f.material_pct, ordem: f.ordem, ativo: f.ativo !== false };
    const { error } = f.id ? await supabase.from('condicao_obra').update(dados).eq('id', f.id) : await supabase.from('condicao_obra').insert(dados);
    if (error) return setErro(mensagemErro(error));
    aoSalvar();
  }
  return (
    <Modal titulo={f.id ? 'Editar condição' : 'Nova condição'} aoFechar={aoFechar} rodape={<><button className="btn-link" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar}>Salvar</button></>}>
      <div className="stack">
        <label className="campo">Nome<input value={f.nome} onChange={(e) => set('nome', e.target.value)} autoFocus placeholder="Ex.: Material pela escada (até 3 andares)" /></label>
        <label className="campo">O que significa <span className="dica">Aparece ao passar o mouse na hora de marcar</span><textarea rows={2} value={f.descricao ?? ''} onChange={(e) => set('descricao', e.target.value)} /></label>
        <div className="grid grid-2">
          <label className="campo">Acréscimo na mão de obra<div className="campo-unidade"><span>+</span><CampoNumero valor={f.mao_de_obra_pct} aoMudar={(v) => set('mao_de_obra_pct', v ?? 0)} /><span>%</span></div></label>
          <label className="campo">Acréscimo no material <span className="dica">Frete, transbordo, perdas e proteção</span><div className="campo-unidade"><span>+</span><CampoNumero valor={f.material_pct} aoMudar={(v) => set('material_pct', v ?? 0)} /><span>%</span></div></label>
          <label className="campo">Grupo<input list="grupos-condicao" value={f.grupo} onChange={(e) => set('grupo', e.target.value)} /><datalist id="grupos-condicao">{grupos.map((g) => <option key={g} value={g} />)}</datalist></label>
          <label className="campo">Código<input value={f.codigo} onChange={(e) => set('codigo', e.target.value)} /></label>
        </div>
        {f.id && <label className="row small"><input type="checkbox" checked={f.ativo !== false} onChange={(e) => set('ativo', e.target.checked)} /> Ativa (desmarque para esconder sem apagar)</label>}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------
type RascunhoInsumo = Omit<Insumo, 'id'> & { id?: string };

function Insumos({ insumos, recarregar }: { insumos: Insumo[]; recarregar: () => void }) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<TipoInsumo | ''>('');
  const [editar, setEditar] = useState<RascunhoInsumo | null>(null);
  const lista = insumos.filter((i) => (!tipo || i.tipo === tipo) && (!busca || sem(`${i.codigo} ${i.nome}`).includes(sem(busca))));
  const campo: Record<Padrao, 'preco_basico' | 'preco' | 'preco_premium'> = { basico: 'preco_basico', medio: 'preco', premium: 'preco_premium' };
  async function salvarPreco(i: Insumo, p: Padrao, preco: number | null) {
    if (preco === null || preco < 0 || preco === i[campo[p]]) return;
    const { error } = await supabase.from('insumo').update({ [campo[p]]: preco }).eq('id', i.id);
    if (error) return toast(mensagemErro(error));
    toast(`${i.nome} (${PADRAO[p].toLowerCase()}): ${reais(preco)} por ${i.unidade}.`);
    recarregar();
  }
  const novo = (t: TipoInsumo): RascunhoInsumo => ({
    codigo: proximoCodigo(insumos.map((i) => i.codigo), t === 'material' ? 'MAT' : t === 'mao_de_obra' ? 'MO' : 'EQ'),
    nome: '', tipo: t, unidade: t === 'mao_de_obra' ? 'h' : 'un', preco: 0, preco_basico: 0, preco_premium: 0, compra_unidade: null, compra_fator: null, ativo: true,
  });
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Buscar insumo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar insumo" style={{ maxWidth: 280 }} />
        <div className="segmentado">
          <button type="button" className={tipo === '' ? 'ativo' : ''} onClick={() => setTipo('')}>Todos</button>
          {(Object.keys(TIPO_INSUMO) as TipoInsumo[]).map((t) => <button key={t} type="button" className={tipo === t ? 'ativo' : ''} onClick={() => setTipo(t)}>{TIPO_INSUMO[t]}</button>)}
        </div>
        <span className="spacer" />
        <button className="btn-secundario" onClick={() => setEditar(novo(tipo || 'material'))}><Icone nome="mais" /> Novo insumo</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Preço em três padrões de acabamento. Material comum (cimento, areia, aço, concreto) custa igual nos três; acabamentos e mão de obra especializada mudam. Mão de obra por hora, com encargos; a sua hora técnica está em <b>Engenheiro civil</b>. Mude o preço direto na tabela.</p>
      {lista.length === 0 ? <Vazio titulo="Nenhum insumo encontrado" /> : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Código</th><th>Insumo</th><th>Tipo</th><th>Unid.</th>{PADROES.map((p) => <th key={p} className="right">{PADRAO[p]}</th>)}<th>Compra em</th><th /></tr></thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} className={i.ativo === false ? 'muted' : ''}>
                  <td className="small muted">{i.codigo}</td>
                  <td>{i.nome}</td>
                  <td className="small">{TIPO_INSUMO[i.tipo]}</td>
                  <td className="small">{i.unidade}</td>
                  {PADROES.map((p) => <td key={p} className="right" style={{ minWidth: 110 }}><PrecoInsumo valor={i[campo[p]]} aoSalvar={(v) => salvarPreco(i, p, v)} /></td>)}
                  <td className="small muted">{i.compra_unidade ?? '—'}</td>
                  <td><button className="btn-link small" onClick={() => setEditar(i)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <EditarInsumo inicial={editar} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); recarregar(); }} />}
    </div>
  );
}

function PrecoInsumo({ valor, aoSalvar }: { valor: number; aoSalvar: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(valor);
  return (
    <div className="campo-unidade preco-insumo" onBlur={() => aoSalvar(v)} onKeyDown={(e) => { if (e.key === 'Enter') aoSalvar(v); }}>
      <span>R$</span><CampoNumero valor={v} aoMudar={setV} />
    </div>
  );
}

function EditarInsumo({ inicial, aoFechar, aoSalvar }: { inicial: RascunhoInsumo; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof RascunhoInsumo>(k: K, v: RascunhoInsumo[K]) => setF({ ...f, [k]: v });
  async function salvar() {
    setErro(null);
    if (f.nome.trim().length < 2) return setErro('Informe o nome do insumo.');
    const dados = { codigo: f.codigo.trim(), nome: f.nome.trim(), tipo: f.tipo, unidade: f.unidade.trim() || 'un', preco: f.preco || 0, preco_basico: f.preco_basico || f.preco || 0, preco_premium: f.preco_premium || f.preco || 0, compra_unidade: f.compra_unidade?.trim() || null, compra_fator: f.compra_unidade?.trim() && f.compra_fator ? f.compra_fator : null, ativo: f.ativo !== false };
    const { error } = f.id ? await supabase.from('insumo').update(dados).eq('id', f.id) : await supabase.from('insumo').insert(dados);
    if (error) return setErro(mensagemErro(error));
    aoSalvar();
  }
  return (
    <Modal titulo={f.id ? 'Editar insumo' : 'Novo insumo'} aoFechar={aoFechar} rodape={<><button className="btn-link" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar}>Salvar</button></>}>
      <div className="stack">
        <div className="grid grid-2">
          <label className="campo">Nome<input value={f.nome} onChange={(e) => set('nome', e.target.value)} autoFocus placeholder="Ex.: Pedreiro (com encargos)" /></label>
          <label className="campo">Tipo
            <select value={f.tipo} onChange={(e) => set('tipo', e.target.value as TipoInsumo)}>{(Object.keys(TIPO_INSUMO) as TipoInsumo[]).map((t) => <option key={t} value={t}>{TIPO_INSUMO[t]}</option>)}</select>
          </label>
          <label className="campo">Unidade<input value={f.unidade} onChange={(e) => set('unidade', e.target.value)} placeholder="kg, m², m³, un, h" /></label>
          <label className="campo">Preço · padrão básico<div className="campo-unidade"><span>R$</span><CampoNumero valor={f.preco_basico} aoMudar={(v) => set('preco_basico', v ?? 0)} /></div></label>
          <label className="campo">Preço · padrão médio<div className="campo-unidade"><span>R$</span><CampoNumero valor={f.preco} aoMudar={(v) => set('preco', v ?? 0)} /></div></label>
          <label className="campo">Preço · padrão premium<div className="campo-unidade"><span>R$</span><CampoNumero valor={f.preco_premium} aoMudar={(v) => set('preco_premium', v ?? 0)} /></div></label>
          {f.tipo === 'material' && <>
            <label className="campo">Embalagem de compra <span className="dica">Opcional: saco 50 kg, galão 3,6 L, barra 6 m</span><input value={f.compra_unidade ?? ''} onChange={(e) => set('compra_unidade', e.target.value)} /></label>
            <label className="campo">Quanto vem na embalagem <span className="dica">Em {f.unidade || 'unidades'}</span><CampoNumero valor={f.compra_fator} aoMudar={(v) => set('compra_fator', v)} /></label>
          </>}
          <label className="campo">Código<input value={f.codigo} onChange={(e) => set('codigo', e.target.value)} /></label>
        </div>
        {f.id && <label className="row small"><input type="checkbox" checked={f.ativo !== false} onChange={(e) => set('ativo', e.target.checked)} /> Ativo (desmarque para esconder sem apagar)</label>}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Composições
// ---------------------------------------------------------------------
function ListaComposicoes({ insumos, composicoes, recarregar }: { insumos: Insumo[]; composicoes: Composicao[]; recarregar: () => void }) {
  const [busca, setBusca] = useState('');
  const [editar, setEditar] = useState<Composicao | null>(null);
  const porIns = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  const lista = composicoes.filter((c) => !busca || sem(`${c.codigo} ${c.nome} ${c.grupo} ${c.palavras_chave.join(' ')}`).includes(sem(busca)));
  const grupos = Array.from(new Set(lista.map((c) => c.grupo)));
  const nova = (): Composicao => ({ id: '', codigo: proximoCodigo(composicoes.map((c) => c.codigo), 'CP'), nome: '', unidade: 'm²', grupo: 'Geral', metodologia: '', palavras_chave: [], itens: [], varia_padrao: true, fator_mo_basico: 0.9, fator_mo_premium: 1.25 });
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Buscar composição" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar composição" style={{ maxWidth: 280 }} />
        <span className="spacer" />
        <button className="btn-secundario" onClick={() => setEditar(nova())}><Icone nome="mais" /> Nova composição</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Cada composição diz quanto de cada insumo um serviço consome por unidade (por exemplo, 1 m² de alvenaria), com o custo nos padrões básico, médio e premium. Na proposta, em <b>Custos internos</b>, você liga os itens às composições e o sistema calcula material, mão de obra, preço com BDI e, quando a obra for aceita, a lista de compras.</p>
      {grupos.length === 0 && <Vazio titulo="Nenhuma composição encontrada" />}
      {grupos.map((g) => (
        <div className="card" key={g}>
          <h2 style={{ marginBottom: 8 }}>{g}</h2>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Código</th><th>Serviço</th><th>Unid.</th>{PADROES.map((p) => <th key={p} className="right">{PADRAO[p]}</th>)}<th /></tr></thead>
              <tbody>
                {lista.filter((c) => c.grupo === g).map((c) => {
                  return (
                    <tr key={c.id} className={c.ativo === false ? 'muted' : ''}>
                      <td className="small muted">{c.codigo}</td>
                      <td>{c.nome}{!c.varia_padrao && <span className="dica"> · igual nos três padrões</span>}</td>
                      <td className="small">{c.unidade}</td>
                      {PADROES.map((p) => {
                        const k = custoUnitario(c, porIns, p);
                        return <td key={p} className="right num" title={`Material ${reais(k.material)} · mão de obra ${reais(k.mao_de_obra + k.equipamento)}`}>{p === 'medio' ? <b>{reais(k.total)}</b> : reais(k.total)}</td>;
                      })}
                      <td><button className="btn-link small" onClick={() => setEditar(c)}>Abrir</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {editar && <EditarComposicao inicial={editar} insumos={insumos} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); recarregar(); }} />}
    </div>
  );
}

function EditarComposicao({ inicial, insumos, aoFechar, aoSalvar }: { inicial: Composicao; insumos: Insumo[]; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(inicial);
  const [palavras, setPalavras] = useState(inicial.palavras_chave.join(', '));
  const [novoIns, setNovoIns] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const porIns = new Map(insumos.map((i) => [i.id, i]));
  const [padrao, setPadrao] = useState<Padrao>('medio');
  const p = custoUnitario(f, porIns, padrao);
  const set = <K extends keyof Composicao>(k: K, v: Composicao[K]) => setF({ ...f, [k]: v });
  async function salvar(copia = false) {
    setErro(null);
    if (f.nome.trim().length < 3) return setErro('Informe o nome do serviço.');
    const itens = f.itens.filter((x) => x.coeficiente > 0);
    if (!itens.length) return setErro('Inclua pelo menos um insumo com quantidade.');
    setSalvando(true);
    try {
      const dados = { codigo: f.codigo.trim(), nome: f.nome.trim(), unidade: f.unidade.trim() || 'un', grupo: f.grupo.trim() || 'Geral', metodologia: f.metodologia?.trim() || null, palavras_chave: palavras.split(',').map((x) => x.trim()).filter(Boolean), ativo: f.ativo !== false, varia_padrao: f.varia_padrao, fator_mo_basico: f.fator_mo_basico || 1, fator_mo_premium: f.fator_mo_premium || 1 };
      let id = f.id;
      if (id && !copia) {
        const r = await supabase.from('composicao').update(dados).eq('id', id);
        if (r.error) throw r.error;
        const d = await supabase.from('composicao_item').delete().eq('composicao_id', id);
        if (d.error) throw d.error;
      } else {
        const r = await supabase.from('composicao').insert(copia ? { ...dados, codigo: `${dados.codigo}-C`, nome: `${dados.nome} (cópia)` } : dados).select('id').single();
        if (r.error) throw r.error;
        id = (r.data as { id: string }).id;
      }
      const ins = await supabase.from('composicao_item').insert(itens.map((x) => ({ composicao_id: id, insumo_id: x.insumo_id, coeficiente: x.coeficiente })));
      if (ins.error) throw ins.error;
      toast(copia ? 'Cópia criada. Ajuste o que for diferente.' : 'Composição salva.');
      aoSalvar();
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }
  const disponiveis = insumos.filter((i) => i.ativo !== false && !f.itens.some((x) => x.insumo_id === i.id));
  return (
    <Modal largo titulo={f.id ? f.nome : 'Nova composição'} aoFechar={aoFechar}
      rodape={<>
        {f.id && <button className="btn-link" onClick={() => salvar(true)} disabled={salvando}>Duplicar</button>}
        <span className="spacer" />
        <button className="btn-link" onClick={aoFechar}>Cancelar</button>
        <button className="btn-primario" onClick={() => salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="stack">
        <div className="grid grid-2">
          <label className="campo">Serviço<input value={f.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Piso em porcelanato 60x60 assentado" /></label>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="campo">Unidade<input value={f.unidade} onChange={(e) => set('unidade', e.target.value)} /></label>
            <label className="campo">Grupo<input value={f.grupo} onChange={(e) => set('grupo', e.target.value)} /></label>
          </div>
        </div>
        <label className="campo">Metodologia e execução <span className="dica">Como o serviço é feito, na ordem. Vai junto na lista de compras e no planejamento.</span>
          <textarea rows={3} value={f.metodologia ?? ''} onChange={(e) => set('metodologia', e.target.value)} />
        </label>
        <label className="campo">Palavras que ligam o serviço da proposta a esta composição <span className="dica">Separadas por vírgula</span>
          <input value={palavras} onChange={(e) => setPalavras(e.target.value)} placeholder="porcelanato, piso, revestimento de piso" />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <label className="row small"><input type="checkbox" checked={f.varia_padrao} onChange={(e) => set('varia_padrao', e.target.checked)} /> Serviço de acabamento: o padrão (básico, médio, premium) muda preços e tempo de mão de obra</label>
          {f.varia_padrao && (
            <div className="grid grid-2">
              <label className="campo">Tempo de mão de obra no básico <span className="dica">1 = igual ao médio; 0,9 = 10% mais rápido</span><CampoNumero valor={f.fator_mo_basico} aoMudar={(v) => set('fator_mo_basico', v ?? 1)} /></label>
              <label className="campo">Tempo de mão de obra no premium <span className="dica">1,25 = 25% mais cuidado e tempo</span><CampoNumero valor={f.fator_mo_premium} aoMudar={(v) => set('fator_mo_premium', v ?? 1)} /></label>
            </div>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3>Insumos por {f.unidade || 'unidade'}</h3>
          {f.varia_padrao && <div className="segmentado">{PADROES.map((x) => <button key={x} type="button" className={padrao === x ? 'ativo' : ''} onClick={() => setPadrao(x)}>{PADRAO[x]}</button>)}</div>}
        </div>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Insumo</th><th>Tipo</th><th style={{ width: 150 }}>Quantidade</th><th className="right">Preço</th><th className="right">Custo</th><th /></tr></thead>
            <tbody>
              {f.itens.map((x, k) => {
                const i = porIns.get(x.insumo_id);
                return (
                  <tr key={x.insumo_id}>
                    <td>{i?.nome ?? 'Insumo removido'}</td>
                    <td className="small">{i ? TIPO_INSUMO[i.tipo] : ''}</td>
                    <td><div className="campo-unidade"><CampoNumero valor={x.coeficiente} aoMudar={(v) => set('itens', f.itens.map((y, j) => (j === k ? { ...y, coeficiente: v ?? 0 } : y)))} /><span>{i?.unidade}</span></div></td>
                    <td className="right num small">{i ? reais(precoNoPadrao(i, f.varia_padrao ? padrao : 'medio')) : '—'}</td>
                    <td className="right num">{i ? reais(x.coeficiente * (i.tipo === 'mao_de_obra' ? fatorMaoDeObra(f, padrao) : 1) * precoNoPadrao(i, f.varia_padrao ? padrao : 'medio')) : '—'}</td>
                    <td><button className="btn-link" aria-label="Tirar insumo" onClick={() => set('itens', f.itens.filter((_, j) => j !== k))}><Icone nome="fechar" /></button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Material</td><td className="right num">{reais(p.material)}</td><td /></tr>
              <tr><td colSpan={4}>Mão de obra e equipamento</td><td className="right num">{reais(p.mao_de_obra + p.equipamento)}</td><td /></tr>
              <tr className="total"><td colSpan={4}>Custo por {f.unidade || 'unidade'}{f.varia_padrao ? ` · padrão ${PADRAO[padrao].toLowerCase()}` : ''}</td><td className="right num">{reais(p.total)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select value={novoIns} onChange={(e) => setNovoIns(e.target.value)} aria-label="Insumo para incluir" style={{ maxWidth: 360 }}>
            <option value="">Incluir insumo…</option>
            {(Object.keys(TIPO_INSUMO) as TipoInsumo[]).map((t) => (
              <optgroup key={t} label={TIPO_INSUMO[t]}>{disponiveis.filter((i) => i.tipo === t).map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade})</option>)}</optgroup>
            ))}
          </select>
          <button className="btn-secundario" disabled={!novoIns} onClick={() => { set('itens', [...f.itens, { insumo_id: novoIns, coeficiente: 1 }]); setNovoIns(''); }}><Icone nome="mais" /> Incluir</button>
          <Link className="btn-link small" to="/orcamento/composicoes?aba=insumos" onClick={aoFechar}>Cadastrar insumo novo</Link>
        </div>
        {f.id && <label className="row small"><input type="checkbox" checked={f.ativo !== false} onChange={(e) => set('ativo', e.target.checked)} /> Ativa (desmarque para esconder sem apagar)</label>}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}
