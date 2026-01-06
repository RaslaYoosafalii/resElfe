import express from 'express';
const router = express.Router()
import adminController from '../controllers/admin/adminController.js'
import customerController from '../controllers/admin/customerController.js'
import categoryController from '../controllers/admin/categoryController.js';
import productController from '../controllers/admin/productController.js';
import {adminAuth, noCache} from '../middlewares/auth.js'

router.get('/errorPage', adminController.errorPage);


router.get('/login', adminController.loadLogin);
router.post('/login', adminController.login);
router.get('/', noCache, adminAuth, adminController.loadDashboard);
router.get('/logout', adminController.logout)

//customer management
router.get('/customer', noCache, adminAuth, customerController.customerInfo);
router.post('/customer/toggle/:id', adminAuth, customerController.toggleBlockUser);
router.post('/customer/delete/:id', adminAuth, customerController.deleteCustomer)

//category management
router.get('/category',noCache, adminAuth, categoryController.listCategories)
router.post('/category/create', adminAuth, categoryController.createCategory);
router.post('/category/subcreate', adminAuth, categoryController.createSubCategory)
router.post('/category/toggle/:id', adminAuth, categoryController.toggleCategoryList)
router.post('/category/offer/:id', adminAuth, categoryController.setCategoryOffer)
router.get('/category/data/:id', adminAuth, categoryController.getCategoryData);        
router.post('/category/edit/:id', adminAuth, categoryController.editCategory);         
router.post('/category/subedit/:id', adminAuth, categoryController.editSubCategory); 
router.post('/category/delete/:id', adminAuth, categoryController.deleteCategory);
router.post('/category/subdelete/:id', adminAuth, categoryController.deleteSubCategory);
router.get('/category/subdata/:id', adminAuth, categoryController.getSubCategoryData);


// Product management
router.get('/product',noCache, adminAuth, productController.listProducts);         
router.get('/product/add', adminAuth, productController.loadAddProduct);    
router.post('/product/add', adminAuth, productController.addProduct);    
router.get('/product/edit/:id', adminAuth, productController.loadEditProduct);
router.post('/product/edit/:id', adminAuth, productController.updateProduct);
router.post('/product/delete/:id', adminAuth, productController.deleteProduct); 


export default router;