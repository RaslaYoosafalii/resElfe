import Wishlist from '../../models/wishlistSchema.js';
import { Variant } from '../../models/productSchema.js';
import mongoose from 'mongoose';


const addToWishlist = async (req, res) => {
  try {
    const userId = req.session.user;
    const { productId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product' });
    }

    let wishlist = await Wishlist.findOne({ userId });

    if (!wishlist) {
      wishlist = new Wishlist({
        userId,
        products: [{ productId }]
      });
    } else {
      const alreadyExists = wishlist.products.some(
        p => String(p.productId) === String(productId)
      );

      if (alreadyExists) {
        return res.json({
          success: false,
          already: true,
          message: 'Already in wishlist'
        });
      }

      wishlist.products.push({ productId });
    }

    await wishlist.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('addToWishlist error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to add to wishlist'
    });
  }
};


const removeFromWishlist = async (req, res) => {
  try {
    const userId = req.session.user;
    const { productId } = req.body;

    const wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      return res.json({ success: false });
    }

    wishlist.products = wishlist.products.filter(
      p => String(p.productId) !== String(productId)
    );

    await wishlist.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('removeFromWishlist error:', err);
    return res.status(500).json({ success: false });
  }
};



const loadWishlist = async (req, res) => {
  try {
    const userId = req.session.user;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 12;
    const skip = (page - 1) * limit;

    const wishlist = await Wishlist.findOne({ userId })
      .populate({
        path: 'products.productId',
        populate: {
          path: 'subcategoryId',
          select: 'fitName'
        }
      })
      .lean();

    if (!wishlist || !wishlist.products.length) {
      return res.render('wishlist', {
        products: [],
        pagination: null
      });
    }

    const productIds = wishlist.products.map(w => w.productId._id);

const variants = await Variant.aggregate([
  { $match: { productId: { $in: productIds }, isListed: true } },

  {
    $lookup: {
      from: 'products',
      localField: 'productId',
      foreignField: '_id',
      as: 'product'
    }
  },
  {
    $addFields: {
      productData: { $arrayElemAt: ['$product', 0] }
    }
  },
  {
    $lookup: {
      from: 'categories',
      localField: 'productData.categoryId',
      foreignField: '_id',
      as: 'category'
    }
  },
  {
    $addFields: {
      categoryData: { $arrayElemAt: ['$category', 0] }
    }
  },
  {
    $addFields: {
      categoryOfferActive: {
        $cond: [
          {
            $and: [
              { $gt: ['$categoryData.offerPrice', 0] },
              {
                $or: [
                  { $eq: ['$categoryData.offerValidDate', null] },
                  { $gt: ['$categoryData.offerValidDate', new Date()] }
                ]
              }
            ]
          },
          true,
          false
        ]
      }
    }
  },
  {
    $addFields: {
      finalVariantPrice: {
        $let: {
          vars: {
            variantDiscount: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$discountPrice', null] },
                    { $gt: ['$discountPrice', 0] }
                  ]
                },
                '$discountPrice',
                '$price'
              ]
            },
            categoryDiscounted: {
              $cond: [
                '$categoryOfferActive',
                {
                  $cond: [
                    '$categoryData.offerIsPercent',
                    {
                      $multiply: [
                        '$price',
                        {
                          $subtract: [
                            1,
                            { $divide: ['$categoryData.offerPrice', 100] }
                          ]
                        }
                      ]
                    },
                    { $subtract: ['$price', '$categoryData.offerPrice'] }
                  ]
                },
                '$price'
              ]
            }
          },
          in: { $min: ['$$variantDiscount', '$$categoryDiscounted'] }
        }
      }
    }
  },
  {
    $group: {
      _id: '$productId',
      minPrice: { $min: '$price' },
      minFinalPrice: { $min: '$finalVariantPrice' }
    }
  }
]);


    const priceMap = {};
    variants.forEach(v => {
      priceMap[String(v._id)] = v;
    });

    const allProducts = wishlist.products.map(w => {
      const p = w.productId;
      const priceInfo = priceMap[String(p._id)] || {};


      const isUnavailable = p.isDeleted || !p.isListed;
      return {
        _id: p._id,
        productName: p.productName,
        images: p.images,
        subcategoryName: p.subcategoryId?.fitName || '',
        _price: priceInfo.minPrice || 0,
     minVariantDiscountPrice:
  priceInfo.minFinalPrice < priceInfo.minPrice
    ? priceInfo.minFinalPrice
    : null,

            isUnavailable
      };
    });

    const totalProducts = allProducts.length;
    const totalPages = Math.ceil(totalProducts / limit);
    const products = allProducts.slice(skip, skip + limit);

    res.render('wishlist', {
      products,
      pagination: {
        page,
        totalPages
      }
    });

  } catch (err) {
    console.error('loadWishlist error:', err);
    res.redirect('/pageNotFound');
  }
};

export {
  addToWishlist,
  removeFromWishlist,
  loadWishlist
};
export default {
  addToWishlist,
  removeFromWishlist,
  loadWishlist
};

