// ==========================================
// FILA OFFLINE DE MENSAGENS DE TEXTO
// ==========================================
// Salva mensagens localmente quando a internet cai e envia em ordem
// assim que a conexão com o Supabase volta.

(function () {
    const PREFIXO_FILA = 'whatisapp_outbox_v1_';
    const INTERVALO_TENTATIVA_MS = 15000;

    let processando = false;
    let timerSincronizacao = null;
    let ultimaSincronizacao = 0;

    function supabaseAtual() {
        try {
            return typeof _supabase !== 'undefined' ? _supabase : null;
        } catch (e) {
            return null;
        }
    }

    function emailAtual() {
        return (localStorage.getItem('usuarioLogado') || '').trim().toLowerCase();
    }

    function chaveFila(email = emailAtual()) {
        return PREFIXO_FILA + String(email || '').toLowerCase();
    }

    function lerFila(email = emailAtual()) {
        if (!email) return [];

        try {
            const valor = JSON.parse(localStorage.getItem(chaveFila(email)) || '[]');
            return Array.isArray(valor) ? valor : [];
        } catch (e) {
            return [];
        }
    }

    function salvarFila(lista, email = emailAtual()) {
        if (!email) return;
        localStorage.setItem(chaveFila(email), JSON.stringify(lista || []));
    }

    function gerarIdLocal() {
        return (
            globalThis.crypto?.randomUUID?.() ||
            (
                Date.now().toString(36) +
                '-' +
                Math.random().toString(36).slice(2, 10)
            )
        );
    }

    function idMensagemLocal(idFila) {
        return 'offline:' + idFila;
    }

    function ehErroDeRede(error) {
        if (!navigator.onLine) return true;

        const mensagem = String(
            error?.message ||
            error?.details ||
            error?.hint ||
            error ||
            ''
        ).toLowerCase();

        return (
            mensagem.includes('failed to fetch') ||
            mensagem.includes('fetch failed') ||
            mensagem.includes('load failed') ||
            mensagem.includes('network') ||
            mensagem.includes('networkerror') ||
            mensagem.includes('connection') ||
            mensagem.includes('timeout') ||
            mensagem.includes('timed out') ||
            mensagem.includes('internet')
        );
    }

    function conversaDaPendencia(pendencia) {
        const cache = window.WhatisCache;

        if (pendencia.grupo_id) {
            return cache
                ? cache.conversaGrupo(pendencia.grupo_id)
                : (
                    'grupo|' +
                    pendencia.conta +
                    '|' +
                    String(pendencia.grupo_id)
                );
        }

        return cache
            ? cache.conversaPrivada(pendencia.destinatario_email)
            : (
                'privado|' +
                pendencia.conta +
                '|' +
                String(pendencia.destinatario_email || '').toLowerCase()
            );
    }

    function extensaoAudioPorMime(mime) {
        const tipo = String(mime || '').toLowerCase();
        if (tipo.includes('mp4')) return 'm4a';
        if (tipo.includes('ogg')) return 'ogg';
        if (tipo.includes('webm')) return 'webm';
        if (tipo.includes('mpeg')) return 'mp3';
        return 'webm';
    }

    function normalizarOndasAudio(amostras, quantidade = 44) {
        const fonte = Array.isArray(amostras) && amostras.length
            ? amostras
            : [0.18];

        const saida = [];

        for (let i = 0; i < quantidade; i++) {
            const inicio = Math.floor((i / quantidade) * fonte.length);
            let fim = Math.floor(((i + 1) / quantidade) * fonte.length);
            if (fim <= inicio) fim = inicio + 1;

            const pedaco = fonte.slice(inicio, fim);
            const media = pedaco.length
                ? pedaco.reduce((soma, valor) => soma + Number(valor || 0), 0) / pedaco.length
                : 0.18;

            saida.push(Math.max(0.10, Math.min(1, media)));
        }

        return saida;
    }

    async function salvarPendenteNoCache(pendencia) {
        if (!window.WhatisCache?.salvarMensagens) return;

        const ehAudio = pendencia.tipo === 'audio';

        const mensagemLocal = {
            id: idMensagemLocal(pendencia.fila_id),
            created_at: pendencia.created_at,
            remetente_email: pendencia.remetente_email,
            destinatario_email: pendencia.destinatario_email,
            grupo_id: pendencia.grupo_id,
            texto: ehAudio ? '[AUDIO_OFFLINE]' : pendencia.texto,
            tipo: ehAudio ? 'audio' : 'texto',
            audio_url: '',
            audio_duracao: ehAudio
                ? Math.max(1, Number(pendencia.audio_duracao) || 1)
                : null,
            audio_ondas: ehAudio
                ? normalizarOndasAudio(pendencia.audio_ondas)
                : null,
            mensagem_respondida_id: pendencia.mensagem_respondida_id,
            visualizada: false,
            meta: {
                offline_id: pendencia.fila_id,
                audio_key: pendencia.audio_key || null
            },
            _offline_pending: true
        };

        await window.WhatisCache.salvarMensagens(
            conversaDaPendencia(pendencia),
            [mensagemLocal]
        );
    }

    async function removerPendenteDoCache(pendencia) {
        const cache = window.WhatisCache;
        if (!cache?.removerMensagensPorIds) return;

        await cache.removerMensagensPorIds(
            conversaDaPendencia(pendencia),
            [idMensagemLocal(pendencia.fila_id)]
        );
    }

    async function salvarMensagemServidorNoCache(pendencia, mensagem) {
        if (!mensagem || !window.WhatisCache?.salvarMensagens) return;

        await window.WhatisCache.salvarMensagens(
            conversaDaPendencia(pendencia),
            [mensagem]
        );
    }

    function conversaAtualEhDaPendencia(pendencia) {
        if (pendencia.grupo_id) {
            return String(window.grupoAtualId || '') === String(pendencia.grupo_id);
        }

        let destinoAtual = '';
        try {
            destinoAtual = String(
                typeof destinatarioAtual !== 'undefined'
                    ? (destinatarioAtual || '')
                    : ''
            ).trim().toLowerCase();
        } catch (e) {}

        return destinoAtual === String(
            pendencia.destinatario_email || ''
        ).trim().toLowerCase();
    }

    function removerBalaoPendenteDaTela(pendencia) {
        const id = idMensagemLocal(pendencia.fila_id);
        const balao = document.querySelector(
            '#chat-mensagens .balao-msg[data-message-id="' + id + '"]'
        );

        const objectUrl = balao?.dataset?.audioObjectUrl || '';
        if (objectUrl.startsWith('blob:')) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        }

        balao?.remove();
    }

    async function garantirSolicitacaoPrimeiraMensagem(pendencia) {
        if (pendencia.grupo_id) return;

        const supabase = supabaseAtual();
        const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
        const destino = String(pendencia.destinatario_email || '').trim();

        if (!supabase || !meuUsuario || !destino) return;

        try {
            const { data: usuarioDestino, error: erroUsuario } = await supabase
                .from('usuarios')
                .select('email, usuario')
                .eq('email', destino)
                .maybeSingle();

            if (erroUsuario || !usuarioDestino?.usuario) return;

            const { data: contatoExistente, error: erroContato } = await supabase
                .from('contatos')
                .select('usuario_origem, contato_usuario')
                .eq('usuario_origem', usuarioDestino.usuario)
                .eq('contato_usuario', meuUsuario)
                .maybeSingle();

            if (erroContato || contatoExistente) return;

            const { data: solicitacaoExistente, error: erroSolicitacao } = await supabase
                .from('solicitacoes_chat')
                .select('id')
                .eq('remetente_email', pendencia.remetente_email)
                .eq('destinatario_email', destino)
                .eq('status', 'pendente')
                .maybeSingle();

            if (erroSolicitacao || solicitacaoExistente) return;

            await supabase
                .from('solicitacoes_chat')
                .insert([{
                    remetente_email: pendencia.remetente_email,
                    destinatario_email: destino,
                    status: 'pendente'
                }]);
        } catch (e) {
            console.warn('[Offline] Não foi possível verificar solicitação:', e);
        }
    }

    async function procurarMensagemJaEnviada(pendencia) {
        const supabase = supabaseAtual();
        if (!supabase) return null;

        try {
            const consulta = await supabase
                .from('mensagens')
                .select('*')
                .eq('remetente_email', pendencia.remetente_email)
                .contains('meta', { offline_id: pendencia.fila_id })
                .limit(1)
                .maybeSingle();

            if (consulta.error) return null;
            return consulta.data || null;
        } catch (e) {
            return null;
        }
    }

    async function enviarPendencia(pendencia) {
        const supabase = supabaseAtual();
        if (!supabase) {
            return { ok: false, rede: true };
        }

        // Evita duplicata caso a requisição tenha chegado ao servidor
        // mas a resposta tenha se perdido quando a conexão caiu.
        const existente = await procurarMensagemJaEnviada(pendencia);
        if (existente) {
            if (pendencia.tipo === 'audio' && pendencia.audio_key) {
                await window.WhatisCache?.removerMidiaPendente?.(pendencia.audio_key);
            }

            return { ok: true, mensagem: existente };
        }

        if (pendencia.tipo === 'audio') {
            const registroAudio = await window.WhatisCache?.obterMidiaPendente?.(
                pendencia.audio_key
            );

            const blob = registroAudio?.blob;

            if (!blob?.size) {
                return {
                    ok: false,
                    rede: false,
                    error: new Error('Áudio pendente não foi encontrado no armazenamento local.')
                };
            }

            const mime = pendencia.audio_mime || blob.type || 'audio/webm';
            const ext = extensaoAudioPorMime(mime);
            const pastaUsuario = pendencia.remetente_email.replace(/[^a-zA-Z0-9_-]/g, '_');
            const nomeArquivo =
                'audios/' + pastaUsuario + '/' +
                pendencia.fila_id + '.' + ext;

            try {
                const { error: erroUpload } = await supabase.storage
                    .from('midias')
                    .upload(nomeArquivo, blob, {
                        contentType: mime,
                        upsert: true
                    });

                if (erroUpload) {
                    return {
                        ok: false,
                        rede: ehErroDeRede(erroUpload),
                        error: erroUpload
                    };
                }

                const { data: urlData } = supabase.storage
                    .from('midias')
                    .getPublicUrl(nomeArquivo);

                const url = urlData?.publicUrl || '';

                if (!url) {
                    return {
                        ok: false,
                        rede: false,
                        error: new Error('Não foi possível obter a URL do áudio.')
                    };
                }

                const dadosAudio = {
                    texto: '[AUDIO]: ' + url,
                    tipo: 'audio',
                    audio_url: url,
                    audio_duracao: Math.max(1, Number(pendencia.audio_duracao) || 1),
                    audio_ondas: normalizarOndasAudio(pendencia.audio_ondas),
                    remetente_email: pendencia.remetente_email,
                    destinatario_email: pendencia.grupo_id
                        ? null
                        : pendencia.destinatario_email,
                    grupo_id: pendencia.grupo_id || null,
                    mensagem_respondida_id: pendencia.mensagem_respondida_id || null,
                    meta: {
                        offline_id: pendencia.fila_id,
                        origem: 'fila_offline_audio'
                    }
                };

                const { data, error } = await supabase
                    .from('mensagens')
                    .insert([dadosAudio])
                    .select('*')
                    .single();

                if (error) {
                    return {
                        ok: false,
                        rede: ehErroDeRede(error),
                        error
                    };
                }

                await window.WhatisCache?.removerMidiaPendente?.(
                    pendencia.audio_key
                );

                return {
                    ok: true,
                    mensagem: data
                };
            } catch (error) {
                return {
                    ok: false,
                    rede: true,
                    error
                };
            }
        }

        const dados = {
            texto: pendencia.texto,
            tipo: 'texto',
            remetente_email: pendencia.remetente_email,
            destinatario_email: pendencia.grupo_id
                ? null
                : pendencia.destinatario_email,
            grupo_id: pendencia.grupo_id || null,
            mensagem_respondida_id: pendencia.mensagem_respondida_id || null,
            meta: {
                offline_id: pendencia.fila_id
            }
        };

        try {
            const { data, error } = await supabase
                .from('mensagens')
                .insert([dados])
                .select('*')
                .single();

            if (error) {
                return {
                    ok: false,
                    rede: ehErroDeRede(error),
                    error
                };
            }

            return {
                ok: true,
                mensagem: data
            };
        } catch (error) {
            return {
                ok: false,
                rede: true,
                error
            };
        }
    }

    async function recarregarDadosDepoisDaRede() {
        const agora = Date.now();

        // Evita uma enxurrada de reloads se online/focus/pageshow vierem juntos.
        if (agora - ultimaSincronizacao < 800) return;
        ultimaSincronizacao = agora;

        try {
            if (typeof inscreverRealtime === 'function') {
                inscreverRealtime();
            }
        } catch (e) {}

        try {
            if (typeof carregarListaContatos === 'function') {
                await carregarListaContatos();
            }
        } catch (e) {
            console.warn('[Offline] Falha ao recarregar conversas:', e);
        }

        try {
            if (typeof window.carregarSolicitacoes === 'function') {
                await window.carregarSolicitacoes();
            }
        } catch (e) {}

        try {
            if (window.grupoAtualId && typeof carregarMensagensGrupo === 'function') {
                await carregarMensagensGrupo(window.grupoAtualId, true);
            } else {
                let temContato = false;

                try {
                    temContato = !!(
                        typeof destinatarioAtual !== 'undefined' &&
                        destinatarioAtual
                    );
                } catch (e) {}

                if (temContato && typeof carregarMensagens === 'function') {
                    await carregarMensagens(true);
                }
            }
        } catch (e) {
            console.warn('[Offline] Falha ao recarregar chat atual:', e);
        }
    }

    async function processarFila(motivo = 'tentativa') {
        if (processando || !navigator.onLine) return false;

        const conta = emailAtual();
        const supabase = supabaseAtual();

        if (!conta || !supabase) return false;

        let fila = lerFila(conta);
        if (!fila.length) {
            await recarregarDadosDepoisDaRede();
            return true;
        }

        processando = true;
        let enviouAlguma = false;

        try {
            while (fila.length && navigator.onLine) {
                const pendencia = fila[0];
                const resultado = await enviarPendencia(pendencia);

                if (!resultado.ok) {
                    if (!resultado.rede) {
                        console.error(
                            '[Offline] Mensagem pendente recusada pelo servidor:',
                            resultado.error
                        );
                    }

                    // Mantém na fila para não perder a mensagem.
                    break;
                }

                enviouAlguma = true;

                await removerPendenteDoCache(pendencia);
                removerBalaoPendenteDaTela(pendencia);
                await salvarMensagemServidorNoCache(
                    pendencia,
                    resultado.mensagem
                );

                fila.shift();
                salvarFila(fila, conta);

                await garantirSolicitacaoPrimeiraMensagem(pendencia);
            }
        } finally {
            processando = false;
        }

        if (navigator.onLine) {
            await recarregarDadosDepoisDaRede();
        }

        if (enviouAlguma && !fila.length) {
            try {
                if (typeof mostrarToastAcoesMensagem === 'function') {
                    mostrarToastAcoesMensagem('Mensagens pendentes enviadas.');
                }
            } catch (e) {}
        }

        return !fila.length;
    }

    async function colocarNaFila(dados, idFilaForcado = null) {
        const conta = emailAtual();
        if (!conta) return null;

        const idFila = idFilaForcado || gerarIdLocal();
        const pendencia = {
            fila_id: idFila,
            conta,
            created_at: dados.created_at || new Date().toISOString(),
            tipo: dados.tipo === 'audio' ? 'audio' : 'texto',
            texto: String(dados.texto || ''),
            remetente_email: conta,
            destinatario_email: dados.destinatario_email || null,
            grupo_id: dados.grupo_id || null,
            mensagem_respondida_id: dados.mensagem_respondida_id || null,
            audio_key: dados.audio_key || null,
            audio_mime: dados.audio_mime || null,
            audio_duracao: dados.audio_duracao || null,
            audio_ondas: Array.isArray(dados.audio_ondas)
                ? normalizarOndasAudio(dados.audio_ondas)
                : null
        };

        const fila = lerFila(conta);
        fila.push(pendencia);
        salvarFila(fila, conta);

        await salvarPendenteNoCache(pendencia);

        return pendencia;
    }

    async function atualizarInterfaceDepoisDeEnfileirar(pendencia) {
        const input = document.getElementById('input-mensagem');
        if (input) input.value = '';

        try {
            if (typeof cancelarResposta === 'function') {
                cancelarResposta();
            }
        } catch (e) {}

        if (pendencia.grupo_id) {
            if (typeof carregarMensagensGrupo === 'function') {
                await carregarMensagensGrupo(pendencia.grupo_id);
            }
        } else if (typeof carregarMensagens === 'function') {
            await carregarMensagens();
        }

        if (typeof carregarListaContatos === 'function') {
            try { carregarListaContatos(); } catch (e) {}
        }
    }

    async function enviarMensagemComFilaOffline() {
        const input = document.getElementById('input-mensagem');
        const texto = String(input?.value || '').trim();
        const conta = emailAtual();

        let contato = '';
        try {
            contato = String(
                typeof destinatarioAtual !== 'undefined'
                    ? (destinatarioAtual || '')
                    : ''
            ).trim();
        } catch (e) {}

        const grupoId = window.grupoAtualId || null;

        if (!texto || !conta || (!grupoId && !contato)) return;

        let respostaId = null;
        try {
            respostaId = typeof mensagemRespondendoId !== 'undefined'
                ? mensagemRespondendoId
                : null;
        } catch (e) {}

        // Não permite responder a uma mensagem que ainda não chegou ao servidor.
        if (
            respostaId !== null &&
            String(respostaId).startsWith('offline:')
        ) {
            respostaId = null;
        }

        const idFila = gerarIdLocal();

        const dados = {
            texto,
            tipo: 'texto',
            remetente_email: conta,
            destinatario_email: grupoId ? null : contato,
            grupo_id: grupoId,
            mensagem_respondida_id: respostaId,
            meta: {
                offline_id: idFila
            }
        };

        if (!navigator.onLine || lerFila(conta).length) {
            const pendencia = await colocarNaFila(dados, idFila);

            if (pendencia) {
                await atualizarInterfaceDepoisDeEnfileirar(pendencia);

                if (navigator.onLine) {
                    agendarTentativa('fila-existente-texto', 50);
                }
            }

            return;
        }

        const pendenciaTentativa = {
            fila_id: idFila,
            conta,
            created_at: new Date().toISOString(),
            tipo: 'texto',
            texto,
            remetente_email: conta,
            destinatario_email: grupoId ? null : contato,
            grupo_id: grupoId,
            mensagem_respondida_id: respostaId
        };

        const resultado = await enviarPendencia(pendenciaTentativa);

        if (!resultado.ok) {
            if (resultado.rede) {
                const fila = lerFila(conta);
                fila.push(pendenciaTentativa);
                salvarFila(fila, conta);
                await salvarPendenteNoCache(pendenciaTentativa);
                await atualizarInterfaceDepoisDeEnfileirar(pendenciaTentativa);
                return;
            }

            console.error('[Offline] Erro ao enviar mensagem:', resultado.error);
            alert(
                'Não foi possível enviar a mensagem.' +
                (
                    resultado.error?.message
                        ? '\n' + resultado.error.message
                        : ''
                )
            );
            return;
        }

        if (input) input.value = '';

        try {
            if (typeof cancelarResposta === 'function') {
                cancelarResposta();
            }
        } catch (e) {}

        await salvarMensagemServidorNoCache(
            pendenciaTentativa,
            resultado.mensagem
        );

        await garantirSolicitacaoPrimeiraMensagem(pendenciaTentativa);

        if (grupoId && typeof carregarMensagensGrupo === 'function') {
            await carregarMensagensGrupo(grupoId);
        } else if (typeof carregarMensagens === 'function') {
            await carregarMensagens();
        }

        if (typeof carregarListaContatos === 'function') {
            carregarListaContatos();
        }
    }

    async function enviarAudioComFilaOffline(blob, duracao, ondas, contexto = {}) {
        const conta = emailAtual();
        if (!conta || !blob?.size) return false;

        const grupoId = contexto.grupo_id || window.grupoAtualId || null;

        let contato = contexto.destinatario_email || null;
        if (!grupoId && !contato) {
            try {
                contato = (
                    typeof destinatarioAtual !== 'undefined'
                        ? destinatarioAtual
                        : ''
                ) || null;
            } catch (e) {}
        }

        if (!grupoId && !contato) return false;

        let respostaId =
            contexto.mensagem_respondida_id !== undefined
                ? contexto.mensagem_respondida_id
                : null;

        if (respostaId === null) {
            try {
                respostaId =
                    typeof mensagemRespondendoId !== 'undefined'
                        ? mensagemRespondendoId
                        : null;
            } catch (e) {}
        }

        if (
            respostaId !== null &&
            String(respostaId).startsWith('offline:')
        ) {
            respostaId = null;
        }

        const idFila = gerarIdLocal();
        const audioKey = 'audio:' + conta + ':' + idFila;
        const criadoEm = new Date().toISOString();

        const salvo = await window.WhatisCache?.salvarMidiaPendente?.({
            id: audioKey,
            conta,
            created_at: criadoEm,
            blob,
            mime: blob.type || contexto.audio_mime || 'audio/webm'
        });

        if (!salvo) {
            alert('Não foi possível guardar o áudio no aparelho.');
            return false;
        }

        const dados = {
            tipo: 'audio',
            created_at: criadoEm,
            destinatario_email: grupoId ? null : contato,
            grupo_id: grupoId,
            mensagem_respondida_id: respostaId,
            audio_key: audioKey,
            audio_mime: blob.type || contexto.audio_mime || 'audio/webm',
            audio_duracao: Math.max(1, Math.round(Number(duracao) || 1)),
            audio_ondas: normalizarOndasAudio(ondas)
        };

        const pendencia = {
            fila_id: idFila,
            conta,
            created_at: criadoEm,
            tipo: 'audio',
            texto: '',
            remetente_email: conta,
            destinatario_email: dados.destinatario_email,
            grupo_id: grupoId,
            mensagem_respondida_id: respostaId,
            audio_key: audioKey,
            audio_mime: dados.audio_mime,
            audio_duracao: dados.audio_duracao,
            audio_ondas: dados.audio_ondas
        };

        // Se já existe alguma mensagem mais antiga esperando, este áudio
        // entra atrás dela para manter a ordem da conversa.
        if (navigator.onLine && !lerFila(conta).length) {
            const resultado = await enviarPendencia(pendencia);

            if (resultado.ok) {
                await salvarMensagemServidorNoCache(
                    pendencia,
                    resultado.mensagem
                );

                await garantirSolicitacaoPrimeiraMensagem(pendencia);

                try {
                    if (typeof cancelarResposta === 'function') {
                        cancelarResposta();
                    }
                } catch (e) {}

                if (grupoId && typeof carregarMensagensGrupo === 'function') {
                    await carregarMensagensGrupo(grupoId);
                } else if (typeof carregarMensagens === 'function') {
                    await carregarMensagens();
                }

                if (typeof carregarListaContatos === 'function') {
                    carregarListaContatos();
                }

                return true;
            }

            if (!resultado.rede) {
                console.error('[Offline] Erro definitivo ao enviar áudio:', resultado.error);
                await window.WhatisCache?.removerMidiaPendente?.(audioKey);
                alert(
                    'Não foi possível enviar o áudio.' +
                    (resultado.error?.message ? '\n' + resultado.error.message : '')
                );
                return false;
            }
        }

        const fila = lerFila(conta);
        fila.push(pendencia);
        salvarFila(fila, conta);
        await salvarPendenteNoCache(pendencia);
        await atualizarInterfaceDepoisDeEnfileirar(pendencia);

        if (navigator.onLine) {
            agendarTentativa('fila-existente-audio', 50);
        }

        return true;
    }

    function agendarTentativa(motivo, delay = 350) {
        if (timerSincronizacao) {
            clearTimeout(timerSincronizacao);
        }

        timerSincronizacao = setTimeout(() => {
            timerSincronizacao = null;
            processarFila(motivo);
        }, delay);
    }

    window.WhatisOffline = {
        processarFila,
        lerFila,
        enviarAudio: enviarAudioComFilaOffline,
        quantidadePendente() {
            return lerFila().length;
        },
        tentarSincronizar() {
            return processarFila('manual');
        }
    };

    // Assume o envio de texto depois que script.js termina de configurar
    // o fluxo normal de contatos/solicitações.
    window.enviarMensagem = enviarMensagemComFilaOffline;

    window.addEventListener('online', () => {
        agendarTentativa('online', 250);
    });

    window.addEventListener('focus', () => {
        if (navigator.onLine) agendarTentativa('focus', 250);
    });

    window.addEventListener('pageshow', () => {
        if (navigator.onLine) agendarTentativa('pageshow', 300);
    });

    document.addEventListener('visibilitychange', () => {
        if (
            document.visibilityState === 'visible' &&
            navigator.onLine
        ) {
            agendarTentativa('visibility', 250);
        }
    });

    setInterval(() => {
        if (
            document.visibilityState === 'visible' &&
            navigator.onLine &&
            lerFila().length
        ) {
            processarFila('intervalo');
        }
    }, INTERVALO_TENTATIVA_MS);

    // Se o app abriu já com sinal, tenta esvaziar o que ficou da sessão anterior.
    setTimeout(() => {
        if (navigator.onLine) {
            processarFila('inicio');
        }
    }, 900);
})();
