/**
 * M-STATE-01 list loading: `rows` skeleton rows (tile + two bars) inside one busy "Yükleniyor"
 * group, built from the kit's shimmer blocks (static under reduce motion).
 */
import { SkeletonBlock, SkeletonGroup } from '@da/ui';
import { StyleSheet, View } from 'react-native';

export interface ListSkeletonProps {
  readonly rows?: number;
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

export function ListSkeleton({ rows = 3, accessibilityLabel, testID }: ListSkeletonProps) {
  return (
    <SkeletonGroup accessibilityLabel={accessibilityLabel} testID={testID ?? 'list.loading'}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock width={32} height={32} radius={10} />
          <View style={styles.bars}>
            <SkeletonBlock width="70%" height={14} radius={6} />
            <SkeletonBlock width="45%" height={12} radius={6} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  bars: { flex: 1, gap: 6 },
});
