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
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' }
        ],
        iceCandidatePoolSize: 4
    };

    let chamadaAtual = null;
    let peer = null;
    let streamLocal = null;
    let streamRemoto = null;
    let canalChamadas = null;
    let canalIce = null;
    let candidatosPendentesRemotos = [];
    let candidatosPendentesLocais = [];
    let timerDuracao = null;
    let timerSemResposta = null;
    let wakeLock = null;
    let inicializadoParaEmail = null;
    let mutado = false;

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
        return !!msg && (msg.tipo === 'chamada' || msg.texto === '[CHAMADA]' || !!msg.chamada_id);
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
                ${svgTelefone(ehMinha)}
            </div>

            <div class="chamada-bolha-info">
                <strong class="chamada-bolha-titulo">Ligação de voz</strong>
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
    };

    function atualizarPreviewGlobal() {
        const anterior = window.formatarPreviewMensagem;

        window.formatarPreviewMensagem = function (msg) {
            if (window.ehMensagemChamada(msg)) return '📞 Ligação de voz';
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

        if (modo === 'recebendo') {
            atualizarStatusTela('Ligação de voz recebida');
        } else if (modo === 'ligando') {
            atualizarStatusTela('Ligando...');
        } else if (modo === 'ativa') {
            iniciarTimerDuracao();
        }
    }

    async function obterMicrofone() {
        if (streamLocal?.active) return streamLocal;

        streamLocal = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
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

        if (streamLocal) {
            streamLocal.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
        }

        streamLocal = null;

        if (streamRemoto) {
            streamRemoto.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
        }

        streamRemoto = null;

        const audio = document.getElementById('chamada-audio-remoto');
        if (audio) audio.srcObject = null;

        candidatosPendentesRemotos = [];
        candidatosPendentesLocais = [];
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

    function criarPeer() {
        // Fecha somente a conexão anterior. O microfone recém-aberto precisa
        // continuar vivo para ser adicionado ao novo RTCPeerConnection.
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

        const audio = document.getElementById('chamada-audio-remoto');
        if (audio) {
            audio.srcObject = streamRemoto;
            audio.autoplay = true;
            audio.playsInline = true;
        }

        if (streamLocal) {
            streamLocal.getTracks().forEach(track => {
                peer.addTrack(track, streamLocal);
            });
        }

        peer.onicecandidate = event => {
            if (!event.candidate) return;

            if (!chamadaAtual?.id) {
                candidatosPendentesLocais.push(event.candidate);
                return;
            }

            inserirCandidateLocal(event.candidate);
        };

        peer.ontrack = event => {
            const tracks = event.streams?.[0]?.getTracks?.() || [event.track];

            for (const track of tracks) {
                if (
                    track &&
                    !streamRemoto.getTracks().some(item => item.id === track.id)
                ) {
                    streamRemoto.addTrack(track);
                }
            }

            if (audio) {
                audio.play().catch(() => {});
            }
        };

        peer.onconnectionstatechange = () => {
            if (!peer || !chamadaAtual) return;

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
                window.finalizarLigacaoVoz('failed');
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

    window.iniciarLigacaoVoz = async function () {
        const supabase = supabaseAtual();
        const meu = meuEmail();

        if (!supabase || !meu) return;

        if (window.grupoAtualId) {
            alert('Ligação de grupo fica pra próxima etapa.');
            return;
        }

        const contato = normalizarEmail(
            typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : ''
        );

        if (!contato) return;

        if (chamadaAtual && !ehFinal(chamadaAtual.status)) {
            definirModoTela(
                chamadaAtual.status === 'ringing' && !euSouChamador(chamadaAtual)
                    ? 'recebendo'
                    : (chamadaAtual.status === 'active' ? 'ativa' : 'ligando')
            );
            return;
        }

        try {
            await obterMicrofone();
            criarPeer();

            const offer = await peer.createOffer({
                offerToReceiveAudio: true
            });

            await peer.setLocalDescription(offer);

            const { data: chamada, error } = await supabase
                .from('chamadas')
                .insert([{
                    tipo: 'voz',
                    status: 'ringing',
                    chamador_email: meu,
                    receptor_email: contato,
                    offer: peer.localDescription.toJSON()
                }])
                .select('*')
                .single();

            if (error || !chamada) {
                throw error || new Error('Chamada não criada');
            }

            chamadaAtual = chamada;
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

            await obterMicrofone();
            criarPeer();
            await assinarIce(chamadaAtual.id);

            await peer.setRemoteDescription(
                new RTCSessionDescription(chamadaAtual.offer)
            );

            await flushCandidatesRemotos();

            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);

            const atualizada = await atualizarChamada(chamadaAtual.id, {
                status: 'active',
                answer: peer.localDescription.toJSON(),
                answered_at: new Date().toISOString()
            });

            if (!atualizada) {
                throw new Error('Não foi possível atender');
            }

            chamadaAtual = atualizada;
            await flushCandidatesLocais();
            await abrirTelaParaChamada(atualizada, 'ativa');
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

            await flushCandidatesRemotos();

            const audio = document.getElementById('chamada-audio-remoto');
            audio?.play?.().catch(() => {});
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

        chamadaAtual = chamada;

        if (chamada.status === 'active') {
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
