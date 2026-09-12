// ==========================================
// CONFIGURAÇÃO DO SUPABASE
// ==========================================
const supabaseUrl = 'https://qlvorxobvnjoovqxnfhp.supabase.co';
const supabaseKey = 'sb_publishable_IoDWf91jWwRgamUfmdDQow_1-fIMHZO';
const _supabase = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// Variáveis globais de estado
let todosContatos = [];
let destinatarioAtual = null;
let escutaRealtime = null;
let intervaloHeartbeat = null;
let intervaloChecarStatusContato = null;
let arquivoFotoSelecionado = null;

// ==========================================
// INICIALIZAÇÃO E SERVICE WORKER
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    verificarSessao();
    registrarServiceWorker();
});

function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado:', reg.scope))
            .catch(err => console.log('Service Worker não registrado (modo normal):', err));
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
    return data.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
// CONTROLE DE TELAS E NAVEGAÇÃO
// ==========================================
function esconderTelasAutenticacao() {
    const telas = ["inicio", "login", "criar-conta", "etapa-usuario"];
    telas.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
}

function mostrarTela(idTela) {
    esconderTelasAutenticacao();
    const telaAlvo = document.getElementById(idTela);
    if (telaAlvo) telaAlvo.style.display = "flex";
}

function proximo() {
    localStorage.setItem("introducaoVista", "true");
    document.getElementById("inicio").style.display = "none";
    
    const meuEmail = localStorage.getItem("usuarioLogado");
    if (meuEmail) {
        mostrarAppPrincipal();
    } else {
        document.getElementById("login").style.display = "flex";
    }
}

async function mostrarAppPrincipal() {
    esconderTelasAutenticacao();

    const telaConversas = document.getElementById("tela-conversas");
    const barraNavegacao = document.querySelector(".ultrabaixo");

    if (telaConversas) telaConversas.style.display = "block";
    if (barraNavegacao) barraNavegacao.style.display = "flex";

    solicitarPermissao();
    
    // Primeiro carrega a lista para reconhecer remetentes nas notificações
    await carregarListaContatos();
    
    // Inicia a escuta em tempo real resiliente
    inscreverRealtime();
    
    iniciarMonitoramentoPresenca();
}

function alternarAba(aba, botaoClicado) {
    const abas = document.querySelectorAll('.aba-conteudo');
    abas.forEach(a => a.style.display = 'none');

    const botoes = document.querySelectorAll('.baixo button');
    botoes.forEach(btn => btn.classList.remove('ativo'));

    if (aba === 'conversas') {
        const telaConversas = document.getElementById('tela-conversas');
        if (telaConversas) telaConversas.style.display = 'block';
    } else if (aba === 'voce') {
        const telaVoce = document.getElementById('tela-voce');
        if (telaVoce) telaVoce.style.display = 'flex';
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
    const introducaoVista = localStorage.getItem("introducaoVista");
    const emailSalvo = localStorage.getItem("usuarioLogado");

    if (!introducaoVista) {
        esconderTelasAutenticacao();
        const telaInicio = document.getElementById("inicio");
        if (telaInicio) telaInicio.style.display = "flex";
        return;
    }

    if (!emailSalvo) {
        console.log("Nenhum usuário conectado.");
        mostrarTela('login');
        return;
    }

    const { data: usuario, error } = await _supabase
        .from("usuarios")
        .select("*")
        .eq("email", emailSalvo)
        .maybeSingle();

    if (error || !usuario) {
        console.log("Sessão inválida ou expirada.");
        localStorage.removeItem("usuarioLogado");
        mostrarTela('login');
        return;
    }

    console.log("Sessão ativa para:", usuario.email);

    if (usuario.foto_url) {
        localStorage.setItem("fotoUsuario", usuario.foto_url);
    }
    if (usuario.usuario) {
        localStorage.setItem("nomeUsuario", usuario.usuario);
    }

    atualizarFotoAbaVoce();
    mostrarAppPrincipal();
}

function deslogar() {
    pararMonitoramentoPresenca();
    if (escutaRealtime) {
        _supabase.removeChannel(escutaRealtime);
        escutaRealtime = null;
    }
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("nomeUsuario");
    localStorage.removeItem("fotoUsuario");
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
        .insert([{ email: email, senha: senhaHash, usuario: null }]);

    if (erroInsercao) {
        alert("Erro ao salvar no servidor.");
        return;
    }

    sessionStorage.setItem("emailCadastro", email);
    mostrarTela('etapa-usuario');
}

function previewFoto(event) {
    const file = event.target.files[0];
    if (file) {
        arquivoFotoSelecionado = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById("avatar-preview");
            if (preview) preview.src = e.target.result;
        }
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

    const { data, error } = await _supabase
        .from("usuarios")
        .update({ 
            usuario: usuarioInput,
            foto_url: urlFotoPublica 
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
    if (urlFotoPublica) {
        localStorage.setItem("fotoUsuario", urlFotoPublica);
    }

    sessionStorage.removeItem("emailCadastro");
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
        }
        atualizarFotoAbaVoce();
        mostrarAppPrincipal();
    } else {
        alert("E-mail ou senha incorretos.");
    }
}

// ==========================================
// GERENCIAMENTO DE CONTATOS
// ==========================================
async function carregarListaContatos() {
    const meuEmail = localStorage.getItem("usuarioLogado");
    const meuUsuario = localStorage.getItem("nomeUsuario");
    if (!meuUsuario || !meuEmail) return;

    const { data: relacaoContatos, error: erroRelacao } = await _supabase
        .from("contatos")
        .select("contato_usuario")
        .eq("usuario_origem", meuUsuario);

    if (erroRelacao || !relacaoContatos || relacaoContatos.length === 0) {
        todosContatos = [];
        renderizarContatos([]);
        return;
    }

    const nomesSalvos = relacaoContatos.map(c => c.contato_usuario);

    const { data: usuarios, error: erroUsuarios } = await _supabase
        .from("usuarios")
        .select("email, usuario, foto_url")
        .in("usuario", nomesSalvos);

    if (erroUsuarios || !usuarios) return;

    const contatosComMensagens = await Promise.all(usuarios.map(async (contato) => {
        const { data: ultimasMsgs } = await _supabase
            .from("mensagens")
            .select("texto, created_at")
            .or(`and(remetente_email.eq.${meuEmail},destinatario_email.eq.${contato.email}),and(remetente_email.eq.${contato.email},destinatario_email.eq.${meuEmail})`)
            .order("created_at", { ascending: false })
            .limit(1);

        const temMsg = ultimasMsgs && ultimasMsgs.length > 0;
        return { 
            ...contato, 
            ultimaMsg: temMsg ? ultimasMsgs[0].texto : "Nenhuma mensagem ainda",
            horaUltimaMsg: temMsg ? formatarHora(ultimasMsgs[0].created_at) : ""
        };
    }));

    todosContatos = contatosComMensagens;
    renderizarContatos(todosContatos);
}

function renderizarContatos(lista) {
    const container = document.getElementById("lista-contatos");
    if (!container) return;
    container.innerHTML = "";

    if (lista.length === 0) {
        container.innerHTML = `<li style="color: #888; text-align: center; margin-top: 20px; font-family: sans-serif;">Nenhum contato encontrado.</li>`;
        return;
    }

    lista.forEach(contato => {
        const li = document.createElement("li");
        li.classList.add("item-contato");

        const foto = contato.foto_url || "svg/icon.svg";
        const nome = contato.usuario || contato.email;

        li.innerHTML = `
            <img src="${foto}" class="foto-contato">
            <div class="info-contato">
                <div class="info-contato-topo">
                    <span class="nome-contato">${nome}</span>
                    <span class="hora-contato">${contato.horaUltimaMsg || ''}</span>
                </div>
                <span class="ultima-msg">${contato.ultimaMsg}</span>
            </div>
        `;

        li.onclick = () => {
            abrirChatCom(contato.email, nome, foto);
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
        .insert([{ usuario_origem: meuUsuario, contato_usuario: nomeUsuarioAdicionar }]);

    if (error) {
        alert("Este usuário já está na sua lista ou ocorreu um erro.");
        return;
    }

    alert("Contato adicionado com sucesso!");
    carregarListaContatos();
}

function pedirEmailContato() {
    const usuarioDigitado = prompt("Digite o nome de usuário da pessoa que deseja adicionar:");
    if (usuarioDigitado) {
        adicionarNovoContato(usuarioDigitado.trim());
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
function renderizarBalao(texto, ehMinha, dataCriacao) {
    const container = document.getElementById("chat-mensagens");
    if (!container) return;

    const balao = document.createElement("div");
    balao.classList.add("balao-msg");
    balao.classList.add(ehMinha ? "balao-enviada" : "balao-recebida");

    const horaFormatada = formatarHora(dataCriacao || new Date());

    balao.innerHTML = `
        <span>${texto}</span>
        <span class="balao-hora">${horaFormatada}</span>
    `;

    container.appendChild(balao);
    container.scrollTop = container.scrollHeight;
}

async function carregarMensagens() {
    const meuEmail = localStorage.getItem("usuarioLogado");
    if (!meuEmail || !destinatarioAtual) return;

    const container = document.getElementById("chat-mensagens");
    if (!container) return;
    container.innerHTML = "";

    const { data: mensagens, error } = await _supabase
        .from("mensagens")
        .select("*")
        .or(`and(remetente_email.eq.${meuEmail},destinatario_email.eq.${destinatarioAtual}),and(remetente_email.eq.${destinatarioAtual},destinatario_email.eq.${meuEmail})`)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("Erro ao carregar mensagens:", error.message);
        return;
    }

    mensagens.forEach(msg => {
        renderizarBalao(msg.texto, msg.remetente_email === meuEmail, msg.created_at);
    });

    container.scrollTop = container.scrollHeight;
}

async function enviarMensagem() {
    const input = document.getElementById("input-mensagem");
    const texto = input.value.trim();
    const meuEmail = localStorage.getItem("usuarioLogado");

    if (texto === "" || !destinatarioAtual || !meuEmail) return;

    input.value = "";

    const { error } = await _supabase
        .from("mensagens")
        .insert([{
            remetente_email: meuEmail,
            destinatario_email: destinatarioAtual,
            texto: texto
        }]);

    if (error) {
        console.error("Erro ao enviar mensagem:", error.message);
        alert("Erro ao enviar mensagem.");
    }
    carregarListaContatos();
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

function abrirChatCom(emailDestinatario, nomeDestinatario, fotoDestinatario) {
    destinatarioAtual = emailDestinatario;

    const elemNome = document.getElementById("chat-nome-usuario");
    const elemFoto = document.getElementById("chat-foto-usuario");
    const telaChat = document.getElementById("tela-chat");

    if (elemNome) elemNome.innerText = nomeDestinatario || emailDestinatario;
    if (elemFoto && fotoDestinatario) elemFoto.src = fotoDestinatario;
    if (telaChat) telaChat.style.display = "flex";
    
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
    if (telaChat) telaChat.style.display = "none";
    
    destinatarioAtual = null;
    
    if (intervaloChecarStatusContato) {
        clearInterval(intervaloChecarStatusContato);
        intervaloChecarStatusContato = null;
    }
}

async function inscreverRealtime() {
    const meuEmail = localStorage.getItem("usuarioLogado");
    if (!meuEmail) return;

    // 1. Se já existe um canal ativo, remove para evitar duplicações/canais zumbis
    if (escutaRealtime) {
        await _supabase.removeChannel(escutaRealtime);
        escutaRealtime = null;
    }

    // 2. Cria o canal escutando FILTRADO APENAS para mensagens endereçadas a mim ou enviadas por mim
    escutaRealtime = _supabase
        .channel(`chat-user-${Date.now()}`) // Nome único com timestamp para evitar cache no iOS
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens',
                filter: `destinatario_email=eq.${meuEmail}` // Escuta apenas o que é recebido por você
            },
            (payload) => {
                const novaMsg = payload.new;
                console.log("📩 Nova mensagem recebida:", novaMsg);

                // Atualiza a lista de conversas
                carregarListaContatos();

                // Se o chat com este remetente estiver aberto na tela
                if (destinatarioAtual && novaMsg.remetente_email === destinatarioAtual) {
                    renderizarBalao(
                        novaMsg.texto,
                        false,
                        novaMsg.created_at
                    );
                }

                // Dispara a notificação local
                const contato = todosContatos.find(c => c.email === novaMsg.remetente_email);
                const nomeRemetente = contato ? (contato.usuario || contato.email) : novaMsg.remetente_email;
                const fotoRemetente = contato ? contato.foto_url : null;

                enviarNotificacao(
                    nomeRemetente,
                    novaMsg.texto,
                    novaMsg.remetente_email,
                    fotoRemetente
                );
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens',
                filter: `remetente_email=eq.${meuEmail}` // Escuta também o que você enviou de outro dispositivo
            },
            (payload) => {
                const novaMsg = payload.new;
                
                // Se você mesmo enviou e o chat tá aberto, apenas renderiza na tela
                if (destinatarioAtual && novaMsg.destinatario_email === destinatarioAtual) {
                    renderizarBalao(novaMsg.texto, true, novaMsg.created_at);
                }
                carregarListaContatos();
            }
        )
        .subscribe((status, err) => {
            console.log("🔌 Status Realtime:", status);

            if (status === "SUBSCRIBED") {
                console.log("✅ Realtime conectado com sucesso no iOS!");
            }

            if (status === "CHANNEL_ERROR" || status === "CLOSED" || status === "TIMED_OUT") {
                console.warn("⚠️ Canal desconectado. Limpando referência...");
                escutaRealtime = null;
            }
        });
}
// ==========================================
// MONITORAMENTO DE PRESENÇA (ONLINE/OFFLINE)
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

// Reconecta e atualiza instantaneamente quando o usuário abre o aplicativo/tela
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        iniciarMonitoramentoPresenca();
        
        // Garante que a escuta esteja ativa ao voltar para a aba
        if (!escutaRealtime || escutaRealtime.state !== 'joined') {
            if (escutaRealtime) _supabase.removeChannel(escutaRealtime);
            escutaRealtime = null;
            inscreverRealtime();
        }
        
        carregarListaContatos();
        if (destinatarioAtual) {
            carregarMensagens();
        }
    } else {
        pararMonitoramentoPresenca();
    }
});

// ==========================================
// ABA VOCÊ / PERFIL E CONFIGURAÇÕES
// ==========================================
function atualizarFotoAbaVoce() {
    const fotoSalva = localStorage.getItem("fotoUsuario");
    const imgVoce = document.getElementById("foto-aba-voce");

    if (imgVoce && fotoSalva) {
        imgVoce.src = fotoSalva;
    }
}

function carregarDadosAbaVoce() {
    const email = localStorage.getItem("usuarioLogado");
    const usuario = localStorage.getItem("nomeUsuario");
    const foto = localStorage.getItem("fotoUsuario");

    const elemNome = document.getElementById("voce-nome-usuario");
    const elemEmail = document.getElementById("voce-email-usuario");
    const elemFoto = document.getElementById("voce-foto-perfil");

    if (elemNome) elemNome.innerText = usuario || "Sem nome";
    if (elemEmail) elemEmail.innerText = email || "";
    if (elemFoto && foto) elemFoto.src = foto;

    const temaEscuro = localStorage.getItem("temaEscuro") === "true";
    const notificacoes = localStorage.getItem("notificacoes") !== "false";

    const checkTema = document.getElementById("check-tema-escuro");
    const checkNotif = document.getElementById("check-notificacoes");

    if (checkTema) checkTema.checked = temaEscuro;
    if (checkNotif) checkNotif.checked = notificacoes;
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
        .upload(fileName, arquivo, { cacheControl: '3600', upsert: true });

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
        alert("Erro ao salvar foto no perfil.");
        return;
    }

    localStorage.setItem("fotoUsuario", urlFotoPublica);
    const elemFoto = document.getElementById("voce-foto-perfil");
    if (elemFoto) elemFoto.src = urlFotoPublica;
    atualizarFotoAbaVoce();
}

function salvarPreferencias() {
    const checkNotif = document.getElementById("check-notificacoes");
    if (checkNotif) {
        localStorage.setItem("notificacoes", checkNotif.checked);
    }
}

function alternarTema() {
    const checkTema = document.getElementById("check-tema-escuro");
    const ativo = checkTema ? checkTema.checked : false;

    localStorage.setItem("temaEscuro", ativo);

    if (ativo) {
        document.body.classList.add("dark-theme");
        document.body.classList.remove("light-theme");
    } else {
        document.body.classList.add("light-theme");
        document.body.classList.remove("dark-theme");
    }
}

function abrirPrivacidade() {
    alert("Configurações de privacidade salvas por padrão.");
}

// ==========================================
// NOTIFICAÇÕES DO NAVEGADOR
// ==========================================
function solicitarPermissao() {
    if ("Notification" in window) {
        Notification.requestPermission().then((permissao) => {
            if (permissao === "granted") {
                console.log("Permissão para notificações concedida.");
            } else {
                console.log("Permissão para notificações negada.");
            }
        });
    } else {
        console.log("Este navegador não suporta notificações.");
    }
}

function enviarNotificacao(remetente, textoMensagem, emailRemetente, fotoRemetente) {
    const notificacoesAtivas = localStorage.getItem("notificacoes") !== "false";

    if ("Notification" in window && Notification.permission === "granted" && notificacoesAtivas) {
        
        // Dispara se a aba estiver em segundo plano ou o chat não estiver aberto
        if (document.hidden || destinatarioAtual !== emailRemetente) {
            const opcoes = {
                body: textoMensagem,
                icon: fotoRemetente || "svg/icon.svg",
                tag: `msg-${Date.now()}`,
                data: {
                    emailRemetente: emailRemetente,
                    remetente: remetente,
                    fotoRemetente: fotoRemetente
                }
            };

            // 1. Tenta disparar priorizando o Service Worker (Obrigatório para iOS)
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(remetente, opcoes);
                }).catch(err => {
                    console.error("Erro ao disparar notificação via SW:", err);
                });
            } 
            // 2. Fallback apenas para navegadores antigos de desktop que não usam SW
            else if (typeof Notification === "function") {
                const notificacao = new Notification(remetente, opcoes);
                notificacao.onclick = () => {
                    window.focus();
                    abrirChatCom(emailRemetente, remetente, fotoRemetente);
                };
            }
        }
    }
}
