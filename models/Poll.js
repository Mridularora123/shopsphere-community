import mongoose from "mongoose";

const PollSchema = new mongoose.Schema({
  shop: { type: String, index: true },                          // multi-tenant
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: "Thread", required: true, index: true },
  question: { type: String, required: true },
  options: [{ id: String, text: String, votes: { type: Number, default: 0 } }],
  multipleAllowed: { type: Boolean, default: false },
  anonymous: { type: Boolean, default: false },
  startAt: Date,
  endAt: Date,
  showResults: { type: String, enum: ["always","afterVote","afterClose"], default: "afterVote" },
  status: { type: String, enum: ["open","closed"], default: "open" },
}, { timestamps: true });

PollSchema.index({ shop:1, threadId:1 });
export default mongoose.model("Poll", PollSchema);
