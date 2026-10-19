// ==========================================
// COMPATIBILIDADE COM PEDIDOS ANTIGOS
// ==========================================
// O WhatisApp agora mostra mensagens de usuários não salvos diretamente na Home.
// Este arquivo não interfere mais no envio de mensagens e mantém apenas uma
// compatibilidade mínima com registros antigos de solicitacoes_chat.

(function iniciarCompatibilidadeSolicitacoes() {
    function esconderInterfaceAntiga() {
        const badge = document.getElementById('badge-solicitacoes');
        const contador = document.getElementById('contador-menu');
        const itemPedidos = document.getElementById('btn-abrir-solicitacoes');
        const modal = document.getElementById('modal-solicitacoes');

        if (badge) {
            badge.textContent = '0';
            badge.classList.add('hidden');
        }

        if (contador) contador.textContent = '0';
        if (itemPedidos) itemPedidos.style.display = 'none';
        if (modal) modal.classList.add('hidden');
    }

    function iniciar() {
        window.garantirSolicitacaoConversa = async function () {
            return false;
        };

        window.carregarSolicitacoes = async function () {
            esconderInterfaceAntiga();
            return [];
        };

        window.atualizarContadorSolicitacoes = async function () {
            esconderInterfaceAntiga();
            return 0;
        };

        // Caso algum registro antigo ainda seja aberto por uma carga velha,
        // ele vira uma conversa normal de usuário não salvo.
        window.abrirChatSolicitacao = async function (solicitacao) {
            const email = String(solicitacao?.remetente_email || '').trim();
            if (!email || typeof abrirChatCom !== 'function') return;

            let usuario = null;

            try {
                const { data } = await _supabase
                    .from('usuarios')
                    .select('usuario, email, foto_url, cor')
                    .eq('email', email)
                    .maybeSingle();

                usuario = data || null;
            } catch (e) {}

            abrirChatCom(
                email,
                usuario?.usuario || email,
                usuario?.foto_url || '',
                usuario?.cor || '#3a3a3c',
                false
            );
        };

        window.aceitarSolicitacaoAtual = async function () {
            if (typeof window.adicionarContatoChatAtual === 'function') {
                return window.adicionarContatoChatAtual();
            }
        };

        window.ignorarSolicitacaoAtual = async function () {
            esconderInterfaceAntiga();
            if (typeof fecharChat === 'function') fecharChat();
        };

        esconderInterfaceAntiga();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar, { once: true });
    } else {
        iniciar();
    }
})();
