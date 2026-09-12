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
    esconderTelasAutenticacao();
}

verificarSessao();

function deslogar() {
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("nomeUsuario");
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

    const { data, error } = await _supabase
        .from("usuarios")
        .update({ usuario: usuarioInput })
        .eq("email", emailCadastrado)
        .select();

    if (error || !data || data.length === 0) {
        alert("Erro ao salvar o nome de usuário.");
        return;
    }

    localStorage.setItem("usuarioLogado", emailCadastrado);
    localStorage.setItem("nomeUsuario", usuarioInput);
    sessionStorage.removeItem("emailCadastro");

    alert("Cadastro concluído com sucesso!");
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
        alert("Login realizado com sucesso!");
        esconderTelasAutenticacao();
    } else {
        alert("E-mail ou senha incorretos.");
    }
}