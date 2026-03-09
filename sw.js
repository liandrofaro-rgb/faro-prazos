// Nome do cache (versão do app)
const CACHE_NAME = 'faro-prazos-v2';

// Arquivos que o app vai guardar para abrir rápido
const ASSETS = [
  './index.html',
  './manifest.json'
];

// Instalação: Guarda os arquivos básicos no celular
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Ativação: Limpa versões antigas se houver
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// Estratégia de carregamento:
// - HTML: network-first para evitar tela antiga no deploy
// - Demais assets: cache-first
self.addEventListener('fetch', (e) => {
  const isHtmlRequest =
    e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  if (isHtmlRequest) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
