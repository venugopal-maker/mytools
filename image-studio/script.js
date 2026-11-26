const $ = id => document.getElementById(id);
let img = null, baseName = 'photo', origSize = 0, runId = 0, timer = null, outBlob = null, outUrl = '', outExt = 'jpg';

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB';
const toBlob = (cv, m, q) => new Promise(r => cv.toBlob(r, m, q));
const setMsg = t => { $('msg').textContent = t; };

/* ---------- loading ---------- */
function load(f) {
  if (!f || !f.type.startsWith('image/')) { setMsg('Please choose an image file.'); return; }
  baseName = f.name.replace(/\.[^.]+$/, '') || 'photo';
  origSize = f.size;
  const i = new Image();
  i.onload = () => {
    img = i; $('work').hidden = false;
    setMsg(f.name + ' · ' + i.naturalWidth + ' × ' + i.naturalHeight + ' px · ' + fmtSize(f.size));
    schedule();
  };
  i.onerror = () => setMsg('This image could not be opened. Try a JPG or PNG file.');
  i.src = URL.createObjectURL(f);
}
const drop = $('drop'), file = $('file');
drop.onclick = () => file.click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
file.onchange = () => load(file.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); };

/* ---------- drawing: resize + text ---------- */
function build(scale) {
  const w = img.naturalWidth, h = img.naturalHeight, p = $('preset').value;
  let tw = w, th = h, sx = 0, sy = 0, sw = w, sh = h;
  if (p === 'custom') { tw = parseInt($('cw').value) || w; th = parseInt($('ch').value) || h; }
  else if (p !== 'orig') { [tw, th] = p.split('x').map(Number); }
  if (p !== 'orig') {                       // centre crop to the wanted shape
    const r = tw / th, ir = w / h;
    if (ir > r) { sw = h * r; sx = (w - sw) / 2; } else { sh = w / r; sy = (h - sh) / 2; }
  }
  tw = Math.max(1, Math.round(tw * scale)); th = Math.max(1, Math.round(th * scale));

  const lines = $('text').value.split('\n').map(s => s.trim()).filter(Boolean);
  const pos = $('pos').value, strip = pos === 'strip' && lines.length > 0;
  const fs = Math.max(8, Math.round(tw * parseFloat($('fsize').value) / 100));
  const lh = Math.round(fs * 1.3), block = lines.length * lh;
  const stripH = strip ? Math.round(block + fs * 0.7) : 0;

  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th + stripH;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.imageSmoothingQuality = 'high';
  c.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);

  if (lines.length) {
    c.font = '700 ' + fs + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let top;
    if (strip) {
      c.fillStyle = $('bg').value; c.fillRect(0, th, tw, stripH);
      top = th + (stripH - block) / 2;
    } else {
      top = pos === 'top' ? fs * 0.4 : pos === 'middle' ? (th - block) / 2 : th - block - fs * 0.4;
      if ($('bar').checked) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, top - fs * 0.2, tw, block + fs * 0.4); }
    }
    c.fillStyle = $('tcolor').value;
    lines.forEach((l, i) => c.fillText(l, tw / 2, top + lh * i + lh / 2, tw * 0.96));
  }
  return cv;
}

/* ---------- compress ---------- */
async function run() {
  if (!img) return;
  const id = ++runId, mime = $('fmt').value;
  const target = (parseFloat($('target').value) || 100) * parseInt($('unit').value);
  let scale = 1, cv = build(1), blob, note = '';

  if ($('mode').value === 'quality') {
    blob = await toBlob(cv, mime, parseInt($('quality').value) / 100);
  } else if (mime === 'image/png') {
    blob = await toBlob(cv, mime);
    while (blob.size > target && scale > 0.1) {
      if (id !== runId) return;
      scale *= 0.85; cv = build(scale); blob = await toBlob(cv, mime);
    }
    if (scale < 1) note = 'PNG cannot lower its quality, so the photo was made smaller in pixels. Choose JPG to keep the full size.';
  } else {
    for (let n = 0; n < 25; n++) {
      if (id !== runId) return;
      cv = build(scale);
      const hi = await toBlob(cv, mime, 0.95);
      if (hi.size <= target) { blob = hi; break; }
      const lo = await toBlob(cv, mime, 0.05);
      if (lo.size <= target) {
        let a = 0.05, b = 0.95, best = lo;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2, t = await toBlob(cv, mime, m);
          if (t.size <= target) { a = m; best = t; } else b = m;
        }
        blob = best; break;
      }
      blob = lo; scale *= 0.85;
    }
    if (scale < 1) note = 'To reach this size the photo had to be made smaller in pixels too.';
  }
  if (id !== runId) return;

  outBlob = blob; outExt = EXT[mime];
  if (outUrl) URL.revokeObjectURL(outUrl);
  outUrl = URL.createObjectURL(blob);
  $('prev').src = outUrl; $('dl').disabled = false;

  const saved = Math.round((1 - blob.size / origSize) * 100);
  let html = '<b>New size:</b> ' + fmtSize(blob.size) + '<br><b>Original:</b> ' + fmtSize(origSize) +
    '<br><b>Pixels:</b> ' + cv.width + ' × ' + cv.height;
  html += saved > 0 ? '<br><b>Smaller by:</b> ' + saved + '%' : '<br><b>Note:</b> this file is larger than the original.';
  if ($('mode').value === 'target' && blob.size > target) html += '<br><span class="warn">This is the smallest it can get at this format. Try a larger target or JPG.</span>';
  if (note) html += '<br><span class="warn">' + note + '</span>';
  $('stats').innerHTML = html;
}
function schedule() { clearTimeout(timer); timer = setTimeout(run, 250); }

/* ---------- controls ---------- */
['preset','cw','ch','text','pos','fsize','tcolor','bg','bar','mode','target','unit','quality','fmt'].forEach(id => {
  $(id).addEventListener('input', schedule); $(id).addEventListener('change', schedule);
});
$('preset').addEventListener('change', () => {
  const v = $('preset').value;
  $('customRow').hidden = v !== 'custom';
  if (v !== 'orig' && v !== 'custom') { const [w, h] = v.split('x'); $('cw').value = w; $('ch').value = h; }
});
$('mode').addEventListener('change', () => {
  const t = $('mode').value === 'target';
  $('targetRow').hidden = !t; $('qualRow').hidden = t;
});
$('quality').addEventListener('input', () => { $('qv').textContent = $('quality').value; });
$('today').onclick = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const s = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  const t = $('text'); t.value = t.value.trim() ? t.value.trim() + '\n' + s : s; schedule();
};
$('clear').onclick = () => { $('text').value = ''; schedule(); };
$('dl').onclick = () => {
  if (!outBlob) return;
  const a = document.createElement('a');
  a.href = outUrl; a.download = baseName + '_edited.' + outExt;
  document.body.appendChild(a); a.click(); a.remove();
};
