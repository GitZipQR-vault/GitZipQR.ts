const { encode } = require('../core/encode');
const { decode } = require('../core/decode');

/**
 * Programmatic encode.
 * @param {string} input Path to file or directory to encode.
 * @param {string[]} passwords Array of passwords.
 * @param {string} [outputDir=process.cwd()] Output directory.
 * @returns {Promise<{qrDir:string,fileId:string,totalChunks:number,archiveName:string}>}
 */
async function sdkEncode(input, passwords, outputDir = process.cwd()) {
  return await encode(input, outputDir, passwords);
}

/**
 * Programmatic decode.
 * @param {string} input Path to QR images or fragments.
 * @param {string[]} passwords Array of passwords.
 * @param {string} [outputDir=process.cwd()] Output directory.
 * @returns {Promise<string>} Path to restored file.
 */
async function sdkDecode(input, passwords, outputDir = process.cwd()) {
  return await decode(input, outputDir, passwords);
}

module.exports = { encode: sdkEncode, decode: sdkDecode };
