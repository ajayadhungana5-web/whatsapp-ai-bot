const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
    // Changes the cache location for Puppeteer to the local project directory
    // This ensures Render.com caches the downloaded Chromium browser and doesn't delete it
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
