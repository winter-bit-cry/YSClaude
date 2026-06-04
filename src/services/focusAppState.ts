import { AppState, type AppStateStatus } from 'react-native';
import { useFocusStore, focusElapsedMs } from '../stores/focus';
import { sendFocusSystemEvent } from './focusChatEvents';

let currentState: AppStateStatus = AppState.currentState;
let lastNotifiedSessionId: string | null = null;

function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const seconds = Math.max(0, Math.floor((ms % 60000) / 1000));
  if (totalMinutes <= 0) return `${seconds} 秒`;
  return `${totalMinutes} 分钟 ${seconds} 秒`;
}

export function startFocusAppStateListener(): () => void {
  const sub = AppState.addEventListener('change', (nextState) => {
    const wasActive = currentState === 'active';
    currentState = nextState;

    if (nextState === 'active') {
      lastNotifiedSessionId = null;
      useFocusStore.getState().refreshActiveSession().catch(() => undefined);
      return;
    }

    if (!wasActive || lastNotifiedSessionId) return;

    const session = useFocusStore.getState().activeSession;
    if (!session) return;

    lastNotifiedSessionId = session.id;
    const elapsed = formatElapsed(focusElapsedMs(session));
    sendFocusSystemEvent(
      `应用：用户离开了 YSClaude 应用，当前仍在专注「${session.taskTitle}」，已进行 ${elapsed}。`
    ).catch(() => undefined);
  });

  return () => sub.remove();
}
