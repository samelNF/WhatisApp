// ==========================================
// CARREGADOR DO SCRIPT PRINCIPAL
// ==========================================
// O código original permanece em script-base.js.
// Este arquivo apenas garante que ele seja carregado sem
// alterar a estrutura existente do aplicativo.

(function () {
    const base = document.createElement('script');
    base.src = './script-base.js';

    base.onload = function () {
        // O painel é carregado separadamente para não misturar
        // sua lógica com as mais de 2 mil linhas do app principal.
        const painel = document.createElement('script');
        painel.src = './contact-panel.js';
        document.head.appendChild(painel);

        // O script-base possui um DOMContentLoaded próprio.
        // Se ele já passou quando o carregamento terminou, iniciamos
        // manualmente as mesmas rotinas que o script original usaria.
        if (document.readyState !== 'loading') {
            if (typeof verificarSessao === 'function') verificarSessao();
            if (typeof registrarServiceWorker === 'function') registrarServiceWorker();
            if (typeof inicializarEventosSolicitacoes === 'function') inicializarEventosSolicitacoes();
        }
    };

    base.onerror = function () {
        console.error('Erro ao carregar o script principal do WhatisApp.');
    };

    document.head.appendChild(base);
})();
