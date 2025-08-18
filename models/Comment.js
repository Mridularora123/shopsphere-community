import mongoose from 'mongoose';

const CommentSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread', index: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
  depth: { type: Number, default: 0, index: true },  // 0..3

  body: { type: String, default: '' },

  author: {
    customerId: { type: String, default: null },
    displayName: String,
    isAnonymous: { type: Boolean, default: false },
  },

  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending', index: true },
  votes: { type: Number, default: 0, index: true },
  rejectedReason: String,
  locked: { type: Boolean, default: false },
  moderationNote: { type: String, default: '' },
  editableUntil: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null }, // 'author' | 'moderator'
}, { timestamps: true });

CommentSchema.index({ shop:1, threadId:1, status:1, createdAt:1 });
CommentSchema.index({ threadId:1, parentId:1, createdAt:1 });
CommentSchema.index({ body: 'text' });

export default mongoose.model('Comment', CommentSchema);
