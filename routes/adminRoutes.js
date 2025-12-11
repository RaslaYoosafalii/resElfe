const express = require('express');
const router = express.Router()
const adminController = require('../controllers/admin/adminController')
const customerController = require('../controllers/admin/customerController')
const categoryController = require('../controllers/admin/categoryController');

const {adminAuth} = require('../middlewares/auth')


router.get('/errorPage', adminController.errorPage);

router.get('/login', adminController.loadLogin);
router.post('/login', adminController.login);
router.get('/', adminAuth, adminController.loadDashboard);
router.get('/logout', adminController.logout)

//customer management
router.get('/customer', adminAuth, customerController.customerInfo)
router.post('/customer/toggle/:id', adminAuth, customerController.toggleBlockUser);

//category management
router.get('/category', adminAuth, categoryController.listCategories)
router.post('/category/create', adminAuth, categoryController.createCategory);
router.post('/category/subcreate', adminAuth, categoryController.createSubCategory)
router.post('/category/toggle/:id', adminAuth, categoryController.toggleCategoryList)
router.post('/category/offer/:id', adminAuth, categoryController.setCategoryOffer)


module.exports = router;