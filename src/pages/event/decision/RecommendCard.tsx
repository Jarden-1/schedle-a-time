import { View, Text } from '@tarojs/components';
import { formatDate, formatTime } from '@/utils';

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface RecommendSummary {
  vipText: string;
  vipUnavailableUsers: string[];
  vipUnavailableText: string;
  reasonText: string;
  unavailableUsers: string[];
  unavailableText: string;
}

interface Props {
  slot: any;
  index: number;
  isSelected: boolean;
  summary: RecommendSummary;
  isDateOnly: boolean;
  onClick: () => void;
}

/** 决策面板的 Top N 推荐卡片（纯展示） */
export default function RecommendCard({ slot, index, isSelected, summary, isDateOnly, onClick }: Props) {
  const dateText = isDateOnly && slot.startDate !== slot.endDate
    ? `${formatDate(slot.startDate, 'MM/DD')}(${WEEK_NAMES[new Date(slot.startDate.replace(/-/g, '/')).getDay()]})`
      + ` - ${formatDate(slot.endDate, 'MM/DD')}(${WEEK_NAMES[new Date(slot.endDate.replace(/-/g, '/')).getDay()]})`
    : `${formatDate(slot.date, 'MM/DD')}(${WEEK_NAMES[new Date(slot.date.replace(/-/g, '/')).getDay()]})`;

  return (
    <View
      className={`top3-card rank-${index + 1} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <View className="recommend-card-top">
        <View className="rank-badge">Top {index + 1}</View>
        <View className="match-rate">
          <Text className="rate-text">{Math.round(slot.matchRate * 100)}%</Text>
          <Text className="count-text">{slot.availableCount}/{slot.totalCount} 人</Text>
        </View>
      </View>

      <View className="slot-info">
        <Text className="date">{dateText}</Text>
        {!isDateOnly && (
          <Text className="time">{formatTime(slot.startTime)} - {formatTime(slot.endTime)}</Text>
        )}
        {slot.slotKeys.length > 1 && (
          <Text className="merged-hint">
            {isDateOnly ? `连续 ${slot.slotKeys.length} 天` : `连续 ${slot.slotKeys.length} 个时段`}
          </Text>
        )}
      </View>

      <View className={`vip-line ${summary.vipUnavailableUsers.length > 0 ? 'warn' : ''}`}>
        <Text>{summary.vipText}</Text>
        {summary.vipUnavailableUsers.length > 0
          ? <Text className="vip-absent">缺席：{summary.vipUnavailableText}</Text>
          : null}
      </View>

      <View className="reason-line">
        <Text className="reason-label">推荐原因</Text>
        <Text className="reason-text">{summary.reasonText}</Text>
      </View>

      <View className="absent-line">
        <Text className="reason-label">没空</Text>
        <Text className="absent-text">
          {summary.unavailableUsers.length === 0 ? '无' : summary.unavailableText}
        </Text>
      </View>

      {isSelected && <View className="selected-icon">✓</View>}
    </View>
  );
}
