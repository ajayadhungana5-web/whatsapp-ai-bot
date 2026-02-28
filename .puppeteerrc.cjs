const path = require('path');

/**
 * Puppeteer configuration file.
 * On Render (Linux), Chrome is installed to a NON-HIDDEN directory
 * inside the project so it survives between build and deploy phases.
 */
module.exports = {
    cacheDirectory: process.env.PUPPETEER_CACHE_DIR ||
        (process.platform === 'win32'
            ? path.join(__dirname, '.puppeteer_data')
            : '/opt/render/project/src/puppeteer-cache'),
};
