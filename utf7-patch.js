// Patch for utf7 module compatibility with Bun
// This fixes the missing allocateBase64Buffer function

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const utf7Path = path.join(__dirname, 'node_modules/utf7/utf7.js');

if (fs.existsSync(utf7Path)) {
  let content = fs.readFileSync(utf7Path, 'utf8');
  
  // Check if the function is already properly defined
  if (!content.includes('function allocateBase64Buffer(str) {')) {
    // Replace the conditional block with a simple function definition
    const oldBlock = `if (semver.gte(process.version, '6.0.0')) {
    function allocateBase64Buffer(str) {
        return Buffer.from(str, 'base64');
    }
} else {
    function allocateBase64Buffer(str) {
        return new Buffer(str, 'base64');
    }
}`;
    
    const newBlock = `function allocateBase64Buffer(str) {
    return Buffer.from(str, 'base64');
}`;
    
    content = content.replace(oldBlock, newBlock);
    
    fs.writeFileSync(utf7Path, content);
    console.log('✅ Patched utf7 module for Bun compatibility');
  } else {
    console.log('✅ utf7 module already patched');
  }
} else {
  console.log('❌ utf7 module not found');
}
