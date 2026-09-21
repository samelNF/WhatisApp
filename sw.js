// ==========================================
// SERVICE WORKER - WHATISAPP
// ==========================================

const APP_URL = new URL('./index.html', self.registration.scope).href;
const ICON_URL = new URL('./images/icon-192.png', self.registration.scope).href;
const BADGE_URL = ICON_URL;

const APP_SHELL_CACHE = 'whatisapp-shell-v19';
const RUNTIME_MEDIA_CACHE = 'whatisapp-media-v1';

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './style-base.css',
    './cache-db.js',
    './audio-system.js',
    './camera-system.js',
    './call-system.js',
    './group-call-system.js',
    './script.js',
    './script-base.js',
    './chat-visual.js',
    './safe-area.js',
    './notification-system.js',
    './group-panel.js',
    './contact-panel.js',
    './novo-contato.js',
    './solicitacoes.js',
    './manifest.json',
    './images/icon-192.png',
    './images/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_SHELL_CACHE);

        // Não deixa um SVG/arquivo opcional impedir a instalação inteira.
        await Promise.allSettled(
            APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })))
        );

        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const nomes = await caches.keys();

        await Promise.all(
            nomes
                .filter(nome =>
                    nome.startsWith('whatisapp-shell-') &&
                    nome !== APP_SHELL_CACHE
                )
                .map(nome => caches.delete(nome))
        );

        await clients.claim();
    })());
});

function normalizarPayloadPush(event) {
    if (!event.data) return {};

    try {
        return event.data.json();
    } catch (erro) {
        try {
            return { body: event.data.text() };
        } catch (e) {
            return {};
        }
    }
}

async function exibirNotificacao(data = {}) {
    // Também aceita payload no formato declarativo/moderno:
    // { notification: { title, body, navigate } }
    const declarativa = data.notification || {};

    const title =
        declarativa.title ||
        data.title ||
        'WhatisApp';

    const body =
        declarativa.body ||
        data.body ||
        'Nova mensagem';

    const url =
        declarativa.navigate ||
        data.url ||
        data.data?.url ||
        APP_URL;

    const options = {
        body,
        icon: declarativa.icon || data.icon || ICON_URL,
        badge: declarativa.badge || data.badge || BADGE_URL,
        tag: data.tag || ('whatisapp-' + Date.now()),
        renotify: true,
        data: {
            ...(data.data || {}),
            url
        }
    };

    const image = declarativa.image || data.image || null;
    if (image) options.image = image;

    await self.registration.showNotification(title, options);
}

self.addEventListener('push', event => {
    const data = normalizarPayloadPush(event);

    event.waitUntil((async () => {
        // Se o WhatisApp já está visível, o Realtime da própria página cuida da mensagem.
        // Isso evita notificação duplicada. Em segundo plano/fechado, o SW exibe normalmente.
        const janelas = await clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });

        const algumaVisivel = janelas.some(
            client => client.visibilityState === 'visible'
        );

        if (algumaVisivel) return;

        await exibirNotificacao(data);
    })());
});

// Permite que a página peça ao SW para exibir uma notificação.
// É útil como fallback em navegadores que preferem o SW para Notifications API.
self.addEventListener('message', event => {
    const data = event.data || {};

    if (data.type === 'SHOW_NOTIFICATION') {
        event.waitUntil(exibirNotificacao(data.payload || {}));
    }

    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ==========================================
// CACHE DE ARQUIVOS E MIDIAS
// ==========================================
self.addEventListener('fetch', event => {
    const request = event.request;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const mesmaOrigem = url.origin === self.location.origin;

    // Vídeo com Range precisa continuar indo direto à rede.
    if (request.headers.has('range')) return;

    // HTML/JS/CSS: tenta rede primeiro para não esconder atualizações do GitHub.
    if (
        mesmaOrigem &&
        (
            request.mode === 'navigate' ||
            request.destination === 'script' ||
            request.destination === 'style'
        )
    ) {
        event.respondWith((async () => {
            const cache = await caches.open(APP_SHELL_CACHE);

            try {
                const resposta = await fetch(request);

                if (resposta && resposta.ok) {
                    cache.put(request, resposta.clone()).catch(() => {});
                }

                return resposta;
            } catch (erro) {
                return (
                    await cache.match(request) ||
                    await cache.match('./index.html') ||
                    Response.error()
                );
            }
        })());

        return;
    }

    // SVGs, ícones e fotos: cache-first. Inclui imagens vindas do Supabase Storage.
    if (request.destination === 'image') {
        event.respondWith((async () => {
            const cache = await caches.open(RUNTIME_MEDIA_CACHE);
            const salva = await cache.match(request);

            if (salva) return salva;

            try {
                const resposta = await fetch(request);

                if (resposta && (resposta.ok || resposta.type === 'opaque')) {
                    cache.put(request, resposta.clone()).catch(() => {});
                }

                return resposta;
            } catch (erro) {
                return salva || Response.error();
            }
        })());

        return;
    }

    // Demais arquivos estáticos da mesma origem: usa cache e atualiza em segundo plano.
    if (mesmaOrigem) {
        event.respondWith((async () => {
            const cache = await caches.open(APP_SHELL_CACHE);
            const salva = await cache.match(request);

            const atualizacao = fetch(request)
                .then(resposta => {
                    if (resposta && resposta.ok) {
                        cache.put(request, resposta.clone()).catch(() => {});
                    }
                    return resposta;
                })
                .catch(() => null);

            return salva || (await atualizacao) || Response.error();
        })());
    }
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const dados = event.notification.data || {};
    const urlDestino = dados.url || APP_URL;

    event.waitUntil((async () => {
        const clientList = await clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });

        for (const client of clientList) {
            if (!client.url.startsWith(self.location.origin)) continue;

            try {
                if ('navigate' in client && urlDestino) {
                    await client.navigate(urlDestino);
                }
            } catch (e) {}

            if ('focus' in client) {
                return client.focus();
            }
        }

        if (clients.openWindow) {
            return clients.openWindow(urlDestino);
        }
    })());
});
