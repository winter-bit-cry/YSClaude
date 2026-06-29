import type { ComponentType } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BookOpen,
  Fish,
  Map as MapIcon,
  Package,
  RefreshCw,
  ScrollText,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react-native';
import type { McpToolConfig } from '../stores/settings';
import type { Message } from '../types';
import { useThemeColors, type ThemeColors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import {
  buildLocalFishingEntries,
  FishingHttpError,
  fetchFishingLog,
  inferFishingSessionId,
  inspectFishingCommand,
  playFishingAction,
  resolveFishingServer,
  type FishingActionRequest,
  type FishingLogEntry,
  type FishingState,
} from '../services/fishingLog';

interface FishingFloatingPanelProps {
  visible: boolean;
  messages: Message[];
  mcpToolConfig?: McpToolConfig;
  onUserActionMessage?: (content: string) => void | Promise<unknown>;
  onClose: () => void;
}

const PANEL_HEIGHT = 390;
const POLL_INTERVAL_MS = 5000;
type FishingPanelTab = 'log' | 'inventory' | 'shop';
type FishingPanelMenu = 'actions' | 'map' | null;
type FishingIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

interface FishingPanelItem {
  id: string;
  label: string;
  meta?: string;
  lookId?: string;
  kind: 'fish' | 'item' | 'chest' | 'fragment' | 'bait' | 'line';
}

interface FishingDetail {
  title: string;
  body: string;
}

interface FishingUserAction {
  id: string;
  label: string;
  commandLabel: string;
  request: FishingActionRequest;
  nextTab?: FishingPanelTab;
}

const FISHING_LOCATIONS = [
  { id: 'moonlit_pond', name: '月光池塘' },
  { id: 'reed_river', name: '芦苇河' },
  { id: 'abyssal_trench', name: '深渊海沟' },
  { id: 'floating_lake', name: '浮空之湖' },
  { id: 'lava_spring', name: '熔岩温泉' },
  { id: 'mangrove_shoal', name: '红树林浅滩' },
  { id: 'whispering_mire', name: '耳语沼泽' },
  { id: 'starry_delta', name: '星河三角洲' },
  { id: 'sunken_ruins', name: '沉没遗迹' },
  { id: 'geyser_falls', name: '间歇泉瀑布' },
  { id: 'crystal_cave', name: '水晶洞' },
];

export function FishingFloatingPanel({
  visible,
  messages,
  mcpToolConfig,
  onUserActionMessage,
  onClose,
}: FishingFloatingPanelProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dimensions = useWindowDimensions();
  const panelWidth = Math.min(430, Math.max(300, dimensions.width - 24));
  const position = useRef(new Animated.ValueXY({ x: 12, y: 96 })).current;
  const [serverEntries, setServerEntries] = useState<FishingLogEntry[]>([]);
  const [serverState, setServerState] = useState<FishingState | null>(null);
  const [runId, setRunId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<FishingPanelTab>('log');
  const [inventoryText, setInventoryText] = useState('');
  const [encyclopediaText, setEncyclopediaText] = useState('');
  const [shopText, setShopText] = useState('');
  const [encyclopediaVisible, setEncyclopediaVisible] = useState(false);
  const [detail, setDetail] = useState<FishingDetail | null>(null);
  const [menu, setMenu] = useState<FishingPanelMenu>(null);
  const [inspectLoading, setInspectLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const connection = useMemo(() => resolveFishingServer(mcpToolConfig), [mcpToolConfig]);
  const sessionId = useMemo(() => inferFishingSessionId(messages), [messages]);
  const localEntries = useMemo(() => buildLocalFishingEntries(messages), [messages]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
      onPanResponderGrant: () => {
        position.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        position.flattenOffset();
      },
      onPanResponderTerminate: () => {
        position.flattenOffset();
      },
    }),
    [position]
  );

  const refresh = async () => {
    if (!connection) {
      setServerEntries([]);
      setServerState(null);
      setRunId(undefined);
      setError('未找到已启用的 Fishing MCP 服务');
      return;
    }
    setLoading(true);
    try {
      const payload = await fetchFishingLog(connection, sessionId, 200);
      setServerEntries((payload.entries || []).map((entry) => ({ ...entry, origin: 'server', status: 'done' })));
      setServerState(payload.state || null);
      setRunId(payload.run_id);
      setError(null);
    } catch (err: any) {
      if (err instanceof FishingHttpError && err.status === 404) {
        setServerEntries([]);
        setServerState(null);
        setRunId(undefined);
        setError('服务器还没部署日志接口，已切换为本地工具调用记录。请部署新版 fishing server 后刷新。');
      } else {
        setError(err?.message || '钓鱼日志读取失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const runInspect = async (command: string, title: string, target?: FishingPanelTab) => {
    if (!connection) {
      setDetail({ title, body: '未找到已启用的 Fishing MCP 服务。' });
      return;
    }
    setInspectLoading(command);
    try {
      const payload = await inspectFishingCommand(connection, sessionId, command);
      if (target === 'inventory') {
        setInventoryText(payload.result);
        setDetail(null);
      } else if (target === 'shop') {
        setShopText(payload.result);
        setDetail(null);
      } else if (command === 'encyclopedia') {
        setEncyclopediaText(payload.result);
      } else {
        setDetail({ title, body: stripStateLine(payload.result) });
      }
      if (payload.state) setServerState(payload.state);
      if (payload.run_id) setRunId(payload.run_id);
    } catch (err: any) {
      const body = err instanceof FishingHttpError && err.status === 404
        ? '当前服务器还没有只读详情接口。部署新版 fishing server 后，背包和图鉴详情会在这里显示。'
        : err?.message || '详情读取失败';
      setDetail({ title, body });
    } finally {
      setInspectLoading(null);
    }
  };

  const runUserAction = async (action: FishingUserAction) => {
    if (!connection) {
      setDetail({ title: action.label, body: '未找到已启用的 Fishing MCP 服务。' });
      return;
    }
    setActionLoading(action.id);
    setError(null);
    try {
      const payload = await playFishingAction(connection, sessionId, action.request);
      const body = stripStateLine(payload.result);
      setDetail({ title: `用户操作：${action.label}`, body });
      setTab(action.nextTab || 'log');
      setMenu(null);
      if (payload.state) setServerState(payload.state);
      if (payload.run_id) setRunId(payload.run_id);
      await onUserActionMessage?.(formatUserActionSystemMessage(action, payload.result, sessionId));
      if (action.request.action === 'inventory') {
        setInventoryText(payload.result);
      } else {
        setInventoryText('');
      }
      if (action.request.action === 'shop') {
        setShopText(payload.result);
      } else if (action.request.action === 'buy' || action.request.action === 'sell') {
        setShopText('');
      }
      if (action.request.action === 'encyclopedia') {
        setEncyclopediaText(payload.result);
      } else if (action.request.action !== 'status' && action.request.action !== 'shop') {
        setEncyclopediaText('');
      }
      await refresh();
    } catch (err: any) {
      const body = err?.message || '钓鱼操作失败';
      setDetail({ title: `用户操作：${action.label}`, body });
      await onUserActionMessage?.([
        '[钓鱼游戏用户操作失败]',
        `Session: ${sessionId}`,
        `操作: ${action.commandLabel}`,
        '',
        body,
      ].join('\n'));
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (!visible) return;
    refresh().catch(() => undefined);
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, sessionId, connection?.baseUrl, connection?.authorization]);

  const entries = useMemo(
    () => mergeEntries(serverEntries, localEntries),
    [serverEntries, localEntries]
  );
  const latestState = serverState || [...entries].reverse().find((entry) => entry.state)?.state || null;
  const userActions = useMemo(() => buildUserActions(latestState), [latestState]);
  const inventoryItems = useMemo(
    () => buildInventoryItems(inventoryText, latestState),
    [inventoryText, latestState]
  );
  const shopActions = useMemo(
    () => buildShopActions(inventoryItems),
    [inventoryItems]
  );
  const allActions = useMemo(
    () => [...userActions, ...shopActions],
    [shopActions, userActions]
  );
  const encyclopediaItems = useMemo(
    () => parseEncyclopediaItems(encyclopediaText),
    [encyclopediaText]
  );

  useEffect(() => {
    if (!visible) return;
    if (tab === 'inventory' && !inventoryText && !inspectLoading) {
      runInspect('inventory', '背包', 'inventory').catch(() => undefined);
    }
    if (tab === 'shop' && !inspectLoading) {
      if (!shopText) runInspect('shop', '商店', 'shop').catch(() => undefined);
      if (!inventoryText) runInspect('inventory', '背包', 'inventory').catch(() => undefined);
    }
  }, [visible, tab, inventoryText, shopText, inspectLoading]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.panel,
        {
          width: panelWidth,
          height: PANEL_HEIGHT,
          transform: position.getTranslateTransform(),
        },
      ]}
    >
      <View style={styles.dragHeader} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
        <View style={styles.headerContent}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.kicker}>钓鱼观察窗</Text>
            <Text style={styles.title} numberOfLines={1}>
              {formatPlace(latestState)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.statusBar}>
        <Status label="Session" value={sessionId} styles={styles} wide />
        <Status label="点数" value={formatPoints(latestState)} styles={styles} />
        <Status
          label="图鉴"
          value={latestState?.enc || '-'}
          styles={styles}
        />
        <Status label="回合" value={formatMaybeNumber(latestState?.turn)} styles={styles} />
      </View>

      {!!runId && <Text style={styles.metaText} numberOfLines={1}>run: {runId}</Text>}
      {!!error && <Text style={[styles.errorText, error.includes('本地工具调用记录') && styles.warningText]}>{error}</Text>}

      <View style={styles.toolbar}>
        <ToolbarButton
          Icon={RefreshCw}
          label="刷新"
          styles={styles}
          color={colors.textSecondary}
          disabled={loading}
          onPress={() => refresh().catch(() => undefined)}
        />
        <ToolbarButton
          Icon={MapIcon}
          label="切换地图"
          styles={styles}
          color={menu === 'map' ? '#FFFFFF' : colors.textSecondary}
          active={menu === 'map'}
          onPress={() => setMenu((current) => current === 'map' ? null : 'map')}
        />
        <ToolbarButton
          Icon={Fish}
          label="操作"
          styles={styles}
          color={menu === 'actions' ? '#FFFFFF' : colors.textSecondary}
          active={menu === 'actions'}
          disabled={!!actionLoading}
          onPress={() => setMenu((current) => current === 'actions' ? null : 'actions')}
        />
        <ToolbarButton
          Icon={ScrollText}
          label="日志"
          styles={styles}
          color={tab === 'log' ? '#FFFFFF' : colors.textSecondary}
          active={tab === 'log'}
          onPress={() => {
            setMenu(null);
            setTab('log');
          }}
        />
        <ToolbarButton
          Icon={Package}
          label="背包"
          styles={styles}
          color={tab === 'inventory' ? '#FFFFFF' : colors.textSecondary}
          active={tab === 'inventory'}
          onPress={() => {
            setMenu(null);
            setTab('inventory');
            runInspect('inventory', '背包', 'inventory').catch(() => undefined);
          }}
        />
        <ToolbarButton
          Icon={Store}
          label="商店"
          styles={styles}
          color={tab === 'shop' ? '#FFFFFF' : colors.textSecondary}
          active={tab === 'shop'}
          onPress={() => {
            setMenu(null);
            setTab('shop');
            runInspect('shop', '商店', 'shop').catch(() => undefined);
            runInspect('inventory', '背包', 'inventory').catch(() => undefined);
          }}
        />
        <ToolbarButton
          Icon={BookOpen}
          label="图鉴"
          styles={styles}
          color={colors.textSecondary}
          onPress={() => {
            setMenu(null);
            setEncyclopediaVisible(true);
            runInspect('encyclopedia', '图鉴').catch(() => undefined);
          }}
        />
        <ToolbarButton
          Icon={X}
          label="关闭"
          styles={styles}
          color={colors.textSecondary}
          onPress={onClose}
        />
      </View>

      {menu === 'actions' && renderActionMenu({
        actions: allActions,
        styles,
        actionLoading,
        onAction: (action) => runUserAction(action).catch(() => undefined),
      })}
      {menu === 'map' && renderMapMenu({
        latestState,
        styles,
        actionLoading,
        onAction: (action) => runUserAction(action).catch(() => undefined),
      })}

      <ScrollView
        style={styles.logScroll}
        contentContainerStyle={styles.logContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        {detail && (
          <View style={styles.detailBox}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle} numberOfLines={1}>{detail.title}</Text>
              <Pressable style={styles.detailClose} onPress={() => setDetail(null)}>
                <X color={colors.textSecondary} size={15} strokeWidth={2.3} />
              </Pressable>
            </View>
            <Text selectable style={styles.detailBody}>{detail.body}</Text>
          </View>
        )}

        {tab === 'log' && renderLog(entries, styles)}
        {tab === 'inventory' && renderItems({
          items: inventoryItems,
          emptyTitle: inspectLoading === 'inventory' ? '正在读取背包' : '背包暂无可显示内容',
          emptyText: '点击刷新或让 AI 调用 inventory 后，这里会显示渔获、物品、宝箱和鱼饵。',
          styles,
          inspectLoading,
          onLook: (item) => item.lookId && runInspect(`look ${item.lookId}`, item.label).catch(() => undefined),
        })}
        {tab === 'shop' && renderShop({
          shopText,
          styles,
        })}
      </ScrollView>

      {encyclopediaVisible && (
        <View style={styles.popupOverlay}>
          <View style={styles.popupPanel}>
            <View style={styles.popupHeader}>
              <View>
                <Text style={styles.popupKicker}>图鉴</Text>
                <Text style={styles.popupTitle}>{latestState?.enc || '等待记录'}</Text>
              </View>
              <Pressable style={styles.detailClose} onPress={() => setEncyclopediaVisible(false)}>
                <X color={colors.textSecondary} size={15} strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView style={styles.popupScroll} contentContainerStyle={styles.popupContent}>
              {encyclopediaItems.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>{inspectLoading === 'encyclopedia' ? '正在读取图鉴' : '还没有图鉴记录'}</Text>
                  <Text style={styles.emptyText}>发现鱼之后，点这里的鱼名可以查看 look 详情。</Text>
                </View>
              ) : (
                renderItems({
                  items: encyclopediaItems,
                  emptyTitle: '还没有图鉴记录',
                  emptyText: '发现鱼之后，点这里的鱼名可以查看 look 详情。',
                  styles,
                  inspectLoading,
                  onLook: (item) => item.lookId && runInspect(`look ${item.lookId}`, item.label).catch(() => undefined),
                })
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

function Status({
  label,
  value,
  styles,
  wide = false,
  onPress,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  wide?: boolean;
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;
  return (
    <Container style={[styles.statusItem, wide && styles.statusItemWide, onPress && styles.statusItemPressable]} onPress={onPress}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue} numberOfLines={1}>{value}</Text>
    </Container>
  );
}

function ToolbarButton({
  Icon,
  label,
  styles,
  color,
  active = false,
  disabled = false,
  onPress,
}: {
  Icon: FishingIcon;
  label: string;
  styles: ReturnType<typeof createStyles>;
  color: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.toolbarButton, active && styles.toolbarButtonActive, disabled && styles.actionButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon color={color} size={17} strokeWidth={2.35} />
    </Pressable>
  );
}

function mergeEntries(serverEntries: FishingLogEntry[], localEntries: FishingLogEntry[]): FishingLogEntry[] {
  const seen = new Set(serverEntries.map((entry) => entryKey(entry)));
  const pendingLocal = localEntries.filter((entry) => entry.status === 'running' || !seen.has(entryKey(entry)));
  return [...serverEntries, ...pendingLocal]
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 260);
}

function entryKey(entry: FishingLogEntry): string {
  return `${entry.command}\n${entry.summary}`;
}

function formatPlace(state?: FishingState | null): string {
  if (!state) return '等待钓鱼记录';
  return [state.loc, state.sea].filter(Boolean).join(' · ') || '钓鱼进行中';
}

function formatPoints(state?: FishingState | null): string {
  return typeof state?.pts === 'number' ? `${state.pts}` : '-';
}

function formatMaybeNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function buildUserActions(state: FishingState | null): FishingUserAction[] {
  const actions: FishingUserAction[] = [
    {
      id: 'status',
      label: '状态',
      commandLabel: 'status',
      request: { action: 'status' },
    },
    {
      id: 'cast',
      label: '抛竿',
      commandLabel: 'cast',
      request: { action: 'cast' },
    },
    {
      id: 'cast-5',
      label: '连钓5',
      commandLabel: 'cast 5 stop=new,rare,event',
      request: { action: 'cast', times: 5, stop_on: ['new', 'rare', 'event'] },
    },
  ];

  if (state?.oxygen && state.oxygen > 0) {
    actions.push({
      id: 'dive',
      label: '潜水',
      commandLabel: 'dive',
      request: { action: 'dive' },
    });
    actions.push({
      id: 'dive-3',
      label: '连潜3',
      commandLabel: 'dive 3 stop=new,rare,event',
      request: { action: 'dive', times: 3, stop_on: ['new', 'rare', 'event'] },
    });
  } else {
    actions.push({
      id: 'dive',
      label: '潜水',
      commandLabel: 'dive',
      request: { action: 'dive' },
    });
  }

  actions.push({
    id: 'surface',
    label: '上岸',
    commandLabel: 'surface',
    request: { action: 'surface' },
  });

  return actions;
}

function buildShopActions(inventoryItems: FishingPanelItem[]): FishingUserAction[] {
  const actions: FishingUserAction[] = [
    {
      id: 'buy-basic-worm-5',
      label: '普通蚯蚓×5',
      commandLabel: 'buy basic_worm 5',
      request: { action: 'buy', bait_id: 'basic_worm', qty: 5 },
      nextTab: 'shop',
    },
    {
      id: 'buy-glow-bait-3',
      label: '夜光饵×3',
      commandLabel: 'buy glow_bait 3',
      request: { action: 'buy', bait_id: 'glow_bait', qty: 3 },
      nextTab: 'shop',
    },
    {
      id: 'buy-golden-lure-1',
      label: '黄金亮片×1',
      commandLabel: 'buy golden_lure 1',
      request: { action: 'buy', bait_id: 'golden_lure', qty: 1 },
      nextTab: 'shop',
    },
    {
      id: 'buy-oxygen-1',
      label: '氧气瓶×1',
      commandLabel: 'buy oxygen 1',
      request: { action: 'buy', bait_id: 'oxygen', qty: 1 },
      nextTab: 'shop',
    },
    {
      id: 'buy-oxygen-5',
      label: '氧气瓶×5',
      commandLabel: 'buy oxygen 5',
      request: { action: 'buy', bait_id: 'oxygen', qty: 5 },
      nextTab: 'shop',
    },
    {
      id: 'sell-all',
      label: '卖全部渔获',
      commandLabel: 'sell all',
      request: { action: 'sell', target: 'all' },
      nextTab: 'shop',
    },
  ];

  const sellableItems = inventoryItems.filter((item) =>
    item.kind === 'item' &&
    !!item.id &&
    !!item.meta?.includes('可 sell item')
  );
  for (const item of sellableItems) {
    actions.push({
      id: `sell-item-${item.id}`,
      label: `卖${item.label}`,
      commandLabel: `sell item ${item.id}`,
      request: { action: 'sell', target: `item ${item.id}` },
      nextTab: 'shop',
    });
  }

  return actions;
}

function formatUserActionSystemMessage(action: FishingUserAction, result: string, sessionId: string): string {
  const body = stripStateLine(result) || result.trim();
  return [
    '[钓鱼游戏用户操作]',
    `Session: ${sessionId}`,
    `操作: ${action.commandLabel}`,
    '',
    '结果:',
    body,
  ].join('\n');
}

function stripStateLine(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('📊'))
    .join('\n')
    .trim();
}

function renderActionMenu({
  actions,
  styles,
  actionLoading,
  onAction,
}: {
  actions: FishingUserAction[];
  styles: ReturnType<typeof createStyles>;
  actionLoading: string | null;
  onAction: (action: FishingUserAction) => void;
}) {
  const playActions = actions.filter((action) => action.request.action !== 'buy' && action.request.action !== 'sell');
  const tradeActions = actions.filter((action) => action.request.action === 'buy' || action.request.action === 'sell');
  return (
    <View style={styles.menuPanel}>
      <Text style={styles.menuTitle}>操作</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuRow}>
        {[...playActions, ...tradeActions].map((action) => (
          <ActionMenuButton
            key={action.id}
            action={action}
            styles={styles}
            loading={actionLoading === action.id}
            disabled={!!actionLoading}
            onPress={() => onAction(action)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function renderMapMenu({
  latestState,
  styles,
  actionLoading,
  onAction,
}: {
  latestState: FishingState | null;
  styles: ReturnType<typeof createStyles>;
  actionLoading: string | null;
  onAction: (action: FishingUserAction) => void;
}) {
  return (
    <View style={styles.menuPanel}>
      <Text style={styles.menuTitle}>地图</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuRow}>
        {FISHING_LOCATIONS.map((location) => {
          const active = latestState?.loc === location.name;
          const action: FishingUserAction = {
            id: `goto-${location.id}`,
            label: location.name,
            commandLabel: `goto ${location.id}`,
            request: { action: 'goto', location_id: location.id },
          };
          return (
            <Pressable
              key={location.id}
              style={[styles.menuButton, active && styles.menuButtonActive, actionLoading === action.id && styles.actionButtonDisabled]}
              onPress={() => onAction(action)}
              disabled={!!actionLoading || active}
              accessibilityRole="button"
              accessibilityLabel={`切换到${location.name}`}
            >
              <MapIcon color={active ? '#FFFFFF' : styles.menuIconColor.color} size={15} strokeWidth={2.3} />
              <Text style={[styles.menuButtonText, active && styles.menuButtonTextActive]} numberOfLines={1}>
                {location.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ActionMenuButton({
  action,
  styles,
  loading,
  disabled,
  onPress,
}: {
  action: FishingUserAction;
  styles: ReturnType<typeof createStyles>;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = actionIcon(action);
  return (
    <Pressable
      style={[styles.menuButton, loading && styles.actionButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={action.label}
    >
      <Icon color={styles.menuIconColor.color} size={15} strokeWidth={2.3} />
      <Text style={styles.menuButtonText} numberOfLines={1}>
        {loading ? '执行中' : action.label}
      </Text>
    </Pressable>
  );
}

function actionIcon(action: FishingUserAction): FishingIcon {
  if (action.request.action === 'buy') return ShoppingBag;
  if (action.request.action === 'sell') return Store;
  if (action.request.action === 'status') return ScrollText;
  return Fish;
}

function renderLog(entries: FishingLogEntry[], styles: ReturnType<typeof createStyles>) {
  if (entries.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>还没有钓鱼记录</Text>
        <Text style={styles.emptyText}>让 AI 调用 play_fishing 后，这里会显示它的行动日志。</Text>
      </View>
    );
  }
  return entries.map((entry) => (
    <View key={`${entry.origin || 'log'}-${entry.id}`} style={styles.entryRow}>
      <View style={[styles.dot, entry.status === 'running' && styles.dotRunning]} />
      <View style={styles.entryBody}>
        <View style={styles.entryTopRow}>
          <Text style={styles.entryCommand} numberOfLines={1}>{entry.command}</Text>
          <Text style={styles.entrySource}>{entry.origin === 'local' ? '本地' : '服务器'}</Text>
        </View>
        <Text style={styles.entrySummary}>{entry.summary}</Text>
        {entry.state && (
          <Text style={styles.entryState} numberOfLines={1}>
            {formatPlace(entry.state)} · {formatPoints(entry.state)} · 图鉴 {entry.state.enc || '-'}
          </Text>
        )}
      </View>
    </View>
  ));
}

function renderItems({
  items,
  emptyTitle,
  emptyText,
  styles,
  inspectLoading,
  onLook,
}: {
  items: FishingPanelItem[];
  emptyTitle: string;
  emptyText: string;
  styles: ReturnType<typeof createStyles>;
  inspectLoading: string | null;
  onLook: (item: FishingPanelItem) => void;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }
  return items.map((item) => {
    const clickable = !!item.lookId;
    const loading = item.lookId ? inspectLoading === `look ${item.lookId}` : false;
    const Container = clickable ? Pressable : View;
    return (
      <Container
        key={`${item.kind}-${item.id}-${item.label}`}
        style={[styles.inspectItem, clickable && styles.inspectItemPressable]}
        onPress={clickable ? () => onLook(item) : undefined}
      >
        <Text style={styles.inspectLabel} numberOfLines={1}>{item.label}</Text>
        {!!item.meta && <Text style={styles.inspectMeta} numberOfLines={2}>{loading ? '读取详情中...' : item.meta}</Text>}
      </Container>
    );
  });
}

function renderShop({
  shopText,
  styles,
}: {
  shopText: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.shopSection}>
      <Text style={styles.shopTitle}>货架</Text>
      <Text selectable style={styles.shopText}>
        {stripStateLine(shopText) || '正在读取商店...'}
      </Text>
    </View>
  );
}

function buildInventoryItems(text: string, state: FishingState | null): FishingPanelItem[] {
  const items: FishingPanelItem[] = [];
  if (state?.bait) {
    for (const [id, count] of Object.entries(state.bait)) {
      if (count > 0) {
        items.push({ id: `bait-${id}`, label: id, meta: `鱼饵 ×${count}`, lookId: id, kind: 'bait' });
      }
    }
  }
  if (typeof state?.oxygen === 'number' && state.oxygen > 0) {
    items.push({ id: 'bait-oxygen', label: 'oxygen', meta: `氧气瓶 ×${state.oxygen}`, lookId: 'oxygen', kind: 'bait' });
  }
  return [...items, ...parseInventoryItems(text)];
}

function parseInventoryItems(text: string): FishingPanelItem[] {
  const items: FishingPanelItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('【') || line.startsWith('🐟') || line.startsWith('🎁') || line.startsWith('📦') || line.startsWith('🧩')) {
      continue;
    }
    const fish = line.match(/^(c_\d+)\s+(.+?)\s+([0-9.]+cm)\s+(\d+点)$/);
    if (fish) {
      items.push({ id: fish[1], label: `${fish[2]} · ${fish[1]}`, meta: `${fish[3]} · ${fish[4]}`, lookId: fish[2], kind: 'fish' });
      continue;
    }
    const item = line.match(/^([a-z][\w-]*)\s+(.+?)×(\d+)(.*)$/i);
    if (item) {
      items.push({ id: item[1], label: item[2], meta: `${item[1]} ×${item[3]}${item[4] || ''}`, lookId: item[1], kind: 'item' });
      continue;
    }
    const chest = line.match(/^(ch_\d+).*/i);
    if (chest) {
      items.push({ id: chest[1], label: chest[1], meta: '待开宝箱，可让 AI open', kind: 'chest' });
      continue;
    }
    const fragment = line.match(/^(.+?)\s+(\d+\/\d+)$/);
    if (fragment) {
      items.push({ id: `frag-${fragment[1]}`, label: fragment[1], meta: `藏宝图碎片 ${fragment[2]}`, lookId: fragment[1], kind: 'fragment' });
      continue;
    }
    items.push({ id: line, label: line, kind: 'line' });
  }
  return items;
}

function parseEncyclopediaItems(text: string): FishingPanelItem[] {
  const items: FishingPanelItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^✔\s+(.+?)（(.+?)）×(\d+)\s+最大(.+)$/);
    if (match) {
      items.push({
        id: match[1],
        label: match[1],
        meta: `${match[2]} · ×${match[3]} · 最大${match[4]}`,
        lookId: match[1],
        kind: 'fish',
      });
    }
  }
  return items;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  dragHeader: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dragHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  statusBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  statusItem: {
    minWidth: 58,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  statusItemWide: {
    minWidth: 110,
    flex: 1,
  },
  statusItemPressable: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  statusLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '800',
  },
  statusValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  metaText: {
    color: colors.textTertiary,
    fontSize: 11,
    paddingHorizontal: 12,
    paddingTop: 6,
    fontFamily: fonts.mono,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  warningText: {
    color: colors.textTertiary,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  toolbarButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  toolbarButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  menuPanel: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 8,
    gap: 7,
  },
  menuTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  menuRow: {
    gap: 7,
    paddingRight: 4,
  },
  menuButton: {
    minWidth: 82,
    height: 32,
    borderRadius: 8,
    paddingHorizontal: 9,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  menuButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  menuButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  menuButtonTextActive: {
    color: '#FFFFFF',
  },
  menuIconColor: {
    color: colors.textSecondary,
  },
  logScroll: {
    flex: 1,
    marginTop: 8,
  },
  logContent: {
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  detailBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    padding: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  detailClose: {
    minHeight: 26,
    borderRadius: 7,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  detailBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  entryRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  dotRunning: {
    backgroundColor: colors.textTertiary,
  },
  entryBody: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 9,
  },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  entryCommand: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    fontFamily: fonts.mono,
  },
  entrySource: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '800',
  },
  entrySummary: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  entryState: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 5,
    fontVariant: ['tabular-nums'],
  },
  inspectItem: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  inspectItemPressable: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  inspectLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  inspectMeta: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  shopSection: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 10,
    gap: 8,
  },
  shopTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  shopText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  popupOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    backgroundColor: 'rgba(20,20,19,0.30)',
    padding: 14,
    justifyContent: 'center',
  },
  popupPanel: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  popupHeader: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  popupKicker: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  popupTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  popupScroll: {
    flex: 1,
  },
  popupContent: {
    gap: 10,
    padding: 12,
  },
  emptyState: {
    minHeight: 150,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 6,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
