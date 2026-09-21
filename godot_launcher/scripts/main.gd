extends Control

@onready var provider_select: OptionButton = $Panel/Margin/VBox/ProviderSelect
@onready var username_input: LineEdit = $Panel/Margin/VBox/UsernameInput
@onready var password_input: LineEdit = $Panel/Margin/VBox/PasswordInput
@onready var version_select: OptionButton = $Panel/Margin/VBox/VersionSelect
@onready var login_button: Button = $Panel/Margin/VBox/Buttons/LoginButton
@onready var play_button: Button = $Panel/Margin/VBox/Buttons/PlayButton
@onready var status_label: Label = $Panel/Margin/VBox/Status

var auth := AuthManager.new()
var store := ProfileStore.new()
var launcher := LaunchManager.new()
var current_profile: Dictionary = {}

func _ready() -> void:
	_setup_options()
	_connect_signals()
	_try_restore_last_profile()
	_set_status("Status: pronto para login")

func _setup_options() -> void:
	provider_select.clear()
	provider_select.add_item("Offline", 0)
	provider_select.add_item("Online (Microsoft)", 1)
	provider_select.add_item("Ely.by", 2)

	version_select.clear()
	version_select.add_item("1.20.1", 0)
	version_select.add_item("1.20.4", 1)
	version_select.add_item("1.21.1", 2)
	version_select.add_item("Snapshot (custom)", 3)

func _connect_signals() -> void:
	login_button.pressed.connect(_on_login_pressed)
	play_button.pressed.connect(_on_play_pressed)
	provider_select.item_selected.connect(_on_provider_changed)
	auth.login_succeeded.connect(_on_login_ok)
	auth.login_failed.connect(_on_login_error)
	launcher.launch_ready.connect(_on_launch_ready)
	launcher.launch_failed.connect(_on_launch_failed)

func _try_restore_last_profile() -> void:
	var profile := store.get_last_profile()
	if profile.is_empty():
		return
	current_profile = profile.get("auth", {})
	username_input.text = str(profile.get("username", ""))

	var provider := str(profile.get("provider", AuthManager.PROVIDER_OFFLINE))
	match provider:
		AuthManager.PROVIDER_OFFLINE:
			provider_select.select(0)
		AuthManager.PROVIDER_MICROSOFT:
			provider_select.select(1)
		AuthManager.PROVIDER_ELYBY:
			provider_select.select(2)

	play_button.disabled = false
	_set_status("Status: perfil restaurado (%s)" % provider)

func _on_provider_changed(index: int) -> void:
	password_input.editable = index == 2
	password_input.placeholder_text = "Senha exigida para Ely.by" if index == 2 else "Não necessário para este modo"

func _on_login_pressed() -> void:
	_set_status("Status: autenticando...")
	login_button.disabled = true

	var provider := _selected_provider_key()
	await auth.login(provider, username_input.text, password_input.text)

	login_button.disabled = false

func _on_play_pressed() -> void:
	var version := version_select.get_item_text(version_select.selected)
	launcher.build_launch(version, current_profile)

func _on_login_ok(profile: Dictionary) -> void:
	current_profile = profile
	store.upsert_profile(profile.get("provider", "unknown"), profile.get("username", "player"), profile)
	play_button.disabled = false
	_set_status("Status: logado como %s (%s)" % [profile.get("username", "?"), profile.get("provider", "?")])

func _on_login_error(message: String) -> void:
	play_button.disabled = true
	_set_status("Erro de login: %s" % message)

func _on_launch_ready(command: String, args: PackedStringArray) -> void:
	_set_status("Pronto para iniciar: %s %s" % [command, " ".join(args)])
	# Para executar de fato, descomente e adapte para desktop:
	# OS.create_process(command, args, false)

func _on_launch_failed(message: String) -> void:
	_set_status("Falha ao iniciar: %s" % message)

func _selected_provider_key() -> String:
	match provider_select.selected:
		0:
			return AuthManager.PROVIDER_OFFLINE
		1:
			return AuthManager.PROVIDER_MICROSOFT
		2:
			return AuthManager.PROVIDER_ELYBY
		_:
			return AuthManager.PROVIDER_OFFLINE

func _set_status(text: String) -> void:
	status_label.text = text
