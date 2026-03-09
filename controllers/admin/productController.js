
// controllers/admin/productController.js
import { Product, Variant } from '../../models/productSchema.js';
import { Category, SubCategory } from '../../models/categorySchema.js';
import mongoose from 'mongoose';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { upload, UPLOAD_DIR } from '../../config/upload.js';
import { fileURLToPath } from 'url';
import logger from '../../config/logger.js';
import { uploadToS3 } from '../../utils/s3Upload.js';
import STATUS_CODES from '../../utils/statusCodes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const listProducts = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = 10;
    if (limit < 1) limit = 10;

    const search = req.query.search ? req.query.search.trim() : '';
    const skip = (page - 1) * limit;


    // Build search filter
    let findFilter = { isDeleted: { $ne: true } };

    // Count total before pagination
    const totalProducts = await Product.countDocuments(findFilter);
    const totalPages = Math.ceil(totalProducts / limit);

    // Fetch paginated products
    const products = await Product.find(findFilter)
      .populate('categoryId')
      .populate('subcategoryId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    let filteredProducts = products;

    if (search) {
      const regex = new RegExp(search, 'i');

      filteredProducts = products.filter(p =>
        regex.test(p.productName) ||
        regex.test(p.categoryId?.name || '') ||
        regex.test(p.subcategoryId?.fitName || '')
      );
    }

    //total stock
    const variants = await Variant.find({
      productId: { $in: products.map(p => p._id) }
    }).lean();

    const stockMap = {};
    variants.forEach(v => {
      const pid = v.productId.toString();
      if (!stockMap[pid]) stockMap[pid] = 0;
      stockMap[pid] += v.stock;
    });

    products.forEach(p => {
      p.totalStock = stockMap[p._id.toString()] || 0;
    });
    
    return res.render('products-list', {
      allowRender: true,
      products: filteredProducts,
      page,
      totalPages,
      limit,
      search,  
      message: null
    });

  } catch (err) {
    console.error('listProducts error:', err);
    logger.error(`listProducts error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to load products' });
  }
};


const loadAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({isDeleted: { $ne: true },isListed: true}).lean();
    // optionally fetch subcategories list too
    const subcategories = await SubCategory.find().lean();
    return res.render('product-add', {
      allowRender: true, 
      categories,
      subcategories,
      message: null,
      categoryId: null,
      subcategoryId: null,
      variantsData: []
    });
  } catch (err) {
    console.error('loadAddProduct error:', err);
    logger.error(`loadAddProduct error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to load add product page' });
  }
};


const addProduct = [
  // multer middleware: accept up to 10 images (we require >=3)
  (req, res, next) => {
    upload.array('productImages', 10)(req, res, async function(err) {
      if (err) {

        const categories = await Category.find({ 
          isDeleted: { $ne: true }, 
          isListed: true 
        }).lean();

        const subcategories = await SubCategory.find().lean();

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true,
          categories,
          subcategories,
          message: err.message,
          categoryId: req.body?.categoryId || null,
          subcategoryId: req.body?.subcategoryId || null,
          variantsData: req.body?.variants ? JSON.parse(req.body.variants) : [],
          productName: req.body?.productName || '',
          description: req.body?.description || ''
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const {
        productName,
        description,
        categoryId,
        subcategoryId,
        variants // variants expected as JSON string
      } = req.body;
      // parse variants
      let variantList = [];

      // Basic server-side validation
      if (!productName || !description || !categoryId || !subcategoryId) {
        // cleanup uploaded files
        (req.files || []).forEach(f => fs.unlinkSync(f.path));

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true, 
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Missing required fields' ,
          categoryId,
          subcategoryId,
          variantsData: variantList || [],
          productName,
          description
        });
      }

      if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true, 
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid category/subcategory',
          categoryId,
          subcategoryId,
          variantsData: variantList || [],
          productName,
          description
        });
      }

      const subCategoryDoc = await SubCategory.findOne({ _id: subcategoryId, Category: categoryId });

      if (!subCategoryDoc) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true,
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Selected subcategory does not belong to selected category',
          categoryId,
          subcategoryId,
          variantsData: variantList || [],
          productName,
          description
        });

      }
 
      try {
        variantList = variants ? JSON.parse(variants) : [];

      } catch (e) {
        console.log(e);
        logger.error(`AddProduct error: ${e.message}`);
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true,
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid variants data' ,
          categoryId,
          subcategoryId,
          variantsData: variantList,
          productName,
          description
        });
      }

      // validate variants: at least one variant, stock non-negative, price positive
      if (!Array.isArray(variantList) || variantList.length === 0) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true,
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Please add at least one variant',
          categoryId,
          subcategoryId,
          variantsData: variantList,
          productName,
          description
        });
      }


      const seenSizes = new Set();

      for (const v of variantList) {

        const size = (v.size || '').trim();
        const color = (v.color || '').trim();
        const price = Number(v.price);
        const discountPrice = (v.discountPrice !== null && v.discountPrice !== '' && typeof v.discountPrice !== 'undefined')
          ? Number(v.discountPrice)
          : null;
        const stock = Number(v.stock);



        if (!size) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
            allowRender: true,
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant size is required',
            categoryId,
            subcategoryId,
            variantsData: variantList,
            productName,
            description     
          });
        }


        if (!/^[A-Za-z]+$/.test(size) && !/^[0-9]+$/.test(size)) {
          (req.files || []).forEach(f => safeUnlink(f.path));
          return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
            allowRender: true,
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Size must contain only letters or only numbers (no symbols allowed)',
            categoryId,
            subcategoryId,
            variantsData: variantList,
            productName,
            description
          });
        }

        //if size is not xs s like that
        if (/^\d+$/.test(size)) {
          const numericSize = Number(size);
          if (
            !Number.isInteger(numericSize) ||
    numericSize <= 0 ||
    numericSize < 2 ||
    numericSize > 24 ||
    numericSize % 2 !== 0
          )  {
            (req.files || []).forEach(f => safeUnlink(f.path));
            return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
              allowRender: true,
              categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Numeric size must be an even number between 2 and 24',
              categoryId,
              subcategoryId,
              variantsData: variantList,
              productName,
              description 
            });
          }
        }

        const sizeKey = size.toLowerCase();
        if (seenSizes.has(sizeKey)) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
            allowRender: true,
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Duplicate variant size not allowed',
            categoryId,
            subcategoryId,
            variantsData: variantList,
            productName,
            description 
          });
        }
        seenSizes.add(sizeKey);

        if (!/^[A-Za-z]{2,}$/.test(color)) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
            allowRender: true,
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant color must contain only letters and be at least 2 characters',
            categoryId,
            subcategoryId,
            variantsData: variantList,
            productName,
            description 
          });
        }

        if (isNaN(price) || price <= 0) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
            allowRender: true,
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant price must be greater than 0',
            categoryId,
            subcategoryId,
            variantsData: variantList,
            productName,
            description 
          });
        }

        if (isNaN(stock) || stock < 0) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
            allowRender: true,
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant stock cannot be negative',
            categoryId,
            subcategoryId,
            variantsData: variantList,
            productName,
            description 
          });
        }

        if (discountPrice !== null) {
          if (isNaN(discountPrice) || discountPrice < 0) {
            (req.files || []).forEach(f => fs.unlinkSync(f.path));
            return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
              allowRender: true,
              categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Discount must be a valid positive number',
              categoryId,
              subcategoryId,
              variantsData: variantList,
              productName,
              description 
            });
          }

          if (discountPrice >= price) {
            (req.files || []).forEach(f => fs.unlinkSync(f.path));
            return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
              allowRender: true,
              categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Discount must be less than price',
              categoryId,
              subcategoryId,
              variantsData: variantList,
              productName,
              description 
            });
          }
        }

        v.size = size;
        v.color = color;
        v.price = price;
        v.discountPrice = discountPrice;
        v.stock = stock;
      }

      // images validation: at least 3 images
      const files = req.files || [];
      if (files.length < 3) {
        files.forEach(f => fs.unlinkSync(f.path));
        return res.status(STATUS_CODES.BAD_REQUEST).render('product-add', {
          allowRender: true, 
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'At least 3 images are required',
          categoryId,
          subcategoryId,
          variantsData: variantList,
          productName,
          description 
        });
      }

      // Process images with sharp (resize & create thumbnail)
      const savedFilenames = [];

      for (const file of files) {
        const inPath = file.path;
        const outName = `prod-${Date.now()}-${path.basename(file.filename)}`;
        const outPath = path.join(UPLOAD_DIR, outName);
      
        await sharp(inPath)
          .resize(1200, 1200, { fit: 'inside' })
          .toFile(outPath);
      
        const imageUrl = await uploadToS3(outPath, outName);
      
        try { fs.unlinkSync(inPath); } catch (e) {console.log(e);}
        try { fs.unlinkSync(outPath); } catch (e) {console.log(e);}
      
        savedFilenames.push(imageUrl);
      }

      // create product document
      const newProduct = new Product({
        productName,
        description,
        categoryId,
        subcategoryId,
        images: savedFilenames,
        isListed: true,
        // other product fields can be set here
      });

      await newProduct.save();


   
      const variantDocs = variantList.map(v => ({
        productId: newProduct._id,
        size: v.size,
        color: v.color || '',
        images: v.images || [], // optional per-variant images
        price: v.price,
        discountPrice: (typeof v.discountPrice !== 'undefined') ? v.discountPrice : null,
        stock: v.stock,
        isListed: true
      }));
      await Variant.insertMany(variantDocs);

      console.log('addProduct: created', newProduct._id);
      return res.redirect('/admin/product?created=1');
    } catch (err) {

      console.error('addProduct error:', err);
      logger.error(`addProduct error: ${err.message}`);
      (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch(e){ console.log(e); } });
      return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to create product' });
    }
  }
];
// helper to remove a file safely
function safeUnlink(p) {
  if (!p) return;

  if (p.startsWith('http')) return; // skip S3 images

  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.warn('unlink failed', p, e);
  }
}




const loadEditProduct = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/admin/product');

    const product = await Product.findById(id).lean();
    if (!product) return res.redirect('/admin/product');

    // fetch variants for this product
    const variants = await Variant.find({ productId: product._id }).lean();

    // categories and subcategories
    const categories = await Category.find({isDeleted: { $ne: true }, isListed: true}).lean();
    const subcategories = await SubCategory.find().lean();

    return res.render('product-edit', {
      allowRender: true,
      product,
      variants,
      categories,
      subcategories,
      message: null
    });
  } catch (err) {
    console.error(' loadEditProduct error:', err);
    logger.error(`loadEditProduct error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to load edit page' });
  }
};



const updateProduct = [
  (req, res, next) => {
    upload.array('productImages', 10)(req, res, async function(err) {
      if (err) {
        const id = req.params.id;

        const product = await Product.findById(id);
        const variants = await Variant.find({ productId: id }).lean();
        const categories = await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean();
        const subcategories =  await SubCategory.find().lean();

      

        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants,
          categories,
          subcategories,
          message: err.message
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(STATUS_CODES.BAD_REQUEST).render('error-page', { message: 'Invalid product id' });
      }

      const product = await Product.findById(id);
      if (!product) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(STATUS_CODES.NOT_FOUND).render('error-page', { message: 'Product not found' });
      }

      const {
        productName,
        description,
        categoryId,
        subcategoryId,
        variants,          
        existingImagesKeep   // optional list of filenames to keep (sent from form as JSON or hidden fields)
      } = req.body;

      // validate required fields
      if (!productName || !description || !categoryId || !subcategoryId) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Missing required fields'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid category/subcategory'
        });
      }

      const subCategoryDoc = await SubCategory.findOne({ _id: subcategoryId, Category: categoryId });

      if (!subCategoryDoc) {
        (req.files || []).forEach(f => safeUnlink(f.path));

        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Selected subcategory does not belong to selected category'
        });
      }
      // parse variants array
      let variantList = [];
      try {
        variantList = variants ? JSON.parse(variants) : [];
      } catch (e) {
        console.log(e);
        (req.files || []).forEach(f => safeUnlink(f.path));

        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid variants data'
        });
      }

      // Validate variant values and build actions
      const toDeleteVariantIds = [];
      const toUpdateVariants = [];
      const toInsertVariants = [];

      const seenSizes = new Set();

      for (const v of variantList) {

        // skip deleted variants first
        if (v._delete && v._id) {
          toDeleteVariantIds.push(v._id);
          continue;
        }

        const size = (v.size || '').trim();
        const color = (v.color || '').trim();
        const price = Number(v.price);
        const discountPrice =
    (v.discountPrice !== null &&
     v.discountPrice !== '' &&
     typeof v.discountPrice !== 'undefined')
      ? Number(v.discountPrice)
      : null;
        const stock = Number(v.stock);

        // size required
        if (!size) {
          (req.files || []).forEach(f => safeUnlink(f.path));
          const productObj = product.toObject();
          productObj.productName = productName;
          productObj.description = description;
          productObj.categoryId = String(categoryId);
          productObj.subcategoryId = String(subcategoryId);

          return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
            allowRender: true,
            product: productObj,
            variants: await Variant.find({ productId: id }).lean(),
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant size is required'
          });
        }
        //no symbols allowed
        if (!/^[A-Za-z]+$/.test(size) && !/^[0-9]+$/.test(size)) {

          (req.files || []).forEach(f => safeUnlink(f.path));

          const productObj = product.toObject();
          productObj.productName = productName;
          productObj.description = description;
          productObj.categoryId = String(categoryId);
          productObj.subcategoryId = String(subcategoryId);

          return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
            allowRender: true,
            product: productObj,
            variants: await Variant.find({ productId: id }).lean(),
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Size must contain only letters or only numbers (no symbols allowed)'
          });
        }
        //if size is not xs s like that
        if (/^\d+$/.test(size)) {
          const numericSize = Number(size);
          if (
            !Number.isInteger(numericSize) ||
    numericSize <= 0 ||
    numericSize < 2 ||
    numericSize > 24 ||
    numericSize % 2 !== 0
          ) {
            (req.files || []).forEach(f => safeUnlink(f.path));

            const productObj = product.toObject();
            productObj.productName = productName;
            productObj.description = description;
            productObj.categoryId = String(categoryId);
            productObj.subcategoryId = String(subcategoryId);

            return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
              allowRender: true,
              product: productObj,
              variants: await Variant.find({ productId: id }).lean(),
              categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Numeric size must be a positive even number between 2 and 24'
            });
          }
        }

        // duplicate size check (case-insensitive)
        const sizeKey = size.toLowerCase();
        if (seenSizes.has(sizeKey)) {
          (req.files || []).forEach(f => safeUnlink(f.path));

          const productObj = product.toObject();
          productObj.productName = productName;
          productObj.description = description;
          productObj.categoryId = String(categoryId);
          productObj.subcategoryId = String(subcategoryId);

          return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
            allowRender: true,
            product: productObj,
            variants: await Variant.find({ productId: id }).lean(),
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Duplicate variant size not allowed'
          });
        }
        seenSizes.add(sizeKey);

        // strict color validation
        if (!/^[A-Za-z]{2,}$/.test(color)) {
          (req.files || []).forEach(f => safeUnlink(f.path));

          const productObj = product.toObject();
          productObj.productName = productName;
          productObj.description = description;
          productObj.categoryId = String(categoryId);
          productObj.subcategoryId = String(subcategoryId);

          return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
            allowRender: true,
            product: productObj,
            variants: await Variant.find({ productId: id }).lean(),
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant color must contain only letters and be at least 2 characters'
          });
        }

        // price validation
        if (isNaN(price) || price <= 0) {
          (req.files || []).forEach(f => safeUnlink(f.path));

          const productObj = product.toObject();
          productObj.productName = productName;
          productObj.description = description;
          productObj.categoryId = String(categoryId);
          productObj.subcategoryId = String(subcategoryId);

          return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
            allowRender: true,
            product: productObj,
            variants: await Variant.find({ productId: id }).lean(),
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant price must be greater than 0'
          });
        }

        // stock validation
        if (isNaN(stock) || stock < 0) {
          (req.files || []).forEach(f => safeUnlink(f.path));

          const productObj = product.toObject();
          productObj.productName = productName;
          productObj.description = description;
          productObj.categoryId = String(categoryId);
          productObj.subcategoryId = String(subcategoryId);

          return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
            allowRender: true,
            product: productObj,
            variants: await Variant.find({ productId: id }).lean(),
            categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
            subcategories: await SubCategory.find().lean(),
            message: 'Variant stock cannot be negative'
          });
        }

        // discount validation
        if (discountPrice !== null) {
          if (isNaN(discountPrice) || discountPrice < 0) {
            (req.files || []).forEach(f => safeUnlink(f.path));

            const productObj = product.toObject();
            productObj.productName = productName;
            productObj.description = description;
            productObj.categoryId = String(categoryId);
            productObj.subcategoryId = String(subcategoryId);

            return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
              allowRender: true,
              product: productObj,
              variants: await Variant.find({ productId: id }).lean(),
              categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Discount must be a valid positive number'
            });
          }

          if (discountPrice >= price) {
            (req.files || []).forEach(f => safeUnlink(f.path));

            const productObj = product.toObject();
            productObj.productName = productName;
            productObj.description = description;
            productObj.categoryId = String(categoryId);
            productObj.subcategoryId = String(subcategoryId);


            return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
              allowRender: true,
              product: productObj,
              variants: await Variant.find({ productId: id }).lean(),
              categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Discount must be less than price'
            });
          }
        }

        // categorize into update or insert
        if (v._id) {
          toUpdateVariants.push({
            _id: v._id,
            size,
            color,
            price,
            discountPrice,
            stock
          });
        } else {
          toInsertVariants.push({
            size,
            color,
            price,
            discountPrice,
            stock
          });
        }
      }

      // at least one variant msut remain 
      const existingCount = await Variant.countDocuments({ productId: id });

      const remainingCount =
  existingCount - toDeleteVariantIds.length + toInsertVariants.length;

      if (remainingCount <= 0) {

        (req.files || []).forEach(f => safeUnlink(f.path));

        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'At least one variant must remain'
        });
      }
      // handle images
      let keep = [];

      if (existingImagesKeep) {
        try {
          if (Array.isArray(existingImagesKeep)) {
            keep = existingImagesKeep;
          } else if (typeof existingImagesKeep === 'string') {
            keep = existingImagesKeep.trim().startsWith('[')
              ? JSON.parse(existingImagesKeep)
              : existingImagesKeep.split(',').filter(Boolean);
          }
        } catch (e) {
          console.log(e);
          keep = [];
        }
      } else {
        // If nothing sent, assume all current images are kept
        keep = Array.isArray(product.images) ? product.images.slice() : [];
      }

      // current images from DB
      const currentImages = Array.isArray(product.images) ? product.images.slice() : [];

      // process uploaded new images (if any)
      const newFiles = req.files || [];
      const savedNewFilenames = [];

      for (const file of newFiles) {
        const inPath = file.path;
        const outName = `prod-${Date.now()}-${Math.random().toString(36).substring(2)}-${path.basename(file.filename)}`;
        const outPath = path.join(UPLOAD_DIR, outName);
      
        await sharp(inPath)
          .resize(1200, 1200, { fit: 'inside' })
          .toFile(outPath);
      
        const imageUrl = await uploadToS3(outPath, outName);

        try { fs.unlinkSync(inPath); } catch (e) {logger.error(`updateProduct error: ${e.message}`);}
        try { fs.unlinkSync(outPath); } catch (e) {logger.error(`updateProduct error: ${e.message}`);}

        savedNewFilenames.push(imageUrl);
      }

      // compose final images FIRST (without deleting anything yet)
      const finalImages = [...keep, ...savedNewFilenames];

      // STRICT VALIDATION FIRST
      if (finalImages.length < 3) {

        // remove only newly uploaded processed images
        // savedNewFilenames.forEach(fn => {
        //   safeUnlink(path.join(UPLOAD_DIR, fn));
        // });
        const productObj = product.toObject();
        productObj.productName = productName;
        productObj.description = description;
        productObj.categoryId = String(categoryId);
        productObj.subcategoryId = String(subcategoryId);

        return res.status(STATUS_CODES.BAD_REQUEST).render('product-edit', {
          allowRender: true,
          product: productObj,
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find({ isDeleted: { $ne: true }, isListed: true }).lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'At least 3 images must remain for the product'
        });
      }

      // NOW delete removed old images safely
      const toRemove = currentImages.filter(fn => !keep.includes(fn));
      for (const fn of toRemove) {
        safeUnlink(fn);
      }

      // All validation passed; update product
      product.productName = productName;
      product.description = description;
      product.categoryId = categoryId;
      product.subcategoryId = subcategoryId;
      product.images = finalImages;
      await product.save();

      // Apply variant deletions, updates, inserts
      if (toDeleteVariantIds.length) {
        await Variant.deleteMany({ _id: { $in: toDeleteVariantIds }, productId: product._id });
      }
      for (const uv of toUpdateVariants) {
        await Variant.findByIdAndUpdate(uv._id, { size: uv.size, color: uv.color, price: uv.price, discountPrice: (typeof uv.discountPrice !== 'undefined') ? uv.discountPrice : null, stock: uv.stock });

      }
      if (toInsertVariants.length) {
        const docs = toInsertVariants.map(v => ({ productId: product._id, size: v.size, color: v.color, price: v.price, discountPrice: (typeof v.discountPrice !== 'undefined') ? v.discountPrice : null, stock: v.stock, images: [], isListed: true }));
        await Variant.insertMany(docs);
      }

      console.log('updateProduct:', id);
      return res.redirect('/admin/product?updated=1');
    } catch (err) {
      console.error('updateProduct error:', err);
      logger.error(`updateProduct error: ${err.message}`);
      (req.files || []).forEach(f => safeUnlink(f.path));
      return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to update product' });
    }
  }
];


// const HARD_DELETE_REMOVE_FILES = true; 

const deleteProduct = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid id' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(STATUS_CODES.NOT_FOUND).json({ success: false, message: 'Product not found' });
    }


    //soft delete
    product.isDeleted = true;
    product.isListed = false; 
    await product.save();

    // unlist variants
    await Variant.updateMany(
      { productId: id },
      { $set: { isListed: false } }
    );



    console.log('delete Product:', id);

    return res.json({ success: true, message: 'Product deleted' });

  } catch (err) {
    console.error('deleteProduct error:', err);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};


const restoreProduct = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid id' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(STATUS_CODES.NOT_FOUND).json({ success: false, message: 'Product not found' });
    }

    if (!product.isDeleted) {
      return res.json({ success: true, message: 'Product already active' });
    }

    //restore product
    product.isDeleted = false;
    product.isListed = true;
    await product.save();

    //restore variant
    await Variant.updateMany(
      { productId: id },
      { $set: { isListed: true } }
    );

    console.log('restoreProduct:', id);

    return res.json({
      success: true,
      message: 'Product restored successfully'
    });

    
  } catch (err) {
    console.error('restoreProduct error:', err);
    logger.error(`restoreProduct error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Server error'
    });
  }
};

const listDeletedProducts = async (req, res) => {
  try {
    const products = await Product.find({ isDeleted: true })
      .populate('categoryId')
      .populate('subcategoryId')
      .sort({ updatedAt: -1 })
      .lean();

    return res.render('products-deleted', {
      allowRender: true,
      products
    });
  } catch (err) {
    console.error('listDeletedProducts error:', err);
    logger.error(`listDeletedProducts error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', {
      message: 'Failed to load deleted products'
    });
  }
};



export {
  listProducts,
  loadAddProduct,
  addProduct,
  deleteProduct,
  updateProduct,
  loadEditProduct,
  restoreProduct,
  listDeletedProducts
};

export default{
  listProducts,
  loadAddProduct,
  addProduct,
  deleteProduct,
  updateProduct,
  loadEditProduct,
  restoreProduct,
  listDeletedProducts
};