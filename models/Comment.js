import mongoose from 'mongoose';
const CommentSchema = new mongoose.Schema({
  shop: String,
  threadId: mongoose.Schema.Types.ObjectId,
  parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  body: String,
  author: {
    customerId: { type: String, default: null },
    isAnonymous: { type: Boolean, default: false },
    displayName: String,
    isAdmin: { type: Boolean, default: false }
  },
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  votes: { type: Number, default: 0 }
}, { timestamps: true });
export default mongoose.model('Comment', CommentSchema);
