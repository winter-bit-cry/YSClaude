import { useMemo } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ScrollView } from 'react-native';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';

import { useSettingsStore } from '../stores/settings';


let colors = lightColors;
interface Props {
  onClose: () => void;
}

export function ModelSelector({ onClose }: Props) {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const { apiConfigs, activeConfigIndex, setActiveConfig } = useSettingsStore();

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.dropdown}>
          <Text style={styles.dropdownTitle}>选择模型</Text>
          {apiConfigs.length === 0 && (
            <Text style={styles.optionSub}>暂无配置，请先在设置中添加</Text>
          )}
          <ScrollView style={styles.optionList} showsVerticalScrollIndicator>
            {apiConfigs.map((config, index) => (
              <Pressable
                key={index}
                style={[styles.option, index === activeConfigIndex && styles.optionActive]}
                onPress={() => {
                  setActiveConfig(index);
                  onClose();
                }}
              >
                <Text
                  style={[styles.optionText, index === activeConfigIndex && styles.optionTextActive]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {config.name || config.model || `配置 ${index + 1}`}
                </Text>
                <Text style={styles.optionSub} numberOfLines={1} ellipsizeMode="tail">
                  {config.model}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdown: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 20,
    width: '80%',
    maxHeight: '60%',
  },
  optionList: {
    maxHeight: 360,
  },
  dropdownTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 4,
    overflow: 'hidden',
  },
  optionActive: {
    backgroundColor: colors.surface,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    width: '100%',
  },
  optionTextActive: {
    color: colors.primary,
  },
  optionSub: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
});

let styles = createStyles(colors);
