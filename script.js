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

// Controle da reconexão do Realtime
let timeoutReconexaoRealtime = null;
let realtimeConectando = false;

// Estado para Solicitações de Chat
let solicitacaoAtual = null;

// ==========================================
// INICIALIZAÇÃO E SERVICE WORKER
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    verificarSessao();
    registrarServiceWorker();
    inicializarEventosSolicitacoes();
    
});


async function alternarNotificacoes(checkbox) {
    if (checkbox.checked) {
        if (!("Notification" in window)) {
            alert("Este navegador não suporta notificações de trabalho.");
            checkbox.checked = false;
            return;
        }

        const permissao = await Notification.requestPermission();

        if (permissao === "granted") {
            localStorage.setItem("notificacoes", "true");
        } else {
            alert("A permissão para notificações foi negada nas configurações do seu navegador.");
            checkbox.checked = false;
            localStorage.setItem("notificacoes", "false");
        }
    } else {
        localStorage.setItem("notificacoes", "false");
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
        document.getElementById("login").style.display = "flex";
    }
}

async function mostrarAppPrincipal() {
    esconderTelasAutenticacao();

    const telaConversas = document.getElementById("tela-conversas");
    const barraNavegacao = document.querySelector(".ultrabaixo");

    if (telaConversas) telaConversas.style.display = "block";
    if (barraNavegacao) barraNavegacao.style.display = "flex";

    await carregarListaContatos();
    carregarSolicitacoes();
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
    const introducaoVista = localStorage.getItem("introducaoVista");
    const emailSalvo = localStorage.getItem("usuarioLogado");

    if (!introducaoVista) {
        esconderTelasAutenticacao();

        const telaInicio = document.getElementById("inicio");

        if (telaInicio) {
            telaInicio.style.display = "flex";
        }

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

    if (timeoutReconexaoRealtime) {
        clearTimeout(timeoutReconexaoRealtime);
        timeoutReconexaoRealtime = null;
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

    // 1. Busca os contatos individuais
    const { data: relacaoContatos } = await _supabase
        .from("contatos")
        .select("contato_usuario")
        .eq("usuario_origem", meuUsuario);

    const nomesSalvos = relacaoContatos ? relacaoContatos.map(c => c.contato_usuario) : [];

    let usuarios = [];
    if (nomesSalvos.length > 0) {
        const { data: dadosUsuarios } = await _supabase
            .from("usuarios")
            .select("email, usuario, foto_url")
            .in("usuario", nomesSalvos);
        usuarios = dadosUsuarios || [];
    }

    const contatosComMensagens = await Promise.all(
        usuarios.map(async (contato) => {
            const { data: ultimasMsgs } = await _supabase
                .from("mensagens")
                .select("texto, created_at")
                .or(`and(remetente_email.eq.${meuEmail},destinatario_email.eq.${contato.email}),and(remetente_email.eq.${contato.email},destinatario_email.eq.${meuEmail})`)
                .order("created_at", { ascending: false })
                .limit(1);

            const temMsg = ultimasMsgs && ultimasMsgs.length > 0;

            return {
                ...contato,
                tipo: 'contato',
                identificador: contato.email,
                ultimaMsg: temMsg ? ultimasMsgs[0].texto : "Nenhuma mensagem ainda",
                horaUltimaMsg: temMsg ? formatarHora(ultimasMsgs[0].created_at) : ""
            };
        })
    );

    // 2. BUSCA OS GRUPOS USANDO A COLUNA CORRETA "usuario_nome"
    const { data: relacaoGrupos } = await _supabase
        .from("grupo_membros")
        .select("grupo_id")
        .eq("usuario_nome", meuUsuario);

    const idsGrupos = relacaoGrupos ? relacaoGrupos.map(g => g.grupo_id) : [];

    let meusGrupos = [];
    if (idsGrupos.length > 0) {
        const { data: dadosGrupos } = await _supabase
            .from("grupos")
            .select("id, nome, foto_url")
            .in("id", idsGrupos);
        meusGrupos = dadosGrupos || [];
    }

    const gruposFormatados = meusGrupos.map(grupo => ({
        ...grupo,
        tipo: 'grupo',
        identificador: grupo.id,
        usuario: grupo.nome,
        foto_url: grupo.foto_url || "svg/icon.svg", // Define um ícone padrão caso esteja vazio
        ultimaMsg: "Toque para ver o grupo",
        horaUltimaMsg: ""
    }));

    todosContatos = [...contatosComMensagens, ...gruposFormatados];
    renderizarContatos(todosContatos);
}

function renderizarContatos(lista) {
    const container = document.getElementById("lista-contatos");
    if (!container) return;

    container.innerHTML = "";

    if (lista.length === 0) {
        container.innerHTML = `
            <li style="color: #888; text-align: center; margin-top: 20px; font-family: sans-serif;">
                Nenhum contato ou grupo encontrado.
            </li>
        `;
        return;
    }

    lista.forEach(item => {
        const li = document.createElement("li");
        li.classList.add("item-contato");

        const foto = item.foto_url || "svg/icon.svg";
        const nome = item.usuario || item.nome;

        li.innerHTML = `
            <img src="${foto}" class="foto-contato">
            <div class="info-contato">
                <div class="info-contato-topo">
                    <span class="nome-contato">${nome} ${item.tipo === 'grupo' ? ' ' : ''}</span>
                    <span class="hora-contato">${item.horaUltimaMsg || ''}</span>
                </div>
                <span class="ultima-msg">${item.ultimaMsg}</span>
            </div>
        `;

        // Ao clicar, verifica se é um grupo ou um chat normal
        li.onclick = () => {
            if (item.tipo === 'grupo') {
                abrirChatGrupo(item.id, item.nome, foto);
            } else {
                abrirChatCom(item.identificador, nome, foto);
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
function renderizarBalao(texto, ehMinha, dataCriacao) {
    const container = document.getElementById("chat-mensagens");
    if (!container) return;

    const balao = document.createElement("div");
    balao.classList.add("balao-msg");
    balao.classList.add(ehMinha ? "balao-enviada" : "balao-recebida");

    const horaFormatada = formatarHora(dataCriacao || new Date());
    
    let conteudoHtml = "";

    // Verifica se a mensagem enviada é uma imagem
    if (texto && texto.startsWith("[FOTO]:")) {
        const urlImagem = texto.replace("[FOTO]:", "");
        conteudoHtml = `<img src="${urlImagem}" style="max-width: 200px; border-radius: 8px; display: block; cursor: pointer;" onclick="window.open('${urlImagem}', '_blank')">`;
    } else if (texto && texto.startsWith("[VIDEO]:")) {
        const urlVideo = texto.replace("[VIDEO]:", "");
        conteudoHtml = `<video src="${urlVideo}" controls preload="metadata" style="max-width: 200px; width: 100%; border-radius: 8px; display: block; background: #000;"></video>`;
    } else {
        conteudoHtml = `<span>${texto}</span>`;
    }

    
    balao.innerHTML = `
        ${conteudoHtml}
        <span class="balao-hora">${horaFormatada}</span>
    `;

    container.appendChild(balao);
    container.scrollTop = container.scrollHeight;
}
function renderizarBalaoGrupo(texto, ehMinha, timestamp, nomeRemetente) {
    const containerChat = document.getElementById("chat-mensagens");
    if (!containerChat) return;

    const divBalao = document.createElement("div");
    divBalao.className = ehMinha ? "balao-msg balao-enviada" : "balao-msg balao-recebida";

    // Se houver nome do remetente (em grupo)
    if (!ehMinha && nomeRemetente) {
        const spanNome = document.createElement("span");
        spanNome.style.color = "#ff7b00";
        spanNome.style.fontSize = "11px";
        spanNome.style.fontWeight = "bold";
        spanNome.style.marginBottom = "2px";
        spanNome.textContent = nomeRemetente;
        divBalao.appendChild(spanNome);
    }

    // --- VERIFICAÇÃO DE MÍDIA (IMAGEM OU VÍDEO) ---
    if (texto && texto.startsWith("[")) {
        const ehVideo = texto.startsWith("[VIDEO]");
        const urlArquivo = texto.split(": ")[1]; // Extrai o link após o prefixo

        if (ehVideo) {
            const videoElem = document.createElement("video");
            videoElem.src = urlArquivo;
            videoElem.controls = true; // Mostra os botões de play/pause/volume
            videoElem.style.maxWidth = "220px";
            videoElem.style.borderRadius = "8px";
            videoElem.style.marginTop = "4px";
            divBalao.appendChild(videoElem);
        } else {
            const imgElem = document.createElement("img");
            imgElem.src = urlArquivo;
            imgElem.style.maxWidth = "220px";
            imgElem.style.borderRadius = "8px";
            imgElem.style.marginTop = "4px";
            divBalao.appendChild(imgElem);
        }
    } else {
        // Mensagem de texto normal
        const spanTexto = document.createElement("span");
        spanTexto.textContent = texto;
        divBalao.appendChild(spanTexto);
    }

    // Horário da mensagem
    if (timestamp) {
        const spanHora = document.createElement("span");
        spanHora.className = "balao-hora";
        const data = new Date(timestamp);
        spanHora.textContent = !isNaN(data.getTime()) 
            ? data.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
            : timestamp;
        divBalao.appendChild(spanHora);
    }

    containerChat.appendChild(divBalao);
}

function acionarSeletorFotoChat() {
    const input = document.getElementById('input-arquivo-chat');
    if (input) {
        input.click();
    } else {
        console.error("Elemento 'input-arquivo-chat' não encontrado no HTML.");
    }
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
        renderizarBalao(
            msg.texto,
            msg.remetente_email === meuEmail,
            msg.created_at
        );
    });

    container.scrollTop = container.scrollHeight;
}

async function enviarMensagem() {
    const inputMsg = document.getElementById("input-mensagem");
    const texto = inputMsg ? inputMsg.value.trim() : "";
    const meuEmail = localStorage.getItem("usuarioLogado");

    if (!texto) return;

    // Define os dados da mensagem dependendo se está num grupo ou chat privado
    const dadosMensagem = {
        texto: texto,
        remetente_email: meuEmail,
        grupo_id: window.grupoAtualId ? window.grupoAtualId : null,
        destinatario_email: window.grupoAtualId ? null : destinatarioAtual
    };

    const { error } = await _supabase
        .from("mensagens")
        .insert([dadosMensagem]);

    if (error) {
        console.error("Erro ao enviar mensagem:", error.message);
        alert("Erro ao enviar mensagem.");
        return;
    }

    if (inputMsg) inputMsg.value = "";
    
    // Atualiza a tela imediatamente após o envio bem-sucedido
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


function abrirChatGrupo(idGrupo, nomeGrupo, fotoGrupo) {
    window.grupoAtualId = idGrupo; 
    destinatarioAtual = null; // Zera o chat privado

    const elemNome = document.getElementById("chat-nome-usuario");
    const elemFoto = document.getElementById("chat-foto-usuario");
    const telaChat = document.getElementById("tela-chat");
    const spanStatus = document.getElementById("chat-status-usuario");

    if (elemNome) elemNome.innerText = nomeGrupo;
    if (elemFoto && fotoGrupo) elemFoto.src = fotoGrupo;
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

    // Reseta o fundo do chat ao abrir o grupo
    const containerMensagens = document.getElementById("chat-mensagens");
    if (containerMensagens) containerMensagens.style.backgroundImage = "";

    // CHAMA A FUNÇÃO PARA PUXAR AS MENSAGENS DO GRUPO
    carregarMensagensGrupo(idGrupo);

    const chatInputBox = document.getElementById('chat-input-box');
    const chatActionBar = document.getElementById('chat-action-bar');
    if (chatInputBox) chatInputBox.classList.remove('hidden');
    if (chatActionBar) chatActionBar.classList.add('hidden');
}


async function carregarMensagensGrupo(idGrupo) {
    const meuEmail = localStorage.getItem("usuarioLogado");

    const { data: mensagens, error } = await _supabase
        .from("mensagens")
        .select("*")
        .eq("grupo_id", idGrupo)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("Erro ao carregar mensagens do grupo:", error.message);
        return;
    }

    const containerChat = document.getElementById("chat-mensagens"); 
    if (!containerChat) return;

    containerChat.innerHTML = "";

    for (const msg of (mensagens || [])) {
        // Validação correta comparando diretamente com o email logado
        const ehMinha = msg.remetente_email === meuEmail;
        let nomeRemetente = msg.remetente_email;

        if (!ehMinha) {
            // Busca amigável do nome de usuário pelo email remetente
            const { data: userData } = await _supabase
                .from("usuarios")
                .select("usuario, email")
                .eq("email", msg.remetente_email)
                .maybeSingle();
            
            if (userData) {
                nomeRemetente = userData.usuario || userData.email;
            }
        } else {
            nomeRemetente = "Você";
        }

        renderizarBalaoGrupo(
            msg.texto,
            ehMinha,
            msg.created_at,
            ehMinha ? null : nomeRemetente
        );
    }

    containerChat.scrollTop = containerChat.scrollHeight;
}

function abrirChatCom(emailDestinatario, nomeDestinatario, fotoDestinatario) {
    destinatarioAtual = emailDestinatario;
    window.grupoAtualId = null;

    const elemNome = document.getElementById("chat-nome-usuario");
    const elemFoto = document.getElementById("chat-foto-usuario");
    const telaChat = document.getElementById("tela-chat");

    if (elemNome) elemNome.innerText = nomeDestinatario || emailDestinatario;
    if (elemFoto && fotoDestinatario) elemFoto.src = fotoDestinatario;
    
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
// REALTIME
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
                carregarListaContatos(); // Atualiza a lista lateral com a última mensagem

                // Se o chat aberto for um grupo e a mensagem for desse grupo
                if (window.grupoAtualId && novaMsg.grupo_id === window.grupoAtualId) {
                    carregarMensagensGrupo(window.grupoAtualId);
                }
                
                // Se o chat aberto for privado (mantendo a sua lógica anterior)
                if (destinatarioAtual && novaMsg.remetente_email === destinatarioAtual) {
                    renderizarBalao(novaMsg.texto, false, novaMsg.created_at);
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

                if (destinatarioAtual && novaMsg.remetente_email === destinatarioAtual) {
                    renderizarBalao(novaMsg.texto, false, novaMsg.created_at);
                }
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

                if (destinatarioAtual && novaMsg.destinatario_email === destinatarioAtual) {
                    renderizarBalao(novaMsg.texto, true, novaMsg.created_at);
                }

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
                agendarReconexaoRealtime();
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

    if (email) {
        dadosEmail.textContent = email.textContent;
    }

    if (foto) {
        dadosFoto.src = foto.src;
    }

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

    document.getElementById('dados-foto-usuario').src = url;
    document.getElementById('voce-foto-perfil').src = url;
    document.getElementById('foto-aba-voce').src = url;
}

function abrirAlterarNome() {
    const nomeAtual = document.getElementById('voce-nome-usuario').textContent;

    const novoNome = prompt('Digite seu novo nome de usuário:', nomeAtual);

    if (!novoNome || novoNome.trim() === '') return;

    document.getElementById('voce-nome-usuario').textContent = novoNome.trim();
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

    todosContatos.forEach(contato => {
        const li = document.createElement('li');
        li.className = 'item-selecao-contato';
        const foto = contato.foto_url || "svg/icon.svg";
        const nome = contato.usuario || contato.email;

        li.innerHTML = `
            <div class="esq-contato-sel">
                <input type="checkbox" class="checkbox-membro" data-email="${contato.email}" data-nome="${nome}" onchange="tratarSelecaoMembro(this)">
                <img src="${foto}" class="foto-contato-pequena">
                <span class="nome-contato-sel">${nome}</span>
            </div>
        `;
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
