// app/(dashboard)/ads/components/KeyFields.tsx
// API 키·비밀키 입력 2칸(연결·교체 공용, Task 12). type=password + autocomplete off. 값은 부모 상태에만 있고 제출 직후 부모가 지운다.
'use client';

import { inputStyle, labelStyle } from './ui';

export type KeyValues = { apiKey: string; secretKey: string };
export const EMPTY_KEYS: KeyValues = { apiKey: '', secretKey: '' };

export function KeyFields({ value, onChange, disabled }: { value: KeyValues; onChange: (v: KeyValues) => void; disabled?: boolean }) {
  return (
    <>
      <label style={labelStyle}>
        API 키(액세스 라이선스)
        <input type="password" autoComplete="off" spellCheck={false} value={value.apiKey} disabled={disabled}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value.trim() })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        비밀키
        <input type="password" autoComplete="off" spellCheck={false} value={value.secretKey} disabled={disabled}
          onChange={(e) => onChange({ ...value, secretKey: e.target.value.trim() })} style={inputStyle} />
      </label>
    </>
  );
}
