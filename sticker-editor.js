// ==========================================
// EDITOR DE FIGURINHA - RECORTE / FORMATO
// ==========================================
// Editor visual inspirado no fluxo do WhatsApp.
// Imagens estáticas são realmente recortadas antes do upload.

(function () {
    const SAIDA_MAX = 512;
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 5;

    let arquivoOriginal = null;
    let imagem = null;
    let objectUrl = '';
    let formatoAtual = 'original';
    let crop = null;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let salvando = false;

    const ponteiros = new Map();
    let ultimoPonto = null;
    let distanciaPinchInicial = 0;
    let zoomPinchInicial = 1;

    function el(id) {
        return document.getElementById(id);
    }

    function editor() {
        return el('editor-figurinha');
    }

    function canvas() {
        return el('editor-figurinha-canvas');
    }

    function limitar(valor, min, max) {
        return Math.max(min, Math.min(max, valor));
    }

    function tamanhoStage() {
        const c = canvas();
        if (!c) return { largura: 1, altura: 1 };

        const rect = c.getBoundingClientRect();

        return {
            largura: Math.max(1, rect.width),
            altura: Math.max(1, rect.height)
        };
    }

    function proporcaoFormato(chave = formatoAtual) {
        switch (chave) {
            case '1:1': return 1;
            case '3:4': return 3 / 4;
            case '4:3': return 4 / 3;
            case '9:16': return 9 / 16;
            case '16:9': return 16 / 9;
            case 'original':
            default:
                if (imagem?.naturalWidth && imagem?.naturalHeight) {
                    return imagem.naturalWidth / imagem.naturalHeight;
                }
                return 1;
        }
    }

    function calcularAreaRecorte() {
        const { largura: stageW, altura: stageH } = tamanhoStage();
        const margemX = Math.max(20, Math.min(42, stageW * 0.07));
        const margemY = Math.max(26, Math.min(58, stageH * 0.08));
        const maxW = Math.max(80, stageW - margemX * 2);
        const maxH = Math.max(80, stageH - margemY * 2);
        const ratio = Math.max(0.15, proporcaoFormato());

        let largura = maxW;
        let altura = largura / ratio;

        if (altura > maxH) {
            altura = maxH;
            largura = altura * ratio;
        }

        crop = {
            x: (stageW - largura) / 2,
            y: (stageH - altura) / 2,
            largura,
            altura
        };

        return crop;
    }

    function escalaBase() {
        if (!imagem || !crop) return 1;

        return Math.max(
            crop.largura / imagem.naturalWidth,
            crop.altura / imagem.naturalHeight
        );
    }

    function dimensoesImagemDesenhada() {
        const escala = escalaBase() * zoom;

        return {
            largura: imagem.naturalWidth * escala,
            altura: imagem.naturalHeight * escala
        };
    }

    function limitarOffsets() {
        if (!imagem || !crop) return;

        const stage = tamanhoStage();
        const d = dimensoesImagemDesenhada();
        const centroBaseX = (stage.largura - d.largura) / 2;
        const centroBaseY = (stage.altura - d.altura) / 2;

        const minimoX = (crop.x + crop.largura) - d.largura - centroBaseX;
        const maximoX = crop.x - centroBaseX;
        const minimoY = (crop.y + crop.altura) - d.altura - centroBaseY;
        const maximoY = crop.y - centroBaseY;

        offsetX = limitar(offsetX, minimoX, maximoX);
        offsetY = limitar(offsetY, minimoY, maximoY);
    }

    function prepararCanvas() {
        const c = canvas();
        if (!c) return null;

        const stage = tamanhoStage();
        const dpr = limitar(window.devicePixelRatio || 1, 1, 3);
        const width = Math.max(1, Math.round(stage.largura * dpr));
        const height = Math.max(1, Math.round(stage.altura * dpr));

        if (c.width !== width || c.height !== height) {
            c.width = width;
            c.height = height;
        }

        const ctx = c.getContext('2d');
        if (!ctx) return null;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, stage.largura, stage.altura);

        return { ctx, stage };
    }

    function desenhar() {
        if (!imagem) return;

        calcularAreaRecorte();
        limitarOffsets();

        const preparado = prepararCanvas();
        if (!preparado) return;

        const { ctx, stage } = preparado;
        const d = dimensoesImagemDesenhada();

        const imageX = (stage.largura - d.largura) / 2 + offsetX;
        const imageY = (stage.altura - d.altura) / 2 + offsetY;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            imagem,
            imageX,
            imageY,
            d.largura,
            d.altura
        );

        // Escurece somente o que ficará fora do corte.
        ctx.fillStyle = 'rgba(0,0,0,.58)';

        ctx.fillRect(0, 0, stage.largura, crop.y);
        ctx.fillRect(
            0,
            crop.y + crop.altura,
            stage.largura,
            Math.max(0, stage.altura - crop.y - crop.altura)
        );
        ctx.fillRect(0, crop.y, crop.x, crop.altura);
        ctx.fillRect(
            crop.x + crop.largura,
            crop.y,
            Math.max(0, stage.largura - crop.x - crop.largura),
            crop.altura
        );

        // Moldura e grade de recorte.
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.96)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
            crop.x + .75,
            crop.y + .75,
            Math.max(0, crop.largura - 1.5),
            Math.max(0, crop.altura - 1.5)
        );

        ctx.strokeStyle = 'rgba(255,255,255,.24)';
        ctx.lineWidth = 1;

        for (const fracao of [1 / 3, 2 / 3]) {
            const x = crop.x + crop.largura * fracao;
            const y = crop.y + crop.altura * fracao;

            ctx.beginPath();
            ctx.moveTo(x, crop.y);
            ctx.lineTo(x, crop.y + crop.altura);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(crop.x, y);
            ctx.lineTo(crop.x + crop.largura, y);
            ctx.stroke();
        }

        // Cantos mais grossos, para lembrar editor de imagem nativo.
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        const canto = Math.min(22, crop.largura * .12, crop.altura * .12);

        const cantos = [
            [crop.x, crop.y, 1, 1],
            [crop.x + crop.largura, crop.y, -1, 1],
            [crop.x, crop.y + crop.altura, 1, -1],
            [crop.x + crop.largura, crop.y + crop.altura, -1, -1]
        ];

        cantos.forEach(([x, y, sx, sy]) => {
            ctx.beginPath();
            ctx.moveTo(x + sx * canto, y);
            ctx.lineTo(x, y);
            ctx.lineTo(x, y + sy * canto);
            ctx.stroke();
        });

        ctx.restore();
    }

    function atualizarZoom(novoZoom, preservarOffsets = true) {
        if (!imagem) return;

        const anterior = zoom;
        zoom = limitar(Number(novoZoom) || 1, ZOOM_MIN, ZOOM_MAX);

        if (preservarOffsets && anterior > 0) {
            const proporcao = zoom / anterior;
            offsetX *= proporcao;
            offsetY *= proporcao;
        }

        const range = el('editor-figurinha-zoom');
        if (range && Math.abs(Number(range.value) - zoom) > .001) {
            range.value = String(zoom);
        }

        limitarOffsets();
        desenhar();
    }

    function selecionarFormato(chave) {
        formatoAtual = chave || 'original';
        zoom = 1;
        offsetX = 0;
        offsetY = 0;

        document
            .querySelectorAll('#editor-figurinha .sticker-formato-btn')
            .forEach(btn => {
                btn.classList.toggle(
                    'ativo',
                    btn.dataset.formato === formatoAtual
                );
            });

        const range = el('editor-figurinha-zoom');
        if (range) range.value = '1';

        desenhar();
    }

    window.selecionarFormatoFigurinha = selecionarFormato;

    window.alterarZoomEditorFigurinha = function (valor) {
        atualizarZoom(valor, true);
    };

    window.centralizarEditorFigurinha = function () {
        if (!imagem || salvando) return;

        zoom = 1;
        offsetX = 0;
        offsetY = 0;

        const range = el('editor-figurinha-zoom');
        if (range) range.value = '1';

        desenhar();
    };

    function distanciaEntrePonteiros() {
        const pontos = [...ponteiros.values()];
        if (pontos.length < 2) return 0;

        return Math.hypot(
            pontos[0].x - pontos[1].x,
            pontos[0].y - pontos[1].y
        );
    }

    function configurarGestos() {
        const c = canvas();
        if (!c || c.dataset.gestosFigurinha === 'true') return;

        c.dataset.gestosFigurinha = 'true';

        c.addEventListener('pointerdown', event => {
            if (!imagem || salvando) return;

            event.preventDefault();

            try {
                c.setPointerCapture(event.pointerId);
            } catch (e) {}

            ponteiros.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });

            if (ponteiros.size === 1) {
                ultimoPonto = {
                    x: event.clientX,
                    y: event.clientY
                };
            } else if (ponteiros.size === 2) {
                distanciaPinchInicial = distanciaEntrePonteiros();
                zoomPinchInicial = zoom;
                ultimoPonto = null;
            }
        });

        c.addEventListener('pointermove', event => {
            if (
                !imagem ||
                salvando ||
                !ponteiros.has(event.pointerId)
            ) {
                return;
            }

            event.preventDefault();

            ponteiros.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });

            if (ponteiros.size >= 2) {
                const distancia = distanciaEntrePonteiros();

                if (distanciaPinchInicial > 0 && distancia > 0) {
                    atualizarZoom(
                        zoomPinchInicial *
                            (distancia / distanciaPinchInicial),
                        false
                    );
                }

                return;
            }

            if (ultimoPonto) {
                offsetX += event.clientX - ultimoPonto.x;
                offsetY += event.clientY - ultimoPonto.y;

                ultimoPonto = {
                    x: event.clientX,
                    y: event.clientY
                };

                limitarOffsets();
                desenhar();
            }
        });

        const encerrar = event => {
            ponteiros.delete(event.pointerId);

            if (ponteiros.size === 1) {
                const restante = [...ponteiros.values()][0];
                ultimoPonto = {
                    x: restante.x,
                    y: restante.y
                };
            } else {
                ultimoPonto = null;
            }

            if (ponteiros.size < 2) {
                distanciaPinchInicial = 0;
                zoomPinchInicial = zoom;
            }
        };

        c.addEventListener('pointerup', encerrar);
        c.addEventListener('pointercancel', encerrar);
        c.addEventListener('lostpointercapture', encerrar);

        c.addEventListener('wheel', event => {
            if (!imagem || salvando) return;

            event.preventDefault();

            const delta = event.deltaY < 0 ? .12 : -.12;
            atualizarZoom(zoom + delta, true);
        }, { passive: false });
    }

    function limparEstado() {
        imagem = null;
        arquivoOriginal = null;
        crop = null;
        zoom = 1;
        offsetX = 0;
        offsetY = 0;
        formatoAtual = 'original';
        ponteiros.clear();
        ultimoPonto = null;
        distanciaPinchInicial = 0;

        if (objectUrl) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            objectUrl = '';
        }
    }

    function fecharEditor(forcar = false) {
        if (salvando && !forcar) return;

        editor()?.classList.add('hidden');
        editor()?.setAttribute('aria-hidden', 'true');
        document.body?.classList.remove('editor-figurinha-aberto');

        limparEstado();
    }

    window.fecharEditorFigurinha = fecharEditor;

    window.abrirEditorFigurinha = async function (arquivo) {
        if (!arquivo || salvando) return false;

        if (!String(arquivo.type || '').startsWith('image/')) {
            alert('Escolha uma imagem válida.');
            return false;
        }

        if (
            String(arquivo.type || '').toLowerCase() === 'image/gif' ||
            String(arquivo.name || '').toLowerCase().endsWith('.gif')
        ) {
            // O GIF precisa manter todos os frames. O editor de bitmap não
            // transforma GIF animado em imagem parada.
            const preparado = await window.WhatisStickers?.prepararArquivo?.(
                arquivo
            );

            return window.WhatisStickers?.salvarFigurinhaPreparada?.(
                preparado,
                arquivo.name || 'GIF'
            );
        }

        limparEstado();

        arquivoOriginal = arquivo;
        objectUrl = URL.createObjectURL(arquivo);

        const img = new Image();
        img.decoding = 'async';

        const carregou = await new Promise(resolve => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = objectUrl;
        });

        if (!carregou || !img.naturalWidth || !img.naturalHeight) {
            limparEstado();
            alert('Não foi possível abrir essa imagem.');
            return false;
        }

        imagem = img;
        formatoAtual = 'original';
        zoom = 1;
        offsetX = 0;
        offsetY = 0;

        const overlay = editor();

        if (!overlay) {
            limparEstado();
            return false;
        }

        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        document.body?.classList.add('editor-figurinha-aberto');

        const nome = el('editor-figurinha-arquivo');
        if (nome) {
            nome.textContent = arquivo.name || 'Nova figurinha';
        }

        configurarGestos();
        selecionarFormato('original');

        requestAnimationFrame(() => {
            requestAnimationFrame(desenhar);
        });

        return true;
    };

    async function gerarRecorte() {
        if (!imagem || !crop) return null;

        limitarOffsets();

        const stage = tamanhoStage();
        const d = dimensoesImagemDesenhada();

        const imageX = (stage.largura - d.largura) / 2 + offsetX;
        const imageY = (stage.altura - d.altura) / 2 + offsetY;

        const maiorLado = Math.max(crop.largura, crop.altura);
        const escalaSaida = SAIDA_MAX / maiorLado;

        const outW = Math.max(
            1,
            Math.round(crop.largura * escalaSaida)
        );
        const outH = Math.max(
            1,
            Math.round(crop.altura * escalaSaida)
        );

        const saida = document.createElement('canvas');
        saida.width = outW;
        saida.height = outH;

        const ctx = saida.getContext('2d', { alpha: true });
        if (!ctx) return null;

        ctx.clearRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(
            imagem,
            (imageX - crop.x) * escalaSaida,
            (imageY - crop.y) * escalaSaida,
            d.largura * escalaSaida,
            d.altura * escalaSaida
        );

        const blob = await new Promise(resolve => {
            saida.toBlob(resolve, 'image/webp', .92);
        });

        if (!blob) return null;

        return {
            blob,
            largura: outW,
            altura: outH,
            animada: false,
            mime: 'image/webp',
            extensao: 'webp'
        };
    }

    window.concluirEditorFigurinha = async function () {
        if (!imagem || salvando) return false;

        const salvar = window.WhatisStickers?.salvarFigurinhaPreparada;

        if (typeof salvar !== 'function') {
            alert('O criador de figurinhas ainda não terminou de carregar.');
            return false;
        }

        salvando = true;

        const btn = el('editor-figurinha-concluir');
        const fechar = el('editor-figurinha-fechar');
        const range = el('editor-figurinha-zoom');

        if (btn) {
            btn.disabled = true;
            btn.classList.add('carregando');
        }
        if (fechar) fechar.disabled = true;
        if (range) range.disabled = true;

        try {
            const preparado = await gerarRecorte();

            if (!preparado) {
                throw new Error('Não foi possível gerar o recorte.');
            }

            const salvo = await salvar(
                preparado,
                arquivoOriginal?.name || 'Figurinha'
            );

            if (!salvo) return false;

            salvando = false;
            fecharEditor(true);
            return true;
        } catch (erro) {
            console.error('[Editor figurinha] Erro:', erro);
            alert(
                'Não foi possível recortar a figurinha.' +
                (erro?.message ? '\n' + erro.message : '')
            );
            return false;
        } finally {
            salvando = false;

            if (btn) {
                btn.disabled = false;
                btn.classList.remove('carregando');
            }
            if (fechar) fechar.disabled = false;
            if (range) range.disabled = false;
        }
    };

    window.addEventListener('resize', () => {
        if (
            imagem &&
            editor() &&
            !editor().classList.contains('hidden')
        ) {
            requestAnimationFrame(desenhar);
        }
    });
})();
