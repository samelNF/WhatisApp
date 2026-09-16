// ==========================================
// CARREGADOR DO SCRIPT PRINCIPAL
// ==========================================
// O código original permanece em script-base.js.
// Este arquivo adiciona apenas os ajustes necessários
// para o novo fluxo de contatos/solicitações.

(function () {
    const base = document.createElement('script');
    base.src = './script-base.js';

    base.onload = function () {
        // O painel continua separado para não misturar
        // sua lógica com o script principal.
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

        // ==========================================
        // NOVO FLUXO DE CONTATOS / SOLICITAÇÕES
        // ==========================================

        // Adicionar contato agora é direto, sem criar solicitação.
        // Mantém o nome da função para não precisar alterar o HTML existente.
        window.pedirEmailContato = function () {
            const userDestino = prompt("Digite o nome de usuário que deseja adicionar:");
            if (!userDestino) return;

            const nomeDestino = userDestino.trim();
            const meuUsuario = (localStorage.getItem("nomeUsuario") || "").trim();

            if (!nomeDestino) return;

            if (nomeDestino.toLowerCase() === meuUsuario.toLowerCase()) {
                alert("Você não pode adicionar a si mesmo.");
                return;
            }

            adicionarNovoContato(nomeDestino);
        };

        // Verifica se o destinatário já salvou o remetente como contato.
        // Se não tiver, cria uma solicitação depois que a mensagem for enviada.
        window.verificarSolicitacaoPrimeiraMensagem = async function () {
            const meuEmail = localStorage.getItem("usuarioLogado");
            const meuUsuario = localStorage.getItem("nomeUsuario");
            const emailDestino = destinatarioAtual;

            if (!meuEmail || !meuUsuario || !emailDestino || window.grupoAtualId) {
                return;
            }

            const { data: usuarioDestino, error: erroUsuario } = await _supabase
                .from("usuarios")
                .select("email, usuario")
                .eq("email", emailDestino)
                .maybeSingle();

            if (erroUsuario || !usuarioDestino?.usuario) {
                console.error("Erro ao verificar contato do destinatário:", erroUsuario);
                return;
            }

            // O destinatário já salvou o remetente: conversa normal.
            const { data: contatoExistente, error: erroContato } = await _supabase
                .from("contatos")
                .select("usuario_origem, contato_usuario")
                .eq("usuario_origem", usuarioDestino.usuario)
                .eq("contato_usuario", meuUsuario)
                .maybeSingle();

            if (erroContato) {
                console.error("Erro ao verificar contato:", erroContato);
                return;
            }

            if (contatoExistente) return;

            // Evita criar várias solicitações para a mesma conversa.
            const { data: solicitacaoExistente } = await _supabase
                .from("solicitacoes_chat")
                .select("id, status")
                .eq("remetente_email", meuEmail)
                .eq("destinatario_email", emailDestino)
                .eq("status", "pendente")
                .maybeSingle();

            if (solicitacaoExistente) return;

            const { error: erroSolicitacao } = await _supabase
                .from("solicitacoes_chat")
                .insert([{
                    remetente_email: meuEmail,
                    destinatario_email: emailDestino,
                    status: "pendente"
                }]);

            if (erroSolicitacao) {
                console.error("Erro ao criar solicitação após primeira mensagem:", erroSolicitacao);
            } else {
                console.log("📨 Solicitação criada após a primeira mensagem.");
            }
        };

        // ==========================================
        // ENVIO DE TEXTO
        // ==========================================
        const enviarMensagemOriginal = window.enviarMensagem;

        window.enviarMensagem = async function () {
            const inputMsg = document.getElementById("input-mensagem");
            const texto = inputMsg ? inputMsg.value.trim() : "";
            const meuEmail = localStorage.getItem("usuarioLogado");

            if (!texto) return;

            const dadosMensagem = {
                texto: texto,
                remetente_email: meuEmail,
                grupo_id: window.grupoAtualId ? window.grupoAtualId : null,
                destinatario_email: window.grupoAtualId ? null : destinatarioAtual,
                mensagem_respondida_id: mensagemRespondendoId
            };

            const { error } = await _supabase
                .from("mensagens")
                .insert([dadosMensagem]);

            if (error) {
                console.error("Erro ao enviar mensagem:", error.message);
                alert("Erro ao enviar mensagem.");
                return;
            }

            if (inputMsg) inputMsg.value = "";
            cancelarResposta();

            // A mensagem já foi salva. Agora verifica se precisa gerar solicitação.
            await verificarSolicitacaoPrimeiraMensagem();

            if (window.grupoAtualId) {
                carregarMensagensGrupo(window.grupoAtualId);
            } else if (typeof carregarMensagens === 'function') {
                carregarMensagens();
            }
        };

        // ==========================================
        // ENVIO DE MÍDIA
        // ==========================================
        const enviarMidiaOriginal = window.enviarMidia;
        const enviarFotoChatOriginal = window.enviarFotoChat;

        async function enviarMidiaComSolicitacao(event, prefixoForcado) {
            const arquivo = event.target.files[0];
            if (!arquivo) return;

            const meuEmail = localStorage.getItem("usuarioLogado");
            const nomeArquivo = `${Date.now()}_${arquivo.name}`;

            const { error: erroUpload } = await _supabase.storage
                .from("midias")
                .upload(nomeArquivo, arquivo);

            if (erroUpload) {
                console.error("Erro no upload:", erroUpload.message);
                alert("Erro ao enviar arquivo.");
                return;
            }

            const { data: urlData } = _supabase.storage
                .from("midias")
                .getPublicUrl(nomeArquivo);

            const urlPublica = urlData.publicUrl;
            const ehVideo = arquivo.type.startsWith("video/");
            const prefixo = prefixoForcado || (ehVideo ? "[VIDEO]:" : "[FOTO]:");

            const dadosMensagem = {
                texto: `${prefixo} ${urlPublica}`,
                remetente_email: meuEmail,
                grupo_id: window.grupoAtualId ? window.grupoAtualId : null,
                destinatario_email: window.grupoAtualId ? null : destinatarioAtual
            };

            const { error } = await _supabase
                .from("mensagens")
                .insert([dadosMensagem]);

            if (error) {
                console.error("Erro ao salvar mídia:", error.message);
                alert("Erro ao enviar arquivo.");
                return;
            }

            event.target.value = "";

            await verificarSolicitacaoPrimeiraMensagem();

            if (window.grupoAtualId) {
                carregarMensagensGrupo(window.grupoAtualId);
            } else if (typeof carregarMensagens === 'function') {
                carregarMensagens();
            }
        }

        window.enviarMidia = function (event) {
            return enviarMidiaComSolicitacao(event, null);
        };

        window.enviarFotoChat = function (event) {
            return enviarMidiaComSolicitacao(event, null);
        };

        // ==========================================
        // SOLICITAÇÕES
        // ==========================================
        window.carregarSolicitacoes = async function () {
            const meuEmail = localStorage.getItem("usuarioLogado");
            if (!meuEmail || !_supabase) return;

            const badgeSolicitacoes = document.getElementById('badge-solicitacoes');
            const contadorMenu = document.getElementById('contador-menu');
            const listaSolicitacoes = document.getElementById('lista-solicitacoes');
            const msgSemSolicitacoes = document.getElementById('msg-sem-solicitacoes');

            const { data: solicitacoes, error } = await _supabase
                .from('solicitacoes_chat')
                .select('*')
                .eq('destinatario_email', meuEmail)
                .eq('status', 'pendente');

            if (error) {
                console.error('Erro ao buscar solicitações:', error);
                return;
            }

            const total = solicitacoes ? solicitacoes.length : 0;

            if (contadorMenu) contadorMenu.textContent = total;
            if (badgeSolicitacoes) {
                badgeSolicitacoes.textContent = total;
                badgeSolicitacoes.classList.toggle('hidden', total === 0);
            }

            if (!listaSolicitacoes) return;
            listaSolicitacoes.innerHTML = '';

            if (total === 0) {
                if (msgSemSolicitacoes) msgSemSolicitacoes.classList.remove('hidden');
                return;
            }

            if (msgSemSolicitacoes) msgSemSolicitacoes.classList.add('hidden');

            for (const solicitacao of solicitacoes) {
                const li = document.createElement('li');
                li.className = 'solicitacao-item';

                let nomeRemetente = solicitacao.remetente_email;
                let fotoRemetente = 'svg/icon.svg';

                const { data: usuarioRemetente } = await _supabase
                    .from('usuarios')
                    .select('usuario, foto_url')
                    .eq('email', solicitacao.remetente_email)
                    .maybeSingle();

                if (usuarioRemetente) {
                    nomeRemetente = usuarioRemetente.usuario || nomeRemetente;
                    fotoRemetente = usuarioRemetente.foto_url || fotoRemetente;
                }

                li.innerHTML = `
                    <div class="user-info">
                        <strong>${nomeRemetente}</strong>
                        <p>Enviou uma mensagem</p>
                    </div>
                    <button class="btn-abrir-pedido">Ver</button>
                `;

                li.querySelector('.btn-abrir-pedido').addEventListener('click', () => {
                    abrirChatSolicitacao(solicitacao);
                });

                listaSolicitacoes.appendChild(li);
            }
        };

        window.abrirChatSolicitacao = async function (solicitacao) {
            solicitacaoAtual = solicitacao;

            const modalSolicitacoes = document.getElementById('modal-solicitacoes');
            const chatInputBox = document.getElementById('chat-input-box');
            const chatActionBar = document.getElementById('chat-action-bar');
            const telaChat = document.getElementById("tela-chat");
            const container = document.getElementById("chat-mensagens");
            const elemNome = document.getElementById("chat-nome-usuario");
            const elemFoto = document.getElementById("chat-foto-usuario");

            if (modalSolicitacoes) modalSolicitacoes.classList.add('hidden');
            if (chatInputBox) chatInputBox.classList.add('hidden');
            if (chatActionBar) chatActionBar.classList.remove('hidden');

            destinatarioAtual = solicitacao.remetente_email;
            window.grupoAtualId = null;

            const { data: usuarioRemetente } = await _supabase
                .from('usuarios')
                .select('usuario, foto_url')
                .eq('email', solicitacao.remetente_email)
                .maybeSingle();

            if (elemNome) elemNome.innerText = usuarioRemetente?.usuario || solicitacao.remetente_email;
            if (elemFoto) elemFoto.src = usuarioRemetente?.foto_url || 'svg/icon.svg';

            if (telaChat) {
                telaChat.style.display = "flex";
                setTimeout(() => telaChat.classList.add("ativa"), 10);
            }

            if (container) container.innerHTML = "";

            // Mostra as mensagens reais que já foram enviadas antes da aceitação.
            await carregarMensagens();
        };

        window.aceitarSolicitacaoAtual = async function () {
            if (!solicitacaoAtual) return;

            const meuEmail = localStorage.getItem("usuarioLogado");
            const meuUsuario = localStorage.getItem("nomeUsuario");
            const emailRemetente = solicitacaoAtual.remetente_email;

            const { data: usuarioRemetente, error: erroUsuario } = await _supabase
                .from('usuarios')
                .select('usuario')
                .eq('email', emailRemetente)
                .maybeSingle();

            if (erroUsuario || !usuarioRemetente?.usuario) {
                console.error('Erro ao buscar remetente:', erroUsuario);
                return;
            }

            const { error: errorStatus } = await _supabase
                .from('solicitacoes_chat')
                .update({ status: 'aceito' })
                .eq('id', solicitacaoAtual.id);

            if (errorStatus) {
                console.error('Erro ao aceitar:', errorStatus);
                return;
            }

            // Salva os dois lados como contatos, usando os nomes de usuário
            // que a tabela contatos espera.
            const { error: erroContato1 } = await _supabase
                .from('contatos')
                .insert([{
                    usuario_origem: meuUsuario,
                    contato_usuario: usuarioRemetente.usuario
                }]);

            if (erroContato1 && erroContato1.code !== '23505') {
                console.error('Erro ao salvar contato do destinatário:', erroContato1);
            }

            const { error: erroContato2 } = await _supabase
                .from('contatos')
                .insert([{
                    usuario_origem: usuarioRemetente.usuario,
                    contato_usuario: meuUsuario
                }]);

            if (erroContato2 && erroContato2.code !== '23505') {
                console.error('Erro ao salvar contato do remetente:', erroContato2);
            }

            const chatActionBar = document.getElementById('chat-action-bar');
            const chatInputBox = document.getElementById('chat-input-box');

            if (chatActionBar) chatActionBar.classList.add('hidden');
            if (chatInputBox) chatInputBox.classList.remove('hidden');

            await carregarMensagens();

            solicitacaoAtual = null;
            carregarSolicitacoes();
            carregarListaContatos();
        };

        // Guarda referências apenas para deixar claro que as funções antigas
        // continuam existindo no script-base e só foram interceptadas aqui.
        void enviarMensagemOriginal;
        void enviarMidiaOriginal;
        void enviarFotoChatOriginal;
    };

    base.onerror = function () {
        console.error('Erro ao carregar o script principal do WhatisApp.');
    };

    document.head.appendChild(base);
})();
