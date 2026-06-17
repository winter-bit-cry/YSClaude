import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Banknote,
  Factory,
  Home,
  Leaf,
  RefreshCw,
  Sprout,
  Users,
  Wheat,
} from 'lucide-react-native';
import { getApiUsageSummary } from '../../db/operations';
import { lightColors, useThemeColors, type ThemeColors } from '../../theme/colors';
import {
  ANIMAL_DEFINITIONS,
  CROP_DEFINITIONS,
  RECIPE_DEFINITIONS,
  RESOURCE_LABELS,
  TOKENS_PER_COIN,
  useTownSimStore,
  type TownAnimalId,
  type TownCropId,
  type TownRecipeId,
} from './townSimStore';

let colors = lightColors;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '可收获';
  const minutes = Math.ceil(ms / 60000);
  return `${minutes} 分钟`;
}

function inputText(inputs: Partial<Record<keyof typeof RESOURCE_LABELS, number>>): string {
  return Object.entries(inputs)
    .map(([resourceId, amount]) => `${RESOURCE_LABELS[resourceId as keyof typeof RESOURCE_LABELS]} x${amount}`)
    .join('、');
}

export function TownSimScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const hydrated = useTownSimStore((state) => state._hydrated);
  const coins = useTownSimStore((state) => state.coins);
  const exchangedTokens = useTownSimStore((state) => state.exchangedTokens);
  const reputation = useTownSimStore((state) => state.reputation);
  const townLevel = useTownSimStore((state) => state.townLevel);
  const plots = useTownSimStore((state) => state.plots);
  const pens = useTownSimStore((state) => state.pens);
  const resources = useTownSimStore((state) => state.resources);
  const residents = useTownSimStore((state) => state.residents);
  const orders = useTownSimStore((state) => state.orders);
  const redeemCoinsFromTokens = useTownSimStore((state) => state.redeemCoinsFromTokens);
  const plantCrop = useTownSimStore((state) => state.plantCrop);
  const harvestPlot = useTownSimStore((state) => state.harvestPlot);
  const buyPlot = useTownSimStore((state) => state.buyPlot);
  const buyAnimal = useTownSimStore((state) => state.buyAnimal);
  const collectAnimalProduct = useTownSimStore((state) => state.collectAnimalProduct);
  const craftRecipe = useTownSimStore((state) => state.craftRecipe);
  const fulfillOrder = useTownSimStore((state) => state.fulfillOrder);
  const addResident = useTownSimStore((state) => state.addResident);
  const upgradeTown = useTownSimStore((state) => state.upgradeTown);
  const refreshOrders = useTownSimStore((state) => state.refreshOrders);
  const clearTown = useTownSimStore((state) => state.clearTown);

  const [totalTokens, setTotalTokens] = useState(0);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [now, setNow] = useState(Date.now());

  const loadUsage = useCallback(async () => {
    setLoadingUsage(true);
    try {
      const summary = await getApiUsageSummary();
      setTotalTokens(summary.totalTokens);
      setNow(Date.now());
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUsage().catch(() => undefined);
      const timer = setInterval(() => setNow(Date.now()), 30000);
      return () => clearInterval(timer);
    }, [loadUsage])
  );

  const availableCoins = Math.floor(Math.max(0, totalTokens - exchangedTokens) / TOKENS_PER_COIN);
  const nextPlotCost = 45 + plots.length * 20;
  const nextResidentCost = 80 + residents.length * 30;
  const nextUpgradeCost = (townLevel + 1) * 120;
  const nextUpgradeReputation = townLevel * 20;

  function handleRedeem() {
    const claimed = redeemCoinsFromTokens(totalTokens);
    if (claimed <= 0) {
      Alert.alert('还不能兑换', `每 ${TOKENS_PER_COIN} tokens 可兑换 1 金币。`);
    }
  }

  function guardAction(success: boolean, message: string) {
    if (!success) Alert.alert('暂时做不到', message);
  }

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>城镇经营</Text>
        <Pressable style={styles.headerButton} onPress={loadUsage} disabled={loadingUsage}>
          {loadingUsage ? <ActivityIndicator size="small" color={colors.primary} /> : <RefreshCw size={18} color={colors.primary} />}
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.summaryBand}>
          <Metric icon={<Banknote size={18} color={colors.primary} />} label="金币" value={formatNumber(coins)} />
          <Metric icon={<Home size={18} color={colors.primary} />} label="城镇等级" value={`Lv.${townLevel}`} />
          <Metric icon={<Users size={18} color={colors.primary} />} label="居民" value={String(residents.length)} />
        </View>

        <Section title="Token 金库">
          <View style={styles.tokenPanel}>
            <View style={styles.tokenTextBlock}>
              <Text style={styles.panelTitle}>{formatNumber(availableCoins)} 金币可领取</Text>
              <Text style={styles.panelMeta}>
                总 tokens {formatNumber(totalTokens)} · 已兑换 {formatNumber(exchangedTokens)}
              </Text>
              <Text style={styles.panelHint}>兑换比例：{TOKENS_PER_COIN} tokens = 1 金币</Text>
            </View>
            <Pressable
              style={[styles.primaryButton, availableCoins <= 0 && styles.buttonDisabled]}
              onPress={handleRedeem}
              disabled={availableCoins <= 0}
            >
              <Text style={styles.primaryButtonText}>领取</Text>
            </Pressable>
          </View>
        </Section>

        <Section title="仓库">
          <View style={styles.resourceGrid}>
            {(Object.keys(RESOURCE_LABELS) as Array<keyof typeof RESOURCE_LABELS>).map((resourceId) => (
              <View key={resourceId} style={styles.resourceItem}>
                <Text style={styles.resourceAmount}>{formatNumber(resources[resourceId])}</Text>
                <Text style={styles.resourceLabel}>{RESOURCE_LABELS[resourceId]}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section
          title="农田"
          actionLabel={`扩建 ${nextPlotCost}`}
          onAction={() => guardAction(buyPlot(), '金币不足，或农田已经达到上限。')}
        >
          {plots.map((plot, index) => {
            const crop = plot.cropId ? CROP_DEFINITIONS[plot.cropId] : null;
            const ready = !!plot.readyAt && now >= plot.readyAt;
            return (
              <View key={plot.id} style={styles.rowCard}>
                <View style={styles.rowIcon}>
                  <Sprout size={20} color={crop ? colors.success : colors.textTertiary} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>田地 {index + 1}</Text>
                  <Text style={styles.rowMeta}>
                    {crop ? `${crop.label} · ${formatRemaining((plot.readyAt ?? now) - now)}` : '空闲土地'}
                  </Text>
                </View>
                {crop ? (
                  <Pressable
                    style={[styles.smallButton, !ready && styles.buttonDisabled]}
                    disabled={!ready}
                    onPress={() => guardAction(harvestPlot(plot.id), '作物还没成熟。')}
                  >
                    <Text style={styles.smallButtonText}>收获</Text>
                  </Pressable>
                ) : (
                  <View style={styles.actionCluster}>
                    {(Object.keys(CROP_DEFINITIONS) as TownCropId[]).map((cropId) => (
                      <Pressable
                        key={cropId}
                        style={styles.smallButton}
                        onPress={() => guardAction(plantCrop(plot.id, cropId), '金币不足或田地不可用。')}
                      >
                        <Text style={styles.smallButtonText}>
                          {CROP_DEFINITIONS[cropId].label} {CROP_DEFINITIONS[cropId].cost}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </Section>

        <Section title="养殖">
          <View style={styles.actionClusterWide}>
            {(Object.keys(ANIMAL_DEFINITIONS) as TownAnimalId[]).map((animalId) => (
              <Pressable
                key={animalId}
                style={styles.secondaryButton}
                onPress={() => guardAction(buyAnimal(animalId), '金币不足，暂时买不起。')}
              >
                <Text style={styles.secondaryButtonText}>
                  买{ANIMAL_DEFINITIONS[animalId].label} {ANIMAL_DEFINITIONS[animalId].cost}
                </Text>
              </Pressable>
            ))}
          </View>
          {pens.map((pen) => {
            const animal = ANIMAL_DEFINITIONS[pen.animalId];
            const remaining = animal.durationMs - (now - pen.lastCollectedAt);
            const ready = remaining <= 0;
            return (
              <View key={pen.id} style={styles.rowCard}>
                <View style={styles.rowIcon}>
                  <Leaf size={20} color={colors.success} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{animal.label}舍 x{pen.count}</Text>
                  <Text style={styles.rowMeta}>{RESOURCE_LABELS[animal.productId]} · {formatRemaining(remaining)}</Text>
                </View>
                <Pressable
                  style={[styles.smallButton, !ready && styles.buttonDisabled]}
                  disabled={!ready}
                  onPress={() => guardAction(collectAnimalProduct(pen.id), '还没到产出时间。')}
                >
                  <Text style={styles.smallButtonText}>收集</Text>
                </Pressable>
              </View>
            );
          })}
        </Section>

        <Section title="手工作坊">
          {(Object.keys(RECIPE_DEFINITIONS) as TownRecipeId[]).map((recipeId) => {
            const recipe = RECIPE_DEFINITIONS[recipeId];
            return (
              <View key={recipeId} style={styles.rowCard}>
                <View style={styles.rowIcon}>
                  <Factory size={20} color={colors.primary} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{recipe.label}</Text>
                  <Text style={styles.rowMeta}>
                    {inputText(recipe.inputs)} · {recipe.costCoins} 金币 → {RESOURCE_LABELS[recipe.outputId]} x{recipe.outputAmount}
                  </Text>
                </View>
                <Pressable
                  style={styles.smallButton}
                  onPress={() => guardAction(craftRecipe(recipeId), '材料或金币不足。')}
                >
                  <Text style={styles.smallButtonText}>制作</Text>
                </Pressable>
              </View>
            );
          })}
        </Section>

        <Section title="集市委托" actionLabel="换一批" onAction={refreshOrders}>
          {orders.map((order) => (
            <View key={order.id} style={styles.rowCard}>
              <View style={styles.rowIcon}>
                <Wheat size={20} color={colors.primary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{order.title}</Text>
                <Text style={styles.rowMeta}>
                  需要 {RESOURCE_LABELS[order.resourceId]} x{order.amount} · 奖励 {order.rewardCoins} 金币 / {order.rewardReputation} 声望
                </Text>
              </View>
              <Pressable
                style={styles.smallButton}
                onPress={() => guardAction(fulfillOrder(order.id), '仓库数量不够。')}
              >
                <Text style={styles.smallButtonText}>交付</Text>
              </Pressable>
            </View>
          ))}
        </Section>

        <Section
          title="居民与城镇"
          actionLabel={`招募 ${nextResidentCost}`}
          onAction={() => guardAction(addResident(), '金币不足，或居民已满。')}
        >
          <View style={styles.townUpgradePanel}>
            <View>
              <Text style={styles.panelTitle}>声望 {formatNumber(reputation)}</Text>
              <Text style={styles.panelMeta}>升级需要 {nextUpgradeCost} 金币 / {nextUpgradeReputation} 声望</Text>
            </View>
            <Pressable
              style={styles.primaryButton}
              onPress={() => guardAction(upgradeTown(), '金币或声望不足。')}
            >
              <Text style={styles.primaryButtonText}>升级</Text>
            </Pressable>
          </View>
          {residents.map((resident) => (
            <View key={resident.id} style={styles.residentRow}>
              <Text style={styles.residentName}>{resident.name}</Text>
              <Text style={styles.residentRole}>{resident.role}</Text>
              <Text style={styles.residentMood}>{resident.happiness}</Text>
            </View>
          ))}
          <Pressable
            style={styles.resetButton}
            onPress={() => {
              Alert.alert('重置城镇', '确定重置小游戏进度吗？已兑换 token 记录也会重置。', [
                { text: '取消', style: 'cancel' },
                { text: '重置', style: 'destructive', onPress: clearTown },
              ]);
            }}
          >
            <Text style={styles.resetButtonText}>重置城镇</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </View>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <View style={styles.metric}>
      {icon}
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {actionLabel && (
          <Pressable style={styles.sectionAction} onPress={onAction}>
            <Text style={styles.sectionActionText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
    fontSize: 28,
    lineHeight: 30,
    color: colors.text,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 36,
    gap: 14,
  },
  summaryBand: {
    flexDirection: 'row',
    gap: 10,
  },
  metric: {
    flex: 1,
    minHeight: 88,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    justifyContent: 'space-between',
  },
  metricValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  metricLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  sectionAction: {
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
  },
  sectionActionText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  tokenPanel: {
    minHeight: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  tokenTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  panelMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  panelHint: {
    marginTop: 4,
    color: colors.textTertiary,
    fontSize: 12,
  },
  primaryButton: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  resourceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  resourceItem: {
    width: '31.8%',
    minHeight: 66,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  resourceAmount: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  resourceLabel: {
    marginTop: 3,
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },
  rowCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  rowMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  actionCluster: {
    maxWidth: 142,
    gap: 6,
  },
  actionClusterWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallButton: {
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  townUpgradePanel: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  residentRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    gap: 10,
  },
  residentName: {
    width: 54,
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  residentRole: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
  },
  residentMood: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '900',
  },
  resetButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.dangerSurface,
  },
  resetButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '900',
  },
});

let styles = createStyles(colors);
