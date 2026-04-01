import { View } from '@tarojs/components';
import './index.scss';

interface LoadingProps {
  size?: 'small' | 'medium' | 'large';
  text?: string;
  fullScreen?: boolean;
}

export default function Loading({ 
  size = 'medium', 
  text = '加载中...',
  fullScreen = false 
}: LoadingProps) {
  const sizeMap = {
    small: { spinner: 20, fontSize: 12 },
    medium: { spinner: 32, fontSize: 14 },
    large: { spinner: 48, fontSize: 16 }
  };

  const { spinner, fontSize } = sizeMap[size];

  return (
    <View 
      className={`loading-container ${fullScreen ? 'full-screen' : ''}`}
      style={fullScreen ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 } : {}}
    >
      <View className="loading-content">
        <View 
          className="loading-spinner" 
          style={{ 
            width: `${spinner}px`, 
            height: `${spinner}px`,
            borderWidth: `${spinner / 8}px`
          }} 
        />
        {text && (
          <View className="loading-text" style={{ fontSize: `${fontSize}px`, marginTop: `${spinner / 2}px` }}>
            {text}
          </View>
        )}
      </View>
    </View>
  );
}
