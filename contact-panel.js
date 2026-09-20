// ==========================================
// PAINEL DE DADOS DO CONTATO
// ==========================================
// Este arquivo complementa o script principal sem substituir
// nem carregar novamente a lógica existente do aplicativo.

async function abrirPainelContatoInterno(emailForcado = '', opcoes = {}) {
    const painel = document.getElementById('painel-dados-contato');
    if (!painel) return;

    const nomeHeader = document.getElementById('chat-nome-usuario');
    const fotoHeader = document.getElementById('chat-foto-usuario');
    const nomePainel = document.getElementById('painel-nome-contato');
    const subtitulo = document.getElementById('painel-subtitulo-contato');
    const fotoPainel = document.getElementById('painel-foto-contato');

    const nomeAtual = nomeHeader?.textContent?.trim() || 'Contato';
    const temFoto = fotoHeader?.dataset.temFoto === 'true';
    const fotoAtual = temFoto && fotoHeader ? fotoHeader.src : '';
    const corAtual = fotoHeader?.dataset.avatarCor || '#3a3a3c';

    let emailContato = String(emailForcado || '').trim();

    if (!emailContato) {
        try {
            emailContato = (
                window.destinatarioAtual ||
                (typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : '') ||
                ''
            ).trim();
        } catch (e) {}
    }

    let dadosContato = null;
    try {
        const supabase = window._supabase || (typeof _supabase !== 'undefined' ? _supabase : null);
        if (supabase && emailContato) {
            const { data } = await supabase
                .from('usuarios')
                .select('usuario, email, foto_url, cor')
                .eq('email', emailContato)
                .maybeSingle();

            dadosContato = data || null;
        }
    } catch (e) {
        console.warn('[Contato] Não foi possível atualizar os dados do painel:', e);
    }

    if (nomePainel) {
        nomePainel.textContent = dadosContato?.usuario || nomeAtual || 'Contato';
    }

    if (subtitulo) {
        if (dadosContato?.usuario) {
            subtitulo.textContent = '@' + dadosContato.usuario;
        } else if (emailContato) {
            subtitulo.textContent = emailContato;
        } else {
            subtitulo.textContent = '';
        }
    }

    if (fotoPainel) {
        const foto = dadosContato?.foto_url || fotoAtual || '';
        const cor = dadosContato?.cor || corAtual;

        if (typeof window.aplicarAvatarUsuario === 'function') {
            window.aplicarAvatarUsuario(fotoPainel, foto, cor);
        } else {
            fotoPainel.src = foto || 'svg/user-placeholder.svg';
            fotoPainel.style.backgroundColor = foto ? 'transparent' : cor;
        }
    }

    painel.dataset.emailContato = emailContato || '';

    const tituloHeader = painel.querySelector('.painel-contato-header h3');
    const btnEditar = painel.querySelector('.painel-contato-btn-editar');
    const btnTema = document.getElementById('btn-tema-conversa');
    const cardTema = btnTema?.closest('.painel-contato-card');

    if (tituloHeader) {
        tituloHeader.textContent = opcoes.titulo || 'Dados do contato';
    }

    if (btnEditar) {
        const mostrarEditar = opcoes.mostrarEditar !== false && opcoes.salvo !== false;
        btnEditar.style.display = mostrarEditar ? '' : 'none';
    }

    if (cardTema) {
        cardTema.style.display = opcoes.ocultarTema ? 'none' : '';
    }

    painel.classList.remove('hidden');
    painel.style.display = 'flex';

    if (typeof window.atualizarSafeArea === 'function') {
        requestAnimationFrame(() => window.atualizarSafeArea());
    }
}

window.abrirPainelDadosContato = async function () {
    if (window.grupoAtualId && typeof window.abrirPainelDadosGrupo === 'function') {
        window.abrirPainelDadosGrupo();
        return;
    }

    return abrirPainelContatoInterno('', {});
};

window.abrirPainelDadosContatoPorEmail = async function (emailContato, opcoes = {}) {
    return abrirPainelContatoInterno(emailContato, opcoes);
};

window.fecharPainelDadosContato = function () {
    const painel = document.getElementById('painel-dados-contato');
    if (!painel) return;

    painel.classList.add('hidden');
    painel.style.display = 'none';

    if (typeof window.atualizarSafeArea === 'function') {
        requestAnimationFrame(() => window.atualizarSafeArea());
    }
};

// Esses três botões já fazem parte do layout. A lógica real de chamadas/edição
// pode ser ligada depois sem precisar redesenhar a tela novamente.
window.editarContatoAtual = window.editarContatoAtual || function () {
    console.log('[Contato] Editar contato ainda não implementado.');
};

window.iniciarLigacaoContato = window.iniciarLigacaoContato || function () {
    console.log('[Contato] Ligação de voz ainda não implementada.');
};

window.iniciarVideoContato = window.iniciarVideoContato || function () {
    console.log('[Contato] Chamada de vídeo ainda não implementada.');
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
    // O script-base usa uma declaração global const (_supabase),
    // então criamos também uma referência em window para os módulos extras.
    try {
        if (typeof _supabase !== 'undefined') window._supabase = _supabase;
    } catch (e) {}

    const script = document.createElement('script');
    script.src = './novo-contato.js?v=2';
    script.async = false;
    document.head.appendChild(script);
})();
