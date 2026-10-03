self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TeeRA", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TeeRA";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/favicon.ico",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});
