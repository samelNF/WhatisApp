// ==========================================
// LIGAÇÕES DE VOZ - WEBRTC + SUPABASE
// ==========================================
(function () {
    const STATUS_FINAIS = new Set([
        'ended',
        'cancelled',
        'rejected',
        'missed',
        'failed'
    ]);

    const STATUS_VERDES = new Set(['ringing', 'connecting', 'active']);
    const STATUS_VERMELHOS = new Set(['cancelled', 'rejected', 'missed', 'failed']);

    const RTC_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.relay.metered.ca:80' },
            {
                urls: 'turn:global.relay.metered.ca:80',
                username: '76885336b576177095cc6d73',
                credential: 'HjAdex+s0tRaVbs/'
            },
            {
                urls: 'turn:global.relay.metered.ca:80?transport=tcp',
                username: '76885336b576177095cc6d73',
                credential: 'HjAdex+s0tRaVbs/'
            },
            {
                urls: 'turn:global.relay.metered.ca:443',
                username: '76885336b576177095cc6d73',
                credential: 'HjAdex+s0tRaVbs/'
            },
            {
                urls: 'turns:global.relay.metered.ca:443?transport=tcp',
                username: '76885336b576177095cc6d73',
                credential: 'HjAdex+s0tRaVbs/'
            }
        ],
        iceCandidatePoolSize: 6
    };

    let chamadaAtual = null;
    let peer = null;
    let streamLocal = null;
    let streamRemoto = null;
    let streamRemotoAudio = null;
    let streamRemotoVideo = null;
    let videoRemotoRecebendo = false;
    let canalChamadas = null;
    let canalIce = null;
    let candidatosPendentesRemotos = [];
    let candidatosPendentesLocais = [];
    let timerDuracao = null;
    let timerSemResposta = null;
    let wakeLock = null;
    let inicializadoParaEmail = null;
    let mutado = false;
    let videoSender = null;
    let cameraLigada = false;
    let pedidoVideoMostrado = null;
    let timerDowngradeVideo = null;
    let ultimaNegociacaoIniciada = 0;
    let ultimaNegociacaoRespondida = 0;
    let ultimaAnswerAplicada = 0;
    let renegociacaoEmCurso = false;
    let diagnosticosPendentes = [];

    function supabaseAtual() {
        try {
            return typeof _supabase !== 'undefined' ? _supabase : null;
        } catch (e) {
            return null;
        }
    }

    function meuEmail() {
        return (localStorage.getItem('usuarioLogado') || '').trim().toLowerCase();
    }

    function normalizarEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function ehFinal(status) {
        return STATUS_FINAIS.has(String(status || ''));
    }

    async function registrarDiagnostico(evento, dados = {}) {
        const supabase = supabaseAtual();
        const chamadaId = chamadaAtual?.id;
        const email = meuEmail();

        if (!supabase || !email) return;

        if (!chamadaId) {
            diagnosticosPendentes.push({ evento, dados });
            if (diagnosticosPendentes.length > 80) {
                diagnosticosPendentes = diagnosticosPendentes.slice(-50);
            }
            return;
        }

        try {
            await supabase
                .from('chamada_diagnosticos')
                .insert([{
                    chamada_id: chamadaId,
                    usuario_email: email,
                    evento,
                    dados
                }]);
        } catch (e) {}
    }

    async function flushDiagnosticosPendentes() {
        if (!chamadaAtual?.id || !diagnosticosPendentes.length) return;

        const lista = diagnosticosPendentes.splice(0);

        for (const item of lista) {
            await registrarDiagnostico(item.evento, item.dados);
        }
    }

    async function tentarTocarAudioRemoto() {
        const audio = document.getElementById('chamada-audio-remoto');
        const btn = document.getElementById('chamada-btn-ativar-audio');

        if (!audio) return false;

        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false;
        audio.volume = 1;

        try {
            await audio.play();
            btn?.classList.add('hidden');
            registrarDiagnostico('audio_play_ok', {});
            return true;
        } catch (erro) {
            console.warn('[Ligação] Reprodução de áudio bloqueada:', erro);
            btn?.classList.remove('hidden');
            registrarDiagnostico('audio_play_bloqueado', {
                name: erro?.name || '',
                message: erro?.message || ''
            });
            return false;
        }
    }

    window.ativarAudioLigacao = function () {
        return tentarTocarAudioRemoto();
    };


    function modoVideo(chamada = chamadaAtual) {
        return String(chamada?.modo || chamada?.tipo || 'voz') === 'video';
    }

    function campoMinhaCamera(chamada = chamadaAtual) {
        if (!chamada) return null;
        return euSouChamador(chamada)
            ? 'chamador_camera_ativa'
            : 'receptor_camera_ativa';
    }

    function campoCameraOutro(chamada = chamadaAtual) {
        if (!chamada) return null;
        return euSouChamador(chamada)
            ? 'receptor_camera_ativa'
            : 'chamador_camera_ativa';
    }

    function minhaCameraAtiva(chamada = chamadaAtual) {
        const campo = campoMinhaCamera(chamada);
        return campo ? chamada?.[campo] === true : false;
    }

    function cameraOutroAtiva(chamada = chamadaAtual) {
        const campo = campoCameraOutro(chamada);
        return campo ? chamada?.[campo] === true : false;
    }

    function atualizarTipoTela(chamada = chamadaAtual) {
        const video = modoVideo(chamada);
        const label = document.querySelector('#tela-chamada .chamada-tipo-label');
        const tela = document.getElementById('tela-chamada');
        const btn = document.getElementById('chamada-btn-video');

        if (label) label.textContent = video ? 'Ligação de vídeo' : 'Ligação de voz';
        if (tela) tela.classList.toggle('chamada-modo-video', video);
        if (btn) btn.classList.toggle('ativo', video && minhaCameraAtiva(chamada));

        const remoto = document.getElementById('chamada-video-remoto');
        const local = document.getElementById('chamada-video-local');
        const avatar = document.getElementById('chamada-avatar');

        const temVideoLocal =
            !!streamLocal?.getVideoTracks?.().some(
                track => track.readyState === 'live'
            );

        const temVideoRemoto =
            videoRemotoRecebendo ||
            !!streamRemotoVideo?.getVideoTracks?.().some(
                track =>
                    track.readyState === 'live' &&
                    track.muted !== true
            );

        if (remoto) {
            remoto.classList.toggle(
                'hidden',
                !video || !temVideoRemoto
            );
        }

        if (local) {
            local.classList.toggle(
                'hidden',
                !video || !temVideoLocal
            );
        }

        if (avatar) {
            avatar.classList.toggle(
                'chamada-avatar-com-video',
                video && temVideoRemoto
            );
        }
    }

    async function atualizarMinhaCameraNoBanco(ativa) {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return;

        const campo = campoMinhaCamera(chamadaAtual);
        if (!campo) return;

        const atualizada = await atualizarChamada(
            chamadaAtual.id,
            { [campo]: !!ativa }
        );

        if (atualizada) {
            chamadaAtual = atualizada;
            atualizarTipoTela(atualizada);
        }
    }

    async function obterCameraLigacao(atualizarBanco = true) {
        if (streamLocal?.getVideoTracks?.().some(track => track.readyState === 'live')) {
            cameraLigada = true;
            if (atualizarBanco) await atualizarMinhaCameraNoBanco(true);
            atualizarTipoTela();
            return streamLocal.getVideoTracks()[0];
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Câmera não disponível neste navegador.');
        }

        const videoStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        const track = videoStream.getVideoTracks()[0];
        if (!track) throw new Error('Câmera não retornou vídeo.');

        track.enabled = true;
        try { track.contentHint = 'motion'; } catch (e) {}

        if (!streamLocal) streamLocal = new MediaStream();
        streamLocal.addTrack(track);
        cameraLigada = true;

        if (videoSender) {
            await videoSender.replaceTrack(track);
        }

        const local = document.getElementById('chamada-video-local');
        if (local) {
            local.srcObject = streamLocal;
            local.muted = true;
            local.playsInline = true;
            local.autoplay = true;
            local.play().catch(() => {});
        }

        if (atualizarBanco) await atualizarMinhaCameraNoBanco(true);
        atualizarTipoTela();

        return track;
    }

    async function desligarCameraLigacao(atualizarBanco = true) {
        const tracks = streamLocal?.getVideoTracks?.() || [];

        for (const track of tracks) {
            try { track.stop(); } catch (e) {}
            try { streamLocal.removeTrack(track); } catch (e) {}
        }

        cameraLigada = false;

        if (videoSender) {
            try { await videoSender.replaceTrack(null); } catch (e) {}
        }

        const local = document.getElementById('chamada-video-local');
        if (local) local.srcObject = null;

        if (atualizarBanco && chamadaAtual?.id) {
            await atualizarMinhaCameraNoBanco(false);
        }

        atualizarTipoTela();
        agendarVerificacaoDowngradeVideo();
    }

    async function verificarDowngradeVideo() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id || !modoVideo(chamadaAtual)) return;

        const { data } = await supabase
            .from('chamadas')
            .select('*')
            .eq('id', chamadaAtual.id)
            .maybeSingle();

        if (!data || data.status !== 'active' || data.modo !== 'video') return;

        if (
            data.chamador_camera_ativa !== true &&
            data.receptor_camera_ativa !== true
        ) {
            const atualizada = await atualizarChamada(data.id, {
                modo: 'voz'
            });

            if (atualizada) {
                chamadaAtual = atualizada;
                atualizarTipoTela(atualizada);
            }
        }
    }

    function agendarVerificacaoDowngradeVideo(delay = 900) {
        if (timerDowngradeVideo) clearTimeout(timerDowngradeVideo);

        timerDowngradeVideo = setTimeout(() => {
            timerDowngradeVideo = null;
            verificarDowngradeVideo();
        }, delay);
    }

    function esconderPedidoVideo() {
        const painel = document.getElementById('chamada-pedido-video');
        if (painel) painel.classList.add('hidden');
        pedidoVideoMostrado = null;
    }

    async function mostrarPedidoVideo(chamada) {
        if (!chamada?.video_pedido_id || chamada.video_pedido_status !== 'pending') {
            esconderPedidoVideo();
            return;
        }

        const painel = document.getElementById('chamada-pedido-video');
        const texto = document.getElementById('chamada-pedido-video-texto');
        const acoes = document.getElementById('chamada-pedido-video-acoes');

        if (!painel) return;

        pedidoVideoMostrado = chamada.video_pedido_id;
        painel.classList.remove('hidden');

        const fuiEu =
            normalizarEmail(chamada.video_pedido_por) === meuEmail();

        if (fuiEu) {
            if (texto) texto.textContent = 'Esperando a outra pessoa aceitar o vídeo...';
            acoes?.classList.add('hidden');
            return;
        }

        const perfil = await obterPerfil(chamada.video_pedido_por);
        if (texto) {
            texto.textContent =
                (perfil?.usuario || 'A outra pessoa') +
                ' quer ativar o vídeo. Ativar sua câmera também?';
        }
        acoes?.classList.remove('hidden');
    }

    window.responderPedidoVideoLigacao = async function (aceitar) {
        if (
            !chamadaAtual?.id ||
            !pedidoVideoMostrado ||
            chamadaAtual.video_pedido_status !== 'pending'
        ) {
            esconderPedidoVideo();
            return;
        }

        if (!aceitar) {
            const atualizada = await atualizarChamada(chamadaAtual.id, {
                video_pedido_status: 'rejected'
            });

            if (atualizada) chamadaAtual = atualizada;
            esconderPedidoVideo();
            return;
        }

        try {
            await obterCameraLigacao(false);
        } catch (erro) {
            console.warn('[Ligação] Câmera recusada/indisponível:', erro);

            const atualizada = await atualizarChamada(chamadaAtual.id, {
                video_pedido_status: 'rejected'
            });

            if (atualizada) chamadaAtual = atualizada;
            esconderPedidoVideo();
            alert('Não foi possível ativar a câmera. A ligação continua por voz.');
            return;
        }

        const campo = campoMinhaCamera(chamadaAtual);
        const atualizada = await atualizarChamada(chamadaAtual.id, {
            video_pedido_status: 'approved',
            modo: 'video',
            [campo]: true
        });

        if (atualizada) {
            chamadaAtual = atualizada;
            atualizarTipoTela(atualizada);
        }

        esconderPedidoVideo();
    };

    async function solicitarVideoNaLigacao() {
        if (!chamadaAtual?.id || chamadaAtual.status !== 'active') return;

        if (modoVideo(chamadaAtual)) {
            return obterCameraLigacao(true);
        }

        const pedidoId =
            globalThis.crypto?.randomUUID?.() ||
            (Date.now().toString(36) + Math.random().toString(36).slice(2));

        const atualizada = await atualizarChamada(chamadaAtual.id, {
            video_pedido_id: pedidoId,
            video_pedido_por: meuEmail(),
            video_pedido_status: 'pending'
        });

        if (atualizada) {
            chamadaAtual = atualizada;
            await mostrarPedidoVideo(atualizada);
        }
    }

    window.alternarCameraLigacao = async function () {
        if (!chamadaAtual?.id || chamadaAtual.status !== 'active') return;

        if (!modoVideo(chamadaAtual)) {
            await solicitarVideoNaLigacao();
            return;
        }

        if (minhaCameraAtiva(chamadaAtual) || cameraLigada) {
            await desligarCameraLigacao(true);
            return;
        }

        try {
            await obterCameraLigacao(true);
            await sincronizarTracksNoPeer();

            const videoTransceiver = transceiverPorKind('video');
            if (
                videoTransceiver &&
                videoTransceiver.currentDirection !== 'sendrecv' &&
                euSouChamador(chamadaAtual)
            ) {
                await iniciarRenegociacaoVideoPrivado();
            }
        } catch (erro) {
            console.warn('[Ligação] Não foi possível ligar a câmera:', erro);
            alert('Não foi possível acessar a câmera.');
        }
    };

    function outroParticipante(chamada) {
        const meu = meuEmail();
        const chamador = normalizarEmail(chamada?.chamador_email);
        const receptor = normalizarEmail(chamada?.receptor_email);
        return chamador === meu ? receptor : chamador;
    }

    function euSouChamador(chamada) {
        return normalizarEmail(chamada?.chamador_email) === meuEmail();
    }

    function formatarDuracao(segundos) {
        const total = Math.max(0, Math.floor(Number(segundos) || 0));

        if (total < 60) {
            return total === 1 ? '1 segundo' : total + ' segundos';
        }

        const minutos = Math.floor(total / 60);
        const resto = total % 60;

        if (!resto) return minutos === 1 ? '1 minuto' : minutos + ' minutos';
        return minutos + ':' + String(resto).padStart(2, '0');
    }

    function statusDaBolha(msg, ehMinha) {
        const status = String(msg?.meta?.status || 'ended');

        if (status === 'ringing') {
            return ehMinha ? 'Ligando...' : 'Recebendo ligação';
        }

        if (status === 'connecting') return 'Conectando...';
        if (status === 'active') return 'Em andamento';

        if (status === 'ended') {
            const duracao = Number(msg?.meta?.duracao_segundos || 0);
            return duracao > 0 ? formatarDuracao(duracao) : 'Encerrada';
        }

        if (status === 'cancelled') return 'Cancelada';
        if (status === 'rejected') return 'Recusada';
        if (status === 'missed') return 'Não atendida';
        if (status === 'failed') return 'Falhou';

        return 'Ligação';
    }

    function classeCorStatus(status) {
        if (STATUS_VERDES.has(status)) return 'chamada-status-verde';
        if (STATUS_VERMELHOS.has(status)) return 'chamada-status-vermelho';
        return 'chamada-status-neutro';
    }

    function svgTelefone(ehMinha) {
        const seta = ehMinha
            ? '<path class="chamada-direcao" d="M13.7 5.2h4.9v4.9M18.4 5.4l-5.7 5.7"></path>'
            : '<path class="chamada-direcao" d="M10.3 10.8H5.4V5.9M5.6 10.6l5.7-5.7"></path>';

        return `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6.8 3.7 9 7.8 7.1 9.3c1.3 2.8 3 4.5 5.8 5.8l1.5-1.9 4.1 2.2c.6.3.8.9.7 1.5-.5 1.6-1.9 2.7-3.6 2.7C9.3 19.6 4 14.3 4 8c0-1.7 1.1-3.1 2.7-3.6.6-.2 1.2.1 1.5.7Z"></path>
                ${seta}
            </svg>
        `;
    }

    window.ehMensagemChamada = function (msg) {
        return !!msg && (
            msg.tipo === 'chamada' ||
            msg.texto === '[CHAMADA]'
        );
    };

    window.renderizarBalaoChamada = async function (msg, ehMinha) {
        const container = document.getElementById('chat-mensagens');
        if (!container || !msg) return;

        if (msg.id !== null && msg.id !== undefined) {
            const existente = container.querySelector(
                '.balao-msg[data-message-id="' + String(msg.id) + '"]'
            );
            if (existente) return;
        }

        const status = String(msg?.meta?.status || 'ended');
        const hora = typeof formatarHora === 'function'
            ? formatarHora(msg.created_at || new Date())
            : '';

        const balao = document.createElement('div');
        balao.className =
            'balao-msg balao-chamada ' +
            (ehMinha ? 'balao-enviada ' : 'balao-recebida ') +
            classeCorStatus(status);

        if (msg.id !== null && msg.id !== undefined) {
            balao.dataset.messageId = String(msg.id);
        }

        if (msg.chamada_id) {
            balao.dataset.chamadaId = String(msg.chamada_id);
        }

        balao.innerHTML = `
            <div class="chamada-bolha-icone">
                <span class="chamada-bolha-asset ${(msg?.meta?.modo === 'video' || msg?.meta?.tipo_chamada === 'video') ? 'video' : 'voz'}" aria-hidden="true"></span>
            </div>

            <div class="chamada-bolha-info">
                <strong class="chamada-bolha-titulo">${(msg?.meta?.modo === 'video' || msg?.meta?.tipo_chamada === 'video') ? 'Ligação de vídeo' : 'Ligação de voz'}</strong>
                <span class="chamada-bolha-status">${statusDaBolha(msg, ehMinha)}</span>
            </div>

            <span class="chamada-bolha-hora">${hora}</span>
        `;

        balao.addEventListener('click', () => {
            if (msg.chamada_id) {
                window.abrirChamadaPelaMensagem(msg.chamada_id);
            }
        });

        container.appendChild(balao);
        container.scrollTop = container.scrollHeight;
    };

    window.atualizarBalaoChamada = function (msg) {
        if (!msg?.id) return;

        const balao = document.querySelector(
            '#chat-mensagens .balao-msg[data-message-id="' + String(msg.id) + '"]'
        );

        if (!balao) return;

        const ehMinha = normalizarEmail(msg.remetente_email) === meuEmail();
        const status = String(msg?.meta?.status || 'ended');

        balao.classList.remove(
            'chamada-status-verde',
            'chamada-status-vermelho',
            'chamada-status-neutro'
        );
        balao.classList.add(classeCorStatus(status));

        const statusEl = balao.querySelector('.chamada-bolha-status');
        if (statusEl) statusEl.textContent = statusDaBolha(msg, ehMinha);

        const tituloEl = balao.querySelector('.chamada-bolha-titulo');
        if (tituloEl) {
            tituloEl.textContent =
                (msg?.meta?.modo === 'video' || msg?.meta?.tipo_chamada === 'video')
                    ? 'Ligação de vídeo'
                    : 'Ligação de voz';
        }
    };

    function atualizarPreviewGlobal() {
        const anterior = window.formatarPreviewMensagem;

        window.formatarPreviewMensagem = function (msg) {
            if (window.ehMensagemChamada(msg)) {
                return (msg?.meta?.modo === 'video' || msg?.meta?.tipo_chamada === 'video')
                    ? '🎥 Ligação de vídeo'
                    : '📞 Ligação de voz';
            }
            return typeof anterior === 'function'
                ? anterior(msg)
                : String(msg?.texto || '');
        };
    }

    async function obterPerfil(email) {
        const supabase = supabaseAtual();
        if (!supabase || !email) return null;

        const { data } = await supabase
            .from('usuarios')
            .select('usuario, email, foto_url, cor')
            .eq('email', email)
            .maybeSingle();

        return data || null;
    }

    async function preencherTelaChamada(chamada) {
        const outroEmail = outroParticipante(chamada);
        const perfil = await obterPerfil(outroEmail);

        const nome = document.getElementById('chamada-nome');
        const foto = document.getElementById('chamada-avatar');

        if (nome) nome.textContent = perfil?.usuario || outroEmail || 'Contato';

        if (typeof window.aplicarAvatarUsuario === 'function') {
            window.aplicarAvatarUsuario(
                foto,
                perfil?.foto_url || '',
                perfil?.cor || '#3a3a3c'
            );
        } else if (foto) {
            foto.src = perfil?.foto_url || 'svg/user-placeholder.svg';
            foto.style.backgroundColor = perfil?.foto_url
                ? 'transparent'
                : (perfil?.cor || '#3a3a3c');
        }
    }

    function definirModoTela(modo) {
        const overlay = document.getElementById('tela-chamada');
        if (!overlay) return;

        overlay.dataset.modo = modo;
        overlay.classList.remove('hidden');

        document.body?.classList.add('chamada-aberta');

        const receber = document.getElementById('chamada-controles-recebendo');
        const normal = document.getElementById('chamada-controles-normal');

        if (receber) receber.classList.toggle('hidden', modo !== 'recebendo');
        if (normal) normal.classList.toggle('hidden', modo === 'recebendo');
    }

    function esconderTelaChamada() {
        document.getElementById('tela-chamada')?.classList.add('hidden');
        document.body?.classList.remove('chamada-aberta');
    }

    function atualizarStatusTela(texto) {
        const el = document.getElementById('chamada-status');
        if (el) el.textContent = texto || '';
    }

    function atualizarTimerTela() {
        if (!chamadaAtual?.answered_at) return;

        const inicio = new Date(chamadaAtual.answered_at).getTime();
        if (!Number.isFinite(inicio)) return;

        const segundos = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
        atualizarStatusTela(
            Math.floor(segundos / 60) +
            ':' +
            String(segundos % 60).padStart(2, '0')
        );
    }

    function iniciarTimerDuracao() {
        if (timerDuracao) clearInterval(timerDuracao);
        atualizarTimerTela();
        timerDuracao = setInterval(atualizarTimerTela, 1000);
    }

    function pararTimers() {
        if (timerDuracao) {
            clearInterval(timerDuracao);
            timerDuracao = null;
        }

        if (timerSemResposta) {
            clearTimeout(timerSemResposta);
            timerSemResposta = null;
        }
    }

    async function manterTelaAcordada() {
        try {
            if ('wakeLock' in navigator && !wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (e) {}
    }

    async function liberarWakeLock() {
        try {
            await wakeLock?.release?.();
        } catch (e) {}
        wakeLock = null;
    }

    async function abrirTelaParaChamada(chamada, modo) {
        chamadaAtual = chamada;
        await preencherTelaChamada(chamada);
        definirModoTela(modo);

        atualizarTipoTela(chamada);

        if (modo === 'recebendo') {
            atualizarStatusTela(
                modoVideo(chamada)
                    ? 'Ligação de vídeo recebida'
                    : 'Ligação de voz recebida'
            );
        } else if (modo === 'ligando') {
            atualizarStatusTela('Ligando...');
        } else if (modo === 'ativa') {
            iniciarTimerDuracao();
        }

        await mostrarPedidoVideo(chamada);
    }

    async function obterMicrofone() {
        if (
            streamLocal?.getAudioTracks?.().some(
                track => track.readyState === 'live'
            )
        ) {
            return streamLocal;
        }

        const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        if (!streamLocal) streamLocal = new MediaStream();

        audioStream.getAudioTracks().forEach(track => {
            streamLocal.addTrack(track);
        });

        return streamLocal;
    }

    function fecharPeer() {
        if (peer) {
            try {
                peer.onicecandidate = null;
                peer.ontrack = null;
                peer.onconnectionstatechange = null;
                peer.close();
            } catch (e) {}
        }

        peer = null;
        videoSender = null;

        if (streamLocal) {
            streamLocal.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
        }

        streamLocal = null;
        cameraLigada = false;

        for (const remoto of [
            streamRemoto,
            streamRemotoAudio,
            streamRemotoVideo
        ]) {
            remoto?.getTracks?.().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
        }

        streamRemoto = null;
        streamRemotoAudio = null;
        streamRemotoVideo = null;
        videoRemotoRecebendo = false;

        const audio = document.getElementById('chamada-audio-remoto');
        if (audio) audio.srcObject = null;

        const videoLocal = document.getElementById('chamada-video-local');
        const videoRemoto = document.getElementById('chamada-video-remoto');
        if (videoLocal) videoLocal.srcObject = null;
        if (videoRemoto) videoRemoto.srcObject = null;

        if (timerDowngradeVideo) {
            clearTimeout(timerDowngradeVideo);
            timerDowngradeVideo = null;
        }

        esconderPedidoVideo();

        candidatosPendentesRemotos = [];
        candidatosPendentesLocais = [];
        ultimaNegociacaoIniciada = 0;
        ultimaNegociacaoRespondida = 0;
        ultimaAnswerAplicada = 0;
        renegociacaoEmCurso = false;
        mutado = false;
    }

    async function limparCanalIce() {
        const supabase = supabaseAtual();

        if (canalIce && supabase) {
            try { await supabase.removeChannel(canalIce); } catch (e) {}
        }

        canalIce = null;
    }

    async function limparChamadaLocal() {
        pararTimers();
        await limparCanalIce();
        fecharPeer();
        await liberarWakeLock();
        chamadaAtual = null;
        esconderTelaChamada();
    }

    async function inserirCandidateLocal(candidate) {
        const supabase = supabaseAtual();

        if (!supabase || !chamadaAtual?.id || !candidate) return;

        await supabase
            .from('chamada_ice_candidates')
            .insert([{
                chamada_id: chamadaAtual.id,
                remetente_email: meuEmail(),
                candidate: candidate.toJSON ? candidate.toJSON() : candidate
            }]);
    }

    async function flushCandidatesLocais() {
        if (!chamadaAtual?.id || !candidatosPendentesLocais.length) return;

        const lista = candidatosPendentesLocais.slice();
        candidatosPendentesLocais = [];

        for (const candidate of lista) {
            await inserirCandidateLocal(candidate);
        }
    }

    async function adicionarCandidateRemoto(candidateJson) {
        if (!candidateJson || !peer) return;

        if (!peer.remoteDescription) {
            candidatosPendentesRemotos.push(candidateJson);
            return;
        }

        try {
            await peer.addIceCandidate(new RTCIceCandidate(candidateJson));
        } catch (erro) {
            console.warn('[Ligação] ICE remoto rejeitado:', erro);
        }
    }

    async function flushCandidatesRemotos() {
        if (!peer?.remoteDescription || !candidatosPendentesRemotos.length) return;

        const lista = candidatosPendentesRemotos.slice();
        candidatosPendentesRemotos = [];

        for (const candidate of lista) {
            await adicionarCandidateRemoto(candidate);
        }
    }

    async function assinarIce(chamadaId) {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaId) return;

        await limparCanalIce();

        canalIce = supabase
            .channel('call-ice-' + chamadaId + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chamada_ice_candidates',
                    filter: 'chamada_id=eq.' + chamadaId
                },
                payload => {
                    const linha = payload.new;
                    if (!linha) return;

                    if (normalizarEmail(linha.remetente_email) === meuEmail()) {
                        return;
                    }

                    adicionarCandidateRemoto(linha.candidate);
                }
            )
            .subscribe();

        const { data } = await supabase
            .from('chamada_ice_candidates')
            .select('remetente_email, candidate')
            .eq('chamada_id', chamadaId)
            .order('id', { ascending: true });

        for (const linha of (data || [])) {
            if (normalizarEmail(linha.remetente_email) !== meuEmail()) {
                await adicionarCandidateRemoto(linha.candidate);
            }
        }
    }

    function transceiverPorKind(kind) {
        if (!peer) return null;

        return peer.getTransceivers().find(transceiver => {
            return (
                transceiver?.sender?.track?.kind === kind ||
                transceiver?.receiver?.track?.kind === kind
            );
        }) || null;
    }

    async function sincronizarTracksNoPeer() {
        if (!peer) return;

        const audioTrack = streamLocal?.getAudioTracks?.()[0] || null;
        let audioTransceiver = transceiverPorKind('audio');

        if (audioTrack) {
            if (!audioTransceiver) {
                audioTransceiver = peer.addTransceiver(audioTrack, {
                    direction: 'sendrecv',
                    streams: [streamLocal]
                });
            } else {
                await audioTransceiver.sender.replaceTrack(audioTrack);
                audioTransceiver.direction = 'sendrecv';
            }
        }

        const videoTrack =
            cameraLigada
                ? (streamLocal?.getVideoTracks?.()[0] || null)
                : null;

        let videoTransceiver = transceiverPorKind('video');

        if (!videoTransceiver) {
            videoTransceiver = videoTrack
                ? peer.addTransceiver(videoTrack, {
                    direction: 'sendrecv',
                    streams: [streamLocal]
                })
                : peer.addTransceiver('video', {
                    direction: 'recvonly'
                });
        } else if (videoTrack) {
            await videoTransceiver.sender.replaceTrack(videoTrack);
            videoTransceiver.direction = 'sendrecv';
        } else {
            try {
                await videoTransceiver.sender.replaceTrack(null);
            } catch (e) {}

            if (videoTransceiver.direction !== 'inactive') {
                videoTransceiver.direction = 'recvonly';
            }
        }

        videoSender = videoTransceiver.sender;
    }

    async function iniciarRenegociacaoVideoPrivado() {
        if (
            renegociacaoEmCurso ||
            !peer ||
            !chamadaAtual?.id ||
            chamadaAtual.status !== 'active' ||
            chamadaAtual.modo !== 'video' ||
            !euSouChamador(chamadaAtual) ||
            !cameraLigada
        ) {
            return;
        }

        if (peer.signalingState !== 'stable') return;

        renegociacaoEmCurso = true;

        try {
            await sincronizarTracksNoPeer();

            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            const versao =
                Math.max(
                    Number(chamadaAtual.negociacao_versao || 0),
                    ultimaNegociacaoIniciada,
                    ultimaAnswerAplicada
                ) + 1;

            const atualizada = await atualizarChamada(chamadaAtual.id, {
                offer: peer.localDescription.toJSON(),
                answer: null,
                negociacao_versao: versao,
                negociacao_por: meuEmail(),
                answer_versao: null
            });

            if (atualizada) {
                chamadaAtual = atualizada;
                ultimaNegociacaoIniciada = versao;

                registrarDiagnostico('video_renegotiation_offer', {
                    versao,
                    signalingState: peer.signalingState
                });
            }
        } catch (erro) {
            console.warn('[Ligação] Falha ao renegociar vídeo:', erro);

            registrarDiagnostico('video_renegotiation_error', {
                etapa: 'offer',
                name: erro?.name || '',
                message: erro?.message || ''
            });
        } finally {
            renegociacaoEmCurso = false;
        }
    }

    async function processarRenegociacaoPrivada(chamada) {
        if (!peer || !chamada?.id || chamada.status !== 'active') return;

        const versao = Number(chamada.negociacao_versao || 0);
        if (versao <= 0) return;

        const negociador = normalizarEmail(chamada.negociacao_por);

        // Outro lado enviou uma nova offer.
        if (
            negociador &&
            negociador !== meuEmail() &&
            chamada.offer &&
            versao > ultimaNegociacaoRespondida
        ) {
            try {
                if (peer.signalingState === 'have-local-offer') {
                    try {
                        await peer.setLocalDescription({ type: 'rollback' });
                    } catch (e) {}
                }

                await peer.setRemoteDescription(
                    new RTCSessionDescription(chamada.offer)
                );

                await sincronizarTracksNoPeer();
                await flushCandidatesRemotos();

                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);

                ultimaNegociacaoRespondida = versao;

                const atualizada = await atualizarChamada(chamada.id, {
                    answer: peer.localDescription.toJSON(),
                    answer_versao: versao
                });

                if (atualizada) chamadaAtual = atualizada;

                registrarDiagnostico('video_renegotiation_answer', {
                    versao,
                    signalingState: peer.signalingState
                });
            } catch (erro) {
                console.warn('[Ligação] Falha respondendo renegociação:', erro);

                registrarDiagnostico('video_renegotiation_error', {
                    etapa: 'answer',
                    versao,
                    name: erro?.name || '',
                    message: erro?.message || ''
                });
            }

            return;
        }

        // A offer foi nossa e chegou a answer da mesma versão.
        if (
            negociador === meuEmail() &&
            chamada.answer &&
            Number(chamada.answer_versao || -1) === versao &&
            versao > ultimaAnswerAplicada
        ) {
            try {
                if (peer.signalingState === 'have-local-offer') {
                    await peer.setRemoteDescription(
                        new RTCSessionDescription(chamada.answer)
                    );
                }

                ultimaAnswerAplicada = versao;
                await flushCandidatesRemotos();

                registrarDiagnostico('video_renegotiation_complete', {
                    versao,
                    signalingState: peer.signalingState
                });
            } catch (erro) {
                console.warn('[Ligação] Answer da renegociação inválida:', erro);

                registrarDiagnostico('video_renegotiation_error', {
                    etapa: 'apply_answer',
                    versao,
                    name: erro?.name || '',
                    message: erro?.message || ''
                });
            }
        }
    }

    function criarPeer(prepararOfertaLocal = true) {
        // Fecha somente a conexão anterior. O microfone recém-aberto precisa
        // continuar vivo para ser adicionado ao novo RTCPeerConnection.
        //
        // IMPORTANTE: quem atende uma offer não deve pré-criar transceivers
        // antes de setRemoteDescription(). No Safari isso pode criar um
        // segundo m-line de vídeo e fazer a answer voltar recvonly, deixando
        // o chamador em sendonly (ele envia a câmera, mas não recebe a outra).
        if (peer) {
            try {
                peer.onicecandidate = null;
                peer.ontrack = null;
                peer.onconnectionstatechange = null;
                peer.close();
            } catch (e) {}
        }

        peer = new RTCPeerConnection(RTC_CONFIG);
        streamRemoto = new MediaStream();
        streamRemotoAudio = new MediaStream();
        streamRemotoVideo = new MediaStream();
        videoRemotoRecebendo = false;

        const audio = document.getElementById('chamada-audio-remoto');
        if (audio) {
            audio.srcObject = streamRemotoAudio;
            audio.autoplay = true;
            audio.playsInline = true;
            audio.muted = false;
            audio.volume = 1;
        }

        if (prepararOfertaLocal) {
            if (streamLocal) {
                streamLocal.getAudioTracks().forEach(track => {
                    peer.addTrack(track, streamLocal);
                });
            }

            const videoTrack = streamLocal?.getVideoTracks?.()[0] || null;
            const videoTransceiver = videoTrack
                ? peer.addTransceiver(videoTrack, {
                    direction: 'sendrecv',
                    streams: [streamLocal]
                })
                : peer.addTransceiver('video', {
                    direction: 'sendrecv'
                });

            videoSender = videoTransceiver.sender;
        } else {
            // A remote offer criará os transceivers corretos. Depois dela,
            // sincronizarTracksNoPeer() encaixa áudio/vídeo local nesses
            // mesmos m-lines antes de createAnswer().
            videoSender = null;
        }

        const videoLocal = document.getElementById('chamada-video-local');
        const videoRemoto = document.getElementById('chamada-video-remoto');

        if (videoLocal) {
            videoLocal.srcObject = streamLocal;
            videoLocal.autoplay = true;
            videoLocal.playsInline = true;
            videoLocal.muted = true;
            videoLocal.play().catch(() => {});
        }

        if (videoRemoto) {
            videoRemoto.srcObject = streamRemotoVideo;
            videoRemoto.autoplay = true;
            videoRemoto.playsInline = true;
            videoRemoto.muted = true;
        }

        peer.onicecandidate = event => {
            if (!event.candidate) {
                registrarDiagnostico('ice_gathering_complete', {
                    iceGatheringState: peer?.iceGatheringState || ''
                });
                return;
            }

            const candidateText = event.candidate.candidate || '';
            const tipo =
                candidateText.includes(' typ relay ')
                    ? 'relay'
                    : (candidateText.includes(' typ srflx ')
                        ? 'srflx'
                        : (candidateText.includes(' typ host ') ? 'host' : 'outro'));

            registrarDiagnostico('ice_candidate', {
                tipo,
                protocol: event.candidate.protocol || '',
                address: event.candidate.address || '',
                port: event.candidate.port || null
            });

            if (!chamadaAtual?.id) {
                candidatosPendentesLocais.push(event.candidate);
                return;
            }

            inserirCandidateLocal(event.candidate);
        };

        peer.onicecandidateerror = event => {
            console.warn(
                '[Ligação] ICE candidate error:',
                event.errorCode,
                event.errorText,
                event.url
            );

            registrarDiagnostico('ice_candidate_error', {
                errorCode: event.errorCode || null,
                errorText: event.errorText || '',
                url: event.url || '',
                address: event.address || '',
                port: event.port || null
            });
        };

        peer.ontrack = event => {
            const track = event.track;
            if (!track) return;

            if (
                !streamRemoto.getTracks().some(
                    item => item.id === track.id
                )
            ) {
                streamRemoto.addTrack(track);
            }

            registrarDiagnostico('remote_track', {
                tracks: [{
                    kind: track.kind || '',
                    enabled: track.enabled !== false,
                    muted: track.muted === true,
                    readyState: track.readyState || ''
                }]
            });

            if (track.kind === 'audio') {
                if (
                    !streamRemotoAudio.getTracks().some(
                        item => item.id === track.id
                    )
                ) {
                    streamRemotoAudio.addTrack(track);
                }

                if (audio) {
                    audio.srcObject = streamRemotoAudio;
                    tentarTocarAudioRemoto();
                }

                return;
            }

            if (track.kind === 'video') {
                if (
                    !streamRemotoVideo.getTracks().some(
                        item => item.id === track.id
                    )
                ) {
                    streamRemotoVideo.addTrack(track);
                }

                const videoRemoto =
                    document.getElementById('chamada-video-remoto');

                const mostrarVideoRemoto = () => {
                    if (!peer || track.readyState !== 'live') return;

                    videoRemotoRecebendo = true;

                    if (videoRemoto) {
                        videoRemoto.srcObject = streamRemotoVideo;
                        videoRemoto.playsInline = true;
                        videoRemoto.autoplay = true;
                        videoRemoto.muted = true;
                        videoRemoto.play().catch(() => {});
                    }

                    registrarDiagnostico('remote_video_unmuted', {
                        trackId: track.id,
                        readyState: track.readyState
                    });

                    atualizarTipoTela();
                };

                track.onunmute = mostrarVideoRemoto;

                // Há navegadores que criam o receiver ainda muted e não
                // disparam onunmute de forma confiável. Rechecamos por alguns
                // segundos sem depender exclusivamente desse evento.
                [120, 350, 800, 1600, 3000].forEach(delay => {
                    setTimeout(() => {
                        if (
                            peer &&
                            track.readyState === 'live' &&
                            !track.muted
                        ) {
                            mostrarVideoRemoto();
                        }
                    }, delay);
                });

                track.onended = () => {
                    videoRemotoRecebendo = false;
                    atualizarTipoTela();
                };

                track.onmute = () => {
                    setTimeout(() => {
                        if (
                            track.muted &&
                            track.readyState === 'live'
                        ) {
                            videoRemotoRecebendo = false;
                            atualizarTipoTela();
                        }
                    }, 500);
                };

                if (!track.muted) {
                    mostrarVideoRemoto();
                } else {
                    registrarDiagnostico('remote_video_track_muted', {
                        trackId: track.id,
                        readyState: track.readyState
                    });
                }
            }
        };

        peer.onconnectionstatechange = () => {
            if (!peer || !chamadaAtual) return;

            console.log(
                '[Ligação] connectionState:',
                peer.connectionState,
                'iceConnectionState:',
                peer.iceConnectionState
            );

            registrarDiagnostico('connection_state', {
                connectionState: peer.connectionState,
                iceConnectionState: peer.iceConnectionState,
                signalingState: peer.signalingState
            });

            if (peer.connectionState === 'connected') {
                atualizarStatusTela('Conectado');
                setTimeout(() => {
                    if (chamadaAtual?.status === 'active') iniciarTimerDuracao();
                }, 350);
            }

            if (peer.connectionState === 'connecting') {
                atualizarStatusTela('Conectando...');
            }

            if (peer.connectionState === 'failed') {
                atualizarStatusTela('Falha ao conectar');
                window.finalizarLigacaoVoz('failed');
            }
        };

        peer.oniceconnectionstatechange = () => {
            if (!peer) return;

            console.log('[Ligação] ICE:', peer.iceConnectionState);

            registrarDiagnostico('ice_state', {
                iceConnectionState: peer.iceConnectionState,
                iceGatheringState: peer.iceGatheringState
            });

            if (
                peer.iceConnectionState === 'checking' &&
                chamadaAtual?.status === 'active'
            ) {
                atualizarStatusTela('Conectando áudio...');
            }
        };

        return peer;
    }

    async function atualizarChamada(id, campos) {
        const supabase = supabaseAtual();
        if (!supabase || !id) return null;

        const { data, error } = await supabase
            .from('chamadas')
            .update(campos)
            .eq('id', id)
            .select('*')
            .single();

        if (error) {
            console.error('[Ligação] Falha ao atualizar chamada:', error);
            return null;
        }

        return data;
    }

    window.iniciarLigacaoContato = function () {
        try {
            if (typeof window.fecharPainelDadosContato === 'function') {
                window.fecharPainelDadosContato();
            }
        } catch (e) {}

        return window.iniciarLigacaoVoz();
    };

    async function iniciarLigacaoPrivada(comVideo = false) {
        const supabase = supabaseAtual();
        const meu = meuEmail();

        if (!supabase || !meu) return;

        if (window.grupoAtualId) {
            if (comVideo && typeof window.iniciarVideoGrupo === 'function') {
                return window.iniciarVideoGrupo();
            }

            if (!comVideo && typeof window.iniciarLigacaoGrupo === 'function') {
                return window.iniciarLigacaoGrupo();
            }

            alert('O sistema de ligação do grupo ainda não carregou.');
            return;
        }

        const contato = normalizarEmail(
            typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : ''
        );

        if (!contato) return;

        if (chamadaAtual && !ehFinal(chamadaAtual.status)) {
            if (
                comVideo &&
                chamadaAtual.status === 'active' &&
                !modoVideo(chamadaAtual)
            ) {
                await solicitarVideoNaLigacao();
                return;
            }

            definirModoTela(
                chamadaAtual.status === 'ringing' && !euSouChamador(chamadaAtual)
                    ? 'recebendo'
                    : (chamadaAtual.status === 'active' ? 'ativa' : 'ligando')
            );
            atualizarTipoTela(chamadaAtual);
            return;
        }

        try {
            await obterMicrofone();

            if (comVideo) {
                try {
                    await obterCameraLigacao(false);
                } catch (erroCamera) {
                    console.warn('[Ligação] Vídeo indisponível; iniciando por voz:', erroCamera);
                    comVideo = false;
                }
            }

            criarPeer(true);

            // O peer já nasce com transceiver de vídeo sendrecv. Não usamos
            // offerToReceive* legado aqui: em alguns Safari/Chromium ele fazia
            // a m-line de vídeo voltar numa direção inconsistente para o chamador.
            await sincronizarTracksNoPeer();
            const offer = await peer.createOffer();

            await peer.setLocalDescription(offer);

            const { data: chamada, error } = await supabase
                .from('chamadas')
                .insert([{
                    tipo: comVideo ? 'video' : 'voz',
                    modo: comVideo ? 'video' : 'voz',
                    status: 'ringing',
                    chamador_email: meu,
                    receptor_email: contato,
                    chamador_camera_ativa: comVideo && cameraLigada,
                    receptor_camera_ativa: false,
                    offer: peer.localDescription.toJSON()
                }])
                .select('*')
                .single();

            if (error || !chamada) {
                throw error || new Error('Chamada não criada');
            }

            chamadaAtual = chamada;
            await flushDiagnosticosPendentes();
            await assinarIce(chamada.id);
            await flushCandidatesLocais();
            await abrirTelaParaChamada(chamada, 'ligando');
            await manterTelaAcordada();

            timerSemResposta = setTimeout(async () => {
                if (
                    chamadaAtual?.id === chamada.id &&
                    chamadaAtual.status === 'ringing'
                ) {
                    await atualizarChamada(chamada.id, {
                        status: 'missed',
                        ended_by: meu
                    });
                }
            }, 55000);
        } catch (erro) {
            console.error('[Ligação] Não foi possível iniciar:', erro);
            fecharPeer();
            esconderTelaChamada();

            if (erro?.name === 'NotAllowedError') {
                alert('Libera o microfone pro WhatisApp e tenta de novo.');
            } else {
                alert('Não foi possível iniciar a ligação.');
            }
        }
    }

    window.iniciarLigacaoVoz = function () {
        return iniciarLigacaoPrivada(false);
    };

    window.iniciarLigacaoVideo = function () {
        return iniciarLigacaoPrivada(true);
    };

    window.iniciarVideoContato = function () {
        try {
            if (typeof window.fecharPainelDadosContato === 'function') {
                window.fecharPainelDadosContato();
            }
        } catch (e) {}

        return iniciarLigacaoPrivada(true);
    };

    window.atenderLigacaoVoz = async function () {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return;
        if (chamadaAtual.status !== 'ringing') return;

        try {
            const { data: fresca, error } = await supabase
                .from('chamadas')
                .select('*')
                .eq('id', chamadaAtual.id)
                .single();

            if (error || !fresca || fresca.status !== 'ringing') {
                await limparChamadaLocal();
                return;
            }

            chamadaAtual = fresca;
            await flushDiagnosticosPendentes();

            await obterMicrofone();

            if (modoVideo(chamadaAtual)) {
                try {
                    await obterCameraLigacao(false);
                } catch (erroCamera) {
                    console.warn('[Ligação] Entrou na chamada de vídeo sem câmera:', erroCamera);
                }
            }

            criarPeer(false);
            await assinarIce(chamadaAtual.id);

            await peer.setRemoteDescription(
                new RTCSessionDescription(chamadaAtual.offer)
            );

            // Especialmente no desktop, o transceiver de vídeo criado antes da
            // remoteDescription podia responder como recvonly. Reencaixamos a
            // câmera no m-line recebido antes de gerar a answer.
            await sincronizarTracksNoPeer();
            await flushCandidatesRemotos();

            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);

            const videoTransceiverResposta = transceiverPorKind('video');
            registrarDiagnostico('answer_criada_receptor', {
                videoDirection: videoTransceiverResposta?.currentDirection || '',
                videoPreferredDirection: videoTransceiverResposta?.direction || '',
                videoSenderTrack: videoTransceiverResposta?.sender?.track?.readyState || '',
                videoReceiverTrack: videoTransceiverResposta?.receiver?.track?.readyState || ''
            });

            const atualizada = await atualizarChamada(chamadaAtual.id, {
                status: 'active',
                answer: peer.localDescription.toJSON(),
                receptor_camera_ativa: modoVideo(chamadaAtual) && cameraLigada,
                answered_at: new Date().toISOString()
            });

            if (!atualizada) {
                throw new Error('Não foi possível atender');
            }

            chamadaAtual = atualizada;
            await flushCandidatesLocais();
            await abrirTelaParaChamada(atualizada, 'ativa');
            await tentarTocarAudioRemoto();
            await manterTelaAcordada();
        } catch (erro) {
            console.error('[Ligação] Erro ao atender:', erro);
            await window.finalizarLigacaoVoz('failed');
        }
    };

    window.recusarLigacaoVoz = async function () {
        if (!chamadaAtual?.id) return;

        const id = chamadaAtual.id;
        const meu = meuEmail();

        await atualizarChamada(id, {
            status: 'rejected',
            ended_by: meu
        });

        await limparChamadaLocal();
    };

    window.finalizarLigacaoVoz = async function (statusForcado) {
        if (!chamadaAtual?.id) {
            await limparChamadaLocal();
            return;
        }

        const chamada = chamadaAtual;
        const meu = meuEmail();

        let status = statusForcado;

        if (!status) {
            if (chamada.status === 'active') status = 'ended';
            else if (chamada.status === 'ringing') {
                status = euSouChamador(chamada) ? 'cancelled' : 'rejected';
            } else {
                status = 'ended';
            }
        }

        if (!ehFinal(status)) status = 'ended';

        await atualizarChamada(chamada.id, {
            status,
            ended_by: meu,
            chamador_camera_ativa: false,
            receptor_camera_ativa: false,
            ended_at: new Date().toISOString()
        });

        await limparChamadaLocal();
    };

    window.alternarMudoLigacao = function () {
        if (!streamLocal) return;

        const tracks = streamLocal.getAudioTracks();
        if (!tracks.length) return;

        mutado = !mutado;
        tracks.forEach(track => {
            track.enabled = !mutado;
        });

        const btn = document.getElementById('chamada-btn-mudo');
        btn?.classList.toggle('ativo', mutado);

        const texto = btn?.querySelector('span');
        if (texto) texto.textContent = mutado ? 'Ativar áudio' : 'Silenciar';
    };

    window.minimizarLigacao = function () {
        esconderTelaChamada();
    };

    window.abrirChamadaPelaMensagem = async function (chamadaId) {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaId) return;

        if (chamadaAtual?.id === chamadaId && !ehFinal(chamadaAtual.status)) {
            const modo =
                chamadaAtual.status === 'ringing' && !euSouChamador(chamadaAtual)
                    ? 'recebendo'
                    : (chamadaAtual.status === 'active' ? 'ativa' : 'ligando');

            definirModoTela(modo);
            return;
        }

        const { data: chamada } = await supabase
            .from('chamadas')
            .select('*')
            .eq('id', chamadaId)
            .maybeSingle();

        if (!chamada) return;

        if (chamada.status === 'ringing' && !euSouChamador(chamada)) {
            await abrirTelaParaChamada(chamada, 'recebendo');
        }
    };

    async function aplicarAnswerSePreciso(chamada) {
        if (
            !peer ||
            !euSouChamador(chamada) ||
            !chamada.answer ||
            peer.currentRemoteDescription
        ) {
            return;
        }

        try {
            await peer.setRemoteDescription(
                new RTCSessionDescription(chamada.answer)
            );

            // Depois da answer, revalida o receiver de vídeo. Em especial no
            // chamador, alguns navegadores entregam a track pelo transceiver
            // antes/de forma diferente do evento ontrack.
            const transceiverVideo = transceiverPorKind('video');
            const trackVideo = transceiverVideo?.receiver?.track || null;
            if (
                trackVideo &&
                trackVideo.readyState === 'live' &&
                !streamRemotoVideo?.getTracks?.().some(t => t.id === trackVideo.id)
            ) {
                streamRemotoVideo.addTrack(trackVideo);
            }

            const videoRemoto = document.getElementById('chamada-video-remoto');
            if (videoRemoto && streamRemotoVideo?.getVideoTracks?.().length) {
                videoRemoto.srcObject = streamRemotoVideo;
                videoRemoto.autoplay = true;
                videoRemoto.playsInline = true;
                videoRemoto.muted = true;
                videoRemoto.play().catch(() => {});
            }

            if (trackVideo && trackVideo.readyState === 'live' && !trackVideo.muted) {
                videoRemotoRecebendo = true;
                atualizarTipoTela();
            }

            registrarDiagnostico('answer_aplicada_chamador', {
                videoDirection: transceiverVideo?.currentDirection || '',
                videoTrackState: trackVideo?.readyState || '',
                videoTrackMuted: trackVideo?.muted === true
            });

            await flushCandidatesRemotos();

            await tentarTocarAudioRemoto();
        } catch (erro) {
            console.warn('[Ligação] Answer remoto inválido:', erro);
        }
    }

    async function processarChamada(chamada, evento) {
        if (!chamada?.id) return;

        const meu = meuEmail();

        const participa =
            normalizarEmail(chamada.chamador_email) === meu ||
            normalizarEmail(chamada.receptor_email) === meu;

        if (!participa) return;

        if (
            evento === 'INSERT' &&
            chamada.status === 'ringing' &&
            normalizarEmail(chamada.receptor_email) === meu
        ) {
            if (chamadaAtual && !ehFinal(chamadaAtual.status) && chamadaAtual.id !== chamada.id) {
                await atualizarChamada(chamada.id, {
                    status: 'rejected',
                    ended_by: meu
                });
                return;
            }

            await abrirTelaParaChamada(chamada, 'recebendo');
            return;
        }

        if (chamadaAtual?.id !== chamada.id) return;

        const modoAnterior = chamadaAtual?.modo || chamadaAtual?.tipo || 'voz';
        const virouVideo =
            chamada.status === 'active' &&
            modoAnterior !== 'video' &&
            chamada.modo === 'video';

        chamadaAtual = chamada;

        atualizarTipoTela(chamada);
        await mostrarPedidoVideo(chamada);

        if (chamada.modo === 'voz' && cameraLigada) {
            await desligarCameraLigacao(true);
        }

        if (
            chamada.status === 'active' &&
            modoAnterior !== 'video' &&
            chamada.modo === 'video' &&
            !minhaCameraAtiva(chamada)
        ) {
            try {
                await obterCameraLigacao(true);
            } catch (erroCamera) {
                console.warn('[Ligação] Não foi possível ativar câmera após consenso:', erroCamera);

                const revertida = await atualizarChamada(chamada.id, {
                    modo: 'voz',
                    video_pedido_status: 'rejected'
                });

                if (revertida) {
                    chamadaAtual = revertida;
                    atualizarTipoTela(revertida);
                }
            }
        }

        if (chamada.status === 'active' && chamada.modo === 'video') {
            agendarVerificacaoDowngradeVideo(2200);

            // Em chamada iniciada só com voz, replaceTrack sozinho não muda
            // uma negociação recvonly para sendrecv. O chamador original faz
            // uma única renegociação SDP e o outro lado responde.
            if (virouVideo && euSouChamador(chamadaAtual)) {
                await iniciarRenegociacaoVideoPrivado();
            }
        }

        if (chamada.status === 'active') {
            await processarRenegociacaoPrivada(chamadaAtual);
            pararTimers();
            await aplicarAnswerSePreciso(chamada);
            await abrirTelaParaChamada(chamada, 'ativa');
            await manterTelaAcordada();
            return;
        }

        if (chamada.status === 'ringing') {
            if (euSouChamador(chamada)) {
                await abrirTelaParaChamada(chamada, 'ligando');
            }
            return;
        }

        if (ehFinal(chamada.status)) {
            await limparChamadaLocal();
        }
    }

    async function assinarChamadas() {
        const supabase = supabaseAtual();
        const email = meuEmail();

        if (!supabase || !email) return false;

        if (canalChamadas) {
            try { await supabase.removeChannel(canalChamadas); } catch (e) {}
        }

        canalChamadas = supabase
            .channel('voice-calls-' + email + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chamadas'
                },
                payload => processarChamada(payload.new, 'INSERT')
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'chamadas'
                },
                payload => processarChamada(payload.new, 'UPDATE')
            )
            .subscribe();

        return true;
    }

    async function recuperarChamadaPendente() {
        const supabase = supabaseAtual();
        const email = meuEmail();

        if (!supabase || !email) return;

        const { data } = await supabase
            .from('chamadas')
            .select('*')
            .or('chamador_email.eq.' + email + ',receptor_email.eq.' + email)
            .in('status', ['ringing', 'active'])
            .order('created_at', { ascending: false })
            .limit(1);

        const chamada = data?.[0];
        if (!chamada) return;

        if (chamada.status === 'ringing' && normalizarEmail(chamada.receptor_email) === email) {
            await abrirTelaParaChamada(chamada, 'recebendo');
            return;
        }

        // Se a página foi recarregada, o RTCPeerConnection antigo morreu.
        // Não fingimos que uma ligação antiga continua viva.
        if (normalizarEmail(chamada.chamador_email) === email || chamada.status === 'active') {
            await atualizarChamada(chamada.id, {
                status: chamada.status === 'active' ? 'failed' : 'cancelled',
                ended_by: email
            });
        }
    }

    async function abrirChamadaDaURL() {
        try {
            const url = new URL(location.href);
            const chamadaId = url.searchParams.get('call');
            if (!chamadaId) return;

            url.searchParams.delete('call');
            history.replaceState({}, '', url.pathname + url.search + url.hash);

            await window.abrirChamadaPelaMensagem(chamadaId);
        } catch (e) {}
    }

    async function inicializar() {
        const email = meuEmail();
        const supabase = supabaseAtual();

        if (!email || !supabase) return false;
        if (inicializadoParaEmail === email) return true;

        inicializadoParaEmail = email;
        atualizarPreviewGlobal();
        await assinarChamadas();
        await recuperarChamadaPendente();
        await abrirChamadaDaURL();

        return true;
    }

    const intervaloInicializacao = setInterval(async () => {
        if (await inicializar()) {
            clearInterval(intervaloInicializacao);
        }
    }, 500);

    window.addEventListener('online', () => {
        if (meuEmail()) assinarChamadas();
    });
})();
