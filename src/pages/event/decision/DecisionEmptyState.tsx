import { View, Text } from '@tarojs/components';

interface Props {
  icon: string;
  title: string;
  tip: string;
}

/** 决策面板空状态：没有任何时段有人有空 / 还没有人填写 */
export default function DecisionEmptyState({ icon, title, tip }: Props) {
  return (
    <View className="decision-empty-state">
      <View className="empty-icon-wrap">
        <Text className="empty-icon">{icon}</Text>
      </View>
      <Text className="empty-title">{title}</Text>
      <Text className="empty-tip">{tip}</Text>
    </View>
  );
}
