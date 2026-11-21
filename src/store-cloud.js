import { createClient } from '@supabase/supabase-js';
import { uuid, deviceInfo } from './util.js';

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

export function cloud(cfg) {
  const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const session = async () => (await sb.auth.getSession()).data.session;

  const files = {
    list: async () => ok(await sb.from('files').select('*').order('created_at', { ascending: false })),
    async add(file) {
      const uid = (await session()).user.id;
      const ext = (file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
      const path = `${uid}/${uuid()}.${ext}`;
      ok(await sb.storage.from('files').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
      return ok(await sb.from('files').insert({ name: file.name, path, mime: file.type || '', size: file.size, device: deviceInfo().label }).select().single());
    },
    update: async (row, patch) => ok(await sb.from('files').update({ ...patch, device: deviceInfo().label, updated_at: new Date().toISOString() }).eq('id', row.id).select().single()),
    async remove(row) {
      await sb.storage.from('files').remove([row.path]);
      ok(await sb.from('files').delete().eq('id', row.id));
    },
    async blob(row) { return ok(await sb.storage.from('files').download(row.path)); },
    async replace(row, blob) {
      ok(await sb.storage.from('files').upload(row.path, blob, { upsert: true, cacheControl: '0', contentType: row.mime || 'text/plain' }));
      return files.update(row, { size: blob.size });
    },
  };

  const ann = {
    async get(fileId) {
      const out = {};
      for (const a of ok(await sb.from('annotations').select('page,strokes').eq('file_id', fileId))) out[a.page] = a.strokes;
      return out;
    },
    async save(fileId, page, strokes) {
      ok(await sb.from('annotations').upsert({ file_id: fileId, page, strokes, device: deviceInfo().label, updated_at: new Date().toISOString() }, { onConflict: 'file_id,page' }));
    },
  };

  const mistakes = {
    list: async () => ok(await sb.from('mistakes').select('*').order('created_at', { ascending: false })),
    add: async (m) => ok(await sb.from('mistakes').insert({ ...m, device: deviceInfo().label }).select().single()),
    update: async (id, patch) => ok(await sb.from('mistakes').update({ ...patch, device: deviceInfo().label }).eq('id', id).select().single()),
    async remove(id) { ok(await sb.from('mistakes').delete().eq('id', id)); },
  };

  return {
    mode: 'cloud',
    auth: {
      async user() { return (await session())?.user ?? null; },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signUp(email, password) {
        const d = ok(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
        if (!d.session) throw new Error('가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.');
      },
      async signInAnon() { ok(await sb.auth.signInAnonymously()); },
      async upgrade(email, password) { ok(await sb.auth.updateUser({ email, password }, { emailRedirectTo: location.origin + location.pathname })); },
      signOut: () => sb.auth.signOut(),
      // 시연용 기기 연결: 현재 로그인 세션의 갱신 토큰을 QR(주소의 # 부분)로 다른 기기에 전달. 서버로 전송되지 않음.
      async linkUrl() {
        const ses = await session(); if (!ses) return null;
        return `${location.origin}${location.pathname}#link=${encodeURIComponent(ses.refresh_token)}`;
      },
      async consumeLink() {
        const m = location.hash.match(/^#link=([^&]+)/); if (!m) return false;
        history.replaceState(null, '', location.pathname + '#/files');
        try { ok(await sb.auth.refreshSession({ refresh_token: decodeURIComponent(m[1]) })); return true; } catch { return false; }
      },
    },
    files, ann, mistakes,
    // 실시간 동기화 + 연결된 기기(접속 상태) 공유
    async realtime(h) {
      const ses = await session(); if (!ses) return () => {};
      const dev = deviceInfo(), uid = ses.user.id;
      const ch = sb.channel(`sd-${uid}`, { config: { presence: { key: dev.id } } });
      for (const table of ['files', 'mistakes', 'annotations']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => h.change?.(table, p));
      ch.on('presence', { event: 'sync' }, () => h.presence?.(Object.values(ch.presenceState()).flat()));
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { h.status?.('online'); await ch.track({ id: dev.id, kind: dev.kind, label: dev.label, icon: dev.icon, at: Date.now() }); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') h.status?.('offline');
      });
      return () => { sb.removeChannel(ch); };
    },
    settings: {
      async get() { const d = ok(await sb.from('profiles').select('data').maybeSingle()); return d?.data || {}; },
      async set(v) { const uid = (await session()).user.id; ok(await sb.from('profiles').upsert({ user_id: uid, data: v, updated_at: new Date().toISOString() })); },
    },
    async ai(action, payload) {
      const once = async () => {
        const call = sb.functions.invoke('ai', { body: { action, ...payload } });
        const { data, error } = await Promise.race([call, new Promise((_, rej) => setTimeout(() => rej(new Error('AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.')), 45000))]);
        if (error) {
          let msg = error.message;
          try { msg = (await error.context.json()).error || msg; } catch {}
          throw new Error(msg);
        }
        if (data?.error) throw new Error(data.error);
        return data;
      };
      try { return await once(); } catch (e) {
        if (/503|늦어요|오래 걸려요|혼잡|가득/.test(e.message)) { await new Promise((r) => setTimeout(r, 1500)); return once(); } // 일시적 과부하는 1번 자동 재시도
        throw e;
      }
    },
  };
}
