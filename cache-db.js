// ==========================================
// CACHE LOCAL DO WHATISAPP
// ==========================================
// IndexedDB para mensagens + Cache Storage para fotos recentes.
// O cache é separado por conta e por conversa.

(function () {
    const DB_NAME = 'WhatisAppLocal';
    const DB_VERSION = 1;
    const STORE_MENSAGENS = 'mensagens';
    const MAX_MENSAGENS_POR_CONVERSA = 500;
    const CACHE_MIDIAS = 'whatisapp-midias-v1';

    let dbPromise = null;

    function abrirBanco() {
        if (!('indexedDB' in window)) return Promise.resolve(null);
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains(STORE_MENSAGENS)) {
                    const store = db.createObjectStore(STORE_MENSAGENS, {
                        keyPath: '_cacheId'
                    });

                    store.createIndex('_conversa', '_conversa', { unique: false });
                    store.createIndex('_conversaData', ['_conversa', 'created_at'], { unique: false });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(erro => {
            console.warn('[Cache] IndexedDB indisponível:', erro);
            return null;
        });

        return dbPromise;
    }

    function meuEmail() {
        return (localStorage.getItem('usuarioLogado') || '').trim().toLowerCase();
    }

    function conversaPrivada(emailContato) {
        return 'privado|' + meuEmail() + '|' + String(emailContato || '').trim().toLowerCase();
    }

    function conversaGrupo(idGrupo) {
        return 'grupo|' + meuEmail() + '|' + String(idGrupo || '');
    }

    function limparCamposInternos(msg) {
        if (!msg) return msg;
        const clone = { ...msg };
        delete clone._cacheId;
        delete clone._conversa;
        delete clone._salvoEm;
        return clone;
    }

    function chaveMensagem(conversa, msg) {
        const id = msg?.id !== undefined && msg?.id !== null
            ? String(msg.id)
            : [
                msg?.remetente_email || '',
                msg?.created_at || '',
                msg?.texto || ''
            ].join('|');

        return conversa + '|' + id;
    }

    async function salvarMensagens(conversa, mensagens) {
        const db = await abrirBanco();
        if (!db || !conversa || !Array.isArray(mensagens) || !mensagens.length) return;

        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_MENSAGENS, 'readwrite');
            const store = tx.objectStore(STORE_MENSAGENS);

            mensagens.forEach(msg => {
                if (!msg) return;

                store.put({
                    ...msg,
                    _cacheId: chaveMensagem(conversa, msg),
                    _conversa: conversa,
                    _salvoEm: Date.now()
                });
            });

            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        }).catch(erro => console.warn('[Cache] Erro salvando mensagens:', erro));

        apararConversa(conversa).catch(() => {});
        cachearMidiasDasMensagens(mensagens).catch(() => {});
    }

    async function listarMensagens(conversa) {
        const db = await abrirBanco();
        if (!db || !conversa) return [];

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_MENSAGENS, 'readonly');
            const index = tx.objectStore(STORE_MENSAGENS).index('_conversa');
            const req = index.getAll(IDBKeyRange.only(conversa));

            req.onsuccess = () => {
                const lista = (req.result || [])
                    .map(limparCamposInternos)
                    .sort((a, b) => {
                        const ta = new Date(a.created_at || 0).getTime();
                        const tb = new Date(b.created_at || 0).getTime();
                        if (ta !== tb) return ta - tb;

                        const ia = Number(a.id);
                        const ib = Number(b.id);
                        if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib;
                        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
                    });

                resolve(lista);
            };

            req.onerror = () => reject(req.error);
        }).catch(erro => {
            console.warn('[Cache] Erro lendo mensagens:', erro);
            return [];
        });
    }

    async function apararConversa(conversa) {
        const db = await abrirBanco();
        if (!db) return;

        const itens = await listarMensagens(conversa);
        if (itens.length <= MAX_MENSAGENS_POR_CONVERSA) return;

        const remover = itens.slice(0, itens.length - MAX_MENSAGENS_POR_CONVERSA);
        if (!remover.length) return;

        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_MENSAGENS, 'readwrite');
            const store = tx.objectStore(STORE_MENSAGENS);

            remover.forEach(msg => store.delete(chaveMensagem(conversa, msg)));

            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async function ultimaMensagem(conversa) {
        const lista = await listarMensagens(conversa);
        return lista.length ? lista[lista.length - 1] : null;
    }

    async function mensagemPorId(conversa, id) {
        if (id === null || id === undefined) return null;
        const lista = await listarMensagens(conversa);
        return lista.find(msg => String(msg.id) === String(id)) || null;
    }

    function extrairUrlMidia(texto) {
        if (typeof texto !== 'string') return null;

        if (texto.startsWith('[FOTO]:')) {
            return { tipo: 'foto', url: texto.replace('[FOTO]:', '').trim() };
        }

        if (texto.startsWith('[VIDEO]:')) {
            return { tipo: 'video', url: texto.replace('[VIDEO]:', '').trim() };
        }

        return null;
    }

    async function cachearMidiasDasMensagens(mensagens) {
        if (!('caches' in window) || !Array.isArray(mensagens)) return;

        const cache = await caches.open(CACHE_MIDIAS);

        for (const msg of mensagens) {
            const midia = extrairUrlMidia(msg?.texto);
            if (!midia?.url) continue;

            // Fotos são leves e valem muito a pena guardar.
            // Vídeos continuam usando o cache HTTP normal para não lotar o aparelho.
            if (midia.tipo !== 'foto') continue;

            try {
                const req = new Request(midia.url, { mode: 'cors' });
                const existente = await cache.match(req);
                if (existente) continue;

                const resposta = await fetch(req);
                if (resposta.ok || resposta.type === 'opaque') {
                    await cache.put(req, resposta.clone());
                }
            } catch (e) {
                // Falha de cache nunca deve impedir o chat.
            }
        }
    }

    window.WhatisCache = {
        conversaPrivada,
        conversaGrupo,
        salvarMensagens,
        listarMensagens,
        ultimaMensagem,
        mensagemPorId,
        cachearMidiasDasMensagens,

        async limparConversa(conversa) {
            const db = await abrirBanco();
            if (!db || !conversa) return;

            const lista = await listarMensagens(conversa);

            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_MENSAGENS, 'readwrite');
                const store = tx.objectStore(STORE_MENSAGENS);
                lista.forEach(msg => store.delete(chaveMensagem(conversa, msg)));
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        }
    };

    abrirBanco();
})();
