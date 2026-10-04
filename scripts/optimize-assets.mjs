import sharp from 'sharp';
await sharp('design/study-window.png').webp({ quality: 86 }).toFile('public/study-window.webp');
console.log('Saved optimized background: public/study-window.webp');
