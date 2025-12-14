// controllers/user/productController.js

const { Product, Varient } = require('../../models/productSchema');
const { Category, SubCategory } = require('../../models/categorySchema');
const mongoose = require('mongoose');

/* ------------------------------- UTILITIES ------------------------------- */

function parseQuery(req) {
  const q = (req.query && req.query.q) ? String(req.query.q).trim() : '';
  const sort = (req.query && req.query.sort) ? String(req.query.sort) : 'newest';
  const category = (req.query && req.query.category) ? String(req.query.category) : null;
  const subcategory = (req.query && req.query.subcategory) ? String(req.query.subcategory) : null;
  const minPrice = (req.query && req.query.minPrice) ? Number(req.query.minPrice) : null;
  const maxPrice = (req.query && req.query.maxPrice) ? Number(req.query.maxPrice) : null;
  const page = Math.max(parseInt((req.query && req.query.page) ? req.query.page : '1', 10) || 1, 1);
  const limit = 9; // Always 9 (3x3 grid)
  return { q, sort, category, subcategory, minPrice, maxPrice, page, limit };
}

function buildSort(key) {
  switch (key) {
    case 'price_asc':
      return { _finalPrice: 1 };

    case 'price_desc':
      return { _finalPrice: -1 };

case 'a_z':
  return { productName: 1 };

case 'z_a':
  return { productName: -1 };


    default:
      return { createdAt: -1 };
  }
}


/* --------------------------- LIST PRODUCTS PAGE -------------------------- */

const listProducts = async (req, res) => {
  try {
    const { q, sort, category, subcategory, minPrice, maxPrice, page, limit } = parseQuery(req);

    // base filter (hide unlisted and deleted)
    const matchStage = { isListed: true, isDeleted: { $ne: true } };

    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(safe, 'i');
      matchStage.$or = [{ productName: re }, { description: re }];
    }

    if (category && mongoose.Types.ObjectId.isValid(category)) {
      matchStage.categoryId = new mongoose.Types.ObjectId(category);
    }
    if (subcategory && mongoose.Types.ObjectId.isValid(subcategory)) {
         matchStage.subcategoryId = new mongoose.Types.ObjectId(subcategory);
    }

   
// Build aggregate pipeline
const pipeline = [
  { $match: matchStage },
   { $sort: buildSort(sort) },
  
  // bring variants to compute min price and min discount price
  {
    $lookup: {
      from: 'varients', // collection name for Varient model
      let: { pid: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$productId', '$$pid'] },
                { $eq: ['$isListed', true] }
              ]
            }
          }
        },
        // keep price and discountPrice and stock
        { $project: { price: 1, discountPrice: 1, stock: 1 } }
      ],
      as: 'variants'
    }
  },
  {
    $lookup: {
      from: 'subcategories',            // collection name for SubCategory model
      localField: 'subcategoryId',
      foreignField: '_id',
      as: 'subcategory'
    }
  },
    {
    $addFields: {
      subcategoryName: {
        $cond: [
          { $gt: [{ $size: '$subcategory' }, 0] },
          { $arrayElemAt: ['$subcategory.fitName', 0] },
          null
        ]
      }
    }
  },

  // prepare fields:
  // - minVariantPrice: minimum of variants.price (null if no variants)
  // - minVariantDiscountPrice: minimum of variants.discountPrice but only considering defined & >0 values
  {
    $addFields: {
      minVariantPrice: {
        $cond: [
          { $gt: [{ $size: '$variants' }, 0] },
          { $min: '$variants.price' },
          null
        ]
      },
      // build an array of numeric discountPrice values > 0 (exclude null/undefined/0)
      _discountPrices: {
        $filter: {
          input: '$variants',
          as: 'v',
          cond: {
            $and: [
              { $ne: ['$$v.discountPrice', null] },
              { $ne: ['$$v.discountPrice', undefined] },
              { $gt: ['$$v.discountPrice', 0] }
            ]
          }
        }
      }
    }
  },

  // compute min of discount prices (if any)
 {
  $addFields: {
    minVariantDiscountPrice: {
      $cond: [
        { $gt: [{ $size: '$_discountPrices' }, 0] },
        { $min: '$_discountPrices.discountPrice' },
        null
      ]
    },

    // NEW FIELD: the real final price used for sorting & filtering
    _finalPrice: {
      $cond: [
        { $gt: [{ $size: '$variants' }, 0] },
        {
          $min: {
            $map: {
              input: '$variants',
              as: 'v',
              in: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$$v.discountPrice', null] },
                      { $gt: ['$$v.discountPrice', 0] }
                    ]
                  },
                  '$$v.discountPrice',
                  '$$v.price'
                ]
              }
            }
          }
        },
        0
      ]
    },

    // keep old _price (MRP), also needed for display
    _price: {
      $cond: [
        { $gt: [{ $size: '$variants' }, 0] },
        { $min: '$variants.price' },
        0
      ]
    }
  }
},



  // remove helper array
  { $project: { _discountPrices: 0 } }
];


    // Price range filters (apply after we computed minVariantPrice)
    if (minPrice != null || maxPrice != null) {
      const priceCond = {};
      if (minPrice != null) priceCond.$gte = minPrice;
      if (maxPrice != null) priceCond.$lte = maxPrice;
      pipeline.push({ $match: { minVariantPrice: priceCond } });
    }

    // Sorting + pagination
    // pipeline.push({ $sort: buildSort(sort) });
    pipeline.push({ $skip: (page - 1) * limit });
    pipeline.push({ $limit: limit });

    // Run pipeline to get page items
    // const products = await Product.aggregate(pipeline).allowDiskUse(true);
    const products = await Product
  .aggregate(pipeline)
  .collation({ locale: 'en', strength: 2 })
  .allowDiskUse(true);


    // Build a separate counting pipeline (exact same filters but count total)
    const countPipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'varients',
          let: { pid: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$productId', '$$pid'] }, { $eq: ['$isListed', true] }] } } },
            { $project: { price: 1 } }
          ],
          as: 'variants'
        }
      },
      {
        $addFields: {
          minVariantPrice: { $cond: [{ $gt: [{ $size: '$variants' }, 0] }, { $min: '$variants.price' }, null] }
        }
      }
    ];

    if (minPrice != null || maxPrice != null) {
      const priceCond = {};
      if (minPrice != null) priceCond.$gte = minPrice;
      if (maxPrice != null) priceCond.$lte = maxPrice;
      countPipeline.push({ $match: { minVariantPrice: priceCond } });
    }

    countPipeline.push({ $count: 'total' });

    const countResult = await Product.aggregate(countPipeline).allowDiskUse(true);
    const total = (Array.isArray(countResult) && countResult.length) ? countResult[0].total : 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const categories = await Category.find({}).sort({ name: 1 }).lean();
    const subcategories = await SubCategory.find({}).sort({ fitName: 1 }).lean();

    // render template (name 'allProducts' under views/user)
    return res.render('allProducts', {
      products,
      categories,
      subcategories,
      pagination: { q, sort, category, subcategory, minPrice, maxPrice, page, limit, total, totalPages }
    });

  } catch (err) {
    console.error('[USER] listProducts error:', err && err.stack ? err.stack : err);
    return res.status(500).render('error-page', { message: 'Failed loading products' });
  }
};


/* --------------------------- PRODUCT DETAILS ----------------------------- */
const productDetails = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).render("error-page", { message: "Invalid product ID" });
    }

    const product = await Product.findOne({
      _id: id,
      isListed: true,
      isDeleted: { $ne: true }
    }).lean();

    if (!product) {
      return res.status(404).render("error-page", { message: "Product not found" });
    }

    const variants = await Varient.find({
      productId: product._id,
      isListed: true
    }).lean();

    const category = await Category.findById(product.categoryId).lean();
    const subcategory = product.subcategoryId ? await SubCategory.findById(product.subcategoryId).lean() : null;

    // Group variants by size
    const sizeVariants = variants.map(v => ({
      size: v.size,
      price: v.price,
      discountPrice: (typeof v.discountPrice !== 'undefined' && v.discountPrice !== null) ? v.discountPrice : null,
      color: v.color,
      stock: v.stock,
      _id: v._id
    }));

    // Recommended products (same category)
    const recommendations = await Product.find({
      categoryId: product.categoryId,
      isListed: true,
      isDeleted: { $ne: true },
      _id: { $ne: product._id }
    })
      .limit(4)
      .lean();

    return res.render("productDetails", {
      product,
      variants,
      sizeVariants,
      category,
      subcategory,
      recommendations
    });

  } catch (err) {
    console.error("Product Details Error:", err);
    return res.status(500).render("error-page", { message: "Something went wrong" });
  }
};

module.exports = {
  listProducts,
  productDetails
};
