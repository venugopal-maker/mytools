

const $ = id => document.getElementById(id);
const vid = $('vid'), drop = $('drop'), file = $('file');
let frames = [], stopFlag = false, name = 'video';

function setMsg(t){ $('msg').textContent = t; }

function load(f){
  if(!f || !f.type.startsWith('video/')){ setMsg('Please choose a video file.'); return; }
  name = f.name.replace(/\.[^.]+$/, '') || 'video';
  vid.src = URL.createObjectURL(f);
  vid.style.display = 'block';
  vid.onloadedmetadata = () => {
    $('info').textContent = vid.videoWidth + '×' + vid.videoHeight + ' · ' + vid.duration.toFixed(1) + ' seconds';
    $('go').disabled = false; setMsg('');
  };
  vid.onerror = () => setMsg('This browser cannot play that video. Try an MP4 or WebM file.');
}
drop.onclick = () => file.click();
file.onchange = () => load(file.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); };

function seek(t){
  return new Promise(res => { vid.onseeked = () => res(); vid.currentTime = t; });
}

$('stop').onclick = () => { stopFlag = true; };

$('go').onclick = async () => {
  const step = Math.max(0.01, parseFloat($('step').value) || 1);
  const max = Math.min(100000, parseInt($('max').value) || 10000);
  const mime = $('fmt').value, limitW = parseInt($('size').value);
  const dur = vid.duration;
  let w = vid.videoWidth, h = vid.videoHeight;
  if(limitW && w > limitW){ h = Math.round(h * limitW / w); w = limitW; }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  frames = []; stopFlag = false; $('thumbs').innerHTML = ''; $('out').style.display = 'none';
  $('go').disabled = true; $('stop').disabled = false; vid.pause();
  $('bar').style.display = 'block';
  const smart = $('mode').value === 'smart', thr = parseFloat($('sens').value);
  const sc = document.createElement('canvas'); sc.width = 320; sc.height = 180;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  let last = null;
  const total = smart ? Math.floor(dur / step) + 1 : Math.min(max, Math.floor(dur / step) + 1);

  let skipped = 0;
  if($('engine').value === 'fast' && 'requestVideoFrameCallback' in vid){
    const rate = parseFloat($('rate').value) || 4, pend = [];
    let nextT = 0, prevT = null, minD = Infinity, lastD = null;
    await seek(0);
    vid.playbackRate = rate;
    await new Promise(done => {
      const onFrame = (now, meta) => {
        if(stopFlag || pend.length >= max){ done(); return; }
        const t = meta.mediaTime;
        if(prevT !== null){ const dd = t - prevT; if(dd > 0){ if(dd < minD) minD = dd; else if(dd > minD * 1.8) skipped++; } }
        prevT = t;
        if(t >= nextT){
          nextT = t + step - 0.001;
          let take = true;
          if(smart){
            sctx.drawImage(vid, 0, 0, 320, 180);
            const d = sctx.getImageData(0, 0, 320, 180).data;
            if(lastD){
              let diff = 0, cnt = 0;
              for(let k = 0; k < d.length; k += 4){ const px = Math.abs(d[k]-lastD[k]) + Math.abs(d[k+1]-lastD[k+1]) + Math.abs(d[k+2]-lastD[k+2]); diff += px; if(px > 90) cnt++; }
              diff /= (d.length / 4 * 3);
              if(diff < thr && !(thr <= 1 && cnt >= 4)) take = false;
            }
            if(take) lastD = d;
          }
          if(take){
            ctx.drawImage(vid, 0, 0, w, h);
            pend.push(new Promise(r => cv.toBlob(b => r({ blob: b, w, h, t }), mime, 0.92)));
          }
        }
        $('fill').style.width = Math.min(100, t / dur * 100) + '%';
        setMsg((smart ? 'Scanning ' : 'Capturing ') + Math.round(t) + 's of ' + Math.round(dur) + 's · ' + pend.length + ' images');
        vid.requestVideoFrameCallback(onFrame);
      };
      vid.onended = () => done();
      vid.requestVideoFrameCallback(onFrame);
      vid.play().catch(() => done());
    });
    vid.pause(); vid.playbackRate = 1; vid.onended = null;
    setMsg('Finishing images…');
    frames = await Promise.all(pend);
    const stride = Math.max(3, Math.ceil(frames.length / 120));
    frames.forEach((f, i) => { if(i % stride === 0){ const im = new Image(); im.src = URL.createObjectURL(f.blob); $('thumbs').appendChild(im); } });
  } else for(let i = 0; i < total && !stopFlag && frames.length < max; i++){
    const t = Math.min(i * step, Math.max(0, dur - 0.05));
    await seek(t);
    if(smart){
      sctx.drawImage(vid, 0, 0, 320, 180);
      const d = sctx.getImageData(0, 0, 320, 180).data;
      let diff = 0, cnt = 0;
      if(last){
        for(let k = 0; k < d.length; k += 4){ const px = Math.abs(d[k]-last[k]) + Math.abs(d[k+1]-last[k+1]) + Math.abs(d[k+2]-last[k+2]); diff += px; if(px > 90) cnt++; }
        diff /= (d.length / 4 * 3);
      }
      $('fill').style.width = ((i + 1) / total * 100) + '%';
      if(last && diff < thr && !(thr <= 1 && cnt >= 4)){ setMsg('Checked ' + (i + 1) + ' of ' + total + ' · captured ' + frames.length); continue; }
      last = d;
    }
    ctx.drawImage(vid, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, mime, 0.92));
    frames.push({ blob, w, h, t });
    if(frames.length % (smart ? 5 : 3) === 1 || i === total - 1){
      const im = new Image(); im.src = URL.createObjectURL(blob); $('thumbs').appendChild(im);
    }
    $('fill').style.width = ((i + 1) / total * 100) + '%';
    setMsg(smart ? 'Checked ' + (i + 1) + ' of ' + total + ' · captured ' + frames.length : 'Captured ' + (i + 1) + ' of ' + total);
  }
  $('go').disabled = false; $('stop').disabled = true; $('bar').style.display = 'none';
  if(frames.length){
    $('out').style.display = 'block';
    $('count').textContent = frames.length + ' images ready' + (stopFlag ? ' (stopped early)' : '');
    setMsg((smart ? 'Done. Only moments where something changed were captured.' : 'Done. Previews show a sample of the images.') + (skipped ? ' About ' + skipped + ' frames may have been skipped at this speed; choose a lower speed or Exact seek for every frame.' : ''));
  } else setMsg('No frames captured.');
};

async function save(filename, blob){
  try{
    const d = window.claude ? await claude.use('downloads') : null;
    if(d){ await d.save({ filename, data: blob }); return; }
  }catch(e){ if(e && e.code === 'declined') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

$('zip').onclick = async () => {
  setMsg('Building ZIP…'); $('zip').disabled = true;
  const ext = $('fmt').value === 'image/png' ? 'png' : 'jpg';
  const z = new JSZip();
  frames.forEach((f, i) => z.file(name + '_' + String(i + 1).padStart(5, '0') + '.' + ext, f.blob));
  const out = await z.generateAsync({ type: 'blob', compression: 'STORE' });
  $('zip').disabled = false; setMsg('');
  await save(name + '_frames.zip', out);
};

function toDataURL(blob){
  return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

$('pdf').onclick = async () => {
  setMsg('Building PDF…'); $('pdf').disabled = true;
  const { jsPDF } = window.jspdf;
  const type = $('fmt').value === 'image/png' ? 'PNG' : 'JPEG';
  let doc = null;
  for(let i = 0; i < frames.length; i++){
    const f = frames[i], o = f.w >= f.h ? 'l' : 'p';
    if(!doc) doc = new jsPDF({ orientation: o, unit: 'px', format: [f.w, f.h], compress: true });
    else doc.addPage([f.w, f.h], o);
    doc.addImage(await toDataURL(f.blob), type, 0, 0, f.w, f.h);
    setMsg('PDF page ' + (i + 1) + ' of ' + frames.length);
  }
  const out = doc.output('blob');
  $('pdf').disabled = false; setMsg('');
  await save(name + '.pdf', out);
};
