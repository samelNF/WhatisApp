# MreCrafter Launcher (Godot/GDScript)

Launcher de Minecraft com interface inspirada no launcher oficial, feito para ser **fácil de modificar em GDScript**.

## Recursos implementados (base)

- Interface com:
  - seleção de perfil/conta
  - seleção de versão
  - botão principal de jogar
  - status de autenticação e download
- Suporte de autenticação (estrutura):
  - **Offline** (nickname local)
  - **Online/Microsoft** (stub pronto para OAuth device code)
  - **Ely.by** (fluxo via endpoint JSON configurável)
- Persistência local em `user://profiles.json`
- Estrutura separada em managers para facilitar manutenção

## Estrutura

- `project.godot`: projeto Godot 4
- `scenes/Main.tscn`: cena principal
- `scripts/main.gd`: UI/controller principal
- `scripts/auth_manager.gd`: autenticação por provedor
- `scripts/profile_store.gd`: salvar/carregar perfis
- `scripts/launch_manager.gd`: preparação/comando de execução Java

## Próximos passos sugeridos

1. Implementar OAuth Microsoft completo no `AuthManager._login_microsoft()`.
2. Validar endpoints atuais da Ely.by e mapear campos retornados no token/profile.
3. Integrar download de versões/assets/libraries (manifest Mojang) no `LaunchManager`.
4. Adicionar seleção de diretório `.minecraft` e Java runtime na UI.

## Executando

1. Abra a pasta `godot_launcher` no Godot 4.2+.
2. Rode a cena principal (`scenes/Main.tscn`).

> Observação: este projeto é uma base funcional e modular. O fluxo de execução real do Minecraft depende de completar a parte de download/args por versão no `LaunchManager`.
