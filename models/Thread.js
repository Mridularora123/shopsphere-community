import mongoose from 'mongoose';
const ThreadSchema = new mongoose.Schema({
  shop: String,
  title: String,
  body: String,
  categoryId: mongoose.Schema.Types.ObjectId,
  tags: [String],
  author: {
    customerId: { type: String, default: null },
    isAnonymous: { type: Boolean, default: false },
    displayName: String
  },
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  pinned: { type: Boolean, default: false },
  closed: { type: Boolean, default: false },
  votes: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 }
}, { timestamps: true });
export default mongoose.model('Thread', ThreadSchema);
