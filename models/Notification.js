// models/Notification.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const NotificationSchema = new Schema(
  {
    shop:   { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true }, // recipient (customerId)

    // ✅ allow the types you use in code
    type: {
      type: String,
      enum: ['reply', 'moderation', 'system'],
      required: true,
    },

    targetType: {
      type: String,
      enum: ['thread', 'comment', 'poll'],
      required: true,
    },
    targetId: { type: String, required: true },

    payload: { type: Schema.Types.Mixed, default: {} },
    readAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

NotificationSchema.index({ shop: 1, userId: 1, createdAt: -1 });

export default mongoose.models.Notification ||
  mongoose.model('Notification', NotificationSchema);
