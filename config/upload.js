// config/upload.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// destination directory
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer local storage (filename unique)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, '-')
      .toLowerCase();
    cb(null, `${Date.now()}-${name}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: function (req, file, cb) {
    const allowedExt = ['.jpg', '.jpeg', '.png'];
    const allowedMime = ['image/jpeg', 'image/png'];

    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExt.includes(ext) || !allowedMime.includes(file.mimetype)) {
      return cb(new Error('Only JPG and PNG image files are allowed'));
    }

    cb(null, true);
  }
});

export { upload, UPLOAD_DIR };
