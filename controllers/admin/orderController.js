// controllers/admin/orderController.js
import mongoose from "mongoose";
import Order from "../../models/orderSchema.js";
import User from "../../models/userSchema.js";
import { Variant } from "../../models/productSchema.js";
import Wallet from "../../models/walletSchema.js";

const listOrders = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const search = req.query.search ? req.query.search.trim() : "";
    const status = req.query.status || "";

const filter = {
  $and: [
    { orderStatus: { $ne: "failed" } },//not show failed orders
    {
      $or: [
        { paymentMethod: { $ne: "razorpay" } },
        { paymentStatus: { $ne: "pending" } }
      ]
    }
  ]
};


    if (status) {
      filter.orderStatus = status;
    }

    // search by orderId OR user name/email
    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      filter.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { userId: { $in: users.map(u => u._id) } }
      ];
    }

    const totalOrders = await Order.countDocuments(filter);

    const orders = await Order.find(filter)
      .populate("userId", "name email")
      .sort({ orderDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.render("orders-list", {
      allowRender: true,
      orders,
      page,
      totalPages: Math.ceil(totalOrders / limit),
      search,
      status
    });

  } catch (err) {
    console.error("[ADMIN] listOrders error:", err);
    return res.status(500).render("error-page", {
      message: "Failed to load orders"
    });
  }
};


const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ success: false, message: "Invalid order id" });
    }

const allowedStatus = [
  "pending",
  "shipped",
  "out for delivery",
  "delivered",
  "cancelled"
];
const statusFlow = [
  "pending",
  "shipped",
  "out for delivery",
  "delivered"
];

    if (!allowedStatus.includes(status)) {
      return res.json({ success: false, message: "Invalid status" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }
//prevent manual change TO returned
if (status === "returned") {
  return res.json({
    success: false,
    message: "Returned status is system controlled"
  });
}

//if already returned, completely immutable
if (order.orderStatus === "returned") {
  return res.json({
    success: false,
    message: "Returned orders cannot be modified"
  });
}

    const currentStatus = order.orderStatus;

//delivered, returned or cancelled → immutable
if (["delivered", "cancelled","returned"].includes(currentStatus)) {
  return res.json({
    success: false,
    message: "This order status can no longer be changed"
  });
}

// Cancelled is only allowed from pending
if (status === "cancelled" && currentStatus !== "pending") {
  return res.json({
    success: false,
    message: "Only pending orders can be cancelled"
  });
}

// Validate forward-only one-step flow
const currentStatusIndex = statusFlow.indexOf(currentStatus);
const nextStatusIndex = statusFlow.indexOf(status);

// Trying to jump or reverse
if (currentStatusIndex !== -1 && nextStatusIndex !== -1) {
  if (nextStatusIndex !== currentStatusIndex + 1) {
    return res.json({
      success: false,
      message: `Invalid status transition: ${currentStatus} → ${status}`
    });
  }
}



    for (const item of order.orderedItem) {
      if (
        ["cancelled", "returnRequested", "returned", "rejected"].includes(
          item.orderStatus
        )
      ) {
        continue;
      }

      if (status === "shipped" && item.orderStatus === "pending") {
        item.orderStatus = "shipped";
      }

      if (
        status === "out for delivery" &&
        item.orderStatus === "shipped"
      ) {
        item.orderStatus = "out for delivery";
      }

      if (status === "delivered") {
        item.orderStatus = "delivered";
        item.deliveredOn = new Date();

          //if COD, mark payment as completed when delivered
          if (order.paymentMethod === "cod") {
            order.paymentStatus = "completed";
          }
      }
    }


const items = order.orderedItem;

// 1️⃣ All cancelled
if (items.every(i => i.orderStatus === "cancelled")) {
  order.orderStatus = "cancelled";
}

// 2️⃣ All returned
else if (items.every(i => i.orderStatus === "returned")) {
  order.orderStatus = "returned";
}

// 3️⃣ If ANY delivered exists → delivered
else if (items.some(i => i.orderStatus === "delivered")) {
  order.orderStatus = "delivered";
}

// 4️⃣ Mixed returned + cancelled (no delivered)
else if (
  items.every(i =>
    ["returned", "cancelled"].includes(i.orderStatus)
  )
) {
  order.orderStatus = "returned";
}

// 5️⃣ Flow statuses
else if (items.some(i => i.orderStatus === "out for delivery")) {
  order.orderStatus = "out for delivery";
}
else if (items.some(i => i.orderStatus === "shipped")) {
  order.orderStatus = "shipped";
}
else {
  order.orderStatus = "pending";
}



    if (status === "delivered") {
      order.orderStatus = "delivered";
      order.deliveredOn = new Date();
    }

    order.updatedAt = new Date();
    await order.save();

    return res.json({ success: true });

  } catch (err) {
    console.error("[ADMIN] updateOrderStatus error:", err);
    return res.json({
      success: false,
      message: "Failed to update order status"
    });
  }
};




const viewOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/admin/order");
    }

    const order = await Order.findById(id)
      .populate("userId", "name email mobileNumber")
      .populate("orderedItem.product")
      .lean();

    if (!order) {
      return res.redirect("/admin/order");
    }

    return res.render("admin-order-details", {allowRender: true, order });

  } catch (err) {
    console.error("[ADMIN] viewOrderDetails error:", err);
    return res.status(500).render("error-page", {
      message: "Failed to load order details"
    });
  }
};


const loadReturnRefunds = async (req, res) => {
  try {
    const orders = await Order.find({
      "orderedItem.orderStatus": "returnRequested"
    })
      .populate("userId", "name email")
      .lean();

    res.render("return-refund", { allowRender: true, orders });
  } catch (err) {
    console.error("[ADMIN] loadReturnRefunds error:", err);
    res.render("return-refund", {allowRender: true, orders: [] });
  }
};

const handleReturnAction = async (req, res) => {
  try {
    const { orderId, productId, action } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.json({ success: false });

    const item = order.orderedItem.find(
      i => i.product.toString() === productId
    );

    if (!item || item.orderStatus !== "returnRequested") {
      return res.json({ success: false, message: "Invalid return item" });
    }

  //returned approve
  if (action === "approve") {

    if (item.orderStatus === "returned") {
      return res.json({ success: false, message: "Already processed" });
    }

  item.orderStatus = "returned";

  // restore stock
  await Variant.updateOne(
    { productId: item.product },
    { $inc: { stock: item.quantity } }
  );

  // Auto wallet refund 
    const wallet = await Wallet.findOne({ userId: order.userId });

    if (wallet) {

      const refundAmount = item.offerPrice - (item.couponShare || 0);
      wallet.balance += refundAmount;


      wallet.transactions.push({
        type: "credit",
        amount: refundAmount,
        description: "Refund for returned product",
        orderId: order.orderId
      });

      await wallet.save();

      if (order.orderedItem.every(i => i.orderStatus === "returned")) {
      order.paymentStatus = "refunded";
      }
    }

    order.paymentStatus = "refunded";

}


    //return reject
    if (action === "reject") {
      item.orderStatus = "rejected";
      item.deliveredOn = item.deliveredOn || new Date();
    }

 

    //orderstatus calculate
const items = order.orderedItem;

// 1️⃣ All cancelled
if (items.every(i => i.orderStatus === "cancelled")) {
  order.orderStatus = "cancelled";
}

// 2️⃣ All returned
else if (items.every(i => i.orderStatus === "returned")) {
  order.orderStatus = "returned";
}

// 3️⃣ If ANY delivered exists → delivered
else if (items.some(i => i.orderStatus === "delivered")) {
  order.orderStatus = "delivered";
}

// 4️⃣ Mixed returned + cancelled (no delivered)
else if (
  items.every(i =>
    ["returned", "cancelled"].includes(i.orderStatus)
  )
) {
  order.orderStatus = "returned";
}

// 5️⃣ Otherwise default to delivered (after return processing)
else {
  order.orderStatus = "delivered";
}

    order.updatedAt = new Date();
    await order.save();

    res.json({ success: true });

  } catch (err) {
    console.error("[ADMIN] handleReturnAction error:", err);
    res.json({ success: false });
  }
};


export default {
  listOrders,
  updateOrderStatus,
  viewOrderDetails,
  loadReturnRefunds,
  handleReturnAction
};

export {
  listOrders,
  updateOrderStatus,
  viewOrderDetails,
  loadReturnRefunds,
  handleReturnAction
};
