import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
import { Input, ALL_FORMATS, BlobSource, AudioBufferSink } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.66.1/dist/bundles/mediabunny.min.mjs';

env.allowLocalModels = false;
const $ = id => document.getElementById(id);
const hasGPU = !!navigator.gpu;
$('dev').textContent = hasGPU ? 'GPU acceleration is available on this device.' : 'No GPU acceleration here, so it will run slower on the CPU.';

let file = null, asr = null, loaded = '', cancel = false, segs = [];

const drop = $('drop'), pick = $('pick');
drop.onclick = () => pick.click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } };
['dragover','dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));
pick.onchange = () => setFile(pick.files[0]);
function setFile(f) {
  if (!f) return;
  file = f;
  $('fn').textContent = f.name + ' (' + (f.size / 1048576).toFixed(0) + ' MB)';
  $('go').disabled = false;
}

const bar = p => { $('bar').style.display = 'block'; $('fill').style.width = p + '%'; };
const fmt = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'h ' : '') + m + 'm ' + String(s % 60).padStart(2, '0') + 's'; };

async function loadModel(size) {
  if (asr && loaded === size) return;
  $('st').textContent = 'Loading model (first time downloads it)…';
  const opts = { progress_callback: p => { if (p.status === 'progress') { bar(p.progress); $('st').textContent = 'Downloading model… ' + Math.round(p.progress) + '%'; } } };
  if (hasGPU) {
    try {
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-' + size,
        { ...opts, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
      loaded = size; return;
    } catch (e) { console.warn('WebGPU failed, using CPU', e); }
  }
  asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-' + size, { ...opts, device: 'wasm', dtype: 'q8' });
  loaded = size;
}

// Streaming resampler: any sample rate -> 16 kHz mono, using averaging
let carry = 0;
function toMono16k(buf) {
  const ch = buf.numberOfChannels, len = buf.length, mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
  const r = buf.sampleRate / 16000, n = Math.max(0, Math.floor((len - carry) / r)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(carry + i * r), b = Math.min(len, Math.max(a + 1, Math.floor(carry + (i + 1) * r)));
    let s = 0; for (let k = a; k < b; k++) s += mono[k];
    out[i] = s / (b - a);
  }
  carry = Math.max(0, carry + n * r - len);
  return out;
}

const WIN = 30 * 16000;
function rms(a) { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] * a[i]; return Math.sqrt(s / (a.length / 4)); }

async function transcribeWindow(win, offset) {
  if (rms(win) < 0.004) return; // silence: skip, saves lots of time
  const lang = $('lang').value;
  const r = await asr(win, { return_timestamps: true, task: $('task').value, ...(lang ? { language: lang } : {}) });
  for (const c of (r.chunks || [{ timestamp: [0, win.length / 16000], text: r.text }])) {
    const t = c.text.trim();
    if (!t || (segs.length && segs[segs.length - 1].text === t)) continue; // drop repeats
    const s = offset + (c.timestamp[0] || 0), e = offset + (c.timestamp[1] ?? win.length / 16000);
    segs.push({ s, e, text: t });
  }
  $('text').value = segs.map(x => x.text).join(' ');
  $('text').scrollTop = 1e9;
}

$('go').onclick = async () => {
  $('go').disabled = true; $('stop').disabled = false; cancel = false; segs = []; carry = 0;
  $('text').value = ''; $('out').style.display = 'block'; $('trCard').style.display = 'block';
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}
  try {
    const audioOnly = $('mode').value === 'audio'; $('dlWav').style.display = 'none';
    if (!audioOnly) await loadModel($('model').value);
    let wavParts = [], wavLen = 0;
    $('st').textContent = 'Reading file…';
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio found in this file.');
    const total = await input.computeDuration();
    const sink = new AudioBufferSink(track);
    const t0 = performance.now();
    let parts = [], count = 0, done = 0;

    const report = () => {
      const el = (performance.now() - t0) / 1000, p = Math.min(100, done / total * 100);
      bar(p);
      const sp = done > 5 ? (done / el).toFixed(1) : '…';
      const left = done > 30 ? fmt(el / done * (total - done)) : '…';
      $('st').textContent = p.toFixed(1) + '% · ' + fmt(el) + ' elapsed · about ' + left + ' left · ' + sp + 'x faster than real time';
    };

    for await (const { buffer } of sink.buffers()) {
      if (cancel) break;
      const a = toMono16k(buffer);
      if (audioOnly) { const i16 = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const v = Math.max(-1, Math.min(1, a[i])); i16[i] = v < 0 ? v * 32768 : v * 32767; } wavParts.push(i16); wavLen += a.length; done = wavLen / 16000; report(); continue; }
      parts.push(a); count += a.length;
      while (count >= WIN) {
        const all = new Float32Array(count); let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        const win = all.slice(0, WIN), rest = all.slice(WIN);
        parts = rest.length ? [rest] : []; count = rest.length;
        await transcribeWindow(win, done);
        done += 30; report();
        if (cancel) break;
      }
    }
    if (!cancel && !audioOnly && count > 8000) {
      const all = new Float32Array(count); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      await transcribeWindow(all, done); done = total;
    }
    if (audioOnly && wavLen) {
      const h = new DataView(new ArrayBuffer(44)), w = (o, t) => { for (let i = 0; i < t.length; i++) h.setUint8(o + i, t.charCodeAt(i)); };
      w(0, 'RIFF'); h.setUint32(4, 36 + wavLen * 2, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
      h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, wavLen * 2, true);
      window.wavBlob = new Blob([h.buffer, ...wavParts], { type: 'audio/wav' });
      $('dlWav').style.display = 'inline-block'; $('text').value = 'Audio is ready. Click "Download audio (.wav)".';
      bar(100); $('st').textContent = 'Audio extracted in ' + fmt((performance.now() - t0) / 1000) + '.'; return finish();
    }
    report();
    $('st').textContent = (cancel ? 'Stopped. ' : 'Done in ' + fmt((performance.now() - t0) / 1000) + '. ') + 'You can copy or download the text.';
  } catch (err) {
    console.error(err);
    $('st').textContent = 'Could not convert this file: ' + (err.message || err) + '. Try the Fastest option or another file format.';
  }
  finish();
  function finish() { lock?.release?.(); $('go').disabled = false; $('stop').disabled = true; }
};
$('dlWav').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(window.wavBlob); a.download = (file ? file.name.replace(/\.[^.]+$/, '') : 'audio') + '.wav'; a.click(); };
const CODES = { english: 'en', telugu: 'te', hindi: 'hi', tamil: 'ta', kannada: 'kn', malayalam: 'ml', urdu: 'ur' };
let segs2 = [];
async function pair(src, tgt) {
  const mk = (a, b) => Translator.create({ sourceLanguage: a, targetLanguage: b,
    monitor(m) { m.addEventListener('downloadprogress', e => { $('st').textContent = 'Downloading language pack ' + a + ' to ' + b + '… ' + Math.round(e.loaded * 100) + '%'; }); } });
  const ok = async (a, b) => (await Translator.availability({ sourceLanguage: a, targetLanguage: b })) !== 'unavailable';
  if (await ok(src, tgt)) return [await mk(src, tgt)];
  if (src !== 'en' && tgt !== 'en' && await ok(src, 'en') && await ok('en', tgt)) return [await mk(src, 'en'), await mk('en', tgt)];
  throw new Error('Chrome cannot translate ' + src + ' to ' + tgt + ' yet.');
}
$('trBtn').onclick = async () => {
  if (!('Translator' in self)) { $('st').textContent = 'Translation needs Chrome 138 or newer on a computer.'; return; }
  if (!segs.length) { $('st').textContent = 'Convert a file to text first.'; return; }
  $('trBtn').disabled = true;
  try {
    let src = $('task').value === 'translate' ? 'en' : (CODES[$('lang').value] || '');
    if (!src && 'LanguageDetector' in self) {
      const d = await LanguageDetector.create(); const r = await d.detect(segs.slice(0, 40).map(x => x.text).join(' '));
      src = r[0]?.detectedLanguage || 'en';
    }
    src = src || 'en';
    const tgt = $('tl').value;
    if (src === tgt) throw new Error('The text is already in this language. Pick another language.');
    const chain = await pair(src, tgt);
    segs2 = []; $('trBox').style.display = 'block'; $('text2').value = '';
    for (let i = 0; i < segs.length; i++) {
      let t = segs[i].text; for (const tr of chain) t = await tr.translate(t);
      segs2.push({ s: segs[i].s, e: segs[i].e, text: t });
      if (i % 5 === 0 || i === segs.length - 1) { $('text2').value = segs2.map(x => x.text).join(' '); $('st').textContent = 'Translating… ' + Math.round((i + 1) / segs.length * 100) + '%'; }
    }
    $('st').textContent = 'Translation done.';
  } catch (e) { $('st').textContent = 'Translation problem: ' + (e.message || e); }
  $('trBtn').disabled = false;
};
$('dlTxt2').onclick = () => save(base() + '.' + $('tl').value + '.txt', segs2.map(x => x.text).join('\n'));
$('dlSrt2').onclick = () => save(base() + '.' + $('tl').value + '.srt', segs2.map((x, i) => (i + 1) + '\n' + ts(x.s) + ' --> ' + ts(x.e) + '\n' + x.text + '\n').join('\n'));
$('copy2').onclick = async () => { await navigator.clipboard.writeText($('text2').value); $('copy2').textContent = 'Copied'; setTimeout(() => $('copy2').textContent = 'Copy translation', 1500); };
$('stop').onclick = () => { cancel = true; };

const ts = s => { const p = (n, l = 2) => String(n).padStart(l, '0'); return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s % 3600 / 60)) + ':' + p(Math.floor(s % 60)) + ',' + p(Math.floor(s % 1 * 1000), 3); };
function save(name, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = name; a.click();
}
const base = () => (file ? file.name.replace(/\.[^.]+$/, '') : 'transcript');
$('dlTxt').onclick = () => save(base() + '.txt', segs.map(x => x.text).join('\n'));
$('dlSrt').onclick = () => save(base() + '.srt', segs.map((x, i) => (i + 1) + '\n' + ts(x.s) + ' --> ' + ts(x.e) + '\n' + x.text + '\n').join('\n'));
$('copy').onclick = async () => { await navigator.clipboard.writeText($('text').value); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy text', 1500); };
