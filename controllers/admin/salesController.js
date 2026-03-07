import Order from '../../models/orderSchema.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Product } from '../../models/productSchema.js';
import { Category, SubCategory } from '../../models/categorySchema.js';
import logger from '../../config/logger.js';
const allowedFilters = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];

const round = (val) => Number(Number(val || 0).toFixed(2));

function getDateRange(query) {

  const { filter, from, to } = query;

  if (!filter) {
    return { startDate: null, endDate: null, filter: null };
  }

  if (!allowedFilters.includes(filter)) {
    throw new Error('Invalid filter selected');
  }

  const now = new Date();
  let startDate, endDate;

  if (filter === 'daily') {
    startDate = new Date(now.setHours(0,0,0,0));
    endDate = new Date();
  }

  if (filter === 'weekly') {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0,0,0,0);

    endDate = new Date();
    endDate.setHours(23,59,59,999);
  }

  if (filter === 'monthly') {
    startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);
    endDate = new Date();
  }

  if (filter === 'yearly') {
    startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    endDate = new Date();
  }

  if (filter === 'custom') {

    if (!from || !to) {
      throw new Error('Start date and End date are required for custom range');
    }

    startDate = new Date(from);
    endDate = new Date(to);

    if (isNaN(startDate) || isNaN(endDate)) {
      throw new Error('Invalid date format');
    }

    if (startDate > endDate) {
      throw new Error('Start date cannot be greater than End date');
    }

    endDate.setHours(23,59,59,999);
  }

  return { startDate, endDate, filter };
}

function calculateSummary(orders) {

  if (!Array.isArray(orders)) {
    throw new Error('Invalid orders data');
  }

  let totalSales = 0;
  let totalOrderItemsSold = 0;
  let totalCouponDiscount = 0;
  let totalMrpDiscount = 0;

  orders.forEach(order => {

    if (!order || !Array.isArray(order.orderedItem)) {
      throw new Error('Corrupted order data detected');
    }

    totalSales += Number(order.finalPrice || 0);
    totalCouponDiscount += Number(order.discount || 0);

    order.orderedItem.forEach(item => {

      if (!item || typeof item.quantity !== 'number') {
        throw new Error('Invalid order item data');
      }

      //eclude cancelled /returned/ failed items
      if (['cancelled', 'returned',  'failed'].includes(item.orderStatus)) {
        return;
      }

      totalOrderItemsSold += item.quantity;

      const unitMrp = typeof item.basePrice === 'number'
        ? item.basePrice
        : (item.price || 0);

      const mrp = unitMrp * item.quantity;


      const discountedTotal = Number(item.offerPrice || 0);

      const discountValue = mrp - discountedTotal;

      if (!isNaN(discountValue) && discountValue > 0) {
        totalMrpDiscount += discountValue;
      }


    });

  });

  return {
    totalOrders: orders.length,
    totalSales: round(totalSales),
    totalOrderItemsSold,
    totalCouponDiscount: round(totalCouponDiscount),
    totalMrpDiscount: round(totalMrpDiscount)
  };
}


const loadSalesReport = async (req, res) => {

  try {

    const { startDate, endDate, filter } = getDateRange(req.query);
   
    let page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    const limit = 5;

    

    let query = {
      orderStatus: { $nin: ['failed', 'cancelled', 'returned'] },
    //   paymentStatus: "completed"
    };

    if (startDate && endDate) {
      query.orderDate = { $gte: startDate, $lte: endDate };
    }


    const totalOrdersCount = await Order.countDocuments(query);

    const totalPages = Math.ceil(totalOrdersCount / limit);

    if (page > totalPages && totalPages > 0) {
      page = totalPages;
    }

    const orders = await Order.find(query)
      .populate('userId', 'name')
      .sort({ orderDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // summary must be calculated from full data
    const allOrders = await Order.find(query).lean();
    const summary = calculateSummary(allOrders);

    res.render('sales-report', {
      allowRender: true,
      orders,
      summary,
      filter,
      from: req.query.from || '',
      to: req.query.to || '',
      applied: !!filter,
      error: null,
      page,
      totalPages
    });

  } catch (err) {
    logger.error(`loadSalesReport error: ${err.message}`);
    res.render('sales-report', {
      allowRender: true,
      orders: [],
      summary: {
        totalOrders: 0,
        totalSales: 0,
        totalOrderItemsSold: 0,
        totalCouponDiscount: 0,
        totalMrpDiscount: 0
      },
      filter: null,
      from: '',
      to: '',
      applied: false,
      error: err.message,
      page: 1,
      totalPages: 0
    });
  }
};

const downloadSalesReport = async (req, res) => {

  try {

    const { type } = req.query;

    if (!['pdf', 'excel'].includes(type)) {
      return res.status(400).send('Invalid download type');
    }

    const { startDate, endDate } = getDateRange(req.query);

    const orders = await Order.find({
      orderStatus: { $nin: ['failed', 'cancelled', 'returned'] },
      //   paymentStatus: "completed",
      orderDate: { $gte: startDate, $lte: endDate }
    }).populate('userId','name').lean();

    const summary = calculateSummary(orders);

    if (type === 'excel') {

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sales Report');

      sheet.properties.defaultRowHeight = 20;

      const formatDate = (d) =>
        new Date(d).toLocaleDateString('en-GB');

      const fromDate = req.query.from
        ? formatDate(req.query.from)
        : formatDate(startDate);

      const toDate = req.query.to
        ? formatDate(req.query.to)
        : formatDate(endDate);

      /* ================= HEADER ================= */

      sheet.mergeCells('A1:I1');
      sheet.getCell('A1').value = 'www.elfein.in';
      sheet.getCell('A1').alignment = { horizontal: 'center' };
      sheet.getCell('A1').font = { size: 12 };

      sheet.mergeCells('A2:I2');
      sheet.getCell('A2').value = 'Sales report';
      sheet.getCell('A2').alignment = { horizontal: 'center' };
      sheet.getCell('A2').font = { size: 20, bold: true };

      /* ================= SALES SUMMARY BOX ================= */

      const summaryStartRow = 4;

      sheet.getCell('H4').value = 'Sales summary';
      sheet.getCell('H4').font = { bold: true };

      const summaryRows = [
        ['Total orders', orders.length],
        ['Total sales', `Rs. ${summary.totalSales.toFixed(2)}`],
        ['Total coupon discount', `Rs. ${summary.totalCouponDiscount.toFixed(2)}`],
        ['Total discount on MRP', `Rs. ${summary.totalMrpDiscount.toFixed(2)}`],
      ];

      summaryRows.forEach((row, index) => {

        const r = summaryStartRow + 1 + index;

        sheet.getCell(`H${r}`).value = row[0];
        sheet.getCell(`I${r}`).value = row[1];

        sheet.getCell(`H${r}`).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' }
        };

        sheet.getCell(`I${r}`).border = {
          top: { style: 'thin' },
          right: { style: 'thin' },
          bottom: { style: 'thin' }
        };

        sheet.getCell(`I${r}`).alignment = { horizontal: 'right' };
      });

      /* ================= DATE RANGE ================= */

      sheet.getCell('A9').value = `From: ${fromDate}`;
      sheet.getCell('C9').value = `Upto: ${toDate}`;

      sheet.getCell('A9').font = { bold: true };
      sheet.getCell('C9').font = { bold: true };

      /* ================= TABLE ================= */

      const tableStartRow = 11;

      const headers = [
        'No',
        'Order id',
        'Customer',
        'Date',
        'Total MRP',
        'Discount on MRP',
        'Coupon discount',
        'Final amount',
        'Payment'
      ];

      headers.forEach((header, index) => {
        const cell = sheet.getCell(tableStartRow, index + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6E6E6' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      orders.forEach((order, index) => {

        let mrp = 0;
        let mrpDiscount = 0;

        order.orderedItem.forEach(item => {

          if (['cancelled', 'returned', 'failed'].includes(item.orderStatus)) {
            return;
          }

          const unitMrp = typeof item.basePrice === 'number'
            ? item.basePrice
            : (item.price || 0);

          const mrpTotal = unitMrp * item.quantity;

          const discountedPerUnit = item.quantity > 0
            ? item.offerPrice / item.quantity
            : 0;

          const discountedTotal = discountedPerUnit * item.quantity;

          mrp += mrpTotal;
          mrpDiscount += (mrpTotal - discountedTotal);

        });


        const rowIndex = tableStartRow + 1 + index;

        const rowData = [
          index + 1,
          order.orderId,
          order.userId?.name || 'N/A',
          formatDate(order.orderDate),
          round(mrp).toFixed(2),
          round(mrpDiscount).toFixed(2),
          round(order.discount || 0).toFixed(2),
          round(order.finalPrice).toFixed(2),
          order.paymentMethod.toUpperCase()
        ];

        rowData.forEach((data, colIndex) => {

          const cell = sheet.getCell(rowIndex, colIndex + 1);
          cell.value = data;

          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };

          if (colIndex >= 4 && colIndex <= 7) {
            cell.alignment = { horizontal: 'right' };
          }
        });
      });

      /* ================= COLUMN WIDTHS ================= */

      sheet.columns = [
        { width: 6 },
        { width: 30 },
        { width: 18 },
        { width: 14 },
        { width: 14 },
        { width: 18 },
        { width: 18 },
        { width: 16 },
        { width: 14 }
      ];

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename=sales-report.xlsx'
      );

      await workbook.xlsx.write(res);
      return res.end();
    }


    if (type === 'pdf') {

      const doc = new PDFDocument({ margin: 40 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=sales-report.pdf'
      );

      doc.pipe(res);

      const margin = 20;
      const pageWidth = doc.page.width;
      const usableWidth = pageWidth - margin * 2;
      const startX = margin;

      const formatDate = (d) =>
        new Date(d).toLocaleDateString('en-GB');

      const fromDate = req.query.from
        ? formatDate(req.query.from)
        : formatDate(startDate);

      const toDate = req.query.to
        ? formatDate(req.query.to)
        : formatDate(endDate);

      /* ================= HEADER ================= */

      doc
        .fontSize(10)
        .fillColor('#555')
        .text('www.elfein.in', margin, 50, { align: 'center' });

      doc
        .fontSize(28)
        .fillColor('#000')
        .text('Sales report', margin, 70, { align: 'center' });

      /* ================= SUMMARY BOX ================= */

      const summaryBoxWidth = 250;
      const summaryX = pageWidth - summaryBoxWidth - margin;
      const summaryTitleY = 130;
      const rowHeight = 24;

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Sales summary', summaryX, summaryTitleY);

      const boxStartY = summaryTitleY + 20;

      const summaryRows = [
        ['Total orders', orders.length],
        ['Total sales', `Rs. ${summary.totalSales}`],
        ['Total coupon discount', `Rs. ${summary.totalCouponDiscount}`],
        ['Total discount on MRP', `Rs. ${summary.totalMrpDiscount}`],
      ];

      summaryRows.forEach((row, i) => {

        const y = boxStartY + i * rowHeight;

        doc
          .rect(summaryX, y, summaryBoxWidth, rowHeight)
          .stroke();

        doc
          .font('Helvetica')
          .fontSize(8)
          .text(row[0], summaryX + 6, y + 7);

        doc
          .text(
            row[1],
            summaryX,
            y + 7,
            {
              width: summaryBoxWidth - 6,
              align: 'right'
            }
          );
      });

      /* ================= DATE RANGE ================= */

      const dateY = boxStartY + summaryRows.length * rowHeight ;

      doc
        .font('Helvetica')
        .fontSize(8)
        .text(`From: ${fromDate}`, startX, dateY);

      doc
        .text(`Upto: ${toDate}`, startX + 80, dateY);

      /* ================= TABLE ================= */

      const tableTop = dateY + 25;

      // Total printable width
      const totalTableWidth = usableWidth;

  
      const ratios = [
        5,   // No
        18,  // OrderId
        12,  // Customer
        12,  // Date
        12,  // MRP
        14,  // MRP Discount
        14,  // Coupon
        14,  // Final
        10    // Payment
      ];

      const ratioSum = ratios.reduce((a,b)=>a+b,0);

      const colWidths = ratios.map(r =>
        (r / ratioSum) * totalTableWidth
      );

      const headers = [
        'No',
        'Order id',
        'Customer',
        'Date',
        'Total MRP',
        'Discount on MRP',
        'Coupon discount',
        'Final amount',
        'Payment'
      ];

      let x = startX;

      // HEADER ROW
      headers.forEach((header, i) => {

        doc
          .rect(x, tableTop, colWidths[i], 24)
          .fillAndStroke('#e6e6e6', '#000');

        doc
          .fillColor('#000')
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(header, x + 3, tableTop + 8, {
            width: colWidths[i] - 6
          });

        x += colWidths[i];
      });

      let y = tableTop + 24;

      // DATA ROWS
      orders.forEach((order, index) => {

        let mrp = 0;
        let mrpDiscount = 0;

        order.orderedItem.forEach(item => {

          if (['cancelled', 'returned', 'failed'].includes(item.orderStatus)) {
            return;
          }

          const unitMrp = typeof item.basePrice === 'number'
            ? item.basePrice
            : (item.price || 0);

          const mrpTotal = unitMrp * item.quantity;


          const discountedPerUnit = item.quantity > 0
            ? item.offerPrice / item.quantity
            : 0;

          const discountedTotal = discountedPerUnit * item.quantity;

          mrp += mrpTotal;
          mrpDiscount += (mrpTotal - discountedTotal);

        });

        const row = [
          index + 1,
          order.orderId,
          order.userId?.name || 'N/A',
          formatDate(order.orderDate),
          `Rs.${round(mrp)}`,
          `${round(mrpDiscount)}`,
          `${round(order.discount || 0)}`,
          `Rs.${round(order.finalPrice)}`,
          order.paymentMethod.toUpperCase()
        ];

        x = startX;

        row.forEach((cell, i) => {

          doc
            .rect(x, y, colWidths[i], 22)
            .stroke();

          doc
            .font('Helvetica')
            .fontSize(6)
            .text(String(cell), x + 3, y + 7, {
              width: colWidths[i] - 6
            });

          x += colWidths[i];
        });

        y += 22;
      });

      doc.end();
    }



  } catch (err) {
    console.log(err);
    logger.error(`downloadSalesReport error: ${err.message}`);
    return res.status(400).send('Invalid request');
  }
};


const getDashboardData = async (req, res) => {
  try {

    if (!req.session.admin) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const { filter, from, to } = req.query;

    const allowedFilters = ['yearly', 'monthly', 'weekly', 'daily', 'custom'];

    if (!allowedFilters.includes(filter)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filter type'
      });
    }

    const now = new Date();
    let startDate;
    let endDate = new Date();

    if (filter === 'yearly') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    else if (filter === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    else if (filter === 'weekly') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0,0,0,0);

      endDate = new Date();
      endDate.setHours(23,59,59,999);
    }

    else if (filter === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    else if (filter === 'custom') {

      if (!from || !to) {
        return res.status(400).json({
          success: false,
          message: 'Start date and end date are required'
        });
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format'
        });
      }

      if (fromDate > toDate) {
        return res.status(400).json({
          success: false,
          message: 'Start date cannot be greater than end date'
        });
      }

      const today = new Date();
      today.setHours(23,59,59,999);

      if (fromDate > today || toDate > today) {
        return res.status(400).json({
          success: false,
          message: 'Future dates are not allowed'
        });
      }

      startDate = new Date(fromDate.setHours(0,0,0,0));
      endDate = new Date(toDate.setHours(23,59,59,999));
    }

    const orders = await Order.find({
      orderDate: { $gte: startDate, $lte: endDate },
      orderStatus: { $nin: ['failed', 'cancelled'] }
    })
      .populate('orderedItem.product')
      .lean();

    //summary calculation
    let totalSales = 0;
    let totalOrders = 0;

    if (!Array.isArray(orders)) {
      return res.status(500).json({
        success: false,
        message: 'Invalid orders data'
      });
    }

    for (const order of orders) {

      if (!order || typeof order.finalPrice !== 'number') {
        continue;
      }

      totalSales += order.finalPrice;
      totalOrders += 1;
    }

    totalSales = Number(totalSales.toFixed(2));

    let totalProductsSold = 0;

    for (const order of orders) {

      if (!Array.isArray(order.orderedItem)) continue;

      for (const item of order.orderedItem) {

        if (!item || typeof item.quantity !== 'number') continue;

        //excluding 
        if (['cancelled','returned','failed'].includes(item.orderStatus)) continue;

        totalProductsSold += item.quantity;
      }
    }

    //sales line graph
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date range'
      });
    }

    const salesMap = {};

    //Pre-fill all dates with 0
    let current = new Date(startDate);
    current.setHours(0,0,0,0);

    const lastDate = new Date(endDate);
    lastDate.setHours(0,0,0,0);

    while (current <= lastDate) {

      let label;

      if (filter === 'yearly') {
        label = current.toLocaleString('en-GB', { month: 'short' });
      }

      else if (filter === 'monthly') {
        label = current.getDate().toString();
      }

      else {
        label = current.toLocaleDateString('en-GB');
      }

      if (!salesMap[label]) {
        salesMap[label] = 0;
      }

      current.setDate(current.getDate() + 1);
    }

    //add order values
    for (const order of orders) {

      if (!order || !order.orderDate || typeof order.finalPrice !== 'number') {
        continue;
      }

      const dateObj = new Date(order.orderDate);
      dateObj.setHours(0,0,0,0);

      let label;

      if (filter === 'yearly') {
        label = dateObj.toLocaleString('en-GB', { month: 'short' });
      }

      else if (filter === 'monthly') {
        label = dateObj.getDate().toString();
      }

      else {
        label = dateObj.toLocaleDateString('en-GB');
      }

      if (salesMap[label] !== undefined) {
        salesMap[label] += order.finalPrice;
      }
    }

    // STEP 3: Convert to arrays (already in chronological order)
    const salesLabels = Object.keys(salesMap);
    const salesData = salesLabels.map(label =>
      Number(salesMap[label].toFixed(2))
    );
    // ================== AGGREGATION ==================

    const productMap = {};
    const categoryMap = {};
    const subCategoryMap = {};

    for (const order of orders) {
      if (!Array.isArray(order.orderedItem)) continue;

      for (const item of order.orderedItem) {

        if (!item || !item.product) continue;

        if (!item.product._id || !item.product.categoryId || !item.product.subcategoryId) {
          continue;
        }

        const productId = item.product._id.toString();
        const categoryId = item.product.categoryId.toString();
        const subCategoryId = item.product.subcategoryId.toString();

        if (!productId || !categoryId || !subCategoryId) {
          continue;
        }

        productMap[productId] = (productMap[productId] || 0) + item.quantity;

        categoryMap[categoryId] = (categoryMap[categoryId] || 0) + item.quantity;

        subCategoryMap[subCategoryId] = (subCategoryMap[subCategoryId] || 0) + item.quantity;
      }
    }
    // Convert to array + sort + top 10
    const topProducts = Object.entries(productMap)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10);

    const topCategories = Object.entries(categoryMap)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10);

    const topSubCategories = Object.entries(subCategoryMap)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10);

    // Fetch names
    const productDocs = await Product.find({
      _id: { $in: topProducts.map(p=>p[0]) }
    }).lean();

    // Fetch categories for both:
    // 1. topCategories
    // 2. categories belonging to topSubCategories

    const subCategoryDocs = await SubCategory.find({
      _id: { $in: topSubCategories.map(s => s[0]) }
    })
      .populate('Category')
      .lean();

    // Collect categoryIds from subcategories
    const subCategoryCategoryIds = subCategoryDocs
      .map(s => s.categoryId?.toString())
      .filter(Boolean);

    // Merge both category sources
    const allCategoryIds = [
      ...new Set([
        ...topCategories.map(c => c[0]),
        ...subCategoryCategoryIds
      ])
    ];

    const categoryDocs = await Category.find({
      _id: { $in: allCategoryIds }
    }).lean();

    const productNameMap = Object.fromEntries(productDocs.map(p=>[p._id.toString(), p.productName]));
    const categoryNameMap = Object.fromEntries(categoryDocs.map(c=>[c._id.toString(), c.name]));
    const subCategoryNameMap = Object.fromEntries(subCategoryDocs.filter(s => s && s._id)
      .map(s => [s._id.toString(),s.name || s.subCategoryName || s.fitName || null ]));


    return res.json({
      success: true,
      summary: {
        totalSales,
        totalOrders,
        totalProductsSold
      },
      products: topProducts.map(p=>({
        name: productNameMap[p[0]] || 'Unknown',
        count: p[1]
      })),
      categories: topCategories.map(c=>({
        name: categoryNameMap[c[0]] || 'Unknown',
        count: c[1]
      })),
      subcategories: topSubCategories.map(s => {

        const subDoc = subCategoryDocs.find(
          d => d._id.toString() === s[0]
        );

        if (!subDoc) {
          return {
            name: 'Unknown Fit',
            count: s[1]
          };
        }

        const subName = subDoc.fitName.toUpperCase() || null;

        if (!subName) {
          return {
            name: 'Unknown Fit',
            count: s[1]
          };
        }

        if (!subDoc.Category || !subDoc.Category.name) {
          return {
            name: `${subName} - Unknown Category`,
            count: s[1]
          };
        }

        return {
          name: `${subName} - ${subDoc.Category.name.toLowerCase()}`,
          count: s[1]
        };
      }),
      sales: {
        labels: salesLabels,
        data: salesData
      }

    });

  } catch (error) {
    console.error('Dashboard analytics error:', error);
    logger.error(`Dashboard analytics error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to load dashboard data'
    });
  }
};

export default {
  loadSalesReport,
  downloadSalesReport,
  getDashboardData
};
