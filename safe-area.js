// ==========================================
// SAFE AREA DINÂMICA / STATUS BAR iOS
// ==========================================
// Simula a barra do sistema acompanhando o material/cor do elemento
// que estiver encostado no topo da viewport.

(function () {
    const root = document.documentElement;
    let agendado = false;


    function elementoEstaAberto(el) {
        if (!el) return false;

        const estilo = getComputedStyle(el);
        if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
        if (Number(estilo.opacity) === 0) return false;

        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function atualizarEstadoTopoHome() {
        const body = document.body;
        if (!body) return;

        const subtelas = [
            document.getElementById('tela-chat'),
            document.getElementById('painel-dados-contato'),
            document.getElementById('painel-dados-grupo'),
            document.getElementById('painel-dados-usuario'),
            document.getElementById('tela-criar-grupo-membros'),
            document.getElementById('tela-criar-grupo-detalhes'),
            document.getElementById('modal-novo-contato'),
            document.getElementById('modal-solicitacoes')
        ];

        const temSubtelaAberta = subtelas.some(elementoEstaAberto);
        body.classList.toggle('subtela-aberta', temSubtelaAberta);
    }

    function bloquearArrastoNativoIOS() {
        const ehIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (!ehIOS || document.documentElement.dataset.iosArrastoBloqueado === 'true') {
            return;
        }

        document.documentElement.dataset.iosArrastoBloqueado = 'true';

        document.addEventListener('dragstart', (event) => {
            const alvo = event.target;

            if (
                alvo?.matches?.('input, textarea, select, [contenteditable="true"]')
            ) {
                return;
            }

            event.preventDefault();
        }, { passive: false });
    }

    function atualizarAlturaViewport() {
        const vv = window.visualViewport;

        // Em iOS/PWA VisualViewport costuma ser a medida mais confiável.
        // innerHeight fica como fallback para navegadores sem essa API.
        let altura = vv && vv.height ? vv.height : window.innerHeight;

        // Em alguns estados do Safari/PWA o viewport visual começa abaixo de y=0.
        // Somar offsetTop evita uma faixa vazia quando a UI do sistema muda de estado.
        if (vv && Number.isFinite(vv.offsetTop) && vv.offsetTop > 0) {
            altura += vv.offsetTop;
        }

        if (!Number.isFinite(altura) || altura <= 0) {
            altura = document.documentElement.clientHeight || screen.height;
        }

        root.style.setProperty('--app-viewport-height', Math.round(altura) + 'px');
    }

    function alphaDaCor(cor) {
        if (!cor) return 0;
        if (cor === 'transparent') return 0;

        const rgba = cor.match(/rgba?\(([^)]+)\)/i);
        if (!rgba) return 1;

        const partes = rgba[1].split(',').map(v => v.trim());
        if (partes.length < 4) return 1;

        const a = Number(partes[3]);
        return Number.isFinite(a) ? a : 1;
    }

    function elementoVisivel(el) {
        if (!el || el === document.documentElement || el === document.body) return false;

        const estilo = getComputedStyle(el);
        if (estilo.display === 'none' || estilo.visibility === 'hidden' || Number(estilo.opacity) === 0) return false;

        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top <= 6;
    }

    function elementoComFundoNoTopo() {
        const x = Math.max(1, Math.min(window.innerWidth / 2, window.innerWidth - 1));
        const y = 1;
        const elementos = document.elementsFromPoint(x, y);

        // Prioriza os containers de topo conhecidos do app.
        const candidatosPrioritarios = [
            document.querySelector('#painel-dados-grupo:not(.hidden) .grupo-add-overlay:not(.hidden) .grupo-add-header'),
            document.querySelector('#painel-dados-grupo:not(.hidden) .grupo-dados-topo'),
            document.querySelector('#painel-dados-contato:not(.hidden) .painel-contato-header'),
            document.querySelector('#painel-dados-usuario[style*="flex"] .dados-usuario-header'),
            document.querySelector('#tela-chat.ativa .chat-header'),
            document.querySelector('#tela-conversas .topo-conversas')
        ].filter(Boolean);

        for (const el of candidatosPrioritarios) {
            if (elementoVisivel(el)) return el;
        }

        // Fallback: pega o primeiro elemento real sob a safe area que possua fundo.
        for (const el of elementos) {
            if (!elementoVisivel(el)) continue;

            const estilo = getComputedStyle(el);
            const temImagem = estilo.backgroundImage && estilo.backgroundImage !== 'none';
            const temCor = alphaDaCor(estilo.backgroundColor) > 0.01;

            if (temImagem || temCor) return el;
        }

        return null;
    }

    function corSolidaParaThemeColor(cor, fallback) {
        if (!cor || cor === 'transparent' || alphaDaCor(cor) < .35) return fallback;
        return cor;
    }

    function atualizarSafeArea() {
        agendado = false;
        atualizarAlturaViewport();
        atualizarEstadoTopoHome();

        const alvo = elementoComFundoNoTopo();
        const bodyStyle = getComputedStyle(document.body);

        const fallbackCor = bodyStyle.backgroundColor && bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? bodyStyle.backgroundColor
            : '#050505';

        if (!alvo) {
            root.style.setProperty('--safe-area-bg-color', fallbackCor);
            root.style.setProperty('--safe-area-bg-image', 'none');
            root.style.setProperty('--safe-area-backdrop', 'none');
            atualizarThemeColor(fallbackCor);
            return;
        }

        const estilo = getComputedStyle(alvo);
        const bgColor = estilo.backgroundColor || fallbackCor;
        const bgImage = estilo.backgroundImage && estilo.backgroundImage !== 'none'
            ? estilo.backgroundImage
            : 'none';

        const blur =
            estilo.backdropFilter ||
            estilo.webkitBackdropFilter ||
            'none';

        root.style.setProperty('--safe-area-bg-color', bgColor);
        root.style.setProperty('--safe-area-bg-image', bgImage);
        root.style.setProperty('--safe-area-backdrop', blur);

        atualizarThemeColor(corSolidaParaThemeColor(bgColor, fallbackCor));
    }

    function atualizarThemeColor(cor) {
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', cor);
    }

    function solicitarAtualizacao() {
        if (agendado) return;
        agendado = true;
        requestAnimationFrame(atualizarSafeArea);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', solicitarAtualizacao, { once: true });
    } else {
        solicitarAtualizacao();
    }

    // Mudanças de tela, abertura de chat/modal e alterações de classe/style.
    const observer = new MutationObserver(solicitarAtualizacao);
    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style']
    });

    window.addEventListener('resize', solicitarAtualizacao, { passive: true });
    window.addEventListener('orientationchange', solicitarAtualizacao, { passive: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', solicitarAtualizacao, { passive: true });
        window.visualViewport.addEventListener('scroll', solicitarAtualizacao, { passive: true });
    }
    window.addEventListener('pageshow', solicitarAtualizacao, { passive: true });
    document.addEventListener('visibilitychange', solicitarAtualizacao);

    setTimeout(solicitarAtualizacao, 50);
    setTimeout(solicitarAtualizacao, 250);
    setTimeout(solicitarAtualizacao, 800);

    bloquearArrastoNativoIOS();

    window.atualizarSafeArea = atualizarSafeArea;
    window.atualizarAlturaViewport = atualizarAlturaViewport;
    window.atualizarEstadoTopoHome = atualizarEstadoTopoHome;
})();
