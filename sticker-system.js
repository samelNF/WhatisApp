// ==========================================
// SISTEMA DE FIGURINHAS - WHATISAPP
// ==========================================
// Cria figurinhas a partir de imagens/GIFs, mantém a proporção original
// e envia como mensagem sem deformar o conteúdo.

(function () {
    const MAX_PREPARO = 512;
    const MAX_DISPLAY = 148;

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

    window.criarFigurinhaDoArquivo = async function (event) {
        const arquivo = event?.target?.files?.[0];
        const supabase = supabaseAtual();
        const email = meuEmail();

        if (!arquivo || !supabase || !email) return false;

        estadoCriando(true, 'Criando figurinha...');

        try {
            const preparado = await prepararArquivo(arquivo);
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
                throw new Error(erroUpload.message || 'Falha no upload da figurinha.');
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
                    nome: String(arquivo.name || 'Figurinha').slice(0, 150),
                    url,
                    storage_path: caminho,
                    animada: preparado.animada,
                    largura: preparado.largura,
                    altura: preparado.altura
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

            return true;
        } catch (erro) {
            console.error('[Figurinha] Erro ao criar:', erro);
            estadoCriando(false, '');

            alert(
                'Não foi possível criar a figurinha.' +
                (erro?.message ? '\n' + erro.message : '')
            );

            return false;
        } finally {
            if (event?.target) {
                try { event.target.value = ''; } catch (e) {}
            }
        }
    };

    function criarBotaoFigurinha(fig) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'item-figurinha';
        botao.setAttribute('aria-label', 'Enviar figurinha');
        botao.title = fig.animada ? 'GIF' : 'Figurinha';

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
        botao.addEventListener('click', () => enviarFigurinha(fig));

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
            .select('id, usuario_email, nome, url, storage_path, animada, largura, altura, criada_em')
            .eq('usuario_email', email)
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
