import mongoose from 'mongoose';

const PollVoterSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, index: true },
  pollId: { type: mongoose.Schema.Types.ObjectId, index: true },
  customerId: { type: String, index: true },
  selections: { type: [Number], default: [] }, // store option INDEXES
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'poll_voters' });

PollVoterSchema.index({ shop: 1, pollId: 1, customerId: 1 }, { unique: true });

export default mongoose.models.PollVoter || mongoose.model('PollVoter', PollVoterSchema);
