import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  targetType: { type: String, enum: ['thread','comment'], index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, index: true },
  reason: String,
  createdBy: { customerId: String, isAnonymous: Boolean },

  status: { type: String, enum: ['open','resolved'], default: 'open', index: true },
  resolvedAt: Date,
}, { timestamps: true });

ReportSchema.index({ shop:1, status:1, createdAt:-1 });

export default mongoose.model('Report', ReportSchema);
