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
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:openrelay.metered.ca:80' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turns:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 6
    };

    let chamadaAtual = null;
    let participanteAtual = null;
    let streamLocal = null;
    let mutado = false;

    const peers = new Map();
    const sinaisProcessados = new Set();

    let canalConvites = null;
    let canalParticipantes = null;
    let canalSinais = null;
    let canalChamada = null;

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
            foto.src = temFoto ? grupo.foto_url : 'svg/group-placeholder.svg';
            foto.style.backgroundColor = temFoto ? 'transparent' : '#3a3a3c';
        }
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
        if (streamLocal?.active) return streamLocal;

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microfone não disponível neste navegador.');
        }

        streamLocal = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            },
            video: false
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
            makingOffer: false
        };

        peers.set(remoto, state);

        if (streamLocal) {
            streamLocal.getTracks().forEach(track => {
                try { track.contentHint = 'speech'; } catch (e) {}

                const sender = pc.addTrack(track, streamLocal);

                // Voz em grupo precisa ser econômica: 14 conexões de áudio no
                // limite máximo não podem usar bitrate de chamada 1x1.
                if (track.kind === 'audio' && sender?.getParameters) {
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

        pc.onicecandidate = event => {
            if (!event.candidate || !chamadaAtual?.id) return;
            enviarSinal(
                remoto,
                'ice',
                event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
            );
        };

        pc.ontrack = event => {
            if (!audio) return;

            const remoteStream = event.streams?.[0] || new MediaStream([event.track]);

            if (audio.srcObject !== remoteStream) {
                audio.srcObject = remoteStream;
            }

            audio.play().catch(() => {});
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

    async function criarOfertaPara(emailRemoto) {
        const state = criarPeerPara(emailRemoto);
        if (!state) return;

        const pc = state.pc;

        if (pc.signalingState !== 'stable') return;

        try {
            state.makingOffer = true;

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

        for (const canal of [canalParticipantes, canalSinais, canalChamada]) {
            if (canal) {
                try { await supabase.removeChannel(canal); } catch (e) {}
            }
        }

        canalParticipantes = null;
        canalSinais = null;
        canalChamada = null;
    }

    async function participantesDaChamada() {
        const supabase = supabaseAtual();
        if (!supabase || !chamadaAtual?.id) return [];

        const { data } = await supabase
            .from('chamadas_grupo_participantes')
            .select('usuario_email, status, joined_at, left_at, updated_at')
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

            item.innerHTML = `
                <img class="grupo-chamada-participante-avatar" src="svg/user-placeholder.svg" alt="">
                <span class="grupo-chamada-participante-nome"></span>
            `;

            const avatar = item.querySelector('.grupo-chamada-participante-avatar');
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

            lista.appendChild(item);
        }
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

    async function reconciliarPeers() {
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
            if (peers.has(email)) continue;

            if (euDevoOfertar(meu, remoto)) {
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
                    chamadaAtual = payload.new;

                    if (payload.new.status === 'ended') {
                        await limparChamadaLocal(false);
                    } else {
                        await atualizarBolhaVisivel(callId);
                    }
                }
            )
            .subscribe();

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
                .update({ status: 'left' })
                .eq('chamada_id', chamadaAtual.id)
                .eq('usuario_email', meuEmail());
        }

        await limparCanaisDaChamada();

        fecharTodosPeers();
        pararMicrofone();

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

    window.iniciarLigacaoGrupo = async function () {
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
            await entrarNaChamada(existente.id);
            return;
        }

        try {
            await obterMicrofone();
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
            joined_at: new Date().toISOString()
        };

        await preencherCabecalho(nova);
        abrirTela('dentro');
        atualizarStatus('Aguardando participantes...');

        await assinarCanaisDaChamada();
        await renderizarParticipantes();

        limparReconcilia();
        intervaloReconciliar = setInterval(() => {
            reconciliarPeers();
        }, 4500);
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
        atualizarStatus('Ligação de voz em grupo');
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
                .select('id, status')
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

        balao.innerHTML = `
            ${!ehMinha && nomeRemetente
                ? '<span class="nome-remetente">' + nomeRemetente + '</span>'
                : ''}
            <div class="chamada-grupo-bolha-layout">
                <div class="chamada-bolha-icone">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6.8 3.7 9 7.8 7.1 9.3c1.3 2.8 3 4.5 5.8 5.8l1.5-1.9 4.1 2.2c.6.3.8.9.7 1.5-.5 1.6-1.9 2.7-3.6 2.7C9.3 19.6 4 14.3 4 8c0-1.7 1.1-3.1 2.7-3.6.6-.2 1.2.1 1.5.7Z"></path>
                        <circle cx="17.8" cy="6.2" r="2.1"></circle>
                        <path d="M14.9 10.1c.7-1.2 1.7-1.8 2.9-1.8 1.1 0 2.1.6 2.8 1.8"></path>
                    </svg>
                </div>

                <div class="chamada-bolha-info">
                    <strong class="chamada-bolha-titulo">Ligação de voz em grupo</strong>
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
