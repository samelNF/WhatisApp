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
    const foto = fotoHeader ? nomeHeader && fotoHeader.src : 'svg/icon.svg';

    const conteudo = painel.querySelector('.modal-content');
    if (!conteudo) return;

    // Evita conflito com o avatar que fica no cabeçalho do chat.
    let fotoPainel = conteudo.querySelector('#painel-foto-contato');
    if (!fotoPainel) {
        fotoPainel = conteudo.querySelector('img');
        if (fotoPainel) fotoPainel.id = 'painel-foto-contato';
    }

    if (fotoPainel && foto) {
        fotoPainel.src = foto;
    }

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
