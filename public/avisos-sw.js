// Avisos do sistema ROSAE (push): mostra a notificação e abre a tela certa ao tocar.
self.addEventListener('push', (evento) => {
  let d = {};
  try { d = evento.data ? evento.data.json() : {}; } catch { d = { corpo: evento.data ? evento.data.text() : '' }; }
  evento.waitUntil(self.registration.showNotification(d.titulo || 'ROSAE', {
    body: d.corpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
    lang: 'pt-BR',
  }));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const url = new URL((evento.notification.data && evento.notification.data.url) || '/', self.location.origin).href;
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if (new URL(j.url).origin === self.location.origin) {
        await j.focus();
        if ('navigate' in j) { try { await j.navigate(url); } catch { /* sem controle da janela */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
