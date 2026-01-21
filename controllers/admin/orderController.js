// controllers/admin/orderController.js
import mongoose from "mongoose";
import Order from "../../models/orderSchema.js";
import User from "../../models/userSchema.js";
import { Varient } from "../../models/productSchema.js";


const listOrders = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const search = req.query.search ? req.query.search.trim() : "";
    const status = req.query.status || "";

    const filter = {};

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

    if (!allowedStatus.includes(status)) {
      return res.json({ success: false, message: "Invalid status" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }

    //Immutable states
    if (["delivered", "cancelled"].includes(order.orderStatus)) {
      return res.json({
        success: false,
        message: "Order cannot be modified"
      });
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
      }
    }


    const activeItems = order.orderedItem.filter(
      i => i.orderStatus !== "cancelled"
    );

    if (activeItems.length === 0) {
      order.orderStatus = "cancelled";
    } else if (activeItems.some(i => i.orderStatus === "out for delivery")) {
      order.orderStatus = "out for delivery";
    } else if (activeItems.some(i => i.orderStatus === "shipped")) {
      order.orderStatus = "shipped";
    } else if (activeItems.some(i => i.orderStatus === "pending")) {
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
      item.orderStatus = "returned";

      await Varient.updateOne(
        { productId: item.product },
        { $inc: { stock: item.quantity } }
      );
    }

    //return reject
    if (action === "reject") {
      item.orderStatus = "rejected";
    }

    //refund
    if (action === "refund") {
      if (order.paymentMethod !== "cod") {
        order.paymentStatus = "refunded";
      }
    }

    //orderstatus calculate
    const activeReturns = order.orderedItem.filter(
      i => i.orderStatus === "returnRequested"
    );

    if (activeReturns.length === 0) {
      order.orderStatus = order.orderedItem.every(
        i => i.orderStatus === "returned"
      )
        ? "returned"
        : "delivered";
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
