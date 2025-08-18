import mongoose from 'mongoose';

const VoteSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  targetType: { type: String, enum: ['thread','comment'], index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, index: true },

  // Prefer customerId; fallback to fingerprint if you allow anon viewing
  customerId: { type: String, default: null, index: true },
  fingerprint: { type: String, default: '' },
}, { timestamps: true });

// Enforce one vote per user per target
VoteSchema.index(
  { shop:1, targetType:1, targetId:1, customerId:1 },
  { unique:true, partialFilterExpression: { customerId: { $ne: null } } }
);
VoteSchema.index(
  { shop:1, targetType:1, targetId:1, fingerprint:1 },
  { unique:true, partialFilterExpression: { fingerprint: { $ne: '' } } }
);

export default mongoose.model('Vote', VoteSchema);
