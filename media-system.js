// ==========================================
// ENVIO DE MÍDIA - WHATISAPP
// ==========================================
// Centraliza fotos, vídeos e documentos enviados pelo chat.
// Mantém compatibilidade com o fluxo antigo (enviarFotoChat/enviarMidia)
// e com a câmera integrada.

(function () {
    const MAX_ARQUIVOS_POR_ENVIO = 10;

    function supabaseAtual() {
        try {
            return typeof _supabase !== 'undefined' ? _supabase : null;
        } catch (e) {
            return null;
        }
    }

    function meuEmail() {
        return (localStorage.getItem('usuarioLogado') || '').trim();
    }

    function grupoAtual() {
        return window.grupoAtualId || null;
    }

    function destinatarioPrivado() {
        if (grupoAtual()) return null;

        try {
            return (typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : '') || '';
        } catch (e) {
            return '';
        }
    }

    function respostaAtual() {
        try {
            return typeof mensagemRespondendoId !== 'undefined'
                ? mensagemRespondendoId
                : null;
        } catch (e) {
            return null;
        }
    }

    function sanitizarNomeArquivo(nome) {
        return String(nome || 'arquivo')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(-120) || 'arquivo';
    }

    function classificarArquivo(arquivo) {
        const mime = String(arquivo?.type || '').toLowerCase();

        if (mime.startsWith('image/')) {
            return {
                tipo: 'imagem',
                marcador: '[FOTO]:'
            };
        }

        if (mime.startsWith('video/')) {
            return {
                tipo: 'video',
                marcador: '[VIDEO]:'
            };
        }

        return {
            tipo: 'arquivo',
            marcador: '[ARQUIVO]:'
        };
    }

    function extensaoArquivo(arquivo) {
        const nome = String(arquivo?.name || '');
        const ponto = nome.lastIndexOf('.');
        if (ponto >= 0 && ponto < nome.length - 1) {
            return nome.slice(ponto + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        const mime = String(arquivo?.type || '').toLowerCase();
        if (mime.includes('pdf')) return 'pdf';
        if (mime.includes('zip')) return 'zip';
        if (mime.includes('json')) return 'json';
        if (mime.includes('text')) return 'txt';
        if (mime.includes('jpeg')) return 'jpg';
        if (mime.includes('png')) return 'png';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('mp4')) return 'mp4';
        if (mime.includes('webm')) return 'webm';
        return 'bin';
    }

    function pastaUsuario(email) {
        return String(email || 'usuario')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_');
    }

    function nomeNoStorage(arquivo, email) {
        const agora = new Date();
        const ano = agora.getFullYear();
        const mes = String(agora.getMonth() + 1).padStart(2, '0');
        const id =
            (globalThis.crypto?.randomUUID?.() || (
                Date.now().toString(36) +
                Math.random().toString(36).slice(2)
            ));

        const nomeOriginal = sanitizarNomeArquivo(arquivo?.name || 'arquivo');
        const ext = extensaoArquivo(arquivo);
        const semExtensao = nomeOriginal.replace(/\.[^.]+$/, '').slice(0, 60) || 'arquivo';

        return (
            'mensagens/' +
            pastaUsuario(email) + '/' +
            ano + '/' +
            mes + '/' +
            id + '_' +
            semExtensao + '.' +
            ext
        );
    }

    function textoMensagemMidia(classificacao, url, arquivo) {
        if (classificacao.tipo !== 'arquivo') {
            return classificacao.marcador + ' ' + url;
        }

        const pacote = {
            url,
            nome: String(arquivo?.name || 'Documento'),
            tamanho: Number(arquivo?.size || 0),
            mime: String(arquivo?.type || 'application/octet-stream')
        };

        return '[ARQUIVO]:' + encodeURIComponent(JSON.stringify(pacote));
    }

    function obterOuCriarStatus() {
        let painel = document.getElementById('midia-upload-status');

        if (!painel) {
            painel = document.createElement('div');
            painel.id = 'midia-upload-status';
            painel.className = 'midia-upload-status hidden';
            painel.innerHTML = `
                <div class="midia-upload-status-texto">
                    <strong id="midia-upload-status-titulo">Enviando mídia...</strong>
                    <span id="midia-upload-status-detalhe"></span>
                </div>
                <div class="midia-upload-status-trilho">
                    <span id="midia-upload-status-barra"></span>
                </div>
            `;
            document.body.appendChild(painel);
        }

        return painel;
    }

    function atualizarStatus(indice, total, arquivo, estado = 'enviando') {
        const painel = obterOuCriarStatus();
        const titulo = painel.querySelector('#midia-upload-status-titulo');
        const detalhe = painel.querySelector('#midia-upload-status-detalhe');
        const barra = painel.querySelector('#midia-upload-status-barra');

        painel.classList.remove('hidden');

        if (titulo) {
            titulo.textContent =
                estado === 'erro'
                    ? 'Não foi possível enviar'
                    : (total > 1 ? 'Enviando mídias...' : 'Enviando mídia...');
        }

        if (detalhe) {
            detalhe.textContent =
                (indice + 1) + ' de ' + total +
                (arquivo?.name ? ' · ' + arquivo.name : '');
        }

        if (barra) {
            const progressoBase = total ? (indice / total) * 100 : 0;
            const progresso =
                estado === 'concluido'
                    ? 100
                    : Math.max(4, Math.min(96, progressoBase + (100 / Math.max(1, total)) * 0.65));

            barra.style.width = progresso + '%';
        }
    }

    function esconderStatus(delay = 500) {
        const painel = document.getElementById('midia-upload-status');
        if (!painel) return;

        setTimeout(() => {
            painel.classList.add('hidden');
            const barra = painel.querySelector('#midia-upload-status-barra');
            if (barra) barra.style.width = '0%';
        }, delay);
    }

    async function salvarNoCache(mensagem, grupoId, contato) {
        if (!mensagem || !window.WhatisCache?.salvarMensagens) return;

        try {
            const chave = grupoId
                ? window.WhatisCache.conversaGrupo(grupoId)
                : window.WhatisCache.conversaPrivada(contato);

            await window.WhatisCache.salvarMensagens(chave, [mensagem]);
        } catch (e) {
            console.warn('[Mídia] Não foi possível atualizar o cache:', e);
        }
    }

    async function enviarUmArquivo(arquivo, contexto, indice, total) {
        const supabase = supabaseAtual();
        if (!supabase || !arquivo) return null;

        const classificacao = classificarArquivo(arquivo);
        const caminho = nomeNoStorage(arquivo, contexto.email);

        atualizarStatus(indice, total, arquivo);

        const opcoesUpload = {
            upsert: false
        };

        if (arquivo.type) {
            opcoesUpload.contentType = arquivo.type;
        }

        const { error: erroUpload } = await supabase.storage
            .from('midias')
            .upload(caminho, arquivo, opcoesUpload);

        if (erroUpload) {
            console.error('[Mídia] Upload falhou:', erroUpload);
            atualizarStatus(indice, total, arquivo, 'erro');
            throw erroUpload;
        }

        const { data: urlData } = supabase.storage
            .from('midias')
            .getPublicUrl(caminho);

        const url = urlData?.publicUrl || '';

        if (!url) {
            throw new Error('O Storage não retornou a URL pública da mídia.');
        }

        const dadosMensagem = {
            texto: textoMensagemMidia(classificacao, url, arquivo),
            tipo: classificacao.tipo,
            remetente_email: contexto.email,
            grupo_id: contexto.grupoId,
            destinatario_email: contexto.grupoId ? null : contexto.contato,
            mensagem_respondida_id:
                indice === 0
                    ? contexto.respostaId
                    : null,
            meta: {
                midia_url: url,
                midia_nome: String(arquivo.name || ''),
                midia_mime: String(arquivo.type || ''),
                midia_tamanho: Number(arquivo.size || 0),
                midia_storage_path: caminho
            }
        };

        const { data: mensagem, error: erroInsert } = await supabase
            .from('mensagens')
            .insert([dadosMensagem])
            .select('*')
            .single();

        if (erroInsert) {
            console.error('[Mídia] Arquivo subiu, mas a mensagem falhou:', erroInsert);
            throw erroInsert;
        }

        await salvarNoCache(
            mensagem,
            contexto.grupoId,
            contexto.contato
        );

        return mensagem;
    }

    async function atualizarChatDepoisDoEnvio(contexto) {
        try {
            if (typeof cancelarResposta === 'function') {
                cancelarResposta();
            }
        } catch (e) {}

        if (typeof window.verificarSolicitacaoPrimeiraMensagem === 'function') {
            try {
                await window.verificarSolicitacaoPrimeiraMensagem();
            } catch (e) {}
        }

        if (
            contexto.grupoId &&
            typeof carregarMensagensGrupo === 'function'
        ) {
            await carregarMensagensGrupo(contexto.grupoId);
        } else if (typeof carregarMensagens === 'function') {
            await carregarMensagens();
        }

        if (typeof carregarListaContatos === 'function') {
            carregarListaContatos();
        }
    }

    async function enviarArquivos(lista) {
        const arquivos = Array.from(lista || []).filter(Boolean);
        if (!arquivos.length) return false;

        const supabase = supabaseAtual();
        const email = meuEmail();
        const grupoId = grupoAtual();
        const contato = destinatarioPrivado();

        if (!supabase || !email || (!grupoId && !contato)) {
            return false;
        }

        const selecionados = arquivos.slice(0, MAX_ARQUIVOS_POR_ENVIO);

        if (arquivos.length > MAX_ARQUIVOS_POR_ENVIO) {
            alert(
                'Você pode enviar até ' +
                MAX_ARQUIVOS_POR_ENVIO +
                ' arquivos por vez.'
            );
        }

        const contexto = {
            email,
            grupoId,
            contato,
            respostaId: respostaAtual()
        };

        let enviados = 0;

        for (let i = 0; i < selecionados.length; i++) {
            const arquivo = selecionados[i];

            try {
                const mensagem = await enviarUmArquivo(
                    arquivo,
                    contexto,
                    i,
                    selecionados.length
                );

                if (mensagem) enviados++;
            } catch (erro) {
                console.error('[Mídia] Falha no envio:', erro);

                alert(
                    enviados
                        ? 'Alguns arquivos foram enviados, mas um deles falhou.'
                        : 'Não foi possível enviar o arquivo.'
                );

                break;
            }
        }

        if (enviados) {
            const ultimoArquivo = selecionados[Math.max(0, enviados - 1)];
            atualizarStatus(
                Math.max(0, enviados - 1),
                selecionados.length,
                ultimoArquivo,
                'concluido'
            );

            await atualizarChatDepoisDoEnvio(contexto);
            esconderStatus();
            return true;
        }

        esconderStatus(900);
        return false;
    }

    window.abrirSeletorMidiaChat = function () {
        const input = document.getElementById('input-arquivo-chat');
        if (!input) return;

        input.value = '';
        input.click();
    };

    // Mantém o nome antigo funcionando para qualquer trecho que ainda chame ele.
    window.acionarSeletorFotoChat = window.abrirSeletorMidiaChat;

    window.selecionarMidiasChat = async function (event) {
        const arquivos = event?.target?.files || [];
        const ok = await enviarArquivos(arquivos);

        if (event?.target) {
            try { event.target.value = ''; } catch (e) {}
        }

        return ok;
    };

    // A câmera integrada ainda cria um evento fake e chama enviarFotoChat().
    window.enviarFotoChat = function (event) {
        return window.selecionarMidiasChat(event);
    };

    window.enviarMidia = function (event) {
        return window.selecionarMidiasChat(event);
    };

    window.enviarArquivosChat = enviarArquivos;
})();
