
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const input = path.resolve('public/crs-logo.jpeg');
const outputDir = path.resolve('public');

async function createIcons() {
  try {
    if (!fs.existsSync(input)) {
      throw new Error('Logo not found: public/crs-logo.jpeg');
    }

    console.log('Starting app icon generation...');

    for (const size of [192, 512]) {
      const output = path.join(
        outputDir,
        `pwa-${size}x${size}.png`
      );

      await sharp(input)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 17, g: 24, b: 39, alpha: 1 }
        })
        .png()
        .toFile(output);

      console.log(`Successfully created: pwa-${size}x${size}.png`);
    }

    console.log('All app icons created successfully!');
  } catch (error) {
    console.error('Icon generation failed:', error.message);
    process.exitCode = 1;
  }
}

createIcons();
