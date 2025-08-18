import mongoose from 'mongoose';
const NotificationSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  userId: { type: String, index: true }, // Shopify customer id (string)
  type: { type: String, enum: ['reply','approval','rejection','poll_close'], index: true },
  targetType: { type: String, enum: ['thread','comment','poll'] },
  targetId: { type: String },
  meta: { type: Object, default: {} },
  readAt: { type: Date, default: null },
}, { timestamps: true });
export default mongoose.model('Notification', NotificationSchema);
