import mongoose from 'mongoose';
const PollSchema = new mongoose.Schema({
  shop: String,
  threadId: mongoose.Schema.Types.ObjectId,
  question: String,
  options: [{ id: String, text: String, votes: { type: Number, default: 0 } }],
  status: { type: String, enum: ['open','closed'], default: 'open' }
}, { timestamps: true });
export default mongoose.model('Poll', PollSchema);
