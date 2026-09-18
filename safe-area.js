// ==========================================
// SAFE AREA DINÂMICA / STATUS BAR iOS
// ==========================================
// Simula a barra do sistema acompanhando o material/cor do elemento
// que estiver encostado no topo da viewport.

(function () {
    const root = document.documentElement;
    let agendado = false;

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
            document.querySelector('#tela-chat.ativa .chat-header'),
            document.querySelector('#tela-conversas .topo-conversas'),
            document.querySelector('#painel-dados-usuario[style*="flex"] .dados-usuario-header'),
            document.querySelector('#painel-dados-contato:not(.hidden) .menu-chat-header')
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
    window.addEventListener('pageshow', solicitarAtualizacao, { passive: true });
    document.addEventListener('visibilitychange', solicitarAtualizacao);

    window.atualizarSafeArea = atualizarSafeArea;
})();
