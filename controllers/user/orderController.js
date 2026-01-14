import Cart from '../../models/cartSchema.js';
import Address from '../../models/addressSchema.js';
import Order from '../../models/orderSchema.js';
import { Product, Varient } from '../../models/productSchema.js';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';

const loadCheckout = async (req, res) => {
  try {
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId })
      .populate('items.productId')
      .lean();
     cart.items = cart.items.map(item => ({
        ...item,
         productName: item.productId.productName,
         productImage: item.productId.images?.[0] || null
      }));

    if (!cart || cart.items.length === 0) {
      return res.redirect('/cart');
    }

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
      baseTotal += i.price * i.quantity;
      finalTotal += i.totalPrice;
    });

    const discount = baseTotal - finalTotal;
    const discountPct = baseTotal
      ? Math.round((discount / baseTotal) * 100)
      : 0;

    res.render('checkout', {
      cart,
      addresses,
      summary: {
        baseTotal,
        finalTotal,
        discount,
        discountPct
      }
    });

  } catch (err) {
    console.error('checkout load error', err);
    res.redirect('/pageNotFound');
  }
};

const placeOrder = async (req, res) => {
  try {
    const userId = req.session.user;
    const { addressIndex } = req.body;

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
      const variant = await Varient.findOne({
        productId: item.productId,
        size: item.size,
        color: item.color,
        isListed: true
      });

      if (!variant || variant.stock < item.quantity) {
        return res.json({
          success: false,
          message: `${item.productId.productName} is out of stock`
        });
      }
    }

    let itemsTotal = 0;
    const orderedItem = cart.items.map(i => {
      itemsTotal += i.totalPrice;
      return {
        product: i.productId._id,
        productName: i.productId.productName,
        productImages: i.productId.images,
        quantity: i.quantity,
        price: i.price,
        offerPrice: i.totalPrice
      };
    });

    const order = await Order.create({
      userId,
      orderedItem,
      itemsTotal,
      finalPrice: itemsTotal,
      discount: 0,
      shippingCharge: 0,
      address: addressDoc.address[addressIndex],
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      orderStatus: 'pending',
      orderDate: new Date()
    });

  
    for (const item of cart.items) {
      await Varient.updateOne(
        {
          productId: item.productId,
          size: item.size,
          color: item.color
        },
        { $inc: { stock: -item.quantity } }
      );
    }

 
    await Cart.deleteOne({ userId });

    res.json({
      success: true,
      orderId: order._id
    });

  } catch (err) {
    console.error('placeOrder error', err);
    res.json({ success: false, message: 'Order failed' });
  }
};

const orderSuccess = async (req, res) => {
  res.render('order-success', { orderId: req.params.orderId });
};
const loadOrders = async (req, res) => {
  try {
    const userId = req.session.user;
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;

    const total = await Order.countDocuments({ userId });
      const orders = await Order.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.render('orders', { 
        orders,
        currentPage: page,
        totalPages: Math.ceil(total / limit)
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

    // 🔁 Cancel specific product
    if (productId) {
      const item = order.orderedItem.find(
        i => i.product.toString() === productId
      );

      if (!item || item.orderStatus === 'cancelled') {
        return res.json({ success: false, message: 'Invalid item' });
      }

      item.orderStatus = 'cancelled';
      item.cancellationReason = reason || '';

      await Varient.updateOne(
        { productId: item.product },
        { $inc: { stock: item.quantity } }
      );
    } 
    // after item cancellation
    const activeItems = order.orderedItem.filter(
      i => i.orderStatus !== 'cancelled'
    );

if (activeItems.length === 0) {
  order.orderStatus = 'cancelled';
}

    // 🔁 Cancel entire order
    else {
      order.orderStatus = 'cancelled';

      for (const item of order.orderedItem) {
        if (item.orderStatus !== 'cancelled') {
          item.orderStatus = 'cancelled';
          item.cancellationReason = reason || '';

          await Varient.updateOne(
            { productId: item.product },
            { $inc: { stock: item.quantity } }
          );
        }
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
  try {
    const userId = req.session.user;
    const { orderId, reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.json({
        success: false,
        message: 'Return reason is required'
      });
    }

    const order = await Order.findOne({ orderId, userId });

    if (!order || order.orderStatus !== 'delivered') {
      return res.json({
        success: false,
        message: 'Return not allowed'
      });
    }

    order.orderStatus = 'returnRequested';

    order.orderedItem.forEach(item => {
      item.returnReason = reason;
      item.orderStatus = 'returnRequested';
    });

    await order.save();

    res.json({ success: true });

  } catch (err) {
    console.error('returnOrder error', err);
    res.json({ success: false, message: 'Return request failed' });
  }
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

    await Varient.updateOne(
      { productId: item.product },
      { $inc: { stock: item.quantity } }
    );

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

    const doc = new PDFDocument();
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${order.orderId}.pdf`
    );
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    doc.fontSize(20).text('INVOICE', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Order ID: ${order.orderId}`);
    doc.text(`Order Date: ${new Date(order.orderDate).toDateString()}`);
    doc.text(`Payment Method: ${order.paymentMethod}`);
    doc.moveDown();

    order.orderedItem.forEach(item => {
      doc.text(
        `${item.productName} | Qty: ${item.quantity} | ₹${item.offerPrice}`
      );
    });

    doc.moveDown();
    doc.text(`Total Amount: ₹${order.finalPrice}`, { bold: true });

    doc.end();

  } catch (err) {
    console.error('downloadInvoice error', err);
    res.status(500).send('Invoice generation failed');
  }
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
  downloadInvoice
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
  downloadInvoice
};
