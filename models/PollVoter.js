import mongoose from "mongoose";

const PollVoterSchema = new mongoose.Schema({
  pollId: { type: mongoose.Schema.Types.ObjectId, ref: "Poll", index: true },
  userKey: { type: String, index: true },          // customerId OR device fingerprint
  optionIds: [String],
  votedAt: { type: Date, default: Date.now },
}, { timestamps: true });

PollVoterSchema.index({ pollId:1, userKey:1 }, { unique: true }); // one vote record per user per poll
export default mongoose.model("PollVoter", PollVoterSchema);
