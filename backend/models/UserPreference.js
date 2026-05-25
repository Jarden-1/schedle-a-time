const mongoose = require('mongoose');

const UserPreferenceSchema = new mongoose.Schema({
  openid: { type: String, required: true, unique: true },
  weeklyUnavailableSlots: { type: [String], default: [] },
  autoApplyWeeklyUnavailable: { type: Boolean, default: true },
  updatedAt: String
});

module.exports = mongoose.model('UserPreference', UserPreferenceSchema);
