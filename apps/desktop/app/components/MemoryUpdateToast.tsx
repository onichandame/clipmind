import { useEffect } from 'react';
import { toast } from './Toast';

const AUTO_DISMISS_MS = 5000;

// Pure non-interactive notification routed through the global toast queue, so
// it shares one bottom-right slot with project-deleted toasts etc. Owner bumps
// `nonce` whenever a fresh `tool-update_user_memory` part finishes.
export function MemoryUpdateToast({ nonce }: { nonce: number }) {
  useEffect(() => {
    if (nonce === 0) return;
    toast('✏️ 已记住你的偏好', AUTO_DISMISS_MS);
  }, [nonce]);
  return null;
}
