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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

function textoNotificacao(texto?: string | null) {
  if (!texto) return "Nova mensagem";
  if (texto.startsWith("[FOTO]:") || texto.startsWith("[IMAGEM]:")) return "📷 Foto";
  if (texto.startsWith("[VIDEO]:")) return "🎥 Vídeo";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "Supabase não configurado na função." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let body: any = {};

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const action = body?.action;

  if (action === "register") {
    const email = String(body?.email || "").trim().toLowerCase();
    const subscription = body?.subscription;

    if (
      !email ||
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return json({ ok: false, error: "Assinatura incompleta." }, 400);
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
        {
          onConflict: "endpoint",
        },
      );

    if (error) {
      console.error("Erro registrando push:", error);
      return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true, registered: true });
  }

  if (action === "unregister") {
    const endpoint = String(body?.endpoint || "").trim();

    if (!endpoint) {
      return json({ ok: false, error: "Endpoint ausente." }, 400);
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);

    if (error) {
      return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true, unregistered: true });
  }

  if (action === "notify-message") {
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      return json({
        ok: false,
        error: "VAPID ainda não foi configurado nos Secrets da função.",
      }, 503);
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
      return json({
        ok: false,
        error: erroMensagem?.message || "Mensagem não encontrada.",
      }, 404);
    }

    const remetenteEmail = String(mensagem.remetente_email || "").trim().toLowerCase();
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

    if (mensagem.grupo_id) {
      const { data: grupo } = await supabase
        .from("grupos")
        .select("nome")
        .eq("id", mensagem.grupo_id)
        .maybeSingle();

      titulo = grupo?.nome || "Grupo";
      corpo = nomeRemetente + ": " + corpo;
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
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey,
    );

    const payload = JSON.stringify({
      title: titulo,
      body: corpo,
      tag: "mensagem-" + String(messageId),
      data: {
        tipo: mensagem.grupo_id ? "grupo" : "privado",
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
          {
            TTL: 60,
            urgency: "high",
          },
        );

        sent++;

        await supabase
          .from("push_entregas")
          .insert({
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
