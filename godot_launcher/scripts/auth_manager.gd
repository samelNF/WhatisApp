extends RefCounted
class_name AuthManager

signal login_succeeded(profile: Dictionary)
signal login_failed(message: String)

const PROVIDER_OFFLINE := "offline"
const PROVIDER_MICROSOFT := "microsoft"
const PROVIDER_ELYBY := "elyby"

# Endpoint pode mudar; mantenha configurável.
var elyby_auth_endpoint := "https://account.ely.by/api/auth"

func login(provider: String, username: String, password: String = "") -> void:
	match provider:
		PROVIDER_OFFLINE:
			_login_offline(username)
		PROVIDER_MICROSOFT:
			_login_microsoft(username)
		PROVIDER_ELYBY:
			await _login_elyby(username, password)
		_:
			login_failed.emit("Provedor inválido: %s" % provider)

func _login_offline(username: String) -> void:
	var nick := username.strip_edges()
	if nick.length() < 3:
		login_failed.emit("Nick offline precisa ter ao menos 3 caracteres.")
		return

	login_succeeded.emit({
		"provider": PROVIDER_OFFLINE,
		"username": nick,
		"uuid": _pseudo_uuid_from_string(nick),
		"access_token": "offline-token"
	})

func _login_microsoft(username_hint: String) -> void:
	# Stub para fácil substituição posterior:
	# 1) Device code (Microsoft)
	# 2) XBL/XSTS
	# 3) Minecraft services login
	# 4) profile endpoint
	if username_hint.strip_edges() == "":
		login_failed.emit("Informe um usuário para identificar a sessão Microsoft.")
		return

	login_succeeded.emit({
		"provider": PROVIDER_MICROSOFT,
		"username": username_hint,
		"uuid": _pseudo_uuid_from_string(username_hint),
		"access_token": "microsoft-token-placeholder"
	})

func _login_elyby(username: String, password: String) -> void:
	if username.strip_edges() == "" or password == "":
		login_failed.emit("Usuário e senha da Ely.by são obrigatórios.")
		return

	var http := HTTPRequest.new()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(http)

	var body := JSON.stringify({
		"username": username,
		"password": password
	})

	var headers := PackedStringArray([
		"Content-Type: application/json"
	])

	var err := http.request(elyby_auth_endpoint, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		http.queue_free()
		login_failed.emit("Falha ao iniciar requisição Ely.by (%s)." % err)
		return

	var result := await http.request_completed
	http.queue_free()

	var status_code: int = result[1]
	var raw: PackedByteArray = result[3]
	var text := raw.get_string_from_utf8()
	var parsed = JSON.parse_string(text)

	if status_code < 200 or status_code >= 300:
		var detail := text if text.length() > 0 else "erro HTTP %s" % status_code
		login_failed.emit("Ely.by recusou login: %s" % detail)
		return

	if typeof(parsed) != TYPE_DICTIONARY:
		login_failed.emit("Resposta inválida da Ely.by.")
		return

	var selected_username := str(parsed.get("username", username))
	var uuid := str(parsed.get("uuid", _pseudo_uuid_from_string(username)))
	var token := str(parsed.get("accessToken", parsed.get("token", "")))
	if token == "":
		login_failed.emit("Resposta Ely.by sem token de acesso.")
		return

	login_succeeded.emit({
		"provider": PROVIDER_ELYBY,
		"username": selected_username,
		"uuid": uuid,
		"access_token": token
	})

func _pseudo_uuid_from_string(text: String) -> String:
	var hash := text.sha256_text()
	return "%s-%s-%s-%s-%s" % [
		hash.substr(0, 8),
		hash.substr(8, 4),
		hash.substr(12, 4),
		hash.substr(16, 4),
		hash.substr(20, 12)
	]
