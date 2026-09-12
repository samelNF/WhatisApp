// ==========================================
// SISTEMA DE NOTIFICAÇÕES (REESCRITO DO ZERO)
// ==========================================

// Variável para armazenar a permissão atual
let permissaoNotificacao = Notification ? Notification.permission : "default";

// Escuta mensagens enviadas pelo Service Worker quando a notificação é clicada
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.tipo === 'ABRIR_CHAT') {
            const { email, nome, foto } = event.data;
            abrirChatCom(email, nome, foto);
        }
    });
}

/**
 * Solicita a permissão de notificação diretamente via clique do usuário ou ao abrir a app
 */
async function solicitarPermissaoNotificacoes() {
    if (!("Notification" in window)) {
        console.warn("⚠️ Este navegador não suporta notificações.");
        return false;
    }

    try {
        const resultado = await Notification.requestPermission();
        permissaoNotificacao = resultado;
        
        if (resultado === "granted") {
            console.log("✅ Permissão de notificação CONCEDIDA.");
            // Garante que o Service Worker está ativo para receber o registro
            if ('serviceWorker' in navigator) {
                await navigator.serviceWorker.ready;
            }
            return true;
        } else {
            console.warn("❌ Permissão de notificação NEGADA pelo usuário.");
            return false;
        }
    } catch (erro) {
        console.error("⚠️ Erro ao solicitar permissão de notificação:", erro);
        return false;
    }
}

/**
 * Dispara notificações visuais via Service Worker ou fallback nativo
 */
async function enviarNotificacao(remetente, textoMensagem, emailRemetente, fotoRemetente) {
    // 1. Verifica se o usuário permitiu notificações nas configurações do app
    const notificacoesAtivas = localStorage.getItem("notificacoes") !== "false";
    if (!notificacoesAtivas) return;

    // 2. Verifica se as notificações estão permitidas no navegador
    if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
    }

    // 3. Regra de exibição: Não notificar se a conversa com este usuário já estiver aberta e a aba estiver visível
    const estaNaMesmaConversa = (destinatarioAtual === emailRemetente);
    const abaVisivel = !document.hidden;

    if (estaNaMesmaConversa && abaVisivel) {
        return; // Não precisa soar notificação
    }

    // Estrutura do payload da notificação
    const opcoes = {
        body: textoMensagem,
        icon: fotoRemetente || "svg/icon.svg",
        badge: "svg/icon.svg",
        tag: `chat-msg-${emailRemetente}`, // Substitui notificações antigas do mesmo remetente
        renotify: true,
        data: {
            emailRemetente: emailRemetente,
            remetente: remetente,
            fotoRemetente: fotoRemetente
        }
    };

    // 4. Envio Prioritário: Service Worker (Obrigatório para PWA iOS)
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.ready;
            if (reg && reg.showNotification) {
                await reg.showNotification(remetente, opcoes);
                return;
            }
        } catch (err) {
            console.warn("⚠️ Falha ao disparar via SW, tentando fallback nativo...", err);
        }
    }

    // 5. Fallback para Desktop/Navegadores tradicionais sem SW ativo
    try {
        const notif = new Notification(remetente, opcoes);
        notif.onclick = () => {
            window.focus();
            abrirChatCom(emailRemetente, remetente, fotoRemetente);
            notif.close();
        };
    } catch (e) {
        console.error("⚠️ Erro ao criar notificação nativa:", e);
    }
}
