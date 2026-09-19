// ==========================================
// CONFIGURAÇÃO DO SUPABASE
// ==========================================
const supabaseUrl = 'https://qlvorxobvnjoovqxnfhp.supabase.co';
const supabaseKey = 'sb_publishable_IoDWf91jWwRgamUfmdDQow_1-fIMHZO';
const _supabase = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// Variáveis globais de estado
let mensagemRespondendoId = null;
let todosContatos = [];
let destinatarioAtual = null;
let escutaRealtime = null;
let intervaloHeartbeat = null;
let intervaloChecarStatusContato = null;
let arquivoFotoSelecionado = null;
// Controle da reconexão do Realtime
let timeoutReconexaoRealtime = null;
let realtimeConectando = false;
// Estado para Solicitações de Chat
let solicitacaoAtual = null;

// ==========================================
// INICIALIZAÇÃO E SERVICE WORKER
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    Promise.resolve(verificarSessao())
        .catch(erro => console.error("Erro ao restaurar sessão:", erro))
        .finally(() => document.body?.classList.remove("sessao-resolvendo"));

    registrarServiceWorker();
    inicializarEventosSolicitacoes();
});

async function alternarNotificacoes(checkbox) {
    if (checkbox.checked) {
        if (!("Notification" in window)) {
            alert("Este navegador não suporta notificações.");
            checkbox.checked = false;
            localStorage.setItem("notificacoes", "false");
            return;
        }

        const ehIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const ehStandalone = window.matchMedia?.("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;

        if (ehIOS && !ehStandalone) {
            alert("No iPhone/iPad, adicione o WhatisApp à Tela de Início e abra por lá para ativar notificações.");
            checkbox.checked = false;
            return;
        }

        let permissao = Notification.permission;

        if (permissao !== "granted") {
            permissao = await Notification.requestPermission();
        }

        if (permissao === "granted") {
            localStorage.setItem("notificacoes", "true");

            let sistemaAtivado = false;

            if (typeof window.ativarSistemaNotificacoes === "function") {
                sistemaAtivado = await window.ativarSistemaNotificacoes(true);
            }

            if (!sistemaAtivado) {
                alert("A permissão foi liberada, mas o Web Push não conseguiu registrar este aparelho. Feche e abra o app e tente ligar as notificações novamente.");
                checkbox.checked = false;
                localStorage.setItem("notificacoes", "false");
                return;
            }

            // Confirmação local de permissão + Service Worker.
            if (typeof window.testarNotificacaoWhatisApp === "function") {
                await window.testarNotificacaoWhatisApp();
            }

            console.log("🔔 Notificações ativadas, inclusive em segundo plano.");
        } else {
            alert("A permissão para notificações foi negada nas configurações do navegador/sistema.");
            checkbox.checked = false;
            localStorage.setItem("notificacoes", "false");
        }
    } else {
        localStorage.setItem("notificacoes", "false");

        if (typeof window.desativarSistemaNotificacoes === "function") {
            await window.desativarSistemaNotificacoes();
        }

        console.log("🔕 Notificações desativadas.");
    }
}

function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('✅ Service Worker registrado:', reg.scope);
            })
            .catch(err => {
                console.error('⚠️ Erro ao registrar Service Worker:', err);
            });
    }
}
// ==========================================
// UTILITÁRIOS E FORMATAÇÃO
// ==========================================
function mostrarSenha() {
    const senha = document.getElementById("senha");
    if (senha) senha.type = senha.type === "password" ? "text" : "password";
}

function mostrarSenhaLogin() {
    const senha = document.getElementById("login-senha");
    if (senha) senha.type = senha.type === "password" ? "text" : "password";
}

function formatarHora(dataISO) {
    if (!dataISO) return "";

    const data = new Date(dataISO);

    return data.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatarVistoPorUltimo(dataISO) {
    if (!dataISO) return "offline";

    const agora = new Date();
    const ultimaVez = new Date(dataISO);
    const diferencaSegundos = Math.floor((agora - ultimaVez) / 1000);

    if (diferencaSegundos < 60) {
        return "online";
    }

    return `visto por último às ${formatarHora(dataISO)}`;
}

async function gerarHash(texto) {
    const dados = new TextEncoder().encode(texto);
    const hash = await crypto.subtle.digest("SHA-256", dados);

    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

// ==========================================
// AVATAR DE USUÁRIO / COR DE PERFIL
// ==========================================
function aplicarAvatarUsuario(elemento, fotoUrl, corUsuario) {
    if (!elemento) return;

    const fotoValida = typeof fotoUrl === "string" &&
        fotoUrl.trim() !== "" &&
        !fotoUrl.includes("user-placeholder.svg") &&
        !fotoUrl.includes("icon.svg");

    const cor = corUsuario || "#3a3a3c";

    elemento.dataset.avatarCor = cor;
    elemento.dataset.temFoto = fotoValida ? "true" : "false";

    if (fotoValida) {
        elemento.src = fotoUrl;
        elemento.style.backgroundColor = "transparent";
        elemento.classList.remove("avatar-sem-foto");
    } else {
        elemento.src = "svg/user-placeholder.svg";
        elemento.style.backgroundColor = cor;
        elemento.classList.add("avatar-sem-foto");
    }
}

window.aplicarAvatarUsuario = aplicarAvatarUsuario;

// ==========================================
// CONTROLE DE TELAS E NAVEGAÇÃO
// ==========================================
function esconderTelasAutenticacao() {
    const telas = ["inicio", "login", "criar-conta", "etapa-usuario"];

    telas.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
}

function esconderAppPrincipal() {
    document.querySelectorAll(".aba-conteudo").forEach(el => {
        el.style.display = "none";
    });

    const barraNavegacao = document.querySelector(".ultrabaixo");
    if (barraNavegacao) barraNavegacao.style.display = "none";

    document.body?.classList.remove("app-principal-ativa");
}

function mostrarTela(idTela) {
    esconderTelasAutenticacao();
    esconderAppPrincipal();

    const telaAlvo = document.getElementById(idTela);

    if (telaAlvo) {
        telaAlvo.style.display = "flex";
    }
}

function proximo() {
    localStorage.setItem("introducaoVista", "true");

    document.getElementById("inicio").style.display = "none";

    const meuEmail = localStorage.getItem("usuarioLogado");

    if (meuEmail) {
        mostrarAppPrincipal();
    } else {
        mostrarTela("login");
    }
}

function aplicarSessaoCacheNoRuntime(sessao) {
    if (!sessao?.email) return false;

    window.sessaoOfflineAtiva = {
        email: sessao.email,
        usuario: sessao.usuario || "",
        foto_url: sessao.foto_url || "",
        cor: sessao.cor || "#3a3a3c"
    };

    // Compatibilidade com o restante do código antigo.
    // A origem persistente agora pode ser o IndexedDB; o localStorage só é
    // reidratado durante esta execução para evitar reescrever o app inteiro.
    localStorage.setItem("usuarioLogado", sessao.email);

    if (sessao.usuario) localStorage.setItem("nomeUsuario", sessao.usuario);
    else localStorage.removeItem("nomeUsuario");

    if (sessao.foto_url) localStorage.setItem("fotoUsuario", sessao.foto_url);
    else localStorage.removeItem("fotoUsuario");

    if (sessao.cor) localStorage.setItem("corUsuario", sessao.cor);
    else localStorage.removeItem("corUsuario");

    return true;
}

async function salvarSessaoNoCache(usuario) {
    if (!usuario?.email || !window.WhatisCache?.salvarSessaoLocal) return;

    await window.WhatisCache.salvarSessaoLocal({
        email: usuario.email,
        usuario: usuario.usuario || "",
        foto_url: usuario.foto_url || "",
        cor: usuario.cor || "#3a3a3c"
    });
}

async function mostrarAppPrincipal() {
    esconderTelasAutenticacao();

    const telaConversas = document.getElementById("tela-conversas");
    const barraNavegacao = document.querySelector(".ultrabaixo");

    if (telaConversas) telaConversas.style.display = "block";
    if (barraNavegacao) barraNavegacao.style.display = "flex";
    document.body?.classList.add("app-principal-ativa");

    // Primeiro mostra o que existe localmente; se houver rede, a função
    // sincroniza e atualiza a lista sem bloquear a abertura do app.
    await carregarListaContatos();

    if (navigator.onLine) {
        try { carregarSolicitacoes(); } catch (e) {}
        try { inscreverRealtime(); } catch (e) {}
        try { iniciarMonitoramentoPresenca(); } catch (e) {}
    } else {
        console.log("📦 WhatisApp aberto em modo offline.");
    }
}

function alternarAba(aba, botaoClicado) {
    const abas = document.querySelectorAll('.aba-conteudo');

    abas.forEach(a => a.style.display = 'none');

    const botoes = document.querySelectorAll('.baixo button');

    botoes.forEach(btn => btn.classList.remove('ativo'));

    if (aba === 'conversas') {
        const telaConversas = document.getElementById('tela-conversas');

        if (telaConversas) {
            telaConversas.style.display = 'block';
        }

    } else if (aba === 'voce') {
        const telaVoce = document.getElementById('tela-voce');

        if (telaVoce) {
            telaVoce.style.display = 'flex';
        }

        carregarDadosAbaVoce();
    }

    if (botaoClicado) {
        botaoClicado.classList.add('ativo');
    }
}
// ==========================================
// PERSISTÊNCIA DE SESSÃO
// ==========================================
async function verificarSessao() {
    const cache = window.WhatisCache || null;

    let sessaoCache = null;
    if (cache?.obterSessaoLocal) {
        try {
            sessaoCache = await cache.obterSessaoLocal();
        } catch (e) {
            console.warn("Não foi possível ler a sessão offline:", e);
        }
    }

    let emailSalvo = localStorage.getItem("usuarioLogado");

    // Se o navegador limpou o localStorage, mas o IndexedDB ainda tem a sessão,
    // restaura a conta e entra direto no histórico salvo.
    if (!emailSalvo && sessaoCache?.email) {
        aplicarSessaoCacheNoRuntime(sessaoCache);
        emailSalvo = sessaoCache.email;
    }

    const introducaoVista =
        localStorage.getItem("introducaoVista") ||
        (sessaoCache?.email ? "true" : null);

    if (!introducaoVista && !emailSalvo) {
        mostrarTela("inicio");
        return;
    }

    if (!emailSalvo) {
        console.log("Nenhuma sessão local encontrada.");
        mostrarTela('login');
        return;
    }

    // Se há sessão em cache, abre o aplicativo AGORA, sem esperar internet.
    if (sessaoCache?.email) {
        aplicarSessaoCacheNoRuntime(sessaoCache);
        atualizarFotoAbaVoce();
        await mostrarAppPrincipal();
    }

    // Sem internet: o cache é suficiente para leitura do histórico.
    if (!navigator.onLine || !_supabase) {
        if (!sessaoCache?.email) {
            console.log("Sem internet e sem sessão offline disponível.");
            mostrarTela('login');
        }
        return;
    }

    let usuario = null;
    let erroVerificacao = null;

    try {
        const resposta = await _supabase
            .from("usuarios")
            .select("*")
            .eq("email", emailSalvo)
            .maybeSingle();

        usuario = resposta.data || null;
        erroVerificacao = resposta.error || null;
    } catch (erro) {
        erroVerificacao = erro;
    }

    // Falha de rede/servidor não derruba mais uma sessão local válida.
    if (erroVerificacao) {
        console.warn("Não foi possível validar a sessão online. Mantendo cache local.", erroVerificacao);

        if (!sessaoCache?.email) {
            mostrarTela('login');
        }

        return;
    }

    // Resposta online válida dizendo que a conta não existe mais.
    if (!usuario) {
        console.log("Sessão online inválida.");

        localStorage.removeItem("usuarioLogado");
        localStorage.removeItem("nomeUsuario");
        localStorage.removeItem("fotoUsuario");
        localStorage.removeItem("corUsuario");

        if (cache?.limparSessaoLocal) {
            await cache.limparSessaoLocal();
        }

        mostrarTela('login');
        return;
    }

    console.log("Sessão ativa para:", usuario.email);

    if (
        !localStorage.getItem("pushSessionToken") &&
        usuario.senha &&
        typeof window.criarSessaoPush === "function"
    ) {
        await window.criarSessaoPush(usuario.email, usuario.senha);
    }

    aplicarSessaoCacheNoRuntime({
        email: usuario.email,
        usuario: usuario.usuario || "",
        foto_url: usuario.foto_url || "",
        cor: usuario.cor || "#3a3a3c"
    });

    await salvarSessaoNoCache(usuario);
    atualizarFotoAbaVoce();

    // Se ainda não tínhamos cache, esta é a primeira abertura autenticada.
    if (!sessaoCache?.email) {
        await mostrarAppPrincipal();
    } else {
        // Já abriu instantaneamente pelo cache; só sincroniza em segundo plano.
        carregarListaContatos();
        try { inscreverRealtime(); } catch (e) {}
        try { iniciarMonitoramentoPresenca(); } catch (e) {}
    }
}

async function deslogar() {
    pararMonitoramentoPresenca();

    if (typeof window.desativarSistemaNotificacoes === "function") {
        try { await window.desativarSistemaNotificacoes(); } catch (e) {}
    }

    if (escutaRealtime) {
        try { _supabase.removeChannel(escutaRealtime); } catch (e) {}
        escutaRealtime = null;
    }

    if (timeoutReconexaoRealtime) {
        clearTimeout(timeoutReconexaoRealtime);
        timeoutReconexaoRealtime = null;
    }

    if (window.WhatisCache?.limparSessaoLocal) {
        await window.WhatisCache.limparSessaoLocal();
    }

    window.sessaoOfflineAtiva = null;

    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("nomeUsuario");
    localStorage.removeItem("fotoUsuario");
    localStorage.removeItem("corUsuario");
    localStorage.removeItem("pushSessionToken");

    alert("Sessão encerrada!");

    window.location.reload();
}
// ==========================================
// AUTENTICAÇÃO E CADASTRO
// ==========================================
async function criarConta() {
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;

    if (email === "" || senha === "") {
        alert("Por favor, preencha todos os campos.");
        return;
    }

    if (!email.includes("@") || !email.includes(".")) {
        alert("Digite um email válido.");
        return;
    }

    if (senha.length < 8 || senha.length > 12) {
        alert("A senha tem que ter entre 8 e 12 caracteres.");
        return;
    }

    const { data: contaExistente } = await _supabase
        .from("usuarios")
        .select("email")
        .eq("email", email)
        .maybeSingle();

    if (contaExistente) {
        alert("Essa conta já existe.");
        return;
    }

    const senhaHash = await gerarHash(email + senha);

    const { error: erroInsercao } = await _supabase
        .from("usuarios")
        .insert([{
            email: email,
            senha: senhaHash,
            usuario: null
        }]);

    if (erroInsercao) {
        alert("Erro ao salvar no servidor.");
        return;
    }

    sessionStorage.setItem("emailCadastro", email);
    sessionStorage.setItem("pushSenhaHashCadastro", senhaHash);

    mostrarTela('etapa-usuario');
}

function previewFoto(event) {
    const file = event.target.files[0];

    if (file) {
        arquivoFotoSelecionado = file;

        const reader = new FileReader();

        reader.onload = function(e) {
            const preview = document.getElementById("avatar-preview");

            if (preview) {
                preview.src = e.target.result;
            }
        };

        reader.readAsDataURL(file);
    }
}

async function salvarUsuarioSegundaEtapa() {
    const usuarioInput = document.getElementById("usuario").value.trim();
    const emailCadastrado = sessionStorage.getItem("emailCadastro");

    if (usuarioInput === "") {
        alert("Por favor, escolha um nome de usuário.");
        return;
    }

    if (!emailCadastrado) {
        alert("Sessão expirada. Por favor, recomece o cadastro.");
        mostrarTela('criar-conta');
        return;
    }

    // 1. Paleta de cores distintas e bonitas para os usuários
    const paletaCores = [
        '#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', 
        '#33FFF3', '#FFA533', '#A533FF', '#FF3366', '#33FFA5',
        '#9C27B0', '#E91E63', '#00BCD4', '#8BC34A', '#FFEB3B'
    ];

    // 2. Busca todas as cores que já estão em uso no banco de dados
    const { data: usuariosCadastrados } = await _supabase
        .from("usuarios")
        .select("cor");

    const coresUsadas = usuariosCadastrados ? usuariosCadastrados.map(u => u.cor).filter(Boolean) : [];

    // 3. Filtra apenas as cores que ainda NÃO foram escolhidas
    const coresDisponiveis = paletaCores.filter(cor => !coresUsadas.includes(cor));

    // 4. Escolhe uma cor aleatória das disponíveis (ou gera uma aleatória caso a paleta esgote)
    let corFinal = "";
    if (coresDisponiveis.length > 0) {
        corFinal = coresDisponiveis[Math.floor(Math.random() * coresDisponiveis.length)];
    } else {
        // Fallback caso todas da paleta sejam usadas: gera um Hex aleatório
        corFinal = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    }

    let urlFotoPublica = null;

    if (arquivoFotoSelecionado) {
        const fileExt = arquivoFotoSelecionado.name.split('.').pop();
        const fileName = `avatar_${Date.now()}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await _supabase
            .storage
            .from('avatars')
            .upload(fileName, arquivoFotoSelecionado, {
                cacheControl: '3600',
                upsert: true
            });

        if (uploadError) {
            console.error("Erro no Upload do Storage:", uploadError.message);
            alert("Erro ao salvar foto no servidor: " + uploadError.message);
        } else {
            const { data: publicUrlData } = _supabase
                .storage
                .from('avatars')
                .getPublicUrl(fileName);

            urlFotoPublica = publicUrlData.publicUrl;
        }
    }

    // 5. Salva o usuário junto com a cor escolhida no banco
    const { data, error } = await _supabase
        .from("usuarios")
        .update({
            usuario: usuarioInput,
            foto_url: urlFotoPublica,
            cor: corFinal // <--- Salvando a cor fixa aqui
        })
        .eq("email", emailCadastrado)
        .select();

    if (error || !data || data.length === 0) {
        console.error("Erro no update da tabela usuarios:", error?.message);
        alert("Erro ao vincular o perfil na tabela de usuários.");
        return;
    }

    localStorage.setItem("usuarioLogado", emailCadastrado);
    localStorage.setItem("nomeUsuario", usuarioInput);
    localStorage.setItem("corUsuario", corFinal); // <--- Guarda localmente também se quiser

    if (urlFotoPublica) {
        localStorage.setItem("fotoUsuario", urlFotoPublica);
    }

    const pushSenhaHashCadastro = sessionStorage.getItem("pushSenhaHashCadastro");

    if (
        pushSenhaHashCadastro &&
        typeof window.criarSessaoPush === "function"
    ) {
        await window.criarSessaoPush(emailCadastrado, pushSenhaHashCadastro);
    }

    sessionStorage.removeItem("emailCadastro");
    sessionStorage.removeItem("pushSenhaHashCadastro");

    await salvarSessaoNoCache({
        email: emailCadastrado,
        usuario: usuarioInput,
        foto_url: urlFotoPublica || "",
        cor: corFinal
    });

    atualizarFotoAbaVoce();
    mostrarAppPrincipal();
}

async function conectarConta() {
    const email = document.getElementById("login-email").value.trim();
    const senha = document.getElementById("login-senha").value;

    if (email === "" || senha === "") {
        alert("Preencha o e-mail e a senha.");
        return;
    }

    const { data: conta, error } = await _supabase
        .from("usuarios")
        .select("*")
        .eq("email", email)
        .maybeSingle();

    if (error || !conta) {
        alert("Conta não encontrada.");
        return;
    }

    const senhaHash = await gerarHash(email + senha);

    if (senhaHash === conta.senha) {
        localStorage.setItem("usuarioLogado", conta.email);

        if (conta.usuario) {
            localStorage.setItem("nomeUsuario", conta.usuario);
        }

        if (conta.foto_url) {
            localStorage.setItem("fotoUsuario", conta.foto_url);
        } else {
            localStorage.removeItem("fotoUsuario");
        }

        if (conta.cor) {
            localStorage.setItem("corUsuario", conta.cor);
        } else {
            localStorage.removeItem("corUsuario");
        }

        if (typeof window.criarSessaoPush === "function") {
            await window.criarSessaoPush(conta.email, senhaHash);
        }

        await salvarSessaoNoCache(conta);

        atualizarFotoAbaVoce();
        mostrarAppPrincipal();

    } else {
        alert("E-mail ou senha incorretos.");
    }
}
// ==========================================
// GERENCIAMENTO DE CONTATOS
// ==========================================
function ordenarConversasPorRecencia(lista) {
    return [...(lista || [])].sort((a, b) => {
        const dataA = a?.ultimaMsgEm ? new Date(a.ultimaMsgEm).getTime() : 0;
        const dataB = b?.ultimaMsgEm ? new Date(b.ultimaMsgEm).getTime() : 0;

        if (dataA !== dataB) return dataB - dataA;

        const nomeA = String(a?.usuario || a?.nome || "");
        const nomeB = String(b?.usuario || b?.nome || "");
        return nomeA.localeCompare(nomeB, "pt-BR");
    });
}

async function salvarHomeConversasNoCache() {
    const meuEmail = localStorage.getItem("usuarioLogado");
    const cache = window.WhatisCache || null;

    if (!meuEmail || !cache?.salvarListaConversas) return;

    try {
        await cache.salvarListaConversas(meuEmail, todosContatos || []);
    } catch (e) {
        console.warn("Não foi possível atualizar o cache da home:", e);
    }
}

async function limparNaoLidasNaHome(tipo, identificador) {
    let mudou = false;

    todosContatos = (todosContatos || []).map(item => {
        const mesmoTipo = item?.tipo === tipo;
        const mesmoId = String(item?.identificador ?? item?.id ?? "") === String(identificador ?? "");

        if (mesmoTipo && mesmoId && Number(item.naoLidas || 0) > 0) {
            mudou = true;
            return { ...item, naoLidas: 0 };
        }

        return item;
    });

    if (!mudou) return;

    todosContatos = ordenarConversasPorRecencia(todosContatos);
    renderizarContatos(todosContatos);
    await salvarHomeConversasNoCache();
}

async function carregarListaContatos() {
    const meuEmail = localStorage.getItem("usuarioLogado");
    const meuUsuario = localStorage.getItem("nomeUsuario");
    const cache = window.WhatisCache || null;

    if (!meuEmail) return;

    // 1. Mostra a lista local primeiro. Assim a home continua útil sem internet.
    let listaCache = [];

    if (cache?.obterListaConversas) {
        try {
            listaCache = await cache.obterListaConversas(meuEmail);
        } catch (e) {
            console.warn("Erro ao ler conversas do cache:", e);
        }
    }

    if (listaCache.length) {
        todosContatos = ordenarConversasPorRecencia(listaCache);
        renderizarContatos(todosContatos);
    }

    // Sem internet, para aqui mantendo a lista salva na tela.
    if (!navigator.onLine || !_supabase || !meuUsuario) {
        if (!listaCache.length) {
            const container = document.getElementById("lista-contatos");
            if (container) {
                container.innerHTML = `
                    <li style="color:#888;text-align:center;margin-top:20px;font-family:sans-serif;">
                        Nenhuma conversa salva neste aparelho.
                    </li>
                `;
            }
        }
        return;
    }

    try {
        // 2. Busca os contatos individuais.
        const { data: relacaoContatos, error: erroContatos } = await _supabase
            .from("contatos")
            .select("contato_usuario")
            .eq("usuario_origem", meuUsuario);

        if (erroContatos) throw erroContatos;

        const nomesSalvos = relacaoContatos
            ? relacaoContatos.map(item => item.contato_usuario).filter(Boolean)
            : [];

        let usuarios = [];

        if (nomesSalvos.length > 0) {
            const { data: dadosUsuarios, error: erroUsuarios } = await _supabase
                .from("usuarios")
                .select("email, usuario, foto_url, cor")
                .in("usuario", nomesSalvos);

            if (erroUsuarios) throw erroUsuarios;
            usuarios = dadosUsuarios || [];
        }

        const contatosComMensagens = await Promise.all(
            usuarios.map(async (contato) => {
                let ultimaMsg = null;
                let naoLidas = 0;

                try {
                    const [resultadoUltima, resultadoNaoLidas] = await Promise.all([
                        _supabase
                            .from("mensagens")
                            .select("texto, tipo, audio_url, audio_duracao, created_at")
                            .or(`and(remetente_email.eq.${meuEmail},destinatario_email.eq.${contato.email}),and(remetente_email.eq.${contato.email},destinatario_email.eq.${meuEmail})`)
                            .is("grupo_id", null)
                            .order("created_at", { ascending: false })
                            .limit(1),
                        _supabase
                            .from("mensagens")
                            .select("id", { count: "exact", head: true })
                            .eq("remetente_email", contato.email)
                            .eq("destinatario_email", meuEmail)
                            .is("grupo_id", null)
                            .eq("visualizada", false)
                    ]);

                    ultimaMsg = resultadoUltima.data?.[0] || null;
                    naoLidas = Number(resultadoNaoLidas.count || 0);
                } catch (e) {
                    console.warn("Falha ao buscar resumo do contato:", contato.email, e);
                }

                // Se a consulta da prévia falhar, tenta o histórico local.
                if (!ultimaMsg && cache) {
                    const local = await cache.ultimaMensagem(
                        cache.conversaPrivada(contato.email)
                    );

                    if (local) ultimaMsg = local;
                }

                return {
                    ...contato,
                    tipo: "contato",
                    identificador: contato.email,
                    ultimaMsg: ultimaMsg
                        ? (typeof window.formatarPreviewMensagem === "function"
                            ? window.formatarPreviewMensagem(ultimaMsg)
                            : ultimaMsg.texto)
                        : "Nenhuma mensagem ainda",
                    ultimaMsgEm: ultimaMsg?.created_at || null,
                    horaUltimaMsg: ultimaMsg?.created_at
                        ? formatarHora(ultimaMsg.created_at)
                        : "",
                    naoLidas
                };
            })
        );

        // 3. Busca grupos e também a última leitura deste usuário em cada grupo.
        const { data: relacaoGrupos, error: erroRelacaoGrupos } = await _supabase
            .from("grupo_membros")
            .select("grupo_id, ultima_leitura")
            .eq("usuario_nome", meuUsuario);

        if (erroRelacaoGrupos) throw erroRelacaoGrupos;

        const idsGrupos = relacaoGrupos
            ? relacaoGrupos.map(g => g.grupo_id).filter(id => id !== null && id !== undefined)
            : [];

        const leituraPorGrupo = new Map(
            (relacaoGrupos || []).map(item => [
                String(item.grupo_id),
                item.ultima_leitura || null
            ])
        );

        let meusGrupos = [];

        if (idsGrupos.length > 0) {
            const { data: dadosGrupos, error: erroGrupos } = await _supabase
                .from("grupos")
                .select("id, nome, foto_url")
                .in("id", idsGrupos);

            if (erroGrupos) throw erroGrupos;
            meusGrupos = dadosGrupos || [];
        }

        const gruposFormatados = await Promise.all(
            meusGrupos.map(async grupo => {
                let ultimaMsg = null;
                let naoLidas = 0;
                const ultimaLeitura = leituraPorGrupo.get(String(grupo.id));

                try {
                    const consultaNaoLidas = _supabase
                        .from("mensagens")
                        .select("id", { count: "exact", head: true })
                        .eq("grupo_id", grupo.id)
                        .neq("remetente_email", meuEmail);

                    if (ultimaLeitura) {
                        consultaNaoLidas.gt("created_at", ultimaLeitura);
                    }

                    const [resultadoUltima, resultadoNaoLidas] = await Promise.all([
                        _supabase
                            .from("mensagens")
                            .select("texto, tipo, audio_url, audio_duracao, created_at, remetente_email")
                            .eq("grupo_id", grupo.id)
                            .order("created_at", { ascending: false })
                            .limit(1),
                        consultaNaoLidas
                    ]);

                    ultimaMsg = resultadoUltima.data?.[0] || null;
                    naoLidas = Number(resultadoNaoLidas.count || 0);
                } catch (e) {
                    console.warn("Falha ao buscar resumo do grupo:", grupo.id, e);
                }

                // Cache é fallback; a ordem online vem da mensagem real mais recente do servidor.
                if (!ultimaMsg && cache) {
                    ultimaMsg = await cache.ultimaMensagem(
                        cache.conversaGrupo(grupo.id)
                    );
                }

                return {
                    ...grupo,
                    tipo: "grupo",
                    identificador: grupo.id,
                    usuario: grupo.nome,
                    foto_url: grupo.foto_url || "svg/group-placeholder.svg",
                    ultimaMsg: ultimaMsg
                        ? (typeof window.formatarPreviewMensagem === "function"
                            ? window.formatarPreviewMensagem(ultimaMsg)
                            : ultimaMsg.texto)
                        : "Toque para ver o grupo",
                    ultimaMsgEm: ultimaMsg?.created_at || null,
                    horaUltimaMsg: ultimaMsg?.created_at
                        ? formatarHora(ultimaMsg.created_at)
                        : "",
                    naoLidas
                };
            })
        );

        const listaAtualizada = ordenarConversasPorRecencia([
            ...contatosComMensagens,
            ...gruposFormatados
        ]);

        todosContatos = listaAtualizada;
        renderizarContatos(todosContatos);

        // 4. Persiste a home inteira para a próxima abertura offline.
        if (cache?.salvarListaConversas) {
            await cache.salvarListaConversas(meuEmail, listaAtualizada);
        }
    } catch (erro) {
        console.warn("Falha ao atualizar conversas online. Mantendo cache local.", erro);

        if (!listaCache.length) {
            const container = document.getElementById("lista-contatos");
            if (container) {
                container.innerHTML = `
                    <li style="color:#888;text-align:center;margin-top:20px;font-family:sans-serif;">
                        Não foi possível carregar as conversas agora.
                    </li>
                `;
            }
        }
    }
}

function renderizarContatos(lista) {
    const container = document.getElementById("lista-contatos");
    if (!container) return;

    container.innerHTML = "";

    const listaOrdenada = ordenarConversasPorRecencia(lista);

    if (listaOrdenada.length === 0) {
        container.innerHTML = `
            <li style="color: #888; text-align: center; margin-top: 20px; font-family: sans-serif;">
                Nenhum contato ou grupo encontrado.
            </li>
        `;
        return;
    }

    listaOrdenada.forEach(item => {
        const li = document.createElement("li");
        li.classList.add("item-contato");

        const foto = item.foto_url || "";
        const nome = item.usuario || item.nome;
        const naoLidas = Math.max(0, Number(item.naoLidas || 0));
        const textoBadge = naoLidas > 99 ? "99+" : String(naoLidas);

        li.classList.toggle("tem-nao-lidas", naoLidas > 0);

        li.innerHTML = `
            <img src="" class="foto-contato" alt="">
            <div class="info-contato">
                <div class="info-contato-topo">
                    <span class="nome-contato">${nome} ${item.tipo === "grupo" ? " " : ""}</span>
                    <span class="hora-contato">${item.horaUltimaMsg || ""}</span>
                </div>
                <div class="info-contato-rodape">
                    <span class="ultima-msg">${item.ultimaMsg}</span>
                    ${naoLidas > 0
                        ? `<span class="badge-nao-lidas" aria-label="${naoLidas} mensagem${naoLidas === 1 ? "" : "s"} não lida${naoLidas === 1 ? "" : "s"}">${textoBadge}</span>`
                        : ""}
                </div>
            </div>
        `;

        const avatarLista = li.querySelector(".foto-contato");
        if (item.tipo === "grupo") {
            if (avatarLista) avatarLista.src = item.foto_url || "svg/user-placeholder.svg";
        } else {
            aplicarAvatarUsuario(avatarLista, foto, item.cor);
        }

        // Ao clicar, verifica se é um grupo ou um chat normal.
        li.onclick = () => {
            if (item.tipo === "grupo") {
                abrirChatGrupo(item.id, item.nome, item.foto_url || "svg/user-placeholder.svg");
            } else {
                abrirChatCom(item.identificador, nome, foto, item.cor);
            }
        };

        container.appendChild(li);
    });
}

async function adicionarNovoContato(nomeUsuarioAdicionar) {
    const meuUsuario = localStorage.getItem("nomeUsuario");

    if (!nomeUsuarioAdicionar || nomeUsuarioAdicionar === meuUsuario) {
        alert("Digite um nome de usuário válido diferente do seu.");
        return;
    }

    const { data: usuarioExiste } = await _supabase
        .from("usuarios")
        .select("usuario")
        .eq("usuario", nomeUsuarioAdicionar)
        .maybeSingle();

    if (!usuarioExiste) {
        alert("Usuário não encontrado.");
        return;
    }

    const { error } = await _supabase
        .from("contatos")
        .insert([{
            usuario_origem: meuUsuario,
            contato_usuario: nomeUsuarioAdicionar
        }]);

    if (error) {
        alert("Este usuário já está na sua lista ou ocorreu um erro.");
        return;
    }

    alert("Contato adicionado com sucesso!");
    carregarListaContatos();
}

async function pedirEmailContato() {
    const userDestino = prompt("Digite o nome de usuário de quem deseja conversar:");

    if (!userDestino) return;

    const meuUser = localStorage.getItem("nomeUsuario");

    if (userDestino.trim().toLowerCase() === meuUser.trim().toLowerCase()) {
        alert("Você não pode enviar uma solicitação para si mesmo.");
        return;
    }

    const { data: usuarioExiste, error: errUsuario } = await _supabase
        .from('usuarios')
        .select('usuario')
        .eq('usuario', userDestino.trim())
        .maybeSingle();

    if (errUsuario || !usuarioExiste) {
        alert("Usuário não encontrado!");
        return;
    }

    const { data: solicitacaoExistente } = await _supabase
        .from('solicitacoes_chat')
        .select('id, status')
        .eq('remetente_email', meuUser)
        .eq('destinatario_email', userDestino.trim())
        .maybeSingle();

    if (solicitacaoExistente) {
        alert(`Você já enviou uma solicitação para este usuário.`);
        return;
    }

    const { error: errInserir } = await _supabase
        .from('solicitacoes_chat')
        .insert([
            {
                remetente_email: meuUser,
                destinatario_email: userDestino.trim(),
                status: 'pendente'
            }
        ]);

    if (errInserir) {
        console.error("Erro ao enviar solicitação:", errInserir);
        alert("Erro ao enviar: " + errInserir.message);
    } else {
        alert("Solicitação enviada com sucesso!");
    }

}

function filtrarContatos() {
    const termo = document.getElementById("input-pesquisa").value.toLowerCase();

    const filtrados = todosContatos.filter(c => {
        const nome = (c.usuario || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        return nome.includes(termo) || email.includes(termo);
    });

    renderizarContatos(filtrados);
}
// ==========================================
// CHAT E MENSAGENS TEMPO REAL
// ==========================================
async function obterNomeContato(email) {
    if (!email || !_supabase) return null;

    const { data, error } = await _supabase
        .from("usuarios")
        .select("usuario")
        .eq("email", email)
        .maybeSingle();

    if (error) {
        console.error("Erro ao buscar nome do contato:", error);
        return null;
    }

    return data?.usuario || null;
}

const cacheUsuariosMensagem = new Map();

async function obterUsuarioMensagem(email) {
    const chave = (email || "").trim().toLowerCase();
    if (!chave) return null;

    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim().toLowerCase();
    if (chave === meuEmail) {
        return {
            usuario: localStorage.getItem("nomeUsuario") || "Você",
            email,
            cor: localStorage.getItem("corUsuario") || "#888888",
            foto_url: localStorage.getItem("fotoUsuario") || ""
        };
    }

    if (cacheUsuariosMensagem.has(chave)) {
        return cacheUsuariosMensagem.get(chave);
    }

    const { data, error } = await _supabase
        .from("usuarios")
        .select("usuario, email, cor, foto_url")
        .eq("email", email)
        .maybeSingle();

    if (error) {
        console.error("Erro ao buscar usuário da mensagem:", error);
        return null;
    }

    if (data) cacheUsuariosMensagem.set(chave, data);
    return data || null;
}

async function renderizarBalao(texto, ehMinha, dataCriacao, idMensagem, mensagemRespondida, corRemetente, visualizada = false) {
    const container = document.getElementById("chat-mensagens");
    if (!container) return;

    const balao = document.createElement("div");
    balao.classList.add("balao-msg");
    if (idMensagem !== null && idMensagem !== undefined) {
        balao.dataset.messageId = String(idMensagem);
    }
    balao.classList.add(ehMinha ? "balao-enviada" : "balao-recebida");

    const temResposta = !!(mensagemRespondida && mensagemRespondida.texto);
    const temMidia = !!(texto && (texto.startsWith("[FOTO]:") || texto.startsWith("[VIDEO]:")));

    if (temResposta) balao.classList.add("balao-com-resposta");
    if (temMidia) balao.classList.add("balao-com-midia");

    const horaFormatada = formatarHora(dataCriacao || new Date());

    let conteudoHtml = "";
    let htmlResposta = "";

    if (mensagemRespondida && mensagemRespondida.texto) {
        let textoCitado = mensagemRespondida.texto;
        if (textoCitado.startsWith("[FOTO]:")) textoCitado = "📷 Foto";
        if (textoCitado.startsWith("[VIDEO]:")) textoCitado = "🎥 Vídeo";
        if (textoCitado.startsWith("[AUDIO]:")) textoCitado = "🎤 Áudio";

        let corCitado = "#888888";
        let nomeCitadoOriginal = "Respondendo a...";

        if (mensagemRespondida.remetente_email) {
            const emailOriginal = mensagemRespondida.remetente_email;

            if (emailOriginal === localStorage.getItem("usuarioLogado")) {
                nomeCitadoOriginal = "Você";
                corCitado = localStorage.getItem("corUsuario") || "#888888";
            } else {
                const usuarioOriginal = await obterUsuarioMensagem(emailOriginal);

                nomeCitadoOriginal = usuarioOriginal?.usuario || emailOriginal;
                corCitado = usuarioOriginal?.cor || "#888888";
            }
        }

        htmlResposta = `
            <div class="citacao-resposta" style="--cor-citacao: ${corCitado};">
                <strong class="citacao-nome">${nomeCitadoOriginal}</strong>
                <span class="citacao-texto">${textoCitado}</span>
            </div>
        `;
    }

    if (texto && texto.startsWith("[FOTO]:")) {
        const urlImagem = texto.replace("[FOTO]:", "").trim();
        conteudoHtml = `<img class="balao-midia balao-foto" src="${urlImagem}" onclick="window.open('${urlImagem}', '_blank')">`;
    } else if (texto && texto.startsWith("[VIDEO]:")) {
        const urlVideo = texto.replace("[VIDEO]:", "").trim();
        conteudoHtml = `<video class="balao-midia balao-video" src="${urlVideo}" controls preload="metadata"></video>`;
    } else {
        conteudoHtml = `<span class="balao-texto">${texto}</span>`;
    }

    balao.innerHTML = `
        ${htmlResposta}
        <div class="balao-linha">
            <div class="balao-conteudo">${conteudoHtml}</div>
            <span class="balao-meta">
                <span class="balao-hora">${horaFormatada}</span>
                ${ehMinha ? `
                    <span class="balao-visto ${visualizada ? 'visualizada' : ''}"
                          aria-label="${visualizada ? 'Visualizada' : 'Enviada'}">
                        <span class="balao-visto-check">✓</span>
                        <span class="balao-visto-check">✓</span>
                    </span>
                ` : ''}
            </span>
        </div>
    `;

    balao.addEventListener("dblclick", () => {
        iniciarResposta(
            idMensagem || null,
            ehMinha ? "Você" : (document.getElementById("chat-nome-usuario")?.innerText || destinatarioAtual || "Contato"),
            texto
        );
    });

    adicionarGestoArrastar(
        balao,
        idMensagem,
        ehMinha ? "Você" : (document.getElementById("chat-nome-usuario")?.innerText || destinatarioAtual || "Contato"),
        texto
    );

    container.appendChild(balao);
    container.scrollTop = container.scrollHeight;
}
// Adicionado o parâmetro 'idMensagem' aqui também
async function renderizarBalaoGrupo(texto, ehMinha, dataCriacao, nomeRemetente, corRemetente, idMensagem, mensagemRespondida) {
    const container = document.getElementById("chat-mensagens");
    if (!container) return;

    const balao = document.createElement("div");
    balao.classList.add("balao-msg");
    if (idMensagem !== null && idMensagem !== undefined) {
        balao.dataset.messageId = String(idMensagem);
    }
    balao.classList.add(ehMinha ? "balao-enviada" : "balao-recebida");

    const temResposta = !!(mensagemRespondida && mensagemRespondida.texto);
    const temMidia = !!(texto && (texto.startsWith("[FOTO]:") || texto.startsWith("[VIDEO]:")));

    if (temResposta) balao.classList.add("balao-com-resposta");
    if (temMidia) balao.classList.add("balao-com-midia");

    const horaFormatada = formatarHora(dataCriacao || new Date());

    let htmlNome = "";
    if (!ehMinha && nomeRemetente) {
        const corNome = corRemetente || "#ff7b00";
        htmlNome = `<span class="nome-remetente" style="color:${corNome}">${nomeRemetente}</span>`;
    }

    let htmlResposta = "";
    if (mensagemRespondida && mensagemRespondida.texto) {
        let textoCitado = mensagemRespondida.texto;
        if (textoCitado.startsWith("[FOTO]:")) textoCitado = "📷 Foto";
        if (textoCitado.startsWith("[VIDEO]:")) textoCitado = "🎥 Vídeo";
        if (textoCitado.startsWith("[AUDIO]:")) textoCitado = "🎤 Áudio";

        let corCitado = "#888888";
        let nomeCitadoOriginal = "Respondendo a...";

        if (mensagemRespondida.remetente_email) {
            const emailOriginal = mensagemRespondida.remetente_email;

            if (emailOriginal === localStorage.getItem("usuarioLogado")) {
                nomeCitadoOriginal = "Você";
                corCitado = localStorage.getItem("corUsuario") || "#888888";
            } else {
                const usuarioOriginal = await obterUsuarioMensagem(emailOriginal);

                nomeCitadoOriginal = usuarioOriginal?.usuario || emailOriginal;
                corCitado = usuarioOriginal?.cor || "#888888";
            }
        }

        htmlResposta = `
            <div class="citacao-resposta" style="--cor-citacao: ${corCitado};">
                <strong class="citacao-nome">${nomeCitadoOriginal}</strong>
                <span class="citacao-texto">${textoCitado}</span>
            </div>
        `;
    }

    let conteudoHtml = `<span class="balao-texto">${texto}</span>`;

    if (texto && texto.startsWith("[FOTO]:")) {
        const urlImagem = texto.replace("[FOTO]:", "").trim();
        conteudoHtml = `<img class="balao-midia balao-foto" src="${urlImagem}" onclick="window.open('${urlImagem}', '_blank')">`;
    } else if (texto && texto.startsWith("[VIDEO]:")) {
        const urlVideo = texto.replace("[VIDEO]:", "").trim();
        conteudoHtml = `<video class="balao-midia balao-video" src="${urlVideo}" controls preload="metadata"></video>`;
    }

    balao.innerHTML = `
        ${htmlNome}
        ${htmlResposta}
        <div class="balao-linha">
            <div class="balao-conteudo">${conteudoHtml}</div>
            <span class="balao-meta">
                <span class="balao-hora">${horaFormatada}</span>
                ${ehMinha ? '<span class="balao-visto" aria-label="Enviada">✓</span>' : ''}
            </span>
        </div>
    `;

    balao.addEventListener("dblclick", () => {
        iniciarResposta(
            idMensagem || null,
            ehMinha ? "Você" : (nomeRemetente || "Participante"),
            texto
        );
    });

    adicionarGestoArrastar(
        balao,
        idMensagem,
        ehMinha ? "Você" : (nomeRemetente || "Participante"),
        texto
    );

    container.appendChild(balao);
    container.scrollTop = container.scrollHeight;
}

function acionarSeletorFotoChat() {
    const input = document.getElementById('input-arquivo-chat');
    if (input) {
        input.click();
    } else {
        console.error("Elemento 'input-arquivo-chat' não encontrado no HTML.");
    }
}

function iniciarResposta(idMensagem, nomeRemetente, textoMensagem) {
    mensagemRespondendoId = idMensagem;

    const painel = document.getElementById("painel-resposta");
    const nomeEl = document.getElementById("resposta-nome-usuario");
    const textoEl = document.getElementById("resposta-texto-preview");
    const input = document.getElementById("input-mensagem");

    if (painel && nomeEl && textoEl) {
        nomeEl.textContent = nomeRemetente || "Contato";

        if (textoMensagem.startsWith("[FOTO]:") || textoMensagem.startsWith("[MIDIA_IMAGEM]")) {
            textoEl.textContent = "📷 Foto";
        } else if (textoMensagem.startsWith("[VIDEO]:") || textoMensagem.startsWith("[MIDIA_VIDEO]")) {
            textoEl.textContent = "🎥 Vídeo";
        } else if (textoMensagem.startsWith("[AUDIO]:")) {
            textoEl.textContent = "🎤 Áudio";
        } else {
            textoEl.textContent = textoMensagem;
        }

        painel.style.display = "flex";
    }

    if (input) {
        input.placeholder = "Respondendo mensagem";
        input.focus();
    }
}

function cancelarResposta() {
    mensagemRespondendoId = null;

    const painel = document.getElementById("painel-resposta");
    const input = document.getElementById("input-mensagem");

    if (painel) painel.style.display = "none";
    if (input) input.placeholder = "";
}

async function enviarMidia(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    const meuEmail = localStorage.getItem("usuarioLogado");
    const nomeArquivo = `${Date.now()}_${arquivo.name}`;

    // 1. Faz o upload para o Storage do Supabase (ex: bucket "midias")
    const { data, error } = await _supabase.storage
        .from("midias") 
        .upload(nomeArquivo, arquivo);

    if (error) {
        console.error("Erro no upload:", error.message);
        alert("Erro ao enviar arquivo.");
        return;
    }

    // 2. Pega a URL pública do arquivo enviado
    const { data: urlData } = _supabase.storage
        .from("midias")
        .getPublicUrl(nomeArquivo);

    const urlPublica = urlData.publicUrl;
    
    // Verifica se é vídeo pelo tipo do arquivo
    const ehVideo = arquivo.type.startsWith("video/");
    
    // Opcional: Você pode salvar uma marcação no texto ou usar uma coluna separada, 
    // por exemplo, salvando um JSON ou identificador, ou simplesmente mandando a URL.
    // Vamos enviar a URL e formatar na hora de exibir.
    const textoMensagem = `[${ehVideo ? 'VIDEO' : 'IMAGEM'}]: ${urlPublica}`;

    // 3. Salva a mensagem no banco de dados (tabela mensagens)
    const dadosMensagem = {
        texto: textoMensagem,
        remetente_email: meuEmail,
        grupo_id: window.grupoAtualId ? window.grupoAtualId : null,
        destinatario_email: window.grupoAtualId ? null : destinatarioAtual
    };

    await _supabase.from("mensagens").insert([dadosMensagem]);

    // Recarrega o chat
    if (window.grupoAtualId) {
        carregarMensagensGrupo(window.grupoAtualId);
    } else {
        carregarMensagens();
    }
}
async function enviarFotoChat(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    const meuEmail = localStorage.getItem("usuarioLogado");
    const nomeArquivo = `${Date.now()}_${arquivo.name}`;

    // Faz o upload para o Supabase Storage (certifique-se de que o bucket aceita vídeos)
    const { data, error } = await _supabase.storage
        .from("midias") // ou o nome do seu bucket
        .upload(nomeArquivo, arquivo);

    if (error) {
        console.error("Erro no upload:", error.message);
        alert("Erro ao enviar arquivo.");
        return;
    }

    const { data: urlData } = _supabase.storage
        .from("midias")
        .getPublicUrl(nomeArquivo);

    const urlPublica = urlData.publicUrl;
    
    // VERIFICA SE É VÍDEO OU IMAGEM E DEFINE O PREFIXO CORRETO
    const ehVideo = arquivo.type.startsWith("video/");
    const prefixo = ehVideo ? "[VIDEO]:" : "[FOTO]:";
    const textoMensagem = `${prefixo} ${urlPublica}`;

    const dadosMensagem = {
        texto: textoMensagem,
        remetente_email: meuEmail,
        grupo_id: window.grupoAtualId ? window.grupoAtualId : null,
        destinatario_email: window.grupoAtualId ? null : destinatarioAtual
    };

    await _supabase.from("mensagens").insert([dadosMensagem]);

    // Limpa o input para permitir novos envios
    event.target.value = "";

    // Recarrega o chat
    if (window.grupoAtualId) {
        carregarMensagensGrupo(window.grupoAtualId);
    } else if (typeof carregarMensagens === 'function') {
        carregarMensagens();
    }
}

async function renderizarMensagensPrivadasDoCache(mensagens, chaveConversa, limparTudo) {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim().toLowerCase();
    const contatoAtual = (destinatarioAtual || "").trim().toLowerCase();
    const container = document.getElementById("chat-mensagens");

    if (!container || !contatoAtual) return;

    if (limparTudo) {
        container.innerHTML = "";
        container.dataset.cacheConversa = chaveConversa;
    }

    const mapa = new Map((mensagens || []).map(msg => [String(msg.id), msg]));

    for (const msg of (mensagens || [])) {
        if ((destinatarioAtual || "").trim().toLowerCase() !== contatoAtual) break;

        if (msg.id !== null && msg.id !== undefined) {
            const existente = container.querySelector(`.balao-msg[data-message-id="${String(msg.id)}"]`);
            if (existente) continue;
        }

        let dadosRespondida = null;

        if (msg.mensagem_respondida_id) {
            dadosRespondida = mapa.get(String(msg.mensagem_respondida_id)) || null;

            if (!dadosRespondida && window.WhatisCache) {
                dadosRespondida = await window.WhatisCache.mensagemPorId(
                    chaveConversa,
                    msg.mensagem_respondida_id
                );
            }
        }

        const ehMinha = (msg.remetente_email || "").trim().toLowerCase() === meuEmail;

        if (
            typeof window.ehMensagemChamada === "function" &&
            window.ehMensagemChamada(msg) &&
            typeof window.renderizarBalaoChamada === "function"
        ) {
            await window.renderizarBalaoChamada(msg, ehMinha);
        } else if (
            typeof window.ehMensagemAudio === "function" &&
            window.ehMensagemAudio(msg) &&
            typeof window.renderizarBalaoAudio === "function"
        ) {
            await window.renderizarBalaoAudio(msg, ehMinha, {
                mensagemRespondida: dadosRespondida
            });
        } else {
            await renderizarBalao(
                msg.texto,
                ehMinha,
                msg.created_at,
                msg.id,
                dadosRespondida,
                null,
                msg.visualizada === true
            );
        }
    }
}

function atualizarIndicadorVisualizacao(idMensagem, visualizada) {
    if (idMensagem === null || idMensagem === undefined) return;

    const balao = document.querySelector(
        `#chat-mensagens .balao-msg[data-message-id="${String(idMensagem)}"]`
    );

    const indicador = balao?.querySelector(".balao-visto");
    if (!indicador) return;

    indicador.classList.toggle("visualizada", visualizada === true);
    indicador.setAttribute(
        "aria-label",
        visualizada === true ? "Visualizada" : "Enviada"
    );
}

async function sincronizarVisualizacoesDoChat(emailContato, chaveConversa) {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim();
    if (!meuEmail || !emailContato || !_supabase) return;

    const { data, error } = await _supabase
        .from("mensagens")
        .select("id")
        .eq("remetente_email", meuEmail)
        .eq("destinatario_email", emailContato)
        .is("grupo_id", null)
        .eq("visualizada", true);

    if (error) {
        console.warn("Erro ao sincronizar visualizações:", error.message);
        return;
    }

    const ids = (data || []).map(item => item.id);

    ids.forEach(id => atualizarIndicadorVisualizacao(id, true));

    if (ids.length && window.WhatisCache?.atualizarMensagensPorIds) {
        await window.WhatisCache.atualizarMensagensPorIds(
            chaveConversa,
            ids,
            { visualizada: true }
        );
    }
}

async function marcarMensagensComoVisualizadas(emailContato, chaveConversa) {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim();
    const telaChat = document.getElementById("tela-chat");

    if (!meuEmail || !emailContato) return;
    if (document.visibilityState !== "visible") return;
    if (!telaChat?.classList.contains("ativa")) return;

    if (typeof window.marcarMensagensVistasServidor !== "function") {
        console.warn("Sistema de visualização ainda não está disponível.");
        return;
    }

    const resultado = await window.marcarMensagensVistasServidor(emailContato);

    if (!resultado?.ok) return;

    const atualizadas = resultado.mensagens || [];

    if (atualizadas.length && window.WhatisCache) {
        await window.WhatisCache.salvarMensagens(chaveConversa, atualizadas);
    }

    // O chat aberto já foi lido: some com a bolinha da home imediatamente.
    await limparNaoLidasNaHome("contato", emailContato);
}

async function carregarMensagens() {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim();
    const emailContato = (destinatarioAtual || "").trim();

    if (!meuEmail || !emailContato) return;

    const container = document.getElementById("chat-mensagens");
    if (!container) return;

    const cache = window.WhatisCache || null;
    const chaveConversa = cache
        ? cache.conversaPrivada(emailContato)
        : `privado|${meuEmail.toLowerCase()}|${emailContato.toLowerCase()}`;

    const mudouConversa = container.dataset.cacheConversa !== chaveConversa;

    let mensagensCache = [];

    if (cache) {
        mensagensCache = await cache.listarMensagens(chaveConversa);

        // Usuário pode ter trocado de chat enquanto o IndexedDB respondia.
        if ((destinatarioAtual || "").trim() !== emailContato) return;

        if (mensagensCache.length) {
            await renderizarMensagensPrivadasDoCache(
                mensagensCache,
                chaveConversa,
                mudouConversa
            );
        } else if (mudouConversa) {
            container.innerHTML = "";
            container.dataset.cacheConversa = chaveConversa;
        }
    } else if (mudouConversa) {
        container.innerHTML = "";
        container.dataset.cacheConversa = chaveConversa;
    }

    let consulta = _supabase
        .from("mensagens")
        .select("*")
        .or(`and(remetente_email.eq.${meuEmail},destinatario_email.eq.${emailContato}),and(remetente_email.eq.${emailContato},destinatario_email.eq.${meuEmail})`)
        .order("created_at", { ascending: true });

    // Se já há histórico local, busca só o trecho mais recente.
    // "gte" repete no máximo a última mensagem e o dedupe por ID remove a duplicata.
    const ultimaCache = mensagensCache.length
        ? mensagensCache[mensagensCache.length - 1]
        : null;

    if (ultimaCache?.created_at) {
        consulta = consulta.gte("created_at", ultimaCache.created_at);
    }

    const { data: novasMensagens, error } = await consulta;

    if (error) {
        console.error("Erro ao sincronizar mensagens:", error.message);
        return; // O histórico em cache continua visível.
    }

    if ((destinatarioAtual || "").trim() !== emailContato) return;

    const recebidas = novasMensagens || [];

    if (cache && recebidas.length) {
        await cache.salvarMensagens(chaveConversa, recebidas);
    }

    const idsCache = new Set(mensagensCache.map(msg => String(msg.id)));
    const apenasNovas = ultimaCache
        ? recebidas.filter(msg => !idsCache.has(String(msg.id)))
        : recebidas;

    if (!mensagensCache.length) {
        // Primeira carga neste aparelho: renderiza o histórico vindo da rede uma vez.
        if (recebidas.length) {
            await renderizarMensagensPrivadasDoCache(recebidas, chaveConversa, true);
        }
    } else if (apenasNovas.length) {
        const combinadas = mensagensCache.concat(apenasNovas);
        await renderizarMensagensPrivadasDoCache(combinadas, chaveConversa, false);
    }

    await sincronizarVisualizacoesDoChat(emailContato, chaveConversa);
    await marcarMensagensComoVisualizadas(emailContato, chaveConversa);

    container.scrollTop = container.scrollHeight;
}

async function enviarMensagem() {
    const inputMsg = document.getElementById("input-mensagem");
    const texto = inputMsg ? inputMsg.value.trim() : "";
    const meuEmail = localStorage.getItem("usuarioLogado");

    if (!texto) return;

    const dadosMensagem = {
        texto: texto,
        remetente_email: meuEmail,
        grupo_id: window.grupoAtualId ? window.grupoAtualId : null,
        destinatario_email: window.grupoAtualId ? null : destinatarioAtual,
        mensagem_respondida_id: mensagemRespondendoId
    };
    
    console.log("📤 Enviando mensagem com ID de resposta:", mensagemRespondendoId, dadosMensagem);

    const { error } = await _supabase
        .from("mensagens")
        .insert([dadosMensagem]);

    if (error) {
        console.error("Erro ao enviar mensagem:", error.message);
        alert("Erro ao enviar mensagem.");
        return;
    }

    if (inputMsg) inputMsg.value = "";
    cancelarResposta(); 
    
    if (window.grupoAtualId) {
        carregarMensagensGrupo(window.grupoAtualId);
    } else if (typeof carregarMensagens === 'function') {
        carregarMensagens();
    }
}

function checarEnter(event) {
    if (event.key === "Enter") {
        enviarMensagem();
    }
}

async function checarStatusContato(emailContato) {
    const spanStatus = document.getElementById("chat-status-usuario");
    if (!spanStatus) return;

    const { data: usuario } = await _supabase
        .from("usuarios")
        .select("visto_por_ultimo")
        .eq("email", emailContato)
        .maybeSingle();

    if (usuario) {
        const textoStatus = formatarVistoPorUltimo(usuario.visto_por_ultimo);
        spanStatus.innerText = textoStatus;

        if (textoStatus === "online") {
            spanStatus.style.color = "#ff7b00";
        } else {
            spanStatus.style.color = "#8696a0";
        }
    }
}

async function marcarGrupoComoLido(idGrupo, ultimaMensagemEm = null) {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim();
    const meuUsuario = (localStorage.getItem("nomeUsuario") || "").trim();
    const telaChat = document.getElementById("tela-chat");

    if (!idGrupo || !meuEmail) return;
    if (document.visibilityState !== "visible") return;
    if (!telaChat?.classList.contains("ativa")) return;
    if (String(window.grupoAtualId || "") !== String(idGrupo)) return;

    const lidoAte = ultimaMensagemEm || new Date().toISOString();

    // Limpa a interface de imediato, mesmo se estiver temporariamente offline.
    await limparNaoLidasNaHome("grupo", idGrupo);

    if (!_supabase || !navigator.onLine) return;

    try {
        let { data, error } = await _supabase
            .from("grupo_membros")
            .update({ ultima_leitura: lidoAte })
            .eq("grupo_id", idGrupo)
            .eq("usuario_email", meuEmail)
            .select("id");

        // Compatibilidade com membros antigos cadastrados pelo nome.
        if ((error || !data?.length) && meuUsuario) {
            const fallback = await _supabase
                .from("grupo_membros")
                .update({ ultima_leitura: lidoAte })
                .eq("grupo_id", idGrupo)
                .eq("usuario_nome", meuUsuario)
                .select("id");

            error = fallback.error;
            data = fallback.data;
        }

        if (error) {
            console.warn("Não foi possível marcar o grupo como lido:", error.message);
        }
    } catch (e) {
        console.warn("Falha ao salvar leitura do grupo:", e);
    }
}

function abrirChatGrupo(idGrupo, nomeGrupo, fotoGrupo) {
    window.grupoAtualId = idGrupo; 
    destinatarioAtual = null; // Zera o chat privado

    const elemNome = document.getElementById("chat-nome-usuario");
    const elemFoto = document.getElementById("chat-foto-usuario");
    const telaChat = document.getElementById("tela-chat");
    const spanStatus = document.getElementById("chat-status-usuario");

    if (elemNome) elemNome.innerText = nomeGrupo;
    if (elemFoto) {
        const fotoGrupoValida = fotoGrupo && !fotoGrupo.includes("user-placeholder.svg");
        if (fotoGrupoValida) {
            elemFoto.src = fotoGrupo;
            elemFoto.style.backgroundColor = "transparent";
            elemFoto.classList.remove("avatar-sem-foto");
            elemFoto.dataset.temFoto = "true";
        } else {
            aplicarAvatarUsuario(elemFoto, "", "#3a3a3c");
        }
    }
    if (spanStatus) spanStatus.innerText = "Toque para ver os dados do grupo";
    
    // CORREÇÃO: Adiciona a classe 'ativa' igual ao chat privado para exibir a tela
    if (telaChat) {
        telaChat.style.display = "flex";
        setTimeout(() => {
            telaChat.classList.add("ativa");
        }, 10);
    }

    // Limpa intervalo de status de contato privado anterior
    if (intervaloChecarStatusContato) {
        clearInterval(intervaloChecarStatusContato);
        intervaloChecarStatusContato = null;
    }

    // Carrega o fundo específico deste grupo, se existir.
    if (typeof window.carregarFundoGrupoSalvo === 'function') {
        window.carregarFundoGrupoSalvo(idGrupo);
    } else {
        const containerMensagens = document.getElementById("chat-mensagens");
        if (containerMensagens) containerMensagens.style.backgroundImage = "";
    }

    // CHAMA A FUNÇÃO PARA PUXAR AS MENSAGENS DO GRUPO
    carregarMensagensGrupo(idGrupo);

    const chatInputBox = document.getElementById('chat-input-box');
    const chatActionBar = document.getElementById('chat-action-bar');
    if (chatInputBox) chatInputBox.classList.remove('hidden');
    if (chatActionBar) chatActionBar.classList.add('hidden');
}

async function renderizarMensagensGrupoDoCache(mensagens, idGrupo, chaveConversa, limparTudo) {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim().toLowerCase();
    const container = document.getElementById("chat-mensagens");

    if (!container) return;

    if (limparTudo) {
        container.innerHTML = "";
        container.dataset.cacheConversa = chaveConversa;
    }

    const mapa = new Map((mensagens || []).map(msg => [String(msg.id), msg]));

    for (const msg of (mensagens || [])) {
        if (String(window.grupoAtualId || "") !== String(idGrupo)) break;

        if (msg.id !== null && msg.id !== undefined) {
            const existente = container.querySelector(`.balao-msg[data-message-id="${String(msg.id)}"]`);
            if (existente) continue;
        }

        const emailRemetenteMsg = (msg.remetente_email || "").trim().toLowerCase();
        const ehMinha = emailRemetenteMsg === meuEmail;

        let nomeRemetente = msg.remetente_email;
        let corRemetente = null;
        let fotoRemetente = "";

        if (!ehMinha) {
            const userData = await obterUsuarioMensagem(msg.remetente_email);

            if (userData) {
                nomeRemetente = userData.usuario || userData.email;
                corRemetente = userData.cor || null;
                fotoRemetente = userData.foto_url || "";
            }
        } else {
            corRemetente = localStorage.getItem("corUsuario") || null;
            fotoRemetente = localStorage.getItem("fotoUsuario") || "";
        }

        let dadosRespondida = null;

        if (msg.mensagem_respondida_id) {
            dadosRespondida = mapa.get(String(msg.mensagem_respondida_id)) || null;

            if (!dadosRespondida && window.WhatisCache) {
                dadosRespondida = await window.WhatisCache.mensagemPorId(
                    chaveConversa,
                    msg.mensagem_respondida_id
                );
            }
        }

        if (
            typeof window.ehMensagemChamadaGrupo === "function" &&
            window.ehMensagemChamadaGrupo(msg) &&
            typeof window.renderizarBalaoChamadaGrupo === "function"
        ) {
            await window.renderizarBalaoChamadaGrupo(msg, ehMinha, {
                nomeRemetente: ehMinha ? "" : nomeRemetente,
                corRemetente,
                fotoRemetente
            });
        } else if (
            typeof window.ehMensagemAudio === "function" &&
            window.ehMensagemAudio(msg) &&
            typeof window.renderizarBalaoAudio === "function"
        ) {
            await window.renderizarBalaoAudio(msg, ehMinha, {
                nomeRemetente: ehMinha ? "" : nomeRemetente,
                corRemetente,
                fotoRemetente,
                mensagemRespondida: dadosRespondida
            });
        } else {
            await renderizarBalaoGrupo(
                msg.texto,
                ehMinha,
                msg.created_at,
                ehMinha ? null : nomeRemetente,
                corRemetente,
                msg.id,
                dadosRespondida
            );
        }
    }
}

async function carregarMensagensGrupo(idGrupo) {
    const meuEmail = (localStorage.getItem("usuarioLogado") || "").trim().toLowerCase();
    if (!meuEmail || idGrupo === null || idGrupo === undefined) return;

    const containerChat = document.getElementById("chat-mensagens");
    if (!containerChat) return;

    const cache = window.WhatisCache || null;
    const chaveConversa = cache
        ? cache.conversaGrupo(idGrupo)
        : `grupo|${meuEmail}|${String(idGrupo)}`;

    const mudouConversa = containerChat.dataset.cacheConversa !== chaveConversa;

    let mensagensCache = [];

    if (cache) {
        mensagensCache = await cache.listarMensagens(chaveConversa);

        if (String(window.grupoAtualId || "") !== String(idGrupo)) return;

        if (mensagensCache.length) {
            await renderizarMensagensGrupoDoCache(
                mensagensCache,
                idGrupo,
                chaveConversa,
                mudouConversa
            );
        } else if (mudouConversa) {
            containerChat.innerHTML = "";
            containerChat.dataset.cacheConversa = chaveConversa;
        }
    } else if (mudouConversa) {
        containerChat.innerHTML = "";
        containerChat.dataset.cacheConversa = chaveConversa;
    }

    let consulta = _supabase
        .from("mensagens")
        .select("*")
        .eq("grupo_id", idGrupo)
        .order("created_at", { ascending: true });

    const ultimaCache = mensagensCache.length
        ? mensagensCache[mensagensCache.length - 1]
        : null;

    if (ultimaCache?.created_at) {
        consulta = consulta.gte("created_at", ultimaCache.created_at);
    }

    const { data: novasMensagens, error } = await consulta;

    if (error) {
        console.error("Erro ao sincronizar mensagens do grupo:", error.message);
        return;
    }

    if (String(window.grupoAtualId || "") !== String(idGrupo)) return;

    const recebidas = novasMensagens || [];

    if (cache && recebidas.length) {
        await cache.salvarMensagens(chaveConversa, recebidas);
    }

    const idsCache = new Set(mensagensCache.map(msg => String(msg.id)));
    const apenasNovas = ultimaCache
        ? recebidas.filter(msg => !idsCache.has(String(msg.id)))
        : recebidas;

    if (!mensagensCache.length) {
        if (recebidas.length) {
            await renderizarMensagensGrupoDoCache(recebidas, idGrupo, chaveConversa, true);
        }
    } else if (apenasNovas.length) {
        const combinadas = mensagensCache.concat(apenasNovas);
        await renderizarMensagensGrupoDoCache(combinadas, idGrupo, chaveConversa, false);
    }

    const todasConhecidas = mensagensCache.concat(recebidas);
    const ultimaConhecida = todasConhecidas.reduce((maisNova, msg) => {
        if (!msg?.created_at) return maisNova;
        if (!maisNova?.created_at) return msg;
        return new Date(msg.created_at).getTime() > new Date(maisNova.created_at).getTime()
            ? msg
            : maisNova;
    }, null);

    await marcarGrupoComoLido(
        idGrupo,
        ultimaConhecida?.created_at || new Date().toISOString()
    );

    containerChat.scrollTop = containerChat.scrollHeight;
}

function abrirChatCom(emailDestinatario, nomeDestinatario, fotoDestinatario, corDestinatario) {
    destinatarioAtual = emailDestinatario;
    window.grupoAtualId = null;

    const elemNome = document.getElementById("chat-nome-usuario");
    const elemFoto = document.getElementById("chat-foto-usuario");
    const telaChat = document.getElementById("tela-chat");

    if (elemNome) elemNome.innerText = nomeDestinatario || emailDestinatario;
    aplicarAvatarUsuario(elemFoto, fotoDestinatario, corDestinatario);
    
    if (telaChat) {
        telaChat.style.display = "flex";
        setTimeout(() => {
            telaChat.classList.add("ativa");
        }, 10);
    }

    carregarFundoChatSalvo(emailDestinatario);

    const chatInputBox = document.getElementById('chat-input-box');
    const chatActionBar = document.getElementById('chat-action-bar');
    if (chatInputBox) chatInputBox.classList.remove('hidden');
    if (chatActionBar) chatActionBar.classList.add('hidden');

    checarStatusContato(emailDestinatario);

    if (intervaloChecarStatusContato) clearInterval(intervaloChecarStatusContato);

    intervaloChecarStatusContato = setInterval(() => {
        if (destinatarioAtual) {
            checarStatusContato(destinatarioAtual);
        }
    }, 15000);

    carregarMensagens();
}

function fecharChat() {
    const telaChat = document.getElementById("tela-chat");
    if (telaChat) {
        telaChat.classList.remove("ativa");
        setTimeout(() => {
            telaChat.style.display = "none";
        }, 300);
    }

    const containerMensagens = document.getElementById("chat-mensagens");
    if (containerMensagens) containerMensagens.style.backgroundImage = "";

    destinatarioAtual = null;
    window.grupoAtualId = null;

    if (intervaloChecarStatusContato) {
        clearInterval(intervaloChecarStatusContato);
        intervaloChecarStatusContato = null;
    }
}
// Funções para controle do painel de dados/fundo do chat
function abrirPainelDadosContato() {
    const painel = document.getElementById('painel-dados-contato');
    if (painel) painel.style.display = 'flex';
}

function fecharPainelDadosContato() {
    const painel = document.getElementById('painel-dados-contato');
    if (painel) painel.style.display = 'none';
}

function acionarTrocaFundo() {
    const inputFundo = document.getElementById('input-fundo-chat');
    if (inputFundo) inputFundo.click();
}

function alterarFundoChat(event) {
    const arquivo = event.target.files[0];
    if (!arquivo || !destinatarioAtual) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const urlImagem = e.target.result;
        
        // Aplica o fundo visualmente no chat atual
        const containerMensagens = document.getElementById("chat-mensagens");
        if (containerMensagens) {
            containerMensagens.style.backgroundImage = `url(${urlImagem})`;
            containerMensagens.style.backgroundSize = 'cover';
            containerMensagens.style.backgroundPosition = 'center';
        }

        // Salva no localStorage usando o e-mail do usuário logado + contato atual como chave
        const meuEmail = localStorage.getItem("usuarioLogado");
        localStorage.setItem(`fundo_chat_${meuEmail}_${destinatarioAtual}`, urlImagem);

        fecharPainelDadosContato();
    };
    reader.readAsDataURL(arquivo);
}

function carregarFundoChatSalvo(emailContato) {
    const meuEmail = localStorage.getItem("usuarioLogado");
    const fundoSalvo = localStorage.getItem(`fundo_chat_${meuEmail}_${emailContato}`);
    const containerMensagens = document.getElementById("chat-mensagens");

    if (containerMensagens) {
        if (fundoSalvo) {
            containerMensagens.style.backgroundImage = `url(${fundoSalvo})`;
            containerMensagens.style.backgroundSize = 'cover';
            containerMensagens.style.backgroundPosition = 'center';
        } else {
            containerMensagens.style.backgroundImage = "";
        }
    }
}
// ==========================================
// TEMPO REAL (SUPABASE REALTIME)
// ==========================================
function inscreverRealtime() {
    const meuEmail = localStorage.getItem("usuarioLogado");

    if (!meuEmail || !_supabase) return;

    if (realtimeConectando) return;

    realtimeConectando = true;

    if (timeoutReconexaoRealtime) {
        clearTimeout(timeoutReconexaoRealtime);
        timeoutReconexaoRealtime = null;
    }

    if (escutaRealtime) {
        _supabase.removeChannel(escutaRealtime);
        escutaRealtime = null;
    }

    const canal = _supabase.channel(`chat-room-${Date.now()}`);
    escutaRealtime = canal;

    canal
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens'
            },
            async (payload) => {
                const novaMsg = payload.new;

                // O canal principal já recebe INSERTs corretamente.
                // Entrega a mensagem também ao sistema de notificações.
                if (typeof window.processarNotificacaoMensagem === "function") {
                    window.processarNotificacaoMensagem(novaMsg);
                }

                carregarListaContatos(); // Atualiza a lista lateral com a última mensagem

                // O carregamento agora é incremental: IndexedDB guarda o histórico e
                // somente a mensagem nova é sincronizada/renderizada.
                if (window.grupoAtualId && String(novaMsg.grupo_id || "") === String(window.grupoAtualId)) {
                    const cache = window.WhatisCache;
                    if (cache) {
                        await cache.salvarMensagens(
                            cache.conversaGrupo(window.grupoAtualId),
                            [novaMsg]
                        );
                    }
                    await carregarMensagensGrupo(window.grupoAtualId);
                }

                if (!novaMsg.grupo_id && destinatarioAtual) {
                    const meuEmailAtual = (localStorage.getItem("usuarioLogado") || "").trim().toLowerCase();
                    const outro = (destinatarioAtual || "").trim().toLowerCase();
                    const remetente = (novaMsg.remetente_email || "").trim().toLowerCase();
                    const destinatario = (novaMsg.destinatario_email || "").trim().toLowerCase();

                    const pertenceAoChat =
                        (remetente === meuEmailAtual && destinatario === outro) ||
                        (remetente === outro && destinatario === meuEmailAtual);

                    if (pertenceAoChat) {
                        const cache = window.WhatisCache;
                        if (cache) {
                            await cache.salvarMensagens(
                                cache.conversaPrivada(destinatarioAtual),
                                [novaMsg]
                            );
                        }
                        await carregarMensagens();
                    }
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'mensagens'
            },
            async (payload) => {
                const msg = payload.new;
                if (!msg) return;

                // A mensagem da ligação em grupo muda quando a sala encerra.
                if (
                    msg.grupo_id &&
                    typeof window.ehMensagemChamadaGrupo === "function" &&
                    window.ehMensagemChamadaGrupo(msg)
                ) {
                    carregarListaContatos();

                    const cache = window.WhatisCache;

                    if (cache) {
                        await cache.salvarMensagens(
                            cache.conversaGrupo(msg.grupo_id),
                            [msg]
                        );
                    }

                    if (
                        window.grupoAtualId &&
                        String(window.grupoAtualId) === String(msg.grupo_id)
                    ) {
                        const existente = document.querySelector(
                            '#chat-mensagens .balao-msg[data-message-id="' + String(msg.id) + '"]'
                        );

                        if (existente && msg.chamada_id) {
                            existente.classList.toggle(
                                'chamada-status-verde',
                                msg.meta?.status === 'active'
                            );
                            existente.classList.toggle(
                                'chamada-status-neutro',
                                msg.meta?.status !== 'active'
                            );

                            const status = existente.querySelector('.chamada-bolha-status');
                            if (status && msg.meta?.status !== 'active') {
                                status.textContent = 'Encerrada';
                            }

                            const titulo = existente.querySelector('.chamada-bolha-titulo');
                            if (titulo) {
                                titulo.textContent =
                                    (msg.meta?.modo === 'video' ||
                                     msg.meta?.tipo_chamada === 'video_grupo')
                                        ? 'Ligação de vídeo em grupo'
                                        : 'Ligação de voz em grupo';
                            }
                        } else {
                            await carregarMensagensGrupo(window.grupoAtualId);
                        }
                    }

                    return;
                }

                if (msg.grupo_id) return;

                const remetente = (msg.remetente_email || "").trim().toLowerCase();
                const destinatario = (msg.destinatario_email || "").trim().toLowerCase();
                const meuEmailAtual = (meuEmail || "").trim().toLowerCase();

                // Mensagens de chamada mudam de estado (tocando, ativa, encerrada...)
                // e precisam atualizar para os dois participantes, não só para quem enviou.
                if (
                    typeof window.ehMensagemChamada === "function" &&
                    window.ehMensagemChamada(msg)
                ) {
                    carregarListaContatos();

                    if (destinatarioAtual) {
                        const outro = (destinatarioAtual || "").trim().toLowerCase();
                        const pertenceAoChat =
                            (remetente === meuEmailAtual && destinatario === outro) ||
                            (remetente === outro && destinatario === meuEmailAtual);

                        if (pertenceAoChat) {
                            const cache = window.WhatisCache;
                            const chave = cache
                                ? cache.conversaPrivada(destinatarioAtual)
                                : null;

                            if (cache && chave) {
                                await cache.salvarMensagens(chave, [msg]);
                            }

                            const existente = document.querySelector(
                                '#chat-mensagens .balao-msg[data-message-id="' + String(msg.id) + '"]'
                            );

                            if (existente && typeof window.atualizarBalaoChamada === "function") {
                                window.atualizarBalaoChamada(msg);
                            } else if (
                                typeof window.renderizarBalaoChamada === "function"
                            ) {
                                await window.renderizarBalaoChamada(
                                    msg,
                                    remetente === meuEmailAtual
                                );
                            }
                        }
                    }

                    return;
                }

                // O UPDATE comum abaixo continua cuidando do sistema de "visto".
                if (remetente !== meuEmailAtual) return;

                atualizarIndicadorVisualizacao(msg.id, msg.visualizada === true);

                if (
                    destinatarioAtual &&
                    destinatario ===
                    (destinatarioAtual || "").trim().toLowerCase() &&
                    window.WhatisCache?.salvarMensagens
                ) {
                    await window.WhatisCache.salvarMensagens(
                        window.WhatisCache.conversaPrivada(destinatarioAtual),
                        [msg]
                    );
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens',
                filter: `destinatario_email=eq.${meuEmail}`
            },
            async (payload) => {
                const novaMsg = payload.new;
                carregarListaContatos();

                // A renderização do chat já é feita pelo listener geral acima.
                // Não renderiza de novo aqui para evitar duplicação e corrida assíncrona.
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens',
                filter: `remetente_email=eq.${meuEmail}`
            },
            (payload) => {
                const novaMsg = payload.new;

                // Evita duplicar a mensagem própria caso já tenha sido renderizada na hora do envio
                // (Opcional, mas mantém a sincronia se abrir em outra aba)
                carregarListaContatos();
            }
        )
        .subscribe((status, err) => {
            realtimeConectando = false;

            if (status === "SUBSCRIBED") {
                console.log("✅ Realtime conectado com sucesso.");
                return;
            }

            if (status === "CHANNEL_ERROR" || status === "CLOSED" || status === "TIMED_OUT") {
                console.warn("⚠️ Realtime caiu. Tentando reconectar...");
                if (escutaRealtime === canal) escutaRealtime = null;
                if (typeof agendarReconexaoRealtime === 'function') {
                    agendarReconexaoRealtime();
                }
            }
        });
}

function agendarReconexaoRealtime() {
    if (timeoutReconexaoRealtime) return;

    timeoutReconexaoRealtime = setTimeout(() => {
        timeoutReconexaoRealtime = null;

        if (document.visibilityState === "visible" && localStorage.getItem("usuarioLogado")) {
            console.log("🔄 Tentando reconectar o Realtime...");
            inscreverRealtime();
        }
    }, 5000);
}
// ==========================================
// MONITORAMENTO DE PRESENÇA
// ==========================================
async function atualizarPresenca() {
    const meuEmail = localStorage.getItem("usuarioLogado");

    if (!meuEmail) return;

    await _supabase
        .from("usuarios")
        .update({ visto_por_ultimo: new Date().toISOString() })
        .eq("email", meuEmail);
}

function iniciarMonitoramentoPresenca() {
    atualizarPresenca();

    if (intervaloHeartbeat) clearInterval(intervaloHeartbeat);

    intervaloHeartbeat = setInterval(() => {
        atualizarPresenca();
    }, 30000);
}

function pararMonitoramentoPresenca() {
    if (intervaloHeartbeat) {
        clearInterval(intervaloHeartbeat);
        intervaloHeartbeat = null;
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        console.log("📱 App em primeiro plano. Reiniciando conexões...");
        inscreverRealtime();
        carregarListaContatos();

        if (destinatarioAtual) {
            carregarMensagens();
        }
    }
});
// ==========================================
// ABA VOCÊ / PERFIL E CONFIGURAÇÕES
// ==========================================
function atualizarFotoAbaVoce() {
    const fotoSalva = localStorage.getItem("fotoUsuario");
    const corSalva = localStorage.getItem("corUsuario");
    const imgVoce = document.getElementById("foto-aba-voce");

    aplicarAvatarUsuario(imgVoce, fotoSalva, corSalva);
}

function carregarDadosAbaVoce() {
    const email = localStorage.getItem("usuarioLogado");
    const usuario = localStorage.getItem("nomeUsuario");
    const foto = localStorage.getItem("fotoUsuario");
    const cor = localStorage.getItem("corUsuario");

    const elemNome = document.getElementById("voce-nome-usuario");
    const elemEmail = document.getElementById("voce-email-usuario");
    const elemFoto = document.getElementById("voce-foto-perfil");

    if (elemNome) elemNome.innerText = usuario || "Sem nome";
    if (elemEmail) elemEmail.innerText = usuario ? `@${usuario}` : "";
    aplicarAvatarUsuario(elemFoto, foto, cor);

    const temaEscuro = localStorage.getItem("temaEscuro") === "true";
    const permissaoConcedida = ("Notification" in window) && Notification.permission === "granted";
    const prefNotificacoes = localStorage.getItem("notificacoes") !== "false";

    const checkTema = document.getElementById("check-tema-escuro");
    const checkNotif = document.getElementById("check-notificacoes");

    if (checkTema) checkTema.checked = temaEscuro;
    if (checkNotif) checkNotif.checked = permissaoConcedida && prefNotificacoes;
}

async function trocarFotoPerfil(event) {
    const arquivo = event.target.files[0];
    const email = localStorage.getItem("usuarioLogado");

    if (!arquivo || !email) return;

    const fileExt = arquivo.name.split('.').pop();
    const fileName = `avatar_${Date.now()}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await _supabase
        .storage
        .from('avatars')
        .upload(fileName, arquivo, {
            cacheControl: '3600',
            upsert: true
        });

    if (uploadError) {
        alert("Erro ao enviar a imagem: " + uploadError.message);
        return;
    }

    const { data: publicUrlData } = _supabase
        .storage
        .from('avatars')
        .getPublicUrl(fileName);

    const urlFotoPublica = publicUrlData.publicUrl;

    const { error: updateError } = await _supabase
        .from("usuarios")
        .update({ foto_url: urlFotoPublica })
        .eq("email", email);

    if (updateError) {
        alert("Erro ao salvar foto de perfil.");
        return;
    }

    localStorage.setItem("fotoUsuario", urlFotoPublica);
    atualizarFotoAbaVoce();
    carregarDadosAbaVoce();
}
// ==========================================
// GERENCIAMENTO DE SOLICITAÇÕES DE CHAT
// ==========================================
function inicializarEventosSolicitacoes() {
    const btnOpcoes = document.getElementById('btn-opcoes');
    const dropdownMenu = document.getElementById('dropdown-menu');
    const btnAbrirSolicitacoes = document.getElementById('btn-abrir-solicitacoes');
    const btnFecharModalSolicitacoes = document.getElementById('btn-fechar-modal-solicitacoes');
    const modalSolicitacoes = document.getElementById('modal-solicitacoes');
    const btnAceitarSolicitacao = document.getElementById('btn-aceitar-solicitacao');
    const btnIgnorarSolicitacao = document.getElementById('btn-ignorar-solicitacao');

    if (btnOpcoes && dropdownMenu) {
        btnOpcoes.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            dropdownMenu.classList.add('hidden');
        });
    }

    if (btnAbrirSolicitacoes && modalSolicitacoes) {
        btnAbrirSolicitacoes.addEventListener('click', () => {
            if (dropdownMenu) dropdownMenu.classList.add('hidden');
            modalSolicitacoes.classList.remove('hidden');
            carregarSolicitacoes();
        });
    }

    if (btnFecharModalSolicitacoes && modalSolicitacoes) {
        btnFecharModalSolicitacoes.addEventListener('click', () => {
            modalSolicitacoes.classList.add('hidden');
        });
    }

    if (btnAceitarSolicitacao) {
        btnAceitarSolicitacao.addEventListener('click', aceitarSolicitacaoAtual);
    }

    if (btnIgnorarSolicitacao) {
        btnIgnorarSolicitacao.addEventListener('click', ignorarSolicitacaoAtual);
    }
}

async function carregarSolicitacoes() {
    const meuUsuario = localStorage.getItem("nomeUsuario");
    if (!meuUsuario || !_supabase) return;

    const badgeSolicitacoes = document.getElementById('badge-solicitacoes');
    const contadorMenu = document.getElementById('contador-menu');
    const listaSolicitacoes = document.getElementById('lista-solicitacoes');
    const msgSemSolicitacoes = document.getElementById('msg-sem-solicitacoes');

    const { data: solicitacoes, error } = await _supabase
        .from('solicitacoes_chat')
        .select('*')
        .eq('destinatario_email', meuUsuario)
        .eq('status', 'pendente');

    if (error) {
        console.error('Erro ao buscar solicitações:', error);
        return;
    }

    const total = solicitacoes ? solicitacoes.length : 0;
    if (contadorMenu) contadorMenu.textContent = total;
    if (badgeSolicitacoes) {
        badgeSolicitacoes.textContent = total;
        if (total > 0) {
            badgeSolicitacoes.classList.remove('hidden');
        } else {
            badgeSolicitacoes.classList.add('hidden');
        }
    }

    if (!listaSolicitacoes) return;
    listaSolicitacoes.innerHTML = '';

    if (total === 0) {
        if (msgSemSolicitacoes) msgSemSolicitacoes.classList.remove('hidden');
        return;
    }

    if (msgSemSolicitacoes) msgSemSolicitacoes.classList.add('hidden');

    solicitacoes.forEach((solicitacao) => {
        const li = document.createElement('li');
        li.className = 'solicitacao-item';
        li.innerHTML = `
            <div class="user-info">
                <strong>${solicitacao.remetente_email}</strong>
                <p>Enviou um pedido de conversa</p>
            </div>
            <button class="btn-abrir-pedido">Ver</button>
        `;

        li.querySelector('.btn-abrir-pedido').addEventListener('click', () => {
            abrirChatSolicitacao(solicitacao);
        });

        listaSolicitacoes.appendChild(li);
    });
}

function abrirChatSolicitacao(solicitacao) {
    solicitacaoAtual = solicitacao;
    
    const modalSolicitacoes = document.getElementById('modal-solicitacoes');
    const chatInputBox = document.getElementById('chat-input-box');
    const chatActionBar = document.getElementById('chat-action-bar');
    const telaChat = document.getElementById("tela-chat");

    if (modalSolicitacoes) modalSolicitacoes.classList.add('hidden');
    
    if (chatInputBox) chatInputBox.classList.add('hidden');
    if (chatActionBar) chatActionBar.classList.remove('hidden');

    destinatarioAtual = solicitacao.remetente_email;
    const elemNome = document.getElementById("chat-nome-usuario");
    if (elemNome) elemNome.innerText = solicitacao.remetente_email;

    if (telaChat) telaChat.style.display = "flex";
    
    const container = document.getElementById("chat-mensagens");
    if (container) container.innerHTML = `<div style="text-align:center; padding:20px; color:#888;">Aceite a solicitação para conversar com este usuário.</div>`;
}

async function aceitarSolicitacaoAtual() {
    if (!solicitacaoAtual) return;

    const meuUsuario = localStorage.getItem("nomeUsuario");

    const { error: errorStatus } = await _supabase
        .from('solicitacoes_chat')
        .update({ status: 'aceito' })
        .eq('id', solicitacaoAtual.id);

    if (errorStatus) return console.error('Erro ao aceitar:', errorStatus);

    await _supabase
        .from('contatos')
        .insert([{ 
            usuario_origem: meuUsuario, 
            contato_usuario: solicitacaoAtual.remetente_email 
        }]);

    await _supabase
        .from('contatos')
        .insert([{ 
            usuario_origem: solicitacaoAtual.remetente_email, 
            contato_usuario: meuUsuario 
        }]);

    const chatActionBar = document.getElementById('chat-action-bar');
    const chatInputBox = document.getElementById('chat-input-box');

    if (chatActionBar) chatActionBar.classList.add('hidden');
    if (chatInputBox) chatInputBox.classList.remove('hidden');

    carregarMensagens();
    
    solicitacaoAtual = null;
    carregarSolicitacoes();
    carregarListaContatos();
}

async function ignorarSolicitacaoAtual() {
    if (!solicitacaoAtual) return;

    const { error } = await _supabase
        .from('solicitacoes_chat')
        .update({ status: 'ignorado' })
        .eq('id', solicitacaoAtual.id);

    if (error) return console.error('Erro ao ignorar:', error);

    const chatActionBar = document.getElementById('chat-action-bar');
    const chatInputBox = document.getElementById('chat-input-box');

    if (chatActionBar) chatActionBar.classList.add('hidden');
    if (chatInputBox) chatInputBox.classList.remove('hidden');

    solicitacaoAtual = null;
    fecharChat();
    carregarSolicitacoes();
}
// ==========================================
// TEMA / FUNDO PERSONALIZADO DO CHAT
// ==========================================
function abrirPainelDadosContato() {
    const painel = document.getElementById('painel-dados-contato');
    if (painel) {
        painel.classList.remove('hidden');
        painel.style.display = 'flex';
    }
}

function fecharPainelDadosContato() {
    const painel = document.getElementById('painel-dados-contato');
    if (painel) {
        painel.classList.add('hidden');
        painel.style.display = 'none';
    }
}

function acionarTrocaFundo() {
    const inputFundo = document.getElementById('input-fundo-chat');
    if (inputFundo) {
        inputFundo.click();
    }
}

async function alterarFundoChat(event) {
    const arquivo = event.target.files[0];
    const meuEmail = localStorage.getItem("usuarioLogado");

    if (!arquivo || !meuEmail || !destinatarioAtual) return;

    const fileExt = arquivo.name.split('.').pop();
    const fileName = `fundo_${meuEmail.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await _supabase
        .storage
        .from('avatars')
        .upload(fileName, arquivo, {
            cacheControl: '3600',
            upsert: true
        });

    if (uploadError) {
        alert("Erro ao enviar imagem de fundo: " + uploadError.message);
        return;
    }

    const { data: publicUrlData } = _supabase
        .storage
        .from('avatars')
        .getPublicUrl(fileName);

    const urlFundoPublica = publicUrlData.publicUrl;

    const { error: updateError } = await _supabase
        .from("usuarios")
        .update({ fundo_chat_url: urlFundoPublica })
        .eq("email", meuEmail);

    if (updateError) {
        console.error("Erro ao salvar URL no banco:", updateError.message);
    }

    aplicarFundoNaTela(urlFundoPublica);

    localStorage.setItem(`fundo_chat_${meuEmail}_${destinatarioAtual}`, urlFundoPublica);

    fecharPainelDadosContato();
    alert("Fundo alterado e salvo com sucesso!");
}

function aplicarFundoNaTela(urlImagem) {
    const chatMensagens = document.getElementById('chat-mensagens');
    if (chatMensagens) {
        if (urlImagem) {
            chatMensagens.style.backgroundImage = `url('${urlImagem}')`;
            chatMensagens.style.backgroundSize = 'cover';
            chatMensagens.style.backgroundPosition = 'center';
        } else {
            chatMensagens.style.backgroundImage = 'none';
        }
    }
}

function carregarFundoChatSalvo(emailContato) {
    const meuEmail = localStorage.getItem("usuarioLogado");
    const fundoSalvo = localStorage.getItem(`fundo_chat_${meuEmail}_${emailContato}`);
    aplicarFundoNaTela(fundoSalvo);
}

function abrirDadosUsuario() {
    const painel = document.getElementById('painel-dados-usuario');

    const nome = document.getElementById('voce-nome-usuario');
    const email = document.getElementById('voce-email-usuario');
    const foto = document.getElementById('voce-foto-perfil');

    const dadosNome = document.getElementById('dados-nome-usuario');
    const dadosUsuario = document.getElementById('dados-usuario-atual');
    const dadosEmail = document.getElementById('dados-email-usuario');
    const dadosFoto = document.getElementById('dados-foto-usuario');

    if (nome) {
        dadosNome.textContent = nome.textContent;
        dadosUsuario.textContent = nome.textContent;
    }

    if (dadosEmail) {
        dadosEmail.textContent = localStorage.getItem("usuarioLogado") || "";
    }

    aplicarAvatarUsuario(
        dadosFoto,
        localStorage.getItem("fotoUsuario"),
        localStorage.getItem("corUsuario")
    );

    painel.style.display = 'flex';
}

function fecharDadosUsuario() {
    document.getElementById('painel-dados-usuario').style.display = 'none';
}

function acionarAlterarFotoUsuario() {
    document.getElementById('input-foto-dados-usuario').click();
}

function alterarFotoDadosUsuario(event) {
    const arquivo = event.target.files[0];

    if (!arquivo) return;

    const url = URL.createObjectURL(arquivo);

    const alvosFoto = [
        document.getElementById('dados-foto-usuario'),
        document.getElementById('voce-foto-perfil'),
        document.getElementById('foto-aba-voce')
    ];

    alvosFoto.forEach(img => {
        if (!img) return;
        img.src = url;
        img.style.backgroundColor = "transparent";
        img.classList.remove("avatar-sem-foto");
        img.dataset.temFoto = "true";
    });
}

function abrirAlterarNome() {
    const nomeAtual = document.getElementById('voce-nome-usuario').textContent;

    const novoNome = prompt('Digite seu novo nome de usuário:', nomeAtual);

    if (!novoNome || novoNome.trim() === '') return;

    document.getElementById('voce-nome-usuario').textContent = novoNome.trim();
    document.getElementById('voce-email-usuario').textContent = '@' + novoNome.trim();
    document.getElementById('dados-nome-usuario').textContent = novoNome.trim();
    document.getElementById('dados-usuario-atual').textContent = novoNome.trim();
}
let membrosSelecionadosParaGrupo = [];
let arquivoFotoGrupoSelecionado = null;
// Exibir o menu flutuante do botão "+"
function alternarMenuMais(event) {
    if(event) event.stopPropagation();
    const menu = document.getElementById('dropdown-menu-mais');
    if(menu) menu.classList.toggle('hidden');
}
// Fechar menu ao clicar fora
document.addEventListener('click', () => {
    const menu = document.getElementById('dropdown-menu-mais');
    if(menu) menu.classList.add('hidden');
});
// Iniciar o fluxo de criação de grupo
async function iniciarCriacaoGrupo() {
    membrosSelecionadosParaGrupo = [];
    document.getElementById('tela-criar-grupo-membros').style.display = 'flex';
    await carregarContatosParaSelecao();
    atualizarContadorGrupoUI();
}

async function carregarContatosParaSelecao() {
    const meuUsuario = localStorage.getItem("nomeUsuario");
    const container = document.getElementById('lista-contatos-selecao');
    if(!container) return;
    
    container.innerHTML = '';
    
    // Aproveita a sua lista de contatos já carregada em memória (todosContatos)
    if (!todosContatos || todosContatos.length === 0) {
        container.innerHTML = '<li style="text-align:center; padding:20px; color:#888;">Nenhum contato disponível.</li>';
        return;
    }

    const contatosParaGrupo = todosContatos.filter(item => item.tipo !== 'grupo');

    contatosParaGrupo.forEach(contato => {
        const li = document.createElement('li');
        li.className = 'item-selecao-contato';
        const foto = contato.foto_url || "";
        const nome = contato.usuario || contato.email;

        li.innerHTML = `
            <div class="esq-contato-sel">
                <input type="checkbox" class="checkbox-membro" data-email="${contato.email}" data-nome="${nome}" onchange="tratarSelecaoMembro(this)">
                <img src="" class="foto-contato-pequena" alt="">
                <span class="nome-contato-sel">${nome}</span>
            </div>
        `;

        aplicarAvatarUsuario(li.querySelector(".foto-contato-pequena"), foto, contato.cor);
        container.appendChild(li);
    });
}

function tratarSelecaoMembro(checkbox) {
    const email = checkbox.getAttribute('data-email');
    const nome = checkbox.getAttribute('data-nome');

    if (checkbox.checked) {
        if (membrosSelecionadosParaGrupo.length >= 15) {
            alert("O grupo pode ter no máximo 15 pessoas!");
            checkbox.checked = false;
            return;
        }
        membrosSelecionadosParaGrupo.push({ email, nome });
    } else {
        membrosSelecionadosParaGrupo = membrosSelecionadosParaGrupo.filter(m => m.email !== email);
    }

    atualizarContadorGrupoUI();
}

function atualizarContadorGrupoUI() {
    const contador = document.getElementById('contador-selecao-grupo');
    const btnAvancar = document.getElementById('btn-avancar-grupo');
    const total = membrosSelecionadosParaGrupo.length;

    if (contador) contador.textContent = `${total}/15`;

    // Mostra o botão verde se houver pelo menos 1 membro selecionado
    if (btnAvancar) {
        if (total > 0) {
            btnAvancar.classList.remove('hidden');
        } else {
            btnAvancar.classList.add('hidden');
        }
    }
}

function irParaDetalhesGrupo() {
    if (membrosSelecionadosParaGrupo.length === 0) {
        alert("Selecione pelo menos uma pessoa para criar o grupo.");
        return;
    }
    document.getElementById('tela-criar-grupo-membros').style.display = 'none';
    document.getElementById('tela-criar-grupo-detalhes').style.display = 'flex';
    
    // Prepara cor aleatória inicial para o preview do avatar padrão
    gerarAvatarPadraoVisual('Grupo');
}

function voltarParaSelecaoMembros() {
    document.getElementById('tela-criar-grupo-detalhes').style.display = 'none';
    document.getElementById('tela-criar-grupo-membros').style.display = 'flex';
}
function fecharMenuCriarGrupo() {
    const tela = document.getElementById('tela-criar-grupo-membros');

    if (tela) {
        tela.style.display = 'none';
    }
}
function acionarTrocaFotoGrupo() {
    document.getElementById('input-foto-grupo').click();
}

function previewFotoGrupo(event) {
    const arquivo = event.target.files[0];
    if (arquivo) {
        arquivoFotoGrupoSelecionado = arquivo;
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.getElementById('img-avatar-grupo-preview');
            const letra = document.getElementById('letra-inicial-grupo');
            if(img && letra) {
                img.src = e.target.result;
                img.style.display = 'block';
                letra.style.display = 'none';
            }
        }
        reader.readAsDataURL(arquivo);
    }
}

function atualizarLetraPreview() {
    const nome = document.getElementById('nome-grupo-input').value;
    const letraSpan = document.getElementById('letra-inicial-grupo');
    if (letraSpan && nome.length > 0) {
        letraSpan.textContent = nome.charAt(0).toUpperCase();
    } else if (letraSpan) {
        letraSpan.textContent = 'G';
    }
    if (!arquivoFotoGrupoSelecionado) {
        gerarAvatarPadraoVisual(nome || 'Grupo');
    }
}
// Gera cor de fundo aleatória caso não tenha foto
function gerarAvatarPadraoVisual(nomeTexto) {
    const previewDiv = document.getElementById('preview-avatar-grupo');
    const letraSpan = document.getElementById('letra-inicial-grupo');
    const img = document.getElementById('img-avatar-grupo-preview');
    
    if(img && img.style.display === 'block') return; // Se tem foto, não mexe na cor

    const cores = ['#ff5722', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#009688', '#4caf50', '#ff9800'];
    const corAleatoria = cores[Math.floor(Math.random() * cores.length)];
    
    if(previewDiv) previewDiv.style.backgroundColor = corAleatoria;
    if(letraSpan && nomeTexto) letraSpan.textContent = nomeTexto.charAt(0).toUpperCase();
}
// Finaliza e salva o grupo no Supabase
async function finalizarCriacaoGrupo() {
    const nomeGrupo = document.getElementById('nome-grupo-input').value.trim();
    const meuEmail = localStorage.getItem("usuarioLogado");
    const meuUsuario = localStorage.getItem("nomeUsuario");

    if (!nomeGrupo) {
        alert("Por favor, digite um nome para o grupo.");
        return;
    }

    let urlFotoGrupo = null;

    // 1. Upload da foto do grupo se houver
    if (arquivoFotoGrupoSelecionado) {
        const fileExt = arquivoFotoGrupoSelecionado.name.split('.').pop();
        const fileName = `grupo_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await _supabase.storage.from('avatars').upload(fileName, arquivoFotoGrupoSelecionado);
        if (!uploadError) {
            const { data: pub } = _supabase.storage.from('avatars').getPublicUrl(fileName);
            urlFotoGrupo = pub.publicUrl;
        }
    }

    // 2. Insere o grupo na tabela 'grupos' (crie essa tabela no Supabase se ainda não tiver)
    const { data: grupoCriado, error: erroGrupo } = await _supabase
        .from('grupos')
        .insert([{
            nome: nomeGrupo,
            foto_url: urlFotoGrupo,
            criado_por: meuEmail
        }])
        .select()
        .single();

    if (erroGrupo || !grupoCriado) {
        alert("Erro ao criar o grupo: " + (erroGrupo?.message || "Erro desconhecido"));
        return;
    }

    const grupoId = grupoCriado.id;

    // 3. Monta a lista de membros inserindo o criador + os selecionados na tabela 'grupo_membros'
    let listaMembrosParaInserir = [
        { grupo_id: grupoId, usuario_email: meuEmail, usuario_nome: meuUsuario }
    ];

    membrosSelecionadosParaGrupo.forEach(m => {
        listaMembrosParaInserir.push({
            grupo_id: grupoId,
            usuario_email: m.email,
            usuario_nome: m.nome
        });
    });

    const { error: erroMembros } = await _supabase
        .from('grupo_membros')
        .insert(listaMembrosParaInserir);

    if (erroMembros) {
        alert("Erro ao adicionar membros ao grupo.");
        return;
    }

    alert("Grupo criado com sucesso!");
    // Limpa e fecha as telas de criação
    document.getElementById('tela-criar-grupo-detalhes').style.display = 'none';
    mostrarAppPrincipal();
}
let toqueInicialX = 0;
let toqueInicialY = 0;

document.addEventListener('touchstart', (e) => {
    toqueInicialX = e.touches[0].clientX;
    toqueInicialY = e.touches[0].clientY;
}, false);

document.addEventListener('touchend', (e) => {
    let toqueFinalX = e.changedTouches[0].clientX;
    let toqueFinalY = e.changedTouches[0].clientY;

    let diferencaX = toqueFinalX - toqueInicialX;
    let diferencaY = Math.abs(toqueFinalY - toqueInicialY);

    const telaChat = document.getElementById("tela-chat");
    const chatAberto = telaChat && telaChat.style.display === "flex";

    if (chatAberto && toqueInicialX < 40 && diferencaX > 100 && diferencaY < 50) {
        fecharChat();
    }
}, false);

function adicionarGestoArrastar(balaoElemento, idMensagem, nomeRemetente, textoMensagem) {
    let startX = 0;
    let currentX = 0;
    const limiteArraste = 60; // Quantos pixels precisa arrastar para ativar

    balaoElemento.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
    });

    balaoElemento.addEventListener('touchmove', (e) => {
        currentX = e.touches[0].clientX;
        let diffX = currentX - startX;

        // Limita o arraste apenas para a direita (positivo) e até um teto máximo
        if (diffX > 0 && diffX <= 100) {
            balaoElemento.style.transform = `translateX(${diffX}px)`;
        }
    });

    balaoElemento.addEventListener('touchend', (e) => {
        let diffX = currentX - startX;

        // Se passou do limite estipulado, aciona a resposta
        if (diffX >= limiteArraste) {
            iniciarResposta(idMensagem, nomeRemetente, textoMensagem);
        }

        // Reseta a posição do balão suavemente
        balaoElemento.style.transform = 'translateX(0px)';
        startX = 0;
        currentX = 0;
    });
}