// components/channels/types.ts
// 채널 연동 화면 공용 타입.

export interface ChannelStatus { connected: boolean; masked?: Record<string, string>; error?: 'decrypt_failed'; recoverable?: boolean }
export interface CafeTargetData { id: string; name: string; clubId: string; menuId: string; isDefault: boolean }

export interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
}
