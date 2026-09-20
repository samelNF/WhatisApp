// ==========================================
// PAINEL DE DADOS DO GRUPO
// ==========================================
// Mantém dados de contato e dados de grupo em telas separadas.
// Usa as tabelas já existentes: grupos, grupo_membros, usuarios e contatos.

(function () {
    function supabaseAtual() {
        try {
            if (typeof _supabase !== 'undefined' && _supabase) return _supabase;
        } catch (e) {}
        return window._supabase || null;
    }

    function escapeHtml(valor) {
        return String(valor ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function aplicarAvatarGrupo(img, fotoUrl, corGrupo) {
        if (!img) return;

        const fotoValida = typeof fotoUrl === 'string' &&
            fotoUrl.trim() !== '' &&
            !fotoUrl.includes('group-placeholder.svg') &&
            !fotoUrl.includes('user-placeholder.svg');

        if (fotoValida) {
            img.src = fotoUrl;
            img.style.backgroundColor = 'transparent';
            img.classList.remove('avatar-sem-foto');
        } else {
            img.src = 'svg/group-placeholder.svg';
            img.style.backgroundColor = corGrupo || '#482133';
            img.classList.add('avatar-sem-foto');
        }
    }

    function formatarDataCriacaoGrupo(dataIso) {
        if (!dataIso) return '';

        const data = new Date(dataIso);
        if (Number.isNaN(data.getTime())) return '';

        const agora = new Date();
        const ontem = new Date(agora);
        ontem.setDate(agora.getDate() - 1);

        const mesmaData = (a, b) =>
            a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();

        const hora = data.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        if (mesmaData(data, agora)) return 'Criado hoje à(s) ' + hora;
        if (mesmaData(data, ontem)) return 'Criado ontem à(s) ' + hora;

        const dia = data.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: data.getFullYear() === agora.getFullYear() ? undefined : 'numeric'
        });

        return 'Criado em ' + dia + ' à(s) ' + hora;
    }

    let miniMembroAtual = null;

    async function usuarioGrupoEstaSalvo(dadosUsuario) {
        const meuUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
        if (!meuUsuario || !dadosUsuario) return false;

        const supabase = supabaseAtual();
        if (!supabase) return false;

        const { data, error } = await supabase
            .from('contatos')
            .select('contato_usuario')
            .eq('usuario_origem', meuUsuario);

        if (error) {
            console.warn('[Grupo] Não foi possível verificar contato salvo:', error);
            return false;
        }

        const email = String(dadosUsuario.email || '').trim().toLowerCase();
        const usuario = String(dadosUsuario.usuario || '').trim().toLowerCase();

        return (data || []).some(item => {
            const salvo = String(item.contato_usuario || '').trim().toLowerCase();
            return salvo === email || salvo === usuario;
        });
    }

    window.fecharMiniDadosMembroGrupo = function () {
        const overlay = document.getElementById('mini-dados-membro-overlay');
        if (!overlay) return;

        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    };

    window.abrirMiniDadosMembroGrupo = async function (emailMembro) {
        const supabase = supabaseAtual();
        const overlay = document.getElementById('mini-dados-membro-overlay');
        if (!supabase || !overlay || !window.grupoAtualId || !emailMembro) return;

        const email = String(emailMembro).trim().toLowerCase();
        const meuEmail = (localStorage.getItem('usuarioLogado') || '').trim().toLowerCase();

        if (!email || email === meuEmail) return;

        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('email, usuario, foto_url, cor')
            .eq('email', email)
            .maybeSingle();

        if (error || !usuario) {
            console.warn('[Grupo] Não foi possível abrir mini dados:', error);
            return;
        }

        const salvo = await usuarioGrupoEstaSalvo(usuario);

        miniMembroAtual = {
            ...usuario,
            salvo
        };

        const foto = document.getElementById('mini-dados-membro-foto');
        const titulo = document.getElementById('mini-dados-membro-titulo');
        const subtitulo = document.getElementById('mini-dados-membro-subtitulo');
        const btnCriar = document.getElementById('mini-dados-criar-contato');

        if (typeof window.aplicarAvatarUsuario === 'function') {
            window.aplicarAvatarUsuario(foto, usuario.foto_url || '', usuario.cor || '#3a3a3c');
        } else if (foto) {
            foto.src = usuario.foto_url || 'svg/user-placeholder.svg';
            foto.style.backgroundColor = usuario.foto_url ? 'transparent' : (usuario.cor || '#3a3a3c');
        }

        if (titulo) {
            titulo.textContent = salvo
                ? (usuario.usuario || 'Contato')
                : 'Não listado';
        }

        if (subtitulo) {
            subtitulo.textContent = usuario.usuario
                ? '@' + usuario.usuario
                : '';
        }

        if (btnCriar) {
            btnCriar.classList.toggle('hidden', salvo);
        }

        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
    };

    window.acaoMiniMembroGrupo = function (acao) {
        const dados = miniMembroAtual;
        if (!dados?.email) return;

        window.fecharMiniDadosMembroGrupo();

        if (typeof window.abrirChatCom === 'function') {
            window.abrirChatCom(
                dados.email,
                dados.usuario || dados.email,
                dados.foto_url || '',
                dados.cor || '#3a3a3c'
            );
        } else if (typeof abrirChatCom === 'function') {
            abrirChatCom(
                dados.email,
                dados.usuario || dados.email,
                dados.foto_url || '',
                dados.cor || '#3a3a3c'
            );
        }

        if (acao === 'ligar') {
            setTimeout(() => {
                if (typeof window.iniciarLigacaoVoz === 'function') window.iniciarLigacaoVoz();
                else if (typeof iniciarLigacaoVoz === 'function') iniciarLigacaoVoz();
            }, 180);
        } else if (acao === 'video') {
            setTimeout(() => {
                if (typeof window.iniciarLigacaoVideo === 'function') window.iniciarLigacaoVideo();
                else if (typeof iniciarLigacaoVideo === 'function') iniciarLigacaoVideo();
            }, 180);
        }
    };

    window.criarContatoPeloMiniDados = async function () {
        if (!miniMembroAtual || miniMembroAtual.salvo) return;

        const usuario = miniMembroAtual.usuario;
        if (!usuario) return;

        if (typeof window.adicionarNovoContato === 'function') {
            await window.adicionarNovoContato(usuario);
        } else if (typeof adicionarNovoContato === 'function') {
            await adicionarNovoContato(usuario);
        }

        // Confere de novo depois do cadastro; se deu certo, a ficha muda na hora.
        const salvoAgora = await usuarioGrupoEstaSalvo(miniMembroAtual);
        if (salvoAgora) {
            miniMembroAtual.salvo = true;

            const titulo = document.getElementById('mini-dados-membro-titulo');
            const btnCriar = document.getElementById('mini-dados-criar-contato');

            if (titulo) titulo.textContent = miniMembroAtual.usuario || 'Contato';
            if (btnCriar) btnCriar.classList.add('hidden');
        }
    };

    window.abrirDadosCompletosMembroGrupo = function () {
        const dados = miniMembroAtual;
        if (!dados?.email) return;

        window.fecharMiniDadosMembroGrupo();

        if (typeof window.abrirPainelDadosContatoPorEmail === 'function') {
            window.abrirPainelDadosContatoPorEmail(dados.email, {
                salvo: dados.salvo === true,
                ocultarTema: true,
                mostrarEditar: false,
                titulo: 'Dados do usuário'
            });
        }
    };

    function instalarCliqueMiniDadosGrupo() {
        const container = document.getElementById('chat-mensagens');
        if (!container || container.dataset.miniDadosGrupo === 'true') return;

        container.dataset.miniDadosGrupo = 'true';

        container.addEventListener('click', event => {
            if (!window.grupoAtualId) return;

            const alvo = event.target.closest('.grupo-msg-avatar, .grupo-msg-cabecalho .nome-remetente');
            if (!alvo || !container.contains(alvo)) return;

            const balao = alvo.closest('.grupo-msg-recebida');
            const email = balao?.dataset?.groupSender || '';
            if (!email) return;

            event.preventDefault();
            event.stopPropagation();
            window.abrirMiniDadosMembroGrupo(email);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalarCliqueMiniDadosGrupo, { once: true });
    } else {
        instalarCliqueMiniDadosGrupo();
    }

    document.addEventListener('click', event => {
        const overlay = document.getElementById('mini-dados-membro-overlay');
        if (overlay && event.target === overlay) {
            window.fecharMiniDadosMembroGrupo();
        }
    });

    window.abrirPainelDadosChat = function () {
        if (window.grupoAtualId) {
            window.abrirPainelDadosGrupo();
            return;
        }

        if (typeof window.abrirPainelDadosContato === 'function') {
            window.abrirPainelDadosContato();
        }
    };

    window.fecharPainelDadosGrupo = function () {
        const painel = document.getElementById('painel-dados-grupo');
        const add = document.getElementById('grupo-adicionar-membros-overlay');

        if (add) add.classList.add('hidden');
        if (painel) {
            painel.classList.add('hidden');
            painel.style.display = 'none';
        }
    };

    window.abrirPainelDadosGrupo = async function () {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        const painel = document.getElementById('painel-dados-grupo');

        if (!supabase || !grupoId || !painel) return;

        const { data: grupo, error } = await supabase
            .from('grupos')
            .select('*')
            .eq('id', grupoId)
            .maybeSingle();

        if (error) {
            console.error('[Grupo] Erro buscando dados:', error);
            return;
        }

        if (!grupo) return;

        painel.dataset.grupoId = String(grupoId);
        painel.dataset.criadoPor = grupo.criado_por || '';

        const nome = document.getElementById('grupo-info-nome');
        const foto = document.getElementById('grupo-info-foto');
        const criador = document.getElementById('grupo-info-criador');
        const dataCriacao = document.getElementById('grupo-info-data-criacao');

        if (nome) nome.textContent = grupo.nome || 'Grupo';
        aplicarAvatarGrupo(foto, grupo.foto_url || '', grupo.cor || '#482133');

        const meuEmail = (localStorage.getItem('usuarioLogado') || '').toLowerCase();
        const souCriador = (grupo.criado_por || '').toLowerCase() === meuEmail;

        if (criador) {
            if (souCriador) {
                criador.textContent = 'Criado por você.';
            } else if (grupo.criado_por) {
                const { data: autor } = await supabase
                    .from('usuarios')
                    .select('usuario')
                    .eq('email', grupo.criado_por)
                    .maybeSingle();

                criador.textContent = 'Criado por ' + (autor?.usuario || grupo.criado_por) + '.';
            } else {
                criador.textContent = '';
            }
        }

        if (dataCriacao) {
            dataCriacao.textContent = formatarDataCriacaoGrupo(grupo.created_at);
        }

        painel.classList.remove('hidden');
        painel.style.display = 'flex';

        await window.carregarMembrosPainelGrupo();

        if (typeof window.atualizarSafeArea === 'function') {
            requestAnimationFrame(() => window.atualizarSafeArea());
        }
    };

    window.carregarMembrosPainelGrupo = async function () {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        const lista = document.getElementById('grupo-membros-lista');
        const contador = document.getElementById('grupo-membros-contador');
        const contadorResumo = document.getElementById('grupo-resumo-contador');
        const resumo = document.getElementById('grupo-info-resumo');
        const btnAdicionar = document.getElementById('btn-grupo-adicionar-membro');
        const painel = document.getElementById('painel-dados-grupo');

        if (!supabase || !grupoId || !lista) return;

        lista.innerHTML = '<div class="grupo-membros-vazio">Carregando participantes...</div>';

        const { data: relacoes, error } = await supabase
            .from('grupo_membros')
            .select('grupo_id, usuario_email, usuario_nome')
            .eq('grupo_id', grupoId);

        if (error) {
            console.error('[Grupo] Erro buscando membros:', error);
            lista.innerHTML = '<div class="grupo-membros-vazio">Não foi possível carregar os participantes.</div>';
            return;
        }

        const membros = relacoes || [];
        const totalMembros = membros.length;

        if (contador) contador.textContent = String(totalMembros);
        if (contadorResumo) contadorResumo.textContent = String(totalMembros);

        if (resumo) {
            resumo.innerHTML = 'Grupo · <span id="grupo-resumo-contador">' +
                totalMembros +
                '</span> ' +
                (totalMembros === 1 ? 'membro' : 'membros');
        }

        const tituloMembros = document.querySelector('#painel-dados-grupo .grupo-membros-titulo-linha h3');
        if (tituloMembros) {
            tituloMembros.innerHTML = '<span id="grupo-membros-contador">' +
                totalMembros +
                '</span> ' +
                (totalMembros === 1 ? 'membro' : 'membros');
        }

        const emails = [...new Set(membros.map(m => m.usuario_email).filter(Boolean))];
        let usuarios = [];

        if (emails.length) {
            const { data } = await supabase
                .from('usuarios')
                .select('email, usuario, foto_url, cor')
                .in('email', emails);
            usuarios = data || [];
        }

        const usuariosPorEmail = new Map(
            usuarios.map(u => [(u.email || '').toLowerCase(), u])
        );

        const criadoPor = painel?.dataset.criadoPor || '';
        const meuEmail = localStorage.getItem('usuarioLogado') || '';
        const souCriador = !!criadoPor && criadoPor.toLowerCase() === meuEmail.toLowerCase();

        if (btnAdicionar) btnAdicionar.classList.toggle('hidden', !souCriador);

        lista.innerHTML = '';

        if (!membros.length) {
            lista.innerHTML = '<div class="grupo-membros-vazio">Nenhum participante encontrado.</div>';
            return;
        }

        membros
            .sort((a, b) => {
                if ((a.usuario_email || '').toLowerCase() === criadoPor.toLowerCase()) return -1;
                if ((b.usuario_email || '').toLowerCase() === criadoPor.toLowerCase()) return 1;
                return (a.usuario_nome || '').localeCompare(b.usuario_nome || '');
            })
            .forEach(membro => {
                const usuario = usuariosPorEmail.get((membro.usuario_email || '').toLowerCase());
                const nome = usuario?.usuario || membro.usuario_nome || membro.usuario_email || 'Participante';
                const ehCriador = (membro.usuario_email || '').toLowerCase() === criadoPor.toLowerCase();

                const emailMembro = (membro.usuario_email || '').toLowerCase();
                const ehEu = emailMembro === meuEmail.toLowerCase();
                const item = document.createElement('div');
                item.className = 'grupo-membro-item';
                item.dataset.nome = nome.toLowerCase();
                item.dataset.email = emailMembro;

                if (souCriador && !ehCriador && !ehEu) {
                    item.classList.add('grupo-membro-removivel');
                    item.title = 'Toque para remover este membro';
                }

                item.innerHTML = `
                    <img class="grupo-membro-avatar" src="" alt="">
                    <div class="grupo-membro-info">
                        <strong>${ehEu ? 'Você' : escapeHtml(nome)}</strong>
                    </div>
                    ${ehCriador ? '<span class="grupo-membro-admin">Admin</span>' : ''}
                `;

                const avatar = item.querySelector('.grupo-membro-avatar');
                if (typeof window.aplicarAvatarUsuario === 'function') {
                    window.aplicarAvatarUsuario(avatar, usuario?.foto_url || '', usuario?.cor || '#3a3a3c');
                } else if (avatar) {
                    avatar.src = usuario?.foto_url || 'svg/user-placeholder.svg';
                    avatar.style.backgroundColor = usuario?.foto_url ? 'transparent' : (usuario?.cor || '#3a3a3c');
                }

                if (souCriador && !ehCriador && !ehEu) {
                    item.addEventListener('click', () => {
                        window.removerMembroDoGrupo(membro.usuario_email, nome);
                    });
                }

                lista.appendChild(item);
            });
    };

    window.abrirAdicionarMembroGrupo = async function () {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        const overlay = document.getElementById('grupo-adicionar-membros-overlay');
        const lista = document.getElementById('grupo-candidatos-lista');

        if (!supabase || !grupoId || !overlay || !lista) return;

        const painel = document.getElementById('painel-dados-grupo');
        const criadoPor = painel?.dataset.criadoPor || '';
        const meuEmail = localStorage.getItem('usuarioLogado') || '';

        if (!criadoPor || criadoPor.toLowerCase() !== meuEmail.toLowerCase()) {
            alert('Somente quem criou o grupo pode adicionar participantes.');
            return;
        }

        overlay.classList.remove('hidden');
        lista.innerHTML = '<div class="grupo-membros-vazio">Carregando contatos...</div>';

        const meuUsuario = localStorage.getItem('nomeUsuario') || '';

        const { data: membrosAtuais } = await supabase
            .from('grupo_membros')
            .select('usuario_email')
            .eq('grupo_id', grupoId);

        const emailsAtuais = new Set(
            (membrosAtuais || []).map(m => (m.usuario_email || '').toLowerCase())
        );

        const { data: contatos, error: erroContatos } = await supabase
            .from('contatos')
            .select('contato_usuario')
            .eq('usuario_origem', meuUsuario);

        if (erroContatos) {
            console.error('[Grupo] Erro buscando contatos:', erroContatos);
            lista.innerHTML = '<div class="grupo-membros-vazio">Não foi possível carregar seus contatos.</div>';
            return;
        }

        const nomes = [...new Set((contatos || []).map(c => c.contato_usuario).filter(Boolean))];

        if (!nomes.length) {
            lista.innerHTML = '<div class="grupo-membros-vazio">Você não tem contatos disponíveis para adicionar.</div>';
            return;
        }

        const { data: usuarios, error: erroUsuarios } = await supabase
            .from('usuarios')
            .select('email, usuario, foto_url, cor')
            .in('usuario', nomes);

        if (erroUsuarios) {
            console.error('[Grupo] Erro buscando usuários:', erroUsuarios);
            lista.innerHTML = '<div class="grupo-membros-vazio">Não foi possível carregar seus contatos.</div>';
            return;
        }

        const disponiveis = (usuarios || []).filter(
            u => !emailsAtuais.has((u.email || '').toLowerCase())
        );

        lista.innerHTML = '';

        if (!disponiveis.length) {
            lista.innerHTML = '<div class="grupo-membros-vazio">Todos os seus contatos já estão neste grupo.</div>';
            return;
        }

        disponiveis.forEach(usuario => {
            const item = document.createElement('div');
            item.className = 'grupo-membro-item grupo-candidato-item';

            item.innerHTML = `
                <img class="grupo-membro-avatar" src="" alt="">
                <div class="grupo-membro-info">
                    <strong>${escapeHtml(usuario.usuario || usuario.email)}</strong>
                    <small>${escapeHtml(usuario.email || '')}</small>
                </div>
                <button type="button" class="grupo-adicionar-um">Adicionar</button>
            `;

            const avatar = item.querySelector('.grupo-membro-avatar');
            if (typeof window.aplicarAvatarUsuario === 'function') {
                window.aplicarAvatarUsuario(avatar, usuario.foto_url || '', usuario.cor || '#3a3a3c');
            }

            item.querySelector('.grupo-adicionar-um')?.addEventListener('click', async (event) => {
                const botao = event.currentTarget;
                botao.disabled = true;
                botao.textContent = 'Adicionando...';

                const ok = await window.adicionarMembroAoGrupo(usuario);

                if (ok) {
                    item.remove();
                    if (!lista.querySelector('.grupo-candidato-item')) {
                        lista.innerHTML = '<div class="grupo-membros-vazio">Todos os seus contatos já estão neste grupo.</div>';
                    }
                } else {
                    botao.disabled = false;
                    botao.textContent = 'Adicionar';
                }
            });

            lista.appendChild(item);
        });
    };

    window.fecharAdicionarMembroGrupo = function () {
        document.getElementById('grupo-adicionar-membros-overlay')?.classList.add('hidden');
    };

    window.adicionarMembroAoGrupo = async function (usuario) {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        if (!supabase || !grupoId || !usuario?.email) return false;

        const { data: membros } = await supabase
            .from('grupo_membros')
            .select('usuario_email')
            .eq('grupo_id', grupoId);

        // A criação atual aceita até 15 convidados + o criador.
        if ((membros || []).length >= 16) {
            alert('Este grupo já atingiu o limite de participantes.');
            return false;
        }

        const { error } = await supabase
            .from('grupo_membros')
            .insert([{
                grupo_id: grupoId,
                usuario_email: usuario.email,
                usuario_nome: usuario.usuario || usuario.email
            }]);

        if (error) {
            console.error('[Grupo] Erro adicionando membro:', error);
            alert('Não foi possível adicionar este participante.');
            return false;
        }

        await window.carregarMembrosPainelGrupo();
        return true;
    };

    window.removerMembroDoGrupo = async function (email, nome) {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        const painel = document.getElementById('painel-dados-grupo');

        if (!supabase || !grupoId || !email) return;

        const criadoPor = painel?.dataset.criadoPor || '';
        const meuEmail = localStorage.getItem('usuarioLogado') || '';

        if (!criadoPor || criadoPor.toLowerCase() !== meuEmail.toLowerCase()) {
            alert('Somente quem criou o grupo pode remover participantes.');
            return;
        }

        if (email.toLowerCase() === criadoPor.toLowerCase()) {
            alert('O criador do grupo não pode ser removido.');
            return;
        }

        if (!confirm('Remover ' + (nome || email) + ' do grupo?')) return;

        const { error } = await supabase
            .from('grupo_membros')
            .delete()
            .eq('grupo_id', grupoId)
            .eq('usuario_email', email);

        if (error) {
            console.error('[Grupo] Erro removendo membro:', error);
            alert('Não foi possível remover este participante.');
            return;
        }

        await window.carregarMembrosPainelGrupo();
    };

    window.alternarMenuGrupoDados = function (event) {
        if (event) event.stopPropagation();
        document.getElementById('grupo-dados-menu')?.classList.toggle('hidden');
    };

    window.fecharMenuGrupoDados = function () {
        document.getElementById('grupo-dados-menu')?.classList.add('hidden');
    };

    window.alternarPesquisaMembrosGrupo = function () {
        const caixa = document.getElementById('grupo-pesquisa-membros');
        const input = document.getElementById('grupo-pesquisa-input');
        if (!caixa) return;

        caixa.classList.toggle('hidden');

        if (!caixa.classList.contains('hidden') && input) {
            setTimeout(() => input.focus(), 30);
        } else if (input) {
            input.value = '';
            window.filtrarMembrosGrupo('');
        }
    };

    window.filtrarMembrosGrupo = function (termo) {
        const busca = (termo || '').trim().toLowerCase();
        document.querySelectorAll('#grupo-membros-lista .grupo-membro-item').forEach(item => {
            const nome = item.dataset.nome || '';
            const email = item.dataset.email || '';
            item.style.display = (!busca || nome.includes(busca) || email.includes(busca)) ? 'flex' : 'none';
        });
    };

    window.iniciarLigacaoGrupo = window.iniciarLigacaoGrupo || function () {
        console.log('[Grupo] Ligação de voz em grupo ainda não implementada.');
    };

    window.iniciarVideoGrupo = window.iniciarVideoGrupo || function () {
        console.log('[Grupo] Chamada de vídeo em grupo ainda não implementada.');
    };

    window.sairDoGrupoAtual = async function () {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        const painel = document.getElementById('painel-dados-grupo');
        const meuEmail = localStorage.getItem('usuarioLogado') || '';

        if (!supabase || !grupoId || !meuEmail) return;
        if (!confirm('Sair deste grupo?')) return;

        const criadoPor = (painel?.dataset.criadoPor || '').toLowerCase();

        if (criadoPor === meuEmail.toLowerCase()) {
            const { data: membros } = await supabase
                .from('grupo_membros')
                .select('usuario_email')
                .eq('grupo_id', grupoId);

            const proximoAdmin = (membros || []).find(
                m => (m.usuario_email || '').toLowerCase() !== meuEmail.toLowerCase()
            );

            if (!proximoAdmin) {
                alert('Você é o único membro do grupo. A exclusão completa do grupo ainda não foi implementada.');
                return;
            }

            const { error: erroAdmin } = await supabase
                .from('grupos')
                .update({ criado_por: proximoAdmin.usuario_email })
                .eq('id', grupoId);

            if (erroAdmin) {
                console.error('[Grupo] Erro transferindo administração:', erroAdmin);
                alert('Não foi possível transferir a administração do grupo.');
                return;
            }
        }

        const { error } = await supabase
            .from('grupo_membros')
            .delete()
            .eq('grupo_id', grupoId)
            .eq('usuario_email', meuEmail);

        if (error) {
            console.error('[Grupo] Erro ao sair:', error);
            alert('Não foi possível sair do grupo.');
            return;
        }

        window.fecharPainelDadosGrupo();
        if (typeof fecharChat === 'function') fecharChat();
        if (typeof carregarListaContatos === 'function') carregarListaContatos();
    };

    document.addEventListener('click', (event) => {
        const menu = document.getElementById('grupo-dados-menu');
        const botao = event.target.closest?.('.grupo-mais-btn');

        if (menu && !botao && !menu.contains(event.target)) {
            menu.classList.add('hidden');
        }
    });

    window.acionarTrocaFundoGrupo = function () {
        document.getElementById('input-fundo-grupo')?.click();
    };

    window.alterarFundoGrupo = function (event) {
        const arquivo = event.target.files?.[0];
        const grupoId = window.grupoAtualId;
        const meuEmail = localStorage.getItem('usuarioLogado');

        if (!arquivo || !grupoId || !meuEmail) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            const url = e.target.result;
            localStorage.setItem(`fundo_grupo_${meuEmail}_${grupoId}`, url);
            window.aplicarFundoGrupoNaTela(url);
            window.fecharPainelDadosGrupo();
        };
        reader.readAsDataURL(arquivo);

        event.target.value = '';
    };

    window.aplicarFundoGrupoNaTela = function (url) {
        const chat = document.getElementById('chat-mensagens');
        if (!chat) return;

        if (url) {
            chat.style.backgroundImage = `url("${url}")`;
            chat.style.backgroundSize = 'cover';
            chat.style.backgroundPosition = 'center';
        } else {
            chat.style.backgroundImage = '';
        }
    };

    window.carregarFundoGrupoSalvo = function (grupoId) {
        const meuEmail = localStorage.getItem('usuarioLogado');
        if (!grupoId || !meuEmail) return;

        const fundoProprio = localStorage.getItem(`fundo_grupo_${meuEmail}_${grupoId}`);
        const fundoGlobal = localStorage.getItem(`fundo_chat_global_${meuEmail}`);

        // Fundo do grupo tem prioridade; o padrão entra só se não houver um próprio.
        window.aplicarFundoGrupoNaTela(fundoProprio || fundoGlobal || '');
    };
})();
