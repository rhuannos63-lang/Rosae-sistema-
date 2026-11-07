// Aditivo num passo só: o que entra, motivo, valor, prazo e pagamento. Sai emitido e já abre o
// envio por e-mail ao cliente, que aceita pelo botão do e-mail (o aceite formaliza o aditivo).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { CampoValor, Erro, Modal, useToast } from './ui';
import { Icone } from './Icone';
import { formatar, paraBanco, type Centavos } from '../core/dinheiro';

export function NovoAditivo({ origemId, obraId, codigoOrigem, aoFechar }: {
  /** Orçamento aceito que o aditivo complementa. */
  origemId?: string | null;
  /** Ou a obra (usa o orçamento de origem dela quando houver). */
  obraId?: string | null;
  codigoOrigem?: string | null;
  aoFechar: () => void;
}) {
  const navegar = useNavigate();
  const toast = useToast();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [motivo, setMotivo] = useState('Pedido do cliente');
  const [valor, setValor] = useState<Centavos | null>(null);
  const [prazo, setPrazo] = useState('0');
  const [pagamento, setPagamento] = useState('À vista na aprovação do aditivo');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar(modo: 'enviar' | 'detalhar') {
    setErro(null);
    if (!titulo.trim()) return setErro('Diga o que está sendo acrescentado (ex.: Impermeabilização da laje).');
    if (!motivo.trim()) return setErro('Informe o motivo. Ele aparece no documento do cliente.');
    if (modo === 'enviar' && (!valor || valor <= 0)) return setErro('Informe o valor do aditivo.');
    const dias = Number(prazo.replace(',', '.')) || 0;
    if (dias < 0) return setErro('O acréscimo de prazo não pode ser negativo.');
    setOcupado(true);
    const r = await supabase.rpc('criar_aditivo_rapido', {
      p_origem: origemId ?? null, p_obra: origemId ? null : obraId ?? null, p_titulo: titulo.trim(), p_motivo: motivo.trim(),
      p_descricao: descricao.trim() || null, p_valor: paraBanco(valor ?? 0), p_prazo_dias: Math.round(dias),
      p_pagamento: pagamento.trim() || null, p_emitir: modo === 'enviar',
    });
    setOcupado(false);
    if (r.error) return setErro(mensagemErro(r.error));
    const id = r.data as string;
    if (modo === 'enviar') {
      toast('Aditivo pronto e emitido. Confira o e-mail e envie ao cliente.');
      navegar(`/propostas/${id}?enviar=email`);
    } else {
      toast('Aditivo criado. Coloque os itens e o valor e emita.');
      navegar(`/propostas/${id}?aba=escopo`);
    }
  }

  return (
    <Modal titulo="Adicionar aditivo" aoFechar={aoFechar}
      rodape={<>
        <button className="btn-link" disabled={ocupado} onClick={() => criar('detalhar')}>Detalhar itens antes</button>
        <button className="btn-primario" disabled={ocupado} onClick={() => criar('enviar')}><Icone nome="documento" /> {ocupado ? 'Preparando…' : 'Criar e enviar por e-mail'}</button>
      </>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        O aditivo fica ligado {codigoOrigem ? <>ao orçamento <b>{codigoOrigem}</b></> : 'a esta obra'}. O orçamento aceito e o contrato não mudam: o aditivo tem valor e condições próprios e o cliente aceita pelo botão do e-mail, o que formaliza a mudança.
      </p>
      <label className="campo">O que está sendo acrescentado<input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Impermeabilização da laje" /></label>
      <label className="campo">Descrição para o cliente (opcional)<textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: manta asfáltica 4 mm em 40 m², com teste de estanqueidade" /></label>
      <div className="grid grid-2">
        <label className="campo">Valor do aditivo<CampoValor valor={valor} aoMudar={setValor} /></label>
        <label className="campo">Dias a mais no prazo (0 se couber)<input inputMode="numeric" value={prazo} onChange={(e) => setPrazo(e.target.value.replace(/[^\d]/g, ''))} /></label>
      </div>
      <label className="campo">Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pedido do cliente durante a obra" /></label>
      <label className="campo">Pagamento<input value={pagamento} onChange={(e) => setPagamento(e.target.value)} placeholder="Ex.: junto com a próxima parcela" /></label>
      {valor ? <p className="muted small" style={{ margin: 0 }}>O cliente recebe o aditivo de <b>{formatar(valor)}</b> em PDF, com o botão para aceitar. Depois do aceite, ele soma no valor fechado do contrato.</p> : null}
      <Erro mensagem={erro} />
    </Modal>
  );
}
