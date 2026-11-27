self.addEventListener("push", event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.id !== "string") return;

  event.waitUntil(self.registration.showNotification("Novo agendamento", {
    body: "Um lead confirmou uma reunião. Abra o Agendador para ver os detalhes.",
    icon: "/gatu-logo.png",
    tag: "agendador-reserva-" + payload.id,
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const panel = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && url.pathname === "/";
    });
    if (panel) {
      panel.postMessage({ type: "agendador:open-bookings" });
      await panel.focus();
    } else {
      await self.clients.openWindow("/?agenda=1");
    }
  })());
});
