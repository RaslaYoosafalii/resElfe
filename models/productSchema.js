const mongoose =require('mongoose');
const {Schema} = mongoose;



const productSchema = new Schema({
    productName: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    categoryId:{
        type: Schema.Types.ObjectId,
        ref: "Category",
        required: true
    },
    subcategoryId: {
        type: String,
        required: true
    },
    isListed: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    offerPrice: {
      type: Number,
      required: false
    },
    offerValidDate: {
     type: Date
    },
    status: {
        type: String,
        enum: ['available', 'out of stock'],
        default: 'available',
        required: true
    }
  
},{timestamps: true});

const Product = mongoose.model('Product', productSchema);




const varientSchema = new Schema({
    productId: {
        type: Schema.Types.ObjectId,
        ref: "Product",
        required: true
    },
    size: {
        type: String,
        required: true,
    },
    color: {
        type: String,
        required: true,
    },
    images: {
        type: [String],
        required: true
    },
    price: {
       type: Number,
       required: true
    },
    stock: {
        type: Number,
        required: true,
        min: 0
    },
    isListed: {
         type: Boolean,
         default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    ratings: [{
       userId: {
           type: Schema.Types.ObjectId,
           ref: 'User',
    },
      rating: {
      type: Number,
      min: 1,
      max: 5,
    },
      review: String,
      createdAt: {
          type: Date,
          default: Date.now,
    },
  }]
}) 

const Varient = mongoose.model('Varient', varientSchema);



module.exports = { 
    Product,
    Varient
};