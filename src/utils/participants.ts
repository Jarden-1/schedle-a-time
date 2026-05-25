export const getParticipantDisplayName = (participant: any, fallback = '未命名'): string => {
  const eventDisplayName = participant?.eventDisplayName;
  if (typeof eventDisplayName === 'string' && eventDisplayName.trim()) {
    return eventDisplayName.trim();
  }

  return participant?.nickName || participant?.nickname || fallback;
};
