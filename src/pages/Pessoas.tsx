import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import type { Pessoa } from '../lib/tipos';
import { useAuth } from '../auth/AuthProvider';
import { HistoricoParceiro } from './ObraFinanceiro';

type Filtro = 'todos' | 'cliente' | 'prestador' | 'fornecedor' | 'arquivados';

function papeis(p: Pessoa): string[] {
  return [p.eh_cliente && 'Cliente', p.eh_prestador && 'Parceiro/prestador', p.eh_fornecedor && 'Fornecedor'].filter(Boolean) as string[];
}

export function Pessoas() {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [params] = useSearchParams();
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  useEffect(() => { const b = params.get('busca'); if (b !== null) setBusca(b); }, [params]);
  const [editando, setEditando] = useState<Pessoa | 'nova' | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(
    async () => ok(await supabase.from('pessoa').select('*').order('nome')) as Pessoa[],
    [],
  );

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (dados ?? []).filter((p) => {
      if (filtro === 'arquivados') { if (!p.arquivado) return false; } else if (p.arquivado) return false;
      if (filtro === 'cliente' && !p.eh_cliente) return false;
      if (filtro === 'prestador' && !p.eh_prestador) return false;
      if (filtro === 'fornecedor' && !p.eh_fornecedor) return false;
      if (!b) return true;
      return [p.nome, p.email, p.telefone, p.documento, p.codigo, p.especialidade].some((v) => v?.toLowerCase().includes(b));
    });
  }, [dados, filtro, busca]);

  return (
    <>
      <Topo titulo="Cadastros" sub="Clientes, parceiros e fornecedores em um só lugar. Uma pessoa pode ter vários papéis.">
        <button className="btn-primario" onClick={() => setEditando('nova')}>
          <Icone nome="mais" /> Nova pessoa
        </button>
      </Topo>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmentado" role="group" aria-label="Filtrar">
            {(['todos', 'cliente', 'prestador', 'fornecedor', 'arquivados'] as Filtro[]).map((f) => (
              <button key={f} className={filtro === f ? 'ativo' : ''} onClick={() => setFiltro(f)}>
                {{ todos: 'Todos', cliente: 'Clientes', prestador: 'Parceiros', fornecedor: 'Fornecedores', arquivados: 'Arquivados' }[f]}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <input placeholder="Buscar por nome, telefone, e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }} />
        </div>
        <Erro mensagem={erro} />
        {carregando && !dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio titulo="Nenhum cadastro aqui ainda">
            <p>Cadastre clientes, parceiros de campo e fornecedores. Eles aparecem depois nas obras e nas contas.</p>
          </Vazio>
        ) : (
          <>
            <div className="tabela-wrap so-desktop">
              <table className="tabela">
                <thead>
                  <tr><th>Nome</th><th>Papéis</th><th>Telefone</th><th>E-mail</th><th>Código</th></tr>
                </thead>
                <tbody>
                  {lista.map((p) => (
                    <tr key={p.id} className="clicavel" onClick={() => setEditando(p)}>
                      <td><b>{p.nome}</b>{p.especialidade && <div className="muted small">{p.especialidade}</div>}</td>
                      <td>{papeis(p).map((r) => <span key={r} className="selo" style={{ marginRight: 4 }}>{r}</span>)}</td>
                      <td className="num">{p.telefone}</td>
                      <td>{p.email}</td>
                      <td className="muted small">{p.codigo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lista-cartoes">
              {lista.map((p) => (
                <button key={p.id} className="item-cartao" style={{ textAlign: 'left', fontWeight: 400 }} onClick={() => setEditando(p)}>
                  <div>
                    <div className="titulo">{p.nome}</div>
                    <div className="muted small">{papeis(p).join(' · ')}{p.telefone ? ` · ${p.telefone}` : ''}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {editando && (
        <PessoaForm
          pessoa={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => { setEditando(null); recarregar(); }}
        />
      )}
    </>
  );
}

const vazia = {
  tipo_pessoa: 'fisica' as 'fisica' | 'juridica', nome: '', documento: '', telefone: '', email: '', eh_cliente: true, eh_fornecedor: false,
  eh_prestador: false, especialidade: '', chave_pix: '', endereco: '', observacoes: '', arquivado: false,
};

export function PessoaForm({ pessoa, aoFechar, aoSalvar, padrao }: { pessoa: Pessoa | null; aoFechar: () => void; aoSalvar: (p: Pessoa) => void; padrao?: Partial<typeof vazia> }) {
  const toast = useToast();
  const { podeFinanceiro } = useAuth();
  const [f, setF] = useState(() => (pessoa ? { ...vazia, ...Object.fromEntries(Object.entries(pessoa).map(([k, v]) => [k, v ?? ''])) } : { ...vazia, ...padrao }) as typeof vazia);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [semelhantes, setSemelhantes] = useState<Pessoa[]>([]);
  const set = <K extends keyof typeof vazia>(k: K, v: (typeof vazia)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!f.email && !f.telefone && !f.documento) return setSemelhantes([]);
      const { data } = await supabase.rpc('pessoas_semelhantes', { p_email: f.email, p_telefone: f.telefone, p_documento: f.documento, p_ignorar: pessoa?.id ?? null });
      setSemelhantes((data as Pessoa[]) ?? []);
    }, 400);
    return () => clearTimeout(t);
  }, [f.email, f.telefone, f.documento, pessoa?.id]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.eh_cliente && !f.eh_prestador && !f.eh_fornecedor) return setErro('Marque ao menos um papel.');
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErro('E-mail com formato inválido.');
    setSalvando(true);
    const limpo = Object.fromEntries(
      (Object.keys(vazia) as (keyof typeof vazia)[]).map((k) => [k, typeof f[k] === 'string' ? (f[k] as string).trim() || null : f[k]]),
    );
    limpo.nome = f.nome.trim();
    const r = pessoa
      ? await supabase.from('pessoa').update(limpo).eq('id', pessoa.id).select().single()
      : await supabase.from('pessoa').insert(limpo).select().single();
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(pessoa ? 'Cadastro atualizado.' : 'Pessoa cadastrada.');
    aoSalvar(r.data as Pessoa);
  }

  return (
    <Modal
      titulo={pessoa ? pessoa.nome : 'Nova pessoa'}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button>
          <button className="btn-primario" form="form-pessoa" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <form id="form-pessoa" className="stack" onSubmit={salvar}>
        <label className="campo">
          Nome
          <input value={f.nome} onChange={(e) => set('nome', e.target.value)} required autoFocus />
        </label>
        <fieldset>
          <legend>Papéis</legend>
          <div className="row" style={{ gap: 18 }}>
            <label className="check"><input type="checkbox" checked={f.eh_cliente} onChange={(e) => set('eh_cliente', e.target.checked)} /> Cliente</label>
            <label className="check"><input type="checkbox" checked={f.eh_prestador} onChange={(e) => set('eh_prestador', e.target.checked)} /> Parceiro/prestador</label>
            <label className="check"><input type="checkbox" checked={f.eh_fornecedor} onChange={(e) => set('eh_fornecedor', e.target.checked)} /> Fornecedor</label>
          </div>
        </fieldset>
        <div className="grid grid-2">
          <label className="campo">
            Telefone / WhatsApp
            <input type="tel" value={f.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(21) 9…" />
          </label>
          <label className="campo">
            E-mail
            <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </label>
        </div>
        {semelhantes.length > 0 && (
          <div className="aviso">
            <Icone nome="alerta" />
            <span>
              Possível cadastro repetido: {semelhantes.map((s) => `${s.nome} (${s.codigo})`).join(', ')}. Confira antes de salvar para não duplicar.
            </span>
          </div>
        )}
        {pessoa && f.eh_prestador && podeFinanceiro && <HistoricoParceiro pessoaId={pessoa.id} />}
        {f.eh_prestador && (
          <label className="campo">
            Especialidade
            <input value={f.especialidade} onChange={(e) => set('especialidade', e.target.value)} placeholder="Pedreiro, eletricista, serralheiro…" />
          </label>
        )}
        <details className="avancado" open={Boolean(pessoa && (pessoa.documento || pessoa.endereco || pessoa.chave_pix || pessoa.observacoes))}>
          <summary>Mais dados</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="grid grid-2">
              <label className="campo">
                Tipo
                <select value={f.tipo_pessoa} onChange={(e) => set('tipo_pessoa', e.target.value as 'fisica' | 'juridica')}>
                  <option value="fisica">Pessoa física</option>
                  <option value="juridica">Empresa</option>
                </select>
              </label>
              <label className="campo">
                {f.tipo_pessoa === 'juridica' ? 'CNPJ' : 'CPF'}
                <input value={f.documento} onChange={(e) => set('documento', e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <label className="campo">
              Endereço
              <input value={f.endereco} onChange={(e) => set('endereco', e.target.value)} />
            </label>
            <label className="campo">
              Chave PIX
              <input value={f.chave_pix} onChange={(e) => set('chave_pix', e.target.value)} />
            </label>
            <label className="campo">
              Observações
              <textarea value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
            </label>
            {pessoa && (
              <label className="check">
                <input type="checkbox" checked={f.arquivado} onChange={(e) => set('arquivado', e.target.checked)} /> Arquivar (some das listas, histórico preservado)
              </label>
            )}
          </div>
        </details>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}
