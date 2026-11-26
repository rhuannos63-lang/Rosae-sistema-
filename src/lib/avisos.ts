// Avisos no aparelho (push): ativar, desativar e testar neste celular ou computador.
import { supabase, mensagemErro } from './supabase';

export type SituacaoAvisos = 'sem_suporte' | 'instalar_iphone' | 'bloqueado' | 'desligado' | 'ligado';

const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function chaveParaBytes(b64: string): Uint8Array {
  const t = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function nomeDoAparelho(): string {
  const ua = navigator.userAgent;
  const sistema = /android/i.test(ua) ? 'Android' : ehIphone() ? 'iPhone/iPad' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Aparelho';
  const nav = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'navegador';
  return `${sistema} · ${nav}${instalado() ? ' (app instalado)' : ''}`;
}

export async function situacaoAvisos(): Promise<SituacaoAvisos> {
  const temApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!temApi) return ehIphone() && !instalado() ? 'instalar_iphone' : 'sem_suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'ligado' : 'desligado';
}

/** Pede a permissão, inscreve este aparelho e guarda a inscrição. Devolve um erro em português ou null. */
export async function ativarAvisos(): Promise<string | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'Este navegador não recebe avisos. No iPhone, instale o app na tela de início (Compartilhar › Adicionar à Tela de Início) e abra por lá.';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Os avisos foram bloqueados neste aparelho. Libere as notificações do site nas configurações do navegador e tente de novo.';
  const reg = await navigator.serviceWorker.ready;
  const { data, error } = await supabase.functions.invoke('avisos', { body: { acao: 'chave' } });
  if (error || !data?.publica) return 'Não consegui falar com o servidor de avisos. Tente de novo em instantes.';
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Inscrição feita com outra chave: refaz.
    const atual = sub.options.applicationServerKey ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))) : '';
    const nova = btoa(String.fromCharCode(...chaveParaBytes(data.publica)));
    if (atual && atual !== nova) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(data.publica) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const r = await supabase.from('push_assinatura').insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho: nomeDoAparelho() });
  if (r.error && r.error.code !== '23505') return mensagemErro(r.error);
  return null;
}

export async function desativarAvisos(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_assinatura').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function testarAvisos(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('avisos', { body: { acao: 'teste' } });
  if (error) return 'Não consegui mandar o teste agora.';
  if (!data?.aparelhos) return 'Nenhum aparelho com avisos ligados.';
  return data.enviados ? `Aviso de teste enviado para ${data.enviados} aparelho(s).` : 'O servidor de avisos recusou o envio. Desligue e ligue os avisos de novo.';
}

/** Ao abrir o sistema: avisa algum aceite que tenha ficado sem aviso (rede caiu na página do cliente, por exemplo). */
export function conferirAceitesPendentes(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  void supabase.functions.invoke('avisos', { body: { acao: 'aceites' } }).catch(() => undefined);
}
