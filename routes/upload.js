const express = require('express')
const multer = require('multer')
const fs = require('fs')
const path = require('path')

const router = express.Router()

const uploadDir = path.join(__dirname, '..', 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const fileFilter = (_req, file, cb) => {
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

    if (!file.mimetype || !allowedTypes.has(file.mimetype)) {
        cb(new Error('Only image files are allowed'))
        return
    }

    cb(null, true)
}

const getImageExtension = (buffer) => {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpg'
    }

    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
        return 'png'
    }

    if (buffer.length >= 6) {
        const gifHeader = buffer.subarray(0, 6).toString('ascii')
        if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
            return 'gif'
        }
    }

    if (buffer.length >= 12) {
        const riffHeader = buffer.subarray(0, 4).toString('ascii')
        const webpHeader = buffer.subarray(8, 12).toString('ascii')
        if (riffHeader === 'RIFF' && webpHeader === 'WEBP') {
            return 'webp'
        }
    }

    return null
}

const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024
    }
})

router.post('/', upload.single('file'), async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' })
    }

    const extension = getImageExtension(req.file.buffer)
    if (!extension) {
        return res.status(400).json({ message: 'Invalid image file' })
    }

    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`
    const filePath = path.join(uploadDir, filename)

    try {
        await fs.promises.writeFile(filePath, req.file.buffer)
    } catch (error) {
        return next(error)
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`
    const url = `/uploads/${filename}`

    return res.json({
        url,
        filename,
        originalName: req.file.originalname,
        size: req.file.size
    })
})

router.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ message: error.message })
    }

    return res.status(400).json({ message: error.message || 'Upload failed' })
})

module.exports = router
