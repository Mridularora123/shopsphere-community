import mongoose from 'mongoose';
const CategorySchema = new mongoose.Schema({
  shop: String,
  name: String,
  slug: String,
  order: { type: Number, default: 0 }
}, { timestamps: true });
export default mongoose.model('Category', CategorySchema);
