// Supabase 연결 정보 (anon key는 공개돼도 안전합니다. 접근은 RLS로 보호됩니다)
// 비워 두면 "로컬 모드"(이 기기에만 저장)로 동작합니다.
window.SD_CONFIG = {
  url: '',            // 예: https://abcdxyz.supabase.co
  key: '',            // Project Settings > API > anon public key
  demoEmail: '',      // 심사위원용 데모 계정 (선택)
  demoPassword: '',
};
