import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { UNIDADES, type ModeloServico } from '../core/proposta';

const MODELO_PRECO: Record<ModeloServico['modelo_preco'], string> = {
  fixo: 'Valor fechado', por_unidade: 'Por unidade', area_complexidade: 'Por área × complexidade',
};

export function Biblioteca() {
  const [editando, setEditando] = useState<ModeloServico | 'novo' | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => ok(await supabase.from('modelo_servico').select('*').order('ordem').order('nome')) as ModeloServico[], []);
  const grupos = Array.from(new Set((dados ?? []).map((m) => m.grupo)));
  return (
    <>
      <Topo titulo="Biblioteca de serviços" sub="Seus serviços com textos e preços de referência. Cada proposta copia daqui e você ajusta caso a caso.">
        <Link className="btn-secundario" to="/propostas"><Icone nome="voltar" /> Propostas</Link>
        <button className="btn-primario" onClick={() => setEditando('novo')}><Icone nome="mais" /> Novo serviço</button>
      </Topo>
      <Erro mensagem={erro} />
      {carregando && !dados ? <Carregando /> : !dados?.length ? <Vazio titulo="Biblioteca vazia" /> : (
        <div className="stack">
          {dados.some((m) => m.ativo && !(Number(m.preco_base) > 0)) && (
            <div className="aviso"><Icone nome="alerta" /><span>Alguns serviços ainda estão sem preço base. Deixei em branco de propósito: só você sabe o seu preço. Preencha quando puder; até lá, informe o preço em cada proposta.</span></div>
          )}
          {grupos.map((g) => (
            <div key={g} className="card">
              <h2 style={{ marginBottom: 8 }}>{g}</h2>
              <div className="lista-cartoes" style={{ display: 'grid' }}>
                {dados.filter((m) => m.grupo === g).map((m) => (
                  <button key={m.id} className="item-cartao" style={{ textAlign: 'left', fontWeight: 400, opacity: m.ativo ? 1 : 0.55 }} onClick={() => setEditando(m)}>
                    <div>
                      <div className="titulo">{m.nome}{!m.ativo && ' (inativo)'}</div>
                      <div className="small muted">{MODELO_PRECO[m.modelo_preco]} · {UNIDADES[m.unidade] ?? m.unidade}</div>
                    </div>
                    <span className="num">{Number(m.preco_base) > 0 ? `${formatar(doBanco(m.preco_base))}/${UNIDADES[m.unidade] ?? m.unidade}` : <span className="muted small">sem preço</span>}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {editando && <ModeloForm modelo={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); recarregar(); }} />}
    </>
  );
}

const ln = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

function ModeloForm({ modelo, aoFechar, aoSalvar }: { modelo: ModeloServico | null; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const { podeFinanceiro } = useAuth();
  const m = modelo;
  const resp = (parte: string) => (m?.responsabilidades ?? []).find((r) => r.parte === parte)?.itens.join('\n') ?? '';
  const [f, setF] = useState({
    nome: m?.nome ?? '', grupo: m?.grupo ?? 'Projetos', unidade: m?.unidade ?? 'vb', modelo_preco: m?.modelo_preco ?? 'fixo',
    descricao_cliente: m?.descricao_cliente ?? '', palavras_chave: (m?.palavras_chave ?? []).join(', '),
    complexidade: (m?.complexidade ?? []).map((c) => `${c.nivel} | ${String(c.fator).replace('.', ',')} | ${c.descricao ?? ''}`).join('\n'),
    inclusoes: (m?.inclusoes ?? []).join('\n'), exclusoes: (m?.exclusoes ?? []).join('\n'), premissas: (m?.premissas ?? []).join('\n'),
    pontos_conferir: (m?.pontos_conferir ?? []).join('\n'), perguntas: (m?.perguntas ?? []).map((p) => p.texto).join('\n'),
    etapas: (m?.etapas ?? []).map((e) => `${e.nome} | ${e.percentual ?? ''}`).join('\n'),
    resp_rosae: resp('ROSAE'), resp_cliente: resp('Cliente'), resp_parceiro: resp('Parceiro'), ativo: m?.ativo ?? true,
  });
  const [preco, setPreco] = useState<Centavos | null>(m?.preco_base != null ? doBanco(m.preco_base) : null);
  const [custo, setCusto] = useState<Centavos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useConsulta(async () => {
    if (!podeFinanceiro || !m) return null;
    const r = ok(await supabase.from('modelo_servico_custo').select('custo_base').eq('modelo_id', m.id).maybeSingle()) as { custo_base: string | null } | null;
    if (r?.custo_base != null) setCusto(doBanco(r.custo_base));
    return r;
  }, [m?.id, podeFinanceiro]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const complexidade = ln(f.complexidade).map((l) => {
      const [nivel, fator, descricao] = l.split('|').map((x) => x.trim());
      return { nivel, fator: Number((fator || '1').replace(',', '.')) || 1, descricao: descricao || undefined };
    });
    if (f.modelo_preco === 'area_complexidade' && complexidade.length === 0) return setErro('Informe ao menos um nível de complexidade (ex.: Baixa | 1).');
    const reg = {
      nome: f.nome.trim(), grupo: f.grupo.trim() || 'Outros', unidade: f.unidade, modelo_preco: f.modelo_preco,
      preco_base: preco === null ? null : paraBanco(preco), descricao_cliente: f.descricao_cliente.trim() || null,
      palavras_chave: f.palavras_chave.split(',').map((x) => x.trim()).filter(Boolean), complexidade,
      inclusoes: ln(f.inclusoes), exclusoes: ln(f.exclusoes), premissas: ln(f.premissas), pontos_conferir: ln(f.pontos_conferir),
      perguntas: ln(f.perguntas).map((texto) => ({ texto })),
      etapas: ln(f.etapas).map((l) => { const [nome, pct] = l.split('|').map((x) => x.trim()); return { nome, percentual: pct ? Number(pct.replace(',', '.')) : undefined }; }),
      responsabilidades: [['ROSAE', f.resp_rosae], ['Cliente', f.resp_cliente], ['Parceiro', f.resp_parceiro]].filter(([, t]) => ln(t).length).map(([parte, t]) => ({ parte, itens: ln(t) })),
      ativo: f.ativo,
    };
    setSalvando(true);
    const r = m ? await supabase.from('modelo_servico').update(reg).eq('id', m.id).select('id').single() : await supabase.from('modelo_servico').insert(reg).select('id').single();
    if (!r.error && podeFinanceiro) {
      const c = await supabase.from('modelo_servico_custo').upsert({ modelo_id: (r.data as { id: string }).id, custo_base: custo === null ? null : paraBanco(custo) });
      if (c.error) { setSalvando(false); return setErro(mensagemErro(c.error)); }
    }
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    toast('Serviço salvo na biblioteca.');
    aoSalvar();
  }

  return (
    <Modal titulo={m ? m.nome : 'Novo serviço'} aoFechar={aoFechar} largo
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-modelo" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="form-modelo" className="stack" onSubmit={salvar}>
        <div className="grid grid-2">
          <label className="campo">Nome<input value={f.nome} onChange={(e) => set('nome', e.target.value)} required /></label>
          <label className="campo">Grupo<input value={f.grupo} onChange={(e) => set('grupo', e.target.value)} /></label>
        </div>
        <div className="grid grid-3">
          <label className="campo">Como cobra
            <select value={f.modelo_preco} onChange={(e) => set('modelo_preco', e.target.value as ModeloServico['modelo_preco'])}>
              {Object.entries(MODELO_PRECO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="campo">Unidade
            <select value={f.unidade} onChange={(e) => set('unidade', e.target.value)}>{Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="campo"><span>Preço base <Ajuda>Por unidade. Para “por área × complexidade”, é o preço do m² na complexidade de fator 1.</Ajuda></span><CampoValor valor={preco} aoMudar={setPreco} /></label>
        </div>
        {podeFinanceiro && (
          <label className="campo" style={{ maxWidth: 260 }}><span>Custo de referência (interno) <Ajuda>Só você vê. Ajuda a conferir a margem nas propostas.</Ajuda></span><CampoValor valor={custo} aoMudar={setCusto} /></label>
        )}
        {f.modelo_preco === 'area_complexidade' && (
          <label className="campo"><span>Níveis de complexidade <span className="muted small">(um por linha: nome | fator | descrição)</span></span><textarea rows={3} value={f.complexidade} onChange={(e) => set('complexidade', e.target.value)} placeholder={'Baixa | 1 | Térrea, vãos usuais\nAlta | 1,6 | Vãos grandes, subsolo'} /></label>
        )}
        <label className="campo">Descrição para o cliente<textarea rows={3} value={f.descricao_cliente} onChange={(e) => set('descricao_cliente', e.target.value)} /></label>
        <label className="campo"><span>Palavras que indicam este serviço <Ajuda>Separadas por vírgula. Usadas para sugerir o escopo a partir da mensagem do cliente.</Ajuda></span><input value={f.palavras_chave} onChange={(e) => set('palavras_chave', e.target.value)} /></label>
        <div className="grid grid-2">
          <label className="campo">Incluso (um por linha)<textarea rows={5} value={f.inclusoes} onChange={(e) => set('inclusoes', e.target.value)} /></label>
          <label className="campo">Não incluso (um por linha)<textarea rows={5} value={f.exclusoes} onChange={(e) => set('exclusoes', e.target.value)} /></label>
        </div>
        <div className="grid grid-3">
          <label className="campo">Responsabilidades da ROSAE<textarea rows={4} value={f.resp_rosae} onChange={(e) => set('resp_rosae', e.target.value)} /></label>
          <label className="campo">Do cliente<textarea rows={4} value={f.resp_cliente} onChange={(e) => set('resp_cliente', e.target.value)} /></label>
          <label className="campo">Das equipes parceiras<textarea rows={4} value={f.resp_parceiro} onChange={(e) => set('resp_parceiro', e.target.value)} /></label>
        </div>
        <div className="grid grid-2">
          <label className="campo"><span>Etapas <span className="muted small">(nome | % do valor)</span></span><textarea rows={4} value={f.etapas} onChange={(e) => set('etapas', e.target.value)} /></label>
          <label className="campo">Perguntas para o cliente (uma por linha)<textarea rows={4} value={f.perguntas} onChange={(e) => set('perguntas', e.target.value)} /></label>
        </div>
        <div className="grid grid-2">
          <label className="campo">Premissas (uma por linha)<textarea rows={3} value={f.premissas} onChange={(e) => set('premissas', e.target.value)} /></label>
          <label className="campo">Pontos para você conferir (internos)<textarea rows={3} value={f.pontos_conferir} onChange={(e) => set('pontos_conferir', e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Ativo (aparece nas propostas)</label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}
