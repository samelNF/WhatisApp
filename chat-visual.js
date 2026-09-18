// ==========================================
// COMPLEMENTO VISUAL DA TELA DE CONVERSA
// ==========================================
// Só controla a troca visual entre microfone e enviar.
// A lógica de mensagens continua nos scripts existentes.

(function () {
    function atualizarBotaoChat() {
        const input = document.getElementById('input-mensagem');
        const mic = document.getElementById('btn-audio-visual');
        const enviar = document.getElementById('btn-enviar');

        if (!input || !mic || !enviar) return;

        const temTexto = input.value.trim().length > 0;
        mic.style.display = temTexto ? 'none' : 'flex';
        enviar.style.display = temTexto ? 'flex' : 'none';
    }

    function iniciar() {
        const input = document.getElementById('input-mensagem');
        const enviar = document.getElementById('btn-enviar');

        if (input && !input.dataset.visualChatLigado) {
            input.dataset.visualChatLigado = 'true';
            input.addEventListener('input', atualizarBotaoChat);
            input.addEventListener('keyup', () => setTimeout(atualizarBotaoChat, 0));
        }

        if (enviar && !enviar.dataset.visualChatLigado) {
            enviar.dataset.visualChatLigado = 'true';
            enviar.addEventListener('click', () => {
                setTimeout(atualizarBotaoChat, 120);
            });
        }

        atualizarBotaoChat();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar, { once: true });
    } else {
        iniciar();
    }

    // O script principal é carregado dinamicamente; essa pequena checagem
    // garante o estado correto mesmo depois de mudanças de tela.
    setInterval(atualizarBotaoChat, 800);
})();
