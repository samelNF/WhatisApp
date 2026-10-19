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
    let contatoSalvo = typeof opcoes.salvo === 'boolean'
        ? opcoes.salvo
        : false;

    try {
        const supabase = window._supabase || (typeof _supabase !== 'undefined' ? _supabase : null);

        if (supabase && emailContato) {
            const { data } = await supabase
                .from('usuarios')
                .select('usuario, email, foto_url, cor')
                .eq('email', emailContato)
                .maybeSingle();

            dadosContato = data || null;

            if (typeof opcoes.salvo !== 'boolean') {
                const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();

                if (meuUsuario) {
                    const { data: relacoes, error: erroRelacoes } = await supabase
                        .from('contatos')
                        .select('contato_usuario')
                        .eq('usuario_origem', meuUsuario);

                    if (!erroRelacoes) {
                        const emailNormalizado = String(emailContato || '').trim().toLowerCase();
                        const usuarioNormalizado = String(dadosContato?.usuario || '').trim().toLowerCase();

                        contatoSalvo = (relacoes || []).some(item => {
                            const salvo = String(item.contato_usuario || '').trim().toLowerCase();
                            return salvo === emailNormalizado ||
                                (!!usuarioNormalizado && salvo === usuarioNormalizado);
                        });
                    }
                }
            }
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
    painel.dataset.contatoSalvo = contatoSalvo ? 'true' : 'false';

    const tituloHeader = painel.querySelector('.painel-contato-header h3');
    const btnEditar = painel.querySelector('.painel-contato-btn-editar');
    const btnTema = document.getElementById('btn-tema-conversa');
    const cardTema = btnTema?.closest('.painel-contato-card');
    const cardRemover = document.getElementById('card-remover-contato');

    if (tituloHeader) {
        tituloHeader.textContent = opcoes.titulo || 'Dados do contato';
    }

    if (btnEditar) {
        const mostrarEditar =
            opcoes.mostrarEditar !== false &&
            contatoSalvo;

        btnEditar.style.display = mostrarEditar ? '' : 'none';
    }

    if (cardTema) {
        cardTema.style.display = opcoes.ocultarTema ? 'none' : '';
    }

    if (cardRemover) {
        cardRemover.classList.toggle('hidden', !contatoSalvo);
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

window.removerContatoAtual = async function () {
    const painel = document.getElementById('painel-dados-contato');
    const supabase = window._supabase || (typeof _supabase !== 'undefined' ? _supabase : null);
    const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
    const emailContato = String(painel?.dataset?.emailContato || '').trim();
    const nomeContato =
        document.getElementById('painel-nome-contato')?.textContent?.trim() ||
        emailContato ||
        'este contato';

    if (!painel || !supabase || !meuUsuario || !emailContato) return;

    if (!navigator.onLine) {
        alert('Você precisa estar com internet para remover o contato.');
        return;
    }

    if (!confirm(
        'Remover ' + nomeContato + ' dos seus contatos?\n\n' +
        'A conversa e todas as mensagens serão mantidas.'
    )) {
        return;
    }

    const { data: removido, error } = await supabase.rpc(
        'remover_contato_whatisapp',
        {
            p_usuario_origem: meuUsuario,
            p_contato_email: emailContato
        }
    );

    if (error) {
        console.error('[Contato] Erro removendo contato:', error);
        alert('Não foi possível remover o contato.');
        return;
    }

    painel.dataset.contatoSalvo = 'false';
    document.getElementById('card-remover-contato')?.classList.add('hidden');

    const btnEditar = painel.querySelector('.painel-contato-btn-editar');
    if (btnEditar) btnEditar.style.display = 'none';

    // Mantém a conversa na home. Apenas muda o estado dela para "não salvo".
    try {
        if (typeof todosContatos !== 'undefined') {
            todosContatos = (todosContatos || []).map(item => {
                const mesmoContato =
                    item?.tipo === 'contato' &&
                    String(item.identificador || item.email || '').trim().toLowerCase() ===
                        emailContato.toLowerCase();

                return mesmoContato
                    ? { ...item, salvo: false }
                    : item;
            });

            if (typeof renderizarContatos === 'function') {
                renderizarContatos(todosContatos);
            }

            if (typeof salvarHomeConversasNoCache === 'function') {
                await salvarHomeConversasNoCache();
            }
        }
    } catch (e) {
        console.warn('[Contato] Não foi possível atualizar a home local:', e);
    }

    if (typeof carregarListaContatos === 'function') {
        await carregarListaContatos();
    }

    if (typeof mostrarToastAcoesMensagem === 'function') {
        mostrarToastAcoesMensagem(
            removido
                ? 'Contato removido. A conversa foi mantida.'
                : 'Esse usuário já não estava salvo nos seus contatos.'
        );
    }
};

window.pesquisarNoChatContato = function () {
    const termo = prompt('Pesquisar nesta conversa:');
    if (!termo) return;

    const alvo = String(termo).trim().toLowerCase();
    if (!alvo) return;

    window.fecharPainelDadosContato();

    const mensagens = Array.from(
        document.querySelectorAll('#chat-mensagens .balao-msg')
    );

    document
        .querySelectorAll('#chat-mensagens .balao-msg.pesquisa-chat-destaque')
        .forEach(el => el.classList.remove('pesquisa-chat-destaque'));

    const encontrada = mensagens.find(el =>
        String(el.textContent || '').toLowerCase().includes(alvo)
    );

    if (!encontrada) {
        setTimeout(() => {
            if (typeof mostrarToastAcoesMensagem === 'function') {
                mostrarToastAcoesMensagem('Nenhuma mensagem encontrada.');
            } else {
                alert('Nenhuma mensagem encontrada.');
            }
        }, 80);
        return;
    }

    encontrada.classList.add('pesquisa-chat-destaque');
    encontrada.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => {
        encontrada.classList.remove('pesquisa-chat-destaque');
    }, 2200);
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
