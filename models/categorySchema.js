import mongoose from 'mongoose';
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
        type: Number,
        required: false,
        default: 0
    },
    offerIsPercent: {            // <-- NEW flag
        type: Boolean,
        default: false
    },
    offerValidDate: {
        type: Date,
    },
     isListed: {               
        type: Boolean,
        default: true
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


export {
    Category,
    SubCategory
}