import { createClient } from '@supabase/supabase-js';
import { uuid, deviceInfo } from './util.js';

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const ID_RE = /^[a-z0-9_]{3,20}$/;
const isId = (v) => !String(v).includes('@');
const toEmail = (v) => (isId(v) ? `${String(v).trim().toLowerCase()}@studydrive.id` : String(v).trim());

export function cloud(cfg) {
  let liveCh = null;
  const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const session = async () => (await sb.auth.getSession()).data.session;

  const files = {
    list: async () => ok(await sb.from('files').select('*').order('created_at', { ascending: false })),
    async add(file, extra = {}) {
      const uid = (await session()).user.id;
      const ext = (file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
      const path = `${uid}/${uuid()}.${ext}`;
      ok(await sb.storage.from('files').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
      return ok(await sb.from('files').insert({ name: file.name, path, mime: file.type || '', size: file.size, device: deviceInfo().label, ...extra }).select().single());
    },
    update: async (row, patch) => ok(await sb.from('files').update({ ...patch, device: deviceInfo().label, updated_at: new Date().toISOString() }).eq('id', row.id).select().single()),
    async remove(row) {
      await sb.storage.from('files').remove([row.path]);
      ok(await sb.from('files').delete().eq('id', row.id));
    },
    async blob(row) { return ok(await sb.storage.from('files').download(row.path)); },
    async copy(row, extra = {}) {
      const uid = (await session()).user.id;
      const ext = (row.path.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
      const path = `${uid}/${uuid()}.${ext}`;
      ok(await sb.storage.from('files').copy(row.path, path));
      const { id, created_at, updated_at, user_id, ...rest } = row;
      const n = ok(await sb.from('files').insert({ ...rest, path, device: deviceInfo().label, ...extra }).select().single());
      const sts = ok(await sb.from('strokes').select('page,data').eq('file_id', row.id));
      if (sts.length) ok(await sb.from('strokes').insert(sts.map((x) => ({ id: uuid(), file_id: n.id, page: x.page, data: x.data }))));
      return n;
    },
    async replace(row, blob) {
      ok(await sb.storage.from('files').upload(row.path, blob, { upsert: true, cacheControl: '0', contentType: row.mime || 'text/plain' }));
      return files.update(row, { size: blob.size });
    },
  };

  // 필기는 획(stroke) 하나가 한 줄(row): 두 기기가 같은 쪽에 동시에 써도 서로 덮어쓰지 않는다
  const ann = {
    async get(fileId) {
      const out = {};
      for (const r of ok(await sb.from('strokes').select('id,page,data').eq('file_id', fileId).order('created_at', { ascending: true }))) (out[r.page] ||= []).push({ ...r.data, id: r.id });
      return out;
    },
    async add(fileId, page, st) {
      const { id, ...data } = st;
      ok(await sb.from('strokes').insert({ id, file_id: fileId, page, data, device: deviceInfo().label }));
    },
    async remove(ids) { if (ids.length) ok(await sb.from('strokes').delete().in('id', ids)); },
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
      async signIn(idOrEmail, password) { ok(await sb.auth.signInWithPassword({ email: toEmail(idOrEmail), password })); },
      async signUp(idOrEmail, password) {
        if (isId(idOrEmail)) {
          const id = String(idOrEmail).trim().toLowerCase();
          if (!ID_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·밑줄(_) 3~20자로 만들어 주세요');
          if (password.length < 6) throw new Error('비밀번호는 6자 이상이어야 해요');
          const { data, error } = await sb.functions.invoke('account', { body: { action: 'signup', username: id, password } });
          if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
          if (data?.error) throw new Error(data.error);
          ok(await sb.auth.signInWithPassword({ email: toEmail(id), password }));
          return;
        }
        const d = ok(await sb.auth.signUp({ email: idOrEmail, password, options: { emailRedirectTo: location.origin + location.pathname } }));
        if (!d.session) throw new Error('가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.');
      },
      async signInAnon() { ok(await sb.auth.signInAnonymously()); },
      async upgrade(idOrEmail, password) {
        if (!isId(idOrEmail)) { ok(await sb.auth.updateUser({ email: idOrEmail, password }, { emailRedirectTo: location.origin + location.pathname })); return; }
        const id = String(idOrEmail).trim().toLowerCase();
        if (!ID_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·밑줄(_) 3~20자로 만들어 주세요');
        if (password.length < 6) throw new Error('비밀번호는 6자 이상이어야 해요');
        const { data, error } = await sb.functions.invoke('account', { body: { action: 'upgrade', username: id, password } });
        if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
        if (data?.error) throw new Error(data.error);
        ok(await sb.auth.refreshSession());
      },
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
    files, ann, mistakes, folders,
    // 그리는 중인 획·메모 글자를 다른 기기에 바로 전달(저장 전 미리보기)
    live(payload) { liveCh?.send({ type: 'broadcast', event: 'live', payload: { ...payload, from: deviceInfo().id } }); },
    // 실시간 동기화 + 연결된 기기(접속 상태) 공유
    async realtime(h) {
      const ses = await session(); if (!ses) return () => {};
      const dev = deviceInfo(), uid = ses.user.id;
      const ch = sb.channel(`sd-${uid}`, { config: { presence: { key: dev.id }, broadcast: { self: false } } });
      liveCh = ch;
      ch.on('broadcast', { event: 'live' }, ({ payload }) => h.live?.(payload));
      for (const table of ['files', 'mistakes', 'strokes', 'folders']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => h.change?.(table, p));
      ch.on('presence', { event: 'sync' }, () => h.presence?.(Object.values(ch.presenceState()).flat()));
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { h.status?.('online'); await ch.track({ id: dev.id, kind: dev.kind, label: dev.label, icon: dev.icon, at: Date.now() }); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') h.status?.('offline');
      });
      return () => { liveCh = null; sb.removeChannel(ch); };
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
