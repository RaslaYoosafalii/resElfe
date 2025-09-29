const mongoose = require('mongoose');
const { Schema } = mongoose;

const categorySchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    description: {
        type: String,
        required: true,
    },
    offerPrice: {
        type: String,
        required: false
    },
    offerValidDate: {
        type: Date,
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
})

const Category = mongoose.model('Category', categorySchema);

const subCategorySchema = new Schema({
    Category: {
        type: Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    fitName: {
        type: String,
        required: true,
        unique: true
    }
})
const SubCategory = mongoose.model('SubCategory', subCategorySchema);


module.exports = {
    Category,
    SubCategory
}