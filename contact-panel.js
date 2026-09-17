// ==========================================
// PAINEL DE DADOS DO CONTATO
// ==========================================
// Este arquivo complementa o script principal sem substituir
// nem carregar novamente a lógica existente do aplicativo.

window.abrirPainelDadosContato = function () {
    const painel = document.getElementById('painel-dados-contato');
    if (!painel) return;
    const nomeHeader = document.getElementById('chat-nome-usuario');
    const fotoHeader = document.getElementById('chat-foto-usuario');
    const nome = nomeHeader ? nomeHeader.textContent.trim() : 'Nome';
    const foto = fotoHeader ? fotoHeader.src : 'svg/icon.svg';
    const conteudo = painel.querySelector('.modal-content');
    if (!conteudo) return;
    let fotoPainel = conteudo.querySelector('#painel-foto-contato');
    if (!fotoPainel) {
        fotoPainel = conteudo.querySelector('img');
        if (fotoPainel) fotoPainel.id = 'painel-foto-contato';
    }
    if (fotoPainel && foto) fotoPainel.src = foto;
    let nomePainel = conteudo.querySelector('#painel-nome-contato');
    if (!nomePainel) {
        nomePainel = document.createElement('h2');
        nomePainel.id = 'painel-nome-contato';
        conteudo.insertBefore(nomePainel, conteudo.querySelector('.modal-body'));
    }
    nomePainel.textContent = nome || 'Nome';
    const tema = document.getElementById('btn-tema-conversa');
    if (tema && !tema.dataset.formatado) {
        tema.innerHTML = '<span class="tema-icone">🎨</span><span class="tema-texto">Tema da conversa</span><span class="tema-seta">›</span>';
        tema.dataset.formatado = 'true';
    }
    painel.classList.remove('hidden');
    painel.style.display = 'flex';
};

window.fecharPainelDadosContato = window.fecharPainelDadosContato || function () {
    const painel = document.getElementById('painel-dados-contato');
    if (painel) painel.style.display = 'none';
};

(function garantirBotaoAceitarAtualizado() {
    let tentativas = 0;
    const verificar = setInterval(() => {
        tentativas++;
        const botao = document.getElementById('btn-aceitar-solicitacao');
        if (!botao) {
            if (tentativas >= 50) clearInterval(verificar);
            return;
        }
        if (botao.dataset.fluxoNovoSolicitacao === 'true') {
            clearInterval(verificar);
            return;
        }
        const novoBotao = botao.cloneNode(true);
        novoBotao.dataset.fluxoNovoSolicitacao = 'true';
        novoBotao.addEventListener('click', () => {
            if (typeof window.aceitarSolicitacaoAtual === 'function') window.aceitarSolicitacaoAtual();
        });
        botao.parentNode.replaceChild(novoBotao, botao);
        clearInterval(verificar);
    }, 100);
})();

(function carregarFluxoSolicitacoesFinal() {
    const script = document.createElement('script');
    script.src = './solicitacoes.js?v=2';
    script.async = false;
    document.head.appendChild(script);
})();

// Popup visual de adicionar contato.
(function carregarPopupNovoContato() {
    const script = document.createElement('script');
    script.src = './novo-contato.js?v=1';
    script.async = false;
    document.head.appendChild(script);
})();
