import Cart from '../../models/cartSchema.js';
import Address from '../../models/addressSchema.js';
import Order from '../../models/orderSchema.js';
import { Product, Variant } from '../../models/productSchema.js';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';

const loadCheckout = async (req, res) => {
  try {
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId })
      .populate('items.productId')
      .lean();
     cart.items = await Promise.all(
  cart.items.map(async item => {

    const variant = await Variant.findOne({
      productId: item.productId._id,
      size: item.size,
      color: item.color,
      isListed: true
    }).lean();

    const basePrice = variant ? variant.price : item.price;

    return {
      ...item,
      basePrice,               
      productName: item.productId.productName,
      productImage: item.productId.images?.[0] || null,
      isUnavailable:
        item.productId.isDeleted || !item.productId.isListed
    };
  })
);


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
  baseTotal += i.basePrice * i.quantity; 
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
      await Variant.updateOne(
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

const loadOrders = async (req, res) => {
  try {
    const userId = req.session.user;
    const page = parseInt(req.query.page)||1
    const limit = 5
    const skip = (page-1)*limit

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
        { productId: item.product },
        { $inc: { stock: item.quantity } }
      );
 


//recalculate order status
const activeItems = order.orderedItem.filter(
  i => i.orderStatus !== 'cancelled'
);

if (activeItems.length === 0) {
  order.orderStatus = 'cancelled';
} else if (activeItems.some(i => i.orderStatus === 'out for delivery')) {
  order.orderStatus = 'out for delivery';
} else if (activeItems.some(i => i.orderStatus === 'shipped')) {
  order.orderStatus = 'shipped';
} else {
  order.orderStatus = 'pending';
}


//recalculate price box( exclude cancelled product )   
const payableItems = order.orderedItem.filter(
  i => i.orderStatus !== 'cancelled'
);

const newItemsTotal = payableItems.reduce(
  (sum, i) => sum + i.offerPrice,
  0
);

order.itemsTotal = newItemsTotal;
order.finalPrice =
  newItemsTotal - order.discount + order.shippingCharge;


      await order.save();
      return res.json({ success: true });
    }


     //cancel entire order  
    order.orderStatus = 'cancelled';

    for (const item of order.orderedItem) {
      if (item.orderStatus !== 'cancelled') {
        item.orderStatus = 'cancelled';
        item.cancellationReason = reason || '';

        await Variant.updateOne(
          { productId: item.product },
          { $inc: { stock: item.quantity } }
        );
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

    const doc = new PDFDocument({ margin: 50 });

 // page + centering
 const tableWidth = 580;
const pageWidth = doc.page.width;
const itemX = (pageWidth - tableWidth) / 2;


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
const rowHeight = 24;



// column positions (relative to table)
const qtyX    = itemX + 250;
const priceX  = itemX + 310;
const totalX  = itemX + 380;
const statusX = itemX + 460;

doc
  .rect(itemX, tableTop, tableWidth, rowHeight)
  .fill('#eeeeee')
  .stroke();

doc
  .fillColor('#000')
  .font('Helvetica-Bold')
  .fontSize(11)
  .text('Item', itemX + 5, tableTop + 7)
  .text('Qty', qtyX, tableTop + 7)
  .text('Price', priceX, tableTop + 7)
  .text('Total', totalX, tableTop + 7)
  .text('Status', statusX, tableTop + 7, { width: 90, align: 'left' });

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
    .text(item.productName, itemX + 5, y + 7)
    .text(item.quantity.toString(), qtyX, y + 7)
    .text(item.price.toString(), priceX, y + 7)
    .text(`Rs.${item.offerPrice}`, totalX, y + 7)
    .text(displayStatus, statusX, y + 7, {
      width: 90,
      align: 'left'
    });

  doc.fillColor('#000');
  y += rowHeight;
});



    // Determine invoice payment status
const isFullyCancelled =
  order.orderStatus === 'cancelled' ||
  order.orderedItem.every(i => i.orderStatus === 'cancelled');

let invoicePaymentStatus;

if (isFullyCancelled) {
  invoicePaymentStatus = 'Not Paid';
} else if (order.orderStatus === 'delivered') {
  invoicePaymentStatus = 'Paid';
} else {
  invoicePaymentStatus = order.paymentStatus;
}



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


// right block — Price summary
const rightX = itemX + tableWidth - 180; 

doc
  .font('Helvetica')
  .fontSize(11)
.text(`Subtotal: Rs.${subtotal}`, rightX, summaryY)
.text(`Discount: Rs.${order.discount}`, rightX, summaryY + 16)
.font('Helvetica-Bold')
.text(`Final Amount: Rs.${subtotal - order.discount + order.shippingCharge}`, rightX, summaryY + 32);



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
  cancelReturnRequest
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
  cancelReturnRequest
};
