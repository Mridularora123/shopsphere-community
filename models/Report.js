import mongoose from 'mongoose';
const ReportSchema = new mongoose.Schema({
  shop: String,
  targetType: { type: String, enum: ['thread','comment'] },
  targetId: mongoose.Schema.Types.ObjectId,
  reason: String,
  createdBy: { customerId: String, isAnonymous: Boolean },
  status: { type: String, enum: ['open','resolved'], default: 'open' },
  resolvedBy: String,
  notes: String
}, { timestamps: true });
export default mongoose.model('Report', ReportSchema);
