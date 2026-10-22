import { useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Erro, Modal, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarDataHora, hoje } from '../core/datas';
import { baixarArquivo, paraCsv } from '../core/exportar';
import type { Categoria, ContaBancaria, Empresa, Usuario } from '../lib/tipos';

type Aba = 'empresa' | 'metas' | 'contas' | 'categorias' | 'usuarios' | 'dados' | 'historico';

export function Configuracoes() {
  const [aba, setAba] = useState<Aba>('empresa');
  const abas: Record<Aba, string> = { empresa: 'Empresa', metas: 'Metas', contas: 'Contas bancárias', categorias: 'Categorias', usuarios: 'Usuários', dados: 'Exportar e backup', historico: 'Histórico' };
  return (
    <>
      <Topo titulo="Configurações" sub="Dados reais da empresa, metas, contas e segurança." />
      <div className="segmentado" style={{ flexWrap: 'wrap', marginBottom: 16 }} role="tablist">
        {(Object.keys(abas) as Aba[]).map((a) => (
          <button key={a} role="tab" aria-selected={aba === a} className={aba === a ? 'ativo' : ''} onClick={() => setAba(a)}>{abas[a]}</button>
        ))}
      </div>
      {aba === 'empresa' && <AbaEmpresa />}
      {aba === 'metas' && <AbaMetas />}
      {aba === 'contas' && <AbaContas />}
      {aba === 'categorias' && <AbaCategorias />}
      {aba === 'usuarios' && <AbaUsuarios />}
      {aba === 'dados' && <AbaDados />}
      {aba === 'historico' && <AbaHistorico />}
    </>
  );
}

function useEmpresa() {
  return useConsulta(async () => ok(await supabase.from('empresa').select('*').single()) as Empresa, []);
}

function AbaEmpresa() {
  const { dados, erro, carregando, recarregar } = useEmpresa();
  if (carregando && !dados) return <Carregando />;
  if (!dados) return <Erro mensagem={erro} />;
  return <FormEmpresa empresa={dados} aoSalvar={recarregar} />;
}

function FormEmpresa({ empresa, aoSalvar }: { empresa: Empresa; aoSalvar: () => void }) {
  const toast = useToast();
  const campos = ['nome_fantasia', 'razao_social', 'cnpj', 'data_inicio_cnpj', 'responsavel_tecnico', 'registro_profissional', 'endereco', 'telefone', 'email', 'site', 'instagram', 'frase_institucional'] as const;
  type Campo = (typeof campos)[number];
  const [f, setF] = useState<Record<Campo, string>>(() => Object.fromEntries(campos.map((c) => [c, (empresa[c] as string | null) ?? ''])) as Record<Campo, string>);
  const [conferido, setConferido] = useState(empresa.registro_conferido);
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: Campo, v: string) => setF((x) => ({ ...x, [k]: v }));
  const registroMudou = f.registro_profissional.trim() !== (empresa.registro_profissional ?? '');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const dados: Record<string, string | boolean | null> = Object.fromEntries(campos.map((c) => [c, f[c].trim() || null]));
    dados.nome_fantasia = f.nome_fantasia.trim() || 'ROSAE Engenharia & Estruturas';
    dados.responsavel_tecnico = f.responsavel_tecnico.trim() || 'Eng. Rhuann Rosa';
    // Se o número mudou, o banco zera a conferência; a nova conferência é um segundo passo consciente.
    dados.registro_conferido = registroMudou ? false : conferido;
    const { error } = await supabase.from('empresa').update(dados).eq('id', empresa.id);
    if (error) return setErro(mensagemErro(error));
    toast('Dados da empresa salvos.');
    aoSalvar();
  }

  const C = ({ k, rotulo, dica, tipo }: { k: Campo; rotulo: string; dica?: string; tipo?: string }) => (
    <label className="campo">
      {rotulo}
      {dica && <span className="dica">{dica}</span>}
      <input type={tipo ?? 'text'} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={f[k] ? undefined : 'a preencher'} />
    </label>
  );

  return (
    <form className="card stack" onSubmit={salvar}>
      <div className="aviso info"><span>Nada aqui é inventado: o que estiver vazio aparece como "a preencher" nos documentos até você informar o dado real.</span></div>
      <div className="grid grid-2">
        {C({ k: 'nome_fantasia', rotulo: 'Nome' })}
        {C({ k: 'razao_social', rotulo: 'Razão social' })}
        {C({ k: 'cnpj', rotulo: 'CNPJ', dica: 'Quando a ME estiver aberta' })}
        {C({ k: 'data_inicio_cnpj', rotulo: 'Início das atividades do CNPJ', tipo: 'date', dica: 'Antes desta data, lançamentos contam como período pessoa física' })}
        {C({ k: 'responsavel_tecnico', rotulo: 'Responsável técnico' })}
        <label className="campo">
          Registro profissional
          <span className="dica">Conferir antes de aparecer em documento oficial</span>
          <input value={f.registro_profissional} onChange={(e) => set('registro_profissional', e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend>Conferência do registro</legend>
        {registroMudou ? (
          <p className="muted small" style={{ margin: 0 }}>Você alterou o número. Salve e depois confirme a conferência.</p>
        ) : (
          <label className="check">
            <input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
            Conferi o número "{empresa.registro_profissional}" no documento do CREA e ele pode ir para documentos oficiais.
          </label>
        )}
        {empresa.registro_conferido && empresa.registro_conferido_em && <p className="muted small" style={{ margin: '6px 0 0' }}>Conferido em {formatarDataHora(empresa.registro_conferido_em)}.</p>}
      </fieldset>
      <div className="grid grid-2">
        {C({ k: 'endereco', rotulo: 'Endereço' })}
        {C({ k: 'telefone', rotulo: 'Telefone / WhatsApp' })}
        {C({ k: 'email', rotulo: 'E-mail comercial', tipo: 'email' })}
        {C({ k: 'site', rotulo: 'Site' })}
        {C({ k: 'instagram', rotulo: 'Instagram' })}
        {C({ k: 'frase_institucional', rotulo: 'Frase institucional' })}
      </div>
      <fieldset>
        <legend>Logotipo</legend>
        <div className="row" style={{ gap: 20 }}>
          <img src="/marca/rosae-logo-horizontal.svg" alt="Logo horizontal" style={{ height: 56 }} />
          <img src="/marca/rosae-logo-vertical.svg" alt="Logo vertical" style={{ height: 90 }} />
          <span className="muted small">Versão vetorial redesenhada a partir do original. Arquivos em /marca.</span>
        </div>
      </fieldset>
      <Erro mensagem={erro} />
      <div className="row"><button className="btn-primario">Salvar</button></div>
    </form>
  );
}

function AbaMetas() {
  const toast = useToast();
  const { dados, carregando, recarregar } = useEmpresa();
  const [rec, setRec] = useState<Centavos | null | undefined>(undefined);
  const [ven, setVen] = useState<Centavos | null | undefined>(undefined);
  const [imp, setImp] = useState<string | undefined>(undefined);
  const [res, setRes] = useState<string | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  if (carregando && !dados) return <Carregando />;
  if (!dados) return null;
  const vRec = rec === undefined ? (dados.meta_recebimentos_mensal === null ? null : doBanco(dados.meta_recebimentos_mensal)) : rec;
  const vVen = ven === undefined ? (dados.meta_vendas_mensal === null ? null : doBanco(dados.meta_vendas_mensal)) : ven;
  const vImp = imp ?? (dados.provisao_impostos_pct === null ? '' : String(dados.provisao_impostos_pct));
  const vRes = res ?? (dados.reserva_pct === null ? '' : String(dados.reserva_pct));
  const pct = (s: string) => (s.trim() === '' ? null : s.replace(',', '.'));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('empresa').update({
      meta_recebimentos_mensal: vRec === null ? null : paraBanco(vRec), meta_vendas_mensal: vVen === null ? null : paraBanco(vVen),
      provisao_impostos_pct: pct(vImp), reserva_pct: pct(vRes),
    }).eq('id', dados!.id);
    if (error) return setErro(mensagemErro(error));
    toast('Metas salvas.');
    recarregar();
  }
  return (
    <form className="card stack" onSubmit={salvar}>
      <div className="grid grid-2">
        <label className="campo">Meta mensal de recebimentos<span className="dica">Quanto precisa entrar de clientes por mês</span><CampoValor valor={vRec} aoMudar={setRec} /></label>
        <label className="campo">Meta mensal de vendas<span className="dica">Valor contratado por mês (opcional)</span><CampoValor valor={vVen} aoMudar={setVen} /></label>
        <label className="campo">
          <span>Provisão de impostos (%) <Ajuda>Percentual gerencial para separar impostos até haver contador. O sistema não calcula imposto oficial.</Ajuda></span>
          <input inputMode="decimal" value={vImp} onChange={(e) => setImp(e.target.value)} placeholder="ex.: 6" />
        </label>
        <label className="campo">Reserva da empresa (%)<span className="dica">Usado no planejador de destinação (Etapa 3)</span><input inputMode="decimal" value={vRes} onChange={(e) => setRes(e.target.value)} placeholder="ex.: 10" /></label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Nos períodos de semestre e ano, o painel multiplica a meta mensal pelo número de meses.</p>
      <Erro mensagem={erro} />
      <div className="row"><button className="btn-primario">Salvar</button></div>
    </form>
  );
}

function AbaContas() {
  const toast = useToast();
  const { dados, erro, recarregar } = useConsulta(async () => ok(await supabase.from('conta_bancaria').select('*').order('ordem')) as ContaBancaria[], []);
  const [editando, setEditando] = useState<ContaBancaria | 'nova' | null>(null);
  return (
    <div className="card">
      <div className="card-titulo"><h2>Contas e cofrinhos</h2><button className="btn-primario" onClick={() => setEditando('nova')}><Icone nome="mais" /> Nova conta</button></div>
      <Erro mensagem={erro} />
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Instituição</th><th>Tipo</th><th className="right">Saldo inicial</th><th>Situação</th></tr></thead>
          <tbody>
            {(dados ?? []).map((c) => (
              <tr key={c.id} className="clicavel" onClick={() => setEditando(c)}>
                <td>{c.nome}</td><td>{c.instituicao}</td><td>{c.tipo}</td>
                <td className="right num">{formatar(doBanco(c.saldo_inicial))}</td>
                <td>{c.ativa ? <span className="selo ok">Ativa</span> : <span className="selo neutro">Inativa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <ContaForm conta={editando === 'nova' ? null : editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); toast('Conta salva.'); recarregar(); }} />}
    </div>
  );
}

function ContaForm({ conta, aoFechar, aoSalvar }: { conta: ContaBancaria | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [inst, setInst] = useState(conta?.instituicao ?? 'Mercado Pago');
  const [tipo, setTipo] = useState(conta?.tipo ?? 'cofrinho');
  const [saldo, setSaldo] = useState<Centavos | null>(conta ? doBanco(conta.saldo_inicial) : 0);
  const [data, setData] = useState(conta?.data_saldo_inicial ?? hoje());
  const [ativa, setAtiva] = useState(conta?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const d = { nome: nome.trim(), instituicao: inst.trim() || null, tipo, saldo_inicial: paraBanco(saldo ?? 0), data_saldo_inicial: data, ativa };
    const { error } = conta ? await supabase.from('conta_bancaria').update(d).eq('id', conta.id) : await supabase.from('conta_bancaria').insert(d);
    if (error) return setErro(mensagemErro(error));
    aoSalvar();
  }
  return (
    <Modal titulo={conta ? conta.nome : 'Nova conta'} aoFechar={aoFechar} rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-cb">Salvar</button></>}>
      <form id="form-cb" className="stack" onSubmit={salvar}>
        <label className="campo">Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus /></label>
        <div className="grid grid-2">
          <label className="campo">Instituição<input value={inst} onChange={(e) => setInst(e.target.value)} /></label>
          <label className="campo">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="corrente">Conta corrente</option><option value="cofrinho">Cofrinho / reserva</option><option value="caixa">Dinheiro em espécie</option><option value="outro">Outro</option></select></label>
          <label className="campo">Saldo inicial<span className="dica">Saldo real no dia abaixo, antes dos lançamentos do sistema</span><CampoValor valor={saldo} aoMudar={setSaldo} /></label>
          <label className="campo">Data do saldo inicial<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        </div>
        {conta && <label className="check"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Conta ativa</label>}
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

const NATUREZAS: Record<string, string> = {
  receita_servico: 'Receita de serviço', reembolso_cliente: 'Reembolso do cliente', rendimento: 'Rendimento', aporte: 'Aporte', outras_entradas: 'Outras entradas',
  custo_material: 'Custo de obra: material', custo_mao_obra: 'Custo de obra: mão de obra', custo_outros: 'Custo de obra: outros',
  despesa_empresa: 'Despesa da empresa', tributo: 'Tributo', pro_labore: 'Pró-labore', retirada: 'Retirada de lucro', outras_saidas: 'Outras saídas',
};

function AbaCategorias() {
  const { dados, erro, recarregar } = useConsulta(async () => ok(await supabase.from('categoria').select('*').order('tipo').order('ordem')) as Categoria[], []);
  const [nova, setNova] = useState({ nome: '', tipo: 'pagar', natureza: 'despesa_empresa' });
  const [msg, setMsg] = useState<string | null>(null);
  async function incluir(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('categoria').insert({ ...nova, nome: nova.nome.trim(), ordem: 50 });
    if (error) return setMsg(mensagemErro(error));
    setNova({ ...nova, nome: '' });
    setMsg(null);
    recarregar();
  }
  async function alternar(c: Categoria) {
    const { error } = await supabase.from('categoria').update({ ativo: !c.ativo }).eq('id', c.id);
    if (error) setMsg(mensagemErro(error)); else recarregar();
  }
  const naturezasDoTipo = Object.entries(NATUREZAS).filter(([k]) => (nova.tipo === 'receber') === ['receita_servico', 'reembolso_cliente', 'rendimento', 'aporte', 'outras_entradas'].includes(k));
  return (
    <div className="card">
      <p className="muted small" style={{ marginTop: 0 }}>A natureza decide em qual número do painel a categoria entra. Desativar esconde a categoria dos formulários sem apagar o histórico.</p>
      <form className="row" onSubmit={incluir} style={{ marginBottom: 14 }}>
        <input placeholder="Nova categoria" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} required style={{ flex: 2, minWidth: 180 }} />
        <select value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value, natureza: e.target.value === 'receber' ? 'receita_servico' : 'despesa_empresa' })} style={{ width: 'auto' }}>
          <option value="pagar">A pagar</option><option value="receber">A receber</option>
        </select>
        <select value={nova.natureza} onChange={(e) => setNova({ ...nova, natureza: e.target.value })} style={{ width: 'auto' }}>
          {naturezasDoTipo.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-secundario">Adicionar</button>
      </form>
      <Erro mensagem={erro ?? msg} />
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Categoria</th><th>Tipo</th><th>Natureza</th><th /></tr></thead>
          <tbody>
            {(dados ?? []).map((c) => (
              <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.55 }}>
                <td>{c.nome}</td><td>{c.tipo === 'receber' ? 'A receber' : 'A pagar'}</td><td className="small">{NATUREZAS[c.natureza]}</td>
                <td className="right"><button className="btn-link" onClick={() => alternar(c)}>{c.ativo ? 'Desativar' : 'Reativar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AbaUsuarios() {
  const { usuario } = useAuth();
  const toast = useToast();
  const { dados, erro, recarregar } = useConsulta(async () => ok(await supabase.from('usuario').select('*').order('nome')) as Usuario[], []);
  const [msg, setMsg] = useState<string | null>(null);
  async function atualizar(u: Usuario, campos: Partial<Usuario>) {
    const { error } = await supabase.from('usuario').update(campos).eq('id', u.id);
    if (error) return setMsg(mensagemErro(error));
    toast('Permissão atualizada.');
    recarregar();
  }
  const rotulo = { administrador: 'Administrador', administrativo: 'Equipe administrativa', campo: 'Equipe de campo', cliente: 'Cliente' };
  return (
    <div className="card stack">
      <div className="aviso info">
        <span>
          Hoje só você usa o sistema. As permissões dos quatro perfis já estão no banco e são verificadas no servidor. Para incluir alguém, crie o login em Supabase → Authentication → Users e me peça para vincular o perfil; a tela de convite chega quando houver equipe.
        </span>
      </div>
      <Erro mensagem={erro ?? msg} />
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Financeiro</th><th>Ativo</th></tr></thead>
          <tbody>
            {(dados ?? []).map((u) => {
              const eu = u.id === usuario?.id;
              return (
                <tr key={u.id}>
                  <td>{u.nome}{eu && <span className="muted small"> (você)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    {eu ? rotulo[u.papel] : (
                      <select value={u.papel} onChange={(e) => atualizar(u, { papel: e.target.value as Usuario['papel'] })} style={{ width: 'auto' }}>
                        {Object.entries(rotulo).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{u.papel === 'administrativo' ? <input type="checkbox" checked={u.acesso_financeiro} onChange={(e) => atualizar(u, { acesso_financeiro: e.target.checked })} aria-label="Acesso ao financeiro" /> : u.papel === 'administrador' ? 'Total' : 'Não'}</td>
                  <td>{eu ? 'Sim' : <input type="checkbox" checked={u.ativo} onChange={(e) => atualizar(u, { ativo: e.target.checked })} aria-label="Ativo" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABELAS = ['empresa', 'usuario', 'pessoa', 'obra', 'obra_financeiro', 'membro_obra', 'ambiente', 'servico', 'servico_ambiente', 'categoria', 'conta_bancaria', 'lancamento', 'parcela', 'movimento', 'arquivo', 'meta'];

async function lerTudo(tabela: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabela).select('*').range(de, de + 999);
    if (error) throw error;
    todos.push(...(data as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return todos;
}

function AbaDados() {
  const [estado, setEstado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function exportar(formato: 'json' | 'csv') {
    setErro(null);
    try {
      const tudo: Record<string, Record<string, unknown>[]> = {};
      for (const t of TABELAS) {
        setEstado(`Lendo ${t}…`);
        tudo[t] = await lerTudo(t);
      }
      const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      if (formato === 'json') {
        baixarArquivo(`rosae-exportacao-${carimbo}.json`, JSON.stringify({ exportado_em: new Date().toISOString(), versao: 1, tabelas: tudo }, null, 2), 'application/json');
      } else {
        for (const t of TABELAS) if (tudo[t].length) baixarArquivo(`rosae-${t}-${carimbo}.csv`, paraCsv(tudo[t]), 'text/csv;charset=utf-8');
      }
      setEstado(`Exportação concluída: ${Object.values(tudo).reduce((a, l) => a + l.length, 0)} registros.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setEstado(null);
    }
  }
  return (
    <div className="card stack">
      <h2>Exportar todos os dados</h2>
      <p className="muted" style={{ margin: 0 }}>Os dados são seus. Baixe tudo a qualquer momento: JSON (cópia completa) ou CSV por tabela (abre no Excel). Arquivos anexados ficam no armazenamento e são copiados pelo backup.</p>
      <div className="row">
        <button className="btn-primario" onClick={() => exportar('json')}><Icone nome="baixar" /> Baixar JSON completo</button>
        <button className="btn-secundario" onClick={() => exportar('csv')}><Icone nome="baixar" /> Baixar CSVs</button>
      </div>
      {estado && <div className="aviso ok">{estado}</div>}
      <Erro mensagem={erro} />
      <h2 style={{ marginTop: 10 }}>Backup automático</h2>
      <p className="muted" style={{ margin: 0 }}>
        Todo dia às 3h (Brasília) o GitHub copia o banco inteiro, criptografado, e guarda por 30 dias no repositório privado. Isso também evita a pausa do plano gratuito do Supabase.
        O estado de cada cópia aparece em GitHub → rosae-sistema → Actions → "Backup diário".
      </p>
    </div>
  );
}

function AbaHistorico() {
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.from('auditoria').select('id, tabela, registro_id, acao, usuario_id, em').order('em', { ascending: false }).limit(200)) as { id: number; tabela: string; registro_id: string; acao: string; usuario_id: string | null; em: string }[], []);
  const usuarios = useConsulta(async () => ok(await supabase.from('usuario').select('id, nome')) as { id: string; nome: string }[], []);
  const nome = (id: string | null) => (id ? usuarios.dados?.find((u) => u.id === id)?.nome ?? 'outro usuário' : 'sistema');
  const acao: Record<string, string> = { insert: 'criou', update: 'alterou', delete: 'removeu' };
  if (carregando && !dados) return <Carregando />;
  return (
    <div className="card">
      <p className="muted small" style={{ marginTop: 0 }}>Últimas 200 alterações. O histórico só aceita inclusão: ninguém edita nem apaga.</p>
      <Erro mensagem={erro} />
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Registro</th></tr></thead>
          <tbody>
            {(dados ?? []).map((a) => (
              <tr key={a.id}><td className="num">{formatarDataHora(a.em)}</td><td>{nome(a.usuario_id)}</td><td>{acao[a.acao]} {a.tabela}</td><td className="muted small">{a.registro_id?.slice(0, 8)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
