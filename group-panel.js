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

    function aplicarAvatarGrupo(img, fotoUrl) {
        if (!img) return;

        if (fotoUrl) {
            img.src = fotoUrl;
            img.style.backgroundColor = 'transparent';
            img.classList.remove('avatar-sem-foto');
        } else if (typeof window.aplicarAvatarUsuario === 'function') {
            window.aplicarAvatarUsuario(img, '', '#3a3a3c');
        } else {
            img.src = 'svg/user-placeholder.svg';
            img.style.backgroundColor = '#3a3a3c';
        }
    }

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
            .select('id, nome, foto_url, criado_por')
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

        if (nome) nome.textContent = grupo.nome || 'Grupo';
        aplicarAvatarGrupo(foto, grupo.foto_url || '');

        if (criador) {
            criador.textContent = grupo.criado_por
                ? 'Criado por ' + grupo.criado_por
                : 'Grupo';
        }

        painel.classList.remove('hidden');
        painel.style.display = 'flex';

        await window.carregarMembrosPainelGrupo();
    };

    window.carregarMembrosPainelGrupo = async function () {
        const supabase = supabaseAtual();
        const grupoId = window.grupoAtualId;
        const lista = document.getElementById('grupo-membros-lista');
        const contador = document.getElementById('grupo-membros-contador');
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
        if (contador) contador.textContent = String(membros.length);

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

                const item = document.createElement('div');
                item.className = 'grupo-membro-item';

                item.innerHTML = `
                    <img class="grupo-membro-avatar" src="" alt="">
                    <div class="grupo-membro-info">
                        <strong>${escapeHtml(nome)}</strong>
                        <small>${ehCriador ? 'Criador do grupo' : escapeHtml(membro.usuario_email || '')}</small>
                    </div>
                    ${souCriador && !ehCriador ? '<button type="button" class="grupo-remover-membro">Remover</button>' : ''}
                `;

                const avatar = item.querySelector('.grupo-membro-avatar');
                if (typeof window.aplicarAvatarUsuario === 'function') {
                    window.aplicarAvatarUsuario(avatar, usuario?.foto_url || '', usuario?.cor || '#3a3a3c');
                } else if (avatar) {
                    avatar.src = usuario?.foto_url || 'svg/user-placeholder.svg';
                    avatar.style.backgroundColor = usuario?.foto_url ? 'transparent' : (usuario?.cor || '#3a3a3c');
                }

                const remover = item.querySelector('.grupo-remover-membro');
                if (remover) {
                    remover.addEventListener('click', () => {
                        window.removerMembroDoGrupo(
                            membro.usuario_email,
                            nome
                        );
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

        const fundo = localStorage.getItem(`fundo_grupo_${meuEmail}_${grupoId}`);
        window.aplicarFundoGrupoNaTela(fundo);
    };
})();
