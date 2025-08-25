/**
 * GitZipQR — Decoder
 * Always restore output file as: <meta.name><meta.ext>
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const readline = require('readline');

const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";
const MAX_WORKERS = Math.max(1, parseInt(process.env.QR_WORKERS || String(os.cpus().length), 10));

function stepStart(n, label){ process.stdout.write(`STEP #${n} ${label} ... `); }
function stepDone(ok){ process.stdout.write(`[${ok ? 1 : 0}]\n`); }

/* Password */
function promptHidden(question){
  return new Promise((resolve,reject)=>{
    if(!process.stdin.isTTY) return reject(new Error('No interactive TTY is available for password input'));
    process.stdout.write(question);
    const stdin=process.stdin; let buf='';
    const onData=(d)=>{ const s=d.toString('utf8');
      if(s==='\u0003'){ cleanup(); process.stdout.write('\n'); return reject(new Error('Operation cancelled')); }
      if(s==='\r' || s==='\n'){ cleanup(); process.stdout.write('\n'); return resolve(buf); }
      if(s==='\u0008' || s==='\u007f'){ buf=buf.slice(0,-1); return; }
      buf+=s;
    };
    const cleanup=()=>{ stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); };
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  });
}
async function promptPasswordCount(def=2){
  if(!process.stdin.isTTY) throw new Error('No interactive TTY is available for password input');
  return await new Promise((resolve)=>{
    const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
    rl.question('AMOUNT NUMBER OF PASSWORD: ', (ans)=>{ rl.close(); const n=parseInt(ans,10); resolve(Number.isFinite(n)&&n>0?n:def); });
  });
}
async function promptPasswords(defaultCount=2){
  const count = await promptPasswordCount(defaultCount);
  const parts = [];
  for(let i=1;i<=count;i++){
    const p = await promptHidden(`Password #${i}: `);
    if(!p || p.length<8) throw new Error('Password must be at least 8 characters long.');
    parts.push(p);
  }
  return parts.join('\u0000');
}

function isImageFile(name){ return /\.(png|jpg|jpeg)$/i.test(name); }
function listFragmentsFlexible(p){
  const st = fs.existsSync(p) ? fs.statSync(p) : null;
  if(st && st.isFile()) return [path.resolve(p)];
  const res=[]; const tryDir=(d)=>{ if(fs.existsSync(d) && fs.statSync(d).isDirectory()){ for(const f of fs.readdirSync(d)) if(f.endsWith('.bin.json')) res.push(path.join(d,f)); } };
  const root=path.resolve(p); tryDir(root); if(res.length===0) tryDir(path.join(root,'fragments'));
  res.sort((a,b)=>{const ai=parseInt((path.basename(a).match(/(\d+)\.bin\.json$/)||[,'0'])[1],10);
                   const bi=parseInt((path.basename(b).match(/(\d+)\.bin\.json$/)||[,'0'])[1],10); return ai-bi;});
  return res;
}

function runDecodePool(images){
  let i=0,active=0; const results=new Array(images.length);
  return new Promise((resolve)=>{
    function launch(){
      while(active<MAX_WORKERS && i<images.length){
        const idx=i++; const img=images[idx]; active++;
        const w = new Worker(path.join(__dirname,'qrdecode.worker.ts'),{ workerData:{ img } });
        w.once('message',(msg)=>{ active--; results[idx]=msg;
          if((idx+1)%100===0 || idx+1===images.length) process.stdout.write(`QR read ${idx+1}/${images.length}\r`);
          if(i<images.length) launch(); else if(active===0){ process.stdout.write('\n'); resolve(results); }
        });
        w.once('error',()=>{ active--; results[idx]={ok:false,error:'worker error'}; if(i<images.length) launch(); else if(active===0) resolve(results); });
      }
    } launch();
  });
}

/* ---------------- Main API ---------------- */
async function decode(inputPath, outputDir=process.cwd(), passwords){
  if(!fs.existsSync(outputDir)) fs.mkdirSync(outputDir,{recursive:true});
  const input=path.resolve(inputPath);

  // STEP 1: collect
  stepStart(1,'collect data');
  let chunks=[];
  let nameBase=null;   // without extension
  let metaExt=null;    // with extension (".zip", ".png", ...)
  let cipherSha256=null, expectedTotal=null, kdf=null, salt=null, nonce=null;

  if(fs.existsSync(input) && fs.statSync(input).isDirectory()){
    const imgs = fs.readdirSync(input).filter(isImageFile).map(f=>path.join(input,f));
    if(imgs.length){
      const results = await runDecodePool(imgs);
      const acc = new Map();
      for(const r of results){
        if(!r || !r.ok) continue;
        const m = r.payload;
        if(!(m && m.type===FRAGMENT_TYPE && typeof m.chunk==='number' && typeof m.total==='number')) continue;
        if(m.dataB64){
          const key = `${m.fileId}:${m.chunk}`;
          if(!acc.has(key)) acc.set(key,{ parts:[], total:m.partTotal||1 });
          const entry = acc.get(key);
          entry.parts[(typeof m.part==='number')?m.part:0] = m.dataB64;
          entry.total = m.partTotal || 1;

          if(!nameBase && m.name) nameBase = m.name;
          if(!metaExt  && m.ext!=null) metaExt = String(m.ext);
          if(!cipherSha256) cipherSha256 = m.cipherHash;
          if(!kdf && m.kdfParams) kdf=m.kdfParams;
          if(!salt && m.saltB64)  salt=Buffer.from(m.saltB64,'base64');
          if(!nonce && m.nonceB64)nonce=Buffer.from(m.nonceB64,'base64');
          if(!expectedTotal) expectedTotal = m.total;
        }
      }
      if(acc.size>0){
        for(const [key,entry] of acc.entries()){
          for(let p=0;p<(entry.total||1);p++){
            if(typeof entry.parts[p] !== 'string'){ stepDone(0); console.error(`Missing QR part ${p+1}/${entry.total} for ${key}`); process.exit(1); }
          }
          const joinedB64 = (entry.total && entry.total>1) ? entry.parts.join('') : entry.parts[0];
          const buf = Buffer.from(joinedB64,'base64');
          const chunkIndex = parseInt(key.split(':')[1],10);
          chunks[chunkIndex] = buf;
        }
        stepDone(1);
      } else { stepDone(0); console.error("No inline QR data detected in images."); process.exit(1); }
    } else { stepDone(0); console.error("Directory has no QR images."); process.exit(1); }
  } else {
    // legacy
    const manifestPath=[path.join(path.dirname(input),'manifest.json'),path.join(input,'manifest.json'),path.join(process.cwd(),'manifest.json')].find(p=>fs.existsSync(p));
    if(!manifestPath){ stepDone(0); console.error("No manifest.json for legacy fragments."); process.exit(1); }
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    expectedTotal = manifest.totalChunks || manifest.total_chunks;
    cipherSha256  = manifest.cipherSha256 || manifest.cipher_sha256;
    kdf   = manifest.kdfParams || manifest.kdf_params;
    salt  = Buffer.from(manifest.saltB64  || manifest.salt_b64 ,'base64');
    nonce = Buffer.from(manifest.nonceB64 || manifest.nonce_b64,'base64');
    nameBase = manifest.name || path.basename(input).replace(/\.[^./\\]+$/,'');
    metaExt  = manifest.ext != null ? String(manifest.ext) : (manifest.archive_ext || '');
    let fragmentFiles = listFragmentsFlexible(input);
    if(!fragmentFiles.length){ stepDone(0); console.error("No *.bin.json fragments found."); process.exit(1); }
    for(const fp of fragmentFiles){
      const frag = JSON.parse(fs.readFileSync(fp,'utf8'));
      if(frag.type !== FRAGMENT_TYPE) continue;
      if(!nameBase && frag.name) nameBase = frag.name;
      if(!metaExt  && frag.ext!=null) metaExt = String(frag.ext);
      const buf = Buffer.from(frag.data,'base64');
      const h = crypto.createHash('sha256').update(buf).digest('hex');
      if(h !== frag.hash){ stepDone(0); console.error(`Chunk hash mismatch: ${path.basename(fp)}`); process.exit(1); }
      chunks[frag.chunk] = buf;
    }
    stepDone(1);
  }

  // STEP 2: verify & assemble
  stepStart(2,'verify & assemble');
  const present = chunks.filter(Boolean).length;
  if(expectedTotal && present!==expectedTotal){ stepDone(0); console.error(`Missing chunks: ${present}/${expectedTotal}`); process.exit(1); }
  const encBuffer = Buffer.concat(chunks);
  if(cipherSha256){
    const globalCheck = crypto.createHash('sha256').update(encBuffer).digest('hex');
    if(globalCheck !== cipherSha256){ stepDone(0); console.error(`Global sha256 mismatch. Expected ${cipherSha256}, got ${globalCheck}`); process.exit(1); }
  }
  stepDone(1);

  // STEP 3: decrypt
  stepStart(3,'decrypt');
  if(!(nameBase!=null && metaExt!=null)){ stepDone(0); console.error("Meta name/ext missing. Re-encode with newer encoder."); process.exit(1); }
  if(!(salt && nonce)) { stepDone(0); console.error("Crypto parameters are missing."); process.exit(1); }
  const pass = await (async()=>{ try{ return (await promptPasswords()); } catch(e){ stepDone(0); throw e; } })();

  const key = crypto.scryptSync(pass, salt, 32, { N:kdf.N, r:kdf.r, p:kdf.p, maxmem:512*1024*1024 });
  const tag = encBuffer.subarray(encBuffer.length-16);
  const ciphertext = encBuffer.subarray(0, encBuffer.length-16);

  let dataBuf;
  try{
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    dataBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    stepDone(1);
  } catch { stepDone(0); console.error("Decryption failed. Wrong password or corrupted data."); process.exit(1); }

  // STEP 4: write as <name><ext> (ext may be empty — then no extension)
  stepStart(4,'write output');
  let ext = String(metaExt || '');
  if(ext && !ext.startsWith('.')) ext = '.'+ext;
  const outName = nameBase + (ext || '');
  const outPath = path.join(outputDir, outName);
  fs.writeFileSync(outPath, dataBuf);
  stepDone(1);

  const finalExt = ext || path.extname(outName) || '';
  if(finalExt === '.zip') console.log(`\n✅ Restored ZIP → ${outPath}`);
  else console.log(`\n✅ Restored file → ${outPath}`);

  return outPath;
}

if (require.main === module){
  const inputArg = process.argv[2];
  const outputDir = (process.argv[3] && !process.argv[3].startsWith('-')) ? process.argv[3] : process.cwd();
  if(!inputArg){ console.error("Usage: bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]"); process.exit(1); }
  decode(inputArg, outputDir).catch((e)=>{ console.error(e.message || e); process.exit(1); });
}
module.exports = { decode };
