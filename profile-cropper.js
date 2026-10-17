// ==========================================
// EDITOR / RECORTE DA FOTO DE PERFIL
// ==========================================
// Sempre exporta um JPEG quadrado 1024x1024 antes de enviar ao Supabase.

(function () {
    const TAMANHO_SAIDA = 1024;
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 4;

    let imagem = null;
    let arquivoOriginal = null;
    let objectUrl = "";
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

    function overlay() {
        return el("editor-foto-perfil");
    }

    function canvas() {
        return el("editor-foto-perfil-canvas");
    }

    function limitar(valor, min, max) {
        return Math.max(min, Math.min(max, valor));
    }

    function tamanhoPreview() {
        const c = canvas();
        if (!c) return 0;

        const rect = c.getBoundingClientRect();
        return Math.max(1, Math.round(Math.min(rect.width, rect.height)));
    }

    function escalaBase(tamanho) {
        if (!imagem?.naturalWidth || !imagem?.naturalHeight || !tamanho) return 1;

        return Math.max(
            tamanho / imagem.naturalWidth,
            tamanho / imagem.naturalHeight
        );
    }

    function limitarOffsets(tamanho = tamanhoPreview()) {
        if (!imagem || !tamanho) return;

        const escala = escalaBase(tamanho) * zoom;
        const largura = imagem.naturalWidth * escala;
        const altura = imagem.naturalHeight * escala;
        const limiteX = Math.max(0, (largura - tamanho) / 2);
        const limiteY = Math.max(0, (altura - tamanho) / 2);

        offsetX = limitar(offsetX, -limiteX, limiteX);
        offsetY = limitar(offsetY, -limiteY, limiteY);
    }

    function desenharPreview() {
        const c = canvas();
        if (!c || !imagem) return;

        const tamanho = tamanhoPreview();
        const dpr = limitar(window.devicePixelRatio || 1, 1, 3);

        const larguraReal = Math.max(1, Math.round(tamanho * dpr));

        if (c.width !== larguraReal || c.height !== larguraReal) {
            c.width = larguraReal;
            c.height = larguraReal;
        }

        limitarOffsets(tamanho);

        const ctx = c.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, tamanho, tamanho);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, tamanho, tamanho);

        const escala = escalaBase(tamanho) * zoom;
        const largura = imagem.naturalWidth * escala;
        const altura = imagem.naturalHeight * escala;

        const x = (tamanho - largura) / 2 + offsetX;
        const y = (tamanho - altura) / 2 + offsetY;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imagem, x, y, largura, altura);
    }

    function atualizarZoom(valor, preservarProporcao = true) {
        const anterior = zoom;
        zoom = limitar(Number(valor) || 1, ZOOM_MIN, ZOOM_MAX);

        if (preservarProporcao && anterior > 0) {
            const proporcao = zoom / anterior;
            offsetX *= proporcao;
            offsetY *= proporcao;
        }

        const range = el("editor-foto-perfil-zoom");
        if (range && Math.abs(Number(range.value) - zoom) > 0.001) {
            range.value = String(zoom);
        }

        limitarOffsets();
        desenharPreview();
    }

    function limparImagem() {
        imagem = null;
        arquivoOriginal = null;
        ponteiros.clear();
        ultimoPonto = null;
        distanciaPinchInicial = 0;

        if (objectUrl) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            objectUrl = "";
        }
    }

    function fecharEditor() {
        if (salvando) return;

        const painel = overlay();
        painel?.classList.add("hidden");
        painel?.setAttribute("aria-hidden", "true");
        document.body?.classList.remove("editor-foto-perfil-aberto");

        limparImagem();
    }

    window.fecharEditorFotoPerfil = fecharEditor;

    window.centralizarEditorFotoPerfil = function () {
        if (!imagem || salvando) return;

        zoom = 1;
        offsetX = 0;
        offsetY = 0;

        const range = el("editor-foto-perfil-zoom");
        if (range) range.value = "1";

        desenharPreview();
    };

    window.alterarZoomEditorFotoPerfil = function (valor) {
        if (!imagem || salvando) return;
        atualizarZoom(valor, true);
    };

    function distanciaEntrePonteiros() {
        const pontos = [...ponteiros.values()];
        if (pontos.length < 2) return 0;

        const dx = pontos[0].x - pontos[1].x;
        const dy = pontos[0].y - pontos[1].y;
        return Math.hypot(dx, dy);
    }

    function configurarGestos() {
        const c = canvas();
        if (!c || c.dataset.gestosPerfil === "true") return;
        c.dataset.gestosPerfil = "true";

        c.addEventListener("pointerdown", event => {
            if (!imagem || salvando) return;

            event.preventDefault();
            try { c.setPointerCapture(event.pointerId); } catch (e) {}

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

        c.addEventListener("pointermove", event => {
            if (!imagem || salvando || !ponteiros.has(event.pointerId)) return;

            event.preventDefault();

            const anterior = ponteiros.get(event.pointerId);
            ponteiros.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });

            if (ponteiros.size >= 2) {
                const distancia = distanciaEntrePonteiros();

                if (distanciaPinchInicial > 0 && distancia > 0) {
                    atualizarZoom(
                        zoomPinchInicial * (distancia / distanciaPinchInicial),
                        false
                    );
                }

                return;
            }

            if (anterior && ultimoPonto) {
                offsetX += event.clientX - ultimoPonto.x;
                offsetY += event.clientY - ultimoPonto.y;

                ultimoPonto = {
                    x: event.clientX,
                    y: event.clientY
                };

                limitarOffsets();
                desenharPreview();
            }
        });

        const encerrarPonteiro = event => {
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

        c.addEventListener("pointerup", encerrarPonteiro);
        c.addEventListener("pointercancel", encerrarPonteiro);
        c.addEventListener("lostpointercapture", encerrarPonteiro);
    }

    window.abrirEditorFotoPerfil = async function (arquivo) {
        if (!arquivo) return false;

        if (!String(arquivo.type || "").startsWith("image/")) {
            alert("Escolha uma imagem válida.");
            return false;
        }

        if (salvando) return false;

        limparImagem();

        arquivoOriginal = arquivo;
        objectUrl = URL.createObjectURL(arquivo);

        const img = new Image();
        img.decoding = "async";

        const carregou = await new Promise(resolve => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = objectUrl;
        });

        if (!carregou || !img.naturalWidth || !img.naturalHeight) {
            limparImagem();
            alert("Não foi possível abrir essa imagem.");
            return false;
        }

        imagem = img;
        zoom = 1;
        offsetX = 0;
        offsetY = 0;

        const range = el("editor-foto-perfil-zoom");
        if (range) range.value = "1";

        const painel = overlay();
        if (!painel) {
            limparImagem();
            return false;
        }

        painel.classList.remove("hidden");
        painel.setAttribute("aria-hidden", "false");
        document.body?.classList.add("editor-foto-perfil-aberto");

        configurarGestos();

        requestAnimationFrame(() => {
            requestAnimationFrame(desenharPreview);
        });

        return true;
    };

    function arquivoQuadradoDaEdicao() {
        return new Promise(resolve => {
            if (!imagem) {
                resolve(null);
                return;
            }

            const preview = tamanhoPreview();
            if (!preview) {
                resolve(null);
                return;
            }

            limitarOffsets(preview);

            const escalaPreview = escalaBase(preview) * zoom;
            const larguraPreview = imagem.naturalWidth * escalaPreview;
            const alturaPreview = imagem.naturalHeight * escalaPreview;
            const xPreview = (preview - larguraPreview) / 2 + offsetX;
            const yPreview = (preview - alturaPreview) / 2 + offsetY;

            const proporcaoSaida = TAMANHO_SAIDA / preview;

            const saida = document.createElement("canvas");
            saida.width = TAMANHO_SAIDA;
            saida.height = TAMANHO_SAIDA;

            const ctx = saida.getContext("2d");
            if (!ctx) {
                resolve(null);
                return;
            }

            ctx.fillStyle = "#111";
            ctx.fillRect(0, 0, TAMANHO_SAIDA, TAMANHO_SAIDA);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";

            ctx.drawImage(
                imagem,
                xPreview * proporcaoSaida,
                yPreview * proporcaoSaida,
                larguraPreview * proporcaoSaida,
                alturaPreview * proporcaoSaida
            );

            saida.toBlob(blob => {
                if (!blob) {
                    resolve(null);
                    return;
                }

                resolve(
                    new File(
                        [blob],
                        "perfil_" + Date.now() + ".jpg",
                        {
                            type: "image/jpeg",
                            lastModified: Date.now()
                        }
                    )
                );
            }, "image/jpeg", 0.92);
        });
    }

    window.salvarRecorteFotoPerfil = async function () {
        if (!imagem || salvando) return false;
        if (typeof window.salvarNovaFotoPerfil !== "function") {
            alert("O envio da foto de perfil ainda não terminou de carregar.");
            return false;
        }

        salvando = true;

        const concluir = el("editor-foto-perfil-concluir");
        const cancelar = el("editor-foto-perfil-cancelar");
        const range = el("editor-foto-perfil-zoom");

        if (concluir) {
            concluir.disabled = true;
            concluir.textContent = "Salvando...";
        }
        if (cancelar) cancelar.disabled = true;
        if (range) range.disabled = true;

        try {
            const arquivoQuadrado = await arquivoQuadradoDaEdicao();

            if (!arquivoQuadrado) {
                alert("Não foi possível cortar a foto.");
                return false;
            }

            // Este é o arquivo que vai de fato para o bucket avatars:
            // JPEG 1024x1024 já cortado, nunca a imagem original inteira.
            const ok = await window.salvarNovaFotoPerfil(arquivoQuadrado);

            if (ok) {
                salvando = false;
                fecharEditor();
                return true;
            }

            return false;
        } catch (erro) {
            console.error("[Foto de perfil] Erro ao cortar/salvar:", erro);
            alert("Não foi possível salvar a foto.");
            return false;
        } finally {
            salvando = false;

            if (concluir) {
                concluir.disabled = false;
                concluir.textContent = "Concluir";
            }
            if (cancelar) cancelar.disabled = false;
            if (range) range.disabled = false;
        }
    };

    window.addEventListener("resize", () => {
        if (imagem && !overlay()?.classList.contains("hidden")) {
            requestAnimationFrame(desenharPreview);
        }
    });
})();
