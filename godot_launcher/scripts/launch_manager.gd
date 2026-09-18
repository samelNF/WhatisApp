extends RefCounted
class_name LaunchManager

signal launch_ready(command: String, args: PackedStringArray)
signal launch_failed(message: String)

var java_path := "java"
var game_dir := "user://.minecraft"

func build_launch(version_id: String, profile: Dictionary) -> void:
	if version_id.strip_edges() == "":
		launch_failed.emit("Selecione uma versão antes de jogar.")
		return
	if profile.is_empty():
		launch_failed.emit("Faça login antes de iniciar o jogo.")
		return

	# Base simplificada para protótipo.
	# Completar com parsing de version.json, libraries e assets.
	var username := str(profile.get("username", "Player"))
	var uuid := str(profile.get("uuid", ""))
	var token := str(profile.get("access_token", ""))

	var args := PackedStringArray([
		"-Xmx2G",
		"-Dminecraft.launcher.brand=MreCrafter",
		"-Dminecraft.launcher.version=0.1.0",
		"-cp", "<classpath-placeholder>",
		"net.minecraft.client.main.Main",
		"--username", username,
		"--version", version_id,
		"--gameDir", ProjectSettings.globalize_path(game_dir),
		"--assetsDir", "<assets-dir-placeholder>",
		"--assetIndex", version_id,
		"--uuid", uuid,
		"--accessToken", token,
		"--userType", "msa"
	])

	launch_ready.emit(java_path, args)
