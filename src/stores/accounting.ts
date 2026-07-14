import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sqliteStorage } from '../db/kv-storage';

export type TransactionType = 'expense' | 'income';

export interface AccountingTransaction {
  id: string;
  type: TransactionType;
  source: string;
  amount: number;
  categoryId: string;
  paymentMethodId: string;
  occurredAt: number;
  note?: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  balance: number;
  iconUri?: string;
  color: string;
}

export interface AccountingCategory {
  id: string;
  name: string;
  type: TransactionType | 'both';
  color: string;
}

interface AccountingState {
  _hydrated: boolean;
  transactions: AccountingTransaction[];
  paymentMethods: PaymentMethod[];
  categories: AccountingCategory[];
  currency: string;
  addTransaction: (transaction: Omit<AccountingTransaction, 'id'>) => void;
  removeTransaction: (id: string) => void;
  savePaymentMethod: (method: Omit<PaymentMethod, 'id'> & { id?: string }) => void;
  removePaymentMethod: (id: string) => void;
  saveCategory: (category: Omit<AccountingCategory, 'id'> & { id?: string }) => void;
  removeCategory: (id: string) => void;
  setCurrency: (currency: string) => void;
}

const COLORS = ['#ED9B73', '#79B8A9', '#8D9BD6', '#D78AA8', '#D2AF62', '#8BB66B'];

const DEFAULT_METHODS: PaymentMethod[] = [
  { id: 'cash', name: '现金', balance: 0, color: COLORS[4] },
  { id: 'alipay', name: '支付宝', balance: 0, color: '#4A9EF1' },
  { id: 'wechat', name: '微信', balance: 0, color: '#58B56E' },
  { id: 'bank', name: '银行卡', balance: 0, color: COLORS[2] },
];

const DEFAULT_CATEGORIES: AccountingCategory[] = [
  { id: 'food', name: '餐饮', type: 'expense', color: '#ED9B73' },
  { id: 'transport', name: '交通', type: 'expense', color: '#8D9BD6' },
  { id: 'shopping', name: '购物', type: 'expense', color: '#D78AA8' },
  { id: 'housing', name: '居住', type: 'expense', color: '#D2AF62' },
  { id: 'entertainment', name: '娱乐', type: 'expense', color: '#79B8A9' },
  { id: 'salary', name: '工资', type: 'income', color: '#58B56E' },
  { id: 'other', name: '其他', type: 'both', color: '#9B9B9B' },
];

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function adjustBalance(methods: PaymentMethod[], methodId: string, delta: number): PaymentMethod[] {
  return methods.map((method) => method.id === methodId ? { ...method, balance: method.balance + delta } : method);
}

export const useAccountingStore = create<AccountingState>()(
  persist(
    (set, get) => ({
      _hydrated: false,
      transactions: [],
      paymentMethods: DEFAULT_METHODS,
      categories: DEFAULT_CATEGORIES,
      currency: 'CNY',
      addTransaction: (transaction) => set((state) => ({
        transactions: [{ ...transaction, id: createId('transaction') }, ...state.transactions],
        paymentMethods: adjustBalance(
          state.paymentMethods,
          transaction.paymentMethodId,
          transaction.type === 'income' ? transaction.amount : -transaction.amount,
        ),
      })),
      removeTransaction: (id) => set((state) => {
        const transaction = state.transactions.find((item) => item.id === id);
        if (!transaction) return state;
        return {
          transactions: state.transactions.filter((item) => item.id !== id),
          paymentMethods: adjustBalance(
            state.paymentMethods,
            transaction.paymentMethodId,
            transaction.type === 'income' ? -transaction.amount : transaction.amount,
          ),
        };
      }),
      savePaymentMethod: (method) => set((state) => {
        const id = method.id || createId('method');
        const next = { ...method, id } as PaymentMethod;
        return { paymentMethods: state.paymentMethods.some((item) => item.id === id)
          ? state.paymentMethods.map((item) => item.id === id ? next : item)
          : [...state.paymentMethods, next] };
      }),
      removePaymentMethod: (id) => {
        if (get().transactions.some((item) => item.paymentMethodId === id)) return;
        set((state) => ({ paymentMethods: state.paymentMethods.filter((item) => item.id !== id) }));
      },
      saveCategory: (category) => set((state) => {
        const id = category.id || createId('category');
        const next = { ...category, id } as AccountingCategory;
        return { categories: state.categories.some((item) => item.id === id)
          ? state.categories.map((item) => item.id === id ? next : item)
          : [...state.categories, next] };
      }),
      removeCategory: (id) => {
        if (get().transactions.some((item) => item.categoryId === id)) return;
        set((state) => ({ categories: state.categories.filter((item) => item.id !== id) }));
      },
      setCurrency: (currency) => set({ currency }),
    }),
    {
      name: 'ysclaude-accounting',
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        transactions: state.transactions,
        paymentMethods: state.paymentMethods,
        categories: state.categories,
        currency: state.currency,
      }),
      onRehydrateStorage: () => () => useAccountingStore.setState({ _hydrated: true }),
    },
  ),
);
