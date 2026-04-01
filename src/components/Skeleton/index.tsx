import { View } from '@tarojs/components';
import './index.scss';

interface SkeletonProps {
  rows?: number;
  avatar?: boolean;
  title?: boolean;
}

export default function Skeleton({ rows = 3, avatar = false, title = false }: SkeletonProps) {
  return (
    <View className="skeleton-container">
      {title && (
        <View className="skeleton-title">
          <View className="skeleton-line" style={{ width: '40%', height: '24px' }} />
        </View>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="skeleton-row">
          {avatar && <View className="skeleton-avatar" />}
          <View className="skeleton-content">
            <View className="skeleton-line" style={{ width: `${80 + Math.random() * 20}%` }} />
            <View className="skeleton-line" style={{ width: `${60 + Math.random() * 30}%`, marginTop: '8px' }} />
          </View>
        </View>
      ))}
    </View>
  );
}
