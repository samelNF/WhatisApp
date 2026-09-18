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

    function supabaseAtual() {
        try {
            if (typeof _supabase !== 'undefined' && _supabase) return _supabase;
        } catch (e) {}
        return window._supabase || null;
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

        await mostrarNotificacao(nomeRemetente, {
            body: corpo,
            tag: 'privado-' + (msg.id ?? Date.now()),
            data: {
                url: './index.html',
                tipo: 'privado',
                remetente_email: msg.remetente_email
            }
        });
    }

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

    window.ativarSistemaNotificacoes = async function () {
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
        await iniciarCanal();
        return true;
    };

    window.desativarSistemaNotificacoes = async function () {
        localStorage.setItem('notificacoes', 'false');
        await removerCanalAtual();

        if ('clearAppBadge' in navigator) {
            try { await navigator.clearAppBadge(); } catch (e) {}
        }

        localStorage.removeItem('badgeNotificacoes');
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
                window.ativarSistemaNotificacoes();
            }
        }
    }, 250);

    setTimeout(() => clearInterval(espera), 20000);
})();
