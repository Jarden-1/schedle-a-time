import { View, Text, Button } from '@tarojs/components';
import './index.scss';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon = '📭',
  title,
  description,
  actionText,
  onAction
}: EmptyStateProps) {
  return (
    <View className="empty-state">
      <Text className="empty-icon">{icon}</Text>
      <Text className="empty-title">{title}</Text>
      {description && <Text className="empty-desc">{description}</Text>}
      {actionText && onAction && (
        <Button className="empty-action" onClick={onAction}>{actionText}</Button>
      )}
    </View>
  );
}
