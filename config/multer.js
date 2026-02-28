const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'images') {
      const dir = 'uploads/images';
      ensureDirExists(dir);
      cb(null, dir);
    } else if (file.fieldname === 'documents') {
      const dir = 'uploads/documents';
      ensureDirExists(dir);
      cb(null, dir);
    } else {
      const dir = 'uploads/others';
      ensureDirExists(dir);
      cb(null, dir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File type validation
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const allowedDocTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ];

  if (file.fieldname === 'images') {
    if (allowedImageTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid image type. Only JPEG, PNG, GIF, and WebP are allowed'));
  } else if (file.fieldname === 'documents') {
    if (allowedDocTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid document type. Only PDF, Word, JPEG, PNG are allowed'));
  } else {
    cb(new Error('Unknown field'));
  }
};

// Maximum file size: 5MB per file
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Middleware for handling images and documents
exports.uploadFiles = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'documents', maxCount: 10 }
]);