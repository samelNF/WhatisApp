// ==========================================
// SISTEMA DE ÁUDIO / VOICE NOTES
// ==========================================
// Grava, envia e reproduz áudios com waveform e progresso persistente.

(function () {
    const QTD_ONDAS = 46;
    const MAX_GRAVACAO_MS = 10 * 60 * 1000;

    let mediaRecorder = null;
    let streamGravacao = null;
    let chunksGravacao = [];
    let inicioGravacao = 0;
    let timerGravacao = null;
    let timerWaveform = null;
    let contextoAudioGravacao = null;
    let analyserGravacao = null;
    let amostrasGravacao = [];
    let gravando = false;
    let audioAtivo = null;

    function formatarTempo(segundos) {
        const total = Math.max(0, Math.floor(Number(segundos) || 0));
        const min = Math.floor(total / 60);
        const seg = total % 60;
        return min + ':' + String(seg).padStart(2, '0');
    }

    window.formatarDuracaoAudio = formatarTempo;

    function ehMensagemAudio(msg) {
        if (!msg) return false;
        if (
            msg.apagada_em ||
            String(msg.texto || '').trim() === '[MENSAGEM_APAGADA]'
        ) return false;
        if (msg.tipo === 'audio') return true;
        if (msg.audio_url) return true;
        return typeof msg.texto === 'string' && msg.texto.startsWith('[AUDIO]:');
    }

    window.ehMensagemAudio = ehMensagemAudio;

    window.formatarPreviewMensagem = function (msg) {
        if (!msg) return '';

        if (
            msg.apagada_em ||
            String(msg.texto || '').trim() === '[MENSAGEM_APAGADA]'
        ) {
            return 'Mensagem apagada';
        }

        if (
            msg.tipo === 'chamada_grupo' ||
            msg.texto === '[CHAMADA_GRUPO]'
        ) {
            return (
                msg?.meta?.modo === 'video' ||
                msg?.meta?.tipo_chamada === 'video_grupo'
            )
                ? '🎥 Ligação de vídeo em grupo'
                : '📞 Ligação de voz em grupo';
        }
        if (
            msg.tipo === 'chamada' ||
            msg.texto === '[CHAMADA]'
        ) {
            return (
                msg?.meta?.modo === 'video' ||
                msg?.meta?.tipo_chamada === 'video'
            )
                ? '🎥 Ligação de vídeo'
                : '📞 Ligação de voz';
        }
        if (ehMensagemAudio(msg)) return '🎤 Áudio';

        const texto = String(msg.texto || '');
        if (texto.startsWith('[FOTO]:') || texto.startsWith('[IMAGEM]:')) return '📷 Foto';
        if (texto.startsWith('[VIDEO]:')) return '🎥 Vídeo';
        return texto;
    };

    function urlAudioMensagem(msg) {
        if (msg?.audio_url) return msg.audio_url;
        if (typeof msg?.texto === 'string' && msg.texto.startsWith('[AUDIO]:')) {
            return msg.texto.replace('[AUDIO]:', '').trim();
        }
        return '';
    }

    function mimePreferido() {
        if (!window.MediaRecorder) return '';

        const candidatos = [
            'audio/mp4',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus'
        ];

        return candidatos.find(tipo => {
            try {
                return MediaRecorder.isTypeSupported(tipo);
            } catch (e) {
                return false;
            }
        }) || '';
    }

    function extensaoPorMime(mime) {
        const tipo = String(mime || '').toLowerCase();
        if (tipo.includes('mp4')) return 'm4a';
        if (tipo.includes('ogg')) return 'ogg';
        if (tipo.includes('webm')) return 'webm';
        return 'webm';
    }

    function normalizarOndas(amostras, quantidade = QTD_ONDAS) {
        const fonte = Array.isArray(amostras) && amostras.length
            ? amostras
            : [0.18];

        const saida = [];

        for (let i = 0; i < quantidade; i++) {
            const inicio = Math.floor((i / quantidade) * fonte.length);
            let fim = Math.floor(((i + 1) / quantidade) * fonte.length);
            if (fim <= inicio) fim = inicio + 1;

            const pedaco = fonte.slice(inicio, fim);
            const media = pedaco.length
                ? pedaco.reduce((soma, valor) => soma + Number(valor || 0), 0) / pedaco.length
                : 0.18;

            saida.push(Math.max(0.10, Math.min(1, media)));
        }

        return saida;
    }

    function elementosGravacao() {
        return {
            barra: document.getElementById('audio-recording-bar'),
            tempo: document.getElementById('audio-recording-time'),
            ondas: document.getElementById('audio-recording-wave'),
            inputBox: document.getElementById('chat-input-box'),
            footer: document.querySelector('#tela-chat .chat-footer'),
            enviar: document.getElementById('audio-recording-send')
        };
    }

    function renderizarOndasGravacao() {
        const { ondas } = elementosGravacao();
        if (!ondas) return;

        const ultimas = amostrasGravacao.slice(-30);
        const normalizadas = normalizarOndas(ultimas, 30);

        ondas.innerHTML = normalizadas
            .map(valor => '<span style="height:' + Math.round(6 + valor * 22) + 'px"></span>')
            .join('');
    }

    function mostrarBarraGravacao() {
        const { barra, inputBox, footer } = elementosGravacao();
        if (barra) barra.classList.remove('hidden');
        if (inputBox) inputBox.classList.add('hidden');
        if (footer) footer.classList.add('audio-gravando');
    }

    function esconderBarraGravacao() {
        const { barra, inputBox, footer } = elementosGravacao();
        if (barra) barra.classList.add('hidden');
        if (inputBox) inputBox.classList.remove('hidden');
        if (footer) footer.classList.remove('audio-gravando');
    }

    function atualizarTempoGravacao() {
        const { tempo } = elementosGravacao();
        if (!tempo || !gravando) return;

        const decorrido = Date.now() - inicioGravacao;
        tempo.textContent = formatarTempo(decorrido / 1000);

        if (decorrido >= MAX_GRAVACAO_MS) {
            finalizarGravacao(true);
        }
    }

    function iniciarLeituraAmplitude(stream) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            contextoAudioGravacao = new AudioCtx();
            const origem = contextoAudioGravacao.createMediaStreamSource(stream);
            analyserGravacao = contextoAudioGravacao.createAnalyser();
            analyserGravacao.fftSize = 256;
            analyserGravacao.smoothingTimeConstant = 0.65;
            origem.connect(analyserGravacao);

            const dados = new Uint8Array(analyserGravacao.fftSize);

            timerWaveform = setInterval(() => {
                if (!gravando || !analyserGravacao) return;

                analyserGravacao.getByteTimeDomainData(dados);

                let soma = 0;
                for (let i = 0; i < dados.length; i++) {
                    const normalizado = (dados[i] - 128) / 128;
                    soma += normalizado * normalizado;
                }

                const rms = Math.sqrt(soma / dados.length);
                const nivel = Math.max(0.08, Math.min(1, rms * 4.2));
                amostrasGravacao.push(nivel);

                if (amostrasGravacao.length > 6000) {
                    amostrasGravacao = amostrasGravacao.filter((_, i) => i % 2 === 0);
                }

                renderizarOndasGravacao();
            }, 90);
        } catch (erro) {
            console.warn('[Áudio] Não foi possível gerar waveform ao vivo:', erro);
        }
    }

    async function limparCaptura() {
        if (timerGravacao) {
            clearInterval(timerGravacao);
            timerGravacao = null;
        }

        if (timerWaveform) {
            clearInterval(timerWaveform);
            timerWaveform = null;
        }

        if (streamGravacao) {
            streamGravacao.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
            streamGravacao = null;
        }

        if (contextoAudioGravacao) {
            try { await contextoAudioGravacao.close(); } catch (e) {}
            contextoAudioGravacao = null;
        }

        analyserGravacao = null;
    }

    window.iniciarGravacaoAudio = async function () {
        if (gravando) return;

        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            alert('Este navegador não suporta gravação de áudio.');
            return;
        }

        if (!localStorage.getItem('usuarioLogado')) return;
        if (!window.grupoAtualId && !(typeof destinatarioAtual !== 'undefined' && destinatarioAtual)) return;

        try {
            streamGravacao = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            const mime = mimePreferido();

            mediaRecorder = mime
                ? new MediaRecorder(streamGravacao, { mimeType: mime })
                : new MediaRecorder(streamGravacao);

            chunksGravacao = [];
            amostrasGravacao = [];
            gravando = true;
            inicioGravacao = Date.now();

            mediaRecorder.ondataavailable = event => {
                if (event.data?.size) chunksGravacao.push(event.data);
            };

            mediaRecorder.onerror = event => {
                console.error('[Áudio] MediaRecorder:', event.error || event);
            };

            mostrarBarraGravacao();
            atualizarTempoGravacao();
            renderizarOndasGravacao();

            iniciarLeituraAmplitude(streamGravacao);
            timerGravacao = setInterval(atualizarTempoGravacao, 250);

            mediaRecorder.start(250);
        } catch (erro) {
            console.error('[Áudio] Não foi possível acessar o microfone:', erro);
            await limparCaptura();
            esconderBarraGravacao();

            if (erro?.name === 'NotAllowedError') {
                alert('Libera o microfone pro WhatisApp e tenta de novo.');
            } else {
                alert('Não foi possível iniciar a gravação.');
            }
        }
    };

    async function enviarBlobAudio(blob, duracao, ondas) {
        const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim();
        if (!meuEmail || !blob?.size) return false;

        const grupoId = window.grupoAtualId || null;
        const contato = grupoId
            ? null
            : ((typeof destinatarioAtual !== 'undefined' ? destinatarioAtual : '') || '').trim();

        if (!grupoId && !contato) return false;

        const mime = blob.type || mediaRecorder?.mimeType || 'audio/webm';
        const ext = extensaoPorMime(mime);
        const pastaUsuario = meuEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nomeArquivo =
            'audios/' + pastaUsuario + '/' +
            Date.now() + '_' + Math.random().toString(36).slice(2, 9) + '.' + ext;

        const { error: erroUpload } = await _supabase.storage
            .from('midias')
            .upload(nomeArquivo, blob, {
                contentType: mime,
                upsert: false
            });

        if (erroUpload) {
            console.error('[Áudio] Erro no upload:', erroUpload);
            alert('Erro ao enviar o áudio.');
            return false;
        }

        const { data: urlData } = _supabase.storage
            .from('midias')
            .getPublicUrl(nomeArquivo);

        const url = urlData?.publicUrl;
        if (!url) return false;

        let respostaId = null;
        try {
            respostaId = typeof mensagemRespondendoId !== 'undefined'
                ? mensagemRespondendoId
                : null;
        } catch (e) {}

        const dadosMensagem = {
            texto: '[AUDIO]: ' + url,
            tipo: 'audio',
            audio_url: url,
            audio_duracao: Math.max(1, Math.round(duracao)),
            audio_ondas: normalizarOndas(ondas, QTD_ONDAS),
            remetente_email: meuEmail,
            grupo_id: grupoId,
            destinatario_email: grupoId ? null : contato,
            mensagem_respondida_id: respostaId
        };

        const { data: mensagem, error: erroInsert } = await _supabase
            .from('mensagens')
            .insert([dadosMensagem])
            .select('*')
            .single();

        if (erroInsert) {
            console.error('[Áudio] Erro salvando mensagem:', erroInsert);
            alert('O áudio subiu, mas não foi possível enviar a mensagem.');
            return false;
        }

        try {
            if (typeof cancelarResposta === 'function') cancelarResposta();
        } catch (e) {}

        if (typeof window.verificarSolicitacaoPrimeiraMensagem === 'function') {
            try { await window.verificarSolicitacaoPrimeiraMensagem(); } catch (e) {}
        }

        if (window.WhatisCache && mensagem) {
            try {
                const chave = grupoId
                    ? window.WhatisCache.conversaGrupo(grupoId)
                    : window.WhatisCache.conversaPrivada(contato);

                await window.WhatisCache.salvarMensagens(chave, [mensagem]);
            } catch (e) {}
        }

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

    async function finalizarGravacao(enviar) {
        if (!gravando || !mediaRecorder) return;

        gravando = false;

        const duracao = Math.max(0.4, (Date.now() - inicioGravacao) / 1000);
        const recorderAtual = mediaRecorder;
        const mimeAtual = recorderAtual.mimeType || 'audio/webm';

        await new Promise(resolve => {
            recorderAtual.onstop = async () => {
                const blob = new Blob(chunksGravacao, { type: mimeAtual });
                const ondas = [...amostrasGravacao];

                chunksGravacao = [];
                mediaRecorder = null;

                await limparCaptura();
                esconderBarraGravacao();

                if (enviar && blob.size) {
                    await enviarBlobAudio(blob, duracao, ondas);
                }

                resolve();
            };

            try {
                if (recorderAtual.state !== 'inactive') {
                    recorderAtual.stop();
                } else {
                    resolve();
                }
            } catch (e) {
                resolve();
            }
        });
    }

    window.pararGravacaoAudio = function () {
        return finalizarGravacao(true);
    };

    window.cancelarGravacaoAudio = function () {
        return finalizarGravacao(false);
    };

    function chaveProgresso(id) {
        const conta = (localStorage.getItem('usuarioLogado') || '').trim().toLowerCase();
        return 'whatis_audio_progress|' + conta + '|' + String(id ?? 'sem-id');
    }

    function lerProgresso(id) {
        const valor = Number(localStorage.getItem(chaveProgresso(id)) || 0);
        return Number.isFinite(valor) && valor > 0 ? valor : 0;
    }

    function salvarProgresso(id, segundos) {
        if (id === null || id === undefined) return;
        const valor = Math.max(0, Number(segundos) || 0);
        localStorage.setItem(chaveProgresso(id), String(valor));
    }

    function htmlChecks(visualizada) {
        return `
            <span class="balao-visto ${visualizada ? 'visualizada' : ''}"
                  aria-label="${visualizada ? 'Visualizada' : 'Enviada'}">
                <span class="balao-visto-check">✓</span>
                <span class="balao-visto-check">✓</span>
            </span>
        `;
    }

    async function htmlCitacao(mensagemRespondida) {
        if (!mensagemRespondida?.texto && !mensagemRespondida?.audio_url) return '';

        let texto = window.formatarPreviewMensagem(mensagemRespondida) || 'Mensagem';
        let nome = 'Respondendo a...';
        let cor = '#888888';

        const emailOriginal = mensagemRespondida.remetente_email;

        if (emailOriginal) {
            const meuEmail = localStorage.getItem('usuarioLogado');

            if (emailOriginal === meuEmail) {
                nome = 'Você';
                cor = localStorage.getItem('corUsuario') || '#888888';
            } else {
                try {
                    if (typeof obterUsuarioMensagem === 'function') {
                        const usuario = await obterUsuarioMensagem(emailOriginal);
                        nome = usuario?.usuario || emailOriginal;
                        cor = usuario?.cor || '#888888';
                    }
                } catch (e) {
                    nome = emailOriginal;
                }
            }
        }

        return `
            <div class="citacao-resposta" style="--cor-citacao: ${cor};">
                <strong class="citacao-nome">${nome}</strong>
                <span class="citacao-texto">${texto}</span>
            </div>
        `;
    }

    function aplicarProgressoVisual(balao, segundos, duracao) {
        const barras = [...balao.querySelectorAll('.audio-wave-bar')];
        if (!barras.length) return;

        const total = Math.max(0.1, Number(duracao) || 0.1);
        const proporcao = Math.max(0, Math.min(1, (Number(segundos) || 0) / total));
        const limite = proporcao * barras.length;

        barras.forEach((barra, i) => {
            barra.classList.toggle('escutada', i < limite);
        });

        const cursor = balao.querySelector('.audio-wave-cursor');
        if (cursor) cursor.style.left = (proporcao * 100) + '%';
    }

    function pausarAudioAnterior(novoAudio) {
        if (audioAtivo && audioAtivo !== novoAudio) {
            try { audioAtivo.pause(); } catch (e) {}
        }
        audioAtivo = novoAudio;
    }

    window.renderizarBalaoAudio = async function (msg, ehMinha, opcoes = {}) {
        const container = document.getElementById('chat-mensagens');
        if (!container || !msg) return;

        if (msg.id !== null && msg.id !== undefined) {
            const existente = container.querySelector(
                '.balao-msg[data-message-id="' + String(msg.id) + '"]'
            );
            if (existente) return;
        }

        const url = urlAudioMensagem(msg);
        if (!url) return;

        const balao = document.createElement('div');
        balao.className =
            'balao-msg balao-audio ' +
            (ehMinha ? 'balao-enviada' : 'balao-recebida');

        if (msg.id !== null && msg.id !== undefined) {
            balao.dataset.messageId = String(msg.id);
        }

        const duracaoBanco = Math.max(1, Number(msg.audio_duracao) || 1);
        const ondas = normalizarOndas(
            Array.isArray(msg.audio_ondas) ? msg.audio_ondas : [],
            QTD_ONDAS
        );

        const hora = typeof formatarHora === 'function'
            ? formatarHora(msg.created_at || new Date())
            : '';

        let avatar = opcoes.fotoRemetente || '';

        if (!avatar && ehMinha) {
            avatar = localStorage.getItem('fotoUsuario') || '';
        }

        if (!avatar && !ehMinha) {
            avatar = document.getElementById('chat-foto-usuario')?.src || '';
        }

        if (!avatar) avatar = 'svg/user-placeholder.svg';

        const nomeRemetente = opcoes.nomeRemetente || '';
        const corRemetente = opcoes.corRemetente || '#ff7b00';
        const naoSalvo = opcoes.naoSalvo === true;
        const htmlNome = !ehMinha && nomeRemetente
            ? '<div class="grupo-msg-cabecalho">' +
                '<span class="nome-remetente" style="color:' + corRemetente + '">' + nomeRemetente + '</span>' +
                (naoSalvo ? '<span class="grupo-nao-salvo">Não salvo</span>' : '') +
              '</div>'
            : '';

        const citacao = await htmlCitacao(opcoes.mensagemRespondida);

        balao.innerHTML = `
            ${htmlNome}
            ${citacao}
            <div class="audio-note">
                <div class="audio-note-left">
                    <img class="audio-note-avatar" src="${avatar}" alt="">
                    <button type="button" class="audio-speed-btn" aria-label="Velocidade">1×</button>
                </div>

                <button type="button" class="audio-play-btn" aria-label="Reproduzir áudio">
                    <span class="audio-play-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M7.4 5.25c0-1.08 1.18-1.75 2.11-1.2l9.36 5.55a1.4 1.4 0 0 1 0 2.4l-9.36 5.55a1.4 1.4 0 0 1-2.11-1.2V5.25Z"/>
                        </svg>
                    </span>
                    <span class="audio-pause-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                            <rect x="6.5" y="4.5" width="4" height="15" rx="1.2"/>
                            <rect x="13.5" y="4.5" width="4" height="15" rx="1.2"/>
                        </svg>
                    </span>
                </button>

                <div class="audio-note-main">
                    <div class="audio-wave" role="slider" aria-label="Progresso do áudio">
                        <div class="audio-wave-bars">
                            ${ondas.map(valor =>
                                '<span class="audio-wave-bar" style="--audio-wave-h:' +
                                Math.round(6 + valor * 24) + 'px"></span>'
                            ).join('')}
                        </div>
                        <span class="audio-wave-cursor"></span>
                    </div>

                    <div class="audio-note-meta">
                        <span class="audio-current-time">${formatarTempo(duracaoBanco)}</span>
                        <span class="audio-msg-meta">
                            <span class="audio-msg-hora">${hora}</span>
                            ${ehMinha ? htmlChecks(msg.visualizada === true) : ''}
                        </span>
                    </div>
                </div>

                <audio preload="metadata" src="${url}"></audio>
            </div>
        `;

        const audio = balao.querySelector('audio');
        const play = balao.querySelector('.audio-play-btn');
        const speed = balao.querySelector('.audio-speed-btn');
        const avatarEl = balao.querySelector('.audio-note-avatar');
        const tempo = balao.querySelector('.audio-current-time');
        const wave = balao.querySelector('.audio-wave');

        let duracaoReal = duracaoBanco;
        let velocidade = 1;
        let progressoSalvo = lerProgresso(msg.id);

        aplicarProgressoVisual(balao, progressoSalvo, duracaoReal);

        audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                duracaoReal = audio.duration;
            }

            progressoSalvo = Math.min(progressoSalvo, duracaoReal);

            if (progressoSalvo > 0 && progressoSalvo < duracaoReal - 0.25) {
                try { audio.currentTime = progressoSalvo; } catch (e) {}
                tempo.textContent = formatarTempo(progressoSalvo);
            } else {
                tempo.textContent = formatarTempo(duracaoReal);
            }

            aplicarProgressoVisual(balao, progressoSalvo, duracaoReal);
        });

        play.addEventListener('click', async () => {
            if (audio.paused) {
                if (audio.currentTime >= duracaoReal - 0.2) {
                    audio.currentTime = 0;
                }

                pausarAudioAnterior(audio);

                try {
                    await audio.play();
                } catch (erro) {
                    console.warn('[Áudio] Não foi possível reproduzir:', erro);
                }
            } else {
                audio.pause();
            }
        });

        audio.addEventListener('play', () => {
            balao.classList.add('audio-tocando');
            if (avatarEl) avatarEl.style.display = 'none';
            if (speed) speed.style.display = 'flex';
        });

        audio.addEventListener('pause', () => {
            balao.classList.remove('audio-tocando');
            if (avatarEl) avatarEl.style.display = 'block';
            if (speed) speed.style.display = 'none';

            if (!audio.ended) {
                salvarProgresso(msg.id, audio.currentTime);
            }
        });

        audio.addEventListener('timeupdate', () => {
            const atual = Math.max(0, audio.currentTime || 0);
            tempo.textContent = formatarTempo(atual);
            aplicarProgressoVisual(balao, atual, duracaoReal);

            if (Math.floor(atual * 2) % 2 === 0) {
                salvarProgresso(msg.id, atual);
            }
        });

        audio.addEventListener('ended', () => {
            balao.classList.remove('audio-tocando');
            if (avatarEl) avatarEl.style.display = 'block';
            if (speed) speed.style.display = 'none';

            salvarProgresso(msg.id, duracaoReal);
            tempo.textContent = formatarTempo(duracaoReal);
            aplicarProgressoVisual(balao, duracaoReal, duracaoReal);
        });

        speed.addEventListener('click', () => {
            velocidade = velocidade === 1 ? 1.5 : (velocidade === 1.5 ? 2 : 1);
            audio.playbackRate = velocidade;
            speed.textContent = String(velocidade).replace('.0', '') + '×';
        });

        wave.addEventListener('click', event => {
            const rect = wave.getBoundingClientRect();
            if (!rect.width) return;

            const proporcao = Math.max(
                0,
                Math.min(1, (event.clientX - rect.left) / rect.width)
            );

            const destino = proporcao * duracaoReal;

            try {
                audio.currentTime = destino;
                salvarProgresso(msg.id, destino);
                tempo.textContent = formatarTempo(destino);
                aplicarProgressoVisual(balao, destino, duracaoReal);
            } catch (e) {}
        });

        balao.addEventListener('dblclick', () => {
            try {
                if (typeof iniciarResposta === 'function') {
                    iniciarResposta(
                        msg.id || null,
                        ehMinha ? 'Você' : (nomeRemetente || document.getElementById('chat-nome-usuario')?.innerText || 'Contato'),
                        '[AUDIO]: ' + url
                    );
                }
            } catch (e) {}
        });

        try {
            if (typeof adicionarGestoArrastar === 'function') {
                adicionarGestoArrastar(
                    balao,
                    msg.id,
                    ehMinha ? 'Você' : (nomeRemetente || 'Contato'),
                    '[AUDIO]: ' + url
                );
            }
        } catch (e) {}

        container.appendChild(balao);
        container.scrollTop = container.scrollHeight;
    };

    function ligarGestosGravacao() {
        const barra = document.getElementById('audio-recording-bar');
        if (!barra || barra.dataset.gestosAudio === 'true') return;

        barra.dataset.gestosAudio = 'true';

        let inicioX = 0;
        let cancelado = false;

        barra.addEventListener('touchstart', event => {
            if (!gravando || event.touches.length !== 1) return;
            inicioX = event.touches[0].clientX;
            cancelado = false;
        }, { passive: true });

        barra.addEventListener('touchmove', event => {
            if (!gravando || event.touches.length !== 1 || cancelado) return;

            const delta = event.touches[0].clientX - inicioX;

            if (delta < -90) {
                cancelado = true;
                window.cancelarGravacaoAudio();
            }
        }, { passive: true });
    }

    function iniciar() {
        ligarGestosGravacao();

        const mic = document.getElementById('btn-audio-visual');
        if (mic && mic.dataset.audioLigado !== 'true') {
            mic.dataset.audioLigado = 'true';
            mic.addEventListener('click', event => {
                event.preventDefault();
                window.iniciarGravacaoAudio();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar, { once: true });
    } else {
        iniciar();
    }
})();
