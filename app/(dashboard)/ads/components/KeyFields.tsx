// app/(dashboard)/ads/components/KeyFields.tsx
// API 키·비밀키 입력 2칸(연결·교체 공용, Task 12). 값은 부모 상태에만 있고 제출 직후 부모가 지운다.
// - 브라우저 자동완성 차단(실운영 2026-11-11: 웨일이 MINTEQ 로그인 이메일을 고객 ID에, 로그인 비밀번호를 API 키에 채움):
//   type=password + autoComplete="new-password"(저장된 로그인 비밀번호를 채우지 않음) + 로그인처럼 보이지 않는 name·id(naver-api-key 등).
//   id는 카드마다 겹치지 않게 useId를 붙인다. username·email·password 같은 이름은 쓰지 않는다.
'use client';

import { useId } from 'react';
import { inputStyle, labelStyle } from './ui';

export type KeyValues = { apiKey: string; secretKey: string };
export const EMPTY_KEYS: KeyValues = { apiKey: '', secretKey: '' };

/** 비밀번호 관리자 확장(1Password·LastPass·Dashlane)도 이 칸을 로그인으로 보지 않게 하는 표시. */
export const NO_AUTOFILL = { 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-form-type': 'other' } as const;

export function KeyFields({ value, onChange, disabled }: { value: KeyValues; onChange: (v: KeyValues) => void; disabled?: boolean }) {
  const uid = useId();
  return (
    <>
      <label style={labelStyle}>
        API 키(액세스 라이선스)
        <input type="password" name="naver-api-key" id={`naver-api-key-${uid}`} autoComplete="new-password" spellCheck={false} {...NO_AUTOFILL}
          value={value.apiKey} disabled={disabled} onChange={(e) => onChange({ ...value, apiKey: e.target.value.trim() })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        비밀키
        <input type="password" name="naver-secret-key" id={`naver-secret-key-${uid}`} autoComplete="new-password" spellCheck={false} {...NO_AUTOFILL}
          value={value.secretKey} disabled={disabled} onChange={(e) => onChange({ ...value, secretKey: e.target.value.trim() })} style={inputStyle} />
      </label>
    </>
  );
}
