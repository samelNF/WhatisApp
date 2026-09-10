function mostrarSenha() {
    const senha = document.getElementById("senha");

    if (senha.type === "password") {
        senha.type = "text";
    } else {
        senha.type = "password";
    };
}

function criarConta() {
    const email = document.getElementById("email").value;
    const senha = document.getElementById("senha").value;
    const usuario = document.getElementById("usuario").value;
    const criarConta = document.getElementById("criar-conta");

    if (email === "" || senha === "" || usuario === "") {
        alert("Por favor, preencha todos os campos.");
        return;
    };
    if (!email.includes("@") || !email.includes(".")) {
        alert("Digite um email válido.");
        return;
    };
    if (senha.length < 8 || senha.length > 12) {
        alert("A senha tem que ter entre 8 e 12 caracteres.");
        return;
    };
    
    console.log("pronto");
   
    const conta = {
        email: email,
        senha: senha,
        usuario: usuario
    };

    localStorage.setItem("conta", JSON.stringify({
    email: email,
    usuario: usuario,
    senha: senha
    }));

    console.log("Conta criada!");

    criarConta.style.display = "none";
    
}
function pegarConta() {
    const dados = localStorage.getItem("conta");

    if (dados === null) {
        console.log("Nenhuma conta encontrada.");
        return;
    }

    const conta = JSON.parse(dados);

    console.log("Email:", conta.email);
    console.log("Usuário:", conta.usuario);
}
