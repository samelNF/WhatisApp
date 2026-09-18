// ==========================================
// SISTEMA DE NOTIFICAÇÕES DO WHATISAPP
// ==========================================
// Notifica mensagens recebidas em tempo real enquanto o app está em execução.
// Usa ServiceWorkerRegistration.showNotification(), que funciona de forma
// consistente em desktop/Android e também em PWAs instalados no iOS.

(function () {
    let canalNotificacoes = null;
    let iniciando = false;
    let gruposInscritos = new Set();
    let idsNotificados = [];
    let timerAtualizarGrupos = null;
    let timerReiniciar = null;

    const cacheUsuarios = new Map();
    const cacheGrupos = new Map();

    // Web Push real: necessário para o Service Worker acordar com o app fechado.
    const VAPID_PUBLIC_KEY = 'BMI4uCzdRkfPdRe4Yjq8lyKWhFsviVz7voWfUpswGoSziOHzWv-NTy7hjTVr89zXL7yPBCwXXRSRoLavokcfjYo';
    const PUSH_FUNCTION_URL = 'https://qlvorxobvnjoovqxnfhp.supabase.co/functions/v1/push';

    function supabaseAtual() {
        try {
            if (typeof _supabase !== 'undefined' && _supabase) return _supabase;
        } catch (e) {}
        return window._supabase || null;
    }

    function base64UrlParaUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const raw = atob(base64);
        const output = new Uint8Array(raw.length);

        for (let i = 0; i < raw.length; i++) {
            output[i] = raw.charCodeAt(i);
        }

        return output;
    }

    async function chamarPushServidor(payload) {
        try {
            const resposta = await fetch(PUSH_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!resposta.ok) {
                const texto = await resposta.text().catch(() => '');
                throw new Error('HTTP ' + resposta.status + (texto ? ': ' + texto : ''));
            }

            return await resposta.json().catch(() => ({}));
        } catch (erro) {
            console.warn('[Web Push] Servidor de push indisponível:', erro);
            return null;
        }
    }

    window.criarSessaoPush = async function (email, senhaHash) {
        if (!email || !senhaHash) return false;

        const resultado = await chamarPushServidor({
            action: 'session',
            email,
            senha_hash: senhaHash
        });

        if (!resultado?.ok || !resultado?.token) {
            console.warn('[Web Push] Não foi possível criar a sessão Push.');
            return false;
        }

        localStorage.setItem('pushSessionToken', resultado.token);
        return true;
    };

    function tokenSessaoPush() {
        return localStorage.getItem('pushSessionToken') || '';
    }

    function assinaturaUsaChaveAtual(assinatura) {
        try {
            const atual = assinatura?.options?.applicationServerKey;
            if (!atual) return false;

            const bytesAtual = new Uint8Array(atual);
            const bytesEsperados = base64UrlParaUint8Array(VAPID_PUBLIC_KEY);

            if (bytesAtual.length !== bytesEsperados.length) return false;

            for (let i = 0; i < bytesAtual.length; i++) {
                if (bytesAtual[i] !== bytesEsperados[i]) return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    window.marcarMensagensVistasServidor = async function (contatoEmail) {
        const sessaoPush = tokenSessaoPush();

        if (!sessaoPush || !contatoEmail) {
            return { ok: false, mensagens: [] };
        }

        const resultado = await chamarPushServidor({
            action: 'mark-seen',
            session_token: sessaoPush,
            contato_email: contatoEmail
        });

        if (!resultado?.ok) {
            console.warn('[Visto] Não foi possível marcar mensagens como visualizadas.');
            return { ok: false, mensagens: [] };
        }

        return resultado;
    };

    async function obterAssinaturaPush() {
        const reg = await garantirServiceWorker();
        if (!reg?.pushManager) return null;

        try {
            return await reg.pushManager.getSubscription();
        } catch (erro) {
            console.warn('[Web Push] Não foi possível ler a assinatura:', erro);
            return null;
        }
    }

    async function registrarWebPushReal(criarSeNecessario = false) {
        const email = meuEmailAtual();
        const sessaoPush = tokenSessaoPush();

        if (!email || !sessaoPush) {
            console.warn('[Web Push] Sessão Push ainda não foi criada.');
            return false;
        }

        const reg = await garantirServiceWorker();
        if (!reg?.pushManager) {
            console.warn('[Web Push] PushManager não disponível.');
            return false;
        }

        let assinatura = null;

        try {
            assinatura = await reg.pushManager.getSubscription();

            // A chave VAPID foi rotacionada ao ativar o backend real.
            // Uma assinatura feita com a chave antiga não pode receber os novos pushes.
            if (assinatura && !assinaturaUsaChaveAtual(assinatura)) {
                if (!criarSeNecessario) return false;

                try { await assinatura.unsubscribe(); } catch (e) {}
                assinatura = null;
            }

            if (!assinatura && criarSeNecessario) {
                assinatura = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlParaUint8Array(VAPID_PUBLIC_KEY)
                });
            }
        } catch (erro) {
            console.error('[Web Push] Falha ao criar assinatura:', erro);
            return false;
        }

        if (!assinatura) return false;

        const resultado = await chamarPushServidor({
            action: 'register',
            session_token: sessaoPush,
            subscription: assinatura.toJSON()
        });

        if (!resultado?.ok) {
            console.warn('[Web Push] Assinatura existe, mas não foi salva no servidor.');
            return false;
        }

        console.log('[Web Push] ✅ Dispositivo inscrito para push em segundo plano.');
        return true;
    }

    async function removerWebPushReal() {
        const assinatura = await obterAssinaturaPush();
        const sessaoPush = tokenSessaoPush();

        if (!assinatura) return;

        if (sessaoPush) {
            await chamarPushServidor({
                action: 'unregister',
                session_token: sessaoPush,
                endpoint: assinatura.endpoint
            });
        }

        try {
            await assinatura.unsubscribe();
        } catch (e) {}
    }

    function notificacoesAtivas() {
        return localStorage.getItem('notificacoes') !== 'false';
    }

    function meuEmailAtual() {
        return (localStorage.getItem('usuarioLogado') || '').trim();
    }

    function ehIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function ehStandalone() {
        return window.matchMedia?.('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
    }

    async function garantirServiceWorker() {
        if (!('serviceWorker' in navigator)) return null;

        try {
            const reg = await navigator.serviceWorker.register('./sw.js', {
                updateViaCache: 'none'
            });

            try { await reg.update(); } catch (e) {}

            return await navigator.serviceWorker.ready;
        } catch (erro) {
            console.error('[Notificações] Erro no Service Worker:', erro);
            return null;
        }
    }

    function textoNotificacao(texto) {
        if (!texto) return 'Nova mensagem';
        if (texto.startsWith('[FOTO]:')) return '📷 Foto';
        if (texto.startsWith('[VIDEO]:')) return '🎥 Vídeo';
        if (texto.startsWith('[AUDIO]:')) return '🎤 Áudio';
        if (texto.startsWith('[CHAMADA]')) return '📞 Ligação de voz';

        const limpo = texto.trim();
        return limpo.length > 140 ? limpo.slice(0, 137) + '...' : limpo;
    }

    async function obterUsuario(email) {
        const chave = (email || '').trim().toLowerCase();
        if (!chave) return null;

        if (cacheUsuarios.has(chave)) return cacheUsuarios.get(chave);

        const supabase = supabaseAtual();
        if (!supabase) return null;

        const { data, error } = await supabase
            .from('usuarios')
            .select('usuario, email, foto_url')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            console.warn('[Notificações] Não foi possível buscar remetente:', error);
            return null;
        }

        if (data) cacheUsuarios.set(chave, data);
        return data || null;
    }

    async function obterGrupo(id) {
        if (!id) return null;
        const chave = String(id);

        if (cacheGrupos.has(chave)) return cacheGrupos.get(chave);

        const supabase = supabaseAtual();
        if (!supabase) return null;

        const { data, error } = await supabase
            .from('grupos')
            .select('id, nome, foto_url')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.warn('[Notificações] Não foi possível buscar grupo:', error);
            return null;
        }

        if (data) cacheGrupos.set(chave, data);
        return data || null;
    }

    function marcarComoNotificada(id) {
        if (id === null || id === undefined) return false;

        const chave = String(id);
        if (idsNotificados.includes(chave)) return true;

        idsNotificados.push(chave);
        if (idsNotificados.length > 200) {
            idsNotificados = idsNotificados.slice(-120);
        }

        return false;
    }

    function chatAtualJaMostraMensagem(msg) {
        if (document.visibilityState !== 'visible') return false;

        const telaChat = document.getElementById('tela-chat');
        if (!telaChat) return false;

        const estiloChat = getComputedStyle(telaChat);
        const chatVisivel =
            estiloChat.display !== 'none' &&
            estiloChat.visibility !== 'hidden' &&
            telaChat.classList.contains('ativa');

        if (!chatVisivel) return false;

        if (msg.grupo_id && window.grupoAtualId) {
            return String(msg.grupo_id) === String(window.grupoAtualId);
        }

        if (!msg.grupo_id) {
            let destinatario = '';
            try {
                destinatario =
                    window.destinatarioAtual ||
                    (typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : '') ||
                    '';
            } catch (e) {}

            return destinatario &&
                destinatario.toLowerCase() === (msg.remetente_email || '').toLowerCase();
        }

        return false;
    }

    async function mostrarNotificacao(title, options) {
        if (!('Notification' in window)) return false;
        if (Notification.permission !== 'granted') return false;
        if (!notificacoesAtivas()) return false;

        const reg = await garantirServiceWorker();
        if (!reg) return false;

        try {
            await reg.showNotification(title, {
                icon: './images/icon-192.png',
                badge: './images/icon-192.png',
                tag: options.tag || ('msg-' + Date.now()),
                renotify: true,
                body: options.body || 'Nova mensagem',
                data: options.data || { url: './index.html' }
            });

            if ('setAppBadge' in navigator) {
                try {
                    const atual = Number(localStorage.getItem('badgeNotificacoes') || '0') + 1;
                    localStorage.setItem('badgeNotificacoes', String(atual));
                    await navigator.setAppBadge(atual);
                } catch (e) {}
            }

            return true;
        } catch (erro) {
            console.error('[Notificações] Falha ao exibir notificação:', erro);
            return false;
        }
    }

    window.mostrarNotificacaoWhatisApp = mostrarNotificacao;

    async function processarMensagemRecebida(msg) {
        const meuEmail = meuEmailAtual();
        if (!meuEmail || !msg) return;

        if ((msg.remetente_email || '').toLowerCase() === meuEmail.toLowerCase()) return;

        const ehPrivada =
            !msg.grupo_id &&
            (msg.destinatario_email || '').toLowerCase() === meuEmail.toLowerCase();

        const ehGrupo =
            !!msg.grupo_id &&
            gruposInscritos.has(String(msg.grupo_id));

        if (!ehPrivada && !ehGrupo) return;
        if (marcarComoNotificada(msg.id)) return;

        // Se a pessoa já está olhando exatamente este chat, não cria alerta duplicado.
        if (chatAtualJaMostraMensagem(msg)) return;

        const remetente = await obterUsuario(msg.remetente_email);
        const nomeRemetente = remetente?.usuario || msg.remetente_email || 'Contato';
        const corpo = textoNotificacao(msg.texto);

        if (ehGrupo) {
            const grupo = await obterGrupo(msg.grupo_id);
            const nomeGrupo = grupo?.nome || 'Grupo';

            await mostrarNotificacao(nomeGrupo, {
                body: nomeRemetente + ': ' + corpo,
                tag: 'grupo-' + msg.grupo_id + '-' + (msg.id ?? Date.now()),
                data: {
                    url: './index.html',
                    tipo: 'grupo',
                    grupo_id: msg.grupo_id
                }
            });
            return;
        }

        const ehChamada = msg.tipo === 'chamada' || msg.texto === '[CHAMADA]';

        await mostrarNotificacao(nomeRemetente, {
            body: corpo,
            tag: (ehChamada ? 'chamada-' : 'privado-') + (msg.id ?? Date.now()),
            data: {
                url: ehChamada && msg.chamada_id
                    ? './index.html?call=' + encodeURIComponent(msg.chamada_id)
                    : './index.html',
                tipo: ehChamada ? 'chamada' : 'privado',
                chamada_id: ehChamada ? (msg.chamada_id || null) : null,
                remetente_email: msg.remetente_email
            }
        });
    }

    // Também pode ser chamado pelo Realtime principal do aplicativo.
    // Assim a notificação não depende de um segundo canal separado para funcionar.
    window.processarNotificacaoMensagem = processarMensagemRecebida;

    async function buscarMeusGrupos() {
        const supabase = supabaseAtual();
        const meuEmail = meuEmailAtual();

        if (!supabase || !meuEmail) return new Set();

        const { data, error } = await supabase
            .from('grupo_membros')
            .select('grupo_id')
            .eq('usuario_email', meuEmail);

        if (error) {
            console.warn('[Notificações] Erro buscando grupos:', error);
            return new Set();
        }

        return new Set((data || []).map(item => String(item.grupo_id)));
    }

    async function removerCanalAtual() {
        const supabase = supabaseAtual();

        if (canalNotificacoes && supabase) {
            try { await supabase.removeChannel(canalNotificacoes); } catch (e) {}
        }

        canalNotificacoes = null;
    }

    async function iniciarCanal() {
        if (iniciando) return;

        const supabase = supabaseAtual();
        const meuEmail = meuEmailAtual();

        if (!supabase || !meuEmail || !notificacoesAtivas()) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        iniciando = true;

        try {
            await removerCanalAtual();
            gruposInscritos = await buscarMeusGrupos();

            const canal = supabase.channel('notificacoes-' + Date.now());
            canalNotificacoes = canal;

            // Conversas privadas recebidas por esta conta.
            canal.on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'mensagens',
                    filter: 'destinatario_email=eq.' + meuEmail
                },
                payload => processarMensagemRecebida(payload.new)
            );

            // Um listener filtrado por grupo evita que o cliente receba mensagens
            // de grupos dos quais não participa.
            gruposInscritos.forEach(grupoId => {
                canal.on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'mensagens',
                        filter: 'grupo_id=eq.' + grupoId
                    },
                    payload => processarMensagemRecebida(payload.new)
                );
            });

            // Atualiza automaticamente a inscrição quando entra/sai de grupo.
            canal.on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'grupo_membros',
                    filter: 'usuario_email=eq.' + meuEmail
                },
                () => agendarReinicio()
            );

            canal.subscribe(status => {
                if (status === 'SUBSCRIBED') {
                    console.log(
                        '[Notificações] ✅ Canal conectado. Grupos:',
                        gruposInscritos.size
                    );
                }

                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'CLOSED' ||
                    status === 'TIMED_OUT'
                ) {
                    console.warn('[Notificações] Canal caiu:', status);
                    agendarReinicio();
                }
            });
        } finally {
            iniciando = false;
        }
    }

    function agendarReinicio() {
        if (timerReiniciar) clearTimeout(timerReiniciar);

        timerReiniciar = setTimeout(() => {
            timerReiniciar = null;
            iniciarCanal();
        }, 1200);
    }

    window.ativarSistemaNotificacoes = async function (criarPushSeNecessario = true) {
        if (!('Notification' in window)) {
            console.warn('[Notificações] Notifications API indisponível.');
            return false;
        }

        if (ehIOS() && !ehStandalone()) {
            console.warn('[Notificações] No iOS, use o app adicionado à Tela de Início.');
        }

        if (Notification.permission !== 'granted') return false;

        localStorage.setItem('notificacoes', 'true');
        await garantirServiceWorker();

        // Criar a PushSubscription precisa acontecer a partir do gesto do usuário
        // (o clique no alternador), especialmente no iOS.
        const webPushRegistrado = await registrarWebPushReal(criarPushSeNecessario);

        await iniciarCanal();

        if (!webPushRegistrado) {
            console.warn('[Web Push] Notificações locais funcionam, mas o push com o app fechado ainda não foi registrado.');
        }

        return criarPushSeNecessario ? webPushRegistrado : true;
    };

    window.desativarSistemaNotificacoes = async function () {
        localStorage.setItem('notificacoes', 'false');
        await removerCanalAtual();
        await removerWebPushReal();

        if ('clearAppBadge' in navigator) {
            try { await navigator.clearAppBadge(); } catch (e) {}
        }

        localStorage.removeItem('badgeNotificacoes');
    };

    window.limparSessaoPushLocal = function () {
        localStorage.removeItem('pushSessionToken');
    };

    window.testarNotificacaoWhatisApp = async function () {
        return mostrarNotificacao('WhatisApp', {
            body: 'As notificações estão funcionando 🎉',
            tag: 'teste-notificacao'
        });
    };

    function limparBadgeAoAbrir() {
        localStorage.removeItem('badgeNotificacoes');

        if ('clearAppBadge' in navigator) {
            navigator.clearAppBadge().catch?.(() => {});
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            limparBadgeAoAbrir();
            if (notificacoesAtivas()) agendarReinicio();
        }
    });

    window.addEventListener('pageshow', () => {
        limparBadgeAoAbrir();
        if (notificacoesAtivas()) agendarReinicio();
    });

    // Atualiza grupos periodicamente porque mudanças feitas por administradores
    // podem acontecer enquanto este cliente está aberto.
    timerAtualizarGrupos = setInterval(() => {
        if (notificacoesAtivas() && document.visibilityState === 'visible') {
            agendarReinicio();
        }
    }, 60000);

    // script-base.js é carregado dinamicamente. Espera Supabase + sessão existirem.
    const espera = setInterval(() => {
        if (supabaseAtual() && meuEmailAtual()) {
            clearInterval(espera);

            if (
                notificacoesAtivas() &&
                'Notification' in window &&
                Notification.permission === 'granted'
            ) {
                // Se já existe uma PushSubscription, renova o vínculo com o servidor.
                // Não cria uma nova automaticamente porque iOS exige gesto do usuário.
                window.ativarSistemaNotificacoes(false);
            }
        }
    }, 250);

    setTimeout(() => clearInterval(espera), 20000);
})();
