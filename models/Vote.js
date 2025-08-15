import mongoose from 'mongoose';
const VoteSchema = new mongoose.Schema({
  shop: String,
  targetType: { type: String, enum: ['thread','comment'] },
  targetId: mongoose.Schema.Types.ObjectId,
  customerId: { type: String, default: null },
  fingerprint: String,
  value: { type: Number, enum: [1], default: 1 }
}, { timestamps: true });
VoteSchema.index({ shop:1, targetType:1, targetId:1, customerId:1, fingerprint:1 }, { unique: true });
export default mongoose.model('Vote', VoteSchema);
