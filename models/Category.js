import mongoose from 'mongoose';

const CategorySchema = new mongoose.Schema({
  shop: { type: String, index: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  order: { type: Number, default: 0 },
  visibility: { type: String, enum: ['public','private'], default: 'public' },
}, { timestamps: true });

CategorySchema.index({ shop:1, slug:1 }, { unique:true });

export default mongoose.model('Category', CategorySchema);
