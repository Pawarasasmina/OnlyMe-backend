import multer from "multer";

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_req, file, callback) => {
    callback(null, `${Date.now()}-${file.originalname}`);
  },
});

export const upload = multer({ storage });
