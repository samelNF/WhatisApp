// ==========================================
// SISTEMA DE FIGURINHAS - WHATISAPP
// ==========================================
// Cria figurinhas a partir de imagens/GIFs, mantém a proporção original
// e envia como mensagem sem deformar o conteúdo.

(function () {
    const MAX_PREPARO = 512;
    const MAX_DISPLAY = 148;
    const TEMPO_LONG_PRESS = 520;

    let figurinhaMenuAtual = null;
    let figurinhaMenuOrigem = null;
    let timerLongPressChat = null;
    let inicioLongPressChat = null;

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

    function destinatarioPrivado() {
        if (window.grupoAtualId) return null;

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

    function painel() {
        return document.getElementById('painel-figurinhas');
    }

    function grade() {
        return document.getElementById('grade-figurinhas');
    }

    function sanitizarParteCaminho(valor) {
        return String(valor || 'usuario')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .slice(0, 90);
    }

    function gerarId() {
        return globalThis.crypto?.randomUUID?.() || (
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 12)
        );
    }

    function ehGif(arquivo) {
        const mime = String(arquivo?.type || '').toLowerCase();
        const nome = String(arquivo?.name || '').toLowerCase();

        return mime === 'image/gif' || nome.endsWith('.gif');
    }

    function carregarImagemPorUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';

            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    async function dimensoesDoArquivo(arquivo) {
        const url = URL.createObjectURL(arquivo);

        try {
            const img = await carregarImagemPorUrl(url);

            return {
                largura: Math.max(1, Number(img.naturalWidth) || 1),
                altura: Math.max(1, Number(img.naturalHeight) || 1),
                img
            };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async function prepararArquivo(arquivo) {
        if (!arquivo || !String(arquivo.type || '').startsWith('image/')) {
            throw new Error('Escolha uma imagem ou GIF válido.');
        }

        const gif = ehGif(arquivo);

        if (gif) {
            const url = URL.createObjectURL(arquivo);

            try {
                const img = await carregarImagemPorUrl(url);

                return {
                    blob: arquivo,
                    largura: Math.max(1, Number(img.naturalWidth) || 1),
                    altura: Math.max(1, Number(img.naturalHeight) || 1),
                    animada: true,
                    mime: 'image/gif',
                    extensao: 'gif'
                };
            } finally {
                URL.revokeObjectURL(url);
            }
        }

        const objectUrl = URL.createObjectURL(arquivo);

        try {
            const img = await carregarImagemPorUrl(objectUrl);
            const larguraOriginal = Math.max(1, Number(img.naturalWidth) || 1);
            const alturaOriginal = Math.max(1, Number(img.naturalHeight) || 1);

            const escala = Math.min(
                MAX_PREPARO / larguraOriginal,
                MAX_PREPARO / alturaOriginal,
                1
            );

            const largura = Math.max(1, Math.round(larguraOriginal * escala));
            const altura = Math.max(1, Math.round(alturaOriginal * escala));

            const canvas = document.createElement('canvas');
            canvas.width = largura;
            canvas.height = altura;

            const ctx = canvas.getContext('2d', {
                alpha: true
            });

            if (!ctx) {
                throw new Error('Não foi possível preparar a figurinha.');
            }

            ctx.clearRect(0, 0, largura, altura);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, largura, altura);

            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/webp', 0.92);
            });

            if (!blob) {
                throw new Error('Não foi possível gerar a figurinha.');
            }

            return {
                blob,
                largura,
                altura,
                animada: false,
                mime: 'image/webp',
                extensao: 'webp'
            };
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function calcularTamanhoVisual(largura, altura, max = MAX_DISPLAY) {
        const w = Math.max(1, Number(largura) || 1);
        const h = Math.max(1, Number(altura) || 1);
        const escala = max / Math.max(w, h);

        return {
            largura: Math.max(1, Math.round(w * escala)),
            altura: Math.max(1, Math.round(h * escala))
        };
    }

    function criarTextoMensagem(figurinha) {
        const pacote = {
            id: figurinha.id ?? null,
            url: figurinha.url,
            w: Number(figurinha.largura || 1),
            h: Number(figurinha.altura || 1),
            a: figurinha.animada === true
        };

        return '[FIGURINHA]:' + encodeURIComponent(JSON.stringify(pacote));
    }

    function fecharPainel() {
        painel()?.classList.add('hidden');
        document.body?.classList.remove('painel-figurinhas-aberto');
    }

    window.fecharPainelFigurinhas = fecharPainel;

    window.abrirPainelFigurinhas = async function () {
        const el = painel();
        if (!el) return;

        const abrindo = el.classList.contains('hidden');

        if (!abrindo) {
            fecharPainel();
            return;
        }

        el.classList.remove('hidden');
        document.body?.classList.add('painel-figurinhas-aberto');

        await carregarMinhasFigurinhas();
    };

    window.abrirCriadorFigurinhas = function () {
        const input = document.getElementById('input-criar-figurinha');
        if (!input) return;

        input.value = '';
        input.click();
    };

    function estadoCriando(ativo, texto = '') {
        const area = document.getElementById('sticker-creator-status');
        const botao = document.getElementById('btn-criar-figurinha');

        if (botao) {
            botao.disabled = ativo;
        }

        if (area) {
            area.textContent = texto || '';
            area.classList.toggle('hidden', !ativo && !texto);
        }
    }

    async function salvarFigurinhaPreparada(preparado, nomeOriginal = 'Figurinha') {
        const supabase = supabaseAtual();
        const email = meuEmail();

        if (!preparado?.blob || !supabase || !email) return false;

        estadoCriando(true, 'Criando figurinha...');

        try {
            const id = gerarId();
            const caminho =
                'stickers/' +
                sanitizarParteCaminho(email) +
                '/' +
                id +
                '.' +
                preparado.extensao;

            const arquivoUpload = new File(
                [preparado.blob],
                'figurinha.' + preparado.extensao,
                {
                    type: preparado.mime,
                    lastModified: Date.now()
                }
            );

            const { error: erroUpload } = await supabase.storage
                .from('midias')
                .upload(caminho, arquivoUpload, {
                    cacheControl: '31536000',
                    contentType: preparado.mime,
                    upsert: false
                });

            if (erroUpload) {
                throw new Error(
                    erroUpload.message ||
                    'Falha no upload da figurinha.'
                );
            }

            const { data: urlData } = supabase.storage
                .from('midias')
                .getPublicUrl(caminho);

            const url = urlData?.publicUrl || '';

            if (!url) {
                throw new Error('Não foi possível obter a URL da figurinha.');
            }

            const { data: salva, error: erroInsert } = await supabase
                .from('figurinhas')
                .insert([{
                    usuario_email: email,
                    nome: String(nomeOriginal || 'Figurinha').slice(0, 150),
                    url,
                    storage_path: caminho,
                    animada: preparado.animada === true,
                    largura: Math.max(1, Number(preparado.largura) || 1),
                    altura: Math.max(1, Number(preparado.altura) || 1),
                    favoritada: true
                }])
                .select('*')
                .single();

            if (erroInsert || !salva) {
                throw new Error(
                    erroInsert?.message ||
                    'Não foi possível salvar a figurinha.'
                );
            }

            estadoCriando(false, '');
            await carregarMinhasFigurinhas();

            if (typeof mostrarToastAcoesMensagem === 'function') {
                mostrarToastAcoesMensagem(
                    preparado.animada
                        ? 'GIF criado como figurinha.'
                        : 'Figurinha criada.'
                );
            }

            return salva;
        } catch (erro) {
            console.error('[Figurinha] Erro ao criar:', erro);
            estadoCriando(false, '');

            alert(
                'Não foi possível criar a figurinha.' +
                (erro?.message ? '\n' + erro.message : '')
            );

            return false;
        }
    }

    window.criarFigurinhaDoArquivo = async function (event) {
        const arquivo = event?.target?.files?.[0];

        if (!arquivo) return false;

        try {
            // GIF continua animado e, por enquanto, entra direto na biblioteca.
            // O editor abaixo trabalha no bitmap real das imagens estáticas.
            if (ehGif(arquivo)) {
                const preparado = await prepararArquivo(arquivo);
                return await salvarFigurinhaPreparada(
                    preparado,
                    arquivo.name || 'GIF'
                );
            }

            if (typeof window.abrirEditorFigurinha === 'function') {
                return await window.abrirEditorFigurinha(arquivo);
            }

            const preparado = await prepararArquivo(arquivo);
            return await salvarFigurinhaPreparada(
                preparado,
                arquivo.name || 'Figurinha'
            );
        } catch (erro) {
            console.error('[Figurinha] Erro ao preparar arquivo:', erro);
            alert(
                'Não foi possível abrir a imagem.' +
                (erro?.message ? '\n' + erro.message : '')
            );
            return false;
        } finally {
            if (event?.target) {
                try { event.target.value = ''; } catch (e) {}
            }
        }
    };

    window.WhatisStickers = {
        prepararArquivo,
        salvarFigurinhaPreparada,
        carregarMinhasFigurinhas: () => carregarMinhasFigurinhas()
    };

    async function procurarFigurinhaSalvaPorUrl(url) {
        const supabase = supabaseAtual();
        const email = meuEmail();
        const alvo = String(url || '').trim();

        if (!supabase || !email || !alvo) return null;

        const { data, error } = await supabase
            .from('figurinhas')
            .select('id, usuario_email, nome, url, storage_path, animada, largura, altura, favoritada, criada_em')
            .eq('usuario_email', email)
            .eq('url', alvo)
            .order('criada_em', { ascending: false })
            .limit(1);

        if (error) {
            console.warn('[Figurinha] Não foi possível verificar a biblioteca:', error);
            return null;
        }

        return data?.[0] || null;
    }

    function iconeExtraMenu(apagar) {
        return apagar
            ? '<svg viewBox="0 0 24 24"><path d="M5 7h14"></path><path d="M9 7V4.8h6V7"></path><path d="M7.5 7 8.2 20h7.6l.7-13"></path><path d="M10.5 10.5v6M13.5 10.5v6"></path></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M12 4v11"></path><path d="m8 11 4 4 4-4"></path><path d="M5 19h14"></path></svg>';
    }

    async function abrirMenuFigurinha(figurinha, origem = 'chat') {
        const modal = document.getElementById('modal-figurinha-menu');
        const preview = document.getElementById('modal-figurinha-preview');
        const nome = document.getElementById('modal-figurinha-nome');
        const btnFavoritar = document.getElementById('acao-favoritar-figurinha');
        const txtFavoritar = document.getElementById('texto-favoritar-figurinha');
        const btnExtra = document.getElementById('acao-extra-figurinha');
        const txtExtra = document.getElementById('texto-extra-figurinha');
        const icoExtra = document.getElementById('icone-extra-figurinha');

        if (
            !modal ||
            !preview ||
            !btnFavoritar ||
            !txtFavoritar ||
            !btnExtra ||
            !txtExtra ||
            !icoExtra ||
            !figurinha?.url
        ) {
            return false;
        }

        let atual = {
            ...figurinha,
            largura: Math.max(1, Number(figurinha.largura || figurinha.w) || 1),
            altura: Math.max(1, Number(figurinha.altura || figurinha.h) || 1),
            animada: figurinha.animada === true || figurinha.a === true
        };

        // No chat o ID dentro da mensagem pertence à biblioteca de quem enviou.
        // Busca pela URL para descobrir se esta conta já salvou a figurinha.
        if (origem === 'chat') {
            const salva = await procurarFigurinhaSalvaPorUrl(atual.url);
            if (salva) atual = { ...atual, ...salva };
        }

        figurinhaMenuAtual = atual;
        figurinhaMenuOrigem = origem;

        preview.src = atual.url;
        preview.alt = atual.nome || 'Figurinha';
        nome.textContent = atual.nome || 'Figurinha';

        const ehBiblioteca = origem === 'biblioteca';

        btnFavoritar.classList.toggle('hidden', ehBiblioteca);
        txtFavoritar.textContent = atual.favoritada === true
            ? 'Remover das favoritas'
            : 'Adicionar às favoritas';

        const apagar = ehBiblioteca;

        txtExtra.textContent = apagar
            ? 'Apagar figurinha'
            : (atual.id ? 'Figurinha salva' : 'Salvar figurinha');

        icoExtra.innerHTML = iconeExtraMenu(apagar);
        btnExtra.classList.toggle('destrutiva', apagar);
        btnExtra.disabled = !apagar && !!atual.id;

        fecharPainel();

        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body?.classList.add('modal-figurinha-aberto');

        return true;
    }

    function fecharMenuFigurinha() {
        const modal = document.getElementById('modal-figurinha-menu');
        const preview = document.getElementById('modal-figurinha-preview');

        modal?.classList.add('hidden');
        modal?.setAttribute('aria-hidden', 'true');
        document.body?.classList.remove('modal-figurinha-aberto');

        if (preview) preview.src = '';

        figurinhaMenuAtual = null;
        figurinhaMenuOrigem = null;
    }

    window.fecharMenuFigurinha = fecharMenuFigurinha;

    async function salvarFigurinhaDoChat(figurinha, favoritada = false) {
        const supabase = supabaseAtual();
        const email = meuEmail();

        if (!supabase || !email || !figurinha?.url) return null;

        const existente = await procurarFigurinhaSalvaPorUrl(figurinha.url);

        if (existente) {
            if (
                favoritada === true &&
                existente.favoritada !== true
            ) {
                const { data, error } = await supabase
                    .from('figurinhas')
                    .update({ favoritada: true })
                    .eq('id', existente.id)
                    .eq('usuario_email', email)
                    .select('*')
                    .single();

                if (error) throw error;
                return data;
            }

            return existente;
        }

        const { data, error } = await supabase
            .from('figurinhas')
            .insert([{
                usuario_email: email,
                nome: String(figurinha.nome || 'Figurinha').slice(0, 150),
                url: figurinha.url,
                storage_path: null,
                animada: figurinha.animada === true,
                largura: Math.max(1, Number(figurinha.largura || figurinha.w) || 1),
                altura: Math.max(1, Number(figurinha.altura || figurinha.h) || 1),
                favoritada: favoritada === true
            }])
            .select('*')
            .single();

        if (error) throw error;
        return data;
    }

    async function alternarFavoritaMenu() {
        const supabase = supabaseAtual();
        const email = meuEmail();
        const fig = figurinhaMenuAtual;

        if (!supabase || !email || !fig?.url) return false;

        try {
            let atual = fig;

            if (!atual.id || figurinhaMenuOrigem === 'chat') {
                const salva = await procurarFigurinhaSalvaPorUrl(atual.url);
                if (salva) atual = { ...atual, ...salva };
            }

            if (!atual.id) {
                atual = await salvarFigurinhaDoChat(atual, true);

                if (typeof mostrarToastAcoesMensagem === 'function') {
                    mostrarToastAcoesMensagem('Figurinha adicionada às favoritas.');
                }
            } else {
                const novoValor = atual.favoritada !== true;

                const { data, error } = await supabase
                    .from('figurinhas')
                    .update({ favoritada: novoValor })
                    .eq('id', atual.id)
                    .eq('usuario_email', email)
                    .select('*')
                    .single();

                if (error) throw error;

                atual = data;

                if (typeof mostrarToastAcoesMensagem === 'function') {
                    mostrarToastAcoesMensagem(
                        novoValor
                            ? 'Figurinha adicionada às favoritas.'
                            : 'Figurinha removida das favoritas.'
                    );
                }
            }

            fecharMenuFigurinha();
            await carregarMinhasFigurinhas();
            return true;
        } catch (erro) {
            console.error('[Figurinha] Erro ao favoritar:', erro);
            alert('Não foi possível atualizar as favoritas.');
            return false;
        }
    }

    async function salvarFigurinhaMenu() {
        const fig = figurinhaMenuAtual;
        if (!fig?.url) return false;

        try {
            const existente = await procurarFigurinhaSalvaPorUrl(fig.url);

            if (existente) {
                if (typeof mostrarToastAcoesMensagem === 'function') {
                    mostrarToastAcoesMensagem('Essa figurinha já está salva.');
                }
                fecharMenuFigurinha();
                return true;
            }

            await salvarFigurinhaDoChat(fig, false);

            if (typeof mostrarToastAcoesMensagem === 'function') {
                mostrarToastAcoesMensagem('Figurinha salva.');
            }

            fecharMenuFigurinha();
            await carregarMinhasFigurinhas();
            return true;
        } catch (erro) {
            console.error('[Figurinha] Erro ao salvar:', erro);
            alert('Não foi possível salvar a figurinha.');
            return false;
        }
    }

    function conversasDisponiveisParaCompartilhar() {
        try {
            if (typeof todosContatos === 'undefined') return [];

            return (todosContatos || []).filter(item =>
                item?.tipo === 'contato' ||
                item?.tipo === 'grupo'
            );
        } catch (e) {
            return [];
        }
    }

    function fecharCompartilharFigurinha() {
        document.getElementById('compartilhar-figurinha-overlay')?.remove();
        document.body?.classList.remove('compartilhar-figurinha-aberto');
    }

    async function enviarFigurinhaCompartilhada(alvo) {
        const supabase = supabaseAtual();
        const email = meuEmail();
        const fig = figurinhaMenuAtual;

        if (!supabase || !email || !fig?.url || !alvo) return false;

        const ehGrupo = alvo.tipo === 'grupo';
        const grupoId = ehGrupo
            ? (alvo.id || alvo.identificador || null)
            : null;
        const contato = ehGrupo
            ? null
            : (alvo.identificador || alvo.email || null);

        if (!grupoId && !contato) return false;

        const dados = {
            texto: criarTextoMensagem({
                id: fig.id ?? null,
                url: fig.url,
                largura: Math.max(1, Number(fig.largura || fig.w) || 1),
                altura: Math.max(1, Number(fig.altura || fig.h) || 1),
                animada: fig.animada === true || fig.a === true
            }),
            tipo: 'figurinha',
            remetente_email: email,
            destinatario_email: ehGrupo ? null : contato,
            grupo_id: grupoId,
            mensagem_respondida_id: null,
            visualizada: false,
            meta: {
                figurinha_id: fig.id ?? null,
                figurinha_url: fig.url,
                figurinha_animada: fig.animada === true || fig.a === true,
                figurinha_largura: Math.max(1, Number(fig.largura || fig.w) || 1),
                figurinha_altura: Math.max(1, Number(fig.altura || fig.h) || 1),
                compartilhada: true
            }
        };

        const { data: mensagem, error } = await supabase
            .from('mensagens')
            .insert([dados])
            .select('*')
            .single();

        if (error || !mensagem) {
            console.error('[Figurinha] Erro compartilhando:', error);
            alert('Não foi possível compartilhar a figurinha.');
            return false;
        }

        try {
            if (window.WhatisCache?.salvarMensagens) {
                const chave = ehGrupo
                    ? window.WhatisCache.conversaGrupo(grupoId)
                    : window.WhatisCache.conversaPrivada(contato);

                await window.WhatisCache.salvarMensagens(chave, [mensagem]);
            }
        } catch (e) {}

        fecharCompartilharFigurinha();
        fecharMenuFigurinha();

        if (typeof carregarListaContatos === 'function') {
            carregarListaContatos();
        }

        try {
            if (
                ehGrupo &&
                String(window.grupoAtualId || '') === String(grupoId) &&
                typeof carregarMensagensGrupo === 'function'
            ) {
                await carregarMensagensGrupo(grupoId);
            } else if (
                !ehGrupo &&
                String(destinatarioPrivado() || '').trim().toLowerCase() ===
                    String(contato || '').trim().toLowerCase() &&
                typeof carregarMensagens === 'function'
            ) {
                await carregarMensagens();
            }
        } catch (e) {}

        if (typeof mostrarToastAcoesMensagem === 'function') {
            mostrarToastAcoesMensagem('Figurinha compartilhada.');
        }

        return true;
    }

    function abrirCompartilharFigurinha() {
        const fig = figurinhaMenuAtual;
        if (!fig?.url) return;

        const conversas = conversasDisponiveisParaCompartilhar();

        if (!conversas.length) {
            if (typeof mostrarToastAcoesMensagem === 'function') {
                mostrarToastAcoesMensagem('Nenhuma conversa disponível.');
            }
            return;
        }

        fecharCompartilharFigurinha();

        const overlay = document.createElement('div');
        overlay.id = 'compartilhar-figurinha-overlay';
        overlay.className = 'compartilhar-figurinha-overlay';

        const sheet = document.createElement('div');
        sheet.className = 'compartilhar-figurinha-sheet';

        const topo = document.createElement('div');
        topo.className = 'compartilhar-figurinha-topo';

        const titulo = document.createElement('strong');
        titulo.textContent = 'Compartilhar com';

        const fechar = document.createElement('button');
        fechar.type = 'button';
        fechar.className = 'compartilhar-figurinha-fechar';
        fechar.setAttribute('aria-label', 'Fechar');
        fechar.innerHTML = '×';
        fechar.addEventListener('click', fecharCompartilharFigurinha);

        topo.appendChild(titulo);
        topo.appendChild(fechar);

        const lista = document.createElement('div');
        lista.className = 'compartilhar-figurinha-lista';

        conversas.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'compartilhar-figurinha-destino';

            const avatar = document.createElement('span');
            avatar.className = 'compartilhar-figurinha-avatar';

            if (item.foto_url || item.foto) {
                const img = document.createElement('img');
                img.src = item.foto_url || item.foto;
                img.alt = '';
                avatar.appendChild(img);
            } else {
                avatar.textContent = String(
                    item.nome ||
                    item.usuario ||
                    item.identificador ||
                    '?'
                ).trim().charAt(0).toUpperCase() || '?';
            }

            const texto = document.createElement('span');
            texto.className = 'compartilhar-figurinha-destino-texto';

            const nome = document.createElement('strong');
            nome.textContent = item.tipo === 'grupo'
                ? (item.nome || item.usuario || 'Grupo')
                : (
                    item.usuario ||
                    item.nome ||
                    item.identificador ||
                    'Contato'
                );

            const detalhe = document.createElement('small');
            detalhe.textContent = item.tipo === 'grupo'
                ? 'Grupo'
                : (item.salvo === false ? 'Não salvo' : 'Contato');

            texto.appendChild(nome);
            texto.appendChild(detalhe);

            btn.appendChild(avatar);
            btn.appendChild(texto);

            btn.addEventListener('click', async () => {
                if (btn.disabled) return;

                btn.disabled = true;
                btn.classList.add('enviando');

                try {
                    await enviarFigurinhaCompartilhada(item);
                } finally {
                    btn.disabled = false;
                    btn.classList.remove('enviando');
                }
            });

            lista.appendChild(btn);
        });

        sheet.appendChild(topo);
        sheet.appendChild(lista);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);

        overlay.addEventListener('pointerdown', event => {
            if (event.target === overlay) {
                fecharCompartilharFigurinha();
            }
        });

        // Mantém o preview da figurinha no fundo, igual uma folha de ações.
        document.body?.classList.add('compartilhar-figurinha-aberto');
    }

    async function apagarFigurinhaMenu() {
        const supabase = supabaseAtual();
        const email = meuEmail();
        const fig = figurinhaMenuAtual;

        if (
            !supabase ||
            !email ||
            !fig?.id ||
            figurinhaMenuOrigem !== 'biblioteca'
        ) {
            return false;
        }

        if (!confirm('Apagar esta figurinha da sua biblioteca?')) {
            return false;
        }

        try {
            // Remove só da biblioteca. O arquivo não é apagado do Storage:
            // mensagens antigas podem continuar apontando para essa mesma URL.
            const { error } = await supabase
                .from('figurinhas')
                .delete()
                .eq('id', fig.id)
                .eq('usuario_email', email);

            if (error) throw error;

            fecharMenuFigurinha();
            await carregarMinhasFigurinhas();

            if (typeof mostrarToastAcoesMensagem === 'function') {
                mostrarToastAcoesMensagem('Figurinha apagada da biblioteca.');
            }

            return true;
        } catch (erro) {
            console.error('[Figurinha] Erro ao apagar:', erro);
            alert('Não foi possível apagar a figurinha.');
            return false;
        }
    }

    function instalarLongPressBiblioteca(botao, fig) {
        let timer = null;
        let inicio = null;
        let abriuMenu = false;

        botao.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse') return;

            abriuMenu = false;
            inicio = { x: event.clientX, y: event.clientY };

            clearTimeout(timer);
            timer = setTimeout(() => {
                abriuMenu = true;
                botao.dataset.longPressAte = String(Date.now() + 800);
                if (navigator.vibrate) navigator.vibrate(18);
                abrirMenuFigurinha(fig, 'biblioteca');
                timer = null;
            }, TEMPO_LONG_PRESS);
        });

        botao.addEventListener('pointermove', event => {
            if (!timer || !inicio) return;

            if (
                Math.abs(event.clientX - inicio.x) > 12 ||
                Math.abs(event.clientY - inicio.y) > 12
            ) {
                clearTimeout(timer);
                timer = null;
            }
        });

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(tipo => {
            botao.addEventListener(tipo, () => {
                clearTimeout(timer);
                timer = null;
                inicio = null;
            });
        });

        botao.addEventListener('contextmenu', event => {
            event.preventDefault();
            abriuMenu = true;
            botao.dataset.longPressAte = String(Date.now() + 800);
            abrirMenuFigurinha(fig, 'biblioteca');
        });

        return () =>
            abriuMenu ||
            Number(botao.dataset.longPressAte || 0) > Date.now();
    }

    function criarBotaoFigurinha(fig) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'item-figurinha';
        botao.setAttribute('aria-label', 'Enviar figurinha');
        botao.title = fig.animada ? 'GIF' : 'Figurinha';

        if (fig.favoritada === true) {
            botao.classList.add('item-figurinha-favorita');
        }

        const img = document.createElement('img');
        img.src = fig.url;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';

        const tamanho = calcularTamanhoVisual(
            fig.largura,
            fig.altura,
            72
        );

        img.style.width = tamanho.largura + 'px';
        img.style.height = tamanho.altura + 'px';

        botao.appendChild(img);

        const ignorarClique = instalarLongPressBiblioteca(botao, fig);

        botao.addEventListener('click', event => {
            if (ignorarClique()) {
                event.preventDefault();
                return;
            }

            enviarFigurinha(fig);
        });

        return botao;
    }

    async function carregarMinhasFigurinhas() {
        const supabase = supabaseAtual();
        const email = meuEmail();
        const container = grade();

        if (!supabase || !email || !container) return;

        container.innerHTML =
            '<div class="figurinhas-vazio">Carregando...</div>';

        const { data, error } = await supabase
            .from('figurinhas')
            .select('id, usuario_email, nome, url, storage_path, animada, largura, altura, favoritada, criada_em')
            .eq('usuario_email', email)
            .order('favoritada', { ascending: false })
            .order('criada_em', { ascending: false });

        if (error) {
            console.error('[Figurinha] Erro carregando biblioteca:', error);
            container.innerHTML =
                '<div class="figurinhas-vazio">Não foi possível carregar.</div>';
            return;
        }

        const lista = data || [];

        if (!lista.length) {
            container.innerHTML =
                '<div class="figurinhas-vazio">Crie sua primeira figurinha.</div>';
            return;
        }

        container.innerHTML = '';

        lista.forEach(fig => {
            container.appendChild(criarBotaoFigurinha(fig));
        });
    }

    async function enviarFigurinha(figurinha) {
        const supabase = supabaseAtual();
        const email = meuEmail();
        const grupoId = window.grupoAtualId || null;
        const contato = destinatarioPrivado();

        if (!supabase || !email || (!grupoId && !contato) || !figurinha?.url) {
            return false;
        }

        const dadosMensagem = {
            texto: criarTextoMensagem(figurinha),
            tipo: 'figurinha',
            remetente_email: email,
            destinatario_email: grupoId ? null : contato,
            grupo_id: grupoId,
            mensagem_respondida_id: respostaAtual(),
            visualizada: false,
            meta: {
                figurinha_id: figurinha.id ?? null,
                figurinha_url: figurinha.url,
                figurinha_animada: figurinha.animada === true,
                figurinha_largura: Number(figurinha.largura || 1),
                figurinha_altura: Number(figurinha.altura || 1)
            }
        };

        const { data: mensagem, error } = await supabase
            .from('mensagens')
            .insert([dadosMensagem])
            .select('*')
            .single();

        if (error || !mensagem) {
            console.error('[Figurinha] Erro enviando:', error);
            alert('Não foi possível enviar a figurinha.');
            return false;
        }

        try {
            if (typeof cancelarResposta === 'function') {
                cancelarResposta();
            }
        } catch (e) {}

        try {
            if (window.WhatisCache?.salvarMensagens) {
                const chave = grupoId
                    ? window.WhatisCache.conversaGrupo(grupoId)
                    : window.WhatisCache.conversaPrivada(contato);

                await window.WhatisCache.salvarMensagens(
                    chave,
                    [mensagem]
                );
            }
        } catch (e) {}

        fecharPainel();

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

    window.carregarMinhasFigurinhas = carregarMinhasFigurinhas;
    window.enviarFigurinha = enviarFigurinha;
    window.calcularTamanhoVisualFigurinha = calcularTamanhoVisual;
    window.abrirMenuFigurinha = abrirMenuFigurinha;

    document.addEventListener('click', async event => {
        if (event.target.closest('#acao-favoritar-figurinha')) {
            await alternarFavoritaMenu();
            return;
        }

        if (event.target.closest('#acao-compartilhar-figurinha')) {
            abrirCompartilharFigurinha();
            return;
        }

        if (event.target.closest('#acao-extra-figurinha')) {
            if (figurinhaMenuOrigem === 'biblioteca') {
                await apagarFigurinhaMenu();
            } else {
                await salvarFigurinhaMenu();
            }
        }
    });

    const chatMensagens = document.getElementById('chat-mensagens');

    if (chatMensagens) {
        chatMensagens.addEventListener('contextmenu', event => {
            const imagem = event.target.closest('.figurinha-img');
            if (!imagem || !chatMensagens.contains(imagem)) return;

            const alvo = imagem.closest('.figurinha-wrap[data-figurinha]');
            if (!alvo) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            try {
                const payload = JSON.parse(
                    decodeURIComponent(alvo.dataset.figurinha || '')
                );

                abrirMenuFigurinha(payload, 'chat');
            } catch (e) {
                console.warn('[Figurinha] Payload inválido:', e);
            }
        }, true);

        chatMensagens.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse') return;

            const imagem = event.target.closest('.figurinha-img');
            if (!imagem || !chatMensagens.contains(imagem)) return;

            const alvo = imagem.closest('.figurinha-wrap[data-figurinha]');
            if (!alvo) return;

            inicioLongPressChat = {
                x: event.clientX,
                y: event.clientY,
                alvo
            };

            clearTimeout(timerLongPressChat);

            timerLongPressChat = setTimeout(() => {
                try {
                    const payload = JSON.parse(
                        decodeURIComponent(alvo.dataset.figurinha || '')
                    );

                    alvo.closest('.balao-msg')?.setAttribute(
                        'data-sticker-menu-open',
                        'true'
                    );

                    if (navigator.vibrate) navigator.vibrate(18);
                    abrirMenuFigurinha(payload, 'chat');
                } catch (e) {
                    console.warn('[Figurinha] Payload inválido:', e);
                }

                timerLongPressChat = null;
            }, TEMPO_LONG_PRESS);
        }, true);

        chatMensagens.addEventListener('pointermove', event => {
            if (!inicioLongPressChat || !timerLongPressChat) return;

            if (
                Math.abs(event.clientX - inicioLongPressChat.x) > 12 ||
                Math.abs(event.clientY - inicioLongPressChat.y) > 12
            ) {
                clearTimeout(timerLongPressChat);
                timerLongPressChat = null;
            }
        }, true);

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(tipo => {
            chatMensagens.addEventListener(tipo, () => {
                clearTimeout(timerLongPressChat);
                timerLongPressChat = null;
                inicioLongPressChat = null;
            }, true);
        });
    }

    document.addEventListener('pointerdown', event => {
        const el = painel();
        if (!el || el.classList.contains('hidden')) return;

        const abriuNoBotao = event.target.closest('.chat-sticker-btn');
        const dentroDoPainel = event.target.closest('#painel-figurinhas');

        if (!abriuNoBotao && !dentroDoPainel) {
            fecharPainel();
        }
    });
})();
