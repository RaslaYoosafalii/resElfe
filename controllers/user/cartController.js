// controllers/user/cartController.js
import Cart from '../../models/cartSchema.js';
import Wishlist from '../../models/wishlistSchema.js';
import { Product, Varient } from '../../models/productSchema.js';
import { Category } from '../../models/categorySchema.js';
import mongoose from 'mongoose';

const MAX_QTY_PER_PRODUCT = 5;


const addToCart = async (req, res) => {
  try {
    const userId = req.session.user;
    const { variantId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, message: 'Invalid variant' });
    }

    // 🔍 Variant validation
    const variant = await Varient.findOne({
      _id: variantId,
      isListed: true
    }).lean();

    if (!variant || variant.stock <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Variant unavailable'
      });
    }

    // 🔍 Product validation
    const product = await Product.findOne({
      _id: variant.productId,
      isListed: true,
      isDeleted: { $ne: true }
    }).lean();

    if (!product) {
      return res.status(400).json({
        success: false,
        message: 'Product unavailable'
      });
    }

    // 🔍 Category validation
    const category = await Category.findOne({
      _id: product.categoryId,
      isListed: true,
      isDeleted: { $ne: true }
    }).lean();

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category unavailable'
      });
    }

    // 💰 price resolution
    const unitPrice =
      variant.discountPrice && variant.discountPrice > 0
        ? variant.discountPrice
        : variant.price;

    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    const existingItem = cart.items.find(
      i =>
        i.productId.toString() === product._id.toString() &&
        i.size === variant.size &&
        i.color === variant.color
    );

    // ➕ Increase quantity
    if (existingItem) {
      if (existingItem.quantity >= MAX_QTY_PER_PRODUCT) {
        return res.status(400).json({
          success: false,
          message: 'Maximum quantity reached'
        });
      }

      if (existingItem.quantity + 1 > variant.stock) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock'
        });
      }

      existingItem.quantity += 1;
      existingItem.totalPrice = existingItem.quantity * unitPrice;
    } 
    // ➕ New item
    else {
      cart.items.push({
        productId: product._id,
        quantity: 1,
        price: unitPrice,
        totalPrice: unitPrice,
        size: variant.size,
        color: variant.color
      });
    }

    await cart.save();

    // ❌ Remove from wishlist if exists
    await Wishlist.updateOne(
      { userId },
      { $pull: { products: { productId: product._id } } }
    );

    return res.json({ success: true });

  } catch (error) {
    console.error('addToCart error:', error);
    return res.status(500).json({ success: false });
  }
};

/**
 * 🛒 LOAD CART
 */
const loadCart = async (req, res) => {
  try {
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId })
      .populate('items.productId')
      .lean();

    if (!cart) {
      return res.render('cart', { cart: null });
    }

    // enrich items with stock + UI helpers
    cart.items = await Promise.all(
      cart.items.map(async item => {

const currentVariant = await Varient.findOne({
  productId: item.productId._id,
  size: item.size,
  color: item.color,
  isListed: true
}).lean();

const variants = await Varient.find({
  productId: item.productId._id,
  isListed: true
}).select('_id size stock price discountPrice color').lean();

const basePrice = currentVariant ? currentVariant.price : item.price;


        return {
          ...item,
          productName: item.productId.productName,
          productImage: item.productId.images?.[0],
          stock: currentVariant ? currentVariant.stock : 0,
          maxQty: MAX_QTY_PER_PRODUCT,
          basePrice,
          variants 
        };
      })
    );

    res.render('cart', { cart });

  } catch (error) {
    console.error('loadCart error:', error);
    res.redirect('/pageNotFound');
  }
};

const changeCartSize = async (req, res) => {
  try {
    const userId = req.session.user;
    const { itemId, variantId } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.json({ success: false });

    const item = cart.items.id(itemId);
    if (!item) return res.json({ success: false });

    const variant = await Varient.findOne({
      _id: variantId,
      isListed: true,
      stock: { $gt: 0 }
    });

    if (!variant) {
      return res.json({
        success: false,
        message: 'Selected size out of stock'
      });
    }

    if (item.quantity > variant.stock) {
      return res.json({
        success: false,
        message: 'Not enough stock for selected size'
      });
    }

    const unitPrice =
      variant.discountPrice && variant.discountPrice > 0
        ? variant.discountPrice
        : variant.price;

    item.size = variant.size;
    item.color = variant.color;
    item.price = unitPrice;
    item.totalPrice = unitPrice * item.quantity;

    await cart.save();

    res.json({ success: true });

  } catch (err) {
    console.error('changeCartSize error', err);
    res.json({ success: false });
  }
};

const updateCartQty = async (req, res) => {
  try {
    const userId = req.session.user;
    const { itemId, delta } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.json({ success: false });

    const item = cart.items.id(itemId);
    if (!item) return res.json({ success: false });

    const variant = await Varient.findOne({
      productId: item.productId,
      size: item.size,
      color: item.color,
      isListed: true
    });

    if (!variant) return res.json({ success: false });

    const newQty = item.quantity + Number(delta);

    if (
      newQty < 1 ||
      newQty > MAX_QTY_PER_PRODUCT ||
      newQty > variant.stock
    ) {
      return res.json({ success: false });
    }

item.quantity = newQty;
item.totalPrice = newQty * item.price; 




    await cart.save();
    res.json({ success: true });

  } catch (error) {
    console.error('updateCartQty error:', error);
    res.json({ success: false });
  }
};

/**
 * ❌ REMOVE ITEM
 */
const removeCartItem = async (req, res) => {
  try {
    const userId = req.session.user;
    const { itemId } = req.body;

    await Cart.updateOne(
      { userId },
      { $pull: { items: { _id: itemId } } }
    );

    res.json({ success: true });

  } catch (error) {
    console.error('removeCartItem error:', error);
    res.json({ success: false });
  }
};

export {
  addToCart,
  loadCart,
  updateCartQty,
  removeCartItem,
  changeCartSize
};

export default {
  addToCart,
  loadCart,
  updateCartQty,
  removeCartItem,
  changeCartSize
};