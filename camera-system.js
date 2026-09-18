// ==========================================
// CÂMERA INTEGRADA DO WHATISAPP
// ==========================================
// Abre a câmera dentro do PWA, captura foto e grava vídeo sem sair do app.

(function () {
    let streamCamera = null;
    let streamMicrofoneVideo = null;
    let cameraFrontal = false;
    let modoAtual = 'foto';
    let gravadorVideo = null;
    let chunksVideo = [];
    let gravandoVideo = false;
    let descartarVideo = false;
    let timerVideo = null;
    let inicioVideo = 0;
    let torchAtivo = false;

    function el(id) {
        return document.getElementById(id);
    }

    function cameraAberta() {
        const overlay = el('camera-whatisapp');
        return !!overlay && !overlay.classList.contains('hidden');
    }

    function atualizarEspelho() {
        const video = el('camera-preview');
        if (!video) return;
        video.classList.toggle('camera-frontal', cameraFrontal);
    }

    function pararTracks(stream) {
        if (!stream) return;
        stream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
    }

    function limparTimerVideo() {
        if (timerVideo) {
            clearInterval(timerVideo);
            timerVideo = null;
        }
    }

    function formatarTempo(segundos) {
        const total = Math.max(0, Math.floor(segundos || 0));
        const min = Math.floor(total / 60);
        const seg = total % 60;
        return min + ':' + String(seg).padStart(2, '0');
    }

    function atualizarTimerVideo() {
        const display = el('camera-video-timer');
        if (!display) return;
        display.textContent = formatarTempo((Date.now() - inicioVideo) / 1000);
    }

    function definirEstadoGravacao(ativo) {
        gravandoVideo = ativo;
        const overlay = el('camera-whatisapp');
        const obturador = el('camera-shutter');
        const timer = el('camera-video-timer');

        overlay?.classList.toggle('camera-gravando-video', ativo);
        obturador?.classList.toggle('gravando', ativo);

        if (timer) {
            timer.classList.toggle('hidden', !ativo);
            if (!ativo) timer.textContent = '0:00';
        }
    }

    function atualizarModoUI() {
        document.querySelectorAll('[data-camera-mode]').forEach(btn => {
            btn.classList.toggle('ativo', btn.dataset.cameraMode === modoAtual);
        });

        const obturador = el('camera-shutter');
        if (obturador) {
            obturador.classList.toggle('modo-video', modoAtual === 'video');
        }
    }

    async function atualizarSuporteFlash() {
        const btn = el('camera-flash');
        const track = streamCamera?.getVideoTracks?.()[0];

        let suporta = false;

        try {
            const caps = track?.getCapabilities?.();
            suporta = !!caps?.torch && !cameraFrontal;
        } catch (e) {}

        if (!suporta && torchAtivo) {
            torchAtivo = false;
        }

        btn?.classList.toggle('indisponivel', !suporta);
        btn?.classList.toggle('ativo', torchAtivo);
        if (btn) btn.disabled = !suporta;
    }

    async function iniciarStreamCamera() {
        const video = el('camera-preview');
        if (!video) return false;

        pararTracks(streamCamera);
        streamCamera = null;
        torchAtivo = false;

        const facingMode = cameraFrontal ? 'user' : 'environment';

        try {
            streamCamera = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: facingMode },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });

            video.srcObject = streamCamera;
            video.muted = true;
            video.playsInline = true;

            try { await video.play(); } catch (e) {}

            atualizarEspelho();
            await atualizarSuporteFlash();
            return true;
        } catch (erro) {
            console.error('[Câmera] Não foi possível abrir:', erro);

            if (erro?.name === 'NotAllowedError') {
                alert('Libera o acesso à câmera pro WhatisApp e tenta de novo.');
            } else {
                alert('Não foi possível abrir a câmera.');
            }

            return false;
        }
    }

    async function enviarArquivoCapturado(file) {
        if (!file) return false;

        if (typeof window.enviarFotoChat !== 'function') {
            console.error('[Câmera] enviarFotoChat não está disponível.');
            alert('Não foi possível enviar a mídia agora.');
            return false;
        }

        const eventoFake = {
            target: {
                files: [file],
                value: ''
            }
        };

        await window.enviarFotoChat(eventoFake);
        return true;
    }

    window.abrirCameraWhatisApp = async function () {
        if (!navigator.mediaDevices?.getUserMedia) {
            alert('Este navegador não suporta câmera dentro do aplicativo.');
            return;
        }

        const overlay = el('camera-whatisapp');
        if (!overlay) return;

        const temDestino =
            !!window.grupoAtualId ||
            !!(typeof destinatarioAtual !== 'undefined' && destinatarioAtual);

        if (!temDestino) return;

        overlay.classList.remove('hidden');
        document.body?.classList.add('camera-whatisapp-aberta');

        modoAtual = 'foto';
        cameraFrontal = false;
        descartarVideo = false;
        atualizarModoUI();

        const abriu = await iniciarStreamCamera();

        if (!abriu) {
            window.fecharCameraWhatisApp();
        }
    };

    window.fecharCameraWhatisApp = function () {
        const overlay = el('camera-whatisapp');

        if (gravandoVideo && gravadorVideo?.state !== 'inactive') {
            descartarVideo = true;
            try { gravadorVideo.stop(); } catch (e) {}
        }

        limparTimerVideo();
        definirEstadoGravacao(false);

        pararTracks(streamMicrofoneVideo);
        streamMicrofoneVideo = null;

        pararTracks(streamCamera);
        streamCamera = null;

        const video = el('camera-preview');
        if (video) video.srcObject = null;

        torchAtivo = false;
        overlay?.classList.add('hidden');
        document.body?.classList.remove('camera-whatisapp-aberta');
    };

    window.trocarCameraWhatisApp = async function () {
        if (gravandoVideo) return;
        cameraFrontal = !cameraFrontal;
        await iniciarStreamCamera();
    };

    window.alternarFlashCameraWhatisApp = async function () {
        if (cameraFrontal || !streamCamera) return;

        const track = streamCamera.getVideoTracks()[0];
        if (!track?.applyConstraints) return;

        try {
            const caps = track.getCapabilities?.();
            if (!caps?.torch) return;

            torchAtivo = !torchAtivo;

            await track.applyConstraints({
                advanced: [{ torch: torchAtivo }]
            });

            const btn = el('camera-flash');
            btn?.classList.toggle('ativo', torchAtivo);
        } catch (erro) {
            console.warn('[Câmera] Flash/torch indisponível:', erro);
            torchAtivo = false;
            await atualizarSuporteFlash();
        }
    };

    window.definirModoCameraWhatisApp = function (modo) {
        if (gravandoVideo) return;
        if (modo !== 'foto' && modo !== 'video') return;
        modoAtual = modo;
        atualizarModoUI();
    };

    async function capturarFoto() {
        const video = el('camera-preview');
        const canvas = el('camera-canvas');

        if (!video || !canvas || !streamCamera) return;
        if (!video.videoWidth || !video.videoHeight) return;

        const largura = video.videoWidth;
        const altura = video.videoHeight;

        canvas.width = largura;
        canvas.height = altura;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();

        if (cameraFrontal) {
            ctx.translate(largura, 0);
            ctx.scale(-1, 1);
        }

        ctx.drawImage(video, 0, 0, largura, altura);
        ctx.restore();

        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.92);
        });

        if (!blob) return;

        const file = new File(
            [blob],
            'camera_' + Date.now() + '.jpg',
            { type: 'image/jpeg' }
        );

        window.fecharCameraWhatisApp();
        await enviarArquivoCapturado(file);
    }

    function mimeVideoPreferido() {
        if (!window.MediaRecorder) return '';

        const candidatos = [
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];

        return candidatos.find(tipo => {
            try { return MediaRecorder.isTypeSupported(tipo); }
            catch (e) { return false; }
        }) || '';
    }

    function extensaoVideo(mime) {
        return String(mime || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
    }

    async function iniciarGravacaoVideo() {
        if (!streamCamera || gravandoVideo || !window.MediaRecorder) return;

        let streamCombinado = new MediaStream();

        streamCamera.getVideoTracks().forEach(track => {
            streamCombinado.addTrack(track);
        });

        try {
            streamMicrofoneVideo = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            streamMicrofoneVideo.getAudioTracks().forEach(track => {
                streamCombinado.addTrack(track);
            });
        } catch (erro) {
            console.warn('[Câmera] Vídeo será gravado sem áudio:', erro);
        }

        const mime = mimeVideoPreferido();

        try {
            gravadorVideo = mime
                ? new MediaRecorder(streamCombinado, { mimeType: mime })
                : new MediaRecorder(streamCombinado);
        } catch (erro) {
            console.error('[Câmera] MediaRecorder falhou:', erro);
            pararTracks(streamMicrofoneVideo);
            streamMicrofoneVideo = null;
            alert('Não foi possível iniciar a gravação de vídeo.');
            return;
        }

        chunksVideo = [];
        descartarVideo = false;

        gravadorVideo.ondataavailable = event => {
            if (event.data?.size) chunksVideo.push(event.data);
        };

        gravadorVideo.onstop = async () => {
            limparTimerVideo();
            definirEstadoGravacao(false);

            pararTracks(streamMicrofoneVideo);
            streamMicrofoneVideo = null;

            const mimeFinal = gravadorVideo?.mimeType || mime || 'video/webm';
            const chunks = chunksVideo.slice();
            chunksVideo = [];

            const deveDescartar = descartarVideo;
            descartarVideo = false;

            if (deveDescartar || !chunks.length) {
                gravadorVideo = null;
                return;
            }

            const blob = new Blob(chunks, { type: mimeFinal });
            const file = new File(
                [blob],
                'camera_' + Date.now() + '.' + extensaoVideo(mimeFinal),
                { type: mimeFinal }
            );

            gravadorVideo = null;
            window.fecharCameraWhatisApp();
            await enviarArquivoCapturado(file);
        };

        inicioVideo = Date.now();
        definirEstadoGravacao(true);
        atualizarTimerVideo();
        timerVideo = setInterval(atualizarTimerVideo, 250);

        gravadorVideo.start(250);
    }

    function pararGravacaoVideo() {
        if (!gravandoVideo || !gravadorVideo) return;

        try {
            if (gravadorVideo.state !== 'inactive') {
                gravadorVideo.stop();
            }
        } catch (e) {}
    }

    window.acionarObturadorWhatisApp = function () {
        if (modoAtual === 'video') {
            if (gravandoVideo) pararGravacaoVideo();
            else iniciarGravacaoVideo();
            return;
        }

        capturarFoto();
    };

    window.abrirGaleriaCameraWhatisApp = function () {
        const input = el('input-arquivo-chat');
        if (!input) return;

        window.fecharCameraWhatisApp();
        input.click();
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && cameraAberta()) {
            window.fecharCameraWhatisApp();
        }
    });
})();
