import Wallet from "../../models/walletSchema.js";
import razorpayInstance from "../../config/razorpay.js";
import crypto from "crypto";
import User from "../../models/userSchema.js";
const loadWallet = async (req, res) => {
  try {
    const userId = req.session.user;

    const user = await User.findById(userId).lean();
    const wallet = await Wallet.findOne({ userId }).lean();

    res.render('wallet', {
      user,
      wallet
    });

  } catch (error) {
    console.error("Wallet load error:", error);
    res.redirect('/pageNotFound');
  }
};

const loadTransactions = async (req, res) => {
  try {
    const userId = req.session.user;

    const user = await User.findById(userId).lean();  
    const wallet = await Wallet.findOne({ userId }).lean();

    res.render("wallet-transactions", {
      user,      
      wallet
    });

  } catch (error) {
    console.error("Wallet transaction load error:", error);
    res.redirect('/pageNotFound');
  }
};


const createWalletOrder = async (req, res) => {
  const { amount } = req.body;

  const razorpayOrder = await razorpayInstance.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: "wallet_" + Date.now()
  });

  res.json({
    key: process.env.RAZORPAY_KEY_ID,
    amount: amount * 100,
    razorpayOrderId: razorpayOrder.id
  });
};

const verifyWalletPayment = async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    amount
  } = req.body;

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    return res.json({ success: false });
  }

  const userId = req.session.user;

  let wallet = await Wallet.findOne({ userId });
  if (!wallet) wallet = await Wallet.create({ userId });

  wallet.balance += Number(amount);

  wallet.transactions.push({
    type: "credit",
    amount,
    description: "Wallet Top-up"
  });

  await wallet.save();

  res.json({ success: true });
};

export {
  loadWallet,
  loadTransactions,
  createWalletOrder,
  verifyWalletPayment
};
export default{
  loadWallet,
  loadTransactions,
  createWalletOrder,
  verifyWalletPayment
};
