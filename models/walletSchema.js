import mongoose from "mongoose";
const { Schema } = mongoose;

const walletTransactionSchema = new Schema({
  type: {
    type: String,
    enum: ["credit", "debit"],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String
  },
  orderId: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const walletSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    default: 0
  },
  transactions: [walletTransactionSchema]
});

const Wallet = mongoose.model("Wallet", walletSchema);

export default Wallet;
