// models/NotificationSettings.js
import mongoose from 'mongoose';

const defaults = {
  inApp: {
    reply: true,
    mention: true,
    moderation: true,
    poll_end: true,
    announcement: true,
    digest: true,
  },
  weeklyDigest: true,
};

const NotificationSettingsSchema = new mongoose.Schema(
  {
    shop: { type: String, index: true, required: true },
    userId: { type: String, index: true, required: true },

    inApp: {
      reply: { type: Boolean, default: defaults.inApp.reply },
      mention: { type: Boolean, default: defaults.inApp.mention },
      moderation: { type: Boolean, default: defaults.inApp.moderation },
      poll_end: { type: Boolean, default: defaults.inApp.poll_end },
      announcement: { type: Boolean, default: defaults.inApp.announcement },
      digest: { type: Boolean, default: defaults.inApp.digest },
    },

    weeklyDigest: { type: Boolean, default: defaults.weeklyDigest },
  },
  { timestamps: true }
);

NotificationSettingsSchema.index({ shop: 1, userId: 1 }, { unique: true });

export const NOTIF_DEFAULTS = defaults;
export default mongoose.model('NotificationSettings', NotificationSettingsSchema);
