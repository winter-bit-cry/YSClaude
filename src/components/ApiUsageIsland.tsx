import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { getApiUsageEvents, subscribeApiUsageEvents } from '../db/operations';
import { fetchClaudeQuota, type ClaudeQuotaAccount } from '../services/cliProxyQuota';
import { useMusicStore } from '../stores/music';
import { useSettingsStore } from '../stores/settings';
import type { ApiUsageEvent } from '../types';
import { getAppearanceCssStyle, parseAppearanceCss } from '../utils/appearanceCss';

function compactTokenCount(value: number): string {
  const count = Math.max(0, Math.round(value));
  if (count < 1_000) return String(count);
  if (count < 1_000_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1).replace(/\.0$/, '')}s`;
}

function formatCallTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatQuotaResetTime(value?: string): string {
  if (!value) return '重置时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '重置时间未知';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `重置 ${month}-${day} ${hour}:${minute}`;
}

function MusicBars({ playing, barStyle }: { playing: boolean; barStyle?: StyleProp<ViewStyle> }) {
  const values = useRef([0, 1, 2, 3].map(() => new Animated.Value(0.35))).current;

  useEffect(() => {
    const animations = values.map((value, index) => Animated.loop(
      Animated.sequence([
        Animated.delay(index * 70),
        Animated.timing(value, {
          toValue: 1,
          duration: 260 + index * 45,
          useNativeDriver: false,
        }),
        Animated.timing(value, {
          toValue: 0.22 + index * 0.06,
          duration: 300 + (3 - index) * 35,
          useNativeDriver: false,
        }),
      ])
    ));

    if (playing) {
      animations.forEach((animation) => animation.start());
    } else {
      animations.forEach((animation) => animation.stop());
      values.forEach((value, index) => value.setValue([0.34, 0.62, 0.45, 0.72][index]));
    }
    return () => animations.forEach((animation) => animation.stop());
  }, [playing, values]);

  return (
    <View style={styles.musicBars}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.musicBar,
            barStyle,
            {
              height: value.interpolate({
                inputRange: [0, 1],
                outputRange: [4, 18],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

export function ApiUsageIsland() {
  const [latestUsage, setLatestUsage] = useState<ApiUsageEvent | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [quotaAccounts, setQuotaAccounts] = useState<ClaudeQuotaAccount[]>([]);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const expansionProgress = useRef(new Animated.Value(0)).current;
  const islandConfig = useSettingsStore((state) => state.dynamicIslandConfig);
  const customCss = useSettingsStore((state) => state.appearanceConfig?.customCss);
  const customCssStyles = useMemo(() => parseAppearanceCss(customCss), [customCss]);
  const cssStyle = (...selectors: string[]) => getAppearanceCssStyle(customCssStyles, ...selectors);
  const imageCssStyle = (...selectors: string[]) => cssStyle(...selectors) as ImageStyle | undefined;
  const musicOpen = useMusicStore((state) => state.isOpen);
  const musicPlaying = useMusicStore((state) => state.isPlaying);
  const currentIndex = useMusicStore((state) => state.currentIndex);
  const tracks = useMusicStore((state) => state.tracks);
  const currentTrack = tracks[currentIndex];
  const quotaConfigured = !!islandConfig.cliProxyServerUrl.trim() && !!islandConfig.cliProxyPassword.trim();

  useEffect(() => {
    expansionProgress.stopAnimation();
    Animated.spring(expansionProgress, {
      toValue: expanded ? 1 : 0,
      tension: expanded ? 145 : 310,
      friction: expanded ? 11 : 27,
      velocity: expanded ? 0.25 : -0.4,
      useNativeDriver: false,
    }).start();
  }, [expanded, expansionProgress]);

  useEffect(() => {
    let mounted = true;
    getApiUsageEvents(1)
      .then(([event]) => {
        if (mounted && event) {
          setLatestUsage((current) => !current || event.startedAt >= current.startedAt ? event : current);
        }
      })
      .catch(() => undefined);

    const unsubscribe = subscribeApiUsageEvents((event) => {
      setLatestUsage((current) => !current || event.startedAt >= current.startedAt ? event : current);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const totalInputTokens = latestUsage?.promptTokens || 0;
  const cachedInputTokens = latestUsage?.cachedTokens || 0;
  const uncachedInputTokens = Math.max(
    0,
    totalInputTokens - cachedInputTokens
  );
  const cacheHitRate = totalInputTokens > 0
    ? Math.max(0, Math.min(100, cachedInputTokens / totalInputTokens * 100))
    : 0;
  const outputTokens = latestUsage?.completionTokens || 0;
  const statusText = latestUsage?.status === 'error'
    ? '失败'
    : latestUsage?.status === 'aborted'
      ? '中断'
      : '成功';
  const statusStyle = latestUsage?.status === 'error'
    ? styles.statusError
    : latestUsage?.status === 'aborted'
      ? styles.statusAborted
      : styles.statusSuccess;
  const collapsedContent = useMemo(() => {
    if (musicOpen && currentTrack) {
      return (
        <View style={[styles.musicContent, cssStyle('.dynamic-island-music-content')]}>
          <View style={[styles.coverWrap, cssStyle('.dynamic-island-music-cover')]}>
            {currentTrack.artworkUrl ? (
              <Image source={{ uri: currentTrack.artworkUrl }} style={styles.cover} resizeMode="cover" />
            ) : (
              <Text style={[styles.coverFallback, cssStyle('.dynamic-island-text', '.dynamic-island-music-cover-fallback')]}>♪</Text>
            )}
          </View>
          <View style={cssStyle('.dynamic-island-music-effect')}>
            <MusicBars playing={musicPlaying} barStyle={cssStyle('.dynamic-island-music-bar')} />
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.tokenContent, cssStyle('.dynamic-island-collapsed-content')]}>
        <Image source={require('../../assets/claudelogo.png')} style={[styles.logo, imageCssStyle('.dynamic-island-logo')]} resizeMode="contain" />
        <View style={[styles.tokenMetrics, cssStyle('.dynamic-island-token-group')]}>
          <View style={styles.metric}>
            <Text style={[styles.inputArrow, cssStyle('.dynamic-island-text', '.dynamic-island-input-arrow')]}>↑</Text>
            <Text style={[styles.count, cssStyle('.dynamic-island-text', '.dynamic-island-token-count')]}>{compactTokenCount(uncachedInputTokens)}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={[styles.outputArrow, cssStyle('.dynamic-island-text', '.dynamic-island-output-arrow')]}>↓</Text>
            <Text style={[styles.count, cssStyle('.dynamic-island-text', '.dynamic-island-token-count')]}>{compactTokenCount(outputTokens)}</Text>
          </View>
        </View>
      </View>
    );
  }, [currentTrack, musicOpen, musicPlaying, outputTokens, uncachedInputTokens]);

  const refreshQuota = () => {
    if (!quotaConfigured || quotaLoading) return;
    setQuotaLoading(true);
    setQuotaError(null);
    fetchClaudeQuota({
      serverUrl: islandConfig.cliProxyServerUrl,
      account: islandConfig.cliProxyAccount,
      password: islandConfig.cliProxyPassword,
    })
      .then((accounts) => {
        setQuotaAccounts(accounts);
        if (accounts.length === 0) setQuotaError('Claude 额度接口未返回可用数据');
      })
      .catch((error: any) => {
        setQuotaError(error?.message || 'Claude 额度刷新失败');
      })
      .finally(() => setQuotaLoading(false));
  };

  const handlePress = () => {
    if (!expanded) refreshQuota();
    setExpanded((value) => !value);
  };

  if (!islandConfig.enabled) return null;

  const quotaAccount = quotaAccounts[0];
  const expandedHeight = quotaConfigured ? 240 : 132;
  const animatedIslandStyle = {
    width: expansionProgress.interpolate({ inputRange: [0, 1], outputRange: [152, 330] }),
    height: expansionProgress.interpolate({ inputRange: [0, 1], outputRange: [35, expandedHeight] }),
    borderRadius: expansionProgress.interpolate({ inputRange: [0, 1], outputRange: [20, 24] }),
  };

  return (
    <View pointerEvents="box-none" style={[styles.overlay, cssStyle('.dynamic-island-overlay')]}>
      {expanded && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起 API 调用记录"
          onPress={() => setExpanded(false)}
          style={styles.dismissLayer}
        />
      )}
      <Animated.View style={[styles.island, cssStyle('.dynamic-island'), animatedIslandStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? '收起 API 调用记录' : '展开最近一次 API 调用记录'}
          onPress={handlePress}
          style={({ pressed }) => [
            styles.islandPressable,
            expanded && styles.islandPressableExpanded,
            pressed && styles.islandPressed,
          ]}
        >
          {expanded ? (
          latestUsage ? (
            <View style={[styles.details, cssStyle('.dynamic-island-panel')]}>
              <View style={styles.detailsHeader}>
                <View style={styles.detailsTitleRow}>
                  <Image source={require('../../assets/claudelogo.png')} style={[styles.detailsLogo, imageCssStyle('.dynamic-island-logo', '.dynamic-island-panel-logo')]} resizeMode="contain" />
                  <Text style={[styles.detailsTitle, cssStyle('.dynamic-island-text', '.dynamic-island-title')]} numberOfLines={1}>最近一次 API 调用</Text>
                </View>
                <Text style={[styles.status, statusStyle, cssStyle('.dynamic-island-text', '.dynamic-island-status')]}>{statusText}</Text>
              </View>
              <Text style={[styles.model, cssStyle('.dynamic-island-text', '.dynamic-island-model')]} numberOfLines={1}>{latestUsage.model || 'unknown model'}</Text>
              <Text style={[styles.callMeta, cssStyle('.dynamic-island-text', '.dynamic-island-meta')]} numberOfLines={1}>
                {latestUsage.feature} · {latestUsage.requestKind} · {formatCallTime(latestUsage.startedAt)} · {formatDuration(latestUsage.durationMs)}
              </Text>
              <View style={styles.detailsMetrics}>
                <View style={[styles.detailMetric, cssStyle('.dynamic-island-metric-card')]}>
                  <Text style={[styles.detailLabel, cssStyle('.dynamic-island-text', '.dynamic-island-metric-label')]}>输入 Token</Text>
                  <Text style={[styles.detailValue, cssStyle('.dynamic-island-text', '.dynamic-island-metric-value')]} numberOfLines={1}>
                    {compactTokenCount(uncachedInputTokens)} ({compactTokenCount(totalInputTokens)})
                  </Text>
                </View>
                <View style={[styles.detailMetric, cssStyle('.dynamic-island-metric-card')]}>
                  <Text style={[styles.detailLabel, cssStyle('.dynamic-island-text', '.dynamic-island-metric-label')]}>输出</Text>
                  <Text style={[styles.detailValue, cssStyle('.dynamic-island-text', '.dynamic-island-metric-value')]}>{compactTokenCount(outputTokens)}</Text>
                </View>
                <View style={[styles.detailMetric, cssStyle('.dynamic-island-metric-card')]}>
                  <Text style={[styles.detailLabel, cssStyle('.dynamic-island-text', '.dynamic-island-metric-label')]}>缓存命中</Text>
                  <Text style={[styles.detailValue, cssStyle('.dynamic-island-text', '.dynamic-island-metric-value')]} numberOfLines={1}>
                    {cacheHitRate.toFixed(cacheHitRate >= 10 ? 0 : 1)}% ({compactTokenCount(cachedInputTokens)})
                  </Text>
                </View>
              </View>
              {quotaConfigured && (
                <View style={[styles.quotaSection, cssStyle('.dynamic-island-quota')]}>
                  <View style={styles.quotaHeader}>
                    <Text style={[styles.quotaTitle, cssStyle('.dynamic-island-text', '.dynamic-island-quota-title')]}>Claude 额度</Text>
                    <Text style={[styles.quotaState, cssStyle('.dynamic-island-text', '.dynamic-island-quota-account')]} numberOfLines={1}>
                      {quotaLoading
                        ? '正在同步…'
                        : quotaAccount
                          ? `${quotaAccount.name}${quotaAccounts.length > 1 ? ` · ${quotaAccounts.length} 个账号` : ''}`
                          : '点击灵动岛刷新'}
                    </Text>
                  </View>
                  {quotaError ? (
                    <Text style={[styles.quotaError, cssStyle('.dynamic-island-text', '.dynamic-island-quota-error')]} numberOfLines={2}>{quotaError}</Text>
                  ) : quotaAccount ? (
                    <View style={styles.quotaWindows}>
                      {quotaAccount.windows.slice(0, 3).map((window) => (
                        <View key={window.key} style={styles.quotaWindow}>
                          <View style={styles.quotaWindowTop}>
                            <Text style={[styles.quotaLabel, cssStyle('.dynamic-island-text', '.dynamic-island-quota-label')]}>{window.label}</Text>
                            <Text style={[styles.quotaPercent, cssStyle('.dynamic-island-text', '.dynamic-island-quota-percent')]}>{Math.round(window.remainingPercent)}%</Text>
                          </View>
                          <View style={[styles.quotaTrack, cssStyle('.dynamic-island-quota-track')]}>
                            <View
                              style={[
                                styles.quotaFill,
                                window.remainingPercent < 20 && styles.quotaFillLow,
                                cssStyle('.dynamic-island-quota-fill'),
                                { width: `${window.remainingPercent}%` },
                              ]}
                            />
                          </View>
                          {(window.key === 'five_hour' || window.key === 'seven_day') && (
                            <Text style={[styles.quotaReset, cssStyle('.dynamic-island-text', '.dynamic-island-quota-reset')]} numberOfLines={1}>
                              {formatQuotaResetTime(window.resetsAt)}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.emptyDetails}>
              <Image source={require('../../assets/claudelogo.png')} style={styles.detailsLogo} resizeMode="contain" />
              <Text style={[styles.emptyText, cssStyle('.dynamic-island-text', '.dynamic-island-empty-text')]}>暂无 API 调用记录</Text>
            </View>
          )
          ) : collapsedContent}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 10,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    alignItems: 'center',
  },
  dismissLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  island: {
    width: 152,
    height: 35,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#050505',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  islandPressable: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  islandPressableExpanded: {
    padding: 14,
    alignItems: 'stretch',
  },
  islandPressed: { opacity: 0.82 },
  tokenContent: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tokenMetrics: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
  logo: { width: 21, height: 21, tintColor: '#D97757' },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  inputArrow: { color: '#45C779', fontSize: 11, lineHeight: 15, fontWeight: '800' },
  outputArrow: { color: '#EF6464', fontSize: 11, lineHeight: 15, fontWeight: '800' },
  count: {
    color: '#D8D8D8',
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  musicContent: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  coverWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2A',
  },
  cover: { width: '100%', height: '100%' },
  coverFallback: { color: '#EAEAEA', fontSize: 14, fontWeight: '700' },
  musicBars: { height: 20, flexDirection: 'row', alignItems: 'center', gap: 3 },
  musicBar: { width: 3, borderRadius: 2, backgroundColor: '#F3F3F3' },
  details: { flex: 1 },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailsLogo: { width: 19, height: 19, tintColor: '#D97757' },
  detailsTitle: { flex: 1, color: '#F1F1F1', fontSize: 14, fontWeight: '700' },
  status: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, fontSize: 10, fontWeight: '700' },
  statusSuccess: { color: '#70E59D', backgroundColor: 'rgba(69,199,121,0.16)' },
  statusError: { color: '#FF8585', backgroundColor: 'rgba(239,100,100,0.16)' },
  statusAborted: { color: '#F2C66D', backgroundColor: 'rgba(242,198,109,0.16)' },
  model: { marginTop: 8, color: '#D7D7D7', fontSize: 12, fontWeight: '600' },
  callMeta: { marginTop: 3, color: '#858585', fontSize: 10 },
  detailsMetrics: { marginTop: 10, flexDirection: 'row', gap: 8 },
  detailMetric: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 9, backgroundColor: '#181818' },
  detailLabel: { color: '#858585', fontSize: 9 },
  detailValue: { marginTop: 2, color: '#E6E6E6', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  quotaSection: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#303030' },
  quotaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  quotaTitle: { color: '#E8E8E8', fontSize: 11, fontWeight: '700' },
  quotaState: { flex: 1, color: '#777777', fontSize: 9, textAlign: 'right' },
  quotaWindows: { marginTop: 7, flexDirection: 'row', gap: 7 },
  quotaWindow: { flex: 1, minWidth: 0 },
  quotaWindowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3 },
  quotaLabel: { flex: 1, color: '#9A9A9A', fontSize: 8 },
  quotaPercent: { color: '#E5E5E5', fontSize: 9, fontWeight: '700', fontVariant: ['tabular-nums'] },
  quotaTrack: { height: 3, marginTop: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: '#292929' },
  quotaReset: { marginTop: 4, color: '#696969', fontSize: 7, lineHeight: 9 },
  quotaFill: { height: '100%', borderRadius: 2, backgroundColor: '#45C779' },
  quotaFillLow: { backgroundColor: '#EF6464' },
  quotaError: { marginTop: 7, color: '#EF8585', fontSize: 9, lineHeight: 13 },
  emptyDetails: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  emptyText: { color: '#B8B8B8', fontSize: 13, fontWeight: '600' },
});
