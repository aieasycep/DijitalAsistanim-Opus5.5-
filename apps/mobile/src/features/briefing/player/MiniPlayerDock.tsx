/**
 * M-GL-14 audio mini player (DESIGN_MAPPING DEV-52): the `@da/ui` `MiniPlayer` over the running
 * audio briefing session (`store.ts`), docked above the tab bar (`ShellTabBar`) and above the
 * sticky CTA of `briefing/[id]`; hidden while the full player is open and when nothing plays.
 * - Play / pause act on the session's engine (`mini_player_action {play|pause}`).
 * - The body re-opens `briefing/{id}/listen`, which shows the running session (`expand`).
 * - Close stops playback, clears the lock-screen controls and hides the player (`close`).
 * Title "Sabah Brifingi · Öncelikler" (kind · current chapter) and "0:42 / 2:14".
 */
import { MiniPlayer } from '@da/ui';
import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../../lib/events';
import { clock, stopSession, usePlayerControls, usePlayerSession, usePlayerStatus } from './store';

/** Height the dock adds above the bar (mini player 60 + 8 gap), for the toast offset. */
export const MINI_PLAYER_DOCK_HEIGHT = 68;

/** Whether the mini player is showing on the current route. */
export function useMiniPlayerVisible(): boolean {
  const session = usePlayerSession();
  const pathname = usePathname();
  return session !== null && pathname !== `/briefing/${session.briefingId}/listen`;
}

export function MiniPlayerDock({ testID = 'miniPlayer' }: { readonly testID?: string }) {
  const t = useTranslations('briefing.audio');
  const router = useRouter();
  const session = usePlayerSession();
  const status = usePlayerStatus();
  const controls = usePlayerControls();
  const visible = useMiniPlayerVisible();
  if (!visible || session === null) return null;
  const chapter = status.chapters.find((c) => c.key === status.activeKey);
  const title =
    chapter === undefined || chapter.title === ''
      ? session.title
      : `${session.title} · ${chapter.title}`;
  return (
    <View style={styles.dock} testID={`${testID}.dock`}>
      <MiniPlayer
        title={title}
        timeText={`${clock(status.positionS)} / ${clock(status.durationS)}`}
        progress={status.durationS > 0 ? status.positionS / status.durationS : 0}
        playing={status.playing}
        onPlayPause={() => {
          if (controls === null) return;
          track('mini_player_action', { action: status.playing ? 'pause' : 'play' });
          controls.toggle();
        }}
        onClose={() => {
          track('mini_player_action', { action: 'close' });
          stopSession();
        }}
        onExpand={() => {
          track('mini_player_action', { action: 'expand' });
          router.push(`/briefing/${session.briefingId}/listen`);
        }}
        playLabel={t('play')}
        pauseLabel={t('pause')}
        closeLabel={t('mini.close')}
        expandLabel={t('mini.expand')}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingBottom: 8 },
});
