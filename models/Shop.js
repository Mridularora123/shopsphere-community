import mongoose from 'mongoose';
const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true },
  accessToken: String,
  installedAt: Date,
  settings: {
    allowAnonymous: { type: Boolean, default: true },
    autoApprove: { type: Boolean, default: false },
    editWindowMinutes: { type: Number, default: 15 }
  }
}, { timestamps: true });
export default mongoose.model('Shop', ShopSchema);
