// ==========================================
// SERVICE WORKER - WHATISAPP
// ==========================================

const APP_URL = new URL('./index.html', self.registration.scope).href;
const ICON_URL = new URL('./images/icon-192.png', self.registration.scope).href;
const BADGE_URL = ICON_URL;

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
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
        icon: data.icon || ICON_URL,
        badge: data.badge || BADGE_URL,
        tag: data.tag || ('whatisapp-' + Date.now()),
        renotify: true,
        data: {
            ...(data.data || {}),
            url
        }
    };

    await self.registration.showNotification(title, options);
}

self.addEventListener('push', event => {
    const data = normalizarPayloadPush(event);
    event.waitUntil(exibirNotificacao(data));
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
