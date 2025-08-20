// models/Notification.js
import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema(
  {
    shop: { type: String, index: true, required: true },
    userId: { type: String, index: true, required: true }, // Shopify customer id (string)

    // what kind of event is this?
    type: {
      type: String,
      enum: [
        'reply',        // someone replied to your thread
        'mention',      // someone @mentioned you
        'moderation',   // your post/comment was approved/rejected/edited/deleted
        'poll_end',     // a poll you care about ended
        'announcement', // admin broadcast
        'digest',       // weekly roundup
      ],
      required: true,
    },

    // where did it happen?
    targetType: { type: String, enum: ['thread', 'comment', 'poll', 'system'], default: 'thread' },
    targetId: { type: String, default: '' },

    // anything else (e.g. {action:'approved'} or {threadId:'...'})
    payload: { type: Object },

    // UX state
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NotificationSchema.index({ shop: 1, userId: 1, createdAt: -1 });

export default mongoose.model('Notification', NotificationSchema);
