import fs from 'fs';
import path from 'path';

// Read src/cli.js line by line and look for syntax issues
const lines = fs.readFileSync('D:/AIAUTOTEST1-latest/src/cli.js', 'utf-8').split('\n');
console.log('Total lines:', lines.length);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('<<<<<<<') || line.includes('=======') || line.includes('>>>>>>>')) {
    console.log(`Conflict marker found at line ${i + 1}: ${line}`);
  }
}
