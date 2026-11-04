// Service worker mínimo: torna o GGEarth instalável na tela inicial.
// Não guarda cache, para que cada atualização publicada chegue imediatamente aos usuários.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
