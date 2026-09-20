// ==========================================
// LIGAÇÕES DE VOZ EM GRUPO - WEBRTC MESH
// ==========================================
// Chamadas limitadas aos membros do grupo. Até 15 pessoas podem entrar.
// Recusar só recusa para o próprio usuário; a ligação continua para os demais.
// Quem recusou/saiu pode clicar na mensagem da chamada e entrar depois.

(function () {
    const MAX_PARTICIPANTES = 15;

    const RTC_CONFIG_GRUPO = {
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
    let participanteAtual = null;
    let streamLocal = null;
    let mutado = false;
    let cameraLigada = false;
    let cameraPreparada = false;
    let pedidoVideoAtual = null;
    let timerDowngradeVideo = null;

    const peers = new Map();
    const sinaisProcessados = new Set();

    let canalConvites = null;
    let canalParticipantes = null;
    let canalSinais = null;
    let canalChamada = null;
    let canalVideoPedidos = null;
    let canalVideoRespostas = null;

    let intervaloReconciliar = null;
    let inicializadoParaEmail = null;
    let perfilCache = new Map();

    function supabaseAtual() {
        try {
            if (typeof _supabase !== 'undefined' && _supabase) return _supabase;
        } catch (e) {}
        return window._supabase || null;
    }

    function meuEmail() {
        return (localStorage.getItem('usuarioLogado') || '').trim().toLowerCase();
    }

    function normalizarEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function grupoAtualId() {
        return window.grupoAtualId || null;
    }

    function callAtiva(call) {
        return !!call && call.status === 'active';
    }

    function esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function dataMs(valor) {
        const n = new Date(valor || 0).getTime();
        return Number.isFinite(n) ? n : 0;
    }

    function modoVideoGrupo(call = chamadaAtual) {
        return String(call?.modo || 'voz') === 'video';
    }

    function atualizarTipoTelaGrupo(call = chamadaAtual) {
        const video = modoVideoGrupo(call);
        const tela = document.getElementById('tela-chamada-grupo');
        const tipo = document.querySelector('#tela-chamada-grupo .grupo-chamada-tipo');
        const btn = document.getElementById('grupo-chamada-btn-video');

        if (tela) tela.classList.toggle('grupo-chamada-modo-video', video);
        if (tipo) tipo.textContent = video
            ? 'Ligação de vídeo em grupo'
            : 'Ligação de voz em grupo';
        if (btn) btn.classList.toggle('ativo', video && cameraLigada);
    }

    async function prepararCameraGrupo() {
        if (
            streamLocal?.getVideoTracks?.().some(
                track => track.readyState === 'live'
            )
        ) {
            cameraPreparada = true;
            return streamLocal.getVideoTracks()[0];
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Câmera não disponível neste navegador.');
        }

        const videoStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: 'user',
                width: { ideal: 960 },
                height: { ideal: 540 }
            }
        });

        const track = videoStream.getVideoTracks()[0];
        if (!track) throw new Error('Câmera não retornou vídeo.');

        track.enabled = true;
        try { track.contentHint = 'motion'; } catch (e) {}

        if (!streamLocal) streamLocal = new MediaStream();
        streamLocal.addTrack(track);
        cameraPreparada = true;

        return track;
    }

    async function atualizarCameraParticipante(ativa) {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id || !meuEmail()) return;

        const { data } = await supabase
            .from('chamadas_grupo_participantes')
            .update({ camera_ativa: !!ativa })
            .eq('chamada_id', chamadaAtual.id)
            .eq('usuario_email', meuEmail())
            .select('*')
            .maybeSingle();

        if (data) participanteAtual = data;
    }

    async function ativarCameraGrupo(atualizarBanco = true) {
        const track = await prepararCameraGrupo();

        for (const state of peers.values()) {
            if (state.videoSender) {
                try { await state.videoSender.replaceTrack(track); } catch (e) {}
            }
        }

        cameraLigada = true;
        cameraPreparada = true;

        if (atualizarBanco) await atualizarCameraParticipante(true);

        atualizarTipoTelaGrupo();
        await renderizarParticipantes();

        // Uma conexão criada originalmente só com voz normalmente negociou
        // vídeo como recvonly. Para começar a enviar câmera de verdade,
        // renegociamos os pares já existentes.
        await reconciliarPeers(true);
    }

    async function desligarCameraGrupo(atualizarBanco = true, pararTrack = true) {
        for (const state of peers.values()) {
            if (state.videoSender) {
                try { await state.videoSender.replaceTrack(null); } catch (e) {}
            }

            if (state.videoTransceiver && state.videoTransceiver.direction !== 'inactive') {
                state.videoTransceiver.direction = 'recvonly';
            }
        }

        cameraLigada = false;

        if (pararTrack) {
            const tracks = streamLocal?.getVideoTracks?.() || [];
            for (const track of tracks) {
                try { track.stop(); } catch (e) {}
                try { streamLocal.removeTrack(track); } catch (e) {}
            }
            cameraPreparada = false;
        }

        if (atualizarBanco) await atualizarCameraParticipante(false);

        atualizarTipoTelaGrupo();
        await renderizarParticipantes();

        if (modoVideoGrupo()) agendarDowngradeVideoGrupo();
    }

    async function verificarDowngradeVideoGrupo() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id || !modoVideoGrupo()) return;

        const { data: participantes } = await supabase
            .from('chamadas_grupo_participantes')
            .select('usuario_email, status, camera_ativa')
            .eq('chamada_id', chamadaAtual.id)
            .eq('status', 'joined');

        const alguemComCamera = (participantes || []).some(
            p => p.camera_ativa === true
        );

        if (!alguemComCamera) {
            const { data: call } = await supabase
                .from('chamadas_grupo')
                .update({ modo: 'voz' })
                .eq('id', chamadaAtual.id)
                .eq('status', 'active')
                .select('*')
                .maybeSingle();

            if (call) {
                chamadaAtual = call;
                atualizarTipoTelaGrupo(call);
            }
        }
    }

    function agendarDowngradeVideoGrupo(delay = 1200) {
        if (timerDowngradeVideo) clearTimeout(timerDowngradeVideo);

        timerDowngradeVideo = setTimeout(() => {
            timerDowngradeVideo = null;
            verificarDowngradeVideoGrupo();
        }, delay);
    }

    function esconderPedidoVideoGrupo() {
        document.getElementById('grupo-chamada-pedido-video')?.classList.add('hidden');
        pedidoVideoAtual = null;
    }

    async function mostrarPedidoVideoGrupo(pedido) {
        if (!pedido || pedido.status !== 'pending') {
            esconderPedidoVideoGrupo();
            return;
        }

        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return;

        const { data: minhaResposta } = await supabase
            .from('chamadas_grupo_video_respostas')
            .select('*')
            .eq('pedido_id', pedido.id)
            .eq('usuario_email', meuEmail())
            .maybeSingle();

        if (!minhaResposta) return;

        pedidoVideoAtual = pedido;

        const painel = document.getElementById('grupo-chamada-pedido-video');
        const texto = document.getElementById('grupo-chamada-pedido-video-texto');
        const acoes = document.getElementById('grupo-chamada-pedido-video-acoes');

        if (!painel) return;
        painel.classList.remove('hidden');

        if (minhaResposta.resposta === 'accepted') {
            if (texto) {
                texto.textContent =
                    normalizarEmail(pedido.solicitado_por) === meuEmail()
                        ? 'Esperando todo mundo aceitar o vídeo...'
                        : 'Você aceitou. Esperando os outros participantes...';
            }
            acoes?.classList.add('hidden');
            return;
        }

        if (minhaResposta.resposta !== 'pending') {
            esconderPedidoVideoGrupo();
            return;
        }

        const perfil = await obterPerfil(pedido.solicitado_por);
        if (texto) {
            texto.textContent =
                (perfil?.usuario || 'Alguém') +
                ' quer transformar a ligação em vídeo. Ativar sua câmera?';
        }

        acoes?.classList.remove('hidden');
    }

    async function buscarPedidoVideoPendente() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return null;

        const { data } = await supabase
            .from('chamadas_grupo_video_pedidos')
            .select('*')
            .eq('chamada_id', chamadaAtual.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        return data || null;
    }

    async function solicitarVideoGrupo() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id || chamadaAtual.status !== 'active') return;

        if (modoVideoGrupo()) {
            try {
                await ativarCameraGrupo(true);
            } catch (erro) {
                alert('Não foi possível acessar a câmera.');
            }
            return;
        }

        const pendente = await buscarPedidoVideoPendente();
        if (pendente) {
            await mostrarPedidoVideoGrupo(pendente);
            return;
        }

        try {
            await prepararCameraGrupo();
        } catch (erro) {
            console.warn('[Ligação grupo] Câmera indisponível:', erro);
            alert('Não foi possível acessar a câmera.');
            return;
        }

        const { data: pedido, error } = await supabase
            .from('chamadas_grupo_video_pedidos')
            .insert([{
                chamada_id: chamadaAtual.id,
                solicitado_por: meuEmail()
            }])
            .select('*')
            .single();

        if (error || !pedido) {
            console.warn('[Ligação grupo] Pedido de vídeo falhou:', error);
            await desligarCameraGrupo(false, true);
            return;
        }

        await mostrarPedidoVideoGrupo(pedido);
    }

    window.responderPedidoVideoGrupo = async function (aceitar) {
        const supabase = supabaseAtual();
        const pedido = pedidoVideoAtual;

        if (!supabase || !pedido?.id) {
            esconderPedidoVideoGrupo();
            return;
        }

        if (aceitar) {
            try {
                await prepararCameraGrupo();
            } catch (erro) {
                console.warn('[Ligação grupo] Câmera indisponível:', erro);

                await supabase
                    .from('chamadas_grupo_video_respostas')
                    .update({ resposta: 'rejected' })
                    .eq('pedido_id', pedido.id)
                    .eq('usuario_email', meuEmail());

                await desligarCameraGrupo(false, true);
                esconderPedidoVideoGrupo();
                alert('Não foi possível acessar a câmera. A ligação continua por voz.');
                return;
            }
        }

        const resposta = aceitar ? 'accepted' : 'rejected';

        await supabase
            .from('chamadas_grupo_video_respostas')
            .update({ resposta })
            .eq('pedido_id', pedido.id)
            .eq('usuario_email', meuEmail());

        if (!aceitar) {
            await desligarCameraGrupo(false, true);
            esconderPedidoVideoGrupo();
        } else {
            const atualizado = {
                ...pedido,
                status: 'pending'
            };
            await mostrarPedidoVideoGrupo(atualizado);
        }
    };

    window.alternarCameraLigacaoGrupo = async function () {
        if (!chamadaAtual?.id || chamadaAtual.status !== 'active') return;

        if (!modoVideoGrupo()) {
            await solicitarVideoGrupo();
            return;
        }

        if (cameraLigada) {
            await desligarCameraGrupo(true, true);
            return;
        }

        try {
            await ativarCameraGrupo(true);
        } catch (erro) {
            console.warn('[Ligação grupo] Não foi possível ligar a câmera:', erro);
            alert('Não foi possível acessar a câmera.');
        }
    };

    async function obterPerfil(email) {
        const chave = normalizarEmail(email);
        if (!chave) return null;
        if (perfilCache.has(chave)) return perfilCache.get(chave);

        const supabase = supabaseAtual();
        if (!supabase) return null;

        const { data } = await supabase
            .from('usuarios')
            .select('email, usuario, foto_url, cor')
            .eq('email', email)
            .maybeSingle();

        if (data) perfilCache.set(chave, data);
        return data || null;
    }

    async function obterGrupo(idGrupo) {
        const supabase = supabaseAtual();
        if (!supabase || !idGrupo) return null;

        const { data } = await supabase
            .from('grupos')
            .select('id, nome, foto_url')
            .eq('id', idGrupo)
            .maybeSingle();

        return data || null;
    }

    async function preencherCabecalho(call) {
        const grupo = await obterGrupo(call?.grupo_id);
        const nome = document.getElementById('grupo-chamada-nome');
        const foto = document.getElementById('grupo-chamada-avatar');

        if (nome) nome.textContent = grupo?.nome || 'Grupo';

        if (foto) {
            const temFoto = !!grupo?.foto_url;
            foto.classList.remove('avatar-sem-foto', 'avatar-grupo-sem-foto');
            foto.src = temFoto ? grupo.foto_url : 'svg/group-placeholder.svg?v=b92f3928';
            foto.style.backgroundColor = temFoto ? 'transparent' : '#3a3a3c';

            if (!temFoto) {
                foto.classList.add('avatar-grupo-sem-foto');
            }
        }

        atualizarTipoTelaGrupo(call);
    }

    function abrirTela(modo) {
        const tela = document.getElementById('tela-chamada-grupo');
        if (!tela) return;

        tela.dataset.modo = modo;
        tela.classList.remove('hidden');
        document.body?.classList.add('chamada-grupo-aberta');

        const recebendo = document.getElementById('grupo-chamada-controles-recebendo');
        const dentro = document.getElementById('grupo-chamada-controles-dentro');

        recebendo?.classList.toggle('hidden', modo !== 'recebendo');
        dentro?.classList.toggle('hidden', modo === 'recebendo');
    }

    function esconderTela() {
        document.getElementById('tela-chamada-grupo')?.classList.add('hidden');
        document.body?.classList.remove('chamada-grupo-aberta');
    }

    function atualizarStatus(texto) {
        const el = document.getElementById('grupo-chamada-status');
        if (el) el.textContent = texto || '';
    }

    function limparReconcilia() {
        if (intervaloReconciliar) {
            clearInterval(intervaloReconciliar);
            intervaloReconciliar = null;
        }
    }

    async function obterMicrofone() {
        if (
            streamLocal?.getAudioTracks?.().some(
                track => track.readyState === 'live'
            )
        ) {
            return streamLocal;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microfone não disponível neste navegador.');
        }

        const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            },
            video: false
        });

        if (!streamLocal) streamLocal = new MediaStream();

        audioStream.getAudioTracks().forEach(track => {
            streamLocal.addTrack(track);
        });

        return streamLocal;
    }

    function pararMicrofone() {
        if (streamLocal) {
            streamLocal.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
        }
        streamLocal = null;
        mutado = false;
        cameraLigada = false;
        cameraPreparada = false;
    }

    function removerAudioRemoto(email) {
        const id = 'grupo-call-audio-' + btoa(unescape(encodeURIComponent(email))).replace(/[^a-zA-Z0-9]/g, '');
        document.getElementById(id)?.remove();
    }

    function criarAudioRemoto(email) {
        const container = document.getElementById('grupo-chamada-audios');
        if (!container) return null;

        const id = 'grupo-call-audio-' + btoa(unescape(encodeURIComponent(email))).replace(/[^a-zA-Z0-9]/g, '');
        let audio = document.getElementById(id);

        if (!audio) {
            audio = document.createElement('audio');
            audio.id = id;
            audio.autoplay = true;
            audio.playsInline = true;
            audio.volume = 1;
            audio.dataset.email = email;
            container.appendChild(audio);
        }

        return audio;
    }

    function fecharPeer(email) {
        const chave = normalizarEmail(email);
        const state = peers.get(chave);
        if (!state) return;

        try {
            state.pc.onicecandidate = null;
            state.pc.ontrack = null;
            state.pc.onconnectionstatechange = null;
            state.pc.oniceconnectionstatechange = null;
            state.pc.close();
        } catch (e) {}

        removerAudioRemoto(chave);
        peers.delete(chave);
    }

    function fecharTodosPeers() {
        [...peers.keys()].forEach(fecharPeer);
    }

    async function enviarSinal(paraEmail, tipo, payload) {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id || !paraEmail || !payload) return;

        const { error } = await supabase
            .from('chamadas_grupo_sinais')
            .insert([{
                chamada_id: chamadaAtual.id,
                de_email: meuEmail(),
                para_email: paraEmail,
                tipo,
                payload
            }]);

        if (error) {
            console.warn('[Ligação grupo] Sinal não enviado:', tipo, error.message);
        }
    }

    function criarPeerPara(emailRemoto) {
        const remoto = normalizarEmail(emailRemoto);
        if (!remoto || remoto === meuEmail()) return null;

        const existente = peers.get(remoto);
        if (existente) return existente;

        const pc = new RTCPeerConnection(RTC_CONFIG_GRUPO);
        const audio = criarAudioRemoto(remoto);

        const state = {
            pc,
            audio,
            remoteEmail: remoto,
            pendingIce: [],
            makingOffer: false,
            remoteStream: new MediaStream(),
            remoteAudioStream: new MediaStream(),
            remoteVideoStream: new MediaStream(),
            remoteVideoAtivo: false,
            videoSender: null,
            videoTransceiver: null
        };

        peers.set(remoto, state);

        if (streamLocal) {
            streamLocal.getAudioTracks().forEach(track => {
                try { track.contentHint = 'speech'; } catch (e) {}

                const sender = pc.addTrack(track, streamLocal);

                if (sender?.getParameters) {
                    try {
                        const params = sender.getParameters();
                        params.encodings = params.encodings?.length
                            ? params.encodings
                            : [{}];
                        params.encodings[0].maxBitrate = 32000;
                        sender.setParameters(params).catch(() => {});
                    } catch (e) {}
                }
            });
        }

        const localVideo =
            cameraLigada
                ? (streamLocal?.getVideoTracks?.()[0] || null)
                : null;

        const videoTransceiver = localVideo
            ? pc.addTransceiver(localVideo, {
                direction: 'sendrecv',
                streams: [streamLocal]
            })
            : pc.addTransceiver('video', {
                direction: 'sendrecv'
            });

        state.videoTransceiver = videoTransceiver;
        state.videoSender = videoTransceiver.sender;

        pc.onicecandidate = event => {
            if (!event.candidate || !chamadaAtual?.id) return;
            enviarSinal(
                remoto,
                'ice',
                event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
            );
        };

        pc.ontrack = event => {
            const track = event.track;
            if (!track) return;

            if (
                !state.remoteStream.getTracks().some(
                    item => item.id === track.id
                )
            ) {
                state.remoteStream.addTrack(track);
            }

            if (track.kind === 'audio') {
                if (
                    !state.remoteAudioStream.getTracks().some(
                        item => item.id === track.id
                    )
                ) {
                    state.remoteAudioStream.addTrack(track);
                }

                if (audio) {
                    audio.srcObject = state.remoteAudioStream;
                    audio.play().catch(() => {});
                }

                return;
            }

            if (track.kind === 'video') {
                if (
                    !state.remoteVideoStream.getTracks().some(
                        item => item.id === track.id
                    )
                ) {
                    state.remoteVideoStream.addTrack(track);
                }

                const ativarVideoRemoto = () => {
                    if (track.readyState !== 'live') return;
                    state.remoteVideoAtivo = true;
                    renderizarParticipantes();
                };

                track.onunmute = ativarVideoRemoto;

                track.onended = () => {
                    state.remoteVideoAtivo = false;
                    renderizarParticipantes();
                };

                track.onmute = () => {
                    setTimeout(() => {
                        if (
                            track.muted &&
                            track.readyState === 'live'
                        ) {
                            state.remoteVideoAtivo = false;
                            renderizarParticipantes();
                        }
                    }, 500);
                };

                if (!track.muted) {
                    ativarVideoRemoto();
                }
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(
                '[Ligação grupo]',
                remoto,
                'connectionState=',
                pc.connectionState,
                'ice=',
                pc.iceConnectionState
            );

            if (pc.connectionState === 'failed') {
                fecharPeer(remoto);
                setTimeout(() => reconciliarPeers(), 900);
            }
        };

        return state;
    }

    async function adicionarIce(state, candidate) {
        if (!state || !candidate) return;

        if (!state.pc.remoteDescription) {
            state.pendingIce.push(candidate);
            return;
        }

        try {
            await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (erro) {
            console.warn('[Ligação grupo] ICE remoto rejeitado:', erro);
        }
    }

    async function flushIce(state) {
        if (!state?.pc?.remoteDescription || !state.pendingIce.length) return;

        const lista = state.pendingIce.splice(0);

        for (const candidate of lista) {
            await adicionarIce(state, candidate);
        }
    }

    async function sincronizarVideoNoPeerGrupo(state) {
        if (!state?.pc) return;

        const pc = state.pc;
        const track =
            cameraLigada
                ? (streamLocal?.getVideoTracks?.()[0] || null)
                : null;

        let transceiver =
            state.videoTransceiver ||
            pc.getTransceivers().find(item => {
                return (
                    item?.sender?.track?.kind === 'video' ||
                    item?.receiver?.track?.kind === 'video'
                );
            }) ||
            null;

        if (!transceiver) {
            transceiver = track
                ? pc.addTransceiver(track, {
                    direction: 'sendrecv',
                    streams: [streamLocal]
                })
                : pc.addTransceiver('video', {
                    direction: 'recvonly'
                });
        } else if (track) {
            await transceiver.sender.replaceTrack(track);
            transceiver.direction = 'sendrecv';
        } else {
            try {
                await transceiver.sender.replaceTrack(null);
            } catch (e) {}

            if (transceiver.direction !== 'inactive') {
                transceiver.direction = 'recvonly';
            }
        }

        state.videoTransceiver = transceiver;
        state.videoSender = transceiver.sender;
    }

    async function criarOfertaPara(emailRemoto) {
        const state = criarPeerPara(emailRemoto);
        if (!state) return;

        const pc = state.pc;

        if (pc.signalingState !== 'stable') return;

        try {
            state.makingOffer = true;

            await sincronizarVideoNoPeerGrupo(state);

            const offer = await pc.createOffer({
                offerToReceiveAudio: true
            });

            await pc.setLocalDescription(offer);

            await enviarSinal(
                state.remoteEmail,
                'offer',
                pc.localDescription.toJSON()
            );
        } catch (erro) {
            console.warn('[Ligação grupo] Erro criando offer:', erro);
        } finally {
            state.makingOffer = false;
        }
    }

    async function processarOffer(sinal) {
        const remoto = normalizarEmail(sinal.de_email);
        const state = criarPeerPara(remoto);
        if (!state) return;

        const pc = state.pc;
        const polite = meuEmail().localeCompare(remoto) > 0;
        const colisao = state.makingOffer || pc.signalingState !== 'stable';

        if (colisao && !polite) {
            return;
        }

        try {
            if (colisao && polite) {
                try {
                    await pc.setLocalDescription({ type: 'rollback' });
                } catch (e) {}
            }

            await pc.setRemoteDescription(
                new RTCSessionDescription(sinal.payload)
            );

            // Realtime da sala e sinalização usam canais diferentes. A offer
            // pode chegar alguns ms antes do UPDATE "modo=video". Se a câmera
            // já foi preparada pelo aceite, consulta a sala antes da answer
            // para não responder recvonly por causa dessa corrida.
            if (!cameraLigada && cameraPreparada && chamadaAtual?.id) {
                const supabase = supabaseAtual();
                const { data: salaAtual } = await supabase
                    .from('chamadas_grupo')
                    .select('*')
                    .eq('id', chamadaAtual.id)
                    .maybeSingle();

                if (salaAtual?.status === 'active' && salaAtual?.modo === 'video') {
                    chamadaAtual = salaAtual;
                    cameraLigada = true;
                    await atualizarCameraParticipante(true);
                    atualizarTipoTelaGrupo(salaAtual);
                }
            }

            // Garante que a câmera local vá na answer. Sem isso alguns
            // navegadores respondiam o vídeo como recvonly.
            await sincronizarVideoNoPeerGrupo(state);
            await flushIce(state);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await enviarSinal(
                remoto,
                'answer',
                pc.localDescription.toJSON()
            );
        } catch (erro) {
            console.warn('[Ligação grupo] Erro respondendo offer:', erro);
        }
    }

    async function processarAnswer(sinal) {
        const remoto = normalizarEmail(sinal.de_email);
        const state = peers.get(remoto);
        if (!state) return;

        try {
            if (state.pc.signalingState === 'have-local-offer') {
                await state.pc.setRemoteDescription(
                    new RTCSessionDescription(sinal.payload)
                );
                await flushIce(state);
            }
        } catch (erro) {
            console.warn('[Ligação grupo] Answer inválido:', erro);
        }
    }

    async function processarSinal(sinal) {
        if (!sinal?.id || !chamadaAtual?.id) return;
        if (String(sinal.chamada_id) !== String(chamadaAtual.id)) return;
        if (normalizarEmail(sinal.para_email) !== meuEmail()) return;

        const chave = String(sinal.id);
        if (sinaisProcessados.has(chave)) return;
        sinaisProcessados.add(chave);

        if (sinaisProcessados.size > 1000) {
            const ultimos = [...sinaisProcessados].slice(-600);
            sinaisProcessados.clear();
            ultimos.forEach(id => sinaisProcessados.add(id));
        }

        if (sinal.tipo === 'offer') {
            await processarOffer(sinal);
        } else if (sinal.tipo === 'answer') {
            await processarAnswer(sinal);
        } else if (sinal.tipo === 'ice') {
            const state = criarPeerPara(sinal.de_email);
            await adicionarIce(state, sinal.payload);
        }
    }

    async function limparCanaisDaChamada() {
        const supabase = supabaseAtual();
        if (!supabase) return;

        for (const canal of [
            canalParticipantes,
            canalSinais,
            canalChamada,
            canalVideoPedidos,
            canalVideoRespostas
        ]) {
            if (canal) {
                try { await supabase.removeChannel(canal); } catch (e) {}
            }
        }

        canalParticipantes = null;
        canalSinais = null;
        canalChamada = null;
        canalVideoPedidos = null;
        canalVideoRespostas = null;
    }

    async function participantesDaChamada() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return [];

        const { data } = await supabase
            .from('chamadas_grupo_participantes')
            .select('usuario_email, status, joined_at, left_at, camera_ativa, updated_at')
            .eq('chamada_id', chamadaAtual.id);

        return data || [];
    }

    async function renderizarParticipantes() {
        const lista = document.getElementById('grupo-chamada-participantes');
        const contador = document.getElementById('grupo-chamada-contador');

        if (!lista || !chamadaAtual?.id) return;

        const participantes = await participantesDaChamada();
        const dentro = participantes.filter(p => p.status === 'joined');

        if (contador) {
            contador.textContent =
                dentro.length + '/' + MAX_PARTICIPANTES + ' na ligação';
        }

        if (document.getElementById('tela-chamada-grupo')?.dataset.modo !== 'recebendo') {
            atualizarStatus(
                dentro.length <= 1
                    ? 'Aguardando participantes...'
                    : dentro.length + ' participantes'
            );
        }

        const emails = dentro.map(p => p.usuario_email).filter(Boolean);
        let usuarios = [];

        if (emails.length) {
            const supabase = supabaseAtual();
            const { data } = await supabase
                .from('usuarios')
                .select('email, usuario, foto_url, cor')
                .in('email', emails);
            usuarios = data || [];
        }

        const mapa = new Map(
            usuarios.map(u => [normalizarEmail(u.email), u])
        );

        lista.innerHTML = '';

        for (const p of dentro) {
            const email = normalizarEmail(p.usuario_email);
            const perfil = mapa.get(email);
            const item = document.createElement('div');
            item.className = 'grupo-chamada-participante';

            item.dataset.email = email;
            item.classList.toggle('com-video', p.camera_ativa === true);

            item.innerHTML = `
                <div class="grupo-chamada-participante-midia">
                    <img class="grupo-chamada-participante-avatar" src="svg/user-placeholder.svg" alt="">
                    <video class="grupo-chamada-participante-video hidden" autoplay playsinline></video>
                </div>
                <span class="grupo-chamada-participante-nome"></span>
            `;

            const avatar = item.querySelector('.grupo-chamada-participante-avatar');
            const video = item.querySelector('.grupo-chamada-participante-video');
            const nome = item.querySelector('.grupo-chamada-participante-nome');

            if (typeof window.aplicarAvatarUsuario === 'function') {
                window.aplicarAvatarUsuario(
                    avatar,
                    perfil?.foto_url || '',
                    perfil?.cor || '#3a3a3c'
                );
            } else if (avatar) {
                avatar.src = perfil?.foto_url || 'svg/user-placeholder.svg';
                avatar.style.backgroundColor = perfil?.foto_url
                    ? 'transparent'
                    : (perfil?.cor || '#3a3a3c');
            }

            if (nome) {
                nome.textContent =
                    email === meuEmail()
                        ? ((perfil?.usuario || localStorage.getItem('nomeUsuario') || 'Você') + ' (Você)')
                        : (perfil?.usuario || email);
            }

            const peerState = peers.get(email);

            const videoLocalPronto =
                email === meuEmail() &&
                cameraLigada &&
                streamLocal?.getVideoTracks?.().some(
                    track => track.readyState === 'live'
                );

            const videoRemotoPronto =
                email !== meuEmail() &&
                peerState?.remoteVideoAtivo === true &&
                peerState?.remoteVideoStream?.getVideoTracks?.().some(
                    track => track.readyState === 'live'
                );

            if (
                video &&
                p.camera_ativa === true &&
                (videoLocalPronto || videoRemotoPronto)
            ) {
                if (email === meuEmail()) {
                    video.srcObject = streamLocal;
                    video.muted = true;
                    video.style.transform = 'scaleX(-1)';
                } else {
                    video.srcObject = peerState.remoteVideoStream;
                    video.muted = true;
                    video.style.transform = 'none';
                }

                video.classList.remove('hidden');
                video.play().catch(() => {});
                avatar?.classList.add('hidden');
            } else {
                if (video) {
                    video.classList.add('hidden');
                    video.srcObject = null;
                    video.style.transform = 'none';
                }
                avatar?.classList.remove('hidden');
            }

            lista.appendChild(item);
        }

        atualizarTipoTelaGrupo();
    }

    function euDevoOfertar(meuParticipante, remotoParticipante) {
        const meuJoin = dataMs(meuParticipante?.joined_at);
        const remotoJoin = dataMs(remotoParticipante?.joined_at);

        if (meuJoin > remotoJoin) return true;
        if (meuJoin < remotoJoin) return false;

        return meuEmail().localeCompare(
            normalizarEmail(remotoParticipante?.usuario_email)
        ) > 0;
    }

    async function reconciliarPeers(forcarRenegociacaoVideo = false) {
        if (!callAtiva(chamadaAtual) || !participanteAtual || participanteAtual.status !== 'joined') {
            return;
        }

        const participantes = await participantesDaChamada();
        const juntos = participantes.filter(p => p.status === 'joined');
        const emailsAtivos = new Set(
            juntos.map(p => normalizarEmail(p.usuario_email))
        );

        for (const email of [...peers.keys()]) {
            if (!emailsAtivos.has(email)) {
                fecharPeer(email);
            }
        }

        const meu = juntos.find(
            p => normalizarEmail(p.usuario_email) === meuEmail()
        );

        if (!meu) return;

        participanteAtual = meu;

        for (const remoto of juntos) {
            const email = normalizarEmail(remoto.usuario_email);
            if (!email || email === meuEmail()) continue;

            const existe = peers.has(email);
            const devoOfertar = euDevoOfertar(meu, remoto);

            if (existe) {
                if (forcarRenegociacaoVideo && devoOfertar) {
                    await criarOfertaPara(email);
                    await esperar(90);
                }
                continue;
            }

            if (devoOfertar) {
                await criarOfertaPara(email);
                await esperar(70);
            }
        }
    }

    async function assinarCanaisDaChamada() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return;

        await limparCanaisDaChamada();

        const callId = chamadaAtual.id;

        canalParticipantes = supabase
            .channel('group-call-participants-' + callId + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chamadas_grupo_participantes',
                    filter: 'chamada_id=eq.' + callId
                },
                async payload => {
                    const linha = payload.new || payload.old;
                    if (!linha) return;

                    const email = normalizarEmail(linha.usuario_email);

                    if (email === meuEmail()) {
                        participanteAtual = payload.new || participanteAtual;
                    }

                    if (
                        payload.eventType === 'UPDATE' &&
                        payload.new?.status !== 'joined'
                    ) {
                        fecharPeer(email);
                    }

                    await renderizarParticipantes();
                    await reconciliarPeers();
                    await atualizarBolhaVisivel(callId);

                    if (
                        payload.eventType === 'UPDATE' &&
                        payload.old?.camera_ativa === true &&
                        payload.new?.camera_ativa === false &&
                        modoVideoGrupo()
                    ) {
                        agendarDowngradeVideoGrupo();
                    }
                }
            )
            .subscribe();

        canalSinais = supabase
            .channel('group-call-signals-' + callId + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chamadas_grupo_sinais',
                    filter: 'chamada_id=eq.' + callId
                },
                payload => processarSinal(payload.new)
            )
            .subscribe();

        canalChamada = supabase
            .channel('group-call-room-' + callId + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'chamadas_grupo',
                    filter: 'id=eq.' + callId
                },
                async payload => {
                    if (!payload.new) return;
                    const modoAnterior = chamadaAtual?.modo || 'voz';
                    chamadaAtual = payload.new;

                    atualizarTipoTelaGrupo(payload.new);

                    if (payload.new.status === 'ended') {
                        await limparChamadaLocal(false);
                        return;
                    }

                    if (
                        modoAnterior !== 'video' &&
                        payload.new.modo === 'video'
                    ) {
                        try {
                            await ativarCameraGrupo(true);
                        } catch (erro) {
                            console.warn('[Ligação grupo] Câmera não ativou após consenso:', erro);
                        }

                        agendarDowngradeVideoGrupo(2600);
                    }

                    if (
                        modoAnterior === 'video' &&
                        payload.new.modo === 'voz'
                    ) {
                        await desligarCameraGrupo(true, true);
                    }

                    await renderizarParticipantes();
                    await atualizarBolhaVisivel(callId);
                }
            )
            .subscribe();

        canalVideoPedidos = supabase
            .channel('group-call-video-requests-' + callId + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chamadas_grupo_video_pedidos',
                    filter: 'chamada_id=eq.' + callId
                },
                async payload => {
                    const pedido = payload.new || payload.old;
                    if (!pedido) return;

                    if (pedido.status === 'pending') {
                        await mostrarPedidoVideoGrupo(pedido);
                    } else {
                        if (
                            pedido.status === 'rejected' &&
                            !modoVideoGrupo() &&
                            cameraPreparada
                        ) {
                            await desligarCameraGrupo(false, true);
                        }
                        esconderPedidoVideoGrupo();
                    }
                }
            )
            .subscribe();

        canalVideoRespostas = supabase
            .channel('group-call-video-answers-' + callId + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'chamadas_grupo_video_respostas'
                },
                async payload => {
                    if (!pedidoVideoAtual?.id) return;
                    if (String(payload.new?.pedido_id) !== String(pedidoVideoAtual.id)) return;

                    const pedido = await buscarPedidoVideoPendente();
                    if (pedido) await mostrarPedidoVideoGrupo(pedido);
                }
            )
            .subscribe();

        const pedidoPendente = await buscarPedidoVideoPendente();
        if (pedidoPendente) {
            await mostrarPedidoVideoGrupo(pedidoPendente);
        }

        const desde = participanteAtual?.joined_at;

        let consulta = supabase
            .from('chamadas_grupo_sinais')
            .select('*')
            .eq('chamada_id', callId)
            .eq('para_email', meuEmail())
            .order('id', { ascending: true });

        if (desde) {
            consulta = consulta.gte(
                'created_at',
                new Date(dataMs(desde) - 2500).toISOString()
            );
        }

        const { data: sinais } = await consulta;

        for (const sinal of (sinais || [])) {
            await processarSinal(sinal);
        }
    }

    async function atualizarBolhaVisivel(callId) {
        const balao = document.querySelector(
            '#chat-mensagens .balao-chamada-grupo[data-chamada-id="' +
            String(callId) +
            '"]'
        );

        if (!balao) return;

        await atualizarConteudoBolha(balao, callId);
    }

    async function limparChamadaLocal(atualizarMeuStatus) {
        limparReconcilia();

        if (
            atualizarMeuStatus &&
            chamadaAtual?.id &&
            participanteAtual?.status === 'joined'
        ) {
            const supabase = supabaseAtual();

            await supabase
                .from('chamadas_grupo_participantes')
                .update({ status: 'left', camera_ativa: false })
                .eq('chamada_id', chamadaAtual.id)
                .eq('usuario_email', meuEmail());
        }

        await limparCanaisDaChamada();

        fecharTodosPeers();
        pararMicrofone();

        if (timerDowngradeVideo) {
            clearTimeout(timerDowngradeVideo);
            timerDowngradeVideo = null;
        }

        esconderPedidoVideoGrupo();

        chamadaAtual = null;
        participanteAtual = null;
        sinaisProcessados.clear();

        esconderTela();
    }

    async function entrarNaChamada(callId) {
        const supabase = supabaseAtual();
        if (!supabase || !callId || !meuEmail()) return false;

        const { data: call, error: erroCall } = await supabase
            .from('chamadas_grupo')
            .select('*')
            .eq('id', callId)
            .maybeSingle();

        if (erroCall || !call || call.status !== 'active') {
            alert('Essa ligação já foi encerrada.');
            return false;
        }

        const { data: membro } = await supabase
            .from('grupo_membros')
            .select('usuario_email')
            .eq('grupo_id', call.grupo_id)
            .eq('usuario_email', meuEmail())
            .maybeSingle();

        if (!membro) {
            alert('Só membros do grupo podem entrar nessa ligação.');
            return false;
        }

        try {
            await obterMicrofone();

            if (modoVideoGrupo(call)) {
                try {
                    await prepararCameraGrupo();
                    cameraLigada = true;
                } catch (erroCamera) {
                    console.warn('[Ligação grupo] Entrou no vídeo sem câmera:', erroCamera);
                    cameraLigada = false;
                }
            }
        } catch (erro) {
            console.error('[Ligação grupo] Microfone:', erro);
            alert('Não foi possível acessar o microfone.');
            return false;
        }

        const { data: participante, error: erroParticipante } = await supabase
            .from('chamadas_grupo_participantes')
            .upsert([{
                chamada_id: callId,
                usuario_email: meuEmail(),
                status: 'joined',
                camera_ativa: modoVideoGrupo(call) && cameraLigada,
                joined_at: new Date().toISOString(),
                left_at: null
            }], {
                onConflict: 'chamada_id,usuario_email'
            })
            .select('*')
            .single();

        if (erroParticipante || !participante) {
            pararMicrofone();

            if ((erroParticipante?.message || '').includes('15')) {
                alert('A ligação já chegou ao limite de 15 pessoas.');
            } else {
                console.error('[Ligação grupo] Não entrou:', erroParticipante);
                alert('Não foi possível entrar na ligação.');
            }

            return false;
        }

        chamadaAtual = call;
        participanteAtual = participante;

        await preencherCabecalho(call);
        abrirTela('dentro');
        atualizarTipoTelaGrupo(call);
        atualizarStatus('Conectando...');

        await assinarCanaisDaChamada();
        await renderizarParticipantes();
        await reconciliarPeers();

        limparReconcilia();
        intervaloReconciliar = setInterval(() => {
            reconciliarPeers();
        }, 4500);

        return true;
    }

    async function iniciarLigacaoGrupoBase(comVideo = false) {
        const supabase = supabaseAtual();
        const grupoId = grupoAtualId();
        const email = meuEmail();

        if (!supabase || !grupoId || !email) return;

        const { data: membro } = await supabase
            .from('grupo_membros')
            .select('usuario_email')
            .eq('grupo_id', grupoId)
            .eq('usuario_email', email)
            .maybeSingle();

        if (!membro) {
            alert('Você não faz parte deste grupo.');
            return;
        }

        const { data: existente } = await supabase
            .from('chamadas_grupo')
            .select('*')
            .eq('grupo_id', grupoId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existente) {
            chamadaAtual = existente;

            if (comVideo && existente.modo !== 'video') {
                const { data: meuParticipante } = await supabase
                    .from('chamadas_grupo_participantes')
                    .select('*')
                    .eq('chamada_id', existente.id)
                    .eq('usuario_email', email)
                    .maybeSingle();

                if (meuParticipante?.status === 'joined') {
                    participanteAtual = meuParticipante;
                    await preencherCabecalho(existente);
                    abrirTela('dentro');
                    await assinarCanaisDaChamada();
                    await solicitarVideoGrupo();
                    return;
                }
            }

            await entrarNaChamada(existente.id);
            return;
        }

        try {
            await obterMicrofone();

            if (comVideo) {
                try {
                    await prepararCameraGrupo();
                    cameraLigada = true;
                } catch (erroCamera) {
                    console.warn('[Ligação grupo] Vídeo indisponível; iniciando por voz:', erroCamera);
                    comVideo = false;
                    cameraLigada = false;
                }
            }
        } catch (erro) {
            console.error('[Ligação grupo] Microfone:', erro);
            alert('Não foi possível acessar o microfone.');
            return;
        }

        const { data: nova, error } = await supabase
            .from('chamadas_grupo')
            .insert([{
                grupo_id: grupoId,
                criado_por: email,
                modo: comVideo ? 'video' : 'voz',
                status: 'active'
            }])
            .select('*')
            .single();

        if (error || !nova) {
            pararMicrofone();

            // Duas pessoas podem tocar no botão quase juntas.
            const { data: corrida } = await supabase
                .from('chamadas_grupo')
                .select('*')
                .eq('grupo_id', grupoId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (corrida) {
                await entrarNaChamada(corrida.id);
                return;
            }

            console.error('[Ligação grupo] Erro iniciando:', error);
            alert('Não foi possível iniciar a ligação do grupo.');
            return;
        }

        chamadaAtual = nova;

        // O trigger já cria o criador como joined.
        const { data: participante } = await supabase
            .from('chamadas_grupo_participantes')
            .select('*')
            .eq('chamada_id', nova.id)
            .eq('usuario_email', email)
            .maybeSingle();

        participanteAtual = participante || {
            chamada_id: nova.id,
            usuario_email: email,
            status: 'joined',
            camera_ativa: false,
            joined_at: new Date().toISOString()
        };

        if (comVideo && cameraLigada) {
            const { data: atualizado } = await supabase
                .from('chamadas_grupo_participantes')
                .update({ camera_ativa: true })
                .eq('chamada_id', nova.id)
                .eq('usuario_email', email)
                .select('*')
                .maybeSingle();

            if (atualizado) participanteAtual = atualizado;
        }

        await preencherCabecalho(nova);
        abrirTela('dentro');
        atualizarStatus('Aguardando participantes...');

        await assinarCanaisDaChamada();
        await renderizarParticipantes();

        limparReconcilia();
        intervaloReconciliar = setInterval(() => {
            reconciliarPeers();
        }, 4500);
    }

    window.iniciarLigacaoGrupo = function () {
        return iniciarLigacaoGrupoBase(false);
    };

    window.iniciarVideoGrupo = function () {
        return iniciarLigacaoGrupoBase(true);
    };

    window.atenderLigacaoGrupo = async function () {
        if (!chamadaAtual?.id) return;
        await entrarNaChamada(chamadaAtual.id);
    };

    window.recusarLigacaoGrupo = async function () {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) {
            esconderTela();
            return;
        }

        await supabase
            .from('chamadas_grupo_participantes')
            .update({ status: 'rejected' })
            .eq('chamada_id', chamadaAtual.id)
            .eq('usuario_email', meuEmail());

        chamadaAtual = null;
        participanteAtual = null;
        esconderTela();
    };

    window.sairLigacaoGrupo = async function () {
        await limparChamadaLocal(true);
    };

    window.minimizarLigacaoGrupo = function () {
        esconderTela();
    };

    window.alternarMudoLigacaoGrupo = function () {
        const tracks = streamLocal?.getAudioTracks?.() || [];
        if (!tracks.length) return;

        mutado = !mutado;
        tracks.forEach(track => {
            track.enabled = !mutado;
        });

        const btn = document.getElementById('grupo-chamada-btn-mudo');
        btn?.classList.toggle('ativo', mutado);

        const label = btn?.querySelector('.grupo-chamada-acao-label');
        if (label) label.textContent = mutado ? 'Ativar áudio' : 'Silenciar';
    };

    window.entrarLigacaoGrupoPelaMensagem = async function (callId) {
        const supabase = supabaseAtual();
        if (!supabase || !callId) return;

        const { data: call } = await supabase
            .from('chamadas_grupo')
            .select('*')
            .eq('id', callId)
            .maybeSingle();

        if (!call || call.status !== 'active') {
            return;
        }

        await entrarNaChamada(callId);
    };

    async function mostrarConvite(participante) {
        const supabase = supabaseAtual();
        if (!supabase || !participante?.chamada_id) return;
        if (participante.status !== 'invited') return;

        const { data: call } = await supabase
            .from('chamadas_grupo')
            .select('*')
            .eq('id', participante.chamada_id)
            .maybeSingle();

        if (!callAtiva(call)) return;

        if (
            chamadaAtual &&
            callAtiva(chamadaAtual) &&
            chamadaAtual.id !== call.id
        ) {
            return;
        }

        chamadaAtual = call;
        participanteAtual = participante;

        await preencherCabecalho(call);
        abrirTela('recebendo');
        atualizarTipoTelaGrupo(call);
        atualizarStatus(
            modoVideoGrupo(call)
                ? 'Ligação de vídeo em grupo'
                : 'Ligação de voz em grupo'
        );
        await renderizarParticipantes();
    }

    async function assinarConvites() {
        const supabase = supabaseAtual();
        const email = meuEmail();
        if (!supabase || !email) return;

        if (canalConvites) {
            try { await supabase.removeChannel(canalConvites); } catch (e) {}
        }

        canalConvites = supabase
            .channel('group-call-invites-' + email + '-' + Date.now())
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chamadas_grupo_participantes',
                    filter: 'usuario_email=eq.' + email
                },
                payload => mostrarConvite(payload.new)
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'chamadas_grupo_participantes',
                    filter: 'usuario_email=eq.' + email
                },
                payload => {
                    if (payload.new?.status === 'invited') {
                        mostrarConvite(payload.new);
                    }
                }
            )
            .subscribe();
    }

    async function recuperarConvitePendente() {
        const supabase = supabaseAtual();
        const email = meuEmail();
        if (!supabase || !email || chamadaAtual) return;

        const { data: convites } = await supabase
            .from('chamadas_grupo_participantes')
            .select('*')
            .eq('usuario_email', email)
            .eq('status', 'invited')
            .order('updated_at', { ascending: false })
            .limit(6);

        for (const participante of (convites || [])) {
            const { data: call } = await supabase
                .from('chamadas_grupo')
                .select('*')
                .eq('id', participante.chamada_id)
                .eq('status', 'active')
                .maybeSingle();

            if (call) {
                await mostrarConvite(participante);
                return;
            }
        }
    }

    async function abrirChamadaGrupoDaURL() {
        try {
            const url = new URL(location.href);
            const callId = url.searchParams.get('groupCall');
            if (!callId) return;

            url.searchParams.delete('groupCall');
            url.searchParams.delete('group');
            history.replaceState({}, '', url.pathname + url.search + url.hash);

            const supabase = supabaseAtual();
            const { data: call } = await supabase
                .from('chamadas_grupo')
                .select('*')
                .eq('id', callId)
                .maybeSingle();

            if (callAtiva(call)) {
                const { data: participante } = await supabase
                    .from('chamadas_grupo_participantes')
                    .select('*')
                    .eq('chamada_id', callId)
                    .eq('usuario_email', meuEmail())
                    .maybeSingle();

                if (participante?.status === 'invited') {
                    await mostrarConvite(participante);
                } else {
                    chamadaAtual = call;
                    await preencherCabecalho(call);
                    abrirTela('recebendo');
                    atualizarStatus('Toque em entrar para participar');
                }
            }
        } catch (e) {}
    }

    window.ehMensagemChamadaGrupo = function (msg) {
        return !!msg && (
            msg.tipo === 'chamada_grupo' ||
            msg.texto === '[CHAMADA_GRUPO]'
        );
    };

    async function atualizarConteudoBolha(balao, callId) {
        const supabase = supabaseAtual();
        if (!balao || !supabase || !callId) return;

        const [{ data: call }, { data: participantes }] = await Promise.all([
            supabase
                .from('chamadas_grupo')
                .select('id, status, modo')
                .eq('id', callId)
                .maybeSingle(),
            supabase
                .from('chamadas_grupo_participantes')
                .select('usuario_email, status')
                .eq('chamada_id', callId)
        ]);

        const ativos = (participantes || []).filter(p => p.status === 'joined');
        const meu = (participantes || []).find(
            p => normalizarEmail(p.usuario_email) === meuEmail()
        );

        balao.classList.toggle('chamada-status-verde', call?.status === 'active');
        balao.classList.toggle('chamada-status-neutro', call?.status !== 'active');

        const status = balao.querySelector('.chamada-bolha-status');
        const titulo = balao.querySelector('.chamada-bolha-titulo');

        if (titulo) {
            titulo.textContent =
                call?.modo === 'video'
                    ? 'Ligação de vídeo em grupo'
                    : 'Ligação de voz em grupo';
        }

        if (!status) return;

        if (call?.status !== 'active') {
            status.textContent = 'Encerrada';
        } else if (meu?.status === 'joined') {
            status.textContent =
                (ativos.length || 1) +
                (ativos.length === 1 ? ' participante' : ' participantes') +
                ' · toque para voltar';
        } else if (meu?.status === 'rejected') {
            status.textContent = 'Você recusou · toque para entrar';
        } else {
            status.textContent = 'Toque para entrar';
        }
    }

    window.renderizarBalaoChamadaGrupo = async function (msg, ehMinha, opcoes = {}) {
        const container = document.getElementById('chat-mensagens');
        if (!container || !msg) return;

        if (msg.id !== null && msg.id !== undefined) {
            const existente = container.querySelector(
                '.balao-msg[data-message-id="' + String(msg.id) + '"]'
            );
            if (existente) return;
        }

        const balao = document.createElement('div');
        balao.className =
            'balao-msg balao-chamada balao-chamada-grupo ' +
            (ehMinha ? 'balao-enviada ' : 'balao-recebida ') +
            'chamada-status-verde';

        if (msg.id !== null && msg.id !== undefined) {
            balao.dataset.messageId = String(msg.id);
        }

        if (msg.chamada_id) {
            balao.dataset.chamadaId = String(msg.chamada_id);
        }

        const hora = typeof formatarHora === 'function'
            ? formatarHora(msg.created_at || new Date())
            : '';

        const nomeRemetente = opcoes.nomeRemetente || '';
        const corRemetente = opcoes.corRemetente || '#ff7b00';
        const naoSalvo = opcoes.naoSalvo === true;

        balao.innerHTML = `
            ${!ehMinha && nomeRemetente
                ? '<div class="grupo-msg-cabecalho">' +
                    '<span class="nome-remetente" style="color:' + corRemetente + '">' + nomeRemetente + '</span>' +
                    (naoSalvo ? '<span class="grupo-nao-salvo">Não salvo</span>' : '') +
                  '</div>'
                : ''}
            <div class="chamada-grupo-bolha-layout">
                <div class="chamada-bolha-icone">
                    <span class="chamada-bolha-asset ${(msg?.meta?.modo === 'video' || msg?.meta?.tipo_chamada === 'video_grupo') ? 'video' : 'voz'}" aria-hidden="true"></span>
                </div>

                <div class="chamada-bolha-info">
                    <strong class="chamada-bolha-titulo">${(msg?.meta?.modo === 'video' || msg?.meta?.tipo_chamada === 'video_grupo') ? 'Ligação de vídeo em grupo' : 'Ligação de voz em grupo'}</strong>
                    <span class="chamada-bolha-status">Carregando...</span>
                </div>

                <span class="chamada-bolha-hora">${hora}</span>
            </div>
        `;

        balao.addEventListener('click', () => {
            if (msg.chamada_id) {
                window.entrarLigacaoGrupoPelaMensagem(msg.chamada_id);
            }
        });

        container.appendChild(balao);

        if (msg.chamada_id) {
            await atualizarConteudoBolha(balao, msg.chamada_id);
        }

        container.scrollTop = container.scrollHeight;
    };

    async function inicializar() {
        const supabase = supabaseAtual();
        const email = meuEmail();

        if (!supabase || !email) return false;
        if (inicializadoParaEmail === email) return true;

        inicializadoParaEmail = email;
        await assinarConvites();
        await recuperarConvitePendente();
        await abrirChamadaGrupoDaURL();

        return true;
    }

    const init = setInterval(async () => {
        if (await inicializar()) {
            clearInterval(init);
        }
    }, 500);

    window.addEventListener('online', () => {
        if (meuEmail()) {
            assinarConvites();
        }
    });

;
})();
