export const getParticipantDisplayName = (participant: any, fallback = '未命名'): string => {
  const eventDisplayName = participant?.eventDisplayName;
  if (typeof eventDisplayName === 'string' && eventDisplayName.trim()) {
    return eventDisplayName.trim();
  }

  return participant?.nickName || participant?.nickname || fallback;
};

/**
 * 参与者的稳定身份标识。
 *
 * 统计、求交集、去重、重点嘉宾匹配都必须用它，而不是显示名称，
 * 否则两个同名的人会被当成同一个人。
 */
export const getParticipantKey = (participant: any): string => {
  if (!participant) return '';
  const key = participant.participantId
    || participant.openid
    || participant.userId
    || participant.id;
  return key ? String(key) : '';
};

export const buildParticipantNameMap = (participants: any[] = []): Map<string, string> => {
  const map = new Map<string, string>();
  participants.forEach((participant) => {
    const key = getParticipantKey(participant);
    if (!key) return;
    map.set(key, getParticipantDisplayName(participant));
  });
  return map;
};
