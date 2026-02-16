import Cart from '../../models/cartSchema.js';
import Address from '../../models/addressSchema.js';
import Order from '../../models/orderSchema.js';
import { Product, Variant } from '../../models/productSchema.js';
import Wallet from "../../models/walletSchema.js";
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import razorpayInstance from '../../config/razorpay.js';
import crypto from 'crypto';
import { Coupon } from "../../models/couponSchema.js";


const round2 = (num) => Number((num || 0).toFixed(2));

async function resolveFinalPrice(variant) {
  if (!variant) return 0;

  const product = await Product.findById(variant.productId).lean();
  if (!product) return variant.price;

  const category = await mongoose.model('Category')
    .findById(product.categoryId)
    .lean();

  let categoryPrice = variant.price;

  if (
    category &&
    category.offerPrice > 0 &&
    (!category.offerValidDate || category.offerValidDate > new Date())
  ) {
    if (category.offerIsPercent) {
      categoryPrice =
        variant.price - (variant.price * category.offerPrice / 100);
    } else {
      categoryPrice =
        variant.price - category.offerPrice;
    }
  }

  const variantDiscount =
    variant.discountPrice && variant.discountPrice > 0
      ? variant.discountPrice
      : variant.price;

  return Math.min(variantDiscount, categoryPrice);
}

const loadCheckout = async (req, res) => {
  try {
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId })
      .populate('items.productId')
      .lean();

  if (!cart || cart.items.length === 0) {
      return res.redirect('/cart');
    }

 cart.items = await Promise.all(
  cart.items.map(async item => {

    const variant = await Variant.findOne({
      productId: item.productId._id,
      size: item.size,
      color: item.color,
      isListed: true
    }).lean();

    if (!variant) {
      return {
        ...item,
        basePrice: item.price,
        price: item.price,
        totalPrice: item.price * item.quantity,
        productName: item.productId.productName,
        productImage: item.productId.images?.[0] || null,
        isUnavailable: true
      };
    }

    const finalPrice = await resolveFinalPrice(variant);

    return {
      ...item,
      basePrice: variant.price,
      price: finalPrice,
      totalPrice: finalPrice * item.quantity,
      productName: item.productId.productName,
      productImage: item.productId.images?.[0] || null,
      isUnavailable:
        item.productId.isDeleted || !item.productId.isListed
    };
  })
);


 

    const addresses = await Address.findOne({ userId }).lean();
    if (!addresses || addresses.address.length === 0) {
      return res.render('checkout', {
        cart,
        addresses: null,
        summary: null
      });
    }

    let baseTotal = 0;
    let finalTotal = 0;

  cart.items.forEach(i => {
  baseTotal += i.basePrice * i.quantity; 
  finalTotal += i.totalPrice;            
});

//coupon discount
const cartTotalBeforeCoupon = finalTotal;
let couponDiscount = 0;
let appliedCoupon = null;

if (req.session.appliedCoupon) {

  const sessionCoupon = await Coupon.findById(
    req.session.appliedCoupon.couponId
  );

  const now = new Date();

  if (
    !sessionCoupon ||
    sessionCoupon.isDeleted ||
    !sessionCoupon.isActive ||
    sessionCoupon.startingDate > now ||
    sessionCoupon.validUntil < now
  ) {
    // Coupon no longer valid
    req.session.appliedCoupon = null;
    req.session.couponInvalidMessage = "Coupon is no longer available";
  } else {
    couponDiscount = req.session.appliedCoupon.discount;
    appliedCoupon = req.session.appliedCoupon.code;
    finalTotal = Number(Math.max(finalTotal - couponDiscount, 0).toFixed(2));
  }
}


//product discount
    const discount = Number((baseTotal - cartTotalBeforeCoupon).toFixed(2));
    const discountPct = baseTotal
      ? Math.round((discount / baseTotal) * 100)
      : 0;

//available coupons
const now = new Date();

const availableCoupons = await Coupon.find({
  isDeleted: false,
  isActive: true,
  startingDate: { $lte: now },
  validUntil: { $gte: now }
}).lean();

// filter coupons based on cart + user usage
const filteredCoupons = [];

for (const coupon of availableCoupons) {

// if (cartTotalBeforeCoupon < coupon.minimumPurchase) continue;


  const userUsage = coupon.redeemedUsers.find(
    u => u.userId.toString() === userId.toString()
  );

  if (
    coupon.usageLimit !== 0 &&
    userUsage &&
    userUsage.count >= coupon.usageLimit
  ) continue;

  filteredCoupons.push(coupon);
}
baseTotal = Number(baseTotal.toFixed(2));
finalTotal = Number(finalTotal.toFixed(2));
couponDiscount = Number(couponDiscount.toFixed(2));


    res.render('checkout', {
      cart,
      addresses,
      availableCoupons: filteredCoupons,
      couponInvalidMessage: req.session.couponInvalidMessage || null,
      cartTotalBeforeCoupon,
      summary: {
        baseTotal,
        finalTotal,
        discount,
        discountPct,
        couponDiscount,
        appliedCoupon,
        cartTotalBeforeCoupon,
      }
    });
  req.session.couponInvalidMessage = null;
  } catch (err) {
    console.error('checkout load error', err);
    res.redirect('/pageNotFound');
  }
};

const placeOrder = async (req, res) => {
  try {
    const userId = req.session.user;
    const { addressIndex, paymentMethod } = req.body;


    const cart = await Cart.findOne({ userId })
      .populate('items.productId');

    if (!cart || cart.items.length === 0) {
      return res.json({ success: false, message: 'Cart empty' });
    }

    const addressDoc = await Address.findOne({ userId });
    if (!addressDoc || !addressDoc.address[addressIndex]) {
      return res.json({ success: false, message: 'Invalid address' });
    }

    // 🔒 Stock validation (STRICT)
    for (const item of cart.items) {

     const product = await Product.findOne({
    _id: item.productId,
    isDeleted: { $ne: true },
    isListed: true
  }).lean();

  if (!product) {
    return res.json({
      success: false,
      message: `${item.productId.productName} is unavailable<br>Please remove unavailable product from the cart continue`
    });
  }

      const variant = await Variant.findOne({
        productId: item.productId,
        size: item.size,
        color: item.color,
        isListed: true
      });

      if (!variant || variant.stock < item.quantity) {
        return res.json({
          success: false,
          message: `${item.productId.productName} is out of stock<br>Please remove out-of-stock product from the cart continue`
        });
      }
    }
    
let itemsTotal = 0;

for (const item of cart.items) {

  const variant = await Variant.findOne({
    productId: item.productId,
    size: item.size,
    color: item.color,
    isListed: true
  }).lean();

  const finalPrice = await resolveFinalPrice(variant);

  item.basePrice = variant.price;

  item.price = finalPrice;
item.totalPrice = round2(finalPrice * item.quantity);
itemsTotal = round2(itemsTotal + item.totalPrice);

}


let couponDiscount = 0;
let couponId = null;

if (req.session.appliedCoupon) {
  couponDiscount = req.session.appliedCoupon.discount;
  couponId = req.session.appliedCoupon.couponId;
}

const finalAmount = round2(Math.max(itemsTotal - couponDiscount, 0));

// proportional coupon share
let distributed = 0;

const orderedItem = cart.items.map((i, index) => {

  const itemTotal = i.totalPrice;

  let share = 0;

  if (couponDiscount > 0) {

    if (index === cart.items.length - 1) {
      // Last item gets remaining amount (prevents rounding mismatch)
      share = round2(couponDiscount - distributed);
    } else {
      share = round2((itemTotal / itemsTotal) * couponDiscount);
      distributed += share;
    }
  }

  return {
    product: i.productId._id,
    productName: i.productId.productName,
    productImages: i.productId.images,
    basePrice: i.basePrice,
    size: i.size,
    color: i.color,
    quantity: i.quantity,
    price: i.price,
    offerPrice: itemTotal,
    couponShare: share
  };
});




if (paymentMethod === 'wallet') {

  const wallet = await Wallet.findOne({ userId });

if (!wallet || wallet.balance < finalAmount) {
  return res.json({
    success: false,
    message: "Insufficient wallet balance, please choose another payment method"
  });
}

wallet.balance -= finalAmount;

wallet.transactions.push({
  type: "debit",
  amount: finalAmount,
  description: "Order Payment"
});


  await wallet.save();



  const order = await Order.create({
    userId,
    orderedItem,
    itemsTotal,
    finalPrice: finalAmount,
    discount: couponDiscount,
    coupenId: couponId,
    address: addressDoc.address[addressIndex],
    paymentMethod: 'wallet',
    paymentStatus: 'completed',
    orderStatus: 'pending'
  });

  for (const item of cart.items) {
  await Variant.updateOne(
    {
      productId: item.productId,
      size: item.size,
      color: item.color
    },
    { $inc: { stock: -item.quantity } }
  );
}


    //coupon discount
   if (couponId) {
  const coupon = await Coupon.findById(couponId);
  
if (!coupon) {
  console.log("Coupon not found during verification");
} else {
  coupon.usedCount += 1;

  const existingUser = coupon.redeemedUsers.find(
    u => u.userId.toString() === userId.toString()
  );

  if (existingUser) {
    existingUser.count += 1;
  } else {
    coupon.redeemedUsers.push({ userId, count: 1 });
  }

  await coupon.save();
}

}

  await Cart.deleteOne({ userId });
  req.session.appliedCoupon = null;

  return res.json({
    success: true,
    paymentMethod: 'wallet',
    orderId: order.orderId
  });
}


if (paymentMethod === 'razorpay') {

  const razorpayOrder = await razorpayInstance.orders.create({
    amount: finalAmount * 100,
    currency: "INR",
    receipt: "receipt_" + Date.now()
  });

  const order = await Order.create({
    userId,
    orderedItem,
    itemsTotal,
    finalPrice: finalAmount,
    discount: couponDiscount,
    coupenId: couponId,
    shippingCharge: 0,
    address: addressDoc.address[addressIndex],
    paymentMethod: 'razorpay',
    paymentStatus: 'pending',
    orderStatus: 'pending',
    orderDate: new Date()
  });

  return res.json({
    success: true,
    paymentMethod: 'razorpay',
    key: process.env.RAZORPAY_KEY_ID,
    amount: finalAmount * 100,
    razorpayOrderId: razorpayOrder.id,
    orderId: order.orderId
  });
}


    const order = await Order.create({
      userId,
      orderedItem,
      itemsTotal,
      finalPrice: finalAmount,
      discount: couponDiscount,
      coupenId: couponId,
      shippingCharge: 0,
      address: addressDoc.address[addressIndex],
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      orderStatus: 'pending',
      orderDate: new Date()
    });


  
    for (const item of cart.items) {
      await Variant.updateOne(
        {
          productId: item.productId,
          size: item.size,
          color: item.color
        },
        { $inc: { stock: -item.quantity } }
      );
    }

   if (couponId) {
  const coupon = await Coupon.findById(couponId);
  
if (!coupon) {
  console.log("Coupon not found during verification");
} else {
  coupon.usedCount += 1;

  const existingUser = coupon.redeemedUsers.find(
    u => u.userId.toString() === userId.toString()
  );

  if (existingUser) {
    existingUser.count += 1;
  } else {
    coupon.redeemedUsers.push({ userId, count: 1 });
  }

  await coupon.save();
}

}

 
    await Cart.deleteOne({ userId });
    req.session.appliedCoupon = null;


res.json({
  success: true,
  paymentMethod: 'cod',
  orderId: order.orderId
});


  } catch (err) {
    console.error('placeOrder error', err);
    res.json({ success: false, message: 'Order failed' });
  }
};

const orderSuccess = async (req, res) => {
  res.render('order-success', { orderId: req.params.orderId });
};

const orderFailure = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const { orderId } = req.params;
  const userId = req.session.user;

  const order = await Order.findOne({ orderId, userId }).lean();
  if (!order) return res.redirect('/orders');

  const tenMinutes = 10 * 60 * 1000;
  const isExpired =
    Date.now() - new Date(order.createdAt).getTime() > tenMinutes;

  let retryAllowed =
    order.paymentMethod === 'razorpay' &&
    order.paymentStatus === 'failed' &&
    order.orderStatus === 'failed' &&
    !order.retryLocked &&
    order.retryCount < 3 &&
    !isExpired;

  let message = req.query.msg || null;

  // 🔥 Auto-set correct message if retry not allowed
  if (!retryAllowed) {

    if (isExpired) {
      message = "Payment session expired. Please place a new order.";
    } 
    else if (order.retryCount >= 3 || order.retryLocked) {
      message = "Maximum retry attempts reached. Please place a new order.";
    }
  }

  res.render('order-failure', {
    orderId,
    message,
    retryAllowed
  });
};
const loadOrders = async (req, res) => {
  try {
    const userId = req.session.user;
    const page = parseInt(req.query.page)||1
    const limit = 5
    const skip = (page-1)*limit



// auto mark expired razorpay pending orders as failed (10 min)
const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

await Order.updateMany(
  {
    userId,
    paymentMethod: "razorpay",
    paymentStatus: { $in: ["pending", "failed"] },
    createdAt: { $lt: tenMinutesAgo }
  },
  {
    $set: {
      paymentStatus: "failed",
      orderStatus: "failed",
      retryLocked: true,
      "orderedItem.$[].orderStatus": "failed"
    }
  }
);
      const orders = await Order.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

   const totalOrders = await Order.countDocuments({ userId });
   const totalPages = Math.ceil(totalOrders / limit);
    
    res.render('orders', { 
        orders,
        currentPage: page,
        totalPages,
        user: req.user  
     });

  } catch (err) {
    console.error('loadOrders error', err);
    res.redirect('/pageNotFound');
  }
};

const getOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.session.user;

    const order = await Order.findOne({ orderId, userId }).lean();

    if (!order) {
      return res.status(404).send('Order not found');
    }

    res.render('order-details', { order });

  } catch (err) {
    console.error('getOrderDetails error', err);
    res.status(500).send('Something went wrong');
  }
};

const cancelOrder = async (req, res) => {
  try {
    const userId = req.session.user;
    const { orderId, productId, reason } = req.body;

    const order = await Order.findOne({ orderId, userId });

    if (!order) {
      return res.json({ success: false, message: 'Order not found' });
    }

    if (['cancelled', 'delivered'].includes(order.orderStatus)) {
      return res.json({
        success: false,
        message: 'Order cannot be cancelled'
      });
    }

   //cancel single product
    if (productId) {
      const item = order.orderedItem.find(
        i => i.product.toString() === productId
      );

      if (!item || item.orderStatus === 'cancelled') {
        return res.json({ success: false, message: 'Invalid item' });
      }


      if (['delivered', 'returnRequested', 'returned'].includes(item.orderStatus)) {
  return res.json({
    success: false,
    message: 'Delivered or returned items cannot be cancelled'
  });
}
      // cancel ONLY this item
      item.orderStatus = 'cancelled';
      item.cancellationReason = reason || '';

 await Variant.updateOne(
  {
    productId: item.product,
    size: item.size,
    color: item.color
  },
  { $inc: { stock: item.quantity } }
);

 // refund single item amount (non-COD only)
if (order.paymentMethod !== "cod") {

const refundAmount = round2(item.offerPrice - (item.couponShare || 0));

  if (refundAmount > 0) {

    let wallet = await Wallet.findOne({ userId });
    if (!wallet) wallet = await Wallet.create({ userId });

wallet.balance = round2(wallet.balance + refundAmount);

    wallet.transactions.push({
      type: "credit",
      amount: refundAmount,
      description: "Refund for cancelled item",
      orderId: order.orderId
    });



    await wallet.save();
  }
}



//recalculate order status
const items = order.orderedItem;

// 1️⃣ All cancelled
if (items.every(i => i.orderStatus === 'cancelled')) {
  order.orderStatus = 'cancelled';
}

// 2️⃣ All returned
else if (items.every(i => i.orderStatus === 'returned')) {
  order.orderStatus = 'returned';
}

// 3️⃣ If ANY delivered exists → delivered
else if (items.some(i => i.orderStatus === 'delivered')) {
  order.orderStatus = 'delivered';
}

// 4️⃣ Mixed returned + cancelled (and no delivered)
else if (
  items.every(i =>
    ['returned', 'cancelled'].includes(i.orderStatus)
  )
) {
  order.orderStatus = 'returned';
}

// 5️⃣ Otherwise keep flow statuses
else if (items.some(i => i.orderStatus === 'out for delivery')) {
  order.orderStatus = 'out for delivery';
}
else if (items.some(i => i.orderStatus === 'shipped')) {
  order.orderStatus = 'shipped';
}
else {
  order.orderStatus = 'pending';
}



//recalculate price box( exclude cancelled product )   
const payableItems = order.orderedItem.filter(
  i => i.orderStatus !== 'cancelled'
);

const newItemsTotal = round2(
  payableItems.reduce((sum, i) => sum + i.offerPrice, 0)
);

const newCouponShare = round2(
  payableItems.reduce((sum, i) => sum + (i.couponShare || 0), 0)
);

order.itemsTotal = newItemsTotal;
order.discount = newCouponShare;
order.finalPrice = round2(
  newItemsTotal - newCouponShare + order.shippingCharge
);



      await order.save();
      return res.json({ success: true });
    }


     //cancel entire order  
    order.orderStatus = 'cancelled';


    //stock manage
    for (const item of order.orderedItem) {
      if (item.orderStatus !== 'cancelled') {
        item.orderStatus = 'cancelled';
        item.cancellationReason = reason || '';

    await Variant.updateOne(
  {
    productId: item.product,
    size: item.size,
    color: item.color
  },
  { $inc: { stock: item.quantity } }
);

      }
    }

    //refund amount after cancellation
    if (order.paymentMethod !== "cod") {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) wallet = await Wallet.create({ userId });

wallet.balance = round2(wallet.balance + order.finalPrice);


  wallet.transactions.push({
    type: "credit",
    amount: order.finalPrice,
    description: "Refund for cancelled order",
    orderId: order.orderId
  });

if (order.paymentMethod !== "cod") {
  order.paymentStatus = 'refunded';
}

  await wallet.save();
}
if (order.coupenId && order.discount > 0) {

  const coupon = await Coupon.findById(order.coupenId);

  if (coupon) {

    coupon.usedCount = Math.max(coupon.usedCount - 1, 0);

    const userEntry = coupon.redeemedUsers.find(
      u => u.userId.toString() === userId.toString()
    );

    if (userEntry) {
      userEntry.count = Math.max(userEntry.count - 1, 0);
    }

    await coupon.save();
  }
}


    await order.save();
    res.json({ success: true });

  } catch (err) {
    console.error('cancelOrder error', err);
    res.json({ success: false, message: 'Cancellation failed' });
  }
};

const returnOrder = async (req, res) => {
  return res.json({
    success: false,
    message: 'Please return items individually'
  });
};


const returnSingleItem = async (req, res) => {
  try {
    const userId = req.session.user;
    const { orderId, productId, reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.json({ success: false, message: 'Return reason required' });
    }

    const order = await Order.findOne({ orderId, userId });
    if (!order) return res.json({ success: false });

    const item = order.orderedItem.find(
      i => i.product.toString() === productId
    );

    if (!item || item.orderStatus !== 'delivered') {
      return res.json({ success: false, message: 'Item not returnable' });
    }

    item.orderStatus = 'returnRequested';
    item.returnReason = reason;

    await order.save();
    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
};

const downloadInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.session.user;

    const order = await Order.findOne({ orderId, userId }).lean();
    if (!order) return res.status(404).send('Order not found');

    const doc = new PDFDocument({ margin: 30 });

 // page + centering
const pageMargin = 30;  // same as PDF margin
const pageWidth = doc.page.width;
const tableWidth = pageWidth - (pageMargin * 2); // full width
const itemX = pageMargin;



    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${order.orderId}.pdf`
    );
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    //header
    doc
      .font('Helvetica')
      .fontSize(22)
      .text('ELFE LOREINVEIL', { align: 'center' });

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('INVOICE', { align: 'center' });

    doc.moveDown(1);

     //customer details
    const addr = order.address;

  doc.font('Helvetica').fontSize(11);
doc.text(`Order ID: ${order.orderId}`, itemX, doc.y);
doc.text(`Date: ${new Date(order.orderDate).toLocaleDateString()}`, itemX);
doc.text(`Customer: ${addr.name}`, itemX);
doc.text(`Phone: ${addr.mobileNumber}`, itemX);
doc.text(
  `Address: ${addr.address}, ${addr.locality}, ${addr.city}, ${addr.state} - ${addr.pincode}`,
  itemX,
  doc.y,
  { width: tableWidth }
);


    doc.moveDown(2);

    //table header
   // ===== TABLE HEADER =====
const tableTop = doc.y;
const rowHeight = 32;



// column positions (relative to table)
const itemColWidth  = tableWidth * 0.38;
const sizeColWidth  = tableWidth * 0.08;
const qtyColWidth   = tableWidth * 0.08;
const priceColWidth = tableWidth * 0.12;
const totalColWidth = tableWidth * 0.14;
const statusColWidth= tableWidth * 0.20;

const sizeX   = itemX + itemColWidth;
const qtyX    = sizeX + sizeColWidth;
const priceX  = qtyX + qtyColWidth;
const totalX  = priceX + priceColWidth;
const statusX = totalX + totalColWidth;



doc
  .rect(itemX, tableTop, tableWidth, rowHeight)
  .fill('#eeeeee')
  .stroke();

doc
  .fillColor('#000')
  .font('Helvetica-Bold')
  .fontSize(11)
  .text('Item', itemX + 5, tableTop + 7)
  .text('Size', sizeX, tableTop + 7)
  .text('Qty', qtyX, tableTop + 7)
  .text('Price', priceX, tableTop + 7)
  .text('Total', totalX, tableTop + 7)
  .text('Status', statusX, tableTop + 7, { width: 100, align: 'left' });

doc.font('Helvetica');




// ===== TABLE ROWS =====
const capitalize = (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : v;

  const getInvoiceItemStatus = (status) => {
  if (status === 'rejected') return 'Delivered';
  return status.charAt(0).toUpperCase() + status.slice(1);;
};
let y = tableTop + rowHeight;
let subtotal = 0;

order.orderedItem.forEach(item => {
const isNonPayable = ['cancelled', 'returned'].includes(item.orderStatus);
const displayStatus = getInvoiceItemStatus(item.orderStatus);

  if (!isNonPayable) {
    subtotal += item.offerPrice;
  }

  if (isNonPayable) doc.fillColor('#888');

  doc.rect(itemX, y, tableWidth, rowHeight).stroke();
doc
  .fontSize(11)
  .text(item.productName, itemX + 5, y + 7, { width: itemColWidth - 10 })
  .text(item.size || '-', sizeX, y + 7)
  .text(item.quantity.toString(), qtyX, y + 7)
  .text(item.price.toString(), priceX, y + 7)
  .text(`Rs.${item.offerPrice}`, totalX, y + 7)
  .text(displayStatus, statusX, y + 7, {
    width: 100,
    align: 'left'
  });


  doc.fillColor('#000');
  y += rowHeight;
});




//payment status
const invoicePaymentStatus =
  order.paymentStatus.charAt(0).toUpperCase() +
  order.paymentStatus.slice(1);



// Y position just below the table
const summaryY = y + 20;

// LEFT BLOCK — Payment info
const leftX = itemX;    

doc
.font('Helvetica')
.fontSize(11)
.text(`Payment Method: ${capitalize(order.paymentMethod)}`, leftX, summaryY)
.text(`Payment Status: ${invoicePaymentStatus}`, leftX, summaryY + 16)
.text(`Order Status: ${capitalize(order.orderStatus)}`, leftX, summaryY + 32);


//right block—Price summary
const rightX = itemX + tableWidth - 180;


//price summary(excluding cancelled, returned)
// Detect full order cancelled/returned
const isFullyCancelledOrReturned =
  order.orderStatus === 'cancelled' ||
  order.orderStatus === 'returned' ||
  order.orderedItem.every(i =>
    ['cancelled', 'returned'].includes(i.orderStatus)
  );

// For full cancel/return → use all items
// For partial → exclude cancelled/returned
const payableItems = isFullyCancelledOrReturned
  ? order.orderedItem
  : order.orderedItem.filter(
      i => !['cancelled', 'returned'].includes(i.orderStatus)
    );

//mrp
const mrpTotal = round2(
  payableItems.reduce(
    (sum, i) => sum + (i.basePrice * i.quantity),
    0
  )
);

//discount on mrp
const offerTotal = round2(
  payableItems.reduce(
    (sum, i) => sum + i.offerPrice,
    0
  )
);


const productDiscount = round2(mrpTotal - offerTotal);

//coupon discount
const couponDiscount = round2(
  payableItems.reduce(
    (sum, i) => sum + (i.couponShare || 0),
    0
  )
);

//final
const finalAmount = round2(
  offerTotal - couponDiscount
);


doc
  .font('Helvetica')
  .fontSize(11)
  .text(`Total MRP: Rs.${mrpTotal}`, rightX, summaryY)
  .text(`Discount on MRP: Rs.${productDiscount}`, rightX, summaryY + 16);

if (couponDiscount > 0) {
  doc.text(`Coupon Discount: Rs.${couponDiscount}`, rightX, summaryY + 32);
}

doc
  .font('Helvetica-Bold')
  .text(
    `Final Amount: Rs.${finalAmount}`,
    rightX,
    couponDiscount > 0 ? summaryY + 48 : summaryY + 32
  );

// Thank you message
doc
  .font('Helvetica')
  .fontSize(12)
  .fillColor('#000')
  .text(
    'Thank you for shopping with us!',
    0,
    summaryY + 80,
    { align: 'center' }
  );

// Website (light)
doc
  .moveDown(0.5)
  .font('Helvetica')
  .fontSize(9)
  .fillColor('#888')
  .text(
    'www.elfein.com',
    { align: 'center' }
  )
  .fillColor('#000'); // reset color


    doc.end();

  } catch (err) {
    console.error('downloadInvoice error', err);
    res.status(500).send('Invoice generation failed');
  }
};

const cancelReturnRequest = async (req, res) => {
  const { orderId, productId } = req.body;
  const userId = req.session.user;

  const order = await Order.findOne({ orderId, userId });
  if (!order) return res.json({ success:false });

  const item = order.orderedItem.find(
    i => i.product.toString() === productId
  );

  if (!item || item.orderStatus !== 'returnRequested') {
    return res.json({ success:false });
  }

  item.orderStatus = 'delivered';
  item.returnReason = '';

  await order.save();
  res.json({ success:true });
};

const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.json({ success: false });
    }

    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.json({ success: false });
    }



 if (
  order.paymentMethod !== 'razorpay' ||
  order.paymentStatus === 'completed'
) {
  return res.json({ success: false });
}

    //Mark payment completed
    order.paymentStatus = 'completed';
 
// If order was previously failed, restore it
if ( order.paymentMethod === 'razorpay' && order.paymentStatus === 'completed') {

  if (order.orderStatus === 'failed') {
    order.orderStatus = 'pending';
  }

  order.orderedItem.forEach(item => {
    if (item.orderStatus === 'failed') {
      item.orderStatus = 'pending';
    }
  });
}

// Reset retry lock
order.retryLocked = false;

    await order.save();

    //Reduce stock
    for (const item of order.orderedItem) {
      await Variant.updateOne(
        {
          productId: item.product,
          size: item.size,
          color: item.color
        },
        { $inc: { stock: -item.quantity } }
      );
    }

const couponId = order.coupenId;
const orderUserId = order.userId;

  if (couponId) {
  const coupon = await Coupon.findById(couponId);
  
if (!coupon) {
  console.log("Coupon not found during verification");
} else {
  coupon.usedCount += 1;

const existingUser = coupon.redeemedUsers.find(
  u => u.userId.toString() === orderUserId.toString()
);

if (existingUser) {
  existingUser.count += 1;
} else {
  coupon.redeemedUsers.push({ userId: orderUserId, count: 1 });
}


  await coupon.save();
}
}


    await Cart.deleteOne({ userId: order.userId });
    req.session.appliedCoupon = null;

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Payment verification failed" });
  }
};


const retryPayment = async (req, res) => {
  try {
    const userId = req.session.user;
    const { orderId } = req.params;

    const order = await Order.findOne({ orderId, userId });

    if (!order) {
      return res.redirect('/orders');
    }

    // Must be Razorpay
    if (order.paymentMethod !== 'razorpay') {
      return res.redirect('/orders');
    }

    // Must be failed
    if (order.paymentStatus !== 'failed' || order.orderStatus !== 'failed') {
      return res.redirect('/orders');
    }

    // Expire after 10 minutes
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - new Date(order.createdAt).getTime() > tenMinutes) {
return res.render('order-failure', {
  orderId,
  message: "Payment session expired. Please place a new order.",
  retryAllowed: false
});
    }

    // Retry limit
    if (order.retryCount >= 3 || order.retryLocked) {
return res.render('order-failure', {
  orderId,
  message: "Maximum retry attempts reached. Please place a new order.",
  retryAllowed: false
});
    }

    // Increment retry count
    order.retryCount += 1;
    await order.save();

    const razorpayOrder = await razorpayInstance.orders.create({
      amount: order.finalPrice * 100,
      currency: "INR",
      receipt: "retry_" + Date.now()
    });

    res.setHeader("Cache-Control", "no-store");

    res.render('retry-payment', {
      order,
      razorpayOrderId: razorpayOrder.id,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error(err);
    res.redirect('/orders');
  }
};

const markOrderFailed = async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.session.user;

    const order = await Order.findOne({ orderId, userId });

    if (!order) {
      return res.json({ success: false });
    }

// Do not override successful payment
if (order.paymentStatus === 'completed') {
  return res.json({ success: true });
}

    order.paymentStatus = 'failed';
    order.orderStatus = 'failed';

    // Mark all items failed
    order.orderedItem.forEach(item => {
      item.orderStatus = 'failed';
    });

    //lock retry payment after 3 retry attempts
   if (order.retryCount >= 3) {
  order.retryLocked = true;

  await order.save();

  return res.json({
    success: true,
    message: "Maximum retry attempts reached. Please place a new order."
  });
}
    await order.save();

    // Clear cart after failure
    // await Cart.deleteOne({ userId });

    return res.json({
    success: true,
    message: "You can retry payment within 10 minutes."
  });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
};

const applyCoupon = async (req, res) => {
  try {
    const userId = req.session.user;
    const { code } = req.body;

    if (!code) {
      return res.json({ success: false, message: "Coupon code required" });
    }

    const cart = await Cart.findOne({ userId }).populate('items.productId');

    if (!cart || cart.items.length === 0) {
      return res.json({ success: false, message: "Cart is empty" });
    }

    const coupon = await Coupon.findOne({
      code: code.trim().toUpperCase(),
      isDeleted: false,
      isActive: true
    });
    
    if (!coupon) {
      return res.json({ success: false, message: "Invalid coupon" });
    }
    
    if (coupon.startingDate > new Date()) {
  return res.json({
    success: false,
    message: "Coupon not yet active"
  });
}
   if (req.session.appliedCoupon) {
  return res.json({
    success: false,
    message: "Only one coupon can be applied"
  });
}

    if (coupon.validUntil < new Date()) {
      return res.json({ success: false, message: "Coupon expired" });
    }

let total = 0;

for (const item of cart.items) {

  const variant = await Variant.findOne({
    productId: item.productId,
    size: item.size,
    color: item.color,
    isListed: true
  }).lean();

  const finalPrice = await resolveFinalPrice(variant);
  total += finalPrice * item.quantity;
}


    if (total < coupon.minimumPurchase) {
      return res.json({
        success: false,
        message: `Minimum purchase Rs.${coupon.minimumPurchase} required`
      });
    }

    // usage limit validation
    const userUsage = coupon.redeemedUsers.find(
      u => u.userId.toString() === userId.toString()
    );

    if (coupon.usageLimit !== 0 && userUsage && userUsage.count >= coupon.usageLimit) {
      return res.json({ success: false, message: "Coupon usage limit reached" });
    }

    let discountAmount = 0;

    if (coupon.discountType === "percentage") {
discountAmount = round2((total * coupon.discountValue) / 100);
      if (discountAmount > coupon.maximumDiscount) {
        discountAmount = coupon.maximumDiscount;
      }
    } else {
discountAmount = round2(coupon.discountValue);
    }

    req.session.appliedCoupon = {
      couponId: coupon._id,
      code: coupon.code,
      discount: discountAmount
    };

    res.json({
      success: true,
      discount: discountAmount
    });

  } catch (err) {
    console.error("applyCoupon error", err);
    res.json({ success: false, message: "Failed to apply coupon" });
  }
};
const removeCoupon = async (req, res) => {
  req.session.appliedCoupon = null;
  res.json({ success: true });
  
};



export {
  loadCheckout,
  placeOrder,
  orderSuccess,
  loadOrders,
  getOrderDetails,
  cancelOrder,
  returnOrder,
  returnSingleItem,
  downloadInvoice,
  cancelReturnRequest,
  verifyPayment,
  orderFailure,
  retryPayment,
  markOrderFailed,
  applyCoupon,
  removeCoupon

};

export default {
  loadCheckout,
  placeOrder,
  orderSuccess,
  loadOrders,
  getOrderDetails,
  cancelOrder,
  returnOrder,
  returnSingleItem,
  downloadInvoice,
  cancelReturnRequest,
  verifyPayment,
  orderFailure,
  retryPayment,
  markOrderFailed,
  applyCoupon,
  removeCoupon
};
