// ==========================================
// INSTALAÇÃO DO SERVICE WORKER
// ==========================================
self.addEventListener('install', (event) => {
    console.log('⚙️ Service Worker instalado.');

    self.skipWaiting();
});


// ==========================================
// ATIVAÇÃO
// ==========================================
self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker ativado.');

    event.waitUntil(
        clients.claim()
    );
});


// ==========================================
// PUSH
// ==========================================
self.addEventListener('push', (event) => {
    let data = {};

    try {
        data = event.data
            ? event.data.json()
            : {};
    } catch (erro) {
        console.error(
            'Erro ao interpretar Push:',
            erro
        );
    }

    const title =
        data.title ||
        'Nova Mensagem';

    const options = {
        body:
            data.body ||
            '',

        icon:
            data.icon ||
            'svg/icon.svg',

        badge:
            data.badge ||
            'svg/icon.svg',

        tag:
            data.tag ||
            `push-${Date.now()}`,

        renotify: true,

        data:
            data.data ||
            {
                url:
                    data.url ||
                    '/'
            }
    };

    event.waitUntil(
        self.registration
            .showNotification(
                title,
                options
            )
    );
});


// ==========================================
// CLIQUE NA NOTIFICAÇÃO
// ==========================================
self.addEventListener(
    'notificationclick',
    (event) => {

        event.notification.close();

        const dados =
            event.notification.data ||
            {};

        const url =
            dados.url ||
            '/';

        event.waitUntil(

            clients.matchAll({
                type: 'window',
                includeUncontrolled: true
            })

            .then((clientList) => {

                // Procura uma janela já aberta do app
                for (
                    const client of clientList
                ) {

                    if (
                        client.url.includes(
                            self.location.origin
                        ) &&
                        'focus' in client
                    ) {

                        // Se o navegador permitir,
                        // manda a página para a URL recebida
                        if (
                            'navigate' in client &&
                            url
                        ) {
                            return client
                                .navigate(url)
                                .then(() =>
                                    client.focus()
                                );
                        }

                        return client.focus();
                    }
                }

                // Nenhuma janela aberta
                if (
                    clients.openWindow
                ) {
                    return clients.openWindow(
                        url
                    );
                }

            })

        );
    }
);
