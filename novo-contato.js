// ==========================================
// POPUP DE NOVO CONTATO
// ==========================================
// Mantém a estrutura atual do aplicativo e substitui apenas
// o prompt antigo por uma tela de contato mais parecida com o iOS.

(function iniciarPopupNovoContato() {
    function criarEstilos() {
        if (document.getElementById('estilos-novo-contato')) return;

        const style = document.createElement('style');
        style.id = 'estilos-novo-contato';
        style.textContent = `
            #modal-novo-contato {
                position: fixed;
                inset: 0;
                z-index: 5000;
                display: none;
                align-items: flex-start;
                justify-content: center;
                background: rgba(0, 0, 0, .58);
                padding: 22px 0 0;
                box-sizing: border-box;
                -webkit-backdrop-filter: blur(5px);
                backdrop-filter: blur(5px);
            }

            #modal-novo-contato .novo-contato-card {
                width: min(100%, 760px);
                min-height: 560px;
                max-height: calc(100vh - 22px);
                overflow-y: auto;
                box-sizing: border-box;
                background: #171717;
                color: #f5f5f5;
                border-radius: 42px 42px 0 0;
                padding: 24px 34px 70px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }

            #modal-novo-contato .novo-contato-header {
                position: relative;
                height: 68px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 34px;
            }

            #modal-novo-contato .novo-contato-header h2 {
                margin: 0;
                font-size: 25px;
                line-height: 1;
                font-weight: 700;
            }

            #modal-novo-contato .novo-contato-canto {
                position: absolute;
                top: 0;
                width: 58px;
                height: 58px;
                border: 0;
                border-radius: 50%;
                background: #565656;
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }

            #modal-novo-contato .novo-contato-fechar { left: 0; }
            #modal-novo-contato .novo-contato-confirmar { right: 0; }

            #modal-novo-contato .novo-contato-confirmar.desabilitado {
                opacity: .48;
                cursor: default;
            }

            #modal-novo-contato .novo-contato-avatar {
                width: 126px;
                height: 126px;
                margin: 4px auto 34px;
                border-radius: 50%;
                overflow: hidden;
                background: #40368b;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 10px rgba(0,0,0,.28);
            }

            #modal-novo-contato .novo-contato-avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }

            #modal-novo-contato .novo-contato-campo {
                width: 100%;
                min-height: 72px;
                display: flex;
                align-items: center;
                gap: 14px;
                padding: 0 18px 0 24px;
                box-sizing: border-box;
                border-radius: 36px;
                background: #282828;
                margin-top: 12px;
            }

            #modal-novo-contato .novo-contato-campo label {
                color: #f4f4f4;
                font-size: 19px;
                font-weight: 700;
                white-space: nowrap;
            }

            #modal-novo-contato .novo-contato-campo input {
                flex: 1;
                min-width: 0;
                height: 54px;
                border: 0;
                outline: 0;
                background: transparent;
                color: #f5f5f5;
                font: inherit;
                font-size: 19px;
            }

            #modal-novo-contato .novo-contato-campo input::placeholder {
                color: #929292;
            }

            #modal-novo-contato .novo-contato-validacao {
                width: 34px;
                min-width: 34px;
                height: 34px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 23px;
                font-weight: 700;
                line-height: 1;
            }

            #modal-novo-contato .novo-contato-validacao.ok {
                color: #42d477;
                background: rgba(66,212,119,.13);
            }

            #modal-novo-contato .novo-contato-validacao.erro {
                color: #ff5f56;
                background: rgba(255,95,86,.12);
            }

            #modal-novo-contato .novo-contato-validacao.vazio {
                color: #777;
                background: transparent;
            }

            #modal-novo-contato .novo-contato-status {
                min-height: 25px;
                padding: 9px 20px 0;
                color: #9b9b9b;
                font-size: 15px;
                line-height: 20px;
            }

            #modal-novo-contato .novo-contato-status.ok { color: #42d477; }
            #modal-novo-contato .novo-contato-status.erro { color: #ff6961; }

            @media (max-width: 500px) {
                #modal-novo-contato {
                    padding-top: 22px;
                }

                #modal-novo-contato .novo-contato-card {
                    min-height: calc(100vh - 22px);
                    border-radius: 38px 38px 0 0;
                    padding: 22px 34px 60px;
                }

                #modal-novo-contato .novo-contato-header {
                    margin-bottom: 34px;
                }

                #modal-novo-contato .novo-contato-header h2 {
                    font-size: 23px;
                }

                #modal-novo-contato .novo-contato-canto {
                    width: 58px;
                    height: 58px;
                }

                #modal-novo-contato .novo-contato-avatar {
                    width: 118px;
                    height: 118px;
                    margin-bottom: 30px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function criarModal() {
        if (document.getElementById('modal-novo-contato')) return;

        const modal = document.createElement('div');
        modal.id = 'modal-novo-contato';
        modal.innerHTML = `
            <div class="novo-contato-card" role="dialog" aria-modal="true" aria-label="Novo contato">
                <div class="novo-contato-header">
                    <button type="button" class="novo-contato-canto novo-contato-fechar" aria-label="Cancelar">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                            <path d="M6 6l12 12M18 6L6 18"></path>
                        </svg>
                    </button>

                    <h2>Novo contato</h2>

                    <button type="button" class="novo-contato-canto novo-contato-confirmar desabilitado" aria-label="Adicionar contato" disabled>
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 12.5l4 4L19 6.5"></path>
                        </svg>
                    </button>
                </div>

                <div class="novo-contato-avatar">
                    <img id="novo-contato-foto" src="svg/user-placeholder.svg" alt="Foto do contato">
                </div>

                <div class="novo-contato-campo">
                    <label for="novo-contato-usuario">Usuário</label>
                    <input id="novo-contato-usuario" type="text" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Nome de usuário">
                    <span id="novo-contato-validacao" class="novo-contato-validacao vazio">•</span>
                </div>

                <div id="novo-contato-status" class="novo-contato-status"></div>
            </div>
        `;

        document.body.appendChild(modal);

        const fechar = modal.querySelector('.novo-contato-fechar');
        const confirmar = modal.querySelector('.novo-contato-confirmar');
        const input = modal.querySelector('#novo-contato-usuario');

        fechar.addEventListener('click', fecharNovoContato);
        modal.addEventListener('click', event => {
            if (event.target === modal) fecharNovoContato();
        });
        confirmar.addEventListener('click', confirmarNovoContato);

        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(verificarUsuarioDigitado, 280);
        });

        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                confirmarNovoContato();
            }
            if (event.key === 'Escape') {
                fecharNovoContato();
            }
        });
    }

    function atualizarEstado(validacao, status, foto, tipo, mensagem, corUsuario) {
        const elValidacao = document.getElementById('novo-contato-validacao');
        const elStatus = document.getElementById('novo-contato-status');
        const elFoto = document.getElementById('novo-contato-foto');
        const confirmar = document.querySelector('#modal-novo-contato .novo-contato-confirmar');

        if (!elValidacao || !elStatus || !elFoto || !confirmar) return;

        elValidacao.className = 'novo-contato-validacao ' + tipo;
        elValidacao.textContent = tipo === 'ok' ? '✓' : tipo === 'erro' ? '×' : '•';

        elStatus.className = 'novo-contato-status' + (tipo === 'ok' ? ' ok' : tipo === 'erro' ? ' erro' : '');
        elStatus.textContent = mensagem || '';

        if (typeof window.aplicarAvatarUsuario === 'function') {
            window.aplicarAvatarUsuario(elFoto, foto || '', corUsuario || '#3a3a3c');
        } else {
            elFoto.src = foto || 'svg/user-placeholder.svg';
            elFoto.style.backgroundColor = foto ? 'transparent' : (corUsuario || '#3a3a3c');
        }

        const valido = validacao === true;
        confirmar.disabled = !valido;
        confirmar.classList.toggle('desabilitado', !valido);
    }

    async function verificarUsuarioDigitado() {
        const input = document.getElementById('novo-contato-usuario');
        if (!input || !window._supabase) return;

        const usuario = input.value.trim();
        if (!usuario) {
            atualizarEstado(false, false, 'svg/user-placeholder.svg', 'vazio', '');
            return;
        }

        atualizarEstado(false, false, 'svg/user-placeholder.svg', 'vazio', 'Procurando...');

        const { data, error } = await window._supabase
            .from('usuarios')
            .select('usuario, foto_url, email, cor')
            .eq('usuario', usuario)
            .maybeSingle();

        // Evita que uma resposta antiga sobrescreva uma pesquisa mais nova.
        if (!document.getElementById('novo-contato-usuario') || input.value.trim() !== usuario) return;

        if (error) {
            console.error('[Novo contato] Erro ao verificar usuário:', error);
            atualizarEstado(false, false, 'svg/user-placeholder.svg', 'erro', 'Não foi possível verificar essa conta');
            return;
        }

        const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
        if (data && data.usuario && data.usuario.toLowerCase() === meuUsuario.toLowerCase()) {
            atualizarEstado(false, false, 'svg/user-placeholder.svg', 'erro', 'Você não pode adicionar a si mesmo');
            return;
        }

        if (data) {
            atualizarEstado(true, true, data.foto_url || '', 'ok', 'Essa pessoa ja tem uma conta WhatisApp', data.cor);
        } else {
            atualizarEstado(false, false, 'svg/user-placeholder.svg', 'erro', 'Essa pessoa não criou uma conta WhatisApp');
        }
    }

    async function confirmarNovoContato() {
        const input = document.getElementById('novo-contato-usuario');
        const confirmar = document.querySelector('#modal-novo-contato .novo-contato-confirmar');
        if (!input || !confirmar || confirmar.disabled || !window._supabase) return;

        const usuario = input.value.trim();
        if (!usuario) return;

        const { data, error } = await window._supabase
            .from('usuarios')
            .select('usuario')
            .eq('usuario', usuario)
            .maybeSingle();

        if (error || !data) {
            await verificarUsuarioDigitado();
            return;
        }

        const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
        if (data.usuario.toLowerCase() === meuUsuario.toLowerCase()) return;

        // Reaproveita a função original para manter o mesmo comportamento
        // de criação de contato que já existe no aplicativo.
        if (typeof adicionarNovoContato === 'function') {
            await adicionarNovoContato(data.usuario);
        }

        fecharNovoContato();
    }

    function fecharNovoContato() {
        const modal = document.getElementById('modal-novo-contato');
        if (!modal) return;

        modal.style.display = 'none';
        document.body.style.overflow = '';

        const input = document.getElementById('novo-contato-usuario');
        if (input) input.value = '';
        atualizarEstado(false, false, 'svg/user-placeholder.svg', 'vazio', '');
    }

    function abrirNovoContato() {
        criarEstilos();
        criarModal();

        const modal = document.getElementById('modal-novo-contato');
        const input = document.getElementById('novo-contato-usuario');
        if (!modal || !input) return;

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        setTimeout(() => input.focus(), 80);
    }

    // A função já usada pelo HTML continua existindo, mas agora abre o popup.
    window.pedirEmailContato = abrirNovoContato;
    window.abrirNovoContato = abrirNovoContato;
    window.fecharNovoContato = fecharNovoContato;
    window.confirmarNovoContato = confirmarNovoContato;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            criarEstilos();
            criarModal();
        }, { once: true });
    } else {
        criarEstilos();
        criarModal();
    }
})();
