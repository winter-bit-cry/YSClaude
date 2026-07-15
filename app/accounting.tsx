import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Camera, ChevronDown, Plus, Trash2, WalletCards, X } from 'lucide-react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../src/theme/colors';
import {
  useAccountingStore,
  type AccountingCategory,
  type AccountingTransaction,
  type PaymentMethod,
  type TransactionType,
} from '../src/stores/accounting';

const TABS = ['流水', '统计', '余额与设置'] as const;
const CURRENCIES = [
  { code: 'CNY', symbol: '¥', label: '人民币' },
  { code: 'USD', symbol: '$', label: '美元' },
  { code: 'EUR', symbol: '€', label: '欧元' },
  { code: 'JPY', symbol: '¥', label: '日元' },
  { code: 'GBP', symbol: '£', label: '英镑' },
];
const PALETTE = ['#ED9B73', '#79B8A9', '#8D9BD6', '#D78AA8', '#D2AF62', '#8BB66B', '#9A88C5'];

function money(value: number, currency: string): string {
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol || currency;
  return `${symbol}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function totalsByCurrency<T extends { amount: number; currency: string }>(items: T[]): Record<string, number> {
  return items.reduce<Record<string, number>>((totals, item) => {
    totals[item.currency] = (totals[item.currency] || 0) + item.amount;
    return totals;
  }, {});
}

function moneyList(totals: Record<string, number>): string {
  const entries = Object.entries(totals).filter(([, value]) => value !== 0);
  return entries.length ? entries.map(([currency, value]) => money(value, currency)).join(' / ') : '—';
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function AccountingScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [addVisible, setAddVisible] = useState(false);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()}><ArrowLeft size={22} color={colors.text} /></Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>记账</Text>
        <Pressable style={styles.iconButton} onPress={() => setAddVisible(true)}><Plus size={24} color={colors.primary} /></Pressable>
      </View>
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {TABS.map((label, index) => (
          <Pressable key={label} style={styles.tab} onPress={() => setTab(index)}>
            <Text style={[styles.tabText, { color: tab === index ? colors.primary : colors.textSecondary }]}>{label}</Text>
            {tab === index && <View style={[styles.tabLine, { backgroundColor: colors.primary }]} />}
          </Pressable>
        ))}
      </View>
      {tab === 0 ? <LedgerTab colors={colors} onAdd={() => setAddVisible(true)} /> : tab === 1 ? <StatisticsTab colors={colors} /> : <BalanceSettingsTab colors={colors} />}
      <TransactionModal visible={addVisible} colors={colors} onClose={() => setAddVisible(false)} />
    </View>
  );
}

function LedgerTab({ colors, onAdd }: { colors: ThemeColors; onAdd: () => void }) {
  const transactions = useAccountingStore((state) => state.transactions);
  const methods = useAccountingStore((state) => state.paymentMethods);
  const categories = useAccountingStore((state) => state.categories);
  const removeTransaction = useAccountingStore((state) => state.removeTransaction);
  const [day, setDay] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [methodId, setMethodId] = useState('all');
  const today = dateKey(Date.now());
  const yesterday = dateKey(Date.now() - 86400000);
  const filtered = useMemo(() => transactions
    .filter((item) => day === 'all' || dateKey(item.occurredAt) === day)
    .filter((item) => categoryId === 'all' || item.categoryId === categoryId)
    .filter((item) => methodId === 'all' || item.paymentMethodId === methodId)
    .sort((a, b) => b.occurredAt - a.occurredAt), [transactions, day, categoryId, methodId]);
  const groups = useMemo(() => filtered.reduce<Record<string, AccountingTransaction[]>>((result, item) => {
    (result[dateKey(item.occurredAt)] ||= []).push(item);
    return result;
  }, {}), [filtered]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>筛选</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label="全部日期" active={day === 'all'} onPress={() => setDay('all')} colors={colors} />
        <FilterChip label="今天" active={day === today} onPress={() => setDay(today)} colors={colors} />
        <FilterChip label="昨天" active={day === yesterday} onPress={() => setDay(yesterday)} colors={colors} />
      </ScrollView>
      <SelectRow label="分类" value={categoryId} items={[{ id: 'all', name: '全部分类' }, ...categories]} onChange={setCategoryId} colors={colors} />
      <SelectRow label="付款方式" value={methodId} items={[{ id: 'all', name: '全部方式' }, ...methods]} onChange={setMethodId} colors={colors} />
      {Object.keys(groups).length === 0 ? (
        <View style={styles.empty}><WalletCards size={40} color={colors.textTertiary} /><Text style={[styles.emptyTitle, { color: colors.text }]}>还没有流水</Text><Text style={[styles.emptyText, { color: colors.textSecondary }]}>点击右上角或下方按钮记一笔</Text><Pressable style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={onAdd}><Text style={styles.primaryButtonText}>记一笔</Text></Pressable></View>
      ) : Object.entries(groups).map(([key, items]) => {
        const expense = totalsByCurrency(items.filter((item) => item.type === 'expense'));
        const income = totalsByCurrency(items.filter((item) => item.type === 'income'));
        return <View key={key}>
          <View style={styles.dayHeader}><Text style={[styles.dayTitle, { color: colors.text }]}>{key}</Text><Text style={[styles.daySummary, { color: colors.textSecondary }]}>支 {moneyList(expense)} · 收 {moneyList(income)}</Text></View>
          <View style={[styles.card, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
            {items.map((item, index) => {
              const category = categories.find((entry) => entry.id === item.categoryId);
              const method = methods.find((entry) => entry.id === item.paymentMethodId);
              return <Pressable key={item.id} onLongPress={() => Alert.alert('删除流水', `确定删除「${item.source}」吗？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => removeTransaction(item.id) }])} style={[styles.transaction, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <View style={[styles.transactionIcon, { backgroundColor: `${category?.color || '#999'}22` }]}>{item.type === 'expense' ? <ArrowUpRight size={19} color={category?.color || colors.textSecondary} /> : <ArrowDownLeft size={19} color={colors.success} />}</View>
                <View style={styles.flex}><Text style={[styles.transactionSource, { color: colors.text }]}>{item.source}</Text><Text style={[styles.transactionMeta, { color: colors.textSecondary }]}>{category?.name || '未分类'} · {method?.name || '未知方式'} · {formatTime(item.occurredAt)}</Text></View>
                <Text style={[styles.transactionAmount, { color: item.type === 'expense' ? colors.text : colors.success }]}>{item.type === 'expense' ? '-' : '+'}{money(item.amount, item.currency)}</Text>
              </Pressable>;
            })}
          </View>
        </View>;
      })}
    </ScrollView>
  );
}

function FilterChip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ThemeColors }) {
  return <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? colors.primaryLight : colors.inputBackground, borderColor: active ? colors.primary : colors.border }]}><Text style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }]}>{label}</Text></Pressable>;
}

function SelectRow({ label, value, items, onChange, colors }: { label: string; value: string; items: { id: string; name: string }[]; onChange: (id: string) => void; colors: ThemeColors }) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);
  return <View style={styles.selectWrap}><Pressable style={[styles.select, { backgroundColor: colors.inputBackground, borderColor: colors.border }]} onPress={() => setOpen(!open)}><Text style={[styles.selectLabel, { color: colors.textSecondary }]}>{label}</Text><Text style={[styles.selectValue, { color: colors.text }]}>{selected?.name}</Text><ChevronDown size={16} color={colors.textSecondary} /></Pressable>{open && <View style={[styles.options, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>{items.map((item) => <Pressable key={item.id} style={styles.option} onPress={() => { onChange(item.id); setOpen(false); }}><Text style={{ color: item.id === value ? colors.primary : colors.text }}>{item.name}</Text></Pressable>)}</View>}</View>;
}

function StatisticsTab({ colors }: { colors: ThemeColors }) {
  const transactions = useAccountingStore((state) => state.transactions);
  const categories = useAccountingStore((state) => state.categories);
  const methods = useAccountingStore((state) => state.paymentMethods);
  const defaultCurrency = useAccountingStore((state) => state.currency);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [selectedMonth, setSelectedMonth] = useState(monthKey(Date.now()));
  const months = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - index); return monthKey(date.getTime());
  }), []);
  const monthly = transactions.filter((item) => monthKey(item.occurredAt) === selectedMonth && item.currency === currency);
  const expense = monthly.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  const income = monthly.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const categoryData = categories.map((category) => ({ label: category.name, color: category.color, value: monthly.filter((item) => item.type === 'expense' && item.categoryId === category.id).reduce((sum, item) => sum + item.amount, 0) })).filter((item) => item.value > 0);
  const methodData = methods.map((method) => ({ label: method.name, color: method.color, value: monthly.filter((item) => item.type === 'expense' && item.paymentMethodId === method.id).reduce((sum, item) => sum + item.amount, 0) })).filter((item) => item.value > 0);
  const comparison = months.slice().reverse().map((month) => ({ month, expense: transactions.filter((item) => item.currency === currency && item.type === 'expense' && monthKey(item.occurredAt) === month).reduce((sum, item) => sum + item.amount, 0), income: transactions.filter((item) => item.currency === currency && item.type === 'income' && monthKey(item.occurredAt) === month).reduce((sum, item) => sum + item.amount, 0) }));
  const max = Math.max(1, ...comparison.flatMap((item) => [item.expense, item.income]));

  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{months.map((month) => <FilterChip key={month} label={`${Number(month.slice(5))}月`} active={selectedMonth === month} onPress={() => setSelectedMonth(month)} colors={colors} />)}</ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{CURRENCIES.map((item) => <FilterChip key={item.code} label={`${item.symbol} ${item.code}`} active={currency === item.code} onPress={() => setCurrency(item.code)} colors={colors} />)}</ScrollView>
    <View style={styles.summaryRow}><SummaryCard label="总支出" value={money(expense, currency)} color="#D46753" colors={colors} /><SummaryCard label="总收入" value={money(income, currency)} color={colors.success} colors={colors} /><SummaryCard label="金额变化" value={`${income - expense >= 0 ? '+' : '-'}${money(income - expense, currency)}`} color={income >= expense ? colors.success : '#D46753'} colors={colors} /></View>
    <ChartCard title="月度支出分类" colors={colors}><DonutChart data={categoryData} currency={currency} colors={colors} /></ChartCard>
    <ChartCard title="付款方式支出" colors={colors}><DonutChart data={methodData} currency={currency} colors={colors} /></ChartCard>
    <ChartCard title="近 6 个月对比" colors={colors}><View style={styles.barChart}>{comparison.map((item) => <View key={item.month} style={styles.barColumn}><View style={styles.bars}><View style={[styles.bar, { height: Math.max(2, item.expense / max * 110), backgroundColor: '#ED9B73' }]} /><View style={[styles.bar, { height: Math.max(2, item.income / max * 110), backgroundColor: '#79B8A9' }]} /></View><Text style={[styles.barLabel, { color: colors.textSecondary }]}>{Number(item.month.slice(5))}月</Text></View>)}</View><View style={styles.legendRow}><Legend color="#ED9B73" label="支出" colors={colors} /><Legend color="#79B8A9" label="收入" colors={colors} /></View></ChartCard>
  </ScrollView>;
}

function SummaryCard({ label, value, color, colors }: { label: string; value: string; color: string; colors: ThemeColors }) { return <View style={[styles.summaryCard, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color }]}>{value}</Text></View>; }
function ChartCard({ title, children, colors }: { title: string; children: React.ReactNode; colors: ThemeColors }) { return <View style={[styles.chartCard, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}><Text style={[styles.chartTitle, { color: colors.text }]}>{title}</Text>{children}</View>; }
function Legend({ color, label, colors }: { color: string; label: string; colors: ThemeColors }) { return <View style={styles.legend}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={{ color: colors.textSecondary, fontSize: 12 }}>{label}</Text></View>; }

function DonutChart({ data, currency, colors }: { data: { label: string; value: number; color: string }[]; currency: string; colors: ThemeColors }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = 48; const circumference = 2 * Math.PI * radius; let offset = 0;
  if (!total) return <View style={styles.chartEmpty}><Text style={{ color: colors.textSecondary }}>本月暂无支出数据</Text></View>;
  return <View style={styles.donutRow}><View><Svg width={130} height={130} viewBox="0 0 130 130"><G rotation="-90" origin="65,65"><Circle cx="65" cy="65" r={radius} stroke={colors.surface} strokeWidth="18" fill="none" />{data.map((item) => { const length = item.value / total * circumference; const circle = <Circle key={item.label} cx="65" cy="65" r={radius} stroke={item.color} strokeWidth="18" fill="none" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />; offset += length; return circle; })}</G></Svg><View style={styles.donutCenter}><Text style={[styles.donutLabel, { color: colors.textSecondary }]}>合计</Text><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.donutTotal, { color: colors.text }]}>{money(total, currency)}</Text></View></View><View style={styles.donutLegend}>{data.map((item) => <View key={item.label} style={styles.donutLegendRow}><Legend color={item.color} label={item.label} colors={colors} /><Text style={[styles.donutLegendValue, { color: colors.text }]}>{Math.round(item.value / total * 100)}%</Text></View>)}</View></View>;
}

function BalanceSettingsTab({ colors }: { colors: ThemeColors }) {
  const methods = useAccountingStore((state) => state.paymentMethods);
  const categories = useAccountingStore((state) => state.categories);
  const removeMethod = useAccountingStore((state) => state.removePaymentMethod);
  const removeCategory = useAccountingStore((state) => state.removeCategory);
  const transactions = useAccountingStore((state) => state.transactions);
  const [methodEditor, setMethodEditor] = useState<PaymentMethod | 'new' | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<AccountingCategory | 'new' | null>(null);
  const totals = methods.reduce<Record<string, number>>((result, item) => {
    result[item.currency] = (result[item.currency] || 0) + item.balance;
    return result;
  }, {});
  const confirmMethodDelete = (method: PaymentMethod) => transactions.some((item) => item.paymentMethodId === method.id) ? Alert.alert('无法删除', '该付款方式已有流水记录，请先删除相关流水。') : Alert.alert('删除付款方式', `确定删除「${method.name}」吗？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => removeMethod(method.id) }]);
  const confirmCategoryDelete = (category: AccountingCategory) => transactions.some((item) => item.categoryId === category.id) ? Alert.alert('无法删除', '该分类已有流水记录，请先删除相关流水。') : Alert.alert('删除分类', `确定删除「${category.name}」吗？`, [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => removeCategory(category.id) }]);
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}><Text style={styles.balanceLabel}>总余额（按币种）</Text>{Object.entries(totals).map(([code, value]) => <Text key={code} style={styles.balanceValue}>{money(value, code)}</Text>)}<Text style={styles.balanceHint}>{methods.length} 个付款方式</Text></View>
    <SettingsSection title="付款方式" onAdd={() => setMethodEditor('new')} colors={colors}>{methods.map((method) => <Pressable key={method.id} onPress={() => setMethodEditor(method)} style={[styles.settingsRow, { borderBottomColor: colors.border }]}><MethodIcon method={method} /><View style={styles.flex}><Text style={[styles.settingsName, { color: colors.text }]}>{method.name}</Text><Text style={[styles.settingsHint, { color: colors.textSecondary }]}>{method.currency} · 点击编辑余额与图标</Text></View><Text style={[styles.methodBalance, { color: colors.text }]}>{money(method.balance, method.currency)}</Text><Pressable hitSlop={10} onPress={() => confirmMethodDelete(method)}><Trash2 size={17} color={colors.textTertiary} /></Pressable></Pressable>)}</SettingsSection>
    <SettingsSection title="分类管理" onAdd={() => setCategoryEditor('new')} colors={colors}><View style={styles.categoryGrid}>{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryEditor(category)} onLongPress={() => confirmCategoryDelete(category)} style={[styles.categoryPill, { backgroundColor: `${category.color}22`, borderColor: category.color }]}><View style={[styles.legendDot, { backgroundColor: category.color }]} /><Text style={{ color: colors.text }}>{category.name}</Text></Pressable>)}</View><Text style={[styles.longPressHint, { color: colors.textTertiary }]}>长按分类可删除</Text></SettingsSection>
    <MethodModal item={methodEditor} colors={colors} onClose={() => setMethodEditor(null)} />
    <CategoryModal item={categoryEditor} colors={colors} onClose={() => setCategoryEditor(null)} />
  </ScrollView>;
}

function SettingsSection({ title, onAdd, children, colors }: { title: string; onAdd?: () => void; children: React.ReactNode; colors: ThemeColors }) { return <View><View style={styles.settingsHeader}><Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>{onAdd && <Pressable onPress={onAdd}><Plus size={21} color={colors.primary} /></Pressable>}</View><View style={[styles.card, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>{children}</View></View>; }
function MethodIcon({ method }: { method: PaymentMethod }) { return method.iconUri ? <Image source={{ uri: method.iconUri }} style={styles.methodIconImage} /> : <View style={[styles.methodIcon, { backgroundColor: method.color }]}><WalletCards size={18} color="#fff" /></View>; }

function TransactionModal({ visible, colors, onClose }: { visible: boolean; colors: ThemeColors; onClose: () => void }) {
  const addTransaction = useAccountingStore((state) => state.addTransaction);
  const categories = useAccountingStore((state) => state.categories);
  const methods = useAccountingStore((state) => state.paymentMethods);
  const defaultCurrency = useAccountingStore((state) => state.currency);
  const [type, setType] = useState<TransactionType>('expense'); const [source, setSource] = useState(''); const [amount, setAmount] = useState(''); const [categoryId, setCategoryId] = useState(''); const [methodId, setMethodId] = useState(''); const [currency, setCurrency] = useState(defaultCurrency);
  const availableCategories = categories.filter((item) => item.type === type || item.type === 'both');
  const availableMethods = methods.filter((item) => item.currency === currency);
  const save = () => { const number = Number(amount); const finalCategory = availableCategories.some((item) => item.id === categoryId) ? categoryId : availableCategories[0]?.id; const finalMethod = availableMethods.some((item) => item.id === methodId) ? methodId : availableMethods[0]?.id; if (!source.trim() || !number || number <= 0 || !finalCategory || !finalMethod) return Alert.alert('信息不完整', '请填写来源和有效金额，并选择币种、分类与付款方式。'); addTransaction({ type, source: source.trim(), amount: number, currency, categoryId: finalCategory, paymentMethodId: finalMethod, occurredAt: Date.now() }); setSource(''); setAmount(''); setMethodId(''); onClose(); };
  return <EditorModal visible={visible} title="记一笔" colors={colors} onClose={onClose} onSave={save}><View style={[styles.segment, { backgroundColor: colors.surface }]}>{(['expense', 'income'] as const).map((item) => <Pressable key={item} onPress={() => { setType(item); setCategoryId(''); }} style={[styles.segmentItem, type === item && { backgroundColor: colors.inputBackground }]}><Text style={{ color: type === item ? (item === 'expense' ? '#D46753' : colors.success) : colors.textSecondary, fontWeight: '600' }}>{item === 'expense' ? '支出' : '收入'}</Text></Pressable>)}</View><Field label={type === 'expense' ? '消费物品 / 来源' : '收入来源'} value={source} onChangeText={setSource} colors={colors} /><Field label="金额" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" colors={colors} /><PickerChips title="币种" items={CURRENCIES.map((item) => ({ id: item.code, name: `${item.symbol} ${item.code}` }))} value={currency} onChange={(code) => { setCurrency(code); setMethodId(''); }} colors={colors} /><PickerChips title="分类" items={availableCategories} value={categoryId || availableCategories[0]?.id} onChange={setCategoryId} colors={colors} /><PickerChips title="付款方式" items={availableMethods} value={methodId || availableMethods[0]?.id} onChange={setMethodId} colors={colors} />{availableMethods.length === 0 && <Text style={{ color: colors.textSecondary }}>请先添加该币种的付款方式</Text>}</EditorModal>;
}

function MethodModal({ item, colors, onClose }: { item: PaymentMethod | 'new' | null; colors: ThemeColors; onClose: () => void }) {
  const saveMethod = useAccountingStore((state) => state.savePaymentMethod); const transactions = useAccountingStore((state) => state.transactions); const defaultCurrency = useAccountingStore((state) => state.currency); const existing = item && item !== 'new' ? item : null; const [name, setName] = useState(''); const [balance, setBalance] = useState(''); const [iconUri, setIconUri] = useState<string | undefined>(); const [currency, setCurrency] = useState('');
  const visible = item !== null; const openPicker = async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 }); if (!result.canceled) setIconUri(result.assets[0].uri); };
  const displayName = name || existing?.name || ''; const displayBalance = balance || (existing ? String(existing.balance) : ''); const displayIcon = iconUri ?? existing?.iconUri;
  const displayCurrency = currency || existing?.currency || defaultCurrency;
  const save = () => { if (!displayName.trim() || Number.isNaN(Number(displayBalance))) return Alert.alert('信息不完整', '请输入名称和有效余额。'); if (existing && existing.currency !== displayCurrency && transactions.some((entry) => entry.paymentMethodId === existing.id)) return Alert.alert('无法更换币种', '该付款方式已有流水，为避免历史金额混用，请新增另一个付款方式。'); saveMethod({ id: existing?.id, name: displayName.trim(), balance: Number(displayBalance || 0), currency: displayCurrency, iconUri: displayIcon, color: existing?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)] }); setName(''); setBalance(''); setCurrency(''); setIconUri(undefined); onClose(); };
  return <EditorModal visible={visible} title={existing ? '编辑付款方式' : '新增付款方式'} colors={colors} onClose={onClose} onSave={save}><Field label="名称" value={displayName} onChangeText={setName} colors={colors} /><Field label="当前余额" value={displayBalance} onChangeText={setBalance} keyboardType="decimal-pad" colors={colors} /><PickerChips title="币种" items={CURRENCIES.map((entry) => ({ id: entry.code, name: `${entry.symbol} ${entry.code}` }))} value={displayCurrency} onChange={setCurrency} colors={colors} /><Pressable style={[styles.imagePicker, { borderColor: colors.border }]} onPress={openPicker}>{displayIcon ? <Image source={{ uri: displayIcon }} style={styles.pickerPreview} /> : <Camera size={24} color={colors.textSecondary} />}<Text style={{ color: colors.textSecondary }}>{displayIcon ? '更换自定义图标' : '选择自定义图标'}</Text></Pressable></EditorModal>;
}

function CategoryModal({ item, colors, onClose }: { item: AccountingCategory | 'new' | null; colors: ThemeColors; onClose: () => void }) {
  const saveCategory = useAccountingStore((state) => state.saveCategory); const existing = item && item !== 'new' ? item : null; const [name, setName] = useState(''); const [type, setType] = useState<TransactionType | 'both'>('expense'); const [color, setColor] = useState(PALETTE[0]); const visible = item !== null; const displayName = name || existing?.name || ''; const displayType = existing && name === '' ? existing.type : type; const displayColor = existing && name === '' ? existing.color : color;
  const save = () => { if (!displayName.trim()) return Alert.alert('请输入分类名称'); saveCategory({ id: existing?.id, name: displayName.trim(), type: displayType, color: displayColor }); setName(''); setType('expense'); setColor(PALETTE[0]); onClose(); };
  return <EditorModal visible={visible} title={existing ? '编辑分类' : '新增分类'} colors={colors} onClose={onClose} onSave={save}><Field label="分类名称" value={displayName} onChangeText={setName} colors={colors} /><Text style={[styles.fieldTitle, { color: colors.textSecondary }]}>适用类型</Text><View style={styles.filterRow}>{([{ id: 'expense', name: '支出' }, { id: 'income', name: '收入' }, { id: 'both', name: '通用' }] as const).map((entry) => <FilterChip key={entry.id} label={entry.name} active={displayType === entry.id} onPress={() => { setName(displayName); setType(entry.id); }} colors={colors} />)}</View><Text style={[styles.fieldTitle, { color: colors.textSecondary }]}>颜色</Text><View style={styles.colorRow}>{PALETTE.map((entry) => <Pressable key={entry} onPress={() => { setName(displayName); setColor(entry); }} style={[styles.colorChoice, { backgroundColor: entry }, displayColor === entry && { borderColor: colors.text, borderWidth: 3 }]} />)}</View></EditorModal>;
}

function EditorModal({ visible, title, children, colors, onClose, onSave }: { visible: boolean; title: string; children: React.ReactNode; colors: ThemeColors; onClose: () => void; onSave: () => void }) {
  const dismissAndClose = () => {
    Keyboard.dismiss();
    onClose();
  };
  const dismissAndSave = () => {
    Keyboard.dismiss();
    onSave();
  };
  const content = <View style={[styles.modalCard, { backgroundColor: colors.background }]}><View style={styles.modalHeader}><Pressable onPress={dismissAndClose}><X size={22} color={colors.text} /></Pressable><Text style={[styles.modalTitle, { color: colors.text }]}>{title}</Text><Pressable onPress={dismissAndSave}><Text style={[styles.saveText, { color: colors.primary }]}>保存</Text></Pressable></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>{children}</ScrollView></View>;

  return <Modal visible={visible} animationType={Platform.OS === 'ios' ? 'slide' : 'fade'} transparent onRequestClose={dismissAndClose}>{Platform.OS === 'ios' ? <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">{content}</KeyboardAvoidingView> : <View style={styles.modalBackdrop}>{content}</View>}</Modal>;
}
function Field({ label, value, onChangeText, colors, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; colors: ThemeColors; keyboardType?: 'decimal-pad' }) { return <View><Text style={[styles.fieldTitle, { color: colors.textSecondary }]}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={label} placeholderTextColor={colors.textTertiary} style={[styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border }]} /></View>; }
function PickerChips({ title, items, value, onChange, colors }: { title: string; items: { id: string; name: string }[]; value?: string; onChange: (id: string) => void; colors: ThemeColors }) { return <View><Text style={[styles.fieldTitle, { color: colors.textSecondary }]}>{title}</Text><View style={styles.wrapRow}>{items.map((item) => <FilterChip key={item.id} label={item.name} active={value === item.id} onPress={() => onChange(item.id)} colors={colors} />)}</View></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 }, iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' }, tabs: { height: 48, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center' }, tabText: { fontSize: 14, fontWeight: '600' }, tabLine: { position: 'absolute', bottom: 0, width: 32, height: 3, borderRadius: 3 }, content: { padding: 16, gap: 14, paddingBottom: 40 }, sectionLabel: { fontSize: 12, fontWeight: '600' }, filterRow: { flexDirection: 'row', gap: 8 }, chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, borderWidth: 1 }, chipText: { fontSize: 13 }, selectWrap: { zIndex: 2 }, select: { borderWidth: 1, borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }, selectLabel: { fontSize: 12, width: 72 }, selectValue: { flex: 1, fontSize: 14 }, options: { borderWidth: 1, borderRadius: 12, marginTop: 4, paddingVertical: 4 }, option: { paddingHorizontal: 16, paddingVertical: 11 }, empty: { alignItems: 'center', paddingVertical: 70, gap: 9 }, emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 5 }, emptyText: { fontSize: 13 }, primaryButton: { paddingHorizontal: 24, paddingVertical: 11, borderRadius: 22, marginTop: 8 }, primaryButtonText: { color: '#fff', fontWeight: '700' }, dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 8 }, dayTitle: { fontWeight: '700' }, daySummary: { fontSize: 11 }, card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' }, transaction: { flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11 }, transactionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, transactionSource: { fontSize: 15, fontWeight: '600' }, transactionMeta: { fontSize: 11, marginTop: 4 }, transactionAmount: { fontSize: 14, fontWeight: '700' }, summaryRow: { flexDirection: 'row', gap: 8 }, summaryCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 11 }, summaryLabel: { fontSize: 11 }, summaryValue: { fontSize: 15, fontWeight: '700', marginTop: 6 }, chartCard: { borderWidth: 1, borderRadius: 18, padding: 16 }, chartTitle: { fontSize: 16, fontWeight: '700', marginBottom: 16 }, chartEmpty: { height: 100, alignItems: 'center', justifyContent: 'center' }, donutRow: { flexDirection: 'row', alignItems: 'center' }, donutCenter: { position: 'absolute', left: 32, top: 45, width: 66, alignItems: 'center' }, donutLabel: { fontSize: 10 }, donutTotal: { fontSize: 13, fontWeight: '700', width: 66, textAlign: 'center' }, donutLegend: { flex: 1, gap: 8, marginLeft: 12 }, donutLegendRow: { flexDirection: 'row', justifyContent: 'space-between' }, donutLegendValue: { fontSize: 12, fontWeight: '600' }, legend: { flexDirection: 'row', alignItems: 'center', gap: 6 }, legendDot: { width: 9, height: 9, borderRadius: 5 }, barChart: { height: 140, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around' }, barColumn: { alignItems: 'center', gap: 6 }, bars: { height: 112, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }, bar: { width: 11, borderRadius: 4 }, barLabel: { fontSize: 10 }, legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12 }, balanceCard: { borderRadius: 20, padding: 22 }, balanceLabel: { color: '#fff', opacity: 0.85, fontSize: 13 }, balanceValue: { color: '#fff', fontSize: 32, fontWeight: '700', marginVertical: 8 }, balanceHint: { color: '#fff', opacity: 0.75, fontSize: 12 }, settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2, marginBottom: 8 }, sectionTitle: { fontSize: 16, fontWeight: '700' }, settingsRow: { flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth }, settingsName: { fontSize: 14, fontWeight: '600' }, settingsHint: { fontSize: 11, marginTop: 3 }, methodBalance: { fontSize: 13, fontWeight: '700', marginRight: 8 }, methodIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, methodIconImage: { width: 38, height: 38, borderRadius: 11 }, categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, padding: 13 }, categoryPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 }, longPressHint: { fontSize: 10, paddingHorizontal: 14, paddingBottom: 11 }, currencyRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth }, currencySymbol: { width: 35, fontSize: 18, fontWeight: '700' }, selectedDot: { width: 9, height: 9, borderRadius: 5 }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }, modalCard: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }, modalHeader: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }, modalTitle: { fontSize: 17, fontWeight: '700' }, saveText: { fontWeight: '700', fontSize: 15 }, modalContent: { padding: 18, gap: 18, paddingBottom: 35 }, segment: { flexDirection: 'row', borderRadius: 12, padding: 4 }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 }, fieldTitle: { fontSize: 12, fontWeight: '600', marginBottom: 8 }, input: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 }, wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, imagePicker: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, height: 82, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 12 }, pickerPreview: { width: 50, height: 50, borderRadius: 12 }, colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, colorChoice: { width: 32, height: 32, borderRadius: 16 },
});
