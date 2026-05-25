import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import { useAppStore } from '@/store';
import './index.scss';

type TabKey = 'home' | 'profile';
type TabItem = { key: TabKey; text: string; pagePath: string; icon: string; iconActive: string; };

const tabs: TabItem[] = [
  { key: 'home', text: '首页', pagePath: '/pages/index/index', icon: '/icon/home-unselected.png', iconActive: '/icon/home-selected.png' },
  { key: 'profile', text: '我的', pagePath: '/pages/profile/index', icon: '/icon/my-unselected.png', iconActive: '/icon/my-selected.png' }
];

export default function CustomTabBar() {
  const {
    tabIndex,
    setTabIndex,
    hasUnreadAnnouncement,
    markAnnouncementRead
  } = useAppStore();

  return (
    <View className="custom-tab-bar">
      {tabs.map((tab, idx) => {
        const active = idx === tabIndex;
        return (
          <View
            key={tab.key}
            className={`custom-tab-bar__item ${active ? 'is-active' : ''}`}
            onClick={() => {
              if (tab.key === 'profile' && hasUnreadAnnouncement) {
                markAnnouncementRead();
              }
              if (active) return;
              setTabIndex(idx);
              Taro.switchTab({ url: tab.pagePath });
            }}
          >
            <View className="custom-tab-bar__icon-wrap">
              <Image className="custom-tab-bar__icon" src={active ? tab.iconActive : tab.icon} mode="aspectFit" />
              {tab.key === 'profile' && hasUnreadAnnouncement ? <View className="custom-tab-bar__dot" /> : null}
            </View>
            <Text className="custom-tab-bar__text">{tab.text}</Text>
          </View>
        );
      })}
    </View>
  );
}
