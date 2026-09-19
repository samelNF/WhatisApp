import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function adminKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return parsed.default;
    } catch (_) {}
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function textoNotificacao(texto?: string | null) {
  if (!texto) return "Nova mensagem";
  if (texto.startsWith("[FOTO]:") || texto.startsWith("[IMAGEM]:")) return "📷 Foto";
  if (texto.startsWith("[VIDEO]:")) return "🎥 Vídeo";
  if (texto.startsWith("[AUDIO]:")) return "🎤 Áudio";
  if (texto.startsWith("[CHAMADA]")) return "📞 Ligação de voz";
  if (texto.startsWith("[CHAMADA_GRUPO]")) return "📞 Ligação de voz em grupo";

  const limpo = texto.trim();
  return limpo.length > 140 ? limpo.slice(0, 137) + "..." : limpo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const key = adminKey();

  if (!supabaseUrl || !key) {
    return json({ ok: false, error: "Backend Supabase indisponível." }, 500);
  }

  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const action = String(body?.action || "");

  if (action === "session") {
    const email = String(body?.email || "").trim().toLowerCase();
    const senhaHash = String(body?.senha_hash || "");

    if (!email || !senhaHash) {
      return json({ ok: false, error: "Credenciais ausentes." }, 400);
    }

    const { data: usuario, error } = await supabase
      .from("usuarios")
      .select("email, senha")
      .eq("email", email)
      .maybeSingle();

    if (error || !usuario || usuario.senha !== senhaHash) {
      return json({ ok: false, error: "Credenciais inválidas." }, 401);
    }

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = b64url(tokenBytes);
    const tokenHash = await sha256(token);

    await supabase
      .from("push_sessions")
      .delete()
      .eq("usuario_email", email);

    const { error: erroSessao } = await supabase
      .from("push_sessions")
      .insert({
        token_hash: tokenHash,
        usuario_email: email,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      });

    if (erroSessao) {
      return json({ ok: false, error: erroSessao.message }, 500);
    }

    return json({ ok: true, token });
  }

  if (action === "register" || action === "unregister" || action === "mark-seen") {
    const token = String(body?.session_token || "");
    if (!token) {
      return json({ ok: false, error: "Sessão Push ausente." }, 401);
    }

    const tokenHash = await sha256(token);

    const { data: sessao, error: erroSessao } = await supabase
      .from("push_sessions")
      .select("usuario_email, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (
      erroSessao ||
      !sessao ||
      !sessao.expires_at ||
      new Date(sessao.expires_at).getTime() <= Date.now()
    ) {
      return json({ ok: false, error: "Sessão Push inválida ou expirada." }, 401);
    }

    const email = String(sessao.usuario_email || "").trim().toLowerCase();

    if (action === "mark-seen") {
      const contatoEmail = String(body?.contato_email || "").trim().toLowerCase();

      if (!contatoEmail) {
        return json({ ok: false, error: "Contato ausente." }, 400);
      }

      const { data: atualizadas, error: erroAtualizar } = await supabase
        .from("mensagens")
        .update({ visualizada: true })
        .eq("destinatario_email", email)
        .eq("remetente_email", contatoEmail)
        .is("grupo_id", null)
        .eq("visualizada", false)
        .select("*");

      if (erroAtualizar) {
        return json({ ok: false, error: erroAtualizar.message }, 500);
      }

      return json({
        ok: true,
        updated: atualizadas?.length || 0,
        mensagens: atualizadas || []
      });
    }

    if (action === "register") {
      const subscription = body?.subscription;

      if (
        !subscription?.endpoint ||
        !subscription?.keys?.p256dh ||
        !subscription?.keys?.auth
      ) {
        return json({ ok: false, error: "PushSubscription incompleta." }, 400);
      }

      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            endpoint: subscription.endpoint,
            usuario_email: email,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            expiration_time: subscription.expirationTime ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );

      if (error) {
        return json({ ok: false, error: error.message }, 500);
      }

      return json({ ok: true, registered: true });
    }

    const endpoint = String(body?.endpoint || "");
    if (!endpoint) {
      return json({ ok: false, error: "Endpoint ausente." }, 400);
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("usuario_email", email);

    if (error) {
      return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true, unregistered: true });
  }

  if (action === "notify-message") {
    const { data: config, error: erroConfig } = await supabase
      .from("push_config")
      .select("vapid_public_key, vapid_private_key, vapid_subject, webhook_secret")
      .eq("id", 1)
      .maybeSingle();

    if (erroConfig || !config) {
      return json({ ok: false, error: "Configuração Push ausente." }, 500);
    }

    const segredoRecebido = String(body?.webhook_secret || "");
    if (!segredoRecebido || segredoRecebido !== config.webhook_secret) {
      return json({ ok: false, error: "Não autorizado." }, 401);
    }

    const messageId = body?.message_id;

    if (messageId === null || messageId === undefined || messageId === "") {
      return json({ ok: false, error: "message_id ausente." }, 400);
    }

    const { data: mensagem, error: erroMensagem } = await supabase
      .from("mensagens")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();

    if (erroMensagem || !mensagem) {
      return json(
        { ok: false, error: erroMensagem?.message || "Mensagem não encontrada." },
        404,
      );
    }

    const remetenteEmail = String(mensagem.remetente_email || "")
      .trim()
      .toLowerCase();

    const destinatarios = new Set<string>();

    if (mensagem.grupo_id) {
      const { data: membros, error: erroMembros } = await supabase
        .from("grupo_membros")
        .select("usuario_email")
        .eq("grupo_id", mensagem.grupo_id);

      if (erroMembros) {
        return json({ ok: false, error: erroMembros.message }, 500);
      }

      for (const membro of membros || []) {
        const email = String(membro.usuario_email || "").trim().toLowerCase();
        if (email && email !== remetenteEmail) destinatarios.add(email);
      }
    } else {
      const email = String(mensagem.destinatario_email || "").trim().toLowerCase();
      if (email && email !== remetenteEmail) destinatarios.add(email);
    }

    if (!destinatarios.size) {
      return json({ ok: true, sent: 0, reason: "Sem destinatários." });
    }

    const { data: usuarioRemetente } = await supabase
      .from("usuarios")
      .select("usuario")
      .eq("email", mensagem.remetente_email)
      .maybeSingle();

    const nomeRemetente =
      usuarioRemetente?.usuario ||
      mensagem.remetente_email ||
      "Contato";

    let titulo = nomeRemetente;
    let corpo = textoNotificacao(mensagem.texto);

    const ehChamada =
      mensagem.tipo === "chamada" ||
      mensagem.texto === "[CHAMADA]";

    const ehChamadaGrupo =
      mensagem.tipo === "chamada_grupo" ||
      mensagem.texto === "[CHAMADA_GRUPO]";

    if (ehChamadaGrupo) {
      corpo =
        mensagem?.meta?.modo === "video" ||
        mensagem?.meta?.tipo_chamada === "video_grupo"
          ? "🎥 Ligação de vídeo em grupo"
          : "📞 Ligação de voz em grupo";
    } else if (ehChamada) {
      corpo =
        mensagem?.meta?.modo === "video" ||
        mensagem?.meta?.tipo_chamada === "video"
          ? "🎥 Ligação de vídeo"
          : "📞 Ligação de voz";
    }

    if (mensagem.grupo_id) {
      const { data: grupo } = await supabase
        .from("grupos")
        .select("nome")
        .eq("id", mensagem.grupo_id)
        .maybeSingle();

      titulo = grupo?.nome || "Grupo";
      if (!ehChamadaGrupo) {
        corpo = nomeRemetente + ": " + corpo;
      }
    }

    const listaDestinatarios = Array.from(destinatarios);

    const { data: subscriptions, error: erroSubscriptions } = await supabase
      .from("push_subscriptions")
      .select("endpoint, usuario_email, p256dh, auth")
      .in("usuario_email", listaDestinatarios);

    if (erroSubscriptions) {
      return json({ ok: false, error: erroSubscriptions.message }, 500);
    }

    if (!subscriptions?.length) {
      return json({ ok: true, sent: 0, reason: "Destinatário sem PushSubscription." });
    }

    const endpoints = subscriptions.map((item) => item.endpoint);

    const { data: entregasExistentes } = await supabase
      .from("push_entregas")
      .select("endpoint")
      .eq("mensagem_id", messageId)
      .in("endpoint", endpoints);

    const jaEnviados = new Set(
      (entregasExistentes || []).map((item) => item.endpoint),
    );

    webpush.setVapidDetails(
      config.vapid_subject,
      config.vapid_public_key,
      config.vapid_private_key,
    );

    let urlDestino = "/WhatisApp/";

    if (ehChamada && mensagem.chamada_id) {
      urlDestino =
        "/WhatisApp/?call=" +
        encodeURIComponent(String(mensagem.chamada_id));
    } else if (ehChamadaGrupo && mensagem.chamada_id) {
      urlDestino =
        "/WhatisApp/?groupCall=" +
        encodeURIComponent(String(mensagem.chamada_id)) +
        "&group=" +
        encodeURIComponent(String(mensagem.grupo_id || ""));
    }

    const payload = JSON.stringify({
      title: titulo,
      body: corpo,
      tag:
        (ehChamadaGrupo
          ? "chamada-grupo-"
          : (ehChamada ? "chamada-" : "mensagem-")) +
        String(messageId),
      data: {
        url: urlDestino,
        tipo: ehChamadaGrupo
          ? "chamada_grupo"
          : (ehChamada
              ? "chamada"
              : (mensagem.grupo_id ? "grupo" : "privado")),
        chamada_id:
          (ehChamada || ehChamadaGrupo)
            ? (mensagem.chamada_id || null)
            : null,
        grupo_id: mensagem.grupo_id || null,
        remetente_email: mensagem.remetente_email || null,
        mensagem_id: mensagem.id,
      },
    });

    let sent = 0;
    let removed = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      if (jaEnviados.has(subscription.endpoint)) continue;

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          { TTL: 300, urgency: "high" },
        );

        sent++;

        await supabase.from("push_entregas").insert({
          mensagem_id: messageId,
          endpoint: subscription.endpoint,
        });
      } catch (erro: any) {
        const statusCode = Number(erro?.statusCode || 0);

        if (statusCode === 404 || statusCode === 410) {
          removed++;

          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", subscription.endpoint);
        } else {
          failed++;
          console.error("Erro enviando Web Push:", statusCode, erro?.message || erro);
        }
      }
    }

    return json({
      ok: true,
      sent,
      removed,
      failed,
      recipients: listaDestinatarios.length,
    });
  }

  return json({ ok: false, error: "Ação desconhecida." }, 400);
});
