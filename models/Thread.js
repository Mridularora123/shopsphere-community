import mongoose from 'mongoose';

const ThreadSchema = new mongoose.Schema({
  shop: { type: String, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },

  author: {
    customerId: { type: String, default: null },
    displayName: String,
    isAnonymous: { type: Boolean, default: false },
  },

  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  status: { type: String, enum: ['pending','approved','rejected','closed'], default: 'pending', index: true },
  pinned: { type: Boolean, default: false, index: true },
  locked: { type: Boolean, default: false },
  closedAt: Date,

  tags: [{ type: String, index: true }],      // store tag slugs/labels
  votes: { type: Number, default: 0, index: true },
  commentsCount: { type: Number, default: 0, index: true },
  moderationNote: { type: String, default: '' },
  editableUntil: { type: Date, default: null },
  hot: { type: Number, default: 0, index: true },   // for “hot” sorting

  rejectedReason: String,
}, { timestamps: true });

ThreadSchema.index({ shop:1, status:1, categoryId:1, pinned:-1, createdAt:-1 });
ThreadSchema.index({ title: 'text', body: 'text' });

export default mongoose.model('Thread', ThreadSchema);
