const express = require('express');
const router = express.Router()
const adminController = require('../controllers/admin/adminController')
const customerController = require('../controllers/admin/customerController')
const categoryController = require('../controllers/admin/categoryController');
const productController = require('../controllers/admin/productController');
const {adminAuth} = require('../middlewares/auth')


router.get('/errorPage', adminController.errorPage);

router.get('/login', adminController.loadLogin);
router.post('/login', adminController.login);
router.get('/', adminAuth, adminController.loadDashboard);
router.get('/logout', adminController.logout)

//customer management
router.get('/customer', adminAuth, customerController.customerInfo);
router.post('/customer/toggle/:id', adminAuth, customerController.toggleBlockUser);

//category management
router.get('/category', adminAuth, categoryController.listCategories)
router.post('/category/create', adminAuth, categoryController.createCategory);
router.post('/category/subcreate', adminAuth, categoryController.createSubCategory)
router.post('/category/toggle/:id', adminAuth, categoryController.toggleCategoryList)
router.post('/category/offer/:id', adminAuth, categoryController.setCategoryOffer)
router.get('/category/data/:id', adminAuth, categoryController.getCategoryData);         // returns JSON for modal prefill
router.post('/category/edit/:id', adminAuth, categoryController.editCategory);         // update category (form post)
router.post('/category/subedit/:id', adminAuth, categoryController.editSubCategory); 
router.post('/category/delete/:id', adminAuth, categoryController.deleteCategory);
router.post('/category/subdelete/:id', adminAuth, categoryController.deleteSubCategory);
router.get('/category/subdata/:id', adminAuth, categoryController.getSubCategoryData);


// Product management
router.get('/product', adminAuth, productController.listProducts);           // view products
router.get('/product/add', adminAuth, productController.loadAddProduct);    // load add-product form
router.post('/product/add', adminAuth, productController.addProduct);       // add product
router.get('/product/edit/:id', adminAuth, productController.loadEditProduct);
router.post('/product/edit/:id', adminAuth, productController.updateProduct); // handles multipart
router.post('/product/delete/:id', adminAuth, productController.deleteProduct); 


module.exports = router;