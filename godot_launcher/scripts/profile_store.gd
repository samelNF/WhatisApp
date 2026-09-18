extends RefCounted
class_name ProfileStore

const PROFILES_PATH := "user://profiles.json"

func load_profiles() -> Dictionary:
	if not FileAccess.file_exists(PROFILES_PATH):
		return {"last_profile": "", "profiles": {}}

	var file := FileAccess.open(PROFILES_PATH, FileAccess.READ)
	if file == null:
		return {"last_profile": "", "profiles": {}}

	var content := file.get_as_text()
	var parsed = JSON.parse_string(content)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {"last_profile": "", "profiles": {}}

	return parsed

func save_profiles(data: Dictionary) -> void:
	var file := FileAccess.open(PROFILES_PATH, FileAccess.WRITE)
	if file == null:
		push_error("Não foi possível salvar perfis em %s" % PROFILES_PATH)
		return
	file.store_string(JSON.stringify(data, "\t"))

func upsert_profile(provider: String, username: String, auth_payload: Dictionary) -> void:
	var db := load_profiles()
	if not db.has("profiles"):
		db["profiles"] = {}

	var key := "%s:%s" % [provider, username]
	db["profiles"][key] = {
		"provider": provider,
		"username": username,
		"auth": auth_payload,
		"updated_at_unix": Time.get_unix_time_from_system()
	}
	db["last_profile"] = key
	save_profiles(db)

func get_last_profile() -> Dictionary:
	var db := load_profiles()
	var key := db.get("last_profile", "")
	if key == "":
		return {}
	return db.get("profiles", {}).get(key, {})
