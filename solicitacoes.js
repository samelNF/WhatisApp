// ==========================================
// FLUXO DE SOLICITAÇÕES DE CONVERSA
// ==========================================
// Este arquivo entra DEPOIS do script principal.
// Ele mantém o restante do aplicativo intacto e só corrige
// o fluxo de mensagens -> solicitação -> aceitação.

(function iniciarFluxoSolicitacoes() {
    function iniciar() {
        if (typeof _supabase === 'undefined' || !_supabase) {
            console.error('[Solicitações] Supabase ainda não disponível.');
            return;
        }

        // ------------------------------------------
        // Cria/garante uma solicitação para uma conversa privada.
        // Não cria outra se já existir uma pendente ou aceita.
        // ------------------------------------------
        window.garantirSolicitacaoConversa = async function () {
            const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim();
            const emailDestino = (window.destinatarioAtual || (typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : '') || '').trim();

            if (!meuEmail || !emailDestino || window.grupoAtualId) return false;
            if (meuEmail.toLowerCase() === emailDestino.toLowerCase()) return false;

            // Se já existe contato entre os dois, não há solicitação para mostrar.
            const { data: meuUsuarioData, error: erroMeuUsuario } = await _supabase
                .from('usuarios')
                .select('usuario')
                .eq('email', meuEmail)
                .maybeSingle();

            const { data: destinoData, error: erroDestino } = await _supabase
                .from('usuarios')
                .select('usuario')
                .eq('email', emailDestino)
                .maybeSingle();

            if (erroMeuUsuario || erroDestino || !meuUsuarioData?.usuario || !destinoData?.usuario) {
                console.error('[Solicitações] Não foi possível localizar os usuários.', erroMeuUsuario, erroDestino);
                return false;
            }

            const { data: contato, error: erroContato } = await _supabase
                .from('contatos')
                .select('usuario_origem')
                .eq('usuario_origem', destinoData.usuario)
                .eq('contato_usuario', meuUsuarioData.usuario)
                .maybeSingle();

            if (erroContato) {
                console.error('[Solicitações] Erro verificando contato:', erroContato);
                return false;
            }

            // Se o destinatário já adicionou o remetente, conversa normal.
            if (contato) {
                await atualizarContadorSolicitacoes();
                return false;
            }

            // Procura QUALQUER solicitação ainda útil dessa conversa.
            const { data: existentes, error: erroSolicitacoes } = await _supabase
                .from('solicitacoes_chat')
                .select('id, status, remetente_email, destinatario_email')
                .eq('remetente_email', meuEmail)
                .eq('destinatario_email', emailDestino)
                .in('status', ['pendente', 'aceito'])
                .limit(1);

            if (erroSolicitacoes) {
                console.error('[Solicitações] Erro procurando solicitação:', erroSolicitacoes);
                return false;
            }

            // Já existe uma pendente: ela continua lá até ser aceita.
            if (existentes && existentes.length > 0) {
                await atualizarContadorSolicitacoes();
                return existentes[0].status === 'pendente';
            }

            const { error: erroInserir } = await _supabase
                .from('solicitacoes_chat')
                .insert([{
                    remetente_email: meuEmail,
                    destinatario_email: emailDestino,
                    status: 'pendente'
                }]);

            if (erroInserir) {
                console.error('[Solicitações] ERRO AO CRIAR SOLICITAÇÃO:', erroInserir);
                return false;
            }

            console.log('[Solicitações] ✅ Solicitação criada para', emailDestino);
            await atualizarContadorSolicitacoes();
            return true;
        };

        // ------------------------------------------
        // Envio de texto: salva a mensagem PRIMEIRO e,
        // se não houver contato, mantém a conversa como pendente.
        // ------------------------------------------
        window.enviarMensagem = async function () {
            const input = document.getElementById('input-mensagem');
            const texto = input ? input.value.trim() : '';
            const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim();
            const emailDestino = (window.destinatarioAtual || (typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : '') || '').trim();
            const grupo = window.grupoAtualId || null;

            if (!texto || !meuEmail || (!emailDestino && !grupo)) return;

            const dados = {
                texto,
                remetente_email: meuEmail,
                grupo_id: grupo,
                destinatario_email: grupo ? null : emailDestino,
                mensagem_respondida_id: typeof mensagemRespondendoId !== 'undefined' ? mensagemRespondendoId : null
            };

            const { error } = await _supabase.from('mensagens').insert([dados]);
            if (error) {
                console.error('[Mensagens] Erro ao enviar:', error);
                alert('Erro ao enviar mensagem.');
                return;
            }

            if (input) input.value = '';
            if (typeof cancelarResposta === 'function') cancelarResposta();

            if (!grupo) {
                await window.garantirSolicitacaoConversa();
            }

            if (grupo && typeof carregarMensagensGrupo === 'function') {
                carregarMensagensGrupo(grupo);
            } else if (typeof carregarMensagens === 'function') {
                carregarMensagens();
            }
        };

        // Enter precisa usar a função global nova.
        window.checarEnter = function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                window.enviarMensagem();
            }
        };

        // ------------------------------------------
        // Busca as solicitações recebidas pelo EMAIL logado.
        // ------------------------------------------
        window.carregarSolicitacoes = async function () {
            const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim();
            if (!meuEmail) return;

            const { data, error } = await _supabase
                .from('solicitacoes_chat')
                .select('*')
                .eq('destinatario_email', meuEmail)
                .eq('status', 'pendente')
                .order('id', { ascending: false });

            if (error) {
                console.error('[Solicitações] ERRO AO BUSCAR:', error);
                return;
            }

            const lista = document.getElementById('lista-solicitacoes');
            const vazio = document.getElementById('msg-sem-solicitacoes');
            const badge = document.getElementById('badge-solicitacoes');
            const contador = document.getElementById('contador-menu');
            const total = data ? data.length : 0;

            if (badge) {
                badge.textContent = total;
                badge.classList.toggle('hidden', total === 0);
            }
            if (contador) contador.textContent = total;

            if (!lista) return;
            lista.innerHTML = '';

            if (!total) {
                if (vazio) vazio.classList.remove('hidden');
                return;
            }

            if (vazio) vazio.classList.add('hidden');

            for (const solicitacao of data) {
                const li = document.createElement('li');
                li.className = 'solicitacao-item';

                let nome = solicitacao.remetente_email;
                let foto = '';
                let cor = '#3a3a3c';

                const { data: remetente } = await _supabase
                    .from('usuarios')
                    .select('usuario, foto_url, cor')
                    .eq('email', solicitacao.remetente_email)
                    .maybeSingle();

                if (remetente) {
                    nome = remetente.usuario || nome;
                    foto = remetente.foto_url || '';
                    cor = remetente.cor || cor;
                }

                li.innerHTML = `
                    <img src="" class="foto-contato" style="width:42px;height:42px;border-radius:50%;">
                    <div class="user-info">
                        <strong>${nome}</strong>
                        <p>Enviou uma mensagem</p>
                    </div>
                    <button class="btn-abrir-pedido">Ver</button>
                `;

                const avatar = li.querySelector('.foto-contato');
                if (typeof window.aplicarAvatarUsuario === 'function') {
                    window.aplicarAvatarUsuario(avatar, foto, cor);
                } else if (avatar) {
                    avatar.src = foto || 'svg/user-placeholder.svg';
                    avatar.style.backgroundColor = foto ? 'transparent' : cor;
                }

                li.querySelector('.btn-abrir-pedido').addEventListener('click', () => {
                    window.abrirChatSolicitacao(solicitacao);
                });

                lista.appendChild(li);
            }
        };

        // Atualiza badge/contador mesmo quando o modal não está aberto.
        window.atualizarContadorSolicitacoes = async function () {
            const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim();
            if (!meuEmail) return;

            const { data, error } = await _supabase
                .from('solicitacoes_chat')
                .select('id')
                .eq('destinatario_email', meuEmail)
                .eq('status', 'pendente');

            if (error) {
                console.error('[Solicitações] Erro no contador:', error);
                return;
            }

            const total = data ? data.length : 0;
            const badge = document.getElementById('badge-solicitacoes');
            const contador = document.getElementById('contador-menu');

            if (badge) {
                badge.textContent = total;
                badge.classList.toggle('hidden', total === 0);
            }
            if (contador) contador.textContent = total;
        };

        // ------------------------------------------
        // Abrir pedido mostra as mensagens reais.
        // ------------------------------------------
        window.abrirChatSolicitacao = async function (solicitacao) {
            window.solicitacaoAtual = solicitacao;
            // Mantém também a variável lexical usada pelo código antigo.
            try { solicitacaoAtual = solicitacao; } catch (e) {}

            const modal = document.getElementById('modal-solicitacoes');
            const inputBox = document.getElementById('chat-input-box');
            const actionBar = document.getElementById('chat-action-bar');
            const tela = document.getElementById('tela-chat');

            if (modal) modal.classList.add('hidden');
            if (inputBox) inputBox.classList.add('hidden');
            if (actionBar) actionBar.classList.remove('hidden');

            try { destinatarioAtual = solicitacao.remetente_email; } catch (e) {}
            window.destinatarioAtual = solicitacao.remetente_email;
            window.grupoAtualId = null;

            const { data: remetente } = await _supabase
                .from('usuarios')
                .select('usuario, foto_url, cor')
                .eq('email', solicitacao.remetente_email)
                .maybeSingle();

            const nome = document.getElementById('chat-nome-usuario');
            const foto = document.getElementById('chat-foto-usuario');
            if (nome) nome.innerText = remetente?.usuario || solicitacao.remetente_email;
            if (typeof window.aplicarAvatarUsuario === 'function') {
                window.aplicarAvatarUsuario(foto, remetente?.foto_url || '', remetente?.cor || '#3a3a3c');
            } else if (foto) {
                foto.src = remetente?.foto_url || 'svg/user-placeholder.svg';
                foto.style.backgroundColor = remetente?.foto_url ? 'transparent' : (remetente?.cor || '#3a3a3c');
            }

            if (tela) {
                tela.style.display = 'flex';
                setTimeout(() => tela.classList.add('ativa'), 10);
            }

            if (typeof carregarMensagens === 'function') await carregarMensagens();
        };

        // ------------------------------------------
        // Aceitar: só aqui a solicitação sai da lista.
        // ------------------------------------------
        window.aceitarSolicitacaoAtual = async function () {
            const solicitacao = window.solicitacaoAtual || (typeof solicitacaoAtual !== 'undefined' ? solicitacaoAtual : null);
            if (!solicitacao) return;

            const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim();
            const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();

            const { data: remetente, error: erroRemetente } = await _supabase
                .from('usuarios')
                .select('usuario')
                .eq('email', solicitacao.remetente_email)
                .maybeSingle();

            if (erroRemetente || !remetente?.usuario) {
                console.error('[Solicitações] Erro buscando remetente:', erroRemetente);
                return;
            }

            const { error: erroStatus } = await _supabase
                .from('solicitacoes_chat')
                .update({ status: 'aceito' })
                .eq('id', solicitacao.id)
                .eq('destinatario_email', meuEmail);

            if (erroStatus) {
                console.error('[Solicitações] Erro aceitando:', erroStatus);
                return;
            }

            // Cria os dois lados do contato. Duplicata é ignorada.
            const pares = [
                { usuario_origem: meuUsuario, contato_usuario: remetente.usuario },
                { usuario_origem: remetente.usuario, contato_usuario: meuUsuario }
            ];

            for (const par of pares) {
                const { error } = await _supabase.from('contatos').insert([par]);
                if (error && error.code !== '23505') {
                    console.error('[Solicitações] Erro criando contato:', error);
                }
            }

            if (document.getElementById('chat-action-bar')) document.getElementById('chat-action-bar').classList.add('hidden');
            if (document.getElementById('chat-input-box')) document.getElementById('chat-input-box').classList.remove('hidden');

            window.solicitacaoAtual = null;
            try { solicitacaoAtual = null; } catch (e) {}

            await window.carregarSolicitacoes();
            if (typeof carregarListaContatos === 'function') carregarListaContatos();
        };

        // ------------------------------------------
        // Ignorar: também tira a solicitação da lista,
        // mas NÃO transforma o usuário em contato.
        // ------------------------------------------
        window.ignorarSolicitacaoAtual = async function () {
            const solicitacao = window.solicitacaoAtual || (typeof solicitacaoAtual !== 'undefined' ? solicitacaoAtual : null);
            if (!solicitacao) return;

            const { error } = await _supabase
                .from('solicitacoes_chat')
                .update({ status: 'ignorado' })
                .eq('id', solicitacao.id);

            if (error) {
                console.error('[Solicitações] Erro ignorando:', error);
                return;
            }

            window.solicitacaoAtual = null;
            try { solicitacaoAtual = null; } catch (e) {}

            const actionBar = document.getElementById('chat-action-bar');
            const inputBox = document.getElementById('chat-input-box');
            if (actionBar) actionBar.classList.add('hidden');
            if (inputBox) inputBox.classList.add('hidden');

            if (typeof window.carregarSolicitacoes === 'function') await window.carregarSolicitacoes();
        };

        // ------------------------------------------
        // O script-base já colocou listeners antigos.
        // Clonamos apenas os botões necessários para garantir
        // que eles chamem as funções novas.
        // ------------------------------------------
        function substituirBotao(id, callback, marca) {
            const antigo = document.getElementById(id);
            if (!antigo || antigo.dataset[marca]) return;
            const novo = antigo.cloneNode(true);
            novo.dataset[marca] = 'true';
            novo.addEventListener('click', callback);
            antigo.parentNode.replaceChild(novo, antigo);
        }

        substituirBotao('btn-abrir-solicitacoes', () => {
            const menu = document.getElementById('dropdown-menu');
            const modal = document.getElementById('modal-solicitacoes');
            if (menu) menu.classList.add('hidden');
            if (modal) modal.classList.remove('hidden');
            window.carregarSolicitacoes();
        }, 'fluxoSolicitacoesFinal');

        substituirBotao('btn-aceitar-solicitacao', () => window.aceitarSolicitacaoAtual(), 'fluxoAceitarFinal');
        substituirBotao('btn-ignorar-solicitacao', () => window.ignorarSolicitacaoAtual(), 'fluxoIgnorarFinal');

        // Mostra imediatamente se já existe pedido pendente.
        atualizarContadorSolicitacoes();

        // Realtime para solicitação nova e alteração de status.
        const canalSolicitacoes = _supabase.channel('solicitacoes-' + Date.now());
        canalSolicitacoes
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'solicitacoes_chat'
            }, () => {
                atualizarContadorSolicitacoes();
                const modal = document.getElementById('modal-solicitacoes');
                if (modal && !modal.classList.contains('hidden')) window.carregarSolicitacoes();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') console.log('[Solicitações] ✅ Realtime conectado.');
            });
    }

    // script.js carrega script-base dinamicamente. Espera ele terminar.
    const tentativas = setInterval(() => {
        if (typeof _supabase !== 'undefined' && _supabase) {
            clearInterval(tentativas);
            iniciar();
        }
    }, 100);

    setTimeout(() => clearInterval(tentativas), 15000);
})();
