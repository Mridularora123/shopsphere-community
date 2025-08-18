import mongoose from 'mongoose';
const UserSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  customerId: { type: String, index: true },     // Shopify customer id
  role: { type: String, enum: ['member','moderator','admin'], default: 'member' },
  displayName: String,
}, { timestamps: true });
export default mongoose.model('User', UserSchema);
