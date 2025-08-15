import mongoose from 'mongoose';
const UserSchema = new mongoose.Schema({
  shop: String,
  customerId: { type: String, default: null },
  displayName: String,
  role: { type: String, enum: ['member','moderator','admin'], default: 'member' }
}, { timestamps: true });
export default mongoose.model('User', UserSchema);
