const supabaseUrl = 'https://qlvorxobvnjoovqxnfhp.supabase.co';
const supabaseKey = 'sb_publishable_IoDWf91jWwRgamUfmdDQow_1-fIMHZO';
const _supabase = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

function mostrarSenha() {
    const senha = document.getElementById("senha");
    senha.type = senha.type === "password" ? "text" : "password";
}

function mostrarSenhaLogin() {
    const senha = document.getElementById("login-senha");
    senha.type = senha.type === "password" ? "text" : "password";
}

function mostrarTela(idTela) {
    document.getElementById("login").style.display = "none";
    document.getElementById("criar-conta").style.display = "none";
    document.getElementById("etapa-usuario").style.display = "none";

    const telaAlvo = document.getElementById(idTela);
    if (telaAlvo) telaAlvo.style.display = "flex";
}

function esconderTelasAutenticacao() {
    document.getElementById("login").style.display = "none";
    document.getElementById("criar-conta").style.display = "none";
    document.getElementById("etapa-usuario").style.display = "none";
}

function atualizarFotoAbaVoce() {
    const fotoSalva = localStorage.getItem("fotoUsuario");
    const imgVoce = document.getElementById("foto-aba-voce");

    if (imgVoce && fotoSalva) {
        imgVoce.src = fotoSalva;
    }
}

// ==========================================
// PERSISTÊNCIA DE SESSÃO
// ==========================================
async function verificarSessao() {
    const emailSalvo = localStorage.getItem("usuarioLogado");

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

    // Salva e atualiza a foto do usuário
    if (usuario.foto_url) {
        localStorage.setItem("fotoUsuario", usuario.foto_url);
    }
    atualizarFotoAbaVoce();
    esconderTelasAutenticacao();
}

verificarSessao();

function deslogar() {
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("nomeUsuario");
    localStorage.removeItem("fotoUsuario");
    alert("Sessão encerrada!");
    window.location.reload();
}

// ==========================================
// CADASTRO E CONEXÃO
// ==========================================
async function gerarHash(texto) {
    const dados = new TextEncoder().encode(texto);
    const hash = await crypto.subtle.digest("SHA-256", dados);
    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

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

let arquivoFotoSelecionado = null;

function previewFoto(event) {
    const file = event.target.files[0];
    if (file) {
        arquivoFotoSelecionado = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById("avatar-preview").src = e.target.result;
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
    alert("Perfil criado com sucesso!");
    atualizarFotoAbaVoce();
    esconderTelasAutenticacao();
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
        alert("Login realizado com sucesso!");
        atualizarFotoAbaVoce();
        esconderTelasAutenticacao();
    } else {
        alert("E-mail ou senha incorretos.");
    }
}
function alternarAba(botaoClicado) {
    const botoes = document.querySelectorAll('.baixo button');
    botoes.forEach(btn => btn.classList.remove('ativo'));
    
    botaoClicado.classList.add('ativo');
}