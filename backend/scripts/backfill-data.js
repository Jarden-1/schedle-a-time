require('dotenv').config();
const mongoose = require('mongoose');
const Event = require('../models/Event');

const generateParticipantId = () => {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

const normalizeConfirmedSlots = (confirmedSlot) => {
  if (!confirmedSlot || !confirmedSlot.date) return [];

  const dates = String(confirmedSlot.date).split(',').map(v => v.trim()).filter(Boolean);
  const startTimes = confirmedSlot.startTime ? String(confirmedSlot.startTime).split(',').map(v => v.trim()) : [];
  const endTimes = confirmedSlot.endTime ? String(confirmedSlot.endTime).split(',').map(v => v.trim()) : [];

  return dates.map((date, index) => ({
    date,
    startTime: startTimes[index] || '',
    endTime: endTimes[index] || ''
  }));
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  let scanned = 0;
  let changed = 0;
  let participantIdsAdded = 0;
  let confirmedSlotsAdded = 0;

  const cursor = Event.find().cursor();
  for await (const event of cursor) {
    scanned++;
    let dirty = false;

    if (Array.isArray(event.participants)) {
      event.participants.forEach((participant) => {
        if (!participant.participantId) {
          participant.participantId = participant.openid || generateParticipantId();
          participantIdsAdded++;
          dirty = true;
        }
        if (!participant.userId) {
          participant.userId = participant.openid || participant.participantId || participant.nickName || '';
          dirty = true;
        }
      });
    }

    if ((!Array.isArray(event.confirmedSlots) || event.confirmedSlots.length === 0) && event.confirmedSlot?.date) {
      const slots = normalizeConfirmedSlots(event.confirmedSlot);
      if (slots.length > 0) {
        event.confirmedSlots = slots;
        confirmedSlotsAdded++;
        dirty = true;
      }
    }

    if (dirty) {
      event.markModified('participants');
      event.markModified('confirmedSlots');
      await event.save();
      changed++;
    }
  }

  console.log(JSON.stringify({
    scanned,
    changed,
    participantIdsAdded,
    confirmedSlotsAdded
  }, null, 2));

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
